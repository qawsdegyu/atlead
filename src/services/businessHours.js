/**
 * Working hours (default: Jordan time, Sunday–Thursday 09:00–17:00).
 * The bot answers 24/7; working hours only decide:
 *  - what the customer is told at handoff ("رح يتواصل معك بكرا الساعة 9"),
 *  - whether staff emails are held until the next opening (optional),
 *  - when follow-up messages may be sent.
 */
const storageService = require('./storageService');

const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DEFAULTS = {
  enabled: true,
  timezone: 'Asia/Amman',
  days: [0, 1, 2, 3, 4], // Sun..Thu
  start: '09:00',
  end: '17:00',
  hold_emails_until_open: false,
  after_hours_message: 'تمام 🙏 دوامنا خلص هلق، بس {rep} رح يتواصل معك {time} لمتابعة كل التفاصيل وترتيب كل شيء معك. شكراً لاهتمامك وثقتك.'
};

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

function getConfig() {
  const cfg = { ...DEFAULTS, ...(storageService.getSettings().business_hours || {}) };
  if (!Array.isArray(cfg.days)) cfg.days = DEFAULTS.days;
  cfg.days = cfg.days.map(Number).filter(d => d >= 0 && d <= 6);
  if (!cfg.after_hours_message || !String(cfg.after_hours_message).trim()) cfg.after_hours_message = DEFAULTS.after_hours_message;
  return cfg;
}

// Local wall-clock parts in the business timezone.
function localParts(date = new Date(), timezone = getConfig().timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const hour = Number(parts.hour) % 24;
  return {
    weekday,
    minutes: hour * 60 + Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`, // local calendar date
    hour,
    minute: Number(parts.minute)
  };
}

function isOpen(date = new Date()) {
  const cfg = getConfig();
  if (!cfg.enabled) return true;
  const p = localParts(date, cfg.timezone);
  return cfg.days.includes(p.weekday) && p.minutes >= toMinutes(cfg.start) && p.minutes < toMinutes(cfg.end);
}

/**
 * Next opening moment. Returns { date, label } where label is Arabic, e.g.
 * "اليوم الساعة 09:00" / "بكرا الساعة 09:00" / "يوم الأحد الساعة 09:00".
 */
function nextOpening(from = new Date()) {
  const cfg = getConfig();
  if (!cfg.days.length) return null;
  const startMin = toMinutes(cfg.start);
  const now = localParts(from, cfg.timezone);
  for (let offset = 0; offset <= 7; offset++) {
    const weekday = (now.weekday + offset) % 7;
    if (!cfg.days.includes(weekday)) continue;
    if (offset === 0 && now.minutes >= startMin) continue; // today's opening already passed
    const minutesUntil = offset * 1440 + startMin - now.minutes;
    const date = new Date(from.getTime() + minutesUntil * 60000);
    const time = cfg.start;
    const label = offset === 0 ? `اليوم الساعة ${time}` : offset === 1 ? `بكرا الساعة ${time}` : `يوم ${DAY_NAMES[weekday]} الساعة ${time}`;
    return { date, label };
  }
  return null;
}

// Quiet hours for proactive messages (follow-ups): only while open, or 09:00–21:00 if hours are disabled.
function canSendProactive(date = new Date()) {
  const cfg = getConfig();
  if (cfg.enabled) return isOpen(date);
  const p = localParts(date, cfg.timezone);
  return p.minutes >= 9 * 60 && p.minutes < 21 * 60;
}

module.exports = { getConfig, isOpen, nextOpening, localParts, canSendProactive, toMinutes, DAY_NAMES, DEFAULTS };
