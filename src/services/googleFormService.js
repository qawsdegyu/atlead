const axios = require('axios');
const crypto = require('crypto');

/**
 * Google Form fields. Each field is matched to the form by its question TITLE
 * (read from the public form page), so any form with these titles works.
 * `legacy` = the entry IDs of the original atlead form, used when titles don't match.
 */
const FIELDS = [
  { key: 'id', title: 'معرّف العميل', legacy: '2069490885' },
  { key: 'name', title: 'اسم العميل', legacy: '321793735' },
  { key: 'phone', title: 'رقم الهاتف', legacy: '1529699744' },
  { key: 'email', title: 'الإيميل', legacy: '1001366343' },
  { key: 'channel', title: 'القناة', legacy: '167790938' },
  { key: 'company', title: 'اسم الشركة', legacy: '1181743022' },
  { key: 'business', title: 'نوع النشاط', legacy: '1452263260' },
  { key: 'requests', title: 'طلبات العميل', legacy: '539536679' },
  { key: 'problem', title: 'المشكلة', legacy: '671886387' },
  { key: 'solution', title: 'الحل المقترح', legacy: '679914777' },
  { key: 'stage', title: 'المرحلة', legacy: '129631632' },
  { key: 'classification', title: 'التصنيف', legacy: '1472838142' },
  { key: 'probability', title: 'نسبة الشراء %', legacy: '1082102888' },
  { key: 'summary', title: 'ملخص المحادثة', legacy: '1800461137' },
  { key: 'objections', title: 'الاعتراضات', legacy: '1131710268' },
  { key: 'deal', title: 'حالة الصفقة', legacy: '43275942' },
  { key: 'firstContact', title: 'أول تواصل', legacy: '1558435443' },
  { key: 'lastContact', title: 'آخر تحديث', legacy: '2084890579' },
  { key: 'followUps', title: 'عدد المتابعات', legacy: '1493943523' },
  { key: 'nextFollowUp', title: 'المتابعة الجاية', legacy: '567347788' },
  { key: 'consultation', title: 'طلب استشارة', legacy: '962995822' },
  { key: 'demo', title: 'طلب ديمو', legacy: '965494157' },
  { key: 'notes', title: 'ملاحظات', legacy: '42151625' },
  { key: 'rep', title: 'الموظف المسؤول', legacy: '1916898992' },
  { key: 'repEmail', title: 'إيميل الموظف', legacy: '1369647704' }
];
// Changing only these doesn't add a new form row (they change on almost every message).
const VOLATILE = new Set(['lastContact', 'nextFollowUp', 'summary', 'requests']);

const CHANNEL = { whatsapp: 'WhatsApp', instagram_dm: 'Instagram', facebook_messenger: 'Facebook Messenger', phone: 'هاتف', website: 'موقع إلكتروني' };
const STAGE = { new: 'New', discovery: 'Discovery', qualified: 'Qualified', proposal: 'Proposal', hot: 'Hot', handed_off: 'Handoff', deal_closing: 'Handoff', won: 'Won', lost: 'Lost', follow_up: 'Follow-up' };
const DEAL = { won: 'اشترى', lost: 'لم يشترِ', pending_human: 'محوّل لموظف', not_purchased: 'متابعة' };

function formId(url) {
  const m = String(url || '').match(/\/forms\/d\/e\/([^/?#]+)/);
  return m ? m[1] : '';
}
function endpoint(url) {
  const id = formId(url);
  return id ? `https://docs.google.com/forms/d/e/${id}/formResponse` : '';
}
function viewUrl(url) {
  const id = formId(url);
  return id ? `https://docs.google.com/forms/d/e/${id}/viewform` : '';
}
const norm = (s) => String(s || '').replace(/[ً-ٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
function fmt(v) { return v == null ? '' : String(v); }
function bool(v) { return v ? 'نعم' : 'لا'; }

function valuesByKey(lead) {
  return {
    id: fmt(lead.id),
    name: fmt(lead.name || 'عميل محتمل'),
    phone: fmt(lead.phone),
    email: fmt(lead.customer_email),
    channel: CHANNEL[lead.channel] || fmt(lead.channel),
    company: fmt(lead.company_name),
    business: fmt(lead.business_type),
    requests: fmt(lead.customer_requests),
    problem: fmt(lead.identified_problem),
    solution: fmt(lead.proposed_solution),
    stage: STAGE[lead.lead_stage] || fmt(lead.lead_stage || 'New'),
    classification: fmt(lead.classification || 'Cold'),
    probability: String(Math.max(0, Math.min(100, Number(lead.buying_probability) || 0))),
    summary: fmt(lead.customer_summary),
    objections: fmt(lead.objections),
    deal: DEAL[lead.purchase_status] || (lead.handed_off_at ? 'محوّل لموظف' : 'جديدة'),
    firstContact: fmt(lead.first_contact_at || lead.created_at),
    lastContact: fmt(lead.updated_at || new Date().toISOString()),
    followUps: String(Number(lead.follow_up_count) || 0),
    nextFollowUp: fmt(lead.next_follow_up_at || ''),
    consultation: bool(lead.consultation_requested),
    demo: bool(lead.demo_requested),
    notes: fmt(lead.notes),
    rep: fmt(lead.assigned_to_name),
    repEmail: fmt(lead.assigned_to_email)
  };
}

class GoogleFormService {
  constructor() {
    this.sent = new Map();
    this.maps = new Map(); // form id → { key: entryId }
  }

  getConfig(settings) { return settings?.google_sheets || {}; }
  isConfigured(settings) { return !!endpoint(this.getConfig(settings).form_url); }

  /** Reads the public form page and returns [{title, entry}] for its questions. */
  async readQuestions(url) {
    const res = await axios.get(viewUrl(url), { timeout: 15000, validateStatus: s => s >= 200 && s < 400 });
    const html = String(res.data || '');
    const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
    if (!m) throw new Error('ما قدرت أقرأ أسئلة الفورم — تأكد إنه رابط المجيب العام (viewform) وإنه الفورم مفتوح للردود بدون تسجيل دخول.');
    const data = JSON.parse(m[1]);
    const items = data?.[1]?.[1] || [];
    return items
      .filter(it => Array.isArray(it?.[4]) && it[4][0]?.[0])
      .map(it => ({ title: String(it[1] || ''), entry: String(it[4][0][0]) }));
  }

  /** Maps our fields to the form's entry IDs by title (falls back to the original form's IDs). */
  async entryMap(url) {
    const id = formId(url);
    if (this.maps.has(id)) return this.maps.get(id);
    let map = {};
    try {
      const questions = await this.readQuestions(url);
      const byTitle = new Map(questions.map(q => [norm(q.title), q.entry]));
      for (const f of FIELDS) {
        const entry = byTitle.get(norm(f.title));
        if (entry) map[f.key] = entry;
      }
      if (Object.keys(map).length < FIELDS.length / 2) {
        // Probably the original atlead form (different titles) → its known IDs.
        const known = new Set(questions.map(q => q.entry));
        if (FIELDS.filter(f => known.has(f.legacy)).length >= FIELDS.length / 2) {
          map = Object.fromEntries(FIELDS.map(f => [f.key, f.legacy]));
        }
      }
    } catch (err) {
      console.warn('[Google Form] could not read questions, using known IDs:', err.message);
      map = Object.fromEntries(FIELDS.map(f => [f.key, f.legacy]));
    }
    this.maps.set(id, map);
    return map;
  }

  async submit(lead, settings) {
    const cfg = this.getConfig(settings);
    const url = endpoint(cfg.form_url);
    if (!url) return { success: false, message: 'Google Form غير مربوط.' };
    if (!lead?.id) return { success: false, message: 'بيانات العميل ناقصة.' };
    const map = await this.entryMap(cfg.form_url);
    if (!Object.keys(map).length) return { success: false, message: 'ولا سؤال بالفورم مطابق لحقول البوت.' };
    const vals = valuesByKey(lead);
    const body = new URLSearchParams();
    for (const [key, entry] of Object.entries(map)) body.append(`entry.${entry}`, vals[key] ?? '');

    // A form can only ADD responses (never edit one), so a new row is sent only when
    // something meaningful about the customer changed (e.g. the buying probability) —
    // not on every message. The fingerprint is stored on the lead, so it survives restarts.
    const stable = Object.keys(vals).filter(k => !VOLATILE.has(k)).map(k => `${k}=${vals[k]}`).join('&');
    const fingerprint = crypto.createHash('sha1').update(stable).digest('hex');
    const storageService = require('./storageService');
    const stored = storageService.getLeads().find(l => l.id === lead.id)?.google_form_fp;
    if (!lead._manual && (this.sent.get(lead.id) === fingerprint || stored === fingerprint)) {
      return { success: true, skipped: true, message: 'ما في تغيير مهم على العميل — ما انضاف صف جديد.' };
    }
    const response = await axios.post(url, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000, maxRedirects: 3, validateStatus: s => s >= 200 && s < 400
    });
    this.sent.set(lead.id, fingerprint);
    storageService.saveLead({ id: lead.id, google_form_fp: fingerprint, google_form_synced: true });
    return { success: true, message: 'تمت إضافة بيانات العميل إلى Google Form', status: response.status };
  }

  async test(url) {
    if (!formId(url)) return { success: false, message: 'أدخل رابط Google Form العام (بيبلش بـ https://docs.google.com/forms/d/e/...).' };
    this.maps.delete(formId(url));
    const questions = await this.readQuestions(url);
    const map = await this.entryMap(url);
    const matched = Object.keys(map).length;
    const missing = FIELDS.filter(f => !map[f.key]).map(f => f.title);
    return {
      success: matched > 0,
      message: matched === FIELDS.length
        ? `رابط Google Form يعمل — جميع الحقول (${matched}) مربوطة.`
        : `الفورم فيه ${questions.length} سؤال، انربط منها ${matched} من ${FIELDS.length}.${missing.length ? ` ناقص: ${missing.join('، ')}` : ''}`
    };
  }
}

const service = new GoogleFormService();
service.FIELDS = FIELDS;
module.exports = service;
