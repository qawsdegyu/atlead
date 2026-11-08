/**
 * Reply Engine — shared brain for every private-message channel
 * (WhatsApp QR, WhatsApp Cloud API, Messenger, Instagram DM).
 *
 *  - Saves every incoming customer message (local JSON + Supabase).
 *  - Waits `bot.reply_delay_seconds` (default 10s) after the LAST customer message
 *    before answering. If the customer sends several messages in a row, the timer
 *    restarts and the bot answers all of them once — this looks human and protects
 *    the number from being flagged/banned for instant automated replies.
 *  - Shows "typing..." a few seconds before sending (where the platform supports it).
 *  - Sends the answer as a QUOTED reply to the customer's message
 *    (the swipe-to-reply look in WhatsApp / Instagram / Messenger).
 *
 * Each channel provides an "adapter":
 *   {
 *     send(conv, text, { quoted })  -> Promise<{ ok, external_message_id }>
 *     typing?(conv, { quoted })     -> Promise<void>   (optional)
 *     markRead?(conv, { quoted })   -> Promise<void>   (optional)
 *   }
 */
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');
const crmService = require('./crmService');
const notificationService = require('./notificationService');
const aiService = require('./aiService');

const DEFAULT_DELAY_SECONDS = 10;
const BOOT_TIME = Date.now();

// Phone numbers (Jordan local 07xxxxxxxx or international +962 / 00962 / any +country) and emails.
function extractContact(text) {
  const out = {};
  const t = String(text || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const email = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) out.email = email[0].toLowerCase();
  const candidates = t.match(/(?:\+|00)?\d[\d\s-]{7,16}\d/g) || [];
  for (const c of candidates) {
    let d = c.replace(/[\s-]/g, '');
    if (d.startsWith('00')) d = '+' + d.slice(2);
    const digitsOnly = d.replace(/\D/g, '');
    if (/^07[789]\d{7}$/.test(digitsOnly)) { out.phone = '+962' + digitsOnly.slice(1); break; }
    if (d.startsWith('+') && digitsOnly.length >= 10 && digitsOnly.length <= 15) { out.phone = '+' + digitsOnly; break; }
    if (/^9627[789]\d{7}$/.test(digitsOnly)) { out.phone = '+' + digitsOnly; break; }
  }
  return out;
}

const TYPING_LEAD_SECONDS = 4;

function getBotConfig() {
  const settings = storageService.getSettings();
  const bot = settings.bot || {};
  const delay = Number(bot.reply_delay_seconds);
  const pauseHours = Number(bot.human_pause_hours);
  return {
    delaySeconds: Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_DELAY_SECONDS,
    quoteReplies: bot.quote_replies !== false,
    typingIndicator: bot.typing_indicator !== false,
    // A staff member replied to the customer → bot steps aside.
    pauseOnHumanReply: bot.pause_on_human_reply !== false,
    humanPauseHours: Number.isFinite(pauseHours) && pauseHours > 0 ? pauseHours : 0 // 0 = until re-enabled manually
  };
}


class ReplyEngine {
  constructor() {
    this.pending = new Map(); // convId -> { timer, typingTimer, adapter, running, rerun }
  }

  /**
   * Record an incoming customer message and schedule the delayed bot reply.
   */
  async ingest({
    channel,
    externalUserId,
    customerName,
    customerPhone,
    customerHandle,
    convExtra = {},
    text,
    externalMessageId = null,
    waRaw = null,
    isVoice = false,
    mediaType = null,
    mediaUrl = null,
    voiceTranscript = null,
    adapter
  }) {
    let conv = storageService.getConversationByChannelUser(channel, externalUserId);

    // Customer memory: not in the local cache? Restore their history from the database.
    if (!conv) {
      const restored = await supabaseService.fetchConversationWithHistory(channel, externalUserId);
      if (restored) {
        conv = storageService.saveConversation({ ...restored, ...convExtra });
        console.log(`[ReplyEngine] Restored ${channel}/${externalUserId} from database (${restored.messages.length} messages, bot ${restored.is_bot_active ? 'active' : 'OFF — human only'}).`);
      }
    }

    if (!conv) {
      conv = storageService.saveConversation({
        channel,
        external_user_id: externalUserId,
        customer_name: customerName || 'عميل محتمل',
        customer_phone: customerPhone || '',
        customer_handle: customerHandle || '',
        lead_stage: 'new',
        is_bot_active: true,
        ...convExtra
      });
      await supabaseService.saveConversation(conv);
    } else if (Object.keys(convExtra).length > 0 || (customerName && conv.customer_name !== customerName && /عميل|مستخدم|متابع/.test(conv.customer_name || ''))) {
      conv = storageService.saveConversation({
        id: conv.id,
        ...convExtra,
        ...(customerName && /عميل|مستخدم|متابع/.test(conv.customer_name || '') ? { customer_name: customerName } : {})
      });
    }

    // Ignore duplicate deliveries of the same platform message (webhook retries).
    if (externalMessageId && storageService.findMessageByExternalId(conv.id, externalMessageId)) {
      return { success: true, duplicate: true, conversation_id: conv.id };
    }

    const customerMsg = storageService.addMessage(conv.id, {
      sender: 'customer',
      content: text || '(ملف مرفق)',
      media_type: isVoice ? 'audio' : (mediaType || 'text'),
      media_url: mediaUrl,
      is_voice: isVoice,
      voice_transcript: voiceTranscript,
      external_message_id: externalMessageId,
      wa_raw: waRaw
    });
    supabaseService.saveMessage(customerMsg, conv.id).catch(() => {});

    // Capture phone / email the customer types (e.g. on Instagram/Facebook) — no AI needed.
    const contact = extractContact(text);
    const fresh = storageService.getConversationById(conv.id);
    const contactPatch = {};
    if (contact.phone && !fresh.customer_phone) contactPatch.customer_phone = contact.phone;
    if (contact.email && !fresh.customer_email) contactPatch.customer_email = contact.email;
    if (Object.keys(contactPatch).length) storageService.saveConversation({ id: conv.id, ...contactPatch });

    conv = this._resumeIfPauseExpired(storageService.getConversationById(conv.id));
    if (conv.is_bot_active === false) {
      // Handed off / staff is talking to them: the bot does NOT answer. Alert the sales team instead.
      console.log(`[ReplyEngine] ${conv.id} is with a human (${conv.pause_reason || 'handoff'}) — bot stays silent.`);
      crmService.upsertLead(conv).catch(() => {});
      notificationService.notifyNewMessageAfterHandoff(conv, customerMsg.content).catch(() => {});
      return { success: true, bot_scheduled: false, conversation_id: conv.id };
    }

    this.schedule(conv.id, adapter);
    return { success: true, bot_scheduled: true, conversation_id: conv.id, delay_seconds: getBotConfig().delaySeconds };
  }

  schedule(convId, adapter) {
    const { delaySeconds, typingIndicator } = getBotConfig();
    const state = this.pending.get(convId) || {};
    if (process.env.REPLY_DEBUG) console.log('[debug] schedule', convId, Date.now(), 'running=' + !!state.running, 'delay=' + delaySeconds);
    clearTimeout(state.timer);
    clearTimeout(state.typingTimer);
    state.adapter = adapter;

    if (state.running) {
      // A reply is being generated right now; answer the new message right after it.
      state.rerun = true;
      this.pending.set(convId, state);
      return;
    }

    if (typingIndicator && adapter?.typing) {
      const typingAt = Math.max(0, delaySeconds - TYPING_LEAD_SECONDS) * 1000;
      state.typingTimer = setTimeout(() => {
        const quoted = this._lastCustomerMessage(convId);
        Promise.resolve(adapter.markRead?.(storageService.getConversationById(convId), { quoted })).catch(() => {});
        Promise.resolve(adapter.typing(storageService.getConversationById(convId), { quoted })).catch(() => {});
      }, typingAt);
    }

    state.timer = setTimeout(() => this.flush(convId), delaySeconds * 1000);
    this.pending.set(convId, state);
  }

  _lastCustomerMessage(convId) {
    const conv = storageService.getConversationById(convId);
    const msgs = conv?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].sender === 'customer') return msgs[i];
    }
    return null;
  }

  // Customer messages that arrived after the last bot/agent message.
  _unansweredCustomerMessages(conv) {
    const msgs = conv?.messages || [];
    const out = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].sender !== 'customer') break;
      out.unshift(msgs[i]);
    }
    return out;
  }

  async flush(convId) {
    const state = this.pending.get(convId);
    if (process.env.REPLY_DEBUG) console.log('[debug] flush', convId, Date.now());
    if (!state) return;
    state.running = true;
    state.rerun = false;

    try {
      let conv = storageService.getConversationById(convId);
      if (!conv || conv.is_bot_active === false) return;

      const unanswered = this._unansweredCustomerMessages(conv);
      if (unanswered.length === 0) return;

      const quoted = unanswered[unanswered.length - 1];
      const combinedText = unanswered.map(m => m.content).join('\n');

      // AI sees history without the unanswered messages (they're passed as the new input).
      const historyConv = { ...conv, messages: conv.messages.slice(0, conv.messages.length - unanswered.length) };
      const aiResult = await aiService.generateReply(historyConv, combinedText);

      // Re-check: a human may have taken over while the AI was thinking.
      conv = storageService.getConversationById(convId);
      if (!conv || conv.is_bot_active === false) return;

      // Deal point / ready to buy / asked for a human → handoff message, then bot OFF for good.
      const handoff = crmService.shouldHandoff(aiResult);
      const replyText = handoff ? crmService.prepareHandoffMessage(conv.id) : aiResult.reply_text;
      if (handoff) {
        // Switch the bot off BEFORE sending so no parallel reply can slip through.
        conv = storageService.saveConversation({ id: conv.id, is_bot_active: false });
      }

      const { quoteReplies } = getBotConfig();
      const sendResult = await this.sendWithAdapter(state.adapter, conv, replyText, quoteReplies ? quoted : null);

      const botMsg = storageService.addMessage(conv.id, {
        sender: 'bot',
        content: replyText,
        media_type: 'text',
        external_message_id: sendResult.external_message_id || null,
        reply_to_id: quoteReplies ? quoted.id : null,
        reply_to_content: quoteReplies ? quoted.content : null,
        reply_to_sender: quoteReplies ? 'customer' : null,
        delivery_status: sendResult.ok ? 'sent' : (sendResult.simulated ? 'simulated' : 'failed')
      });
      supabaseService.saveMessage(botMsg, conv.id).catch(() => {});

      await this.applyAiState(conv, aiResult, handoff);
    } catch (err) {
      console.error(`[ReplyEngine] flush error for ${convId}:`, err.message);
    } finally {
      state.running = false;
      if (state.rerun) {
        this.schedule(convId, state.adapter);
      } else {
        this.pending.delete(convId);
      }
    }
  }

  async sendWithAdapter(adapter, conv, text, quoted) {
    if (!adapter?.send) {
      console.warn(`[ReplyEngine] No sender for channel ${conv.channel}. Simulated send:`, text);
      return { ok: false, simulated: true };
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = (await adapter.send(conv, text, { quoted })) || { ok: false };
        if (res.ok || res.simulated || attempt === 2) return res;
      } catch (err) {
        console.error(`[ReplyEngine] send failed on ${conv.channel} (attempt ${attempt}):`, err.message);
        if (attempt === 2) return { ok: false };
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    return { ok: false };
  }

  /**
   * Save what the AI learned about the customer (memory/profile), update the lead
   * everywhere, and run the human handoff when needed.
   */
  async applyAiState(conv, aiResult, handoff = crmService.shouldHandoff(aiResult)) {
    const keep = (v, old) => (v !== null && v !== undefined && String(v).trim() !== '' ? v : old);
    const prob = Number(String(aiResult.buying_probability ?? '').replace('%', ''));
    const patch = {
      id: conv.id,
      lead_stage: keep(aiResult.lead_stage, conv.lead_stage),
      classification: keep(aiResult.classification, conv.classification),
      interest_score: Number.isFinite(prob) && prob > 0 ? Math.min(100, prob) : conv.interest_score,
      identified_problem: keep(aiResult.identified_problem, conv.identified_problem),
      proposed_solution: keep(aiResult.proposed_solution, conv.proposed_solution),
      business_type: keep(aiResult.business_type, conv.business_type),
      customer_requests: keep(aiResult.customer_requests, conv.customer_requests),
      customer_summary: keep(aiResult.customer_summary, conv.customer_summary),
      objections: keep(aiResult.objections, conv.objections)
    };
    if (aiResult.customer_name && /عميل|مستخدم|متابع/.test(conv.customer_name || '')) patch.customer_name = aiResult.customer_name;
    if (aiResult.customer_phone && !conv.customer_phone) patch.customer_phone = aiResult.customer_phone;

    const updated = storageService.saveConversation(patch);
    await supabaseService.saveConversation(updated);

    if (handoff) {
      await crmService.handoff(updated.id, crmService.handoffReason(aiResult));
      return storageService.getConversationById(updated.id);
    }
    await crmService.upsertLead(updated);
    return updated;
  }

  // Used by the human-agent reply box in the dashboard (no delay, optional quote).
  async sendAgentMessage(conv, text, adapter, quotedMsgId = null) {
    const quoted = quotedMsgId ? conv.messages?.find(m => m.id === quotedMsgId) : null;
    const res = await this.sendWithAdapter(adapter, conv, text, quoted);
    const msg = storageService.addMessage(conv.id, {
      sender: 'agent',
      content: text,
      media_type: 'text',
      external_message_id: res.external_message_id || null,
      reply_to_id: quoted?.id || null,
      reply_to_content: quoted?.content || null,
      reply_to_sender: quoted?.sender || null,
      delivery_status: res.ok ? 'sent' : (res.simulated ? 'simulated' : 'failed')
    });
    supabaseService.saveMessage(msg, conv.id).catch(() => {});
    if (!String(conv.channel).startsWith('simulator')) this.pauseForHuman(conv.id, 'لوحة التحكم');
    return { msg, sent: !!res.ok };
  }

  /**
   * The sales team answered from outside the dashboard (e.g. WhatsApp on the phone).
   * Save it in the history and cancel any pending bot reply to that customer.
   */
  recordHumanMessage(convId, text, externalId = null, source = 'الجوال') {
    this.cancel(convId);
    const msg = storageService.addMessage(convId, { sender: 'agent', content: text, external_message_id: externalId, delivery_status: 'sent' });
    supabaseService.saveMessage(msg, convId).catch(() => {});
    this.pauseForHuman(convId, source);
    return msg;
  }

  /**
   * A staff member replied to this customer → the bot stops answering them,
   * either until someone re-enables it, or for `bot.human_pause_hours`.
   * Never touches a conversation that is already off (handoff / manual).
   */
  pauseForHuman(convId, source) {
    const cfg = getBotConfig();
    if (!cfg.pauseOnHumanReply) return null;
    const conv = storageService.getConversationById(convId);
    if (!conv || conv.is_bot_active === false) return null;
    this.cancel(convId);
    const now = Date.now();
    const updated = storageService.saveConversation({
      id: convId,
      is_bot_active: false,
      pause_reason: 'human_reply',
      paused_at: new Date(now).toISOString(),
      pause_source: source,
      bot_paused_until: cfg.humanPauseHours > 0 ? new Date(now + cfg.humanPauseHours * 3600 * 1000).toISOString() : null
    });
    console.log(`[ReplyEngine] ${convId}: staff replied (${source}) — bot paused ${cfg.humanPauseHours > 0 ? `for ${cfg.humanPauseHours}h` : 'until re-enabled'}.`);
    supabaseService.saveConversation(updated).catch(() => {});
    crmService.upsertLead(updated).catch(() => {});
    return updated;
  }

  // Temporary staff pause expired → bot takes over again. Handoffs never expire.
  _resumeIfPauseExpired(conv) {
    if (conv.is_bot_active !== false || conv.pause_reason !== 'human_reply' || !conv.bot_paused_until) return conv;
    if (Date.now() < new Date(conv.bot_paused_until).getTime()) return conv;
    console.log(`[ReplyEngine] ${conv.id}: staff pause ended — bot active again.`);
    const updated = storageService.saveConversation({ id: conv.id, is_bot_active: true, pause_reason: null, bot_paused_until: null, paused_at: null, pause_source: null });
    supabaseService.saveConversation(updated).catch(() => {});
    return updated;
  }

  /**
   * After a restart: answer customers whose last message arrived in the last
   * 15 minutes and is still unanswered (the 10s timer was lost with the restart).
   */
  resumePending(getAdapter) {
    const cutoff = Date.now() - 15 * 60 * 1000;
    let count = 0;
    for (const conv of storageService.getConversations()) {
      if (conv.is_bot_active === false || String(conv.channel).startsWith('simulator')) continue;
      const last = conv.messages?.[conv.messages.length - 1];
      if (!last || last.sender !== 'customer') continue;
      const at = new Date(last.created_at).getTime();
      // Only messages whose timer was lost with the restart (arrived before this boot), never live ones.
      if (at < cutoff || at >= BOOT_TIME || this.pending.has(conv.id)) continue;
      const adapter = getAdapter(conv);
      if (!adapter) continue;
      this.schedule(conv.id, adapter);
      count++;
    }
    if (count) console.log(`[ReplyEngine] Resumed ${count} unanswered conversation(s) after restart.`);
    return count;
  }

  cancel(convId) {
    const state = this.pending.get(convId);
    if (state) {
      clearTimeout(state.timer);
      clearTimeout(state.typingTimer);
      this.pending.delete(convId);
    }
  }
}

ReplyEngine.prototype.getBotConfig = getBotConfig;

const engine = new ReplyEngine();
engine.extractContact = extractContact;
module.exports = engine;
