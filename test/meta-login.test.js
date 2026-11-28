// "Sign in with Facebook": one click connects the Page + Instagram with every permission.
const { fake, reset, calls, startApp, http } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const storage = require('../src/services/storageService');
const meta = require('../src/services/metaService');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(() => {
  reset();
  delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
  storage.updateSettings({ meta: { app_id: '', app_secret: '', page_access_token: '', page_id: '', instagram_account_id: '', granted_scopes: [] } }, { skipDbSync: true });
});

function fakeFacebookLogin({ granted = Object.keys(meta.REQUIRED_SCOPES) } = {}) {
  fake('get', /oauth\/access_token\?client_id=APP1&client_secret=SECRET1&redirect_uri=.*&code=GOODCODE/, () => ({ access_token: 'USER_SHORT' }));
  fake('get', /oauth\/access_token\?grant_type=fb_exchange_token/, () => ({ access_token: 'USER_LONG' }));
  fake('get', /\/me\/permissions/, () => ({ data: granted.map(permission => ({ permission, status: 'granted' })) }));
  fake('get', /\/app\?access_token=USER/, () => ({ id: 'APP1' }));
  fake('get', /\/me\/accounts/, () => ({ data: [{ id: '555', name: 'atlead - AI', access_token: 'PAGE_FOREVER', instagram_business_account: { id: '777', username: 'atlead.ai' } }] }));
  fake('post', /555\/subscribed_apps/, () => ({ success: true }));
}

async function loginFlow() {
  const start = await http(app.base, '/api/meta/oauth/start');
  const fb = new URL(start.location);
  return { fb, back: await http(app.base, `/api/meta/oauth/callback?code=GOODCODE&state=${fb.searchParams.get('state')}`) };
}

test('app set once on the server (Railway variables) → users only need the login button', async () => {
  process.env.META_APP_ID = 'APP1';
  process.env.META_APP_SECRET = 'SECRET1';
  const info = await http(app.base, '/api/meta/oauth/info');
  assert.equal(info.body.managed, true);
  assert.equal(info.body.connected, false);

  fakeFacebookLogin();
  const { fb, back } = await loginFlow();
  assert.equal(fb.host, 'www.facebook.com');
  assert.equal(fb.searchParams.get('client_id'), 'APP1');
  const scopes = fb.searchParams.get('scope').split(',');
  for (const s of ['pages_manage_posts', 'instagram_content_publish', 'pages_messaging', 'instagram_manage_messages', 'instagram_manage_comments', 'instagram_basic']) {
    assert.ok(scopes.includes(s), `asks for ${s}`);
  }

  assert.match(back.location, /meta_oauth=ok/);
  const m = storage.getSettings().meta;
  assert.equal(m.page_access_token, 'PAGE_FOREVER', 'permanent page token saved');
  assert.equal(m.page_id, '555');
  assert.equal(m.instagram_account_id, '777');
  assert.equal(m.instagram_username, 'atlead.ai');
  assert.equal(m.page_name, 'atlead - AI');
  assert.ok(!m.app_secret, 'server secret is not copied into the database');
  assert.ok(calls.some(c => /555\/subscribed_apps/.test(c.url)), 'page subscribed to messages & comments');

  const after = await http(app.base, '/api/meta/oauth/info');
  assert.equal(after.body.connected, true);
  assert.equal(after.body.instagram_username, 'atlead.ai');
});

test('works with App ID / Secret typed in the dashboard too', async () => {
  storage.updateSettings({ meta: { app_id: 'APP1', app_secret: 'SECRET1' } }, { skipDbSync: true });
  fakeFacebookLogin();
  const { back } = await loginFlow();
  assert.match(back.location, /meta_oauth=ok/);
});

test('declined permissions are reported by name', async () => {
  process.env.META_APP_ID = 'APP1'; process.env.META_APP_SECRET = 'SECRET1';
  fakeFacebookLogin({ granted: Object.keys(meta.REQUIRED_SCOPES).filter(s => s !== 'instagram_content_publish') });
  const { back } = await loginFlow();
  assert.match(back.location, /meta_oauth=partial/);
  assert.match(decodeURIComponent(back.location), /instagram_content_publish/);
  // …and the marketing tab knows Instagram publishing is blocked
  storage.updateSettings({ marketing: { public_url: 'https://atlead.example.com' } }, { skipDbSync: true });
  const ch = require('../src/services/socialPublisher').channels();
  assert.equal(ch.instagram.ready, false);
  assert.match(ch.instagram.note, /instagram_content_publish/);
  assert.equal(ch.facebook.ready, true);
});

test('a forged / replayed return link is rejected', async () => {
  process.env.META_APP_ID = 'APP1'; process.env.META_APP_SECRET = 'SECRET1';
  fakeFacebookLogin();
  await http(app.base, '/api/meta/oauth/start');
  const forged = await http(app.base, '/api/meta/oauth/callback?code=GOODCODE&state=not-the-state');
  assert.match(forged.location, /meta_oauth=error/);
  const { fb } = await loginFlow();
  const replay = await http(app.base, `/api/meta/oauth/callback?code=GOODCODE&state=${fb.searchParams.get('state')}`);
  assert.match(replay.location, /meta_oauth=error/, 'state works only once');
});

test('no Meta app configured → friendly message instead of a broken Facebook page', async () => {
  const r = await http(app.base, '/api/meta/oauth/start');
  assert.match(r.location, /meta_oauth=error/);
  assert.match(decodeURIComponent(r.location), /App ID/);
});

test('webhook signatures are checked with the server-level App Secret', async () => {
  process.env.META_APP_SECRET = 'SECRET1';
  const r = await http(app.base, '/webhook/meta', { method: 'POST', json: { object: 'page', entry: [] }, headers: { 'X-Hub-Signature-256': 'sha256=bad' } });
  assert.equal(r.status, 401);
});

test('Meta and WhatsApp webhooks reject POSTs when no App Secret is configured', async () => {
  const metaResponse = await http(app.base, '/webhook/meta', { method: 'POST', json: { object: 'page', entry: [] } });
  const whatsappResponse = await http(app.base, '/webhook/whatsapp', { method: 'POST', json: { object: 'whatsapp_business_account', entry: [] } });
  assert.equal(metaResponse.status, 401);
  assert.equal(whatsappResponse.status, 401);
});

test('WhatsApp webhook returns a retryable failure if message processing reports failure', async () => {
  process.env.META_APP_SECRET = 'SECRET1';
  const whatsapp = require('../src/services/whatsappService');
  const originalHandler = whatsapp.handleIncomingMessage;
  const payload = { object: 'whatsapp_business_account', entry: [{ id: 'account-1' }] };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex')}`;
  whatsapp.handleIncomingMessage = async () => ({ success: false, error: 'disk full' });
  try {
    const response = await http(app.base, '/webhook/whatsapp', {
      method: 'POST', json: payload, headers: { 'X-Hub-Signature-256': signature }
    });
    assert.equal(response.status, 500);
  } finally {
    whatsapp.handleIncomingMessage = originalHandler;
  }
});

test('Instagram DM under page object or standby is routed to instagram_dm channel', async () => {
  process.env.META_APP_SECRET = 'SECRET1';
  storage.updateSettings({ meta: { page_id: '555', instagram_account_id: '777', page_access_token: 'PAGE_TOKEN' } }, { skipDbSync: true });
  fake('get', /\/777/, () => ({ id: '777', username: 'atlead.ai' }));
  fake('get', /\/user_ig_123/, () => ({ username: 'client_ig' }));

  const payload = {
    object: 'page',
    entry: [{
      id: '555',
      messaging: [{
        sender: { id: 'user_ig_123' },
        recipient: { id: '777' },
        timestamp: Date.now(),
        message: { mid: 'mid_ig_1', text: 'مرحبا، كم اسعاركم؟' }
      }]
    }]
  };
  const rawBody = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex')}`;
  const r = await http(app.base, '/webhook/meta', { method: 'POST', json: payload, headers: { 'X-Hub-Signature-256': signature } });
  assert.equal(r.status, 200);

  const conv = storage.getConversationByChannelUser('instagram_dm', 'user_ig_123');
  assert.ok(conv, 'conversation created under instagram_dm');
  assert.equal(conv.channel, 'instagram_dm');
});

test('Instagram DM send payload omits messaging_type', async () => {
  storage.updateSettings({ meta: { page_access_token: 'PAGE_TOKEN' } }, { skipDbSync: true });
  fake('post', /\/me\/messages/, (url, body) => ({ message_id: 'mid_sent_ig', echo: body }));

  const res = await meta.sendDirectMessage('instagram_dm', 'ig_user_456', 'أهلاً وسهلاً بك');
  assert.equal(res.ok, true);

  const sentCall = calls.find(c => /me\/messages/.test(c.url));
  assert.ok(sentCall, 'called me/messages');
  assert.equal(sentCall.body.messaging_type, undefined, 'messaging_type is omitted for Instagram');
  assert.equal(sentCall.body.recipient.id, 'ig_user_456');
  assert.equal(sentCall.body.message.text, 'أهلاً وسهلاً بك');
});

test('customer acknowledgment after handoff (اه تمام) receives reassurance reply', async () => {
  const aiService = require('../src/services/aiService');
  const conv = {
    channel: 'whatsapp',
    customer_name: 'Universal Doors',
    handoff_at: '2026-11-27T16:26:00Z',
    lead_stage: 'handed_off',
    interest_score: 30,
    messages: [
      { sender: 'customer', content: 'هلا اخوي...' },
      { sender: 'bot', content: 'أهلا وسهلا فيك...' },
      { sender: 'customer', content: 'اه تمام' },
      { sender: 'bot', content: 'تمام، م. مهند من قسم المبيعات في شركة atlead رح يتواصل معك بأسرع وقت...' }
    ]
  };
  const res = await aiService.generateReply(conv, 'اه تمام');
  assert.ok(res.reply_text, 'reply_text is not empty');
  assert.match(res.reply_text, /مهند|فريق|خدمة|أهلاً|بأسرع وقت/);
});
