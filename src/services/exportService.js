/**
 * Excel export of the dashboard data (one .xlsx, one sheet per kind of data).
 * scope: all | leads | conversations | messages | comments | appointments | posts
 */
const ExcelJS = require('exceljs');
const storageService = require('./storageService');

const T = {
  ar: {
    leads: 'العملاء', conversations: 'المحادثات', messages: 'الرسائل', comments: 'التعليقات', appointments: 'المواعيد', posts: 'المنشورات', calls: 'مكالمات الـ AI',
    yes: 'نعم', no: 'لا',
    sender: { customer: 'العميل', bot: 'البوت', agent: 'الموظف' },
    purchase: { won: 'اشترى', lost: 'لم يشترِ', pending_human: 'بانتظار الموظف', not_purchased: 'لم يشترِ بعد' }
  },
  en: {
    leads: 'Customers', conversations: 'Conversations', messages: 'Messages', comments: 'Comments', appointments: 'Appointments', posts: 'Posts', calls: 'AI calls',
    yes: 'Yes', no: 'No',
    sender: { customer: 'Customer', bot: 'Bot', agent: 'Staff' },
    purchase: { won: 'Purchased', lost: 'Did not buy', pending_human: 'Waiting for staff', not_purchased: 'Not purchased yet' }
  }
};

// [key, Arabic header, English header, width]
const COLUMNS = {
  leads: [
    ['name', 'اسم العميل', 'Name', 22], ['phone', 'الهاتف / الحساب', 'Phone / account', 18], ['customer_email', 'البريد', 'Email', 24],
    ['channel', 'القناة', 'Channel', 12], ['company_name', 'الشركة', 'Company', 18], ['business_type', 'النشاط', 'Business type', 18],
    ['lead_stage', 'المرحلة', 'Stage', 14], ['classification', 'التصنيف', 'Classification', 12], ['buying_probability', 'نسبة الشراء %', 'Buying probability %', 12],
    ['customer_requests', 'الطلبات', 'Requests', 40], ['identified_problem', 'المشكلة', 'Problem', 40], ['proposed_solution', 'الحل المقترح', 'Proposed solution', 40],
    ['customer_summary', 'الملخص', 'Summary', 50], ['objections', 'الاعتراضات', 'Objections', 30], ['purchase', 'حالة الشراء', 'Purchase status', 16],
    ['assigned_to_name', 'الموظف', 'Assigned to', 16], ['appointment', 'موعد الاستشارة', 'Consultation', 22], ['message_count', 'عدد الرسائل', 'Messages', 10],
    ['created_at', 'أول تواصل', 'First contact', 18], ['updated_at', 'آخر تحديث', 'Last update', 18]
  ],
  conversations: [
    ['customer_name', 'اسم العميل', 'Name', 22], ['channel', 'القناة', 'Channel', 12], ['customer_phone', 'الهاتف', 'Phone', 16], ['customer_handle', 'الحساب', 'Handle', 18],
    ['customer_email', 'البريد', 'Email', 24], ['lead_stage', 'المرحلة', 'Stage', 14], ['classification', 'التصنيف', 'Classification', 12],
    ['interest_score', 'نسبة الشراء %', 'Buying probability %', 12], ['bot', 'البوت مفعّل', 'Bot active', 10], ['handoff_at', 'وقت التحويل', 'Handed off at', 18],
    ['handoff_reason', 'سبب التحويل', 'Handoff reason', 30], ['assigned_to_name', 'الموظف', 'Assigned to', 16], ['appointment', 'موعد الاستشارة', 'Consultation', 22],
    ['appointment_link', 'رابط الاجتماع', 'Meeting link', 30], ['message_count', 'عدد الرسائل', 'Messages', 10], ['customer_summary', 'الملخص', 'Summary', 50],
    ['created_at', 'بداية المحادثة', 'Started', 18], ['last_message_at', 'آخر رسالة', 'Last message', 18],
    ['company_name', 'الشركة', 'Company', 18], ['job_title', 'المسمى الوظيفي', 'Job title', 16], ['location', 'المدينة / الدولة', 'Location', 16],
    ['team_size', 'حجم الفريق', 'Team size', 12], ['monthly_volume', 'الحجم الشهري', 'Monthly volume', 16], ['channels_used', 'القنوات', 'Channels', 18],
    ['current_tools', 'الأدوات الحالية', 'Current tools', 20], ['goals', 'الأهداف', 'Goals', 30], ['budget', 'الميزانية', 'Budget', 14],
    ['timeline', 'الإطار الزمني', 'Timeline', 14], ['decision_maker', 'صاحب القرار', 'Decision maker', 16],
    ['ai_call_qualified_label', 'مؤهل (مكالمة الـ AI)', 'Qualified (AI call)', 14], ['ai_call_summary', 'ملخص مكالمة الـ AI', 'AI call summary', 50]
  ],
  calls: [
    ['customer_name', 'العميل', 'Customer', 22], ['channel', 'القناة', 'Channel', 12], ['status', 'الحالة', 'Status', 12],
    ['started_at', 'البداية', 'Started', 18], ['duration', 'المدة (دقائق)', 'Minutes', 10], ['qualified', 'مؤهل للشراء', 'Qualified', 12],
    ['buying_probability', 'نسبة الشراء %', 'Buying probability %', 12], ['summary', 'الملخص', 'Summary', 60], ['next_step', 'الخطوة التالية', 'Next step', 30],
    ['meeting', 'اجتماع المهندس', 'Engineer meeting', 22], ['transcript', 'نص المكالمة', 'Transcript', 100]
  ],
  messages: [
    ['customer_name', 'العميل', 'Customer', 22], ['channel', 'القناة', 'Channel', 12], ['sender', 'المرسل', 'Sender', 10],
    ['content', 'الرسالة', 'Message', 80], ['created_at', 'الوقت', 'Time', 18]
  ],
  comments: [
    ['platform', 'المنصة', 'Platform', 12], ['user_name', 'صاحب التعليق', 'Commenter', 22], ['comment_text', 'نص التعليق', 'Comment', 50],
    ['interested', 'مهتم', 'Interested', 10], ['sentiment', 'التحليل', 'Sentiment', 12], ['bot_reply_text', 'الرد العام', 'Public reply', 50],
    ['dm', 'رسالة خاصة', 'DM sent', 10], ['dm_text', 'نص الرسالة الخاصة', 'DM text', 50], ['status', 'الحالة', 'Status', 12],
    ['post_id', 'المنشور', 'Post', 22], ['created_at', 'التاريخ', 'Date', 18]
  ],
  appointments: [
    ['customer_name', 'العميل', 'Customer', 22], ['channel', 'القناة', 'Channel', 12], ['customer_phone', 'الهاتف', 'Phone', 16],
    ['appointment_label', 'الموعد', 'Time', 24], ['appointment_at', 'التاريخ والوقت', 'Date and time', 20], ['appointment_link', 'رابط الاجتماع', 'Meeting link', 34],
    ['customer_requests', 'الطلب', 'Request', 40]
  ],
  posts: [
    ['date', 'التاريخ', 'Date', 12], ['topic', 'الموضوع', 'Topic', 40], ['status', 'الحالة', 'Status', 12], ['caption', 'النص', 'Caption', 70],
    ['scheduled_label', 'موعد النشر', 'Scheduled for', 20], ['published', 'روابط النشر', 'Published links', 50], ['source', 'المصدر', 'Source', 14]
  ]
};

const dt = (v) => (v ? new Date(v) : null);

function rows(kind, t) {
  const convs = storageService.getConversations();
  const apptOf = (c) => (c?.appointment_label || '');
  switch (kind) {
    case 'leads': {
      const byConv = new Map(convs.map(c => [c.id, c]));
      return storageService.getLeads().map(l => ({
        ...l,
        purchase: t.purchase[l.purchase_status] || l.purchase_status || '',
        appointment: apptOf(byConv.get(l.conversation_id)),
        created_at: dt(l.first_contact_at || l.created_at), updated_at: dt(l.updated_at)
      }));
    }
    case 'conversations':
      return convs.map(c => ({
        ...c, bot: c.is_bot_active === false ? t.no : t.yes, appointment: apptOf(c),
        ai_call_qualified_label: c.ai_call_qualified === true ? t.yes : c.ai_call_qualified === false ? t.no : '',
        message_count: (c.messages || []).length,
        handoff_at: dt(c.handoff_at), created_at: dt(c.created_at), last_message_at: dt(c.last_message_at || c.updated_at)
      }));
    case 'messages':
      return convs.flatMap(c => (c.messages || []).map(m => ({
        customer_name: c.customer_name, channel: c.channel, sender: t.sender[m.sender] || m.sender, content: m.content, created_at: dt(m.created_at)
      })));
    case 'comments':
      return storageService.getComments().map(c => ({
        ...c, interested: c.is_interested ? t.yes : t.no, dm: c.dm_triggered ? t.yes : t.no, created_at: dt(c.created_at)
      }));
    case 'appointments':
      return convs.filter(c => c.appointment_at).sort((a, b) => a.appointment_at.localeCompare(b.appointment_at))
        .map(c => ({ ...c, appointment_at: dt(c.appointment_at) }));
    case 'calls':
      return require('./callService').all().filter(s => s.transcript?.length).map(s => ({
        customer_name: s.customer_name, channel: s.channel, status: s.status,
        started_at: dt(s.started_at || s.created_at), duration: s.duration_sec ? Math.round(s.duration_sec / 60) : '',
        qualified: s.analysis ? (s.analysis.qualified ? t.yes : t.no) : '', buying_probability: s.analysis?.buying_probability ?? '',
        summary: s.analysis?.summary || '', next_step: s.analysis?.next_step || '', meeting: s.appointment?.appointment_label || '',
        transcript: s.transcript.map(l => `${l.role === 'assistant' ? (t === T.en ? 'Assistant' : 'المساعد') : (t === T.en ? 'Customer' : 'العميل')}: ${l.text}`).join('\n').slice(0, 32000)
      }));
    case 'posts': {
      const plans = require('./marketingService').allPlans();
      return plans.map(p => ({
        date: p.date, topic: p.topic?.title || '', status: p.status, source: p.source,
        caption: typeof p.caption === 'string' ? p.caption : (p.caption?.text || ''),
        scheduled_label: p.scheduled_label || '',
        published: Object.entries(p.results || {}).map(([k, v]) => `${k}: ${v.url || (v.ok ? 'OK' : v.error || '')}`).join('\n')
      }));
    }
    default: return [];
  }
}

async function build(scope = 'all', lang = 'ar') {
  const kinds = scope === 'all' ? Object.keys(COLUMNS) : [scope];
  if (!kinds.every(k => COLUMNS[k])) throw new Error('نوع التصدير غير معروف');
  const t = T[lang] || T.ar;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'atlead';
  wb.created = new Date();
  for (const kind of kinds) {
    const ws = wb.addWorksheet(t[kind], { views: [{ state: 'frozen', ySplit: 1, rightToLeft: lang === 'ar' }] });
    ws.columns = COLUMNS[kind].map(([key, ar, en, width]) => ({ key, header: lang === 'en' ? en : ar, width, style: { alignment: { wrapText: true, vertical: 'top' } } }));
    for (const r of rows(kind, t)) {
      const row = {};
      for (const [key] of COLUMNS[kind]) {
        const v = r[key];
        row[key] = v instanceof Date ? v : (v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v));
      }
      ws.addRow(row);
    }
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6F20' } };
    head.alignment = { vertical: 'middle', wrapText: true };
    ws.columns.forEach(col => { if (/_at$|^date$|created|updated/.test(col.key)) col.numFmt = 'yyyy-mm-dd hh:mm'; });
    if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS[kind].length } };
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { build, COLUMNS };
