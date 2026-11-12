// AI phone line: Twilio webhook → live audio bridge to the voice AI → transfer to a human → saved like any call.
const { fake, reset, calls, http } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const WebSocket = require('ws');

const storage = require('../src/services/storageService');
const phone = require('../src/services/phoneService');
const callService = require('../src/services/callService');

const HOST = 'atlead-production.up.railway.app';
const TOKEN = 'twilio-auth-token';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let base, server, aiServer, aiPort, aiSocket, aiReceived, answers;

const sign = (path, params) => crypto.createHmac('sha1', TOKEN)
  .update(Buffer.from(`https://${HOST}${path}` + Object.keys(params).sort().map(k => k + params[k]).join(''), 'utf-8')).digest('base64');
const twilioPost = (path, params, valid = true) => http(base, path, { method: 'POST', form: params, headers: valid ? { 'X-Twilio-Signature': sign(path, params) } : {} });

test.before(async () => {
  process.env.RAILWAY_PUBLIC_DOMAIN = HOST;
  // Fake OpenAI realtime server.
  aiServer = new WebSocket.Server({ port: 0 });
  await new Promise(r => aiServer.on('listening', r));
  aiPort = aiServer.address().port;
  process.env.OPENAI_REALTIME_WS = `ws://127.0.0.1:${aiPort}/v1/realtime`;
  aiServer.on('connection', (ws, req) => {
    aiSocket = ws;
    aiReceived.push({ auth: req.headers.authorization, url: req.url });
    ws.on('message', (m) => aiReceived.push(JSON.parse(m)));
  });
  const app = require('../server');
  server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  phone.attach(server);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  delete process.env.RAILWAY_PUBLIC_DOMAIN; delete process.env.OPENAI_REALTIME_WS;
  aiServer.close();
  await new Promise(r => server.close(r));
});
test.beforeEach(() => {
  reset();
  aiReceived = [];
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter', openai_api_key: 'sk-openai' },
    phone_ai: { enabled: true, twilio_account_sid: 'AC123', twilio_auth_token: TOKEN, twilio_number: '+15550001111', transfer_number: '+962790000999', transfer_timeout: 20 },
    calendar: { enabled: false }
  }, { skipDbSync: true });
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify(answers.shift() || {}) } }] }));
  fake('post', /api\.twilio\.com\/2010-04-01\/Accounts\/AC123\/Calls\/.+\.json/, () => ({ sid: 'CA1' }));
});

test('only real Twilio requests are answered (signature checked)', async () => {
  const p = { CallSid: 'CAx', From: '+962791234567', To: '+15550001111' };
  assert.equal((await twilioPost('/voice/incoming', p, false)).status, 403);
  const ok = await twilioPost('/voice/incoming', p);
  assert.equal(ok.status, 200);
  assert.match(ok.body, /<Connect><Stream url="wss:\/\/atlead-production\.up\.railway\.app\/voice\/stream"><Parameter name="t" value="[0-9a-f]{32}"\/>/);
});

test('if the AI is not available, the call still rings the team instead of being lost', async () => {
  storage.updateSettings({ ai: { openai_api_key: '' } }, { skipDbSync: true });
  const r = await twilioPost('/voice/incoming', { CallSid: 'CAy', From: '+962791234567', To: '+15550001111' });
  assert.match(r.body, /<Dial callerId="\+962791234567"[^>]*><Number>\+962790000999<\/Number><\/Dial>/);
});

test('a live call: audio flows both ways, the AI transfers to customer service, everything is saved', async () => {
  const caller = '+962795551234';
  const tw = await twilioPost('/voice/incoming', { CallSid: 'CA777', From: caller, To: '+15550001111' });
  const t = tw.body.match(/value="([0-9a-f]{32})"/)[1];

  // Twilio opens the media stream.
  const twilio = new WebSocket(`${base.replace('http', 'ws')}/voice/stream`);
  const toCaller = [];
  twilio.on('message', (m) => toCaller.push(JSON.parse(m)));
  await new Promise(r => twilio.on('open', r));
  twilio.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ1', callSid: 'CA777', customParameters: { t } } }));
  for (let i = 0; i < 60 && !aiReceived.some(x => x.type === 'response.create'); i++) await sleep(25);

  // The AI session: authorised, phone audio format, transfer tool, greets first.
  assert.equal(aiReceived[0].auth, 'Bearer sk-openai');
  const upd = aiReceived.find(x => x.type === 'session.update');
  assert.equal(upd.session.audio.input.format.type, 'audio/pcmu');
  assert.equal(upd.session.audio.output.format.type, 'audio/pcmu');
  assert.ok(upd.session.tools.some(x => x.name === 'transfer_to_human'));
  assert.match(upd.session.instructions, /مكالمة هاتفية واردة/);
  assert.match(upd.session.instructions, /ممنوع تذكر أي سعر/);

  // Caller audio → AI.
  twilio.send(JSON.stringify({ event: 'media', media: { payload: 'AAAA' } }));
  await sleep(50);
  assert.ok(aiReceived.some(x => x.type === 'input_audio_buffer.append' && x.audio === 'AAAA'));
  // AI audio → caller.
  aiSocket.send(JSON.stringify({ type: 'response.output_audio.delta', delta: 'BBBB' }));
  aiSocket.send(JSON.stringify({ type: 'response.output_audio_transcript.done', item_id: 'a1', transcript: 'أهلاً بك في atlead، كيف بقدر أساعدك؟' }));
  aiSocket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'c1', transcript: 'عندي مشكلة بالفاتورة بدي أحكي مع خدمة العملاء' }));
  // Caller talks over the AI → its audio is cleared.
  aiSocket.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
  await sleep(60);
  assert.ok(toCaller.some(x => x.event === 'media' && x.media.payload === 'BBBB' && x.streamSid === 'MZ1'));
  assert.ok(toCaller.some(x => x.event === 'clear'));

  // The AI asks to transfer.
  aiSocket.send(JSON.stringify({ type: 'response.function_call_arguments.done', call_id: 'f1', name: 'transfer_to_human', arguments: JSON.stringify({ reason: 'مشكلة بالفاتورة' }) }));
  for (let i = 0; i < 60 && !calls.some(c => /Calls\/CA777\.json/.test(c.url)); i++) await sleep(25);
  const tr = calls.find(c => /Calls\/CA777\.json/.test(c.url));
  assert.match(new URLSearchParams(String(tr.body)).get('Twiml'), /<Dial callerId="\+962795551234"[^>]*><Number>\+962790000999<\/Number>/, 'rings your phone showing the caller');
  await sleep(50);
  assert.ok(aiReceived.some(x => x.type === 'conversation.item.create' && x.item.call_id === 'f1'));

  // Twilio ends the stream (the call moved to your phone) → analysed and saved.
  answers = [{ business_type: 'متجر', buying_probability: 40, classification: 'Warm', qualified: false, summary: 'عميل عنده مشكلة بالفاتورة وطلب خدمة العملاء.', next_step: 'خدمة العملاء' }];
  twilio.send(JSON.stringify({ event: 'stop' }));
  twilio.close();
  const conv = () => storage.getConversationByChannelUser('phone', '962795551234');
  for (let i = 0; i < 80 && conv()?.ai_call_status !== 'completed'; i++) await sleep(25);
  const c = conv();
  assert.equal(c.ai_call_status, 'completed');
  assert.ok(c.handoff_at, 'handed to the team');
  assert.match(c.handoff_reason, /مشكلة بالفاتورة/);
  const s = callService.forConversation(c.id)[0];
  assert.equal(s.kind, 'phone');
  assert.equal(s.transferred_to_human, true);
  assert.deepEqual(s.transcript.map(l => l.role), ['assistant', 'customer']);
});

test('nobody picks up the transfer → the caller hears a message and the team is flagged to call back', async () => {
  const r = await twilioPost('/voice/after-dial', { CallSid: 'CA777', DialCallStatus: 'no-answer', From: '+962795551234' });
  assert.match(r.body, /<Say[^>]*>نعتذر/);
  const answered = await twilioPost('/voice/after-dial', { CallSid: 'CA777', DialCallStatus: 'completed' });
  assert.match(answered.body, /<Hangup\/>/);
});

test('connect: checks Twilio, points the number at the server and gives the forwarding codes', async () => {
  fake('get', /IncomingPhoneNumbers\.json/, () => ({ incoming_phone_numbers: [{ sid: 'PN1', phone_number: '+15550001111' }] }));
  fake('post', /IncomingPhoneNumbers\/PN1\.json/, () => ({ sid: 'PN1' }));
  const r = await phone.connect();
  assert.equal(r.success, true, r.message);
  const set = calls.find(c => /IncomingPhoneNumbers\/PN1\.json/.test(c.url));
  assert.equal(new URLSearchParams(String(set.body)).get('VoiceUrl'), `https://${HOST}/voice/incoming`);
  assert.equal(r.forwarding.all, '**21*0015550001111#');
  assert.equal(r.forwarding.no_answer, '**61*0015550001111**20#');
});
