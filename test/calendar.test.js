// Google Calendar booking: the bot only offers free times, books what the customer confirms, and never double-books.
const { fake, reset, calls } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const storage = require('../src/services/storageService');
const ai = require('../src/services/aiService');
const cal = require('../src/services/calendarService');
const crm = require('../src/services/crmService');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'bot@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

// Tomorrow's date in Amman, and a real instant for a wall-clock time on it.
const amman = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const tomorrow = amman(new Date(Date.now() + 86400000));
const at = (hhmm) => cal._zoned(tomorrow, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), 'Asia/Amman');

let answers; let busy; let inserted;
test.beforeEach(() => {
  reset();
  cal._busy = null; cal._token = null;
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter' },
    google_sheets: { service_account_json: JSON.stringify(sa) },
    calendar: { enabled: true, calendar_id: 'eng@gmail.com', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '21:00', all_day: false, duration_minutes: 30, min_notice_hours: 0, days_ahead: 3 }
  }, { skipDbSync: true });
  busy = [{ start: at('10:00').toISOString(), end: at('12:00').toISOString() }];
  inserted = [];
  fake('post', /oauth2\.googleapis\.com\/token/, () => ({ access_token: 'tok', expires_in: 3600 }));
  fake('post', /calendar\/v3\/freeBusy/, () => ({ calendars: { 'eng@gmail.com': { busy } } }));
  fake('post', /calendar\/v3\/calendars\/.+\/events/, (req) => {
    inserted.push(req.body);
    return { id: 'ev1', htmlLink: 'https://calendar.google.com/ev1', hangoutLink: 'https://meet.google.com/abc-defg-hij' };
  });
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify(answers.shift()) } }] }));
});

const conv = () => ({ id: 'c1', channel: 'whatsapp', messages: [], customer_name: 'سامي', customer_phone: '0790000000' });

test('the AI is only shown the real free times (busy blocks removed, inside the booking hours)', async () => {
  const block = await cal.promptBlock(conv());
  const [, m, d] = tomorrow.split('-').map(Number);
  const line = block.split('\n').find(l => l.includes(`${d}/${m}`));
  assert.ok(line, 'tomorrow is listed');
  assert.match(line, /09:00، 12:00، 14:00/, 'specific free start times');
  assert.doesNotMatch(line, /1[01]:\d\d/, 'never a time inside the busy block');
  assert.ok(block.split('\n').filter(l => /\(\d{4}-\d{2}-\d{2}\):/.test(l)).every(l => !l.includes('–')), 'no from–to ranges for the AI to merge');
});

test('a confirmed free time is booked with a Meet link, and the customer gets the exact confirmation', async () => {
  answers = [{ reply_text: 'تمام، حجزتلك', book_start: `${tomorrow} 12:00`, buying_probability: 80 }];
  const r = await ai.generateReply(conv(), 'تمام بكرا الساعة 12 بناسبني');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].start.dateTime, at('12:00').toISOString());
  assert.ok(inserted[0].conferenceData?.createRequest, 'asks Google to create a Meet link');
  assert.match(r.reply_text, /تم تأكيد موعد استشارتك/);
  assert.match(r.reply_text, /meet\.google\.com\/abc-defg-hij/);
  assert.equal(r.appointment.appointment_event_id, 'ev1');
  // The booking is the handoff, and the confirmation (not the generic handoff text) is what is sent.
  assert.equal(crm.shouldHandoff(r), true);
  assert.equal(crm.replyForTurn(null, r, true), r.reply_text);
});

test('a taken time is never booked — the customer gets the nearest free times instead', async () => {
  answers = [{ reply_text: 'تم', book_start: `${tomorrow} 10:30`, buying_probability: 80 }];
  const r = await ai.generateReply(conv(), 'بدي الساعة 10:30');
  assert.equal(inserted.length, 0);
  assert.match(r.reply_text, /غير متاح/);
  assert.match(r.reply_text, /أقرب الأوقات المتاحة/);
  assert.equal(r.scheduling, true);
  assert.equal(crm.shouldHandoff(r), false, 'still agreeing a time — the bot stays with the customer');
});

test('times outside the booking hours are refused', async () => {
  answers = [{ reply_text: 'تم', book_start: `${tomorrow} 22:00`, buying_probability: 80 }];
  const r = await ai.generateReply(conv(), 'الساعة 10 بالليل');
  assert.equal(inserted.length, 0);
  assert.match(r.reply_text, /خارج أوقات الحجز/);
});

test('offering times is not cut off by the handoff, and times/dates are not treated as invented numbers', async () => {
  const [, m, d] = tomorrow.split('-').map(Number);
  answers = [{ reply_text: `عندنا ${d}/${m} الساعة 09:00 أو الساعة 12:30، أي واحد بناسبك؟`, scheduling: true, buying_probability: 90 }];
  const r = await ai.generateReply(conv(), 'بدي أحجز استشارة');
  assert.equal(r.grounding_fixed, undefined);
  assert.match(r.reply_text, /12:30/);
  assert.equal(crm.shouldHandoff(r), false);
});

test('when the calendar is off, nothing is read and no booking happens', async () => {
  storage.updateSettings({ calendar: { enabled: false } }, { skipDbSync: true });
  answers = [{ reply_text: 'تمام', book_start: `${tomorrow} 12:00`, buying_probability: 50 }];
  const r = await ai.generateReply(conv(), 'بكرا 12');
  assert.equal(calls.filter(c => /googleapis\.com\/calendar/.test(c.url)).length, 0);
  assert.equal(r.appointment, undefined);
});

test('if Google Meet cannot be created, the booking still happens with the fixed meeting link', async () => {
  storage.updateSettings({ calendar: { enabled: true, meeting_link: 'https://zoom.us/j/123' } }, { skipDbSync: true });
  const { status } = require('./helpers');
  fake('post', /calendar\/v3\/calendars\/.+\/events/, (req) => {
    if (req.body.conferenceData) return status(400, { error: { message: 'Invalid conference type value.' } });
    inserted.push(req.body);
    return { id: 'ev2' };
  });
  answers = [{ reply_text: 'تم', book_start: `${tomorrow} 15:00`, buying_probability: 80 }];
  const r = await ai.generateReply(conv(), 'الساعة 3');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].location, 'https://zoom.us/j/123');
  assert.match(r.reply_text, /zoom\.us\/j\/123/);
  storage.updateSettings({ calendar: { meeting_link: '' } }, { skipDbSync: true });
});

// Bugs found by the live rehearsal: the model may forget to book, may claim a booking, or hand off mid-scheduling.
const convOffered = () => ({
  ...conv(),
  messages: [{ sender: 'bot', content: `عندي مواعيد متاحة بكرا ${+tomorrow.slice(8)}/${+tomorrow.slice(5, 7)} الساعة 12:00 أو الساعة 16:00. أي وقت يناسبك؟` }]
});

test('the customer picks an offered time and the model forgets to book → the server books it', async () => {
  answers = [{ reply_text: 'تمام، هل هذا الوقت مناسب لك؟', buying_probability: 70 }];
  const r = await ai.generateReply(convOffered(), 'تمام، الساعة 16:00 بناسبني');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].start.dateTime, at('16:00').toISOString());
  assert.match(r.reply_text, /تم تأكيد موعد استشارتك/);
});

test('the model can never claim a booking that did not happen', async () => {
  answers = [{ reply_text: 'تمام، تم حجز اجتماعك مع المهندس!', buying_probability: 80 }];
  const r = await ai.generateReply(convOffered(), 'وكمان عندي سؤال عن الأسعار');
  assert.equal(inserted.length, 0);
  assert.doesNotMatch(r.reply_text, /تم حجز/);
  assert.match(r.reply_text, /أي وقت من هدول بناسبك/);
});

test('agreeing a time is never interrupted by the generic handoff message', async () => {
  answers = [{ reply_text: 'ممتاز، أي وقت بناسبك؟', handoff_triggered: true, buying_probability: 95 }];
  const r = await ai.generateReply(convOffered(), 'بدي اجتماع، شو الأوقات؟');
  assert.equal(crm.shouldHandoff(r), false);
});
