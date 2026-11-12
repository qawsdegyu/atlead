/**
 * AI voice call (qualification stage before the engineer).
 *
 * 1. In chat, when the customer is interested, the bot offers a short voice call and sends a
 *    private link: /call/<token> (a branded page on this site, opens on any phone or laptop).
 * 2. On that page the customer talks by voice with the AI (OpenAI Realtime over WebRTC; the
 *    browser gets a short-lived key, the real API key never leaves the server).
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
  model: 'gpt-realtime-2.1',
  voice: 'marin',
  max_minutes: 15,
  link_days: 7,
  extra_questions: ''
};
const FALLBACK_MODELS = ['gpt-realtime-2.1', 'gpt-realtime-2', 'gpt-realtime'];

// Everything the analysis can learn about the customer → saved on the conversation.
const PROFILE_FIELDS = ['company_name', 'job_title', 'location', 'business_type', 'team_size', 'monthly_volume',
  'channels_used', 'current_tools', 'goals', 'budget', 'timeline', 'decision_maker'];

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

  apiKey() {
    return storageService.getSettings().ai?.openai_api_key || process.env.OPENAI_API_KEY || '';
  }

  isActive() {
    return !!(this.getConfig().enabled && this.apiKey());
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
      max_minutes: cfg.max_minutes
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
    return `أنت مستشار مبيعات صوتي لشركة atlead (أنظمة مبيعات ذكية وأتمتة للشركات) في مكالمة صوتية أونلاين مع عميل محتمل.
هدف المكالمة (حوالي ${Math.min(cfg.max_minutes, 10)} دقائق): تفهم شغل العميل واحتياجه، وتتأكد هل هو جاد ومستعد يشتري، وإذا كان جاهز تحجزله اجتماع أونلاين مع المهندس.

طريقة الكلام:
- ${lang === 'en' ? 'The customer writes in English: speak English unless they switch to Arabic.' : 'احكِ باللهجة الأردنية البيضاء، وإذا حكى العميل إنجليزي احكِ إنجليزي.'}
- جمل قصيرة وطبيعية كأنك موظف حقيقي ودود، سؤال واحد بكل مرة، واستنى العميل يخلص كلامه.
- ابدأ بالتحية وعرّف بنفسك كمساعد atlead الذكي، واطلب إذنه بكم سؤال سريع.

الأسئلة (لا تسأل عن شي معروف تحت — أكّده بس):
1. شو نوع شغله، واسم الشركة، وشو دوره فيها.
2. كم حجم الفريق، وتقريباً كم رسالة أو عميل بيتعامل معهم بالشهر، وعلى أي قنوات (واتساب، إنستغرام، فيسبوك، موقع...).
3. كيف بيدير المبيعات والردود هلق، وشو الأدوات اللي بيستخدمها.
4. شو أكبر مشكلة بتواجهه، وشو النتيجة اللي بده يوصلها.
5. متى بده يبدأ (الإطار الزمني)، وهل في ميزانية مرصودة لهالشي (اسأل بلطف بدون ما تعطي أسعار).
6. هل هو صاحب القرار، أو في حدا ثاني لازم يشارك.
7. بريده الإلكتروني ورقمه إذا مش معروفين.
${cfg.extra_questions ? `أسئلة إضافية من الإدارة:\n${cfg.extra_questions}\n` : ''}
قواعد إلزامية:
- جاوب فقط من معلومات الشركة تحت. إذا ما بتعرف شي قل إن المهندس رح يوضحه بالاجتماع. لا تخترع.
- ممنوع تذكر أي سعر أو رقم أو مدة تنفيذ مش مكتوبة حرفياً بالمعلومات. الأسعار بتتحدد مع المهندس.
- إذا سأل عن السعر، جاوب بمعنى جواب الأسعار المعتمد هذا (بلغة العميل)، ثم كمّل أسئلتك: "${pricing}"
- لا تضغط على العميل. إذا مش مهتم أو مش مناسب، اشكره بلطف وأنهِ المكالمة.
${calendarOn ? `- حجز اجتماع المهندس، بالترتيب ولا تتجاوز أي خطوة: (1) اسأل العميل إذا حابب يحجز اجتماع أونلاين مع المهندس واستنى جوابه. (2) إذا وافق، استخدم get_free_times. (3) اقترح وقتين أو ثلاثة من النتيجة فقط واستنى يختار. (4) فقط لما يوافق صراحة على وقت محدد استخدم book_engineer_meeting بنفس الوقت. ممنوع تخترع تاريخ أو وقت، وممنوع تحجز بدون موافقته. (5) بعد الحجز أكّد له الموعد وقل إن رابط الاجتماع رح يوصله بالمحادثة.` : '- إذا العميل مهتم وجاهز: قل إن المهندس رح يتواصل معه لتحديد موعد الاجتماع. لا تذكر أي تاريخ أو وقت.'}
- بالآخر لخّص له الخطوة الجاية بجملة، اشكره، وبعدين استخدم end_call.

معلومات معروفة عن العميل من المحادثة الكتابية:
${known || '- لا يوجد'}

معلومات الشركة (المرجع الوحيد):
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

  /** Short-lived key for the browser (the OpenAI key itself never leaves the server). */
  async startRealtime(token) {
    const { session, error } = this.usable(token);
    if (error) throw Object.assign(new Error(error), { code: error });
    if (!this.isActive()) throw Object.assign(new Error('disabled'), { code: 'disabled' });
    if (session.starts >= MAX_STARTS) throw Object.assign(new Error('too_many'), { code: 'too_many' });
    const conv = storageService.getConversationById(session.conversation_id) || {};
    const cfg = this.getConfig();
    const lang = require('./aiService').detectLanguage((conv.messages || []).filter(m => m.sender === 'customer').map(m => m.content).slice(-3).join(' ') || 'مرحبا');
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
                transcription: { model: 'gpt-4o-transcribe' },
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
      s.transcript.push({ id, role, text, at: new Date().toISOString() });
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

  async analyze(session, conv) {
    const ai = require('./aiService');
    const transcript = session.transcript.map(l => `${l.role === 'assistant' ? 'المساعد' : 'العميل'}: ${l.text}`).join('\n').slice(0, 60000);
    const out = await ai.callJson(
      'أنت محلل مبيعات دقيق. تستخرج من نص مكالمة مبيعات كل معلومة قالها العميل فعلاً، بدون أي تخمين. أي معلومة لم تُذكر اتركها فارغة "".',
      `نص المكالمة الصوتية مع العميل:
${transcript}

بيانات معروفة سابقاً: الاسم ${conv.customer_name || '-'}، النشاط ${conv.business_type || '-'}، الطلب ${conv.customer_requests || '-'}.

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
      ai_call_sentiment: a?.sentiment || ''
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
