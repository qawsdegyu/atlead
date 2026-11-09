const axios = require('axios');

const ENTRY = {
  id: '2069490885', name: '321793735', phone: '1529699744', email: '1001366343',
  channel: '167790938', company: '1181743022', business: '1452263260', requests: '539536679',
  problem: '671886387', solution: '679914777', stage: '129631632', classification: '1472838142',
  probability: '1082102888', summary: '1800461137', objections: '1131710268', deal: '43275942',
  firstContact: '1558435443', lastContact: '2084890579', followUps: '1493943523', nextFollowUp: '567347788',
  consultation: '962995822', demo: '965494157', notes: '42151625', rep: '1916898992', repEmail: '1369647704'
};

const CHANNEL = { whatsapp: 'WhatsApp', instagram_dm: 'Instagram', facebook_messenger: 'Facebook Messenger', phone: 'هاتف', website: 'موقع إلكتروني' };
const STAGE = { new: 'New', discovery: 'Discovery', qualified: 'Qualified', proposal: 'Proposal', handed_off: 'Handoff', deal_closing: 'Handoff', won: 'Won', lost: 'Lost', follow_up: 'Follow-up' };
const DEAL = { won: 'اشترى', lost: 'لم يشترِ', pending_human: 'محوّل لموظف', not_purchased: 'متابعة' };

function endpoint(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/\/formResponse(?:\?|$)/.test(value)) return value;
  const match = value.match(/\/forms\/d\/e\/([^/]+)/);
  return match ? `https://docs.google.com/forms/d/e/${match[1]}/formResponse` : value;
}
function fmt(v) { return v == null ? '' : String(v); }
function bool(v) { return v ? 'نعم' : 'لا'; }
function formValues(lead) {
  return {
    [`entry.${ENTRY.id}`]: fmt(lead.id), [`entry.${ENTRY.name}`]: fmt(lead.name || 'عميل محتمل'),
    [`entry.${ENTRY.phone}`]: fmt(lead.phone), [`entry.${ENTRY.email}`]: fmt(lead.customer_email),
    [`entry.${ENTRY.channel}`]: CHANNEL[lead.channel] || fmt(lead.channel), [`entry.${ENTRY.company}`]: fmt(lead.company_name),
    [`entry.${ENTRY.business}`]: fmt(lead.business_type), [`entry.${ENTRY.requests}`]: fmt(lead.customer_requests),
    [`entry.${ENTRY.problem}`]: fmt(lead.identified_problem), [`entry.${ENTRY.solution}`]: fmt(lead.proposed_solution),
    [`entry.${ENTRY.stage}`]: STAGE[lead.lead_stage] || fmt(lead.lead_stage || 'New'),
    [`entry.${ENTRY.classification}`]: fmt(lead.classification || 'Cold'),
    [`entry.${ENTRY.probability}`]: String(Math.max(0, Math.min(100, Number(lead.buying_probability) || 0))),
    [`entry.${ENTRY.summary}`]: fmt(lead.customer_summary), [`entry.${ENTRY.objections}`]: fmt(lead.objections),
    [`entry.${ENTRY.deal}`]: DEAL[lead.purchase_status] || (lead.handed_off_at ? 'محوّل لموظف' : 'جديدة'),
    [`entry.${ENTRY.firstContact}`]: fmt(lead.first_contact_at || lead.created_at),
    [`entry.${ENTRY.lastContact}`]: fmt(lead.updated_at || new Date().toISOString()),
    [`entry.${ENTRY.followUps}`]: String(Number(lead.follow_up_count) || 0),
    [`entry.${ENTRY.nextFollowUp}`]: fmt(lead.next_follow_up_at || lead.last_follow_up_at),
    [`entry.${ENTRY.consultation}`]: bool(lead.consultation_requested), [`entry.${ENTRY.demo}`]: bool(lead.demo_requested),
    [`entry.${ENTRY.notes}`]: fmt(lead.notes), [`entry.${ENTRY.rep}`]: fmt(lead.assigned_to_name),
    [`entry.${ENTRY.repEmail}`]: fmt(lead.assigned_to_email)
  };
}

class GoogleFormService {
  constructor() { this.sent = new Map(); }
  getConfig(settings) { return settings?.google_sheets || {}; }
  isConfigured(settings) { return !!endpoint(this.getConfig(settings).form_url); }
  async submit(lead, settings) {
    const cfg = this.getConfig(settings);
    const url = endpoint(cfg.form_url);
    if (!url) return { success: false, message: 'Google Form غير مربوط.' };
    if (!lead?.id) return { success: false, message: 'بيانات العميل ناقصة.' };
    const body = new URLSearchParams(formValues(lead));
    const fingerprint = `${lead.id}|${body.toString()}`;
    if (this.sent.get(lead.id) === fingerprint) return { success: true, skipped: true, message: 'السجل مطابق لآخر نسخة في Google Form.' };
    const response = await axios.post(url, body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000, maxRedirects: 3, validateStatus: s => s >= 200 && s < 400 });
    this.sent.set(lead.id, fingerprint);
    return { success: true, message: 'تمت إضافة بيانات العميل إلى Google Form ✅', status: response.status };
  }
  async test(url) {
    const target = endpoint(url);
    if (!target) return { success: false, message: 'أدخل رابط Google Form العام.' };
    const res = await axios.get(target.replace('/formResponse', '/viewform'), { timeout: 15000, validateStatus: s => s >= 200 && s < 400 });
    return { success: true, message: 'رابط Google Form صالح وجاهز لاستقبال البيانات ✅', status: res.status };
  }
}
module.exports = new GoogleFormService();
