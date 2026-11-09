/**
 * Follow-up for interested customers who went quiet.
 *
 * Rules (all must be true):
 *  - Bot is active for the customer (not handed off / not with staff).
 *  - The last message in the chat is from the bot (customer didn't answer).
 *  - The customer's last message is between `after_hours` (default 20h) and 23.5h old.
 *    (Meta & WhatsApp only allow business messages within 24h of the customer's last message.)
 *  - Buying probability is between `min_probability` (default 50%) and the handoff threshold.
 *  - At most ONE follow-up per silence, and `max_per_customer` (default 2) in total.
 *  - Only during working hours (or 09:00–21:00 if working hours are off).
 *  - At most one follow-up per minute overall (natural pace, protects the WhatsApp number).
 */
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');
const aiService = require('./aiService');
const businessHours = require('./businessHours');

const CHANNELS = ['whatsapp', 'instagram_dm', 'facebook_messenger'];
const WINDOW_HOURS = 23.5;

class FollowUpService {
  getConfig() {
    const f = storageService.getSettings().follow_up || {};
    const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
    return {
      enabled: f.enabled !== false,
      afterHours: Math.min(23, Math.max(1, num(f.after_hours, 20))),
      minProbability: Math.min(84, Math.max(0, num(f.min_probability, 50))),
      maxPerCustomer: Math.max(1, num(f.max_per_customer, 2)),
      useAi: f.use_ai !== false,
      template: f.template || 'أهلين {name} 👋 حبيت أطمّن عليك، إذا عندك أي سؤال بخصوص {topic} أنا موجود وبساعدك بكل سرور. شو رأيك نكمل؟'
    };
  }

  handoffThreshold() {
    const t = Number(storageService.getSettings().handoff?.closing_deal_threshold_percent);
    return Number.isFinite(t) && t > 0 ? t : 85;
  }

  /**
   * When this customer would get the next automatic follow-up if they stay silent
   * (ISO time), or null if they won't get one.
   */
  nextFollowUpAt(conv, now = Date.now()) {
    const cfg = this.getConfig();
    if (!cfg.enabled || !conv || conv.is_bot_active === false) return null;
    const prob = Number(conv.interest_score) || 0;
    if (prob < cfg.minProbability || prob >= this.handoffThreshold()) return null;
    if ((Number(conv.follow_up_count) || 0) >= cfg.maxPerCustomer) return null;
    return new Date(now + cfg.afterHours * 3600 * 1000).toISOString();
  }

  findCandidates(now = Date.now()) {
    const cfg = this.getConfig();
    const threshold = this.handoffThreshold();
    const out = [];
    for (const conv of storageService.getConversations()) {
      if (!CHANNELS.includes(conv.channel) || conv.is_bot_active === false) continue;
      const msgs = conv.messages || [];
      const last = msgs[msgs.length - 1];
      if (!last || last.sender !== 'bot') continue;
      const lastCustomer = [...msgs].reverse().find(m => m.sender === 'customer');
      if (!lastCustomer) continue;
      const silentHours = (now - new Date(lastCustomer.created_at).getTime()) / 3600000;
      if (silentHours < cfg.afterHours || silentHours > WINDOW_HOURS) continue;
      const prob = Number(conv.interest_score) || 0;
      if (prob < cfg.minProbability || prob >= threshold) continue;
      if ((conv.follow_up_count || 0) >= cfg.maxPerCustomer) continue;
      if (conv.follow_up_for_message === lastCustomer.id) continue; // already followed up this silence
      out.push({ conv, lastCustomer, silentHours });
    }
    // Oldest silence first (closest to the 24h window closing).
    return out.sort((a, b) => b.silentHours - a.silentHours);
  }

  async generateText(conv) {
    const cfg = this.getConfig();
    const name = (conv.customer_name || '').replace(/\(.*?\)/g, '').trim();
    const firstName = /عميل|مستخدم|متابع/.test(name) ? '' : name.split(' ')[0];
    if (cfg.useAi) {
      try {
        const history = (conv.messages || []).slice(-6).map(m => `${m.sender === 'customer' ? 'العميل' : 'المساعد'}: ${m.content}`).join('\n');
        const result = await aiService.callJson(
          'أنت مستشار مبيعات أردني محترف لشركة atlead. اكتب رسالة متابعة واحدة قصيرة (سطرين كحد أقصى) باللهجة الأردنية لعميل ما رد من فترة. لطيفة وغير ملحّة، تذكّره بالموضوع اللي كان مهتم فيه، وتنتهي بسؤال بسيط يشجعه يرد. بدون أسعار وبدون ضغط. أعد JSON: {"message": "..."}',
          `اسم العميل: ${firstName || 'غير معروف'}\nملخص: ${conv.customer_summary || conv.customer_requests || 'غير متوفر'}\nآخر الرسائل:\n${history}`
        );
        if (result?.message && String(result.message).trim().length > 5) return String(result.message).trim();
      } catch (err) {
        console.warn('[FollowUp] AI text failed, using template:', err.message);
      }
    }
    const topic = conv.customer_requests || conv.identified_problem || 'أنظمة المبيعات الذكية';
    return cfg.template
      .replace(/\{name\}/g, firstName)
      .replace(/\{topic\}/g, String(topic).split(/[،,|\n]/)[0].trim().slice(0, 60))
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Sends at most ONE follow-up. Called every minute by the scheduler.
   * getAdapter(conv) → channel sender.
   */
  async runOnce(getAdapter, { ignoreHours = false } = {}) {
    const cfg = this.getConfig();
    if (!cfg.enabled) return { sent: 0, reason: 'disabled' };
    if (!ignoreHours && !businessHours.canSendProactive()) return { sent: 0, reason: 'outside hours' };
    const [candidate] = this.findCandidates();
    if (!candidate) return { sent: 0, reason: 'no candidates' };
    const { conv, lastCustomer } = candidate;

    const adapter = getAdapter(conv);
    if (!adapter) return { sent: 0, reason: 'no adapter' };
    // Channel not connected (e.g. WhatsApp QR disconnected) → try again later, don't burn the follow-up.
    if (adapter.isReady && !adapter.isReady()) return { sent: 0, reason: 'channel not connected' };

    // Mark first so a slow AI/send can never cause a double follow-up.
    storageService.saveConversation({ id: conv.id, follow_up_for_message: lastCustomer.id });
    const text = await this.generateText(conv);

    // Customer may have answered / staff may have taken over while generating.
    const fresh = storageService.getConversationById(conv.id);
    if (!fresh || fresh.is_bot_active === false || fresh.messages[fresh.messages.length - 1]?.sender !== 'bot') {
      return { sent: 0, reason: 'conversation changed' };
    }

    let res = { ok: false };
    try {
      res = (await adapter.send(fresh, text, {})) || { ok: false };
    } catch (err) {
      console.error('[FollowUp] send failed:', err.message);
    }
    const msg = storageService.addMessage(conv.id, {
      sender: 'bot',
      content: text,
      external_message_id: res.external_message_id || null,
      delivery_status: res.ok ? 'sent' : (res.simulated ? 'simulated' : 'failed'),
      is_follow_up: true
    });
    const updated = storageService.saveConversation({
      id: conv.id,
      follow_up_count: (fresh.follow_up_count || 0) + 1,
      last_follow_up_at: new Date().toISOString(),
      next_follow_up_at: this.nextFollowUpAt({ ...fresh, follow_up_count: (fresh.follow_up_count || 0) + 1 }),
      notes: [fresh.notes, `لم يرد العميل بعد آخر رسالة؛ تم إرسال متابعة رقم ${(fresh.follow_up_count || 0) + 1}`].filter(Boolean).join(' | ')
    });
    supabaseService.saveMessage(msg, conv.id).catch(() => {});
    supabaseService.saveConversation(updated).catch(() => {});
    require('./crmService').upsertLead(updated).catch(() => {});
    console.log(`[FollowUp] Sent to ${conv.customer_name} (${conv.channel}, ${conv.interest_score}%) — ${res.ok ? 'delivered' : res.simulated ? 'simulated' : 'FAILED'}`);
    return { sent: 1, conversation_id: conv.id, text, delivered: !!res.ok };
  }
}

module.exports = new FollowUpService();
