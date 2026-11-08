/**
 * Daily sales report email (to the management emails), sent once a day at the chosen time.
 * Covers the local business day (Asia/Amman by default).
 */
const storageService = require('./storageService');
const businessHours = require('./businessHours');
const notificationService = require('./notificationService');

const CHANNEL_LABELS = { whatsapp: 'واتساب', instagram_dm: 'إنستغرام', facebook_messenger: 'فيسبوك ماسنجر' };
const CHANNELS = Object.keys(CHANNEL_LABELS);
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

class ReportService {
  getConfig() {
    const r = storageService.getSettings().daily_report || {};
    return { enabled: r.enabled !== false, time: /^\d{2}:\d{2}$/.test(r.time || '') ? r.time : '20:00' };
  }

  dayKey(iso) {
    return iso ? businessHours.localParts(new Date(iso)).dateKey : null;
  }

  buildStats(dateKey = businessHours.localParts().dateKey) {
    const inDay = (iso) => this.dayKey(iso) === dateKey;
    const convs = storageService.getConversations().filter(c => !String(c.channel).startsWith('simulator') && !String(c.id).startsWith('conv_demo_'));
    const leads = storageService.getLeads().filter(l => !String(l.channel).startsWith('simulator') && !String(l.conversation_id || '').startsWith('conv_demo_'));
    const comments = storageService.getComments().filter(c => !c.simulated);

    const perChannel = {};
    for (const ch of CHANNELS) perChannel[ch] = { new: 0, handoffs: 0, customer_messages: 0 };

    let customerMessages = 0;
    let followUps = 0;
    const activeToday = new Set();
    for (const c of convs) {
      const pc = perChannel[c.channel];
      if (inDay(c.created_at) && pc) pc.new++;
      if (c.handoff_at && inDay(c.handoff_at) && c.pause_reason !== 'human_reply' && c.pause_reason !== 'manual' && pc) pc.handoffs++;
      for (const m of c.messages || []) {
        if (!inDay(m.created_at)) continue;
        if (m.sender === 'customer') { customerMessages++; activeToday.add(c.id); if (pc) pc.customer_messages++; }
        if (m.is_follow_up) followUps++;
      }
    }

    const handoffs = convs.filter(c => c.handoff_at && inDay(c.handoff_at) && c.pause_reason !== 'human_reply' && c.pause_reason !== 'manual');
    const won = leads.filter(l => l.purchase_status === 'won' && inDay(l.purchase_status_at || l.updated_at));
    const lost = leads.filter(l => l.purchase_status === 'lost' && inDay(l.purchase_status_at || l.updated_at));

    // Hot customers still with the bot (worth a look)
    const hot = convs
      .filter(c => c.is_bot_active !== false && (Number(c.interest_score) || 0) >= 70 && activeToday.has(c.id))
      .sort((a, b) => (b.interest_score || 0) - (a.interest_score || 0))
      .slice(0, 5);

    // Handed off more than 24h ago and still no result → needs attention
    const waiting = leads
      .filter(l => l.purchase_status === 'pending_human' && l.handed_off_at && Date.now() - new Date(l.handed_off_at).getTime() > 24 * 3600 * 1000)
      .slice(0, 10);

    const perRep = {};
    for (const c of handoffs) {
      const name = c.assigned_to_name || 'غير مُسند';
      perRep[name] = (perRep[name] || 0) + 1;
    }

    const commentsToday = comments.filter(c => inDay(c.created_at));
    return {
      dateKey,
      newCustomers: Object.values(perChannel).reduce((a, c) => a + c.new, 0),
      activeCustomers: activeToday.size,
      customerMessages,
      handoffs: handoffs.length,
      won: won.length,
      lost: lost.length,
      followUps,
      comments: commentsToday.length,
      interestedComments: commentsToday.filter(c => c.is_interested).length,
      dmsFromComments: commentsToday.filter(c => c.dm_triggered).length,
      perChannel,
      perRep,
      hot: hot.map(c => ({ name: c.customer_name, channel: CHANNEL_LABELS[c.channel] || c.channel, score: c.interest_score, summary: c.customer_summary || c.customer_requests || '' })),
      waiting: waiting.map(l => ({ name: l.name, rep: l.assigned_to_name || '-', since: l.handed_off_at, phone: l.phone || l.customer_handle || '' }))
    };
  }

  renderHtml(s) {
    const card = (label, value, color = '#0f172a') => `<td style="padding:10px;text-align:center;background:#f8fafc;border-radius:8px;"><div style="font-size:24px;font-weight:bold;color:${color};">${value}</div><div style="font-size:12px;color:#64748b;">${label}</div></td>`;
    const channelRows = CHANNELS.map(ch => {
      const c = s.perChannel[ch];
      const rate = c.new ? Math.round((c.handoffs / c.new) * 100) : 0;
      return `<tr><td style="padding:6px 10px;">${CHANNEL_LABELS[ch]}</td><td style="padding:6px 10px;text-align:center;">${c.new}</td><td style="padding:6px 10px;text-align:center;">${c.customer_messages}</td><td style="padding:6px 10px;text-align:center;">${c.handoffs}</td><td style="padding:6px 10px;text-align:center;">${rate}%</td></tr>`;
    }).join('');
    const repRows = Object.entries(s.perRep).map(([n, v]) => `<li>${esc(n)}: ${v}</li>`).join('') || '<li>لا يوجد</li>';
    const hotRows = s.hot.map(h => `<li><b>${esc(h.name)}</b> (${esc(h.channel)}) — ${h.score}%${h.summary ? `<br><span style="color:#64748b;font-size:12px;">${esc(String(h.summary).slice(0, 140))}</span>` : ''}</li>`).join('') || '<li>لا يوجد</li>';
    const waitRows = s.waiting.map(w => `<li><b>${esc(w.name)}</b> — ${esc(w.rep)} — محوّل من ${esc(new Date(w.since).toLocaleDateString('en-GB'))} ${w.phone ? `(${esc(w.phone)})` : ''}</li>`).join('') || '<li>ما في ✅</li>';

    return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:680px;margin:auto;">
      <div style="background:#0f172a;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;">
        <div style="font-size:18px;font-weight:bold;">📊 تقرير المبيعات اليومي — ${esc(s.dateKey)}</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:16px 20px;border-radius:0 0 12px 12px;">
        <table style="width:100%;border-spacing:6px;"><tr>
          ${card('عملاء جدد', s.newCustomers)}${card('محادثات نشطة', s.activeCustomers)}${card('تحويل للموظف', s.handoffs, '#16a34a')}
        </tr><tr>
          ${card('اشترى ✅', s.won, '#16a34a')}${card('لم يشترِ ❌', s.lost, '#dc2626')}${card('رسائل متابعة', s.followUps)}
        </tr></table>
        <h3 style="font-size:15px;margin:18px 0 6px;">حسب القناة</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr style="background:#f1f5f9;"><th style="padding:6px 10px;text-align:right;">القناة</th><th>عملاء جدد</th><th>رسائل العملاء</th><th>تحويل</th><th>نسبة التحويل</th></tr>
          ${channelRows}
        </table>
        <p style="font-size:13px;margin-top:12px;">💬 التعليقات: ${s.comments} (مهتمين: ${s.interestedComments}، رسائل خاصة انبعتت: ${s.dmsFromComments})</p>
        <h3 style="font-size:15px;margin:18px 0 6px;">التحويلات حسب الموظف</h3><ul style="font-size:13px;">${repRows}</ul>
        <h3 style="font-size:15px;margin:18px 0 6px;">🔥 عملاء مهتمين جداً (لسا مع البوت)</h3><ul style="font-size:13px;">${hotRows}</ul>
        <h3 style="font-size:15px;margin:18px 0 6px;">⏳ محوّلين من أكثر من يوم وبدون نتيجة</h3><ul style="font-size:13px;">${waitRows}</ul>
      </div>
    </div>`;
  }

  async send(dateKey) {
    const stats = this.buildStats(dateKey);
    const result = await notificationService.send({
      type: 'daily_report',
      subject: `📊 تقرير atlead اليومي ${stats.dateKey}: ${stats.newCustomers} جديد، ${stats.handoffs} تحويل، ${stats.won} بيع`,
      html: this.renderHtml(stats),
      text: `تقرير ${stats.dateKey}: عملاء جدد ${stats.newCustomers}، تحويل ${stats.handoffs}، اشترى ${stats.won}، لم يشترِ ${stats.lost}`
    });
    return { ...result, stats };
  }

  // Called every minute: sends once per day at/after the configured time.
  async maybeSend() {
    const cfg = this.getConfig();
    if (!cfg.enabled) return null;
    const now = businessHours.localParts();
    if (now.minutes < businessHours.toMinutes(cfg.time)) return null;
    if (storageService.getState('last_report_date') === now.dateKey) return null;
    storageService.setState('last_report_date', now.dateKey);
    const res = await this.send(now.dateKey);
    console.log(`[Report] Daily report ${now.dateKey}: ${res.success ? 'sent' : 'not sent — ' + res.error}`);
    return res;
  }
}

module.exports = new ReportService();
