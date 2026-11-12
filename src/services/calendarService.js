/**
 * Google Calendar booking for online consultations.
 *
 * The engineer shares their calendar with the Google service account (the same one used for
 * Google Sheets) with "Make changes to events". The bot then:
 *  - reads free/busy and only ever offers times that are really free, inside the booking hours,
 *  - books the time the customer confirms (re-checked at that moment), with a Google Meet link
 *    (or the fixed meeting link from the settings),
 *  - moves an existing booking when the customer asks to change it.
 */
const axios = require('axios');
const crypto = require('crypto');
const storageService = require('./storageService');

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULTS = {
  enabled: false,
  calendar_id: '',
  timezone: 'Asia/Amman',
  days: [0, 1, 2, 3, 4, 5, 6],
  start: '09:00',
  end: '21:00',
  all_day: false, // engineer available around the clock
  duration_minutes: 30,
  min_notice_hours: 2,
  days_ahead: 7,
  meeting_link: '', // fixed room used when Google Meet cannot be created
  engineer_name: 'المهندس'
};

const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function localParts(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const hour = Number(p.hour) % 24;
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
    dateKey: `${p.year}-${p.month}-${p.day}`, y: Number(p.year), mo: Number(p.month), d: Number(p.day),
    minutes: hour * 60 + Number(p.minute)
  };
}

// Wall-clock time in the business timezone → real Date.
function zoned(dateKey, minutes, tz) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  const offsetAt = (t) => { const p = localParts(new Date(t), tz); return Date.UTC(p.y, p.mo - 1, p.d, 0, p.minutes) - t; };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass for DST edges
  return new Date(t);
}

class CalendarService {
  getConfig() {
    const s = storageService.getSettings();
    const cfg = { ...DEFAULTS, ...(s.calendar || {}) };
    cfg.days = (Array.isArray(cfg.days) ? cfg.days : DEFAULTS.days).map(Number).filter(d => d >= 0 && d <= 6);
    cfg.duration_minutes = Math.min(180, Math.max(15, Number(cfg.duration_minutes) || 30));
    cfg.min_notice_hours = Math.max(0, Number(cfg.min_notice_hours ?? 2));
    cfg.days_ahead = Math.min(30, Math.max(1, Number(cfg.days_ahead) || 7));
    cfg.calendar_id = String(cfg.calendar_id || '').trim();
    return cfg;
  }

  serviceAccount() {
    const raw = storageService.getSettings().google_sheets?.service_account_json;
    if (!raw) return null;
    try {
      const sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return sa.client_email && sa.private_key ? sa : null;
    } catch { return null; }
  }

  /** Enabled and has what it needs to work. */
  isActive() {
    const cfg = this.getConfig();
    return !!(cfg.enabled && cfg.calendar_id && this.serviceAccount());
  }

  async token() {
    const sa = this.serviceAccount();
    if (!sa) throw new Error('NO_SA');
    const now = Math.floor(Date.now() / 1000);
    if (this._token && this._token.email === sa.client_email && this._token.exp - 60 > now) return this._token.value;
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
    const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const res = await axios.post(TOKEN_URL, new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
    this._token = { value: res.data.access_token, exp: now + (res.data.expires_in || 3600), email: sa.client_email };
    return this._token.value;
  }

  async api(method, url, data, params) {
    const token = await this.token();
    return axios({ method, url: `${API}${url}`, data, params, headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
  }

  /**
   * Rehearsals only: a test conversation (rehearsal_calendar) gets a simulated calendar when Google
   * Calendar is not connected. Known busy blocks tomorrow 10:00–12:00 and 14:00–15:00 (Amman), plus
   * whatever that rehearsal booked. Nothing is ever written to a real calendar.
   */
  mockFor(conv) { return !!(conv && conv.rehearsal_calendar && !this.isActive()) ? conv.id || 'rehearsal' : null; }

  mockBusy(mock) {
    const cfg = this.getConfig();
    const day = localParts(new Date(Date.now() + 86400000), cfg.timezone).dateKey;
    const block = (a, b) => ({ start: zoned(day, a, cfg.timezone).getTime(), end: zoned(day, b, cfg.timezone).getTime() });
    return [block(600, 720), block(840, 900), ...((this._mockBooked || new Map()).get(mock) || [])];
  }

  async busy(from, to, { fresh = false, mock = null } = {}) {
    if (mock) return this.mockBusy(mock);
    const cfg = this.getConfig();
    const key = `${cfg.calendar_id}|${from.toISOString().slice(0, 15)}|${to.toISOString().slice(0, 13)}`;
    if (!fresh && this._busy && this._busy.key === key && Date.now() - this._busy.at < 60000) return this._busy.list;
    const res = await this.api('post', '/freeBusy', { timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: cfg.timezone, items: [{ id: cfg.calendar_id }] });
    const cal = res.data.calendars?.[cfg.calendar_id] || {};
    if (cal.errors?.length) {
      const reason = cal.errors[0].reason;
      throw Object.assign(new Error(reason === 'notFound' ? 'CAL_NOT_SHARED' : reason), { code: reason });
    }
    const list = (cal.busy || []).map(b => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }));
    this._busy = { key, at: Date.now(), list };
    return list;
  }

  /** Booking window for one local day, in minutes from midnight. */
  dayWindow(cfg) {
    if (cfg.all_day) return { start: 0, end: 1440 };
    const start = toMin(cfg.start);
    let end = toMin(cfg.end);
    if (end <= start) end = 1440; // "until midnight"
    return { start, end };
  }

  /**
   * Free times per day for the next days, inside the booking hours, as real intervals.
   * [{ dateKey, weekday, label, ranges: [{ start: Date, end: Date }] }]
   */
  async availability({ fresh = false, mock = null } = {}) {
    const cfg = this.getConfig();
    const now = Date.now();
    const earliest = now + cfg.min_notice_hours * 3600000;
    const horizon = now + (cfg.days_ahead + 1) * 86400000;
    const busy = await this.busy(new Date(now), new Date(horizon), { fresh, mock });
    const slot = cfg.duration_minutes * 60000;
    const grid = 30 * 60000;
    const win = this.dayWindow(cfg);
    const days = [];
    const seen = new Set();
    for (let i = 0; i <= cfg.days_ahead; i++) {
      const lp = localParts(new Date(now + i * 86400000), cfg.timezone);
      if (seen.has(lp.dateKey)) continue;
      seen.add(lp.dateKey);
      if (!cfg.days.includes(lp.weekday)) continue;
      let from = zoned(lp.dateKey, win.start, cfg.timezone).getTime();
      const to = win.end >= 1440 ? zoned(lp.dateKey, 0, cfg.timezone).getTime() + 86400000 : zoned(lp.dateKey, win.end, cfg.timezone).getTime();
      from = Math.max(from, earliest);
      from = Math.ceil(from / grid) * grid; // start on :00 / :30
      if (to - from < slot) continue;
      // Subtract busy blocks.
      let ranges = [{ start: from, end: to }];
      for (const b of busy) {
        ranges = ranges.flatMap(r => (b.end <= r.start || b.start >= r.end) ? [r]
          : [{ start: r.start, end: b.start }, { start: Math.ceil(b.end / grid) * grid, end: r.end }]);
      }
      ranges = ranges.filter(r => r.end - r.start >= slot);
      if (!ranges.length) continue;
      days.push({ dateKey: lp.dateKey, weekday: lp.weekday, d: lp.d, mo: lp.mo, ranges: ranges.map(r => ({ start: new Date(r.start), end: new Date(r.end) })) });
    }
    return days;
  }

  label(date, lang = 'ar') {
    const cfg = this.getConfig();
    const p = localParts(date, cfg.timezone);
    return lang === 'en'
      ? `${DAY_NAMES_EN[p.weekday]} ${p.d}/${p.mo} at ${hhmm(p.minutes)}`
      : `${DAY_NAMES[p.weekday]} ${p.d}/${p.mo} الساعة ${hhmm(p.minutes)}`;
  }

  /** Text block for the AI: the only times it may offer. */
  async promptBlock(conv = {}) {
    const mock = this.mockFor(conv);
    if (!this.isActive() && !mock) return '';
    const cfg = this.getConfig();
    let days;
    try { days = await this.availability({ mock }); } catch (e) {
      console.warn('[Calendar] availability failed:', e.message);
      return '\nمواعيد الاستشارة: تعذّر قراءة تقويم المهندس الآن. إذا طلب العميل موعداً، خذ الوقت اللي بناسبه وقل إن الفريق سيؤكده معه — لا تؤكد موعداً بنفسك.\n';
    }
    const tz = cfg.timezone;
    const fmt = (min) => (min >= 1440 ? '24:00' : hhmm(min));
    // Specific free start times (not ranges): the AI may only offer these, so it can never "merge" a busy hour in.
    const slot = cfg.duration_minutes * 60000;
    let total = 0;
    const lines = days.map(d => {
      const midnight = zoned(d.dateKey, 0, tz).getTime();
      const starts = [];
      for (const r of d.ranges) {
        for (let t = r.start.getTime(); t + slot <= r.end.getTime() && starts.length < 4; t += 2 * 3600000) starts.push(t);
      }
      if (!starts.length || total >= 14) return null;
      total += starts.length;
      return `- ${DAY_NAMES[d.weekday]} ${d.d}/${d.mo} (${d.dateKey}): ${starts.map(t => fmt(Math.round((t - midnight) / 60000))).join('، ')}`;
    }).filter(Boolean);
    void fmt;
    const booked = conv.appointment_at && new Date(conv.appointment_at).getTime() > Date.now()
      ? `\n- العميل عنده موعد محجوز: ${conv.appointment_label}${conv.appointment_link ? ` — رابط الاجتماع: ${conv.appointment_link}` : ''}. لا تحجز موعداً جديداً إلا إذا طلب تغيير الموعد.` : '';
    return `
مواعيد الاستشارة المجانية (من تقويم ${cfg.engineer_name} مباشرة — أوقات بداية متاحة فعلياً، بتوقيت عمّان، الاجتماع أونلاين ومدته ${cfg.duration_minutes} دقيقة):
${lines.length ? lines.join('\n') : '- لا توجد أوقات متاحة خلال الأيام القادمة.'}${booked}
قواعد المواعيد:
- إذا العميل حابب يحجز استشارة أو اجتماع، أو سأل إذا في موعد فاضي: اقترح وقتين أو ثلاثة من الأوقات فوق حرفياً، مع اليوم والتاريخ (مثل "الأحد 16/11 الساعة 10:00"). ممنوع تذكر فترات "من–إلى"، وممنوع تقترح أي وقت غير مكتوب فوق.
- إذا طلب العميل وقتاً محدداً آخر: ضع "book_start" بوقته، والنظام يتحقق إذا كان متاحاً ويرد عليه.
- إذا طلب وقتاً غير موجود ضمن المتاح: قل بوضوح إنه غير متاح، واقترح أقرب وقتين متاحين له.
- خلال تبادل المواعيد ضع "scheduling": true في الـ JSON (بدون تحويل للموظف).
- عندما يوافق العميل على وقت محدد: ضع فوراً "book_start": "YYYY-MM-DD HH:MM" ولا تطلب منه تأكيداً إضافياً ولا رقم هاتف قبل الحجز. النظام يحجز ويرسل التأكيد ورابط الاجتماع — لا تكتب رابطاً من عندك.
- ممنوع تكتب "تم الحجز" أو "تم تأكيد الموعد" بنفسك أبداً؛ التأكيد يكتبه النظام فقط بعد الحجز الفعلي.
- خلال اختيار الموعد لا تحوّل العميل لموظف ولا ترسل رسالة التحويل.
- إذا طلب العميل تغيير موعده المحجوز: نفس الطريقة، والنظام ينقل الموعد.
`;
  }

  /** Is this exact slot inside the booking rules and free right now? */
  async checkSlot(start, mock = null) {
    const cfg = this.getConfig();
    const end = new Date(start.getTime() + cfg.duration_minutes * 60000);
    if (start.getTime() < Date.now() + cfg.min_notice_hours * 3600000) return { ok: false, why: 'too_soon' };
    if (start.getTime() > Date.now() + (cfg.days_ahead + 1) * 86400000) return { ok: false, why: 'too_far' };
    const lp = localParts(start, cfg.timezone);
    if (!cfg.days.includes(lp.weekday)) return { ok: false, why: 'closed_day' };
    const win = this.dayWindow(cfg);
    const endMin = lp.minutes + cfg.duration_minutes;
    if (lp.minutes < win.start || endMin > win.end) return { ok: false, why: 'outside_hours' };
    const busy = await this.busy(start, end, { fresh: true, mock });
    if (busy.some(b => b.start < end.getTime() && b.end > start.getTime())) return { ok: false, why: 'taken' };
    return { ok: true, end };
  }

  /** Nearest free slot starts (for "that time is taken, how about…"). */
  async suggestions(count = 3, after = null, mock = null) {
    const cfg = this.getConfig();
    const step = 30 * 60000;
    const out = [];
    const days = await this.availability({ fresh: true, mock });
    for (const d of days) {
      for (const r of d.ranges) {
        for (let t = r.start.getTime(); t + cfg.duration_minutes * 60000 <= r.end.getTime(); t += step) {
          if (after && t < after.getTime()) continue;
          out.push(new Date(t));
          break; // one per free block keeps the options spread out
        }
        if (out.length >= count) return out;
      }
    }
    return out;
  }

  /**
   * Times the bot offered in a message: [{ key: 'YYYY-MM-DD HH:MM' }]. Understands "16/11 الساعة 10:00 أو 12:30",
   * "بكرا الساعة 10:00", "tomorrow at 10:00", and skips a time the bot just turned down.
   */
  /** "Friday, November 13th at 12:00 PM" / "الجمعة الساعة 3 العصر" → "13/11 12:00" style the parsers read. */
  normalizeTimes(text) {
    const cfg = this.getConfig();
    let t = String(text || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mon = (w) => MONTHS.indexOf(String(w).slice(0, 3).toLowerCase()) + 1;
    t = t.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi, (m, w, d) => `${+d}/${mon(w)}`);
    t = t.replace(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/gi, (m, d, w) => `${+d}/${mon(w)}`);
    t = t.replace(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/gi, (m, h, mi, ap) => {
      let H = +h % 12; if (/p/i.test(ap)) H += 12;
      return `${pad(H)}:${mi || '00'}`;
    });
    // A weekday without a date next to it → the next date with that weekday.
    const EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = localParts(new Date(), cfg.timezone);
    const dateOf = (wd) => { const off = (wd - today.weekday + 7) % 7; const p = localParts(new Date(Date.now() + off * 86400000), cfg.timezone); return `${p.d}/${p.mo}`; };
    t = t.replace(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b,?(?!\s*\d{1,2}\/)/gi, (m, w) => `${w} ${dateOf(EN.indexOf(w.toLowerCase()))}`);
    t = t.replace(/(الأحد|الاحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)(?!\s*\d{1,2}\/)/g, (m, w) => {
      const i = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].indexOf(w.replace('الاحد', 'الأحد').replace('الإثنين', 'الاثنين').replace('الاربعاء', 'الأربعاء'));
      return i < 0 ? m : `${m} ${dateOf(i)}`;
    });
    // "الساعة 3 العصر" / "at 3" → 15:00 / 03:00
    t = t.replace(/(الساعة|at)\s*(\d{1,2})(?![:\d])(\s*(?:العصر|المسا|مساءً|بالليل|الظهر))?/gi, (m, w, h, pm) => {
      let H = +h; if (pm && H < 12) H += 12;
      return `${w} ${pad(H)}:00`;
    });
    return t;
  }

  offeredIn(text) {
    const cfg = this.getConfig();
    let t = this.normalizeTimes(text);
    const refusal = t.search(/مش متاح|غير متاح|ما بزبط|محجوز|خارج أوقات|not available|taken|outside the available/i);
    if (refusal >= 0) {
      const rest = t.slice(refusal);
      const offer = rest.search(/عندي|عنا|أقرب|متاحة|available|nearest|free/i);
      const before = t.slice(0, refusal).match(/\d{1,2}\/\d{1,2}/g);
      t = offer < 0 ? '' : (before && !/\d{1,2}\/\d{1,2}/.test(rest.slice(offer)) ? `${before[before.length - 1]} ` : '') + rest.slice(offer);
    }
    const now = localParts(new Date(), cfg.timezone);
    const keyFor = (d, mo) => { let y = now.y; if (mo < now.mo - 6) y += 1; return `${y}-${pad(mo)}-${pad(d)}`; };
    const tomorrow = localParts(new Date(Date.now() + 86400000), cfg.timezone);
    const out = [];
    let date = null;
    const re = /(\d{1,2})\/(\d{1,2})|(بكرا|بكره|غداً|غدا|tomorrow)|(\d{1,2}):(\d{2})/gi;
    let m;
    while ((m = re.exec(t))) {
      if (m[1]) date = keyFor(+m[1], +m[2]);
      else if (m[3]) date = tomorrow.dateKey;
      else if (m[4] && date) {
        const k = `${date} ${pad(+m[4])}:${m[5]}`;
        if (!out.includes(k)) out.push(k);
      }
    }
    return out;
  }

  /**
   * Which offered time did the customer just pick? Returns 'YYYY-MM-DD HH:MM' or null.
   * "12:00 بناسبني", "الساعة 12", "الأول", "the second one", "تمام" (when only one time was offered),
   * or an explicit date + time ("15/11 الساعة 10:00").
   */
  choiceFrom(customerText, lastBotText) {
    const text = this.normalizeTimes(customerText);
    const offered = this.offeredIn(lastBotText);
    // Explicit date and time from the customer: use it (the calendar check decides if it is free).
    const explicit = this.offeredIn(text.replace(/(\d{1,2})\s*(?:ص|الصبح|صباحاً|am)\b/gi, '$1:00').replace(/الساعة\s*(\d{1,2})(?![:\d])/g, 'الساعة $1:00'));
    if (explicit.length === 1) return explicit[0];
    if (!offered.length) return null;
    const hm = text.match(/(\d{1,2}):(\d{2})/) || text.match(/(?:الساعة|at)\s*(\d{1,2})\b/i);
    if (hm) {
      let h = +hm[1];
      const mi = hm[2] ? +hm[2] : 0;
      if (/مسا|مساءً|بالليل|العصر|pm/i.test(text) && h < 12) h += 12;
      const same = offered.filter(k => +k.slice(11, 13) === h && +k.slice(14, 16) === mi);
      const pm = offered.filter(k => +k.slice(11, 13) === h + 12 && +k.slice(14, 16) === mi);
      if (same.length === 1) return same[0];
      if (!same.length && pm.length === 1) return pm[0];
    }
    const ord = [/(الأول|الاول|أول وقت|first)/i, /(الثاني|التاني|second)/i, /(الثالث|التالت|third)/i].findIndex(r => r.test(text));
    if (ord >= 0 && offered[ord]) return offered[ord];
    if (offered.length === 1 && /(تمام|اوكي|أوكي|ok|okay|yes|نعم|أكيد|اكيد|موافق|بناسبني|مناسب|works|sounds good|perfect)/i.test(text)) return offered[0];
    return null;
  }

  parseLocal(text) {
    const m = String(text || '').match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
    if (!m) return null;
    const cfg = this.getConfig();
    return zoned(`${m[1]}-${pad(m[2])}-${pad(m[3])}`, Number(m[4]) * 60 + Number(m[5]), cfg.timezone);
  }

  /**
   * Book (or move) the customer's consultation.
   * Returns { ok, appointment, reply } — reply is the exact text to send the customer.
   */
  async book({ start: startText, conv = {}, lang = 'ar' }) {
    const cfg = this.getConfig();
    const mock = this.mockFor(conv);
    const start = this.parseLocal(startText);
    const en = lang === 'en';
    const alternatives = async (after) => {
      const s = await this.suggestions(3, after, mock).catch(() => []);
      if (!s.length) return en ? 'There are no free times in the coming days; our team will contact you to arrange one.' : 'لا توجد أوقات متاحة خلال الأيام القادمة، وسيتواصل معك الفريق لترتيب موعد.';
      return (en ? 'The nearest free times are: ' : 'أقرب الأوقات المتاحة: ') + s.map(d => this.label(d, lang)).join(en ? ', ' : '، ') + (en ? '. Which one suits you?' : '. أي وقت يناسبك؟');
    };
    if (!start) return { ok: false, reply: await alternatives() };
    let check;
    try { check = await this.checkSlot(start, mock); } catch (e) {
      console.error('[Calendar] check failed:', e.message);
      return { ok: false, error: e.message, reply: en ? 'I could not confirm the time right now. Our team will confirm it with you shortly.' : 'تعذّر تأكيد الموعد الآن، وسيتواصل معك الفريق لتأكيده قريباً.' };
    }
    if (!check.ok) {
      const lead = check.why === 'taken'
        ? (en ? `${this.label(start, lang)} has just been taken.` : `موعد ${this.label(start, lang)} غير متاح.`)
        : (en ? `${this.label(start, lang)} is outside the available booking times.` : `موعد ${this.label(start, lang)} خارج أوقات الحجز المتاحة.`);
      return { ok: false, why: check.why, reply: `${lead} ${await alternatives(start)}` };
    }

    const sim = String(conv.channel || '').startsWith('simulator');
    const details = [
      `العميل: ${conv.customer_name || 'عميل'}`,
      conv.customer_phone ? `الهاتف: ${conv.customer_phone}` : '',
      conv.customer_email ? `البريد: ${conv.customer_email}` : '',
      `القناة: ${conv.channel || '-'}`,
      conv.business_type ? `النشاط: ${conv.business_type}` : '',
      conv.customer_requests ? `الطلب: ${conv.customer_requests}` : '',
      conv.customer_summary ? `الملخص: ${conv.customer_summary}` : '',
      cfg.meeting_link ? `رابط الاجتماع الثابت: ${cfg.meeting_link}` : ''
    ].filter(Boolean).join('\n');
    const event = {
      summary: `${sim ? '[تجربة] ' : ''}استشارة atlead — ${conv.customer_name || 'عميل'}`,
      description: details,
      start: { dateTime: start.toISOString(), timeZone: cfg.timezone },
      end: { dateTime: check.end.toISOString(), timeZone: cfg.timezone },
      ...(cfg.meeting_link ? { location: cfg.meeting_link } : {})
    };
    const cal = encodeURIComponent(cfg.calendar_id);
    let created;
    if (mock) {
      created = { id: `rehearsal_${crypto.randomBytes(4).toString('hex')}`, hangoutLink: 'https://meet.google.com/rehearsal-only' };
      const list = ((this._mockBooked ||= new Map()).get(mock) || []).filter(b => b.id !== conv.appointment_event_id);
      list.push({ id: created.id, start: start.getTime(), end: check.end.getTime() });
      this._mockBooked.set(mock, list);
    } else try {
      created = (await this.api('post', `/calendars/${cal}/events`, {
        ...event, conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
      }, { conferenceDataVersion: 1 })).data;
    } catch (e) {
      // Calendars without Meet for this account: book without it and use the fixed link.
      try { created = (await this.api('post', `/calendars/${cal}/events`, event)).data; } catch (e2) {
        console.error('[Calendar] insert failed:', e2.response?.data?.error?.message || e2.message);
        return { ok: false, error: e2.message, reply: en ? 'I could not book it automatically right now. Our team will confirm the time with you shortly.' : 'تعذّر الحجز التلقائي الآن، وسيتواصل معك الفريق لتأكيد الموعد قريباً.' };
      }
    }
    this._busy = null;
    const link = created.hangoutLink || created.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri || cfg.meeting_link || '';

    // Moving an existing booking: remove the old event.
    if (!mock && conv.appointment_event_id && conv.appointment_event_id !== created.id) {
      this.api('delete', `/calendars/${cal}/events/${encodeURIComponent(conv.appointment_event_id)}`).catch(() => {});
    }

    const appointment = {
      appointment_at: start.toISOString(),
      appointment_end: check.end.toISOString(),
      appointment_label: this.label(start, 'ar'),
      appointment_link: link,
      appointment_event_id: created.id,
      appointment_html_link: created.htmlLink || ''
    };
    const when = this.label(start, lang);
    const reply = en
      ? `Your consultation is confirmed for ${when} (Amman time). It is an online meeting of ${cfg.duration_minutes} minutes.${link ? `\nMeeting link: ${link}` : '\nWe will send you the meeting link before the meeting.'}\nIf you need to change the time, just tell me.`
      : `تم تأكيد موعد استشارتك يوم ${when} (بتوقيت عمّان)، والاجتماع أونلاين ومدته ${cfg.duration_minutes} دقيقة.${link ? `\nرابط الاجتماع: ${link}` : '\nسنرسل لك رابط الاجتماع قبل الموعد.'}\nإذا احتجت تغيير الموعد، أخبرني.`;

    // Tell the team on Telegram (in the background).
    try {
      const telegram = require('./telegramService');
      if (telegram.isConfigured() && !mock) {
        const esc = (s) => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
        telegram.sendMessage([
          `<b>${conv.appointment_event_id ? 'تم تغيير موعد استشارة' : 'موعد استشارة جديد'}</b>${sim ? ' (تجربة)' : ''}`,
          `${esc(conv.customer_name || 'عميل')} — ${esc(appointment.appointment_label)}`,
          conv.customer_phone ? esc(conv.customer_phone) : '',
          link ? esc(link) : ''
        ].filter(Boolean).join('\n'), { type: 'appointment' }).catch(() => {});
      }
    } catch { /* optional */ }

    return { ok: true, appointment, reply };
  }

  /** Settings → "فحص التقويم". */
  async test() {
    const cfg = this.getConfig();
    const sa = this.serviceAccount();
    if (!sa) return { success: false, message: 'يلزم ملف Service Account من Google — أضفه في بطاقة Google Sheets أولاً (نفس الحساب يُستخدم للتقويم).' };
    if (!cfg.calendar_id) return { success: false, message: 'اكتب معرّف تقويم المهندس (عادةً بريده على Gmail).', service_account_email: sa.client_email };
    try {
      await this.api('get', `/calendars/${encodeURIComponent(cfg.calendar_id)}`);
    } catch (e) {
      const st = e.response?.status;
      const msg = st === 404 || st === 403
        ? `التقويم غير مُشارك مع حساب الخدمة. من Google Calendar ← إعدادات التقويم ← المشاركة مع أشخاص محددين ← أضف ${sa.client_email} بصلاحية «إجراء تغييرات على الأحداث».`
        : `تعذّر الوصول إلى التقويم: ${e.response?.data?.error?.message || e.message}`;
      return { success: false, message: msg, service_account_email: sa.client_email };
    }
    try {
      const next = await this.suggestions(3);
      return {
        success: true,
        service_account_email: sa.client_email,
        next: next.map(d => this.label(d)),
        message: next.length ? `التقويم مربوط. أقرب الأوقات المتاحة: ${next.map(d => this.label(d)).join('، ')}.` : 'التقويم مربوط، لكن لا توجد أوقات متاحة ضمن أوقات الحجز خلال الأيام القادمة.'
      };
    } catch (e) {
      return { success: false, message: `تعذّر قراءة الأوقات المشغولة: ${e.message}`, service_account_email: sa.client_email };
    }
  }
}

module.exports = new CalendarService();
module.exports.DEFAULTS = DEFAULTS;
module.exports._zoned = zoned;
