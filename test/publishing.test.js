// Scheduled posts go out on time to Facebook + Instagram; failures are safe to retry.
const { fake, reset, calls, jpeg, status } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const mk = require('../src/services/marketingService');
const imageService = require('../src/services/imageService');

const META = { page_access_token: 'PAGE_TOKEN', page_id: '111', instagram_account_id: '222', _ids_checked: true };

async function readyPlan(minutesAgo = 1) {
  const file = await imageService.save(await jpeg());
  const plan = mk.savePlan({
    id: `plan_t${Math.random().toString(36).slice(2, 8)}`, date: '2026-11-11', source: 'manual', status: 'scheduled',
    created_at: new Date().toISOString(), topic: { title: 'عنوان' }, image_file: file, caption: 'كابشن البوست',
    scheduled_at: new Date(Date.now() - minutesAgo * 60e3).toISOString(), scheduled_label: 'اليوم الساعة 09:00'
  });
  return plan;
}

function fakeMeta({ fbFails = false, igFails = false } = {}) {
  fake('post', /graph\.facebook\.com\/v21\.0\/111\/photos/, () => (fbFails ? status(403, { error: { message: '(#200) permission' } }) : { id: 'ph1', post_id: '111_999' }));
  fake('post', /graph\.facebook\.com\/v21\.0\/222\/media\?/, () => (igFails ? status(400, { error: { message: 'bad image' } }) : { id: 'cont1' }));
  fake('get', /graph\.facebook\.com\/v21\.0\/cont1\?/, () => ({ status_code: 'FINISHED' }));
  fake('post', /graph\.facebook\.com\/v21\.0\/222\/media_publish/, () => ({ id: 'ig_media_1' }));
  fake('get', /graph\.facebook\.com\/v21\.0\/ig_media_1\?/, () => ({ permalink: 'https://www.instagram.com/p/abc/' }));
  fake('post', /api\.telegram\.org\/botTG:TOKEN\/sendMessage/, () => ({ ok: true, result: { message_id: 1 } }));
}

test.beforeEach(() => {
  reset();
  storage.updateSettings({
    meta: META,
    marketing: { public_url: 'https://atlead.example.com', publish_facebook: true, publish_instagram: true, publish_telegram_channel: false },
    telegram: { bot_token: 'TG:TOKEN', chat_ids: ['42'] }
  }, { skipDbSync: true });
});

test('a due post is published to Facebook and Instagram, and the admin gets a Telegram confirmation', async () => {
  fakeMeta();
  const plan = await readyPlan();
  await mk.publishDue();
  const p = mk.getPlan(plan.id);
  assert.equal(p.status, 'published');
  assert.equal(p.results.facebook.ok, true);
  assert.equal(p.results.facebook.url, 'https://www.facebook.com/111_999');
  assert.equal(p.results.instagram.url, 'https://www.instagram.com/p/abc/');

  const fbCall = calls.find(c => /111\/photos/.test(c.url));
  assert.equal(fbCall.body.caption, 'كابشن البوست');
  const igCall = calls.find(c => /222\/media\?/.test(c.url));
  assert.equal(igCall.params.image_url, `https://atlead.example.com/media/${plan.image_file}`, 'Instagram gets the public image link');

  await new Promise(r => setTimeout(r, 50));
  const tg = calls.find(c => /telegram.*sendMessage/.test(c.url));
  assert.ok(tg, 'telegram confirmation sent');
  assert.match(tg.body.text, /البوست انتشر/);
});

test('posts in the future are not published early', async () => {
  fakeMeta();
  const plan = await readyPlan(-30);
  await mk.publishDue();
  assert.equal(mk.getPlan(plan.id).status, 'scheduled');
  assert.ok(!calls.some(c => /photos|media_publish/.test(c.url)));
});

test('partial failure: retry re-sends ONLY the failed platform (no duplicate Facebook post)', async () => {
  fakeMeta({ igFails: true });
  const plan = await readyPlan();
  await mk.publishDue();
  let p = mk.getPlan(plan.id);
  assert.equal(p.status, 'partial');
  assert.equal(p.results.instagram.ok, false);

  reset(); fakeMeta();
  p = await mk.publishPlan(plan.id);
  assert.equal(p.status, 'published');
  assert.equal(calls.filter(c => /111\/photos/.test(c.url)).length, 0, 'facebook not posted again');
  assert.equal(calls.filter(c => /media_publish/.test(c.url)).length, 1);
});

test('missing permission is explained in Arabic', async () => {
  fakeMeta({ fbFails: true });
  const plan = await readyPlan();
  await mk.publishDue();
  assert.match(mk.getPlan(plan.id).results.facebook.error, /pages_manage_posts/);
});

test('a slot missed while the server was down is NOT posted at a random hour', async () => {
  fakeMeta();
  const plan = await readyPlan(3 * 60);
  await mk.publishDue();
  const p = mk.getPlan(plan.id);
  assert.equal(p.status, 'failed');
  assert.match(p.error, /فات موعد النشر/);
  assert.ok(!calls.some(c => /photos|media_publish/.test(c.url)));
});

test('cancelled posts are never published', async () => {
  fakeMeta();
  const plan = await readyPlan(-10);
  mk.cancel(plan.id);
  const p = mk.getPlan(plan.id); p.scheduled_at = new Date(Date.now() - 60e3).toISOString(); mk.savePlan(p);
  await mk.publishDue();
  assert.equal(mk.getPlan(plan.id).status, 'cancelled');
});

test('nothing connected: clear reason per platform, nothing sent', async () => {
  storage.updateSettings({ meta: { page_access_token: '', page_id: '', instagram_account_id: '' } }, { skipDbSync: true });
  const plan = await readyPlan();
  await mk.publishDue();
  const p = mk.getPlan(plan.id);
  assert.equal(p.status, 'failed');
  assert.ok(p.results.facebook.skipped && p.results.instagram.skipped);
});
