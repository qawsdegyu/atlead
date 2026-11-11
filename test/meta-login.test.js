// "Sign in with Facebook": one click connects the Page + Instagram with every permission.
const { fake, reset, calls, startApp, http } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

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
