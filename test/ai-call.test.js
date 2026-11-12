// AI voice call: offered in chat → public call page → voice AI with booking tools → analysis saved everywhere.
const { fake, reset, calls, startApp, http } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const storage = require('../src/services/storageService');
const ai = require('../src/services/aiService');
const crm = require('../src/services/crmService');
const callService = require('../src/services/callService');
const cal = require('../src/services/calendarService');
const sheets = require('../src/services/googleSheetsService');

let app;
let answers;
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'bot@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const amman = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const tomorrow = amman(new Date(Date.now() + 86400000));

test.before(async () => { app = await startApp(); });
test.after(() => app.close());
test.beforeEach(() => {
  reset();
  delete process.env.ADMIN_PASSWORD;
  cal._busy = null; cal._token = null;
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter', openai_api_key: 'sk-openai-secret' },
    ai_call: { enabled: true, model: 'gpt-realtime-2.1', voice: 'marin', max_minutes: 15, link_days: 7 },
    google_sheets: { service_account_json: JSON.stringify(sa) },
    calendar: { enabled: true, calendar_id: 'eng@gmail.com', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '21:00', min_notice_hours: 0, days_ahead: 3 }
  }, { skipDbSync: true });
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify(answers.shift()) } }] }));
  fake('post', /oauth2\.googleapis\.com\/token/, () => ({ access_token: 'tok', expires_in: 3600 }));
  fake('post', /calendar\/v3\/freeBusy/, () => ({ calendars: { 'eng@gmail.com': { busy: [] } } }));
  fake('post', /calendar\/v3\/calendars\/.+\/events/, () => ({ id: 'ev9', hangoutLink: 'https://meet.google.com/eng-meet' }));
  fake('post', /api\.openai\.com\/v1\/realtime\/client_secrets/, () => ({ value: 'ek_test123', expires_at: 9999999999 }));
});

function newConv(name = 'رامي') {
  const conv = storage.saveConversation({ channel: 'whatsapp', external_user_id: `9627${Math.random().toString().slice(2, 10)}`, customer_name: name, business_type: 'عيادة أسنان' });
  storage.addMessage(conv.id, { sender: 'customer', content: 'بدي أعرف أكثر عن النظام', media_type: 'text' });
  return storage.getConversationById(conv.id);
}

test('an interested customer gets the call link in the chat, and that is not a handoff yet', async () => {
  const conv = newConv();
  answers = [{ reply_text: 'خلينا نحكي بمكالمة قصيرة نفهم فيها شغلك.', offer_ai_call: true, buying_probability: 90 }];
  const r = await ai.generateReply(conv, 'كيف بتشتغلوا؟ وبكم؟');
  assert.match(r.reply_text, /رابط المكالمة: http.*\/call\/[A-Za-z0-9_-]{20,}/);
  assert.equal(r.ai_call_offered, true);
  assert.equal(crm.shouldHandoff(r), false, 'the call comes before the handoff');
  assert.equal(callService.forConversation(conv.id).length, 1);
  // Asking again re-uses the same link.
  answers = [{ reply_text: 'أكيد', offer_ai_call: true }];
  await ai.generateReply(conv, 'ابعتلي الرابط مرة ثانية');
  assert.equal(callService.forConversation(conv.id).length, 1);
});

test('the call page and its API are public (private link), the dashboard stays protected', async () => {
  const s = callService.createSession(newConv('هبة'));
  process.env.ADMIN_PASSWORD = 'pw';
  const pageRes = await http(app.base, `/call/${s.token}`, { headers: { Accept: 'text/html' } });
  assert.equal(pageRes.status, 200);
  assert.match(String(pageRes.body), /oai-events/);
  const info = await http(app.base, `/api/call/${s.token}`);
  assert.deepEqual([info.body.ok, info.body.name], [true, 'هبة']);
  assert.equal((await http(app.base, '/api/leads')).status, 401);
  assert.equal((await http(app.base, '/api/call/not-a-real-token-xxxxxxxxxx')).body.error, 'not_found');
});

test('starting the call gives the browser a short-lived key with the sales script and booking tools', async () => {
  const s = callService.createSession(newConv());
  const r = await http(app.base, `/api/call/${s.token}/start`, { method: 'POST' });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.key, 'ek_test123');
  assert.doesNotMatch(JSON.stringify(r.body), /sk-openai-secret/, 'the real API key never reaches the browser');
  const req = calls.find(c => /realtime\/client_secrets/.test(c.url));
  assert.equal(req.body.session.type, 'realtime');
  assert.equal(req.body.session.audio.output.voice, 'marin');
  assert.ok(req.body.session.audio.input.transcription, 'the customer\'s words are transcribed');
  assert.deepEqual(req.body.session.tools.map(t => t.name), ['get_free_times', 'book_engineer_meeting', 'end_call']);
  assert.match(req.body.session.instructions, /عيادة أسنان/, 'knows what the customer already said in chat');
  assert.match(req.body.session.instructions, /ممنوع تذكر أي سعر/);
});

test('during the call the AI reads free times and books the engineer', async () => {
  const conv = newConv();
  const s = callService.createSession(conv);
  await http(app.base, `/api/call/${s.token}/start`, { method: 'POST' });
  const free = await http(app.base, `/api/call/${s.token}/tool`, { method: 'POST', json: { name: 'get_free_times', args: {} } });
  assert.equal(free.body.result.available, true);
  assert.match(free.body.result.slots[0].start, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  const book = await http(app.base, `/api/call/${s.token}/tool`, { method: 'POST', json: { name: 'book_engineer_meeting', args: { start: `${tomorrow} 12:00` } } });
  assert.equal(book.body.result.booked, true);
  assert.equal(storage.getConversationById(conv.id).appointment_link, 'https://meet.google.com/eng-meet');
});

test('when the call ends, every detail is analysed and saved on the customer, the sheet row and the chat', async () => {
  const conv = newConv('سامي');
  const s = callService.createSession(conv);
  await http(app.base, `/api/call/${s.token}/start`, { method: 'POST' });
  await http(app.base, `/api/call/${s.token}/transcript`, { method: 'POST', json: { lines: [
    { id: 'a1', role: 'assistant', text: 'أهلاً سامي، شو نوع شغلك؟' },
    { id: 'c1', role: 'customer', text: 'عندي عيادة أسنان بعمّان، فريقنا 6 أشخاص وبتجينا حوالي 400 رسالة بالشهر على واتساب وإنستغرام.' },
    { id: 'c1', role: 'customer', text: 'duplicate is ignored' }
  ] } });
  await http(app.base, `/api/call/${s.token}/tool`, { method: 'POST', json: { name: 'get_free_times', args: {} } });
  await http(app.base, `/api/call/${s.token}/tool`, { method: 'POST', json: { name: 'book_engineer_meeting', args: { start: `${tomorrow} 13:00` } } });
  answers = [{
    company_name: 'عيادة الابتسامة', location: 'عمّان', business_type: 'عيادة أسنان', team_size: '6', monthly_volume: '400 رسالة',
    channels_used: 'واتساب، إنستغرام', current_tools: 'رد يدوي', identified_problem: 'رسائل كثيرة بدون رد', goals: 'رد فوري وحجز مواعيد',
    budget: 'جاهز يستثمر', timeline: 'هذا الشهر', decision_maker: 'نعم، هو المالك', customer_email: 'sami@clinic.jo',
    buying_probability: 85, classification: 'Hot', qualified: true, summary: 'عيادة أسنان جاهزة للبدء.', next_step: 'اجتماع المهندس'
  }];
  await http(app.base, `/api/call/${s.token}/end`, { method: 'POST', json: { reason: 'customer' } });
  for (let i = 0; i < 40 && callService.get(s.token).status !== 'completed'; i++) await new Promise(r => setTimeout(r, 25));

  const done = callService.get(s.token);
  assert.equal(done.status, 'completed');
  assert.equal(done.transcript.length, 2, 'duplicates dropped');
  const c = storage.getConversationById(conv.id);
  assert.equal(c.ai_call_status, 'completed');
  assert.equal(c.ai_call_qualified, true);
  assert.equal(c.team_size, '6');
  assert.equal(c.budget, 'جاهز يستثمر');
  assert.equal(c.customer_email, 'sami@clinic.jo');
  assert.equal(c.classification, 'Hot');
  assert.ok(c.handoff_at, 'qualified + meeting booked → handed to the sales team');
  // Google Sheets row carries every detail and the transcript.
  const lead = storage.getLeads().find(l => l.conversation_id === conv.id);
  const row = sheets.leadToRow(lead);
  for (const v of ['عيادة الابتسامة', '400 رسالة', 'هذا الشهر', 'نعم، هو المالك', 'نعم', 'https://meet.google.com/eng-meet']) assert.ok(row.includes(v), `sheet has ${v}`);
  assert.ok(row.some(v => /العميل: عندي عيادة أسنان/.test(v)), 'transcript in the sheet');
  // The customer gets the outcome in writing.
  assert.match(c.messages[c.messages.length - 1].content, /موعدك مع المهندس/);
  // Ending twice changes nothing.
  await callService.finish(s.token);
  assert.equal(storage.getConversationById(conv.id).messages.length, c.messages.length);
});

test('expired or finished links cannot start a call', async () => {
  const s = callService.createSession(newConv());
  s.expires_at = new Date(Date.now() - 1000).toISOString();
  callService.save(s);
  const r = await http(app.base, `/api/call/${s.token}/start`, { method: 'POST' });
  assert.equal(r.body.error, 'expired');
  storage.updateSettings({ ai_call: { enabled: false } }, { skipDbSync: true });
  const s2 = callService.createSession(newConv());
  assert.equal((await http(app.base, `/api/call/${s2.token}`)).body.error, 'disabled');
});

test('the AI can never book a time it did not read from the calendar first', async () => {
  const s = callService.createSession(newConv());
  await http(app.base, `/api/call/${s.token}/start`, { method: 'POST' });
  const r = await http(app.base, `/api/call/${s.token}/tool`, { method: 'POST', json: { name: 'book_engineer_meeting', args: { start: `${tomorrow} 12:00` } } });
  assert.equal(r.body.result.booked, false);
  assert.match(r.body.result.note, /get_free_times/);
  assert.ok(!calls.some(c => /calendar\/v3\/calendars\/.+\/events/.test(c.url)), 'nothing written to the calendar');
});

test('a not-interested caller is never marked ready to buy, even if the model says so', async () => {
  const conv = newConv('ليث');
  const s = callService.createSession(conv);
  callService.addTranscript(s.token, [{ id: 'x', role: 'customer', text: 'أنا طالب، بس بسأل لمشروع تخرج.' }]);
  answers = [{ business_type: '', buying_probability: 0, classification: 'Cold', qualified: true, summary: 'طالب يسأل بدافع الفضول.' }];
  await callService.finish(s.token);
  const c = storage.getConversationById(conv.id);
  assert.equal(c.ai_call_qualified, false);
  assert.ok(!c.handoff_at, 'not handed to sales');
  assert.match(c.messages[c.messages.length - 1].content, /إذا عندك أي سؤال/);
});
