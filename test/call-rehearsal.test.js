// The rehearsal tool runs a whole simulated call (customer AI ↔ call AI with tools) and the real analysis.
const { fake, reset } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const storage = require('../src/services/storageService');
const cal = require('../src/services/calendarService');
const rehearsal = require('../src/services/callRehearsal');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'bot@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86400000));

test('a full rehearsal: questions, booking with the engineer, verdict and every detail saved', async () => {
  reset();
  cal._busy = null; cal._token = null;
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter', openai_api_key: 'sk-o' },
    ai_call: { enabled: true },
    google_sheets: { service_account_json: JSON.stringify(sa) },
    calendar: { enabled: true, calendar_id: 'eng@gmail.com', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '21:00', min_notice_hours: 0, days_ahead: 3 }
  }, { skipDbSync: true });
  fake('post', /oauth2\.googleapis\.com\/token/, () => ({ access_token: 't', expires_in: 3600 }));
  fake('post', /calendar\/v3\/freeBusy/, () => ({ calendars: { 'eng@gmail.com': { busy: [] } } }));
  fake('post', /calendar\/v3\/calendars\/.+\/events/, () => ({ id: 'ev', hangoutLink: 'https://meet.google.com/x-y-z' }));
  const assistant = [
    { say: 'أهلاً سامي، شو نوع شغلك؟' },
    { say: 'ممتاز، خليني أشوف الأوقات المتاحة.', tool: 'get_free_times' },
    { say: `عنا بكرا الساعة 12:00، بناسبك؟` },
    { say: 'تمام بحجزلك.', tool: 'book_engineer_meeting', args: { start: `${tomorrow} 12:00` } },
    { say: 'تم الحجز، شكراً إلك. مع السلامة.', tool: 'end_call' }
  ];
  fake('post', /openrouter\.ai/, (req) => {
    const sys = JSON.stringify(req.body.messages?.[0] || req.body.system || '');
    let content;
    if (/You are the CUSTOMER/.test(sys)) content = 'عندي عيادة أسنان وبدي أبدأ هالشهر';
    else if (/محلل مبيعات/.test(sys)) content = JSON.stringify({ business_type: 'عيادة أسنان', team_size: '6', timeline: 'هذا الشهر', decision_maker: 'نعم', buying_probability: 88, classification: 'Hot', qualified: true, summary: 'جاهز.', next_step: 'اجتماع المهندس' });
    else content = JSON.stringify(assistant.shift() || { say: 'تمام' });
    return { choices: [{ message: { content } }] };
  });

  const job = rehearsal.start('buyer', { maxTurns: 6, cleanup: false });
  for (let i = 0; i < 200 && rehearsal.get(job.id).status === 'running'; i++) await new Promise(r => setTimeout(r, 25));
  const done = rehearsal.get(job.id);
  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(done.tools.map(t => t.tool), ['get_free_times', 'book_engineer_meeting', 'end_call']);
  assert.equal(done.tools[1].result.booked, true);
  assert.equal(done.saved.ai_call_qualified, true);
  assert.equal(done.saved.handed_to_sales, true);
  assert.ok(done.saved.appointment_label, 'engineer meeting booked');
  assert.equal(done.sheet_row['حجم الفريق'], '6');
  assert.equal(done.sheet_row['مكالمة الـ AI — مؤهل للشراء'], 'نعم');
  assert.deepEqual(done.ungrounded, []);
  assert.ok(done.transcript.length >= 6);
});
