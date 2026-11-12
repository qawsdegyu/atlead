/**
 * AI phone line.
 *
 * Your Jordanian SIM forwards calls (carrier code dialed once on the phone) to a Twilio number.
 * Twilio calls /voice/incoming → we answer with a live audio stream (wss /voice/stream) that is
 * bridged to the OpenAI realtime voice model (μ-law 8 kHz both ways, no re-encoding).
 * The AI uses the same company files, rules and booking tools as the web call. When the caller asks
 * for customer service, or the AI cannot solve the problem, the call is transferred: Twilio dials your
 * phone and connects you, showing the caller's number. If nobody answers, the caller hears a short
 * message and the team is alerted to call back. Every call is transcribed, analysed and saved
 * (CRM, Supabase, Google Sheets) exactly like the web call.
 */
const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
const storageService = require('./storageService');

const DEFAULTS = {
  enabled: false,
  twilio_account_sid: '',
  twilio_auth_token: '',
  twilio_number: '',
  transfer_number: '',
  // no_answer: your phone rings first; the AI answers only unanswered / busy / unreachable calls.
  // all: the AI answers every call (transfers then need a second number).
  mode: 'no_answer',
  transfer_timeout: 15,
  voice: 'marin',
  announce_transcript: true
};
const pending = new Map(); // one-time stream tokens issued by /voice/incoming
const transfersInFlight = new Map(); // caller number → time we rang the team for them (loop guard)
const CARRIER_DELAY = 25; // seconds your phone rings before the carrier forwards to the AI
const active = new Map(); // callSid → live call state

const digits = (n) => String(n || '').replace(/\D/g, '');
const e164 = (n) => (digits(n) ? `+${digits(n).replace(/^00/, '')}` : '');
const xml = (s) => String(s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

class PhoneService {
  getConfig() {
    const cfg = { ...DEFAULTS, ...(storageService.getSettings().phone_ai || {}) };
    cfg.mode = cfg.mode === 'all' ? 'all' : 'no_answer';
    cfg.transfer_timeout = Math.min(60, Math.max(10, Number(cfg.transfer_timeout) || 15));
    // The transfer must give up before the carrier forwards it back to the AI (no loop).
    if (cfg.mode === 'no_answer') cfg.transfer_timeout = Math.min(cfg.transfer_timeout, CARRIER_DELAY - 7);
    cfg.twilio_number = e164(cfg.twilio_number);
    cfg.transfer_number = e164(cfg.transfer_number);
    return cfg;
  }

  openaiKey() { return require('./callService').apiKey(); }

  /** Everything needed for the AI to answer. */
  isActive() {
    const c = this.getConfig();
    return !!(c.enabled && c.twilio_account_sid && c.twilio_auth_token && this.openaiKey());
  }

  publicBase() {
    let base = '';
    try { base = require('./socialPublisher').publicBaseUrl(); } catch { /* optional */ }
    return (base || require('./notificationService').getConfig().dashboardUrl || '').replace(/\/+$/, '');
  }

  /** Twilio request signature (X-Twilio-Signature): HMAC-SHA1 of the full URL + sorted POST params. */
  validSignature(req) {
    const { twilio_auth_token: token } = this.getConfig();
    const sig = req.headers['x-twilio-signature'];
    if (!token || !sig) return false;
    const url = this.publicBase() + req.originalUrl;
    const params = req.body && typeof req.body === 'object' ? req.body : {};
    const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
    const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  }

  twilio(method, path, form) {
    const c = this.getConfig();
    return axios({
      method,
      url: `https://api.twilio.com/2010-04-01/Accounts/${c.twilio_account_sid}${path}`,
      auth: { username: c.twilio_account_sid, password: c.twilio_auth_token },
      data: form ? new URLSearchParams(form).toString() : undefined,
      headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
      timeout: 15000
    });
  }

  dialTwiml(callerId, token) {
    const c = this.getConfig();
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${xml(callerId)}" timeout="${c.transfer_timeout}" action="${xml(`${this.publicBase()}/voice/after-dial?t=${token || ''}`)}" method="POST"><Number>${xml(c.transfer_number)}</Number></Dial></Response>`;
  }

  /** Twilio → a call came in. */
  incoming(body = {}) {
    const c = this.getConfig();
    const from = e164(body.From);
    // Not set up (or no AI key): never lose the call — ring the team directly.
    if (!this.isActive()) {
      if (c.transfer_number) return this.dialTwiml(from || c.twilio_number, '');
      return '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';
    }
    // A call from our own line would loop.
    if (from && from === c.twilio_number) return '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';
    // A transfer we just rang came back through the carrier's "no answer" forwarding: refuse it, so the
    // transfer counts as missed (the caller hears the call-back message) instead of reaching the AI again.
    const rang = transfersInFlight.get(from);
    if (rang && Date.now() - rang < 90000) {
      transfersInFlight.delete(from);
      return '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>';
    }
    const token = crypto.randomBytes(16).toString('hex');
    pending.set(token, { callSid: body.CallSid, from, to: e164(body.To), forwardedFrom: e164(body.ForwardedFrom), at: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.at > 120000) pending.delete(k);
    const wss = this.publicBase().replace(/^http/, 'ws');
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(`${wss}/voice/stream`)}"><Parameter name="t" value="${token}"/></Stream></Connect></Response>`;
  }

  /** Twilio → the transfer finished (answered, busy, no answer...). */
  afterDial(body = {}, token = '') {
    const status = String(body.DialCallStatus || '');
    for (const [k, v] of transfersInFlight) if (Date.now() - v > 90000) transfersInFlight.delete(k);
    if (status === 'completed' || status === 'answered') return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
    const callSid = body.CallSid;
    const state = [...active.values()].find(s => s.token === token || s.callSid === callSid) || this._lastByCall?.get(callSid);
    this.alertMissed(state, body);
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Zeina" language="arb">نعتذر، فريق خدمة العملاء مشغول حالياً. سنتصل بك في أقرب وقت. شكراً لك.</Say><Hangup/></Response>';
  }

  alertMissed(state, body) {
    const from = state?.from || e164(body.From);
    if (state?.conv) {
      storageService.saveConversation({ id: state.conv.id, callback_needed_at: new Date().toISOString() });
    }
    try {
      const telegram = require('./telegramService');
      if (telegram.isConfigured()) {
        telegram.sendMessage(`<b>مكالمة لم يُرد عليها بعد التحويل</b>\nاتصل بالعميل: ${xml(from || 'رقم غير معروف')}\n${state?.reason ? xml(state.reason) : ''}`, { type: 'phone_missed' }).catch(() => {});
      }
    } catch { /* optional */ }
  }

  phoneInstructions(session, conv, known) {
    const callService = require('./callService');
    const c = this.getConfig();
    const base = callService.instructions(session, { ...conv, ...known }, 'ar');
    return `${base}

هذه مكالمة هاتفية واردة على رقم الشركة: العميل هو اللي اتصل.${c.mode === 'no_answer' ? '\n- العميل اتصل على رقم الفريق وما حدا قدر يرد، فأنت بترد بدالهم. لا تقل إن الفريق غير موجود؛ قل إنك مساعد atlead الذكي وبتقدر تساعده هلق.' : ''}
- ابدأ بالترحيب باسم atlead${c.announce_transcript ? ' وأخبره بجملة قصيرة أن المكالمة تُسجَّل نصياً لخدمته بشكل أفضل' : ''}، واسأله كيف بتقدر تساعده. لا تبدأ بالأسئلة التأهيلية.
- جاوب على سؤاله من معلومات الشركة فقط. الأسئلة التأهيلية والحجز فقط إذا بيّن اهتمام بالشراء.
- إذا طلب خدمة العملاء أو موظف أو مدير، أو عنده شكوى أو مشكلة ما بتقدر تحلها من المعلومات، أو أصرّ على إنسان: قل له "لحظة، رح أحاول أحوّلك لخدمة العملاء، وإذا كانوا مشغولين رح يتصلوا فيك بأقرب وقت" ثم استخدم transfer_to_human مع سبب مختصر.
- لا تقرأ روابط أو إيميلات بصوتك. بعد حجز الاجتماع قل إن التفاصيل ورابط الاجتماع رح يوصلوه على واتساب على نفس الرقم.
- إذا ما سمعت العميل بوضوح اطلب منه يعيد بلطف.`;
  }

  tools() {
    return [
      ...require('./callService').tools(),
      {
        type: 'function', name: 'transfer_to_human',
        description: 'Transfer the caller to a human customer-service agent (rings the team phone). Use when the caller asks for a person or has a problem you cannot solve.',
        parameters: { type: 'object', properties: { reason: { type: 'string', description: 'Short reason in Arabic' } }, required: ['reason'], additionalProperties: false }
      }
    ];
  }

  realtimeUrl(model) {
    return `${process.env.OPENAI_REALTIME_WS || 'wss://api.openai.com/v1/realtime'}?model=${encodeURIComponent(model)}`;
  }

  /** Accepts the Twilio media-stream WebSocket on the main HTTP server. */
  attach(server) {
    const wss = new WebSocket.Server({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (!String(req.url || '').startsWith('/voice/stream')) return; // other upgrades are not ours
      wss.handleUpgrade(req, socket, head, (ws) => this.bridge(ws));
    });
    return wss;
  }

  findKnown(phone) {
    const d = digits(phone).slice(-9); // match 07xxxxxxxx and +9627xxxxxxxx
    if (!d) return {};
    const match = storageService.getConversations().filter(cv => cv.channel !== 'phone')
      .find(cv => digits(cv.customer_phone || cv.external_user_id).slice(-9) === d);
    if (!match) return {};
    const keys = ['customer_name', 'company_name', 'business_type', 'customer_requests', 'identified_problem', 'customer_summary', 'customer_email', 'appointment_label'];
    return Object.fromEntries(keys.filter(k => match[k]).map(k => [k, match[k]]));
  }

  bridge(tw) {
    const callService = require('./callService');
    const state = { tw, oa: null, streamSid: null, callSid: null, from: '', conv: null, session: null, token: null, ended: false, transferred: false };
    const toTwilio = (obj) => { if (tw.readyState === WebSocket.OPEN) tw.send(JSON.stringify(obj)); };
    const toAi = (obj) => { if (state.oa?.readyState === WebSocket.OPEN) state.oa.send(JSON.stringify(obj)); };

    const finish = async () => {
      if (state.ended) return;
      state.ended = true;
      try { state.oa?.close(); } catch { /* ignore */ }
      if (state.callSid) active.delete(state.callSid);
      if (state.session) {
        const s = callService.get(state.session.token);
        if (s && state.transferred) { s.transferred_to_human = true; s.transfer_reason = state.reason || ''; callService.save(s); }
        await callService.finish(state.session.token, { reason: state.transferred ? 'transferred' : 'phone_ended' }).catch(e => console.error('[Phone] finish:', e.message));
      }
    };

    const startAi = () => {
      const cfg = callService.getConfig();
      const oa = new WebSocket(this.realtimeUrl(cfg.model || 'gpt-realtime-2.1'), { headers: { Authorization: `Bearer ${this.openaiKey()}` } });
      state.oa = oa;
      oa.on('open', () => {
        toAi({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: this.phoneInstructions(state.session, state.conv, state.known),
            audio: {
              input: { format: { type: 'audio/pcmu' }, transcription: { model: 'gpt-4o-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'low' } },
              output: { format: { type: 'audio/pcmu' }, voice: this.getConfig().voice || 'marin' }
            },
            tools: this.tools(),
            tool_choice: 'auto'
          }
        });
        toAi({ type: 'response.create' }); // the AI greets first
      });
      oa.on('message', (raw) => this.onAiEvent(state, JSON.parse(raw), toTwilio, toAi));
      oa.on('error', (e) => {
        console.error('[Phone] realtime error:', e.message);
        // The AI is unavailable: hand the caller to a person instead of dead air.
        if (!state.transferred && !state.ended) this.transfer(state, 'تعذّر تشغيل المساعد الصوتي').catch(() => {});
      });
      oa.on('close', () => { /* Twilio side decides the end */ });
    };

    tw.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.event === 'start') {
        const info = pending.get(msg.start?.customParameters?.t);
        if (!info) { tw.close(); return; } // not issued by /voice/incoming
        pending.delete(msg.start.customParameters.t);
        Object.assign(state, { streamSid: msg.start.streamSid, callSid: msg.start.callSid || info.callSid, from: info.from });
        let conv = storageService.getConversationByChannelUser('phone', digits(info.from) || `unknown_${state.callSid}`);
        state.known = this.findKnown(info.from);
        if (!conv) {
          conv = storageService.saveConversation({
            channel: 'phone', external_user_id: digits(info.from) || `unknown_${state.callSid}`,
            customer_name: state.known.customer_name || (info.from ? `متصل ${info.from}` : 'متصل'),
            customer_phone: info.from || '', lead_stage: 'new', is_bot_active: true
          });
        }
        state.conv = conv;
        const session = callService.createSession(conv, { fresh: true });
        Object.assign(session, { kind: 'phone', call_sid: state.callSid, status: 'in_progress', started_at: new Date().toISOString(), last_activity_at: new Date().toISOString() });
        callService.save(session);
        state.session = session;
        state.token = session.token;
        active.set(state.callSid, state);
        (this._lastByCall ||= new Map()).set(state.callSid, state);
        if (this._lastByCall.size > 200) this._lastByCall.delete(this._lastByCall.keys().next().value);
        startAi();
      } else if (msg.event === 'media') {
        toAi({ type: 'input_audio_buffer.append', audio: msg.media.payload });
      } else if (msg.event === 'stop') {
        await finish();
      }
    });
    tw.on('close', () => { finish(); });
  }

  async onAiEvent(state, ev, toTwilio, toAi) {
    const callService = require('./callService');
    switch (ev.type) {
      case 'response.output_audio.delta':
        toTwilio({ event: 'media', streamSid: state.streamSid, media: { payload: ev.delta } });
        break;
      case 'input_audio_buffer.speech_started':
        toTwilio({ event: 'clear', streamSid: state.streamSid }); // caller interrupts → stop talking
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) callService.addTranscript(state.token, [{ id: ev.item_id, role: 'customer', text: ev.transcript }]);
        break;
      case 'response.output_audio_transcript.done':
        if (ev.transcript?.trim()) callService.addTranscript(state.token, [{ id: ev.item_id, role: 'assistant', text: ev.transcript }]);
        break;
      case 'response.function_call_arguments.done': {
        let args = {};
        try { args = JSON.parse(ev.arguments || '{}'); } catch { /* empty */ }
        if (ev.name === 'transfer_to_human') {
          const r = await this.transfer(state, args.reason || '');
          toAi({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify(r) } });
          return;
        }
        if (ev.name === 'end_call') {
          toAi({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: '{"ok":true}' } });
          setTimeout(() => this.hangup(state).catch(() => {}), 3500); // let the goodbye play
          return;
        }
        const result = await callService.tool(state.token, ev.name, args).catch(e => ({ error: e.message }));
        toAi({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify(result || {}) } });
        toAi({ type: 'response.create' });
        break;
      }
      case 'error':
        console.warn('[Phone] realtime event error:', ev.error?.message || ev.error);
        break;
      default:
    }
  }

  /** Ring the team phone and connect the caller (shows the caller's number). */
  async transfer(state, reason) {
    const c = this.getConfig();
    if (!c.transfer_number) return { transferred: false, note: 'No customer-service number is set. Tell the caller the team will call them back soon.' };
    if (state.transferred) return { transferred: true };
    state.transferred = true;
    state.reason = reason;
    if (state.from) transfersInFlight.set(state.from, Date.now());
    try {
      await this.twilio('post', `/Calls/${state.callSid}.json`, { Twiml: this.dialTwiml(state.from || c.twilio_number, state.token) });
    } catch (e) {
      state.transferred = false;
      console.error('[Phone] transfer failed:', e.response?.data?.message || e.message);
      return { transferred: false, note: 'Transfer failed. Tell the caller the team will call them back soon.' };
    }
    if (state.conv) {
      const crm = require('./crmService');
      const conv = storageService.getConversationById(state.conv.id);
      if (conv && !conv.handoff_at) crm.handoff(conv.id, `مكالمة هاتفية: طلب التحويل لخدمة العملاء${reason ? ` — ${reason}` : ''}`).catch(() => {});
    }
    return { transferred: true };
  }

  async hangup(state) {
    await this.twilio('post', `/Calls/${state.callSid}.json`, { Status: 'completed' });
  }

  /** Settings → check Twilio and point the number at this server automatically. */
  async connect() {
    const c = this.getConfig();
    if (!c.twilio_account_sid || !c.twilio_auth_token) return { success: false, message: 'أدخل Account SID و Auth Token من Twilio أولاً.' };
    if (!c.twilio_number) return { success: false, message: 'أدخل رقم Twilio الذي ستُحوَّل إليه المكالمات.' };
    const base = this.publicBase();
    if (!/^https:\/\//.test(base)) return { success: false, message: 'يلزم رابط https عام للخادم (يعمل تلقائياً على Railway).' };
    let num;
    try {
      const r = await this.twilio('get', `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(c.twilio_number)}`);
      num = r.data.incoming_phone_numbers?.[0];
    } catch (e) {
      const st = e.response?.status;
      return { success: false, message: st === 401 ? 'بيانات Twilio غير صحيحة (Account SID أو Auth Token).' : `تعذّر الاتصال بـ Twilio: ${e.response?.data?.message || e.message}` };
    }
    if (!num) return { success: false, message: `الرقم ${c.twilio_number} غير موجود في حساب Twilio هذا.` };
    try {
      await this.twilio('post', `/IncomingPhoneNumbers/${num.sid}.json`, { VoiceUrl: `${base}/voice/incoming`, VoiceMethod: 'POST' });
    } catch (e) {
      return { success: false, message: `تعذّر ربط الرقم: ${e.response?.data?.message || e.message}` };
    }
    const fwd = c.twilio_number.replace('+', '00');
    const codes = c.mode === 'no_answer'
      ? {
        main: { label: 'إذا لم أرد خلال 25 ثانية، أو كان الخط مشغولاً، أو الهاتف مغلقاً', code: `**004*${fwd}**${CARRIER_DELAY}#` },
        alternatives: [
          { label: 'إذا لم أرد فقط', code: `**61*${fwd}**${CARRIER_DELAY}#` },
          { label: 'إذا كان الخط مشغولاً فقط', code: `**67*${fwd}#` },
          { label: 'إذا كان الهاتف مغلقاً فقط', code: `**62*${fwd}#` }
        ],
        cancel: { label: 'إلغاء هذه التحويلات', code: '##004#' }
      }
      : {
        main: { label: 'تحويل كل المكالمات للمساعد', code: `**21*${fwd}#` },
        alternatives: [],
        cancel: { label: 'إلغاء التحويل', code: '##21#' }
      };
    return {
      mode: c.mode,
      codes,
      success: true,
      message: `تم ربط رقم Twilio ${c.twilio_number} بالمساعد.${this.openaiKey() ? '' : ' ينقص OpenAI API Key (بطاقة مكالمة الـ AI).'}${c.transfer_number ? '' : ' ينقص رقم خدمة العملاء للتحويل.'}${c.mode === 'all' && c.transfer_number && c.transfer_number === e164(c.my_number) ? ' تنبيه: في وضع "كل المكالمات" لا يمكن التحويل إلى نفس الرقم المحوَّل.' : ''}`,
      forwarding: {
        all: `**21*${fwd}#`,
        no_answer: `**61*${fwd}**20#`,
        busy: `**67*${fwd}#`,
        unreachable: `**62*${fwd}#`,
        cancel_all: '##002#'
      }
    };
  }
}

module.exports = new PhoneService();
module.exports._pending = pending;
