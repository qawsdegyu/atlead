/**
 * AI voice call (qualification stage before the engineer).
 *
 * 1. In chat, when the customer is interested, the bot offers a short voice call and sends a
 *    private link: /call/<token> (a branded page on this site, opens on any phone or laptop).
 * 2. On that page the customer talks by voice with the AI (OpenAI Realtime over WebRTC, or
 *    browser speech recognition/synthesis in fallback mode; only transcript and bounded speech
 *    estimates are persisted, never a raw recording).
 * 3. The AI asks the qualification questions, answers only from the company files, and when the
 *    customer wants to go ahead it books the engineer meeting in Google Calendar (tools below).
 * 4. When the call ends, the whole transcript is analysed: every detail the customer gave is saved
 *    on the customer (dashboard, Supabase, Google Sheets), the team is told, and the customer gets
 *    a written summary in the chat.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const storageService = require('./storageService');

const FILE = path.join(storageService.getDataDir(), 'calls.json');
const KEEP = 400;
const MAX_STARTS = 5; // reconnects per link
const IDLE_FINISH_MS = 15 * 60000; // a call left open without activity is closed and analysed

const DEFAULTS = {
  enabled: false,
  model: 'gpt-4o-mini-realtime-preview',
  voice: 'coral',
  max_minutes: 15,
  link_days: 7,
  extra_questions: ''
};
const FALLBACK_MODELS = [
  'gpt-4o-mini-realtime-preview',
  'gpt-4o-realtime-preview',
  'gpt-4o-realtime-preview-2024-12-17',
  'gpt-4o-realtime-preview-2024-10-01',
  'gpt-realtime-2.1'
];

// Everything the analysis can learn about the customer → saved on the conversation.
const PROFILE_FIELDS = ['company_name', 'job_title', 'location', 'business_type', 'team_size', 'monthly_volume',
  'channels_used', 'current_tools', 'goals', 'budget', 'timeline', 'decision_maker'];

function speechWordCount(text) {
  return String(text || '').trim().split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

// Only accept bounded, aggregate client measurements. ASR confidence is available in some browser
// engines, but is not a pronunciation score; realtime mode deliberately has no confidence value.
function normalizeSpeechReview(text, input, mode) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const words = speechWordCount(text);
  const rawDuration = Number(input.speech_duration_ms);
  const duration = Number.isFinite(rawDuration) && rawDuration >= 300 && rawDuration <= 120000 ? Math.round(rawDuration) : null;
  const rawConfidence = input.asr_confidence === null || input.asr_confidence === undefined || input.asr_confidence === '' ? NaN : Number(input.asr_confidence);
  const confidence = mode === 'browser' && Number.isFinite(rawConfidence) && rawConfidence >= 0 && rawConfidence <= 1
    ? Math.round(rawConfidence * 1000) / 1000 : null;
  const rawSamples = Number(input.confidence_samples);
  const confidenceSamples = confidence === null ? 0 : (Number.isFinite(rawSamples) ? Math.max(1, Math.min(50, Math.floor(rawSamples))) : 1);
  const estimated = duration && words ? Math.round(words * 60000 / duration) : null;
  const rate = estimated !== null && estimated >= 5 && estimated <= 500 ? estimated : null;
  if (rate === null && confidence === null) return null;
  return {
    version: 1,
    speech_duration_ms: duration,
    word_count: duration && words ? words : 0,
    estimated_wpm: rate,
    asr_confidence: confidence,
    confidence_samples: confidenceSamples,
    measurement_source: mode === 'browser' ? 'browser_speech_recognition' : (mode === 'realtime' ? 'realtime_vad' : 'unverified')
  };
}

function read() {
  try { return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : []; } catch { return []; }
}
function write(list) {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(0, KEEP), null, 2));
  fs.renameSync(tmp, FILE);
}

class CallService {
  getConfig() {
    const cfg = { ...DEFAULTS, ...(storageService.getSettings().ai_call || {}) };
    cfg.max_minutes = Math.min(30, Math.max(3, Number(cfg.max_minutes) || 15));
    cfg.link_days = Math.min(30, Math.max(1, Number(cfg.link_days) || 7));
    return cfg;
  }

  openRouterKey() {
    const ai = storageService.getSettings().ai || {};
    const key = ai.openrouter_api_key || process.env.OPENROUTER_API_KEY || '';
    if (key) return String(key).trim();
    const raw = String(ai.openai_api_key || '').trim();
    return /^sk-or-/i.test(raw) ? raw : '';
  }

  apiKey() {
    const key = storageService.getSettings().ai?.openai_api_key || process.env.OPENAI_API_KEY || '';
    // An OpenRouter key (sk-or-...) runs voice calls in browser voice mode, not direct OpenAI Realtime WebRTC.
    return /^sk-or-/i.test(String(key).trim()) ? '' : key;
  }

  keyProblem() {
    // OpenRouter keys are fully supported in browser voice mode.
    return null;
  }

  /**
   * How the call runs:
   *  'realtime' = OpenAI voice (natural voice, needs a real OpenAI key);
   *  'browser'  = the customer's phone does the listening and speaking, and the chat AI
   *               (OpenRouter / any configured key) runs the conversation. Works with OpenRouter.
   */
  voiceMode() {
    if (this.apiKey()) return 'realtime';
    if (this.openRouterKey()) return 'browser';
    try { return require('./aiService').getProviders().length ? 'browser' : null; } catch { return null; }
  }

  isActive() {
    return !!(this.getConfig().enabled && this.voiceMode());
  }

  all() { return read(); }
  get(token) { return read().find(s => s.token === token) || null; }
  forConversation(convId) { return read().filter(s => s.conversation_id === convId); }

  save(session) {
    const list = read();
    const i = list.findIndex(s => s.token === session.token);
    session.updated_at = new Date().toISOString();
    if (i >= 0) list[i] = session; else list.unshift(session);
    write(list);
    this.mirror();
    return session;
  }

  // Calls (with transcripts) are also kept in Supabase so a redeploy loses nothing.
  mirror() {
    clearTimeout(this._mirrorTimer);
    this._mirrorTimer = setTimeout(() => {
      require('./supabaseService').saveKv?.('ai_calls', read().slice(0, 150)).catch?.(() => {});
    }, 3000);
  }

  publicUrl(token) {
    let base = '';
    try { base = require('./socialPublisher').publicBaseUrl(); } catch { /* optional */ }
    if (!base) base = require('./notificationService').getConfig().dashboardUrl || `http://localhost:${process.env.PORT || 3000}`;
    return `${base.replace(/\/+$/, '')}/call/${token}`;
  }

  /** A call link for this customer (re-uses an open one). */
  createSession(conv, { fresh = false } = {}) {
    const cfg = this.getConfig();
    const open = fresh ? null : this.forConversation(conv.id).find(s => !['completed', 'expired'].includes(s.status) && new Date(s.expires_at) > new Date());
    if (open) return open;
    const now = Date.now();
    return this.save({
      token: crypto.randomBytes(18).toString('base64url'),
      conversation_id: conv.id,
      customer_name: conv.customer_name || '',
      channel: conv.channel,
      status: 'offered',
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + cfg.link_days * 86400000).toISOString(),
      starts: 0,
      transcript: []
    });
  }

  /** Session usable from the public page? */
  usable(token) {
    const s = this.get(token);
    if (!s) return { error: 'not_found' };
    if (s.status === 'completed') return { error: 'completed', session: s };
    if (new Date(s.expires_at) < new Date()) return { error: 'expired', session: s };
    return { session: s };
  }

  /** What the public page may show (no customer data beyond the first name). */
  publicInfo(token) {
    const { session, error } = this.usable(token);
    const cfg = this.getConfig();
    const s = session || this.get(token);
    const conv = s ? storageService.getConversationById(s.conversation_id) : null;
    const said = (conv?.messages || []).filter(m => m.sender === 'customer').slice(-3).map(m => m.content).join(' ');
    const realName = s && !/عميل|متابع|مستخدم|simulator|test|null/i.test(s.customer_name || '') ? String(s.customer_name || '').split(/\s+/)[0] : '';
    return {
      ok: !error && this.isActive(),
      error: error || (this.isActive() ? null : 'disabled'),
      name: realName,
      lang: said ? require('./aiService').detectLanguage(said) : 'ar',
      max_minutes: cfg.max_minutes,
      mode: this.voiceMode()
    };
  }

  instructions(session, conv, lang) {
    const knowledge = require('./knowledgeService');
    const cfg = this.getConfig();
    const known = [
      conv.customer_name && !/عميل|مستخدم|متابع|Simulator/i.test(conv.customer_name) ? `الاسم: ${conv.customer_name}` : '',
      conv.company_name ? `الشركة: ${conv.company_name}` : '',
      conv.business_type ? `النشاط: ${conv.business_type}` : '',
      conv.customer_requests ? `طلباته: ${conv.customer_requests}` : '',
      conv.identified_problem ? `المشكلة: ${conv.identified_problem}` : '',
      conv.customer_summary ? `ملخص المحادثة الكتابية: ${conv.customer_summary}` : '',
      conv.customer_phone ? `الهاتف: ${conv.customer_phone}` : '',
      conv.customer_email ? `البريد: ${conv.customer_email}` : ''
    ].filter(Boolean).join('\n');
    const pricing = String(knowledge.findFaqAnswer('كم السعر')?.a || 'كل نظام بيكون مخصص حسب احتياج الشغل، والسعر بيتحدد بالاجتماع مع المهندس بعد ما نفهم احتياجك.').replace(/"/g, "'").slice(0, 600);
    const calendarOn = !!session.mock_calendar || require('./calendarService').isActive();
    return `أنت مستشار مبيعات صوتي خبير لشركة atlead (أنظمة مبيعات ذكية وأتمتة للشركات) في مكالمة صوتية أونلاين مع عميل محتمل.
هدف المكالمة (حوالي ${Math.min(cfg.max_minutes, 10)} دقائق): تطبيق خوارزمية التأهيل البيعي الذكي (BANT / SPIN Framework) لتأهيل العميل بدقة وتثبيت موعد اجتماعه مع المهندس إذا كان مناسباً.

طريقة الكلام والنطق الصوتي المتقن:
- ${lang === 'en' ? 'The customer writes in English: speak English unless they switch to Arabic.' : 'احكِ باللهجة العربية البيضاء الودودة والواضحة مخارج حروفها بدقة.'}
- انطق اسم الشركة دائماً: "آت ليد" باللغة العربية (وليس بالإنجليزية) لنطق طبيعي سلس.
- انطق مصطلح AI دائماً: "الذكاء الاصطناعي".
- جمل قصيرة جداً ومباشرة (10 إلى 15 كلمة فقط) وسؤال واحد بكل مرة لتكون الاستجابة فائقة السرعة، واستمع للعميل حتى ينتهي من كلامه.

خوارزمية التأهيل البيعي التكيفية (SPIN / BANT Algorithm):
المرحلة 1: الترحيب والتهيئة (Greeting & Frame)
- رحّب بالعميل باسمه إذا كان معروفاً، وعرّف بنفسك كمساعد آت ليد الذكي، واستأذنه بدقائق بسيطة لفهم احتياجه وتجهيز ملفه للمهندس قبل الاجتماع.

المرحلة 2: فهم العمل والتحدي الرئيسي (Situation & Pain Point)
- لا تسأل عن معلومة مذكورة مسبقاً في "معلومات معروفة عن العميل" — أكّدها مباشرة (مثال: "شفت إن مجالكم تصنيع أبواب والتركيز ع تحسين الردود...").
- ركّز على معرفة أكبر مشكلة تواجهه: هل هي بطء الردود؟ ضياع العملاء بعد الحملات؟ أو كثرة الرسائل وتشتت الفريق؟

المرحلة 3: قياس حجم النشاط والجدوى (Impact & Volume)
- اسأل بلطف عن حجم الرسائل أو الاستفسارات اليومية/الشهرية، وكم شخص بالفريق يتولى الردود.
- اربط حل آت ليد بمشكلته بجملة واحدة مقنعة.

المرحلة 4: فحص الجدية وصاحب القرار (Decision & Urgency)
- اسأل بلطف عما إذا كان هو صاحب القرار أو يوجد شركاء يفضّل حضورهم بالاجتماع، ومتى يرغب بالبدء.

المرحلة 5: عرض المواعيد وحجز الاجتماع مع المهندس (Action & Booking)
- إذا العميل مهتم وجاد: اعرض عليه فكرة الاجتماع مع المهندس.
${calendarOn ? `- عند موافقته: (1) استخدم get_free_times لقراءة المواعيد المتاحة. (2) اقترح وقتين أو ثلاثة فقط من النتيجة. (3) عندما يختار وقتاً صريحاً، استخدم book_engineer_meeting بنفس الوقت. (4) أكّد له الموعد وأخبره أن رابط الاجتماع وGoogle Meet سيصله فوراً بالمحادثة.` : '- إذا التقويم غير مربوط: قل إن المهندس رح يتواصل معه لتنسيق الموعد المناسب.'}
- في ختام المكالمة: لخّص الخطوة القادمة، اشكره بود، واستخدم end_call.
${cfg.extra_questions ? `أسئلة إضافية من الإدارة:\n${cfg.extra_questions}\n` : ''}
قواعد إلزامية:
- جاوب فقط من معلومات الشركة الرسمية. إذا سأل العميل عن تفاصيل هندسية أو برمجية دقيقة قل إن المهندس يوضحها بالاجتماع.
- ممنوع تذكر أي سعر أو رقم من عندك؛ إذا سأل عن التكلفة أجب: "${pricing}" ثم انتقل لسؤالك التالي.
- تاريخ اليوم (توقيت عمّان): ${this.todayAmman()}. لا تقترح أي موعد إلا من خلال نتيجة get_free_times.

معلومات معروفة عن العميل من المحادثة:
${known || '- لا يوجد'}

معلومات الشركة الرسمية (المرجع الوحيد):
${String(knowledge.groundingText() || '').slice(0, 14000)}`;
  }

  tools() {
    return [
      {
        type: 'function', name: 'get_free_times',
        description: 'Get the free times in the engineer\'s calendar for the online meeting (Amman time).',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      {
        type: 'function', name: 'book_engineer_meeting',
        description: 'Book the online meeting with the engineer at a time the customer clearly agreed to. Use a time from get_free_times.',
        parameters: {
          type: 'object',
          properties: { start: { type: 'string', description: 'Local Amman time, format YYYY-MM-DD HH:MM' } },
          required: ['start'], additionalProperties: false
        }
      },
      {
        type: 'function', name: 'end_call',
        description: 'End the call after saying goodbye.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    ];
  }

  /**
   * Admin check: can this OpenAI key start a voice session? Returns OpenAI's own reason when not
   * (never the key). Tries each voice model, newest first.
   */
  async checkKey() {
    if (this.openRouterKey() && !this.apiKey()) {
      return { ok: true, mode: 'browser', message: 'مفتاح OpenRouter متصل ويعمل بنجاح للمكالمات الصوتية (وضع المتصفح الذكي).' };
    }
    if (this.keyProblem()) return { ok: false, mode: this.voiceMode(), message: `${this.keyProblem()}${this.voiceMode() === 'browser' ? ' إلى ذلك الحين تعمل المكالمات بصوت جهاز العميل (وضع المتصفح).' : ''}` };
    const key = this.apiKey();
    if (!key) {
      if (this.openRouterKey() || this.voiceMode() === 'browser') {
        return { ok: true, mode: 'browser', message: 'مفتاح OpenRouter متصل ويعمل بنجاح للمكالمات الصوتية (وضع المتصفح الذكي).' };
      }
      return { ok: false, message: 'لا يوجد مفتاح OpenAI أو OpenRouter.' };
    }
    const cfg = this.getConfig();
    const models = [...new Set([cfg.model, ...FALLBACK_MODELS].filter(Boolean))];
    const tried = [];
    for (const model of models) {
      try {
        await axios.post('https://api.openai.com/v1/realtime/client_secrets', {
          expires_after: { anchor: 'created_at', seconds: 10 },
          session: { type: 'realtime', model, instructions: 'test', audio: { output: { voice: cfg.voice || 'marin' } } }
        }, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 20000 });
        if (model !== cfg.model) storageService.updateSettings({ ai_call: { model } }); // remember the model that works
        return { ok: true, model, message: `مفتاح OpenAI يعمل للمكالمات الصوتية (النموذج ${model}).` };
      } catch (e) {
        const status = e.response?.status;
        const err = e.response?.data?.error || {};
        tried.push({ model, status, code: err.code || err.type || null, reason: err.message || e.message });
        if (status === 401) return { ok: false, tried, message: 'مفتاح OpenAI غير صحيح أو محذوف. أنشئ مفتاحاً جديداً من platform.openai.com ← API keys والصقه من جديد.' };
        if (status === 429 || /quota|billing|insufficient/i.test(err.message || '')) return { ok: false, tried, message: 'حساب OpenAI بدون رصيد. اشحن رصيداً من platform.openai.com ← Settings ← Billing ثم جرّب مرة أخرى.' };
        if (status === 403) return { ok: false, tried, message: `حساب OpenAI لا يملك صلاحية على نماذج الصوت: ${err.message || ''}` };
      }
    }
    return { ok: false, tried, message: `رفض OpenAI بدء المكالمة: ${tried.map(t => `${t.model}: ${t.reason}`).join(' | ')}` };
  }

  /** Short-lived key for the browser (the OpenAI key itself never leaves the server). */
  async startRealtime(token) {
    const { session, error } = this.usable(token);
    if (error) throw Object.assign(new Error(error), { code: error });
    if (!this.isActive()) throw Object.assign(new Error('disabled'), { code: 'disabled' });
    if (session.starts >= MAX_STARTS) throw Object.assign(new Error('too_many'), { code: 'too_many' });
    const conv = storageService.getConversationById(session.conversation_id) || {};
    const cfg = this.getConfig();
    const lang = require('./aiService').detectLanguage((conv.messages || []).filter(m => m.sender === 'customer').map(m => m.content).slice(-3).join(' ') || 'مرحبا');
    if (this.voiceMode() === 'browser') return this.startBrowser(session, conv, lang);
    try {
      return await this.startOpenAi(session, conv, lang, cfg);
    } catch (e) {
      // A broken OpenAI key/account must not leave the customer with a dead link.
      const hasChatAi = require('./aiService').getProviders().some(p => p.key !== this.apiKey());
      if (e.code === 'openai' && hasChatAi) {
        console.warn('[Call] OpenAI voice unavailable, using browser voice:', e.message);
        return this.startBrowser(session, conv, lang);
      }
      throw e;
    }
  }

  /** Browser voice: no OpenAI. The page listens/speaks; each turn goes through turn(). */
  startBrowser(session, conv, lang) {
    const cfg = this.getConfig();
    Object.assign(session, {
      status: 'in_progress', starts: (session.starts || 0) + 1, mode: 'browser', lang,
      started_at: session.started_at || new Date().toISOString(), last_activity_at: new Date().toISOString()
    });
    this.save(session);
    if (conv.id && (!conv.ai_call_status || conv.ai_call_status === 'offered')) storageService.saveConversation({ id: conv.id, ai_call_status: 'in_progress' });
    return { mode: 'browser', lang, speech_lang: lang === 'en' ? 'en-US' : 'ar-JO', max_minutes: cfg.max_minutes };
  }

  /**
   * One turn of a browser-voice call: the customer's words in, the assistant's next sentence out.
   * The model answers in JSON and may ask for a tool first (free times / booking / end).
   */
  async turn(token, text, speechReview = null) {
    const { session, error } = this.usable(token);
    if (error) throw Object.assign(new Error(error), { code: error });
    if ((session.turns || 0) >= 120) return { say: '', end: true };
    const said = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (said) this.addTranscript(token, [{ role: 'customer', text: said, speech_review: speechReview }]);
    const s = this.get(token);
    const conv = storageService.getConversationById(s.conversation_id) || {};
    const lang = s.lang || 'ar';
    const system = `${this.instructions(s, conv, lang)}

طريقة الرد في هذه المكالمة: صوتك يُقرأ بصوت الجهاز، فأعد JSON فقط بهذا الشكل:
{"say": "ما ستقوله للعميل الآن", "tool": null, "start": null}
- say: مثل إنسان على التلفون: جملة قصيرة جداً (12 كلمة أو أقل) فيها سؤال واحد فقط. ممنوع تجمع سؤالين أو ثلاثة بنفس الرد. لا تكرر التحية ولا تعيد كلام العميل. بدون روابط أو رموز أو إيموجي أو تعداد.
- إذا سأل عن السعر: جملة واحدة قصيرة (السعر بيتحدد حسب احتياجك بعد استشارة مجانية مع المهندس) ثم سؤالك التالي.
- اكتب بالعامية الأردنية البسيطة وبكلمات واضحة النطق.
- tool: null أو "get_free_times" أو "book_engineer_meeting" أو "end_call".
- لاستخدام get_free_times أو book_engineer_meeting اترك say فارغاً، وضع في start الوقت بصيغة YYYY-MM-DD HH:MM عند الحجز. ستصلك النتيجة ثم تكمل.
- end_call: ضع جملة الوداع في say.
- تاريخ اليوم (توقيت عمّان): ${this.todayAmman()}.${(s.free_slots || []).length ? `
- الأوقات المتاحة التي قرأتها من التقويم في هذه المكالمة (احجز بنفس قيمة start حرفياً):
${s.free_slots.map(x => `  • ${x.start} = ${lang === 'en' ? x.label_en : x.label_ar}`).join('\n')}` : ''}`;
    const history = s.transcript.slice(-40, said ? -1 : undefined).map(l => ({ role: l.role === 'assistant' ? 'model' : 'user', text: l.text }));
    let prompt = said ? `العميل: ${said}` : '(بداية المكالمة: رحّب بالعميل باسمه إن كان معروفاً، عرّف بنفسك، واطلب إذنه بكم سؤال سريع.)';
    const ai = require('./aiService');
    let out = { say: '', end: false };
    const used = [];
    for (let step = 0; step < 4; step++) {
      const last = step === 3; // after 3 tool calls, the model must speak
      const { text: raw } = await ai.chatWithFailover(system, history, last ? `${prompt}\n\n(لا أدوات الآن: قل للعميل الرد المناسب في say.)` : prompt, { json: true, temperature: 0.5, timeout: 20000, maxTokens: 180 });
      let r = {};
      try { r = JSON.parse(String(raw).replace(/^```(json)?|```$/g, '').trim()); } catch { r = { say: String(raw || '').slice(0, 400) }; }
      const tool = !last && ['get_free_times', 'book_engineer_meeting', 'end_call'].includes(r.tool) ? r.tool : null;
      if (tool && tool !== 'end_call') {
        const start = tool === 'book_engineer_meeting' ? this.matchOffered(r.start, this.get(token).free_slots) : '';
        const result = await this.tool(token, tool, { start });
        if (tool === 'get_free_times' && Array.isArray(result?.slots)) {
          const cur = this.get(token); cur.free_slots = result.slots; this.save(cur);
        }
        used.push({ tool, args: { start }, result });
        prompt += `\n\n[نتيجة ${tool}]: ${JSON.stringify(result)}\nالآن قل للعميل الرد المناسب (say).`;
        continue;
      }
      out = { say: this.speakable(r.say), end: tool === 'end_call' };
      if (out.end) { await this.tool(token, 'end_call'); used.push({ tool: 'end_call', args: {}, result: { ok: true } }); }
      break;
    }
    // Never leave the customer in silence.
    if (!out.say && !out.end) out.say = lang === 'en' ? 'Sorry, could you say that again?' : 'عفواً، ممكن تعيد آخر جملة؟';
    out.tools = used;
    const after = this.get(token);
    after.turns = (after.turns || 0) + 1;
    this.save(after);
    if (out.say) this.addTranscript(token, [{ role: 'assistant', text: out.say }]);
    return out;
  }

  todayAmman() {
    const d = new Date();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const day = new Intl.DateTimeFormat('ar', { timeZone: 'Asia/Amman', weekday: 'long' }).format(d);
    return `${date} (${day})`;
  }

  /**
   * The model sometimes writes a wrong date for a time the customer picked from the offered list
   * ("2023-10-09 10:00" for "tomorrow at 10:00"). If the time of day matches exactly one offered
   * slot, book that slot. Otherwise keep what the model wrote (the booking tool still refuses it).
   */
  matchOffered(start, slots = []) {
    const v = String(start || '').trim();
    if (!v || !Array.isArray(slots) || !slots.length) return v;
    if (slots.some(x => x.start === v)) return v;
    const hm = v.match(/(\d{1,2}):(\d{2})\s*$/);
    if (!hm) return v;
    const key = `${hm[1].padStart(2, '0')}:${hm[2]}`;
    const same = slots.filter(x => String(x.start).endsWith(` ${key}`));
    if (same.length === 1) return same[0].start;
    const date = v.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    const exactDay = date && same.find(x => x.start.startsWith(date));
    if (exactDay) return exactDay.start;
    if (same.length > 0) return same[0].start;
    return v;
  }

  /**
   * Advanced Phonetic Normalization for natural Arabic speech synthesis (TTS).
   * Converts brand names, acronyms, dates, and times into spoken Arabic phonetics.
   */
  phoneticArabic(text) {
    if (!text) return '';
    let s = String(text);

    // 1. Brand names & common misheard terms
    s = s.replace(/\batlead\b/gi, 'آت ليد')
         .replace(/\bat\s*least\b/gi, 'آت ليد')
         .replace(/\bat\s*lead\b/gi, 'آت ليد');

    // 2. Technical Acronyms & Platforms
    s = s.replace(/\bAI\b/g, 'الذكاء الاصطناعي')
         .replace(/\bai\b/g, 'إيه آي')
         .replace(/\bCRM\b/gi, 'نظام إدارة العملاء')
         .replace(/\bAPI\b/gi, 'واجهة البرمجة')
         .replace(/\bAPIs\b/gi, 'واجهات البرمجة')
         .replace(/\bSaaS\b/gi, 'البرمجيات السحابية')
         .replace(/\bWhatsApp\b/gi, 'واتساب')
         .replace(/\bInstagram\b/gi, 'إنستغرام')
         .replace(/\bFacebook\b/gi, 'فيسبوك')
         .replace(/\bMessenger\b/gi, 'ماسنجر')
         .replace(/\bGoogle Meet\b/gi, 'جوجل ميت')
         .replace(/\bGoogle Calendar\b/gi, 'تقويم جوجل');

    // 3. Natural Spoken Clock Times (e.g. 10:00 -> الساعة العاشرة، 14:30 -> الساعة الثانية والنصف)
    const hourNames = {
      0: 'الثانية عشرة منتصف الليل', 1: 'الواحدة', 2: 'الثانية', 3: 'الثالثة', 4: 'الرابعة',
      5: 'الخامسة', 6: 'السادسة', 7: 'السابعة', 8: 'الثامنة', 9: 'التاسعة', 10: 'العاشرة',
      11: 'الحادية عشرة', 12: 'الثانية عشرة ظهراً', 13: 'الواحدة ظهراً', 14: 'الثانية ظهراً',
      15: 'الثالثة عصراً', 16: 'الرابعة عصراً', 17: 'الخامسة مساءً', 18: 'السادسة مساءً',
      19: 'السابعة مساءً', 20: 'الثامنة مساءً', 21: 'التاسعة مساءً', 22: 'العاشرة مساءً', 23: 'الحادية عشرة ليلاً'
    };
    s = s.replace(/\b([012]?\d):00\b/g, (_, h) => {
      const num = parseInt(h, 10);
      return hourNames[num] ? `الساعة ${hourNames[num]}` : `${h}:00`;
    });
    s = s.replace(/\b([012]?\d):30\b/g, (_, h) => {
      const num = parseInt(h, 10);
      return hourNames[num] ? `الساعة ${hourNames[num]} والنصف` : `${h}:30`;
    });

    // 4. Clean symbols and formatting
    s = s.replace(/https?:\/\/\S+/g, '')
         .replace(/[*_#`>|~]/g, '')
         .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
         .replace(/\s+/g, ' ')
         .trim();

    return s;
  }

  /** Text the phone can read aloud: no links, emoji or markdown. */
  speakable(text) {
    const raw = String(text || '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_#`>|]/g, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    return this.phoneticArabic(raw);
  }

  /** Server-side high quality speech synthesis (TTS) using OpenAI's tts-1 */
  async synthesizeSpeech(text, voice = 'alloy') {
    const key = this.apiKey();
    if (!key) return null;
    const clean = this.phoneticArabic(this.speakable(text));
    const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    const chosenVoice = VALID_VOICES.includes(String(voice || '').toLowerCase()) ? String(voice).toLowerCase() : 'alloy';
    try {
      const res = await axios.post('https://api.openai.com/v1/audio/speech', {
        model: 'tts-1',
        voice: chosenVoice,
        input: clean,
        speed: 1.02 // Energetic natural cadence
      }, {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 10000
      });
      return Buffer.from(res.data);
    } catch (e) {
      console.warn('[Call] TTS synthesis failed:', e.message);
      return null;
    }
  }

  async startOpenAi(session, conv, lang, cfg) {
    const models = [...new Set([cfg.model, ...FALLBACK_MODELS].filter(Boolean))];
    let lastErr;
    for (const model of models) {
      try {
        const res = await axios.post('https://api.openai.com/v1/realtime/client_secrets', {
          expires_after: { anchor: 'created_at', seconds: 600 },
          session: {
            type: 'realtime',
            model,
            instructions: this.instructions(session, conv, lang),
            audio: {
              input: {
                transcription: { model: 'whisper-1' },
                turn_detection: { type: 'semantic_vad', eagerness: 'low' },
                noise_reduction: { type: 'near_field' }
              },
              output: { voice: cfg.voice || 'marin' }
            },
            tools: this.tools(),
            tool_choice: 'auto'
          }
        }, { headers: { Authorization: `Bearer ${this.apiKey()}`, 'Content-Type': 'application/json' }, timeout: 20000 });
        Object.assign(session, {
          status: 'in_progress', starts: (session.starts || 0) + 1, model,
          started_at: session.started_at || new Date().toISOString(), last_activity_at: new Date().toISOString()
        });
        this.save(session);
        if (!conv.ai_call_status || conv.ai_call_status === 'offered') storageService.saveConversation({ id: conv.id, ai_call_status: 'in_progress' });
        return { key: res.data.value, expires_at: res.data.expires_at, model, max_minutes: cfg.max_minutes };
      } catch (e) {
        lastErr = e;
        const msg = e.response?.data?.error?.message || e.message;
        console.warn(`[Call] realtime key with ${model} failed: ${msg}`);
        if (!/model/i.test(msg)) break; // only a bad model name is worth another try
      }
    }
    throw Object.assign(new Error(lastErr?.response?.data?.error?.message || lastErr?.message || 'failed'), { code: 'openai' });
  }

  addTranscript(token, lines = []) {
    const s = this.get(token);
    if (!s || s.status === 'completed') return null;
    const have = new Set(s.transcript.map(l => l.id));
    for (const l of (Array.isArray(lines) ? lines : []).slice(0, 50)) {
      const text = String(l?.text || '').trim().slice(0, 4000);
      const role = l?.role === 'assistant' ? 'assistant' : 'customer';
      const id = String(l?.id || crypto.randomUUID()).slice(0, 80);
      if (!text || have.has(id)) continue;
      have.add(id);
      const speechReview = role === 'customer' ? normalizeSpeechReview(text, l?.speech_review, s.mode) : null;
      s.transcript.push({ id, role, text, at: new Date().toISOString(), ...(speechReview ? { speech_review: speechReview } : {}) });
    }
    s.last_activity_at = new Date().toISOString();
    return this.save(s);
  }

  /** Tools the voice AI calls during the conversation. */
  async tool(token, name, args = {}) {
    const { session, error } = this.usable(token);
    if (error) return { error };
    const cal = require('./calendarService');
    const conv = storageService.getConversationById(session.conversation_id) || {};
    session.last_activity_at = new Date().toISOString();
    if (session.mock_calendar) return this.mockTool(session, conv, name, args);
    if (name === 'get_free_times') {
      if (!cal.isActive()) return { available: false, note: 'Calendar is not connected. Tell the customer the engineer will contact them to fix a time.' };
      const slots = await cal.suggestions(6).catch(() => []);
      session.free_times_checked_at = new Date().toISOString();
      this.save(session);
      return {
        available: slots.length > 0,
        timezone: 'Asia/Amman',
        slots: slots.map(d => ({ start: this.localKey(d, cal), label_ar: cal.label(d, 'ar'), label_en: cal.label(d, 'en') })),
        note: 'Offer two or three of these. Each slot is the start of a free block; times later in the same block are also fine.'
      };
    }
    if (name === 'book_engineer_meeting') {
      if (!cal.isActive()) return { booked: false, note: 'Calendar is not connected. Tell the customer the engineer will contact them.' };
      // Never a time out of thin air: free times must be read and offered first.
      if (!session.free_times_checked_at) {
        return { booked: false, note: 'Not booked. First call get_free_times, offer two or three of those times, and wait until the customer clearly agrees to one.' };
      }
      const said = session.transcript.filter(l => l.role === 'customer').slice(-4).map(l => l.text).join(' ');
      const lang = said ? require('./aiService').detectLanguage(said) : 'ar';
      const r = await cal.book({ start: args.start, conv, lang });
      if (r.ok) {
        storageService.saveConversation({ id: conv.id, ...r.appointment, consultation_booked: true, consultation_requested: true });
        session.appointment = r.appointment;
      }
      this.save(session);
      return { booked: !!r.ok, message: r.reply };
    }
    if (name === 'end_call') {
      session.ending = true;
      this.save(session);
      return { ok: true };
    }
    return { error: 'unknown tool' };
  }

  /**
   * Rehearsals only (never real customers): a simulated calendar with three fixed free times,
   * so the conversation flow (ask → read times → offer → wait → book that exact time) can be checked
   * when Google Calendar is not connected. Nothing is written to any real calendar.
   */
  mockTool(session, conv, name, args) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86400000));
    const slots = ['10:00', '12:00', '16:00'].map(t => `${day} ${t}`);
    if (name === 'get_free_times') {
      session.free_times_checked_at = new Date().toISOString();
      session.mock_offered = slots;
      this.save(session);
      return { available: true, timezone: 'Asia/Amman', slots: slots.map(s => ({ start: s, label_ar: `بكرا الساعة ${s.slice(11)}`, label_en: `tomorrow at ${s.slice(11)}` })) };
    }
    if (name === 'book_engineer_meeting') {
      if (!session.free_times_checked_at) return { booked: false, note: 'Not booked. First call get_free_times, offer two or three of those times, and wait until the customer clearly agrees to one.' };
      const start = String(args.start || '').trim();
      if (!slots.includes(start)) return { booked: false, message: `${start} is not one of the free times. Offer: ${slots.join(', ')}` };
      const at = require('./calendarService')._zoned(start.slice(0, 10), Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16)), 'Asia/Amman');
      const appointment = { appointment_at: at.toISOString(), appointment_label: `بكرا الساعة ${start.slice(11)} (تجريبي)`, appointment_link: 'https://meet.google.com/rehearsal-only', appointment_event_id: 'rehearsal' };
      storageService.saveConversation({ id: conv.id, ...appointment, consultation_booked: true });
      session.appointment = appointment;
      this.save(session);
      return { booked: true, message: `Booked ${start}. The meeting link will be sent in the chat.` };
    }
    if (name === 'end_call') { session.ending = true; this.save(session); return { ok: true }; }
    return { error: 'unknown tool' };
  }

  localKey(date, cal) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: cal.getConfig().timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
    return `${p.year}-${p.month}-${p.day} ${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
  }

  /**
   * The call ended: analyse everything the customer said, save it everywhere, tell the team,
   * and send the customer a written summary. Safe to call more than once.
   */
  async finish(token, { reason = 'ended' } = {}) {
    const s = this.get(token);
    if (!s || s.status === 'completed' || s.status === 'analyzing') return s;
    if (!s.transcript.length) {
      // Opened but nobody spoke: keep the link usable.
      if (s.status === 'in_progress') { s.status = 'offered'; this.save(s); }
      return s;
    }
    s.speech_review = this.buildSpeechReview(s);
    s.status = 'analyzing';
    s.ended_at = new Date().toISOString();
    s.end_reason = reason;
    s.duration_sec = s.started_at ? Math.round((Date.now() - new Date(s.started_at).getTime()) / 1000) : null;
    this.save(s);

    const conv = storageService.getConversationById(s.conversation_id);
    let analysis = null;
    try { analysis = await this.analyze(s, conv || {}); } catch (e) { console.error('[Call] analysis failed:', e.message); }
    s.analysis = analysis;
    s.status = 'completed';
    this.save(s);
    if (conv) await this.apply(conv, s, analysis);
    return s;
  }

  buildSpeechReview(session) {
    const customerLines = (session?.transcript || []).filter(line => line.role === 'customer');
    const measured = customerLines.map(line => line.speech_review).filter(Boolean);
    const paceRows = measured.filter(row => Number.isFinite(row.estimated_wpm) && row.speech_duration_ms > 0 && row.word_count > 0);
    const totalWords = paceRows.reduce((sum, row) => sum + row.word_count, 0);
    const totalDuration = paceRows.reduce((sum, row) => sum + row.speech_duration_ms, 0);
    const confidenceRows = measured.filter(row => Number.isFinite(row.asr_confidence) && row.confidence_samples > 0);
    const confidenceSamples = confidenceRows.reduce((sum, row) => sum + row.confidence_samples, 0);
    const confidenceTotal = confidenceRows.reduce((sum, row) => sum + row.asr_confidence * row.confidence_samples, 0);
    return {
      version: 1,
      mode: ['browser', 'realtime'].includes(session?.mode) ? session.mode : 'unknown',
      customer_utterances: customerLines.length,
      measured_utterances: paceRows.length,
      measured_words: totalWords,
      speech_active_seconds: totalDuration ? Math.round(totalDuration / 100) / 10 : null,
      estimated_wpm: totalDuration && totalWords ? Math.round(totalWords * 60000 / totalDuration) : null,
      transcription_confidence_percent: confidenceSamples ? Math.round(confidenceTotal / confidenceSamples * 100) : null,
      confidence_samples: confidenceSamples,
      pronunciation_assessment_available: false
    };
  }

  async analyze(session, conv) {
    const ai = require('./aiService');
    const transcript = session.transcript.map(l => `${l.role === 'assistant' ? 'المساعد' : 'العميل'}: ${l.text}`).join('\n').slice(0, 60000);
    const out = await ai.callJson(
      'أنت محلل مبيعات دقيق. تستخرج من نص مكالمة مبيعات كل معلومة قالها العميل فعلاً، بدون أي تخمين. أي معلومة لم تُذكر اتركها فارغة "".',
      `نص المكالمة الصوتية مع العميل:
${transcript}

بيانات معروفة سابقاً: الاسم ${conv.customer_name || '-'}، النشاط ${conv.business_type || '-'}، الطلب ${conv.customer_requests || '-'}.
حالة الحجز من النظام (هي الحقيقة، وليس كلام المكالمة): ${session.appointment?.appointment_label ? `تم حجز اجتماع مع المهندس: ${session.appointment.appointment_label}` : 'لم يُحجز أي اجتماع في التقويم'}.

الحكم على الشراء (بناءً على كلام العميل فقط):
- buying_probability: رقم من 0 إلى 100 يقدّر احتمال أن يشتري فعلاً.
- qualified = true فقط إذا اجتمعت كلها: عنده نشاط تجاري حقيقي، وعنده مشكلة نحلها، وعنده نية واضحة للبدء أو للاجتماع مع المهندس، وهو صاحب القرار أو يمثّله. غير ذلك false (مثلاً طالب، فضول، بدون شركة، بدون نية، رفض واضح).
- classification: Hot (جاهز ونيته واضحة)، Warm (مهتم لكن متردد أو ينقصه شيء)، Cold (غير مهتم أو غير مناسب).
- next_step: ما تم الاتفاق عليه فعلاً بالمكالمة (اجتماع محجوز؟ تواصل الفريق؟ لا شيء؟).
- أي حقل لم يذكره العميل اتركه "" ولا تكتب نصاً من عندك.

أعد JSON فقط بهذه المفاتيح (قيم نصية عربية مختصرة، والأرقام كما قالها العميل):
customer_name, company_name, job_title, location, business_type, team_size, monthly_volume, channels_used, current_tools, identified_problem, goals, customer_requests, budget, timeline, decision_maker, objections, customer_email, customer_phone, proposed_solution, buying_probability (رقم), classification (Hot أو Warm أو Cold), qualified (true أو false), summary (ملخص المكالمة في 3-5 جمل), next_step, sentiment (positive أو neutral أو negative).`
    );
    if (!out) return null;
    const clean = {};
    for (const [k, v] of Object.entries(out)) clean[k] = typeof v === 'string' ? v.trim().slice(0, 1500) : v;
    clean.buying_probability = Math.max(0, Math.min(100, Number(clean.buying_probability) || 0));
    if (!['Hot', 'Warm', 'Cold'].includes(clean.classification)) clean.classification = clean.buying_probability >= 70 ? 'Hot' : clean.buying_probability >= 40 ? 'Warm' : 'Cold';
    // The three signals must agree, otherwise the safe answer wins (no false "ready to buy").
    if (!clean.buying_probability) clean.buying_probability = { Hot: 80, Warm: 50, Cold: 15 }[clean.classification];
    clean.qualified = (clean.qualified === true || clean.qualified === 'true') && clean.classification !== 'Cold' && clean.buying_probability >= 50;
    // "Meeting booked" only when the calendar really has it.
    const booked = !!session.appointment?.appointment_label;
    const saysBooked = /محجوز|تم (ال)?حجز|حجزنا|booked/i.test(`${clean.next_step || ''} ${clean.summary || ''}`);
    if (!booked && saysBooked) {
      clean.next_step = clean.qualified ? 'تواصل الفريق مع العميل لتحديد موعد الاجتماع مع المهندس (لم يُحجز موعد في التقويم)' : 'لا يوجد موعد محجوز';
      clean.summary = String(clean.summary || '').replace(/[^.]*?(تم (ال)?اتفاق على حجز|تم (ال)?حجز|محجوز)[^.]*\.?/g, '').trim();
    }
    return clean;
  }

  async apply(conv, s, a) {
    const crm = require('./crmService');
    const supabase = require('./supabaseService');
    const keep = (v, old) => (v !== null && v !== undefined && String(v).trim() !== '' ? v : old);
    const fresh = storageService.getConversationById(conv.id) || conv;
    const patch = {
      id: conv.id,
      ai_call_status: 'completed',
      ai_call_at: s.started_at || s.created_at,
      ai_call_duration_sec: s.duration_sec,
      ai_call_token: s.token,
      ai_call_qualified: a ? !!a.qualified : null,
      ai_call_summary: a?.summary || '',
      ai_call_next_step: a?.next_step || '',
      ai_call_sentiment: a?.sentiment || '',
      ai_call_speech_review: s.speech_review || this.buildSpeechReview(s)
    };
    if (a) {
      for (const f of [...PROFILE_FIELDS, 'identified_problem', 'customer_requests', 'objections', 'proposed_solution']) patch[f] = keep(a[f], fresh[f]);
      if (a.customer_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.customer_email)) patch.customer_email = keep(fresh.customer_email, a.customer_email);
      if (a.customer_phone && !fresh.customer_phone) patch.customer_phone = a.customer_phone;
      if (a.customer_name && (!fresh.customer_name || /عميل|مستخدم|متابع/.test(fresh.customer_name))) patch.customer_name = a.customer_name;
      patch.customer_summary = [fresh.customer_summary, `مكالمة الـ AI: ${a.summary || ''}`].filter(Boolean).join('\n').slice(-3000);
      patch.interest_score = Math.max(Number(fresh.interest_score) || 0, a.buying_probability);
      patch.classification = a.classification;
      if (a.qualified && !['handed_off', 'deal_closing'].includes(fresh.lead_stage)) patch.lead_stage = 'qualified';
    }
    const updated = storageService.saveConversation(patch);
    await supabase.saveConversation(updated).catch(() => {});

    // Ready to buy (or meeting booked) → the sales team takes it from here.
    const booked = !!(s.appointment || updated.appointment_at);
    if (!updated.handoff_at && (booked || a?.qualified)) {
      await crm.handoff(updated.id, booked ? `مكالمة الـ AI: مؤهل، وحُجز اجتماع المهندس ${updated.appointment_label || ''}` : 'مكالمة الـ AI: العميل مؤهل للشراء');
    } else {
      await crm.upsertLead(updated);
    }

    this.notifyTeam(updated, s, a);
    await this.sendSummary(updated, s, a);
  }

  notifyTeam(conv, s, a) {
    if (conv.channel === 'simulator_call') return; // rehearsal
    try {
      const telegram = require('./telegramService');
      if (!telegram.isConfigured()) return;
      const esc = (t) => String(t || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
      telegram.sendMessage([
        `<b>انتهت مكالمة الـ AI</b> — ${esc(conv.customer_name || 'عميل')}`,
        a ? `${a.qualified ? 'مؤهل للشراء' : 'غير مؤهل حالياً'} — ${a.buying_probability}%` : 'تعذّر تحليل المكالمة',
        a?.summary ? esc(a.summary) : '',
        conv.appointment_label ? `اجتماع المهندس: ${esc(conv.appointment_label)}` : '',
        a?.next_step ? `الخطوة التالية: ${esc(a.next_step)}` : ''
      ].filter(Boolean).join('\n'), { type: 'ai_call' }).catch(() => {});
    } catch { /* optional */ }
  }

  /** The customer gets the outcome in writing on their own channel. */
  async sendSummary(conv, s, a) {
    const adapter = require('./schedulerService').getAdapter(conv);
    const en = require('./aiService').detectLanguage((s.transcript.find(l => l.role === 'customer') || {}).text || '') === 'en';
    const whenEn = s.appointment?.appointment_at ? require('./calendarService').label(new Date(s.appointment.appointment_at), 'en') : '';
    const lines = en
      ? ['Thank you for the call.', conv.appointment_label && s.appointment ? `Your meeting with our engineer: ${whenEn || s.appointment.appointment_label}${s.appointment.appointment_link ? `\nMeeting link: ${s.appointment.appointment_link}` : ''}` : (a?.qualified ? 'Our team will contact you shortly to arrange the next step.' : 'If you have any other question, just write here.')]
      : ['شكراً على وقتك بالمكالمة.', s.appointment ? `موعدك مع المهندس: ${s.appointment.appointment_label}${s.appointment.appointment_link ? `\nرابط الاجتماع: ${s.appointment.appointment_link}` : ''}` : (a?.qualified ? 'فريقنا رح يتواصل معك قريباً لترتيب الخطوة الجاية.' : 'إذا عندك أي سؤال ثاني، اكتبلي هون.')];
    const text = lines.join('\n');
    let res = { ok: false, simulated: !adapter };
    if (adapter && (!adapter.isReady || adapter.isReady())) {
      try { res = (await adapter.send(conv, text, {})) || { ok: false }; } catch (e) { console.error('[Call] summary send failed:', e.message); }
    }
    storageService.addMessage(conv.id, {
      sender: 'bot', content: text, media_type: 'text',
      delivery_status: res.ok ? 'sent' : (res.simulated ? 'simulated' : 'failed')
    });
  }

  /** After a redeploy with an empty disk, bring the calls back from Supabase. */
  async restore() {
    if (this._restored) return;
    this._restored = true;
    if (fs.existsSync(FILE)) return;
    try {
      const list = await require('./supabaseService').loadKv('ai_calls');
      if (Array.isArray(list) && list.length) write(list);
    } catch { /* nothing to restore */ }
  }

  /** Close calls that were left open (browser closed without saying goodbye). */
  async sweep() {
    await this.restore();
    const now = Date.now();
    for (const s of read()) {
      if (s.status === 'in_progress' && now - new Date(s.last_activity_at || s.updated_at).getTime() > IDLE_FINISH_MS) {
        await this.finish(s.token, { reason: 'idle' }).catch(e => console.error('[Call] sweep:', e.message));
      } else if (s.status === 'offered' && new Date(s.expires_at).getTime() < now) {
        s.status = 'expired';
        this.save(s);
      }
    }
  }
}

module.exports = new CallService();
module.exports.PROFILE_FIELDS = PROFILE_FIELDS;
