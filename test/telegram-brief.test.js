// Morning message on Telegram: once a day at the chosen time, 3 topics with buttons.
const { fake, reset, calls } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const mk = require('../src/services/marketingService');
const telegram = require('../src/services/telegramService');
const businessHours = require('../src/services/businessHours');

function fakeTelegram() {
  fake('post', /api\.telegram\.org\/botTG:TOKEN\/sendMessage/, () => ({ ok: true, result: { message_id: 7 } }));
  fake('get', /news\.google\.com/, () => '<rss></rss>');
}

const hhmm = (min) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((min % 60) + 60) % 60).padStart(2, '0')}`;

test.beforeEach(() => {
  reset();
  fakeTelegram();
  const fs = require('fs');
  const file = require('path').join(storage.getDataDir(), 'marketing.json');
  if (fs.existsSync(file)) { const d = JSON.parse(fs.readFileSync(file, 'utf-8')); d.last_brief = null; fs.writeFileSync(file, JSON.stringify(d)); }
  storage.updateSettings({
    telegram: { bot_token: 'TG:TOKEN', chat_ids: ['42', '43'] },
    marketing: { enabled: true, public_url: 'https://atlead.example.com' }
  }, { skipDbSync: true });
});

test('morning brief: sent to every admin chat with 3 topic buttons that open the right step', async () => {
  const { plan, sent } = await mk.sendBrief();
  assert.equal(sent.success, true);
  const msgs = calls.filter(c => /sendMessage/.test(c.url));
  assert.deepEqual(msgs.map(m => m.body.chat_id), ['42', '43']);
  const body = msgs[0].body;
  assert.match(body.text, /اقتراحات بوست اليوم/);
  assert.equal(body.parse_mode, 'HTML');
  const buttons = body.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length, 4, '3 topics + "another topic"');
  assert.equal(buttons[1].url, `https://atlead.example.com/?tab=marketing&plan=${plan.id}&topic=1`);
});

test('sent once a day, only at/after the chosen time', async () => {
  const now = businessHours.localParts().minutes;
  storage.updateSettings({ marketing: { morning_time: hhmm(now + 60) } }, { skipDbSync: true });
  assert.equal(await mk.maybeSendMorningBrief(), null, 'not before the time');

  storage.updateSettings({ marketing: { morning_time: hhmm(now - 1) } }, { skipDbSync: true });
  const first = await mk.maybeSendMorningBrief();
  assert.ok(first && first.sent.success, 'sent at the time');
  assert.equal(await mk.maybeSendMorningBrief(), null, 'not twice the same day');
});

test('not sent hours late (e.g. server restarted in the evening)', async () => {
  const now = businessHours.localParts().minutes;
  if (now < 7 * 60) return; // can't build a "7 hours ago" time just after midnight
  storage.updateSettings({ marketing: { morning_time: hhmm(now - 7 * 60) } }, { skipDbSync: true });
  assert.equal(await mk.maybeSendMorningBrief(), null);
});

test('switched off or not connected → nothing is sent', async () => {
  storage.updateSettings({ marketing: { enabled: false, morning_time: '00:00' } }, { skipDbSync: true });
  assert.equal(await mk.maybeSendMorningBrief(), null);
  storage.updateSettings({ marketing: { enabled: true }, telegram: { chat_ids: [] } }, { skipDbSync: true });
  assert.equal(await mk.maybeSendMorningBrief(), null);
});

test('text from the market/AI is escaped (no broken Telegram HTML)', () => {
  const { text } = mk.briefMessage({ id: 'p1', topics: [{ title: '<b>x</b> & y', angle: 'a<b' }] });
  assert.ok(text.includes('&lt;b&gt;x&lt;/b&gt; &amp; y'));
});

test('localhost links are never sent as buttons (Telegram rejects them)', async () => {
  await telegram.sendMessage('hi', { buttons: [[{ text: 'a', url: 'http://localhost:3000/x' }], [{ text: 'b', url: 'https://ok.example.com' }]] });
  const body = calls.find(c => /sendMessage/.test(c.url)).body;
  assert.deepEqual(body.reply_markup.inline_keyboard, [[{ text: 'b', url: 'https://ok.example.com' }]]);
});

test('hot lead alert goes to Telegram too', async () => {
  await telegram.notifyHandoff({ id: 'c1', channel: 'whatsapp', customer_name: 'أحمد', business_type: 'متجر' }, 92, []);
  assert.match(calls.find(c => /sendMessage/.test(c.url)).body.text, /عميل جاهز للتواصل.*92%/s);
});
