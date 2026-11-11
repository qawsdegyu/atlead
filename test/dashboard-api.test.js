// Dashboard API: login deep links, settings validation, secrets masking, image access.
const { startApp, http, jpeg } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });
test.afterEach(() => { delete process.env.ADMIN_PASSWORD; });

test('the Telegram link survives the login page, but cannot redirect to another site', async () => {
  process.env.ADMIN_PASSWORD = 'pw';
  const r = await http(app.base, '/?tab=marketing&plan=p1&topic=2', { headers: { Accept: 'text/html' } });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/login?next=%2F%3Ftab%3Dmarketing%26plan%3Dp1%26topic%3D2');

  const ok = await http(app.base, '/login', { method: 'POST', form: { username: 'admin', password: 'pw', next: '/?tab=marketing&plan=p1&topic=2' } });
  assert.equal(ok.location, '/?tab=marketing&plan=p1&topic=2');
  for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
    const bad = await http(app.base, '/login', { method: 'POST', form: { username: 'admin', password: 'pw', next: evil } });
    assert.equal(bad.location, '/', `blocked ${evil}`);
  }
  const wrong = await http(app.base, '/api/marketing/overview');
  assert.equal(wrong.status, 401, 'API still protected');
});

test('marketing + telegram settings are cleaned and validated', async () => {
  const r = await http(app.base, '/api/settings', { method: 'POST', json: {
    telegram: { bot_token: '123:SECRET', chat_ids: '111, -100222\n@mychannel' },
    marketing: { competitors: ['@one', 'https://www.instagram.com/two/?hl=en', 'one'], keywords: 'أ، ب', morning_time: '08:30', public_url: 'https://x.app/' }
  } });
  assert.equal(r.body.success, true);
  const s = storage.getSettings();
  assert.deepEqual(s.telegram.chat_ids, ['111', '-100222', '@mychannel']);
  assert.deepEqual(s.marketing.competitors, ['one', 'two'], 'urls → usernames, no duplicates');
  assert.equal(s.marketing.public_url, 'https://x.app');
  assert.match(r.body.settings.telegram.bot_token, /^••••••••CRET$/, 'token masked in the browser');

  const again = await http(app.base, '/api/settings', { method: 'POST', json: { telegram: { bot_token: r.body.settings.telegram.bot_token } } });
  assert.equal(again.body.success, true);
  assert.equal(storage.getSettings().telegram.bot_token, '123:SECRET', 'masked value never overwrites the real token');

  const badChat = await http(app.base, '/api/settings', { method: 'POST', json: { telegram: { chat_ids: 'hello world' } } });
  assert.equal(badChat.status, 400);
  const badTime = await http(app.base, '/api/settings', { method: 'POST', json: { marketing: { morning_time: '9am' } } });
  assert.equal(badTime.status, 400);
});

test('post images are public (Instagram must download them) but nothing else is', async () => {
  const name = await require('../src/services/imageService').save(await jpeg());
  assert.equal((await http(app.base, `/media/${name}`)).status, 200);
  for (const p of ['/media/settings.json', '/media/..%2Fsettings.json', '/media/mk_x.js']) {
    assert.equal((await http(app.base, p)).status, 404, p);
  }
});

test('wizard over HTTP: new post → choose → back keeps earlier choices', async () => {
  const created = await http(app.base, '/api/marketing/plans', { method: 'POST', json: { topic: 'موضوع' } });
  const plan = created.body.plan;
  assert.equal(plan.status, 'image');
  const back = await http(app.base, `/api/marketing/plans/${plan.id}/back`, { method: 'POST', json: {} });
  assert.equal(back.status, 400, 'custom-topic post has no topic list to go back to');
  const ov = await http(app.base, '/api/marketing/overview');
  assert.ok(ov.body.plans.some(p => p.id === plan.id));
  assert.ok(ov.body.channels.facebook && ov.body.channels.instagram);
});
