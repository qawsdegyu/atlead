// Connecting the engineer's Google Calendar with a Google sign-in (no manual sharing).
const { fake, reset, calls, startApp, http } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const cal = require('../src/services/calendarService');

const HOST = 'atlead-production.up.railway.app';
let app;
const idToken = (email) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

test.before(async () => { process.env.RAILWAY_PUBLIC_DOMAIN = HOST; app = await startApp(); });
test.after(() => { delete process.env.RAILWAY_PUBLIC_DOMAIN; delete process.env.ADMIN_PASSWORD; return app.close(); });
test.beforeEach(() => {
  reset();
  cal._token = null; cal._busy = null;
  storage.updateSettings({
    marketing: { public_url: '' },
    google_sheets: { service_account_json: '' },
    calendar: { enabled: false, calendar_id: '', google_client_id: 'cid.apps.googleusercontent.com', google_client_secret: 'csecret', oauth_refresh_token: '', oauth_email: '' }
  }, { skipDbSync: true });
});

test('enter the Gmail → one link → Google sign-in → calendar connected and booking switched on', async () => {
  process.env.ADMIN_PASSWORD = 'pw'; // the dashboard is locked; the engineer's link still works
  const linkRes = cal.connectLink('eng@gmail.com');
  assert.match(linkRes.link, new RegExp(`^https://${HOST}/connect-calendar/[A-Za-z0-9_-]+$`));
  assert.equal(linkRes.redirect_uri, `https://${HOST}/oauth/google/callback`);

  // The engineer opens the link → sent to Google with their Gmail filled in.
  const path = new URL(linkRes.link).pathname;
  const go = await http(app.base, path);
  assert.equal(go.status, 302);
  const google = new URL(go.location);
  assert.equal(google.host, 'accounts.google.com');
  assert.equal(google.searchParams.get('login_hint'), 'eng@gmail.com');
  assert.equal(google.searchParams.get('access_type'), 'offline');
  assert.match(google.searchParams.get('scope'), /calendar\.events/);
  const state = google.searchParams.get('state');

  // Google sends them back with a code.
  fake('post', /oauth2\.googleapis\.com\/token/, (req) => {
    const p = new URLSearchParams(String(req.body));
    if (p.get('grant_type') === 'authorization_code') return { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, id_token: idToken('eng@gmail.com') };
    return { access_token: 'a2', expires_in: 3600 };
  });
  const back = await http(app.base, `/oauth/google/callback?code=c0de&state=${state}`, { headers: { Accept: 'text/html' } });
  assert.equal(back.status, 200);
  assert.match(back.body, /تم ربط التقويم/);
  const s = storage.getSettings().calendar;
  assert.equal(s.oauth_refresh_token, 'r1');
  assert.equal(s.oauth_email, 'eng@gmail.com');
  assert.equal(s.calendar_id, 'eng@gmail.com');
  assert.equal(s.enabled, true);
  assert.equal(cal.isActive(), true, 'booking is on');

  // Booking now uses the engineer's own Google access.
  fake('post', /calendar\/v3\/freeBusy/, (req) => { assert.equal(req.body.items[0].id, 'eng@gmail.com'); return { calendars: { 'eng@gmail.com': { busy: [] } } }; });
  const t = await cal.test();
  assert.equal(t.success, true, t.message);
  assert.match(t.message, /eng@gmail\.com/);
  assert.ok(calls.some(c => /oauth2\.googleapis\.com\/token/.test(c.url) && /grant_type=refresh_token/.test(String(c.body))));

  // The link works once.
  assert.equal((await http(app.base, path)).status, 410);
});

test('a wrong or expired link never connects anything', async () => {
  const r = await http(app.base, '/oauth/google/callback?code=x&state=forged', { headers: { Accept: 'text/html' } });
  assert.equal(r.status, 400);
  assert.equal(storage.getSettings().calendar.oauth_refresh_token, '');
  assert.equal((await http(app.base, '/connect-calendar/not-a-token')).status, 410);
});

test('no Google keys yet → a clear message instead of a broken link', () => {
  storage.updateSettings({ calendar: { google_client_id: '', google_client_secret: '' } }, { skipDbSync: true });
  assert.throws(() => cal.connectLink('eng@gmail.com'), /Client ID/);
});

test('disconnect removes the access', async () => {
  storage.updateSettings({ calendar: { oauth_refresh_token: 'r1', oauth_email: 'eng@gmail.com', calendar_id: 'eng@gmail.com', enabled: true } }, { skipDbSync: true });
  fake('post', /oauth2\.googleapis\.com\/revoke/, () => ({}));
  await cal.disconnect();
  assert.equal(storage.getSettings().calendar.oauth_refresh_token, '');
  assert.equal(cal.usesOAuth(), false);
});
