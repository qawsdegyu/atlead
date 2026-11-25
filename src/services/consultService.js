/**
 * Free-consultation form (public page /consult). A filled form becomes a "Prospect" lead
 * in the CRM, Supabase and Google Sheets, and the team is told on Telegram.
 * When the form came from a comment DM (?ref=<comment id>), the lead joins that
 * commenter's existing Instagram/Facebook conversation instead of making a new one.
 */
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');

const NEEDS = {
  chatbot: { ar: 'بوت ذكي للرد على العملاء', en: 'AI chatbot for customer replies' },
  sales: { ar: 'نظام مبيعات و CRM', en: 'Sales system & CRM' },
  marketing: { ar: 'تسويق ومحتوى', en: 'Marketing & content' },
  voice: { ar: 'مساعد مكالمات صوتي', en: 'AI voice assistant' },
  other: { ar: 'غير ذلك', en: 'Something else' }
};

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
const digits = (v) => String(v || '').replace(/[^\d+]/g, '');

class ConsultService {
  get NEEDS() { return NEEDS; }

  validate(body = {}) {
    const f = {
      name: clip(body.name, 80),
      phone: clip(body.phone, 30),
      email: clip(body.email, 120).toLowerCase(),
      company: clip(body.company, 100),
      business: clip(body.business, 100),
      need: NEEDS[body.need] ? body.need : 'other',
      message: clip(body.message, 1200),
      preferred_time: clip(body.preferred_time, 120),
      ref: clip(body.ref, 120),
      lang: body.lang === 'en' ? 'en' : 'ar'
    };
    const errors = {};
    if (f.name.length < 2) errors.name = true;
    if (digits(f.phone).replace('+', '').length < 7) errors.phone = true;
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) errors.email = true;
    return { f, errors };
  }

  /** The conversation this form belongs to: the commenter's DM chat, the same phone's earlier form, or a new one. */
  conversationFor(f) {
    if (f.ref) {
      const comment = storageService.getCommentByCommentId(f.ref);
      const convId = comment?.conversation_id;
      const conv = convId ? storageService.getConversationById(convId) : null;
      if (conv) return { conv, comment };
      if (comment) {
        const channel = comment.platform === 'instagram' ? 'instagram_dm' : 'facebook_messenger';
        const existing = comment.user_id && comment.user_id !== 'unknown' ? storageService.getConversationByChannelUser(channel, comment.user_id) : null;
        if (existing) return { conv: existing, comment };
      }
    }
    const key = `form_${digits(f.phone).replace('+', '')}`;
    return { conv: storageService.getConversationByChannelUser('website', key), comment: null, key };
  }

  async submit(body) {
    const { f, errors } = this.validate(body);
    if (Object.keys(errors).length) return { ok: false, errors };

    const { conv: found, comment, key } = this.conversationFor(f);
    const needLabel = NEEDS[f.need].ar;
    const request = [needLabel, f.message].filter(Boolean).join(' — ');
    const base = found || storageService.saveConversation({
      channel: 'website',
      external_user_id: key,
      customer_name: f.name,
      lead_stage: 'prospect',
      classification: 'Warm',
      interest_score: 60,
      is_bot_active: false,
      pause_reason: 'form',
      source: 'consult_form'
    });

    storageService.saveConversation({
      id: base.id,
      customer_name: f.name,
      customer_phone: f.phone,
      ...(f.email ? { customer_email: f.email } : {}),
      ...(f.company ? { company_name: f.company } : {}),
      ...(f.business ? { business_type: f.business } : {}),
      customer_requests: request,
      consultation_requested: true,
      ...(f.preferred_time ? { requested_meeting_time: f.preferred_time } : {}),
      lead_stage: ['won', 'deal_closing', 'handed_off', 'hot'].includes(base.lead_stage) ? base.lead_stage : 'prospect',
      classification: base.classification === 'Hot' ? 'Hot' : 'Warm',
      interest_score: Math.max(Number(base.interest_score) || 0, 60),
      lead_type: 'prospect',
      form_submitted_at: new Date().toISOString(),
      form_source: comment ? `${comment.platform} comment` : 'consult form'
    });

    const summary = [
      'طلب استشارة مجانية (نموذج):',
      `الاسم: ${f.name}`,
      `الهاتف: ${f.phone}`,
      f.email ? `الإيميل: ${f.email}` : '',
      f.company ? `الشركة: ${f.company}` : '',
      f.business ? `النشاط: ${f.business}` : '',
      `يحتاج: ${needLabel}`,
      f.message ? `التفاصيل: ${f.message}` : '',
      f.preferred_time ? `الوقت المناسب: ${f.preferred_time}` : ''
    ].filter(Boolean).join('\n');
    const msg = storageService.addMessage(base.id, { sender: 'customer', content: summary, source: 'consult_form' });

    const conv = storageService.getConversationById(base.id);
    await supabaseService.saveConversation(conv).catch(() => {});
    supabaseService.saveMessage(msg, conv.id).catch(() => {});
    const lead = await require('./crmService').upsertLead(conv.id).catch(() => null);

    this.notify(conv, f, needLabel, comment).catch(() => {});
    return { ok: true, lead_id: lead?.id || null, conversation_id: conv.id };
  }

  async notify(conv, f, needLabel, comment) {
    const tg = require('./telegramService');
    if (!tg.isConfigured()) return null;
    const esc = (s) => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const lines = [
      '<b>عميل محتمل جديد — نموذج الاستشارة المجانية</b>',
      `الاسم: ${esc(f.name)}`,
      `الهاتف: ${esc(f.phone)}`,
      f.email ? `الإيميل: ${esc(f.email)}` : '',
      f.company || f.business ? `النشاط: ${esc([f.company, f.business].filter(Boolean).join(' — '))}` : '',
      `يحتاج: ${esc(needLabel)}`,
      f.message ? `التفاصيل: ${esc(f.message.slice(0, 300))}` : '',
      f.preferred_time ? `الوقت المناسب: ${esc(f.preferred_time)}` : '',
      comment ? `المصدر: تعليق "${esc(comment.comment_text)}" على ${comment.platform === 'instagram' ? 'إنستغرام' : 'فيسبوك'}` : ''
    ].filter(Boolean);
    let wa = digits(f.phone).replace('+', '').replace(/^00/, '');
    if (/^07\d{8}$/.test(wa)) wa = `962${wa.slice(1)}`; // Jordanian local number
    return tg.sendMessage(lines.join('\n'), { buttons: wa ? [[{ text: 'واتساب العميل', url: `https://wa.me/${wa}` }]] : null, type: 'consult_form' });
  }
}

module.exports = new ConsultService();
