// Dashboard API: login deep links, settings validation, secrets masking, image access.
const { startApp, http, jpeg } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });
test.afterEach(() => { delete process.env.ADMIN_PASSWORD; });

test('hosted dashboard routes fail closed when ADMIN_PASSWORD is missing', async () => {
  const previousEnv = process.env.NODE_ENV;
  const previousRailwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const previousRailwayName = process.env.RAILWAY_ENVIRONMENT_NAME;
  const previousVercelEnv = process.env.VERCEL_ENV;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.RAILWAY_PUBLIC_DOMAIN;
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const dashboard = await http(app.base, '/');
    const login = await http(app.base, '/login');
    assert.equal(dashboard.status, 503);
    assert.equal(dashboard.body.message, 'Dashboard authentication is not configured');
    assert.equal(login.status, 503);
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
    if (previousRailwayDomain === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN; else process.env.RAILWAY_PUBLIC_DOMAIN = previousRailwayDomain;
    if (previousRailwayName === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME; else process.env.RAILWAY_ENVIRONMENT_NAME = previousRailwayName;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousVercelEnv;
  }
});

test('consult rate limits cannot be bypassed by spoofing X-Forwarded-For', async () => {
  const results = [];
  for (let i = 0; i < 9; i++) {
    results.push(await http(app.base, '/api/consult', {
      method: 'POST', json: {}, headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` }
    }));
  }
  assert.equal(results.slice(0, 8).every(result => result.status === 400), true);
  assert.equal(results[8].status, 429);
});

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

test('manual bot shutdown performs the CRM handoff and assigns an active rep', async () => {
  process.env.ADMIN_PASSWORD = 'pw';
  storage.updateSettings({
    handoff: { keep_bot_until_human: true },
    telegram: { bot_token: '', chat_ids: [], notify_handoffs: false },
    notifications: { enabled: false, recipients: [] },
    sales_team: { members: [{ id: 'rep-1', name: 'م. ليلى', email: 'leila@example.com', active: true }] }
  }, { skipDbSync: true });
  const conv = storage.saveConversation({
    id: 'manual-handoff-test', channel: 'whatsapp', external_user_id: '+962790000401',
    customer_name: 'عميل اختبار', is_bot_active: true, messages: []
  });
  const response = await http(app.base, `/api/conversations/${conv.id}/toggle-bot`, {
    method: 'POST',
    json: { is_active: false, reason: 'طلب الموظف متابعة العميل' },
    headers: { Authorization: `Basic ${Buffer.from('admin:pw').toString('base64')}` }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  const updated = storage.getConversationById(conv.id);
  assert.equal(updated.is_bot_active, false);
  assert.equal(updated.assigned_to_id, 'rep-1');
  assert.equal(updated.handoff_reason, 'طلب الموظف متابعة العميل');
  const lead = storage.getLeads().find(item => item.conversation_id === conv.id);
  assert.equal(lead.purchase_status, 'pending_human');
  assert.equal(lead.bot_state, 'handed_off');
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
