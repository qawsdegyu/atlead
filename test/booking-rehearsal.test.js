// Booking rehearsal: real chat pipeline + simulated calendar; the checker catches any bad time offered.
const { fake, reset, calls } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const rehearsal = require('../src/services/bookingRehearsal');

const amman = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const tomorrow = amman(new Date(Date.now() + 86400000));
const [, M, D] = tomorrow.split('-').map(Number);
let answers;

test.beforeEach(() => {
  reset();
  storage.updateSettings({ ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter' }, calendar: { enabled: false }, ai_call: { enabled: false } }, { skipDbSync: true });
  fake('post', /openrouter\.ai/, (req) => {
    const prompt = JSON.stringify(req.body.messages);
    assert.match(prompt, /12:00–14:00/, 'the AI sees the simulated free times (busy 10–12 and 14–15 removed)');
    return { choices: [{ message: { content: JSON.stringify(answers.shift() || { reply_text: 'تمام' }) } }] };
  });
});

const wait = async (id) => { for (let i = 0; i < 200 && rehearsal.get(id).status === 'running'; i++) await new Promise(r => setTimeout(r, 20)); return rehearsal.get(id); };

test('a good booking run: free times offered, the chosen one booked, nothing written to a real calendar', async () => {
  answers = [
    { reply_text: 'أهلاً! الشات بوت عنا بيرد على العملاء فوراً.' },
    { reply_text: `عندنا بكرا ${D}/${M} الساعة 12:00 أو الساعة 16:00، أي وقت بناسبك؟`, scheduling: true },
    { reply_text: 'تم', book_start: `${tomorrow} 12:00`, buying_probability: 80 }
  ];
  const job = await wait(rehearsal.start('book', { cleanup: false }).id);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.calendar, 'simulated');
  assert.deepEqual(job.problems, []);
  assert.equal(job.bookings.length, 1);
  assert.match(job.final.appointment, /12:00/);
  assert.equal(job.final.meeting_link, 'https://meet.google.com/rehearsal-only');
  assert.equal(job.final.handed_to_sales, true, 'a booking hands the customer to sales');
  assert.ok(!calls.some(c => /googleapis\.com\/calendar/.test(c.url)), 'no real calendar touched');
});

test('the checker catches a bot that offers a busy time', async () => {
  answers = [
    { reply_text: `عندنا بكرا ${D}/${M} الساعة 11:00، بناسبك؟`, scheduling: true },
    { reply_text: 'تمام', book_start: `${tomorrow} 11:00` }
  ];
  const job = await wait(rehearsal.start('busy_time', { cleanup: false }).id);
  assert.ok(job.problems.some(p => /busy/.test(p)), JSON.stringify(job.problems));
  // …and the booking itself is refused by the calendar check.
  assert.equal(job.bookings.length, 0);
  assert.ok(job.transcript.some(l => /غير متاح/.test(l)));
});
