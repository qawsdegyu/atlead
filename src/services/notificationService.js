/**
 * Email notifications to the sales team (Gmail SMTP).
 *
 * Setup (once): Google Account → Security → 2-Step Verification ON →
 * "App passwords" → create one → paste the 16-char password in the dashboard.
 * Recipient emails are managed from the admin settings page and stored in the DB
 * (app_settings → notifications.recipients).
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');

const LOG_FILE = path.join(storageService.getDataDir(), 'notifications.json');
const NEW_MESSAGE_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const HOLDABLE = ['handoff', 'new_message_after_handoff'];
const businessHours = require('./businessHours');

const CHANNEL_LABELS = {
  whatsapp: 'واتساب',
  instagram_dm: 'إنستغرام',
  facebook_messenger: 'فيسبوك ماسنجر',
  simulator: 'محاكي تجريبي'
};

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Amman', hour12: false }); } catch { return iso || ''; }
};

class NotificationService {
  getConfig() {
    const n = storageService.getSettings().notifications || {};
    return {
      enabled: n.enabled !== false,
      gmailUser: (n.gmail_user || '').trim(),
      gmailPassword: (n.gmail_app_password || '').replace(/\s+/g, ''),
      recipients: (Array.isArray(n.recipients) ? n.recipients : []).map(e => String(e).trim()).filter(isEmail),
      dashboardUrl: (n.dashboard_url && !/localhost|127\.0\.0\.1/.test(n.dashboard_url) ? n.dashboard_url : (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : n.dashboard_url || '')).replace(/\/+$/, ''),
      notifyNewMessages: n.notify_new_messages_after_handoff !== false
    };
  }

  isConfigured() {
    const c = this.getConfig();
    const team = (storageService.getSettings().sales_team?.members || []).filter(m => m && m.active !== false && isEmail(m.email));
    return !!(c.enabled && c.gmailUser && c.gmailPassword && (c.recipients.length || team.length));
  }

  transporter(cfg) {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: cfg.gmailUser, pass: cfg.gmailPassword }
    });
  }

  async send({ type, subject, html, text, conversationId = null, leadId = null, recipientsOverride = null, force = false }) {
    const cfg = this.getConfig();
    const recipients = [...new Set((recipientsOverride || cfg.recipients).map(e => String(e).trim().toLowerCase()).filter(isEmail))];
    const entry = { type, subject, recipients, conversation_id: conversationId, lead_id: leadId, created_at: new Date().toISOString() };

    if (!cfg.enabled && type !== 'test') {
      return this.log({ ...entry, status: 'failed', error: 'الإشعارات متوقفة من الإعدادات' });
    }

    // Outside working hours (if chosen): hold staff alerts until the next opening.
    if (!force && HOLDABLE.includes(type) && businessHours.getConfig().hold_emails_until_open && !businessHours.isOpen()) {
      const queue = storageService.getState('email_queue', []);
      queue.push({ type, subject, html, text, conversationId, leadId, recipients, queued_at: new Date().toISOString() });
      storageService.setState('email_queue', queue);
      const next = businessHours.nextOpening();
      return { ...this.log({ ...entry, status: 'queued', error: `خارج الدوام — بينبعت ${next ? next.label : 'أول الدوام'}` }), queued: true };
    }
    if (!cfg.gmailUser || !cfg.gmailPassword) {
      return this.log({ ...entry, status: 'failed', error: 'إيميل Gmail المرسل أو App Password غير مدخل' });
    }
    if (!recipients.length) {
      return this.log({ ...entry, status: 'failed', error: 'لا يوجد إيميلات مستلمين' });
    }

    try {
      await this.transporter(cfg).sendMail({
        from: `"atlead Sales Bot" <${cfg.gmailUser}>`,
        to: recipients.join(', '),
        subject,
        text,
        html
      });
      return this.log({ ...entry, status: 'sent' });
    } catch (err) {
      const msg = /Invalid login|Username and Password not accepted|BadCredentials/i.test(err.message)
        ? 'Gmail رفض الدخول — استخدم App Password (مش كلمة سر الحساب) وتأكد من تفعيل التحقق بخطوتين'
        : err.message;
      console.error('[Email] send failed:', msg);
      return this.log({ ...entry, status: 'failed', error: msg });
    }
  }

  log(entry) {
    try {
      const list = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')) : [];
      list.unshift(entry);
      fs.writeFileSync(LOG_FILE, JSON.stringify(list.slice(0, 500), null, 2), 'utf-8');
    } catch (e) {
      console.error('[Email] log write error:', e.message);
    }
    supabaseService.logNotification(entry).catch(() => {});
    return { success: entry.status === 'sent', ...entry };
  }

  getLog(limit = 50) {
    try {
      return fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')).slice(0, limit) : [];
    } catch {
      return [];
    }
  }

  // Who gets alerts about this customer: the assigned rep + management emails.
  recipientsFor(conv) {
    const cfg = this.getConfig();
    const list = [...cfg.recipients];
    if (conv?.assigned_to_email && isEmail(conv.assigned_to_email)) list.unshift(conv.assigned_to_email);
    return [...new Set(list.map(e => e.toLowerCase()))];
  }

  // Send everything that was held outside working hours. Returns how many were sent.
  async flushQueue(onSent) {
    if (!businessHours.isOpen()) return 0;
    const queue = storageService.getState('email_queue', []);
    if (!queue.length) return 0;
    storageService.setState('email_queue', []);
    let sent = 0;
    const failed = [];
    for (const item of queue) {
      const res = await this.send({ ...item, recipientsOverride: item.recipients, force: true });
      if (res.success) { sent++; if (onSent) await onSent(item); } else failed.push(item);
    }
    if (failed.length) storageService.setState('email_queue', [...storageService.getState('email_queue', []), ...failed]);
    return sent;
  }

  contactLinks(conv) {
    const links = [];
    const phoneDigits = String(require('./crmService').crmPhone(conv) || '').replace(/\D/g, '').replace(/^00/, '');
    if (phoneDigits.length >= 8) links.push({ label: `واتساب +${phoneDigits}`, url: `https://wa.me/${phoneDigits}` });
    if (conv.channel === 'instagram_dm' && conv.customer_handle) {
      links.push({ label: `إنستغرام ${conv.customer_handle}`, url: `https://instagram.com/${conv.customer_handle.replace(/^@/, '')}` });
    }
    const dash = this.getConfig().dashboardUrl;
    if (dash) links.push({ label: 'فتح المحادثة بلوحة التحكم', url: `${dash}/?conversation=${encodeURIComponent(conv.id)}` });
    return links;
  }

  transcriptHtml(conv, limit = 15) {
    const msgs = (conv.messages || []).slice(-limit);
    return msgs.map(m => {
      const who = m.sender === 'customer' ? 'العميل' : m.sender === 'agent' ? 'الموظف' : 'البوت';
      const bg = m.sender === 'customer' ? '#f1f5f9' : '#ecfdf5';
      return `<div style="background:${bg};border-radius:8px;padding:8px 10px;margin:6px 0;">
        <div style="font-size:11px;color:#64748b;">${who} · ${esc(fmtDate(m.created_at))}</div>
        <div style="font-size:14px;color:#0f172a;white-space:pre-wrap;">${esc(m.content)}</div>
      </div>`;
    }).join('');
  }

  rowsHtml(rows) {
    return rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `
      <tr>
        <td style="padding:8px 10px;background:#f8fafc;color:#475569;font-weight:bold;white-space:nowrap;border-bottom:1px solid #e2e8f0;">${esc(k)}</td>
        <td style="padding:8px 10px;color:#0f172a;border-bottom:1px solid #e2e8f0;white-space:pre-wrap;">${esc(v)}</td>
      </tr>`).join('');
  }

  // Sent once when the bot hands a ready-to-buy customer over to a human.
  async sendHandoffEmail(conv, lead) {
    const channel = CHANNEL_LABELS[conv.channel] || conv.channel;
    const prob = Number(conv.interest_score) || Number(lead?.buying_probability) || 0;
    const subject = `${String(conv.channel).startsWith('simulator') ? '[تجربة من المحاكي] ' : ''}${conv.assigned_to_name ? `[${conv.assigned_to_name}] ` : ''}🔥 عميل جاهز للتواصل: ${conv.customer_name || 'عميل'} — ${prob}% — ${channel}`;
    const links = this.contactLinks(conv);
    const rows = [
      ['اسم العميل', conv.customer_name],
      ['رقم الهاتف', require('./crmService').crmPhone(conv) || 'لم يعطِ رقمه بعد — رد عليه من نفس المحادثة بلوحة التحكم'],
      ['الإيميل', conv.customer_email],
      ['القناة', channel],
      ['الحساب', conv.customer_handle],
      ['نوع النشاط', conv.business_type],
      ['شو طلب', conv.customer_requests],
      ['المشكلة', conv.identified_problem],
      ['الحل المقترح', conv.proposed_solution],
      ['نسبة الشراء', `${prob}%`],
      ['المرحلة', conv.lead_stage],
      ['التردد / الاعتراضات', conv.objections],
      ['ملخص السيلز', conv.customer_summary],
      ['الموظف المسؤول', conv.assigned_to_name ? `${conv.assigned_to_name} (${conv.assigned_to_email})` : ''],
      ['سبب التحويل', conv.handoff_reason],
      ['أول تواصل', fmtDate(conv.created_at)]
    ];

    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:680px;margin:auto;">
      <div style="background:#0f172a;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;">
        <div style="font-size:18px;font-weight:bold;">🔥 وصلنا عميل جاهز — تواصل معه الآن</div>
        <div style="font-size:13px;color:#cbd5e1;margin-top:4px;">البوت أوقف الرد على هذا العميل نهائياً. المحادثة صارت إلك.</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:16px 20px;border-radius:0 0 12px 12px;">
        ${links.length ? `<div style="margin-bottom:14px;">${links.map(l => `<a href="${esc(l.url)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:8px 14px;border-radius:8px;margin:0 0 6px 6px;font-size:13px;">${esc(l.label)}</a>`).join('')}</div>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:14px;">${this.rowsHtml(rows)}</table>
        <h3 style="font-size:15px;margin:20px 0 6px;">آخر الرسائل</h3>
        ${this.transcriptHtml(conv)}
      </div>
    </div>`;

    // Instant alert on Telegram as well (if the bot is connected).
    require('./telegramService').notifyHandoff(conv, prob, links).catch(() => {});

    const text = [
      'عميل جاهز للتواصل — البوت أوقف الرد عليه.',
      ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
      ...links.map(l => `${l.label}: ${l.url}`)
    ].join('\n');

    return this.send({ type: 'handoff', subject, html, text, conversationId: conv.id, leadId: lead?.id, recipientsOverride: this.recipientsFor(conv) });
  }

  // Customer wrote again after the handoff — the bot stays silent, so alert the human (throttled).
  async notifyNewMessageAfterHandoff(conv, messageText) {
    const cfg = this.getConfig();
    if (!cfg.notifyNewMessages) return null;
    const last = conv.last_human_alert_at ? new Date(conv.last_human_alert_at).getTime() : 0;
    if (Date.now() - last < NEW_MESSAGE_ALERT_COOLDOWN_MS) return null;
    storageService.saveConversation({ id: conv.id, last_human_alert_at: new Date().toISOString() });

    const channel = CHANNEL_LABELS[conv.channel] || conv.channel;
    const links = this.contactLinks(conv);
    const subject = `💬 رسالة جديدة من ${conv.customer_name || 'عميل'} (${channel}) — بانتظار ردك`;
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:640px;margin:auto;">
      <p style="font-size:15px;">العميل <b>${esc(conv.customer_name)}</b> بعث رسالة جديدة. البوت ما رح يرد عليه لأنه محوّل لك.</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:10px;font-size:14px;white-space:pre-wrap;">${esc(messageText)}</div>
      <div style="margin-top:12px;">${links.map(l => `<a href="${esc(l.url)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:8px 14px;border-radius:8px;margin:0 0 6px 6px;font-size:13px;">${esc(l.label)}</a>`).join('')}</div>
    </div>`;
    return this.send({
      type: 'new_message_after_handoff',
      subject,
      html,
      text: `${conv.customer_name}: ${messageText}\n${links.map(l => l.url).join('\n')}`,
      conversationId: conv.id,
      recipientsOverride: this.recipientsFor(conv)
    });
  }

  async sendTest(recipientsOverride = null) {
    const cfg = this.getConfig();
    const team = (storageService.getSettings().sales_team?.members || []).filter(m => m && m.active !== false).map(m => m.email);
    const recipients = [...new Set((recipientsOverride || [...cfg.recipients, ...team]).filter(isEmail))];
    return this.send({
      type: 'test',
      subject: '✅ تجربة إشعارات atlead',
      html: '<div dir="rtl" style="font-family:Tahoma,Arial">الإشعارات شغالة ✅ — رح يوصلك إيميل هيك لما يكون في عميل جاهز للتواصل.</div>',
      text: 'الإشعارات شغالة ✅',
      recipientsOverride: recipients
    });
  }
}

NotificationService.isEmail = isEmail;
module.exports = new NotificationService();
