/**
 * Google Sheets CRM sync.
 *
 * Method 1 (recommended): Google Sheets API v4 with a Service Account.
 *   1. Google Cloud Console → enable "Google Sheets API".
 *   2. Create a Service Account → Keys → Add key → JSON → download.
 *   3. Paste the JSON in the dashboard settings.
 *   4. Share your spreadsheet with the service account email (Editor).
 *
 * Method 2 (fallback): Google Apps Script Web App webhook (google_apps_script.js).
 *
 * Every lead is ONE row (column A = lead id). Each update overwrites that row,
 * so the sheet always shows the latest state of every customer.
 */
const axios = require('axios');
const crypto = require('crypto');
const storageService = require('./storageService');
const googleFormService = require('./googleFormService');

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SYNC_DEBOUNCE_MS = 3000;

const HEADERS = [
  'ID العميل',
  'تاريخ أول تواصل',
  'آخر تحديث',
  'اسم العميل',
  'رقم الهاتف',
  'الإيميل',
  'القناة',
  'الحساب / المعرف',
  'نوع النشاط',
  'شو طلب العميل',
  'المشكلة',
  'الحل المقترح',
  'المرحلة',
  'التصنيف',
  'نسبة الشراء %',
  'حالة الشراء',
  'البوت',
  'وقت التحويل للموظف',
  'تم إرسال إشعار للموظف',
  'ملخص السيلز',
  'التردد / الاعتراضات',
  'عدد الرسائل',
  'آخر رسالة من العميل',
  'ملاحظات',
  'الموظف المسؤول',
  'رسائل متابعة',
  'الشركة',
  'المسمى الوظيفي',
  'المدينة / الدولة',
  'حجم الفريق',
  'حجم الرسائل أو العملاء شهرياً',
  'القنوات المستخدمة',
  'الأدوات الحالية',
  'الأهداف',
  'الميزانية',
  'الإطار الزمني',
  'صاحب القرار',
  'مكالمة الـ AI — الحالة',
  'مكالمة الـ AI — مؤهل للشراء',
  'مكالمة الـ AI — الملخص',
  'مكالمة الـ AI — الخطوة التالية',
  'مكالمة الـ AI — التاريخ',
  'مكالمة الـ AI — المدة (دقائق)',
  'نص مكالمة الـ AI',
  'اجتماع المهندس',
  'رابط اجتماع المهندس'
];

const CHANNEL_LABELS = {
  whatsapp: 'واتساب',
  instagram_dm: 'إنستغرام',
  facebook_messenger: 'فيسبوك ماسنجر',
  simulator: 'محاكي تجريبي',
  simulator_voice: 'محاكي تجريبي (فويس)'
};

const STAGE_LABELS = {
  new: 'جديد', New: 'جديد',
  discovery: 'استكشاف الاحتياج', Discovery: 'استكشاف الاحتياج',
  qualified: 'مؤهل', Qualified: 'مؤهل',
  hot: 'مهتم جداً', Hot: 'مهتم جداً',
  deal_closing: 'ما قبل الشراء / إغلاق', 'Deal Closing': 'ما قبل الشراء / إغلاق', 'Deal Agreed': 'تم الاتفاق',
  handed_off: 'محوّل للموظف', 'Handed Off': 'محوّل للموظف'
};

const PURCHASE_LABELS = {
  won: 'اشترى',
  lost: 'لم يشترِ',
  pending_human: 'بانتظار تواصل الموظف',
  not_purchased: 'لم يشترِ بعد'
};

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Amman', hour12: false });
  } catch {
    return String(iso);
  }
};

// Neutralise spreadsheet formula injection (text starting with = + - @).
const safe = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
};

function columnLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const LAST_COL = columnLetter(HEADERS.length);
const base64url = (input) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

class GoogleSheetsService {
  constructor() {
    this._token = null;        // { value, exp, email }
    this._prepared = new Set(); // spreadsheetId|tab already checked
    this._queue = Promise.resolve(); // serialise writes → no duplicate rows
    this._debounce = new Map();      // leadId -> pending automatic sync
  }

  getConfig() {
    return storageService.getSettings().google_sheets || {};
  }

  parseServiceAccount(raw) {
    if (!raw) return null;
    try {
      const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!json.client_email || !json.private_key) return null;
      return { client_email: json.client_email, private_key: json.private_key.replace(/\\n/g, '\n') };
    } catch {
      return null;
    }
  }

  extractSpreadsheetId(input) {
    if (!input) return null;
    const m = String(input).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : String(input).trim();
  }

  getApiConfig(overrides = {}) {
    const cfg = { ...this.getConfig(), ...overrides };
    const sa = this.parseServiceAccount(cfg.service_account_json);
    const spreadsheetId = this.extractSpreadsheetId(cfg.sheet_id);
    if (!sa || !spreadsheetId) return null;
    return { sa, spreadsheetId, tab: (cfg.sheet_name || 'Leads').trim() || 'Leads' };
  }

  isConfigured() {
    const cfg = this.getConfig();
    return !!(this.getApiConfig() || cfg.webhook_url || (cfg.form_url && cfg.form_auto_sync !== false));
  }

  async getAccessToken(sa) {
    const now = Math.floor(Date.now() / 1000);
    if (this._token && this._token.email === sa.client_email && this._token.exp - 60 > now) {
      return this._token.value;
    }
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
    const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key);
    const jwt = `${header}.${claims}.${base64url(signature)}`;

    const res = await axios.post(TOKEN_URL, new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });

    this._token = { value: res.data.access_token, exp: now + (res.data.expires_in || 3600), email: sa.client_email };
    return this._token.value;
  }

  rangeFor(tab, a1) {
    return `'${tab.replace(/'/g, "''")}'!${a1}`;
  }

  async api(method, url, token, data) {
    return axios({ method, url, data, headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
  }

  // Creates the tab if missing and writes/format the header row.
  async prepareSheet({ sa, spreadsheetId, tab }, force = false) {
    const key = `${spreadsheetId}|${tab}`;
    const token = await this.getAccessToken(sa);
    if (this._prepared.has(key) && !force) return { token };

    const meta = await this.api('get', `${SHEETS_API}/${spreadsheetId}?fields=properties.title,sheets.properties`, token);
    let sheet = meta.data.sheets.find(s => s.properties.title === tab);
    if (!sheet) {
      const add = await this.api('post', `${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
        requests: [{ addSheet: { properties: { title: tab, rightToLeft: true, gridProperties: { frozenRowCount: 1 } } } }]
      });
      sheet = { properties: add.data.replies[0].addSheet.properties };
    }

    const headerRange = encodeURIComponent(this.rangeFor(tab, `A1:${LAST_COL}1`));
    const current = await this.api('get', `${SHEETS_API}/${spreadsheetId}/values/${headerRange}`, token);
    const existing = current.data.values?.[0] || [];
    if (existing.join('|') !== HEADERS.join('|')) {
      await this.api('put', `${SHEETS_API}/${spreadsheetId}/values/${headerRange}?valueInputOption=RAW`, token, { values: [HEADERS] });
      await this.api('post', `${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
        requests: [
          {
            repeatCell: {
              range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.12, green: 0.16, blue: 0.23 } } },
              fields: 'userEnteredFormat(textFormat,backgroundColor)'
            }
          },
          { updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } }
        ]
      });
    }
    this._prepared.add(key);
    return { token, title: meta.data.properties?.title };
  }

  headers() { return HEADERS; }

  leadToRow(lead) {
    const conv = lead.conversation_id ? storageService.getConversationById(lead.conversation_id) : null;
    const purchase = lead.purchase_status || (lead.deal_status === 'won' ? 'won' : lead.deal_status === 'lost' ? 'lost' : 'not_purchased');
    const botActive = conv ? conv.is_bot_active !== false : !lead.handed_off_at;
    return [
      lead.id,
      fmtDate(lead.first_contact_at || lead.created_at),
      fmtDate(new Date().toISOString()),
      lead.name || 'عميل محتمل',
      lead.phone || '',
      lead.customer_email || '',
      CHANNEL_LABELS[lead.channel] || lead.channel || '',
      lead.customer_handle || '',
      lead.business_type || '',
      lead.customer_requests || '',
      lead.identified_problem || '',
      lead.proposed_solution || '',
      STAGE_LABELS[lead.lead_stage] || lead.lead_stage || '',
      lead.classification || '',
      `${Number(lead.buying_probability) || 0}%`,
      PURCHASE_LABELS[purchase] || purchase,
      botActive ? 'البوت يرد' : (conv?.pause_reason === 'human_reply' ? 'موقوف — موظف يتابع المحادثة' : 'موقوف — محوّل للموظف'),
      fmtDate(lead.handed_off_at),
      lead.human_notified_at ? `نعم — ${fmtDate(lead.human_notified_at)}` : 'لا',
      lead.customer_summary || '',
      lead.objections || '',
      lead.message_count || 0,
      lead.last_customer_message || '',
      lead.notes || '',
      lead.assigned_to_name || '',
      lead.follow_up_count || 0,
      ...this.callColumns(conv)
    ].map(safe);
  }

  callColumns(conv) {
    const c = conv || {};
    const status = { offered: 'أُرسل الرابط', in_progress: 'جارية', completed: 'تمت' }[c.ai_call_status] || '';
    let transcript = '';
    if (c.ai_call_token) {
      const s = require('./callService').get(c.ai_call_token);
      if (s?.transcript?.length) transcript = s.transcript.map(l => `${l.role === 'assistant' ? 'المساعد' : 'العميل'}: ${l.text}`).join('\n').slice(0, 45000);
    }
    return [
      c.company_name, c.job_title, c.location, c.team_size, c.monthly_volume, c.channels_used, c.current_tools, c.goals,
      c.budget, c.timeline, c.decision_maker,
      status,
      c.ai_call_qualified === true ? 'نعم' : c.ai_call_qualified === false ? 'لا' : '',
      c.ai_call_summary, c.ai_call_next_step, fmtDate(c.ai_call_at),
      c.ai_call_duration_sec ? Math.round(c.ai_call_duration_sec / 60) : '',
      transcript,
      c.appointment_label, c.appointment_link
    ].map(v => (v === null || v === undefined ? '' : v));
  }

  async upsertRowApi(apiCfg, lead) {
    const { token } = await this.prepareSheet(apiCfg);
    const { spreadsheetId, tab } = apiCfg;
    const row = this.leadToRow(lead);

    const idsRange = encodeURIComponent(this.rangeFor(tab, 'A:A'));
    const ids = await this.api('get', `${SHEETS_API}/${spreadsheetId}/values/${idsRange}`, token);
    const index = (ids.data.values || []).findIndex(r => r[0] === lead.id);

    if (index >= 1) {
      const rowNum = index + 1;
      const range = encodeURIComponent(this.rangeFor(tab, `A${rowNum}:${LAST_COL}${rowNum}`));
      await this.api('put', `${SHEETS_API}/${spreadsheetId}/values/${range}?valueInputOption=RAW`, token, { values: [row] });
      return rowNum;
    }
    const appendRange = encodeURIComponent(this.rangeFor(tab, `A:${LAST_COL}`));
    const res = await this.api('post', `${SHEETS_API}/${spreadsheetId}/values/${appendRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, { values: [row] });
    const updated = res.data.updates?.updatedRange || '';
    const m = updated.match(/![A-Z]+(\d+)/);
    return m ? Number(m[1]) : null;
  }

  async upsertRowWebhook(webhookUrl, lead) {
    const row = this.leadToRow(lead);
    const record = {};
    HEADERS.forEach((h, i) => { record[h] = row[i]; });
    await axios.post(webhookUrl, {
      action: 'sync_lead',
      headers: HEADERS,
      row,
      lead: {
        id: lead.id,
        date: row[1],
        name: lead.name,
        phone: lead.phone || 'غير محدد',
        channel: row[6],
        stage: row[12],
        classification: lead.classification,
        buying_probability: row[14],
        business_type: lead.business_type || '-',
        identified_problem: lead.identified_problem || '-',
        proposed_solution: lead.proposed_solution || '-',
        deal_status: row[15],
        notes: lead.customer_summary || lead.notes || '',
        record
      }
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
  }

  /**
   * Sync one lead (create or update its row). Never throws.
   */
  syncLead(lead) {
    // Manual syncs (buttons) run right away. Automatic syncs for the same customer
    // within a few seconds are merged into one write (Google quota: 60 writes/min).
    if (lead?._manual || !lead?.id) return this._enqueue(lead);
    const pending = this._debounce.get(lead.id);
    if (pending) {
      pending.lead = lead;
      return pending.promise;
    }
    const entry = { lead };
    entry.promise = new Promise(resolve => {
      setTimeout(() => {
        this._debounce.delete(lead.id);
        const latest = storageService.getLeads().find(l => l.id === lead.id) || entry.lead;
        resolve(this._enqueue(latest));
      }, SYNC_DEBOUNCE_MS);
    });
    this._debounce.set(lead.id, entry);
    return entry.promise;
  }

  _enqueue(lead) {
    const job = this._queue.then(() => this._syncLeadNow(lead));
    this._queue = job.catch(() => {});
    return job;
  }

  async _withRetry(fn) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = err.response?.status;
        const retryable = status === 429 || (status >= 500 && status < 600) || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        if (!retryable || attempt >= 3) throw err;
        await new Promise(r => setTimeout(r, attempt * 15000));
      }
    }
  }

  async _syncLeadNow(lead) {
    if (!lead?.id) return { success: false, message: 'بيانات العميل ناقصة' };
    const cfg = this.getConfig();
    if (cfg.auto_sync === false && cfg.form_auto_sync !== true && !lead._manual) {
      return { success: false, message: 'المزامنة مع Google Sheets متوقفة من الإعدادات.' };
    }
    const apiCfg = this.getApiConfig();

    try {
      let rowIndex = null;
      let formResult = null;
      if (cfg.form_url && cfg.form_auto_sync !== false) {
        formResult = await this._withRetry(() => googleFormService.submit(lead, storageService.getSettings()));
        if (formResult.success && !formResult.skipped) {
          storageService.saveLead({ id: lead.id, google_form_synced: true, last_synced_at: new Date().toISOString() });
        }
        // Form only (no Sheets API / webhook configured): done.
        if (!apiCfg && !cfg.webhook_url) return formResult;
        if (cfg.auto_sync === false && !lead._manual) return formResult;
      }
      if (apiCfg) {
        rowIndex = await this._withRetry(() => this.upsertRowApi(apiCfg, lead));
      } else if (cfg.webhook_url) {
        await this._withRetry(() => this.upsertRowWebhook(cfg.webhook_url, lead));
      } else {
        return { success: false, message: 'Google Sheets أو Google Form غير مربوط من الإعدادات.' };
      }

      const fresh = storageService.getLeads().find(l => l.id === lead.id);
      if (fresh) {
        storageService.saveLead({
          id: lead.id,
          google_sheet_synced: true,
          last_synced_at: new Date().toISOString(),
          ...(rowIndex ? { google_sheet_row_index: rowIndex } : {})
        });
      }
      return { success: true, message: 'تم تحديث بيانات العميل في Google Sheets', row: rowIndex };
    } catch (err) {
      const msg = this.explainError(err);
      console.error('Google Sheets sync error:', msg);
      return { success: false, message: msg };
    }
  }

  explainError(err) {
    const status = err.response?.status;
    const apiMsg = err.response?.data?.error?.message || err.response?.data?.error_description || err.message;
    const email = this.parseServiceAccount(this.getConfig().service_account_json)?.client_email;
    if (status === 403) return `لا توجد صلاحية على الشيت. اعمل Share للشيت مع ${email || 'إيميل الـ Service Account'} كـ Editor. (${apiMsg})`;
    if (status === 404) return `الشيت غير موجود — تأكد من رابط/ID الشيت. (${apiMsg})`;
    if (/invalid[_ ]grant/i.test(apiMsg)) return `ملف Service Account غير صالح أو محذوف أو منتهي — نزّل مفتاح JSON جديد. (${apiMsg})`;
    if (/Google Sheets API has not been used|SERVICE_DISABLED/i.test(apiMsg)) return `فعّل Google Sheets API في Google Cloud Console. (${apiMsg})`;
    return `خطأ في Google Sheets: ${apiMsg}`;
  }

  // Settings page "test" button: checks credentials + access, prepares the header row.
  async testConnection(overrides = {}) {
    const apiCfg = this.getApiConfig(overrides);
    if (apiCfg) {
      try {
        this._prepared.delete(`${apiCfg.spreadsheetId}|${apiCfg.tab}`);
        const { title } = await this.prepareSheet(apiCfg, true);
        return {
          success: true,
          message: `تم الربط بنجاح مع الشيت "${title}" — ورقة "${apiCfg.tab}" جاهزة بالأعمدة`,
          service_account_email: apiCfg.sa.client_email
        };
      } catch (err) {
        return { success: false, message: this.explainError(err), service_account_email: apiCfg.sa.client_email };
      }
    }
    const formUrl = overrides.form_url || this.getConfig().form_url;
    if (formUrl) return googleFormService.test(formUrl);
    const webhookUrl = overrides.webhook_url || this.getConfig().webhook_url;
    if (webhookUrl) return this.testSync(webhookUrl);
    return { success: false, message: 'أدخل رابط Google Form أو ملف Service Account ورابط الشيت أولاً.' };
  }

  async testSync(webhookUrl) {
    try {
      await this.upsertRowWebhook(webhookUrl, {
        id: 'test_' + Date.now(),
        name: 'عميل تجريبي (Test)',
        phone: '+962780908299',
        channel: 'whatsapp',
        lead_stage: 'qualified',
        classification: 'Hot',
        buying_probability: 80,
        customer_summary: 'صف اختباري من لوحة التحكم'
      });
      return { success: true, message: 'تم إرسال صف اختباري إلى Google Sheets عبر Webhook!' };
    } catch (err) {
      return { success: false, message: `فشل الاتصال برابط Webhook: ${err.message}` };
    }
  }

  // Push every lead (CRM "sync all" button).
  async syncAll() {
    // Demo/sample leads and simulator tests never go to the real sales sheet.
    const leads = storageService.getLeads().filter(l => !String(l.conversation_id || '').startsWith('conv_demo_') && !String(l.channel || '').startsWith('simulator'));
    let ok = 0;
    let lastError = null;
    for (const lead of leads) {
      const r = await this.syncLead({ ...lead, _manual: true });
      if (r.success) ok++; else lastError = r.message;
    }
    return { success: ok > 0 || leads.length === 0, message: `تمت مزامنة ${ok} من ${leads.length} عميل${lastError ? ` — آخر خطأ: ${lastError}` : ''}` };
  }
}

module.exports = new GoogleSheetsService();
