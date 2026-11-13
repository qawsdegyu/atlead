/**
 * Booking rehearsal (admin test) for the chat bot's Google Calendar booking.
 * Runs scripted customers through the real chat pipeline (same code as WhatsApp / Messenger:
 * generateReply → handoff rules → reply → saved state) with the real AI. When Google Calendar is not
 * connected, a simulated calendar is used with known busy times (tomorrow 10:00–12:00 and 14:00–15:00),
 * so every time the bot offers can be checked: never busy, never outside hours, never in the past.
 * Test conversations (channel "simulator_booking") are deleted afterwards and never alert the team.
 */
const crypto = require('crypto');
const storageService = require('./storageService');

const amman = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const tomorrowKey = () => amman(new Date(Date.now() + 86400000));
const dm = (key) => { const [, m, d] = key.split('-').map(Number); return `${d}/${m}`; };

const SCENARIOS = {
  book: { lang: 'ar', name: 'رامي', lines: () => ['مرحبا، عندي متجر إلكتروني وبدي أعرف أكثر عن الشات بوت', 'حلو، بدي أحجز اجتماع مع المهندس', '<pick>'] },
  busy_time: { lang: 'ar', name: 'هبة', lines: () => ['مرحبا، بدي أحجز استشارة مع المهندس', `بناسبني بكرا ${dm(tomorrowKey())} الساعة 11:00`, '<pick>'] },
  outside_hours: { lang: 'ar', name: 'خالد', lines: () => ['بدي موعد مع المهندس', `بكرا ${dm(tomorrowKey())} الساعة 11 بالليل`, '<pick>'] },
  reschedule: { lang: 'ar', name: 'سارة', lines: () => ['مرحبا بدي أحجز اجتماع مع المهندس', '<pick>', 'معلش بدي أغيّر الموعد لوقت ثاني', '<pick2>'] },
  english: { lang: 'en', name: 'John', lines: () => ['Hi, I would like to book a meeting with your engineer', '<pick>'] },
  // The real WhatsApp case, with no calendar connected (as on the live site today).
  no_calendar: { lang: 'ar', name: 'operix', calendar: false, lines: () => ['مرحبا', 'بدي احجز استشاره مجانيه', 'يوم الأحد الساعة 11 الصبح'] }
};

const jobs = new Map();

// Every "d/m ... HH:MM" the bot offered → check it against the simulated calendar rules.
function offeredTimes(text) {
  const out = [];
  const re = /(\d{1,2})\/(\d{1,2})[^\n]{0,40}?(\d{1,2}):(\d{2})/g;
  let m;
  while ((m = re.exec(text))) out.push({ d: +m[1], mo: +m[2], h: +m[3], mi: +m[4], raw: m[0] });
  // Several times after one date ("16/11 الساعة 10:00 أو 12:30") share that date.
  let dateMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
  // "بكرا" / "tomorrow" without a written date = tomorrow.
  if (!dateMatch && /بكرا|بكره|غداً|غدا|tomorrow/i.test(text)) { const [, mo, d] = tomorrowKey().split('-').map(Number); dateMatch = [null, d, mo]; }
  if (dateMatch) {
    const re2 = /(?:الساعة|at|،|or|أو)\s*(\d{1,2}):(\d{2})/g;
    while ((m = re2.exec(text))) if (!out.some(o => o.h === +m[1] && o.mi === +m[2])) out.push({ d: +dateMatch[1], mo: +dateMatch[2], h: +m[1], mi: +m[2], raw: m[0] });
  }
  return out;
}

// When the bot turns a time down, only what comes after its offer ("عندي…", "أقرب…", "available…") counts as offered.
function offerPart(text) {
  const refusal = text.search(/مش متاح|غير متاح|ما بزبط|محجوز|خارج أوقات|not available|taken|outside the available/i);
  if (refusal < 0) return text;
  const rest = text.slice(refusal);
  const offer = rest.search(/عندي|عنا|أقرب|متاحة|available|nearest|free/i);
  if (offer < 0) return '';
  const part = rest.slice(offer);
  // "…13/11 الساعة 11:00 مش متاح. عندي الساعة 12:00 أو 15:00" → the offered times are on that same date.
  if (!/\d{1,2}\/\d{1,2}/.test(part)) {
    const dates = text.slice(0, refusal + offer).match(/\d{1,2}\/\d{1,2}/g);
    if (dates) return `${dates[dates.length - 1]} ${part}`;
  }
  return part;
}

function pick(text, nth = 0) {
  const t = offeredTimes(offerPart(text));
  const o = t[Math.min(nth, t.length - 1)];
  if (!o) return null;
  return `${o.d}/${o.mo} ${String(o.h).padStart(2, '0')}:${String(o.mi).padStart(2, '0')}`;
}

async function turn(conv, text) {
  const ai = require('./aiService');
  const crm = require('./crmService');
  const replyEngine = require('./replyEngine');
  storageService.addMessage(conv.id, { sender: 'customer', content: text, media_type: 'text' });
  conv = storageService.getConversationById(conv.id);
  const history = { ...conv, messages: conv.messages.slice(0, -1) };
  const aiResult = await ai.generateReply(history, text);
  const handoff = crm.shouldHandoff(aiResult) && !conv.handoff_at;
  const reply = crm.replyForTurn(conv.id, aiResult, handoff);
  storageService.addMessage(conv.id, { sender: 'bot', content: reply, media_type: 'text' });
  await replyEngine.applyAiState(storageService.getConversationById(conv.id), aiResult, handoff);
  return { reply, aiResult, handoff };
}

async function run(id, key) {
  const job = jobs.get(id);
  const sc = SCENARIOS[key];
  const cal = require('./calendarService');
  try {
    let conv = storageService.saveConversation({
      channel: 'simulator_booking', external_user_id: `booking_${id}`, customer_name: sc.name, lead_stage: 'new', is_bot_active: true, rehearsal_calendar: sc.calendar !== false
    });
    job.calendar = cal.isActive() ? 'google' : 'simulated';
    const transcript = [];
    const bookings = [];
    const problems = [];
    let lastBot = '';
    let picks = 0;
    const lines = sc.lines();
    for (let i = 0; i < lines.length + (sc.calendar === false ? 0 : 2) && i < 8; i++) {
      let text = lines[i];
      if (!text) {
        if (bookings.length >= (key === 'reschedule' ? 2 : 1)) break;
        text = '<pick>'; // the bot is still asking: answer with a time it offered
      }
      if (text.startsWith('<pick')) {
        // Same reader the server uses: pick the 1st (or 2nd) time the bot offered.
        const offered = cal.offeredIn(lastBot);
        const k = offered[Math.min(text === '<pick2>' ? 1 : 0, offered.length - 1)];
        if (!k) text = sc.lang === 'en' ? 'Which times are available?' : 'شو الأوقات المتاحة؟';
        else {
          const [, mo, d] = k.slice(0, 10).split('-').map(Number);
          const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          text = sc.lang === 'en' ? `${MON[mo - 1]} ${d} at ${k.slice(11)} works for me.` : `تمام، ${d}/${mo} الساعة ${k.slice(11)} بناسبني.`;
        }
        picks++;
      }
      transcript.push(`العميل: ${text}`);
      const r = await turn(conv, text);
      lastBot = r.reply;
      transcript.push(`البوت: ${r.reply}`);
      // Rule check on every time the bot mentioned.
      const now = Date.now();
      const tomorrow = tomorrowKey();
      const isBusy = (dayKey, minutes) => dayKey === tomorrow && ((minutes >= 600 && minutes < 720) || (minutes >= 840 && minutes < 900));
      for (const k of cal.offeredIn(r.reply)) {
        const dayKey = k.slice(0, 10);
        const minutes = +k.slice(11, 13) * 60 + +k.slice(14, 16);
        const at = cal._zoned(dayKey, minutes, 'Asia/Amman').getTime();
        if (job.calendar === 'simulated' && isBusy(dayKey, minutes)) problems.push(`offered a busy time: ${k}`);
        if (minutes < 540 || minutes + 30 > 1260) problems.push(`outside booking hours: ${k}`);
        if (at < now) problems.push(`in the past: ${k}`);
      }
      // "from 9:00 to 14:00" claims: the whole range must be free.
      const norm = cal.normalizeTimes(r.reply);
      const rangeRe = /(\d{1,2})\/(\d{1,2})[^\n.]{0,40}?(?:من|from)?\s*(\d{1,2}):(\d{2})\s*(?:إلى|الى|لـ|لل|to|until|-|–)\s*(\d{1,2}):(\d{2})/gi;
      let rm;
      while ((rm = rangeRe.exec(norm))) {
        const dayKey = `${new Date().getFullYear()}-${String(+rm[2]).padStart(2, '0')}-${String(+rm[1]).padStart(2, '0')}`;
        const a = +rm[3] * 60 + +rm[4];
        const b = +rm[5] * 60 + +rm[6];
        for (let m = a; m < b; m += 30) if (job.calendar === 'simulated' && isBusy(dayKey, m)) { problems.push(`range includes busy time: ${rm[0]}`); break; }
      }
      if (r.aiResult.appointment) bookings.push(r.aiResult.appointment.appointment_label);
      conv = storageService.getConversationById(conv.id);
    }
    conv = storageService.getConversationById(conv.id);
    Object.assign(job, {
      status: 'done', scenario: key, transcript, bookings, problems,
      final: {
        appointment: conv.appointment_label || null,
        requested_time: conv.requested_meeting_time || null,
        meeting_link: conv.appointment_link || null,
        handed_to_sales: !!conv.handoff_at,
        handoff_reason: conv.handoff_reason || null
      }
    });
    if (job.cleanup) {
      storageService.deleteConversation(conv.id);
      require('./supabaseService').deleteConversation(conv).catch(() => {});
      cal._mockBooked?.delete(conv.id);
    }
  } catch (e) {
    job.status = 'error';
    job.error = e.response?.data?.error?.message || e.message;
  }
}

module.exports = {
  SCENARIOS,
  offeredTimes,
  offerPart,
  pick,
  start(key = 'book', { cleanup = true } = {}) {
    if (!SCENARIOS[key]) throw new Error('unknown scenario');
    const id = crypto.randomBytes(6).toString('hex');
    jobs.set(id, { id, status: 'running', scenario: key, cleanup });
    run(id, key);
    return jobs.get(id);
  },
  get(id) { return jobs.get(id) || null; }
};
