/**
 * Telegram bot — messages to the admin(s): morning post ideas, publish results,
 * hot-lead alerts. Optionally posts to a Telegram channel as well.
 *
 * Setup (once): open @BotFather → /newbot → paste the token in the dashboard →
 * send /start to your bot → press "اكتشف رقم المحادثة" in the Marketing tab.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const storageService = require('./storageService');

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,\s]+/)).map(x => String(x).trim()).filter(Boolean);

class TelegramService {
  get esc() { return esc; }

  getConfig() {
    const t = storageService.getSettings().telegram || {};
    return {
      token: String(t.bot_token || process.env.TELEGRAM_BOT_TOKEN || '').trim(),
      chatIds: toList(t.chat_ids),
      channelId: String(t.channel_id || '').trim(),
      notifyHandoffs: t.notify_handoffs !== false
    };
  }

  isConfigured() {
    const c = this.getConfig();
    return !!(c.token && c.chatIds.length);
  }

  async call(method, payload = {}, { token = this.getConfig().token, timeout = 20000 } = {}) {
    if (!token) throw new Error('Telegram Bot Token غير مدخل');
    try {
      const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout });
      return res.data?.result;
    } catch (err) {
      throw new Error(err.response?.data?.description || err.message);
    }
  }

  /**
   * Send an HTML message to every admin chat (or to `chatIds`).
   * buttons: [[{ text, url }]] — URL buttons only work with public https links.
   */
  async sendMessage(html, { buttons = null, chatIds = null, type = 'message' } = {}) {
    const cfg = this.getConfig();
    const targets = chatIds || cfg.chatIds;
    if (!cfg.token || !targets.length) return { success: false, error: 'Telegram غير مربوط (التوكن أو رقم المحادثة ناقص)' };
    const rows = (buttons || [])
      .map(row => row.filter(b => /^https:\/\/(?!localhost|127\.)/.test(b.url || '')))
      .filter(row => row.length);
    let sent = 0;
    let lastError = '';
    for (const chat_id of targets) {
      try {
        await this.call('sendMessage', {
          chat_id,
          text: String(html).slice(0, 4000),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {})
        });
        sent++;
      } catch (err) {
        lastError = err.message;
        console.error(`[Telegram] sendMessage to ${chat_id} failed:`, err.message);
      }
    }
    const result = { success: sent > 0, sent, error: sent ? '' : lastError };
    this.logSent(type, html, targets, result);
    return result;
  }

  /** Every Telegram message is recorded (dashboard log + Supabase notification_log). */
  logSent(type, html, chatIds, result) {
    try {
      const subject = String(html).replace(/<[^>]+>/g, '').split('\n').find(l => l.trim()) || '';
      require('./notificationService').log({
        type: `telegram_${type}`,
        subject: subject.slice(0, 200),
        recipients: chatIds.map(c => `telegram:${c}`),
        status: result.success ? 'sent' : 'failed',
        error: result.error || null,
        created_at: new Date().toISOString()
      });
    } catch { /* logging never breaks sending */ }
  }

  /** Send a local image file with a caption (caption > 1024 chars is sent as a second message). */
  async sendPhoto(filePath, caption = '', chatId) {
    const cfg = this.getConfig();
    if (!cfg.token) throw new Error('Telegram Bot Token غير مدخل');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
    const short = caption.length <= 1024;
    if (caption && short) form.append('caption', caption);
    try {
      const res = await axios.post(`https://api.telegram.org/bot${cfg.token}/sendPhoto`, form, { timeout: 60000 });
      const msg = res.data?.result;
      if (caption && !short) await this.call('sendMessage', { chat_id: chatId, text: caption.slice(0, 4000) });
      return msg;
    } catch (err) {
      throw new Error(err.response?.data?.description || err.message);
    }
  }

  /** Chats that recently wrote to the bot (send /start first) — used to find the admin chat id. */
  async detectChats(tokenOverride = null) {
    const token = tokenOverride || this.getConfig().token;
    const updates = await this.call('getUpdates', { limit: 100, timeout: 0 }, { token });
    const chats = new Map();
    for (const u of updates || []) {
      const chat = (u.message || u.channel_post || u.my_chat_member)?.chat;
      if (!chat) continue;
      chats.set(String(chat.id), {
        id: String(chat.id),
        type: chat.type,
        name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id)
      });
    }
    return [...chats.values()];
  }

  async test(tokenOverride = null) {
    const token = tokenOverride || this.getConfig().token;
    try {
      const me = await this.call('getMe', {}, { token });
      const cfg = this.getConfig();
      if (!cfg.chatIds.length) {
        return { success: true, bot: me.username, message: `البوت @${me.username} شغال ✅ — ابعث /start للبوت من تليجرام ثم اضغط "اكتشف رقم المحادثة".` };
      }
      const res = await this.sendMessage('✅ <b>atlead</b>: ربط تليجرام شغال. رح توصلك هون اقتراحات البوستات كل صباح.', { type: 'test' });
      return res.success
        ? { success: true, bot: me.username, message: `تم إرسال رسالة تجريبية من @${me.username} ✅` }
        : { success: false, message: `البوت شغال بس الإرسال فشل: ${res.error} — تأكد إنك بعثت /start للبوت.` };
    } catch (err) {
      return { success: false, message: `فشل الاتصال بتليجرام: ${err.message}` };
    }
  }

  /** Hot lead handed to a human → instant Telegram alert (in addition to the email). */
  async notifyHandoff(conv, prob, links = []) {
    const cfg = this.getConfig();
    if (!this.isConfigured() || !cfg.notifyHandoffs) return null;
    if (String(conv.channel || '').startsWith('simulator')) return null;
    const lines = [
      `🔥 <b>عميل جاهز للتواصل</b> — ${esc(prob)}%`,
      `👤 ${esc(conv.customer_name || 'عميل')}`,
      conv.business_type ? `🏢 ${esc(conv.business_type)}` : '',
      conv.customer_requests ? `📝 ${esc(String(conv.customer_requests).slice(0, 300))}` : '',
      conv.handoff_reason ? `➡️ ${esc(conv.handoff_reason)}` : ''
    ].filter(Boolean);
    return this.sendMessage(lines.join('\n'), { buttons: links.slice(0, 3).map(l => [{ text: l.label, url: l.url }]), type: 'hot_lead' });
  }
}

module.exports = new TelegramService();
