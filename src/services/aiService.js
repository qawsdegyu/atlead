const axios = require('axios');
const fs = require('fs');
const knowledgeService = require('./knowledgeService');
const storageService = require('./storageService');
const calendarService = require('./calendarService');

function normalizeArabic(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[إأآ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove harakat
    .trim();
}

// Detects which AI service a key belongs to from its prefix.
function detectKeyType(key) {
  const k = String(key || '').trim();
  if (!k) return null;
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('sk-or-')) return 'openrouter';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-')) return 'openai';
  if (k.startsWith('AIza') || k.startsWith('AQ.')) return 'gemini';
  return 'unknown';
}

const PROVIDER_LABELS = {
  gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Claude (Anthropic)',
  openrouter: 'OpenRouter', groq: 'Groq', unknown: 'غير معروف'
};

const OPENAI_COMPATIBLE = {
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o' },
  openrouter: { base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' }
};

const VOICE_FAILED_TEXT = 'رسالة صوتية (تعذّر تفريغها)';
const VOICE_MARKERS = [VOICE_FAILED_TEXT, '🎤 رسالة صوتية (تعذّر تفريغها)', '__VOICE_TRANSCRIPTION_FAILED__', 'رسالة صوتية من العميل'];

class AiService {
  get VOICE_FAILED_TEXT() { return VOICE_FAILED_TEXT; }

  /** 'en' when the message is mostly Latin letters, otherwise 'ar'. */
  detectLanguage(text) {
    const t = this.cleanVoiceMarker(String(text || '')).replace(/https?:\/\/\S+/g, '');
    const ar = (t.match(/[؀-ۿ]/g) || []).length;
    const en = (t.match(/[A-Za-z]/g) || []).length;
    return en > ar * 2 && en >= 3 ? 'en' : 'ar';
  }

  /** Customer names like "عميل محتمل" / "متابع" / simulator labels are not real names. */
  realName(name) {
    const n = String(name || '').trim();
    if (!n || /عميل|متابع|مستخدم|simulator|test|voice|image|customer|user/i.test(n)) return '';
    return n;
  }

  /** Chat apps don't render Markdown: [text](url) → "text: url", drop ** and # headings. */
  toPlainText(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => (label.includes(url) ? url : `${label}: ${url}`))
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .trim();
  }

  isVoiceFailed(text) {
    return VOICE_MARKERS.some(m => String(text || '').includes(m));
  }

  cleanVoiceMarker(text) {
    let t = String(text || '');
    for (const m of VOICE_MARKERS) t = t.split(m).join('');
    return t.replace(/\n{2,}/g, '\n').trim();
  }

  /**
   * Every usable AI key (dashboard fields + environment variables), typed by prefix,
   * with the provider chosen in the dashboard first. A key pasted into the "wrong"
   * field still works because the type comes from the key itself.
   */
  /**
   * One-time cleanup: an OpenRouter key that was pasted into another field
   * (e.g. the old Gemini field) moves to the OpenRouter field.
   */
  migrateKeys() {
    if (this._migrated) return;
    this._migrated = true;
    const ai = storageService.getSettings().ai || {};
    if (ai.openrouter_api_key) return;
    for (const field of ['gemini_api_key', 'openai_api_key', 'anthropic_api_key']) {
      if (detectKeyType(ai[field]) === 'openrouter') {
        storageService.updateSettings({ ai: { openrouter_api_key: String(ai[field]).trim(), [field]: '', provider: 'openrouter' } });
        console.log(`[AI] Moved the OpenRouter key from "${field}" to the OpenRouter field.`);
        return;
      }
    }
  }

  getProviders() {
    this.migrateKeys();
    const ai = storageService.getSettings().ai || {};
    const raw = [
      ai.openrouter_api_key,
      ai.gemini_api_key, ai.openai_api_key, ai.anthropic_api_key,
      process.env.GEMINI_API_KEY, process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY,
      process.env.OPENROUTER_API_KEY, process.env.GROQ_API_KEY
    ].map(k => String(k || '').trim()).filter(Boolean);
    const seen = new Set();
    const list = [];
    for (const key of raw) {
      if (seen.has(key)) continue;
      seen.add(key);
      let type = detectKeyType(key);
      if (type === 'unknown') type = 'gemini';
      const model =
        type === 'gemini' ? (ai.gemini_model || 'gemini-2.5-flash')
          : type === 'anthropic' ? (ai.anthropic_model || 'claude-sonnet-5-5')
            : type === 'openai' ? (ai.openai_model || 'gpt-4o')
              : (ai[`${type}_model`] || OPENAI_COMPATIBLE[type].model);
      list.push({ type, key, model, label: PROVIDER_LABELS[type] });
    }
    const preferred = ai.provider || 'openrouter';
    return list.sort((a, b) => (b.type === preferred) - (a.type === preferred));
  }

  describeKeys() {
    return this.getProviders().map(p => `${p.label} (${p.key.slice(0, 4)}…, ${p.model})`);
  }

  /** One chat call to any provider. Returns the raw text of the model's answer. */
  async chat(p, systemPrompt, history, userPrompt, { json = true, temperature = 0.5, timeout = 30000 } = {}) {
    if (p.type === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${p.key}`;
      const contents = history.map(h => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: h.text }] }));
      contents.push({ role: 'user', parts: [{ text: userPrompt }] });
      const res = await axios.post(url, {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) }
      }, { timeout });
      return res.data?.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') || '';
    }
    if (p.type === 'anthropic') {
      // Claude needs alternating user/assistant turns that start with "user".
      const messages = [];
      for (const h of [...history, { role: 'user', text: userPrompt }]) {
        const role = h.role === 'model' ? 'assistant' : 'user';
        const last = messages[messages.length - 1];
        if (last && last.role === role) last.content += `\n${h.text}`;
        else messages.push({ role, content: h.text });
      }
      if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: '(بداية المحادثة)' });
      const res = await axios.post('https://api.anthropic.com/v1/messages', {
        model: p.model,
        max_tokens: 1500,
        temperature,
        system: systemPrompt + (json ? '\n\nأعد JSON صالح فقط، بدون أي نص قبله أو بعده.' : ''),
        messages
      }, {
        headers: { 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        timeout
      });
      return (res.data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    }
    const cfg = OPENAI_COMPATIBLE[p.type];
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const h of history) messages.push({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text });
    messages.push({ role: 'user', content: userPrompt });
    const res = await axios.post(`${cfg.base}/chat/completions`, {
      model: p.model,
      messages,
      temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    }, { headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' }, timeout });
    return res.data?.choices?.[0]?.message?.content || '';
  }

  /** Tries every configured provider in order; throws the last error if all fail. */
  async chatWithFailover(systemPrompt, history, userPrompt, opts) {
    const providers = this.getProviders();
    if (!providers.length) throw new Error('NO_AI_KEY');
    let lastErr;
    for (const p of providers) {
      try {
        const text = await this.chat(p, systemPrompt, history, userPrompt, opts);
        if (!String(text).trim()) throw new Error('Empty AI response');
        this.lastStatus = { ok: true, provider: p.label, model: p.model, at: new Date().toISOString() };
        return { text, provider: p };
      } catch (err) {
        lastErr = err;
        const msg = err.response?.data?.error?.message || err.message;
        this.lastStatus = { ok: false, provider: p.label, model: p.model, error: msg, at: new Date().toISOString() };
        console.error(`[AI] ${p.label} (${p.model}) failed:`, msg);
      }
    }
    throw lastErr;
  }

  async generateReply(conversation, incomingMessage) {
    // A voice note we couldn't transcribe is never treated as a normal question
    // (that used to trigger a generic welcome). Alone → honest retry request;
    // mixed with text → the AI sees a clear note instead of a raw marker.
    const voiceFailed = this.isVoiceFailed(incomingMessage);
    incomingMessage = this.cleanVoiceMarker(incomingMessage);
    if (voiceFailed && !String(incomingMessage).trim()) {
      return {
        reply_text: 'وصلتني رسالتك الصوتية، بس ما قدرت أسمعها بوضوح 🙏 ممكن تعيدها أو تكتبلي سؤالك؟',
        identified_problem: null,
        proposed_solution: null,
        lead_stage: conversation.lead_stage || 'discovery',
        classification: conversation.classification || 'Cold',
        buying_probability: Number(conversation.interest_score) || 0,
        handoff_triggered: false,
        customer_name: null,
        customer_phone: null,
        source: 'voice_transcription_failed'
      };
    }
    if (voiceFailed) incomingMessage = `${incomingMessage}
(ملاحظة: العميل بعث كمان رسالة صوتية ما انفهمت — اطلب منه يعيدها إذا لزم)`;
    const systemPrompt = knowledgeService.getSystemPrompt();

    // Prepare message history
    const history = (conversation.messages || []).slice(-20).map(m => ({
      role: m.sender === 'customer' ? 'user' : 'model',
      text: `${m.sender === 'customer' ? 'العميل: ' : m.sender === 'agent' ? 'موظف المبيعات: ' : 'المساعد: '}${this.isVoiceFailed(m.content) ? '[رسالة صوتية ما انفهمت]' : m.content}`
    }));

    const lastMsgAt = conversation.messages?.length ? conversation.messages[conversation.messages.length - 1].created_at : null;
    const daysSince = lastMsgAt ? Math.floor((Date.now() - new Date(lastMsgAt).getTime()) / 86400000) : 0;

    const lang = this.detectLanguage(incomingMessage);
    // Free consultation times straight from the engineer's Google Calendar (only when connected).
    const calendarBlock = await calendarService.promptBlock(conversation).catch(() => '');
    // AI voice call: the qualification stage before the engineer.
    const callService = require('./callService');
    const callOn = !!(conversation.id && callService.isActive());
    const callDone = conversation.ai_call_status === 'completed';
    const callBlock = !callOn ? '' : callDone
      ? `\nمكالمة الـ AI الصوتية: العميل أجرى المكالمة. ملخصها: ${conversation.ai_call_summary || '-'}. لا تعرض مكالمة جديدة إلا إذا طلبها.\n`
      : `
مكالمة صوتية مع مساعد atlead (المرحلة الأولى قبل اجتماع المهندس):
- لما يبين العميل اهتمام حقيقي (سأل عن التفاصيل أو الأسعار أو طريقة العمل، أو بده استشارة أو اجتماع): اعرض عليه مكالمة صوتية قصيرة (حوالي 10 دقائق) مع مساعد atlead الذكي، يقدر يدخلها هلق أو بأي وقت يناسبه من رابط، بنفهم فيها شغله واحتياجه وبعدها بنحجزله اجتماع مع المهندس.
- لما تعرض المكالمة ضع "offer_ai_call": true — النظام يضيف رابط المكالمة لآخر ردك تلقائياً. لا تكتب أي رابط بنفسك.
- إذا رفض المكالمة وبده المهندس مباشرة، كمّل بحجز موعد المهندس كالعادة.
${conversation.ai_call_status === 'offered' ? '- العميل وصله رابط المكالمة سابقاً؛ إذا طلبه مرة ثانية ضع "offer_ai_call": true.\n' : ''}`;
    const userPrompt = `
الرسالة الجديدة من العميل: "${incomingMessage}"

بيانات العميل المحفوظة (ذاكرة من المحادثات السابقة):
- القناة: ${conversation.channel}
- الاسم: ${this.realName(conversation.customer_name) || 'غير معروف (لا تناديه باسم)'}
- رقم الهاتف: ${conversation.customer_phone || 'غير مسجل'}
- نوع النشاط: ${conversation.business_type || 'غير معروف'}
- طلبات العميل السابقة: ${conversation.customer_requests || 'لا يوجد'}
- المشكلة: ${conversation.identified_problem || 'غير محددة'}
- الحل المقترح: ${conversation.proposed_solution || 'غير محدد'}
- التردد/الاعتراضات: ${conversation.objections || 'لا يوجد'}
- ملخص ما حصل: ${conversation.customer_summary || 'محادثة جديدة'}
- مرحلة العميل السابقة: ${conversation.lead_stage || 'new'}
- نسبة الشراء السابقة: ${Number(conversation.interest_score) || 0}%
${daysSince >= 1 ? `- ملاحظة: العميل راجع بعد ${daysSince} يوم من آخر رسالة — كمّل معه من وين ما وقفتوا.` : ''}
${conversation.handoff_at ? `- مهم: العميل تحوّل لموظف المبيعات${conversation.assigned_to_name ? ` (${conversation.assigned_to_name})` : ''} وبانتظار تواصله. لا تعيد رسالة التحويل${calendarBlock ? '' : ' ولا تعطِ موعداً جديداً'}. جاوب على سؤاله من المرجع فقط، وإذا سأل متى رح يتواصلوا معه قل إن الموظف سيتواصل معه قريباً.` : ''}

قم بتحليل الرسالة، وتوليد الرد المناسب حسب قواعد atlead الدقيقة، وتحديد حالة العميل وتصنيفه، وما إذا وصل لمرحلة الديل/التحويل للبشري.
إذا طلب العميل رابطاً أو مثالاً أو ملفاً أو تفاصيل عن مشروع سابق، ابحث في المرجع الرسمي عن الرابط/الملف المطابق وانسخه كما هو في الرد. لا تستبدل الرابط برد عام، ولا تذكر GitHub كمصدر؛ المصدر التشغيلي هو Supabase knowledge_docs.

قواعد إلزامية لهذا الرد:
1. اللغة: رد بنفس لغة آخر رسالة من العميل. إذا كتب إنجليزي → رد كامل بالإنجليزي (reply_text بالإنجليزي). إذا كتب عربي → رد بلهجة أردنية. لا تخلط اللغتين.
2. الأعمال السابقة / Portfolio: إذا سأل عن أعمالكم أو مشاريع أو أمثلة أو رابط، اعرض 2-4 مشاريع من ملف البورتفوليو الأقرب لمجال العميل، لكل مشروع: الاسم + سطر عن شو انعمل + النتيجة إن وجدت + الرابط كما هو بالملف مع https:// (مثل https://agsco.shop). لا تخترع مشاريع أو روابط غير موجودة بالملف.
3. الصور: إذا الرسالة فيها "[صورة من العميل: ...]" فهذا وصف لصورة بعتها العميل؛ تعامل مع محتواها مباشرة (مثلاً سكرين شوت مشكلة، منتج، عرض سعر) واسأله سؤال مفيد عنها.
4. الفويس: الرسائل الصوتية بتوصلك مكتوبة (تفريغ للكلام)؛ رد عليها نصياً كأنها رسالة مكتوبة.
5. ردك مختصر وواضح (2-5 جمل)، جاوب السؤال أولاً، وبعدين سؤال واحد بس لفهم احتياجه.
6. التنسيق: الرد بيوصل على واتساب/إنستغرام/ماسنجر — لا تستخدم Markdown (لا [نص](رابط) ولا ** ولا #). اكتب الرابط كامل لحاله مثل https://agsco.shop
7. لا تخمّن أبداً: جاوب فقط من المرجع الرسمي وبيانات العميل. إذا المعلومة مش موجودة بالمرجع، قل بوضوح إنها بدها تأكيد من الفريق واعرض إنهم يتواصلوا معه — لا تخترع.
8. الأرقام: ممنوع تذكر أي رقم (سعر، تكلفة، نسبة، مدة تنفيذ، عدد عملاء، نتائج) إلا إذا كان مكتوب حرفياً بالمرجع. الأسعار تحديداً: لا سعر ولا رينج ولا "يبدأ من" — السعر بيتحدد بعد الاستشارة المجانية.
${callBlock}${calendarBlock}${!calendarBlock && !callOn && !conversation.requested_meeting_time ? `
طلب استشارة أو اجتماع (التقويم غير مربوط حالياً):
- إذا طلب العميل استشارة أو اجتماع أو موعد: رحّب بطلبه واسأله سؤالاً واحداً: أي يوم ووقت بناسبه؟ وضع "scheduling": true (بدون تحويل للموظف بعد).
- لما يحدد يوم أو وقت: ضع "requested_time": "اليوم والوقت كما قاله العميل" — النظام يسجّل الطلب ويبلّغ الفريق ليأكد الموعد معه. لا تقل إن الموعد تأكد.
` : ''}
أعد النتيجة بصيغة JSON حصراً.
${lang === 'en' ? `
IMPORTANT: The customer's last message is in ENGLISH. Write "reply_text" entirely in English (professional, friendly). Do not use Arabic in reply_text.` : ''}
`;

    // AI agent: answers from the company files (in the system prompt), with failover across keys.
    try {
      const { text } = await this.chatWithFailover(systemPrompt, history, userPrompt, { json: true });
      let result = this.cleanAndParseJson(text);
      // Language guard: an English message must get an English reply. One strict retry.
      if (lang === 'en' && /[؀-ۿ]/.test(result.reply_text || '')) {
        try {
          const retry = await this.chatWithFailover(systemPrompt, history,
            `${userPrompt}

Your previous answer was in Arabic. The customer writes in English — return the same JSON with reply_text written ONLY in English.`,
            { json: true });
          const r2 = this.cleanAndParseJson(retry.text);
          if (r2.reply_text && !/[؀-ۿ]/.test(r2.reply_text)) result = r2;
        } catch { /* keep the first answer */ }
      }
      result.reply_text = this.toPlainText(result.reply_text);
      // Grounding check: no invented prices or numbers.
      // Facts the bot may quote: the company files (no PDF page markers) + what the customer said.
      const groundSrc = [knowledgeService.groundingText(), incomingMessage, ...history.map(h => h.text)].join('\n');
      const check = this.ungroundedNumbers(result.reply_text, groundSrc);
      if (check.price || check.numbers.length) {
        console.warn(`[AI] Ungrounded ${check.price ? 'price' : 'numbers'} in reply (${check.numbers.join(', ')}) — rewriting.`);
        let fixed = null;
        if (!check.price) {
          try {
            const retry = await this.chatWithFailover(systemPrompt, history, `${userPrompt}

ردك السابق ذكر هاي الأرقام وهي مش موجودة بالمرجع: ${check.numbers.join('، ')}. أعد نفس الـ JSON بدون أي رقم مش مكتوب بالمرجع.`, { json: true });
            const r2 = this.cleanAndParseJson(retry.text);
            r2.reply_text = this.toPlainText(r2.reply_text);
            const c2 = this.ungroundedNumbers(r2.reply_text, groundSrc);
            if (!c2.price && !c2.numbers.length) fixed = r2;
          } catch { /* fall through to the safe answer */ }
        }
        if (fixed) result = fixed;
        else result.reply_text = this.safeAnswer(check.price ? 'price' : 'unknown', lang, conversation);
        result.grounding_fixed = true;
      }
      // The voice call link (a private page on this site).
      if (callOn && !callDone && result.offer_ai_call) {
        const session = callService.createSession(conversation);
        result.reply_text = `${result.reply_text}\n\n${lang === 'en' ? 'Call link' : 'رابط المكالمة'}: ${callService.publicUrl(session.token)}`;
        result.ai_call_offered = true;
        result.scheduling = true; // not a handoff yet: the call comes first
      }
      // No calendar and no AI call: never jump straight to the handoff on "I want a consultation".
      // Ask for the customer's preferred time first, record it, then the team confirms it.
      if (!calendarBlock && !callOn && !conversation.requested_meeting_time) {
        // Real booking requests only ("we get 50 appointments a week" is not one).
        const wantsMeeting = /(احجز|أحجز|نحجز|حجز (موعد|استشار|اجتماع|مكالم)|(بدي|بدنا|ممكن|حابب|بحب) (موعد|استشار|اجتماع|مكالم|أحكي مع المهندس)|استشار[ةه] مجاني[ةه]|موعد مع المهندس|\bbook (a|an|the)\b|\bschedule (a|an)\b|appointment with|meeting with|free consultation|\bbook\b.*\b(meeting|call|consultation|appointment)\b)/i.test(incomingMessage);
        const lastBot = [...(conversation.messages || [])].reverse().find(m => m.sender === 'bot')?.content || '';
        const askedTime = /(أي يوم|اي يوم|أي وقت|اي وقت|يوم ووقت|الوقت اللي|which day|what time|which time|when suits|when works)/i.test(lastBot);
        const saysTime = /(\d{1,2}(:\d{2})?|بكرا|بكره|بعد بكرا|اليوم|الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت|الصبح|الظهر|العصر|المسا|بالليل|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|am|pm)/i.test(incomingMessage);
        if (!result.requested_time && askedTime && saysTime) result.requested_time = String(incomingMessage).trim().slice(0, 120);
        if (result.requested_time) {
          result.reply_text = lang === 'en'
            ? `Thank you! I have noted your request for a free consultation: ${result.requested_time}. Our team will contact you shortly to confirm the time.`
            : `تمام، سجّلت طلبك للاستشارة المجانية: ${result.requested_time}. فريقنا رح يتواصل معك قريباً لتأكيد الموعد.`;
          result.handoff_triggered = true;
          result.consultation_requested = true;
        } else if (wantsMeeting) {
          result.scheduling = true; // keep the conversation going: no generic handoff message
          if (!/[?؟]/.test(result.reply_text || '') || !/(يوم|وقت|day|time)/i.test(result.reply_text || '')) {
            result.reply_text = lang === 'en'
              ? 'Happy to arrange a free consultation for you. Which day and time suit you best?'
              : 'أكيد، بنرتبلك استشارة مجانية. أي يوم ووقت بناسبوك؟';
          }
        }
      }
      // Booking safety net (does not rely on the model remembering):
      if (calendarBlock) {
        const lastBot = [...(conversation.messages || [])].reverse().find(m => m.sender === 'bot')?.content || '';
        // 1) The customer picked one of the times we just offered (or gave an exact date and time) → book it.
        const choice = calendarService.choiceFrom(incomingMessage, lastBot);
        if (!result.book_start && choice) result.book_start = choice;
        // 2) While a time is being agreed, the generic handoff message must not cut in.
        if (calendarService.offeredIn(lastBot).length || calendarService.offeredIn(result.reply_text).length) result.scheduling = true;
        // 3) The model may never claim a booking that did not happen.
        if (!result.book_start && /(تم|رح)\s*(حجز|تأكيد|أحجز|أكد)|حجزت(لك|لك)?|حجزتلك|is (booked|confirmed)|I(?:'| ha)ve booked|booking (is )?confirmed/i.test(result.reply_text || '')) {
          const s = await calendarService.suggestions(3, null, calendarService.mockFor(conversation)).catch(() => []);
          result.reply_text = s.length
            ? (lang === 'en' ? `Which of these times suits you: ${s.map(d => calendarService.label(d, 'en')).join(', ')}?` : `أي وقت من هدول بناسبك: ${s.map(d => calendarService.label(d, 'ar')).join('، ')}؟`)
            : (lang === 'en' ? 'Our team will contact you to fix the meeting time.' : 'رح يتواصل معك فريقنا لتحديد موعد الاجتماع.');
          result.scheduling = true;
        }
      }
      // The customer confirmed a time: book it for real (re-checked against the calendar).
      if (calendarBlock && result.book_start) {
        const booking = await calendarService.book({ start: result.book_start, conv: conversation, lang });
        result.reply_text = booking.reply;
        if (booking.ok) {
          result.appointment = booking.appointment;
          result.consultation_requested = true;
          result.scheduling = false;
        } else {
          result.scheduling = true;
        }
      }
      return { ...result, source: 'ai' };
    } catch (err) {
      if (err.message !== 'NO_AI_KEY') console.error('[AI] All providers failed — using the knowledge-file fallback.');
    }

    // Last resort (no working AI key): approved answers from the company files, never repeated.
    return { ...this.ruleBasedReply(conversation, incomingMessage), source: 'fallback' };
  }

  /**
   * Numbers in a reply that are not backed by the company files or the conversation.
   * price = a money amount (currency word/sign next to a number) that the files don't contain.
   */
  ungroundedNumbers(reply, source) {
    const toLatin = (t) => String(t || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    const text = toLatin(reply).replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b\d{1,2}:\d{2}\b/g, ' ') // clock times
      .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ') // dates like 16/11
      .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ');
    const src = toLatin(source);
    const known = new Set((src.match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,.]+$/, '').replace(/,/g, '')));
    const currency = /(دينار|دنانير|دولار|ريال|درهم|يورو|ليرة|JD|JOD|USD|SAR|AED|EUR|\$|€|£)/i;
    const out = [];
    let price = false;
    const re = /(\$|€|£)?\s?(\d[\d,.]*)\s*(%|٪|ألف|الف|k|K|دينار|دنانير|دولار|ريال|درهم|يورو|ليرة|JD|JOD|USD|SAR|AED|EUR)?/g;
    let m;
    while ((m = re.exec(text))) {
      const n = m[2].replace(/[,.]+$/, '').replace(/,/g, '');
      const unit = (m[1] || '') + (m[3] || '');
      const isPhone = n.replace(/\D/g, '').length >= 7;
      if (isPhone || (n.length < 2 && !unit)) continue; // phone numbers and single digits ("سؤال واحد", "3 خطوات") are fine
      if (known.has(n)) continue;
      out.push(m[0].trim());
      if (unit && currency.test(unit)) price = true;
    }
    // Words that announce a price next to any unknown number ("السعر 500", "بتكلف 300").
    if (!price && out.length && /(سعر|أسعار|اسعار|تكلف|بتكلف|كلفة|باقة|اشتراك|price|cost|package|plan)/i.test(text)) price = true;
    return { price, numbers: [...new Set(out)] };
  }

  /** Safe answers when the AI tried to invent something. */
  safeAnswer(kind, lang = 'ar', conversation = {}) {
    if (kind === 'price') {
      if (lang === 'en') return 'Every system we build is tailored to your business, so we don\'t quote fixed prices in chat. The first step is a free 30-minute online consultation where we understand your needs and give you an exact plan and cost. What kind of business do you run?';
      const faq = knowledgeService.findFaqAnswer('كم السعر');
      return faq?.a || 'كل نظام بنبنيه بيكون مخصص حسب احتياج شغلك، لهيك ما بنعطي أسعار بالشات. أول خطوة جلسة استشارة مجانية (30 دقيقة أونلاين) بنفهم فيها احتياجك وبنعطيك خطة وتكلفة دقيقة. شو نوع شغلك؟';
    }
    if (lang === 'en') return 'I don\'t have that detail confirmed right now, and I\'d rather not guess. I can have our team get back to you with the exact information — would that work for you?';
    return 'هاي المعلومة مش متوفرة عندي بدقة حالياً وما بدي أعطيك معلومة غير مؤكدة. بقدر أخلي الفريق يتواصل معك ويعطيك التفاصيل الدقيقة، بناسبك؟';
  }

  cleanAndParseJson(text) {
    try {
      if (!text) throw new Error('Empty response');
      // Remove any markdown code fence if present
      let cleaned = text.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);
      return {
        reply_text: parsed.reply_text || 'أهلاً بك في atlead! كيف نقدر نساعدك اليوم؟',
        identified_problem: parsed.identified_problem || null,
        proposed_solution: parsed.proposed_solution || null,
        lead_stage: parsed.lead_stage || 'discovery',
        classification: parsed.classification || 'Warm',
        buying_probability: parsed.buying_probability || 40,
        handoff_triggered: !!parsed.handoff_triggered,
        customer_name: parsed.customer_name || null,
        customer_phone: parsed.customer_phone || null,
        business_type: parsed.business_type || null,
        customer_requests: parsed.customer_requests
          ? (Array.isArray(parsed.customer_requests) ? parsed.customer_requests.join('، ') : String(parsed.customer_requests))
          : null,
        customer_summary: parsed.customer_summary || null,
        objections: parsed.objections || null,
        company_name: parsed.company_name || null,
        customer_email: parsed.customer_email || null,
        consultation_requested: parsed.consultation_requested === true,
        demo_requested: parsed.demo_requested === true,
        scheduling: parsed.scheduling === true,
        offer_ai_call: parsed.offer_ai_call === true,
        requested_time: typeof parsed.requested_time === 'string' && parsed.requested_time.trim() ? parsed.requested_time.trim().slice(0, 120) : null,
        book_start: typeof parsed.book_start === 'string' && parsed.book_start.trim() ? parsed.book_start.trim() : null
      };
    } catch (e) {
      console.warn('Failed to parse AI JSON, using fallback parser:', e.message);
      return {
        reply_text: text || 'أهلاً وسهلاً بك في شركة atlead، كيف بقدر أساعدك اليوم في تطوير مبيعات شركتك؟',
        identified_problem: null,
        proposed_solution: null,
        lead_stage: 'discovery',
        classification: 'Warm',
        buying_probability: 45,
        handoff_triggered: false,
        customer_name: null,
        customer_phone: null
      };
    }
  }

  // Intelligent fallback engine when AI keys are not yet provided
  ruleBasedReply(conversation, text) {
    const t = normalizeArabic(text);
    const settings = storageService.getSettings();
    const handoffMsg = settings.handoff?.handoff_message || 
      'تمام، م. مهند من قسم المبيعات في شركة atlead رح يتواصل معك بأسرع وقت لمتابعة كافة التفاصيل وترتيب كل شيء معك. شكراً لاهتمامك وثقتك.';

    // Check deal / agreement triggers
    const agreementTriggers = [
      'اتفقنا', 'موافق', 'احجزلي', 'بدي احجز', 'حابب احجز', 'بدي استشاره', 'بدي ديمو', 'demo', 'جاهز اشتري',
      'بدي اشتري', 'بدي اشترك', 'بدي ابدا', 'خلينا نبدا', 'رقم الحساب', 'العقد', 'ابعتلي العقد', 'تواصلوا معي',
      'كلموني', 'اتصلوا فيي', 'مهند', 'بدي احكي مع حدا', 'بدي احكي مع موظف', 'شخص حقيقي', 'نرتب موعد', 'بدي موعد'
    ];
    if (agreementTriggers.some(trigger => t.includes(trigger))) {
      return {
        reply_text: handoffMsg,
        identified_problem: 'طلب موعد استشارة / جاهزية للاتفاق',
        proposed_solution: 'AI Sales Systems Implementation',
        lead_stage: 'deal_closing',
        classification: 'Hot',
        buying_probability: 95,
        handoff_triggered: true,
        customer_name: null,
        customer_phone: null
      };
    }

    // Replies this bot already sent in this conversation — never send the same one twice.
    const sentReplies = (conversation.messages || [])
      .filter(m => m.sender !== 'customer' && m.sender !== 'agent')
      .map(m => m.content || '');
    const alreadySent = (reply) => sentReplies.some(s => normalizeArabic(s) === normalizeArabic(reply));
    const base = {
      identified_problem: null,
      proposed_solution: null,
      lead_stage: 'discovery',
      classification: 'Warm',
      buying_probability: 40,
      handoff_triggered: false
    };

    // Answer from the company knowledge files (approved FAQ).
    const faq = knowledgeService.findFaqAnswer(text, { exclude: sentReplies });
    if (faq) {
      const pricing = /سعر|تكلف|كلفه|price|cost/.test(normalizeArabic(faq.q));
      return {
        ...base,
        reply_text: faq.a,
        identified_problem: pricing ? 'استفسار عن الأسعار' : faq.q,
        proposed_solution: pricing ? 'جلسة استشارة مجانية لتحديد الحل والتكلفة' : null,
        buying_probability: pricing ? 55 : 45
      };
    }

    // First message: welcome.
    const welcome = 'أهلاً وسهلاً! معك المساعد الذكي من atlead. إحنا بنبني أنظمة مبيعات ذكية ومخصصة للشركات. شو نوع شغلك، وشو أكتر شي بيتعبك بالمبيعات أو بمتابعة العملاء؟';
    if (!sentReplies.length && !alreadySent(welcome)) {
      return { ...base, reply_text: welcome, lead_stage: 'new', classification: 'Cold', buying_probability: 30 };
    }

    // Otherwise: a discovery question / honest "not available" — rotate so nothing repeats.
    const options = [
      'تمام، خليني أفهمك أكتر: شو نوع شغلك، وكم استفسار تقريباً بيوصلكم بالأسبوع؟',
      'فهمت عليك. شو أكتر جزء بيتعبك هسا: الرد على العملاء، المتابعة معهم، ولا تنظيم بياناتهم؟',
      'هاي المعلومة مش متوفرة عندي بدقة حالياً حتى أجاوبك بشكل كامل، بس بقدر أخلي فريق atlead يتواصل معك ويعطيك كل التفاصيل. حابب أرتبلك هالشي؟',
      'على أي قناة بيوصلكم أغلب العملاء: واتساب، إنستغرام، فيسبوك، ولا الموقع؟',
      'إذا حابب، بنقدر نرتبلك جلسة استشارة مجانية 30 دقيقة أونلاين مع الفريق نفهم فيها احتياجك ونعطيك خطة وتكلفة دقيقة. شو رأيك؟'
    ];
    const isGreeting = /^(مرحبا|مرحب|هلا|اهلا|اهلين|السلام|سلام|مسا|صباح|hi|hello|hey|هاي)/.test(t);
    const next = options.find(o => !alreadySent(o) && !(isGreeting && o.includes('مش متوفرة')));
    if (next) return { ...base, reply_text: next };
    return {
      ...base,
      reply_text: 'خليني أحول سؤالك لفريق atlead عشان يجاوبك بدقة. ممكن تبعتلي رقمك وأفضل وقت للتواصل؟',
      buying_probability: 50
    };
  }

  // Audio transcription (Voice notes - الفويسّات)
  async transcribeAudio(audioFilePath, mimeType = 'audio/ogg') {
    let audioBuffer;
    try {
      audioBuffer = fs.readFileSync(audioFilePath);
    } catch {
      return null;
    }
    const prompt = 'أنت خبير تفريغ صوتي دقيق للغة العربية واللهجة الأردنية. قم بتفريغ هذا التسجيل الصوتي بدقة تامة واكتب النص المنطوق فقط بدون أي مقدمات أو تعليقات إضافية:';
    for (const p of this.getProviders()) {
      try {
        if (p.type === 'gemini') {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${p.key}`;
          const res = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: audioBuffer.toString('base64') } }] }]
          }, { timeout: 35000 });
          const t = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (t) return t;
        } else if (p.type === 'openrouter') {
          // Audio input through OpenRouter (Gemini understands voice notes well).
          const fmt = /mpeg|mp3/.test(mimeType) ? 'mp3' : /wav/.test(mimeType) ? 'wav' : /mp4|m4a|aac/.test(mimeType) ? 'm4a' : 'ogg';
          const res = await axios.post(`${OPENAI_COMPATIBLE.openrouter.base}/chat/completions`, {
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format: fmt } }
            ] }]
          }, { headers: { Authorization: `Bearer ${p.key}` }, timeout: 40000 });
          const t = String(res.data?.choices?.[0]?.message?.content || '').trim();
          if (t) return t;
        } else if (p.type === 'openai' || p.type === 'groq') {
          const form = new FormData();
          const ext = (mimeType.split('/')[1] || 'ogg').split(';')[0];
          form.append('file', new Blob([audioBuffer], { type: mimeType }), `voice.${ext === 'mpeg' ? 'mp3' : ext}`);
          form.append('model', p.type === 'groq' ? 'whisper-large-v3' : 'whisper-1');
          form.append('language', 'ar');
          const res = await axios.post(`${OPENAI_COMPATIBLE[p.type].base}/audio/transcriptions`, form, {
            headers: { Authorization: `Bearer ${p.key}` }, timeout: 35000
          });
          const t = String(res.data?.text || '').trim();
          if (t) return t;
        }
      } catch (err) {
        console.error(`[AI] ${p.label} transcription failed:`, err.response?.data?.error?.message || err.message);
      }
    }
    // No transcription engine available: don't invent content, just flag it.
    return null;
  }

  /**
   * Understand an image the customer sent (screenshot, product photo, document...).
   * Returns a short Arabic description, or null if no vision-capable key / disabled.
   */
  async describeImage(filePath, mimeType = 'image/jpeg') {
    const aiConfig = storageService.getSettings().ai || {};
    if (aiConfig.image_understanding_enabled === false) return null;
    let buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch {
      return null;
    }
    if (buffer.length > 7 * 1024 * 1024) return null; // too big for inline upload
    const prompt = 'العميل بعث هذه الصورة بمحادثة مبيعات. صف محتواها باختصار (جملتين كحد أقصى) بالعربي: شو بتعرض؟ وإذا فيها نص أو أرقام مهمة أو رسالة خطأ اكتبها. بدون مقدمات.';
    const base64 = buffer.toString('base64');
    const mime = /^image\/(jpeg|png|webp|gif)$/.test(mimeType) ? mimeType : 'image/jpeg';

    for (const p of this.getProviders()) {
      try {
        let text = '';
        if (p.type === 'gemini') {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${p.key}`;
          const res = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }]
          }, { timeout: 30000 });
          text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        } else if (p.type === 'anthropic') {
          const res = await axios.post('https://api.anthropic.com/v1/messages', {
            model: p.model,
            max_tokens: 300,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
              { type: 'text', text: prompt }
            ] }]
          }, { headers: { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' }, timeout: 30000 });
          text = (res.data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        } else if (p.type === 'openai' || p.type === 'openrouter') {
          const res = await axios.post(`${OPENAI_COMPATIBLE[p.type].base}/chat/completions`, {
            model: p.model,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] }],
            max_tokens: 200
          }, { headers: { Authorization: `Bearer ${p.key}` }, timeout: 30000 });
          text = res.data?.choices?.[0]?.message?.content;
        }
        if (String(text || '').trim()) return String(text).trim();
      } catch (err) {
        console.error(`[AI] ${p.label} image failed:`, err.response?.data?.error?.message || err.message);
      }
    }
    return null;
  }

  // Builds the text the bot "sees" for an image message.
  imageMessageText(caption, description) {
    const parts = [];
    if (caption) parts.push(caption);
    parts.push(description ? `[صورة من العميل: ${description}]` : '[العميل بعث صورة]');
    return parts.join('\n');
  }

  /**
   * Look at images and answer in JSON (used to learn the page's visual identity).
   * images = data URLs. Tries every configured provider that can read images.
   */
  async visionJson(system, prompt, images = [], { timeout = 90000 } = {}) {
    let lastErr = new Error('NO_AI_KEY');
    for (const p of this.getProviders()) {
      try {
        let text = '';
        if (p.type === 'gemini') {
          const parts = [{ text: prompt }, ...images.map(u => ({ inline_data: { mime_type: u.slice(5, u.indexOf(';')), data: u.split(',')[1] } }))];
          const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent?key=${p.key}`, {
            systemInstruction: { parts: [{ text: system }] }, contents: [{ parts }],
            generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
          }, { timeout });
          text = res.data?.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') || '';
        } else if (p.type === 'anthropic') {
          const res = await axios.post('https://api.anthropic.com/v1/messages', {
            model: p.model, max_tokens: 2500, temperature: 0.3, system: `${system}\n\nأعد JSON صالح فقط.`,
            messages: [{ role: 'user', content: [
              ...images.map(u => ({ type: 'image', source: { type: 'base64', media_type: u.slice(5, u.indexOf(';')), data: u.split(',')[1] } })),
              { type: 'text', text: prompt }
            ] }]
          }, { headers: { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' }, timeout });
          text = (res.data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        } else if (p.type === 'openai' || p.type === 'openrouter') {
          const res = await axios.post(`${OPENAI_COMPATIBLE[p.type].base}/chat/completions`, {
            model: p.model, temperature: 0.3, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: [
              { type: 'text', text: prompt }, ...images.map(u => ({ type: 'image_url', image_url: { url: u } }))
            ] }]
          }, { headers: { Authorization: `Bearer ${p.key}` }, timeout });
          text = res.data?.choices?.[0]?.message?.content || '';
        } else continue;
        let c = String(text).trim().replace(/^```(json)?/, '').replace(/```$/, '').trim();
        const a = c.indexOf('{'); const b = c.lastIndexOf('}');
        if (a >= 0 && b > a) c = c.slice(a, b + 1);
        return JSON.parse(c);
      } catch (err) {
        lastErr = err;
        console.error(`[AI] ${p.label} vision failed:`, err.response?.data?.error?.message || err.message);
      }
    }
    throw lastErr;
  }

  /**
   * OpenRouter balance straight from OpenRouter: account credits/usage and this key's own limit.
   * Returns null when there is no OpenRouter key.
   */
  async openRouterBalance() {
    const p = this.getProviders().find(x => x.type === 'openrouter');
    if (!p) return null;
    const get = (path) => axios.get(`https://openrouter.ai/api/v1/${path}`, { headers: { Authorization: `Bearer ${p.key}` }, timeout: 15000 }).then(r => r.data?.data);
    const [credits, key] = await Promise.all([get('credits').catch(e => ({ error: e.response?.data?.error?.message || e.message })), get('key').catch(() => null)]);
    const total = Number(credits?.total_credits);
    const used = Number(credits?.total_usage);
    return {
      account_remaining: Number.isFinite(total - used) ? Math.round((total - used) * 100) / 100 : null,
      account_total: Number.isFinite(total) ? total : null,
      key_limit: key?.limit ?? null,
      key_remaining: key?.limit_remaining ?? null,
      key_label: key?.label || '',
      error: credits?.error || null
    };
  }

  // Generic "give me JSON" call used for comment analysis.
  async callJson(systemPrompt, userPrompt) {
    if (!this.getProviders().length) return null;
    const { text } = await this.chatWithFailover(systemPrompt, [], userPrompt, { json: true, temperature: 0.4, timeout: 20000 });
    let c = String(text || '').trim().replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
    const start = c.indexOf('{'); const end = c.lastIndexOf('}');
    if (start > 0 || (end >= 0 && end < c.length - 1)) c = c.slice(start, end + 1);
    return JSON.parse(c);
  }

  async analyzeComment(commentText, { userName = '', platform = 'facebook' } = {}) {
    const settings = storageService.getSettings();
    const metaConfig = settings.meta || {};

    // 1. AI analysis (when an API key is configured)
    try {
      const kb = knowledgeService.getSystemPrompt();
      const system = `${kb}

أنت الآن ترد على تعليق عام على منشور ${platform === 'instagram' ? 'إنستغرام' : 'فيسبوك'} لشركة atlead.
القواعد:
- إذا كان التعليق استفساراً عن الشغل أو الخدمات أو الأسعار أو طلب تفاصيل أو تواصل: is_interested = true.
  - public_reply: رد عام قصير ولطيف باللهجة الأردنية يقول له إننا رح نتواصل معه على الخاص (لا تذكر أسعار أو تفاصيل في الرد العام).
  - auto_dm: أول رسالة خاصة نبعثها له، ترحب به وتجاوب على استفساره باختصار وتسأله سؤال استكشافي واحد عن شغله.
- إذا كان التعليق مجرد تفاعل (شكر، إعجاب، منشن لصديق، إيموجي): is_interested = false، و public_reply رد شكر قصير، و auto_dm فارغ.
- إذا كان التعليق سلبياً أو سباماً: is_interested = false، sentiment = "negative"، public_reply رد مهذب جداً أو فارغ.
أعد JSON فقط بالشكل: {"is_interested": bool, "sentiment": "interested|neutral|negative|inquiry", "public_reply": "...", "auto_dm": "..."}`;
      const result = await this.callJson(system, `اسم المعلّق: ${userName || 'غير معروف'}\nنص التعليق: "${commentText}"`);
      if (result && typeof result.is_interested === 'boolean') {
        return {
          is_interested: result.is_interested,
          sentiment: result.sentiment || (result.is_interested ? 'interested' : 'neutral'),
          public_reply: result.public_reply || '',
          auto_dm: result.auto_dm || metaConfig.auto_dm_template || ''
        };
      }
    } catch (err) {
      console.warn('AI comment analysis failed, using keyword fallback:', err.response?.data?.error?.message || err.message);
    }

    // 2. Keyword fallback
    const lower = (commentText || '').toLowerCase();

    // Keywords that show commercial interest or inquiry
    const interestKeywords = [
      'سعر', 'اسعار', 'بكم', 'تفاصيل', 'مهتم', 'كم', 'حجز', 'تواصل', 
      'شراء', 'خدمة', 'عرض', 'شات بوت', 'سيستم', 'واتساب', 'demo', 
      'price', 'cost', 'interested', 'details', 'how much', 'info'
    ];

    const isInterested = interestKeywords.some(kw => lower.includes(kw));

    const publicReply = isInterested
      ? metaConfig.comment_reply_template || 'أهلاً بك! تم إرسال كافة التفاصيل ورابط التواصل على الخاص (DM) لخدمتك بأفضل شكل 🚀'
      : 'شكراً لتعليقك وتفاعلك معنا في atlead! يسعدنا دائماً تواصلكم.';

    const privateDm = metaConfig.auto_dm_template || 
      'أهلاً وسهلاً بك! لاحظنا اهتمامك بتطوير أنظمة المبيعات الذكية لشركتك. معك المساعد الذكي من شركة atlead، كيف نقدر نساعدك ونطور مبيعاتك اليوم؟';

    return {
      is_interested: isInterested,
      sentiment: isInterested ? 'interested' : 'neutral',
      public_reply: publicReply,
      auto_dm: privateDm
    };
  }
}

module.exports = new AiService();
