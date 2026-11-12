// The call link reaches the customer on their own channel (real WhatsApp / Messenger senders),
// and opens straight away: no login, no account, nothing to install.
const { fake, reset, calls, startApp, http } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const replyEngine = require('../src/services/replyEngine');
const metaService = require('../src/services/metaService');
const whatsappService = require('../src/services/whatsappService');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let app; let aiAnswer;

test.before(async () => { app = await startApp(); });
test.after(() => { delete process.env.ADMIN_PASSWORD; delete process.env.RAILWAY_PUBLIC_DOMAIN; return app.close(); });
test.beforeEach(() => {
  reset();
  process.env.RAILWAY_PUBLIC_DOMAIN = 'atlead-production.up.railway.app';
  process.env.ADMIN_PASSWORD = 'admin-pw'; // the dashboard is locked, like on the live site
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter', openai_api_key: 'sk-openai-secret' },
    ai_call: { enabled: true },
    bot: { reply_delay_seconds: 0, typing_indicator: false },
    business_hours: { enabled: false },
    marketing: { public_url: '' },
    meta: { page_access_token: 'PAGE_TOKEN', page_id: '111' },
    whatsapp: { mode: 'cloud_api', phone_number_id: '555', access_token: 'WA_TOKEN' }
  }, { skipDbSync: true });
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify(aiAnswer) } }] }));
  fake('post', /graph\.facebook\.com\/v[\d.]+\/me\/messages/, () => ({ message_id: 'm_1' }));
  fake('post', /graph\.facebook\.com\/v[\d.]+\/555\/messages/, () => ({ messages: [{ id: 'wamid.1' }] }));
});

async function customerSays(channel, id, text, adapter) {
  await replyEngine.ingest({ channel, externalUserId: id, customerName: 'ليث', text, adapter });
  for (let i = 0; i < 80; i++) { await sleep(40); if (!replyEngine.pending.size) break; }
}

async function linkOpensWithoutLogin(url) {
  const u = new URL(url);
  assert.equal(u.protocol, 'https:', 'a real https link');
  assert.equal(u.host, 'atlead-production.up.railway.app');
  const pageRes = await http(app.base, u.pathname, { headers: { Accept: 'text/html' } });
  assert.equal(pageRes.status, 200, 'no redirect to the login page');
  assert.match(String(pageRes.body), /ابدأ المكالمة/);
  const info = await http(app.base, u.pathname.replace('/call/', '/api/call/'));
  assert.equal(info.body.ok, true);
  assert.equal((await http(app.base, '/api/conversations')).status, 401, 'the dashboard itself stays locked');
}

test('Messenger: the bot sends the call link in the chat and it opens without logging in', async () => {
  aiAnswer = { reply_text: 'خلينا نحكي بمكالمة قصيرة نفهم فيها شغلك.', offer_ai_call: true, buying_probability: 80 };
  await customerSays('facebook_messenger', 'psid_42', 'بدي أعرف كيف بتشتغلوا', metaService.getAdapter('facebook_messenger'));
  const sent = calls.find(c => /\/me\/messages/.test(c.url) && c.body?.message?.text);
  assert.ok(sent, 'a Messenger message was sent');
  assert.equal(sent.body.recipient.id, 'psid_42');
  const url = sent.body.message.text.match(/https:\/\/\S+\/call\/[A-Za-z0-9_-]+/)?.[0];
  assert.ok(url, 'the message carries the call link');
  await linkOpensWithoutLogin(url);
  const conv = storage.getConversationByChannelUser('facebook_messenger', 'psid_42');
  assert.equal(conv.ai_call_status, 'offered');
  assert.ok(!conv.handoff_at, 'offering the call is not a handoff');
});

test('WhatsApp: the bot sends the call link in the chat and it opens without logging in', async () => {
  aiAnswer = { reply_text: 'أكيد، تفضل مكالمة قصيرة مع مساعدنا.', offer_ai_call: true, buying_probability: 75 };
  await customerSays('whatsapp', '962791112233', 'كم بتكلف الأنظمة؟', whatsappService.getAdapter());
  const sent = calls.find(c => /\/555\/messages/.test(c.url) && c.body?.text?.body);
  assert.ok(sent, 'a WhatsApp message was sent');
  assert.equal(sent.body.to, '962791112233');
  const url = sent.body.text.body.match(/https:\/\/\S+\/call\/[A-Za-z0-9_-]+/)?.[0];
  assert.ok(url, 'the message carries the call link');
  assert.equal(sent.body.text.preview_url, true, 'WhatsApp shows the link as a tappable preview');
  await linkOpensWithoutLogin(url);
});

test('English customers get an English message and an English call page', async () => {
  aiAnswer = { reply_text: 'Let us have a short call so I understand your business.', offer_ai_call: true, buying_probability: 70 };
  await customerSays('facebook_messenger', 'psid_en', 'How does your system work?', metaService.getAdapter('facebook_messenger'));
  const sent = calls.find(c => /\/me\/messages/.test(c.url) && c.body?.message?.text && c.body.recipient.id === 'psid_en');
  assert.match(sent.body.message.text, /Call link: https:\/\//);
  const token = sent.body.message.text.match(/\/call\/([A-Za-z0-9_-]+)/)[1];
  assert.equal((await http(app.base, `/api/call/${token}`)).body.lang, 'en');
});
