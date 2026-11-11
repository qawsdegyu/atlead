// Post wizard: topic → image → caption → time → scheduled → published (all multiple choice).
const { fake, reset, calls, jpeg, status } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const mk = require('../src/services/marketingService');
const research = require('../src/services/marketResearch');

const AI_KEY = 'sk-or-test-key';

function fakeAi() {
  // One OpenRouter key: text answers depend on what is asked.
  fake('post', /openrouter\.ai\/api\/v1\/chat\/completions/, (req) => {
    const prompt = JSON.stringify(req.body.messages);
    if (req.body.modalities) {
      return { choices: [{ message: { images: [{ image_url: { url: `data:image/jpeg;base64,${fakeAi.img.toString('base64')}` } }] } }] };
    }
    let json;
    if (prompt.includes('اقترح بالضبط 3 مواضيع')) {
      json = { market_summary: 'المنافسين بيركزوا على سرعة الرد', topics: [
        { title: 'موضوع أ', angle: 'زاوية أ', why: 'سبب أ', format: 'مشكلة وحل' },
        { title: 'موضوع ب', angle: 'زاوية ب', why: 'سبب ب', format: 'تعليمي' },
        { title: 'موضوع ج', angle: 'زاوية ج', why: 'سبب ج', format: 'تفاعلي' }] };
    } else if (prompt.includes('image prompts')) {
      json = { prompts: [{ style: 'واقعي', prompt: 'p1' }, { style: '3D', prompt: 'p2' }, { style: 'بسيط', prompt: 'p3' }] };
    } else if (prompt.includes('كابشنات')) {
      json = { captions: [
        { style: 'قصير', text: '**سطر أول**\nاكتب تفاصيل بالتعليقات', hashtags: ['مبيعات', '#AI'] },
        { style: 'قصة', text: 'قصة', hashtags: ['#x'] },
        { style: 'نقاط', text: 'نقاط', hashtags: ['#y'] }] };
    } else json = {};
    return { choices: [{ message: { content: JSON.stringify(json) } }] };
  });
  fake('get', /news\.google\.com/, () => '<rss><item><title>خبر عن الأتمتة</title></item></rss>');
}

test.before(async () => { fakeAi.img = await jpeg(); });
test.beforeEach(() => {
  reset();
  storage.updateSettings({ ai: { openrouter_api_key: AI_KEY, provider: 'openrouter' }, marketing: { keywords: ['أتمتة'] } }, { skipDbSync: true });
  fakeAi();
});

test('full wizard: every step offers 3 choices and ends scheduled at a chosen best time', async () => {
  let p = await mk.createPlan({});
  assert.equal(p.status, 'topic');
  assert.equal(p.topics.length, 3, '3 topics');
  assert.equal(p.market_summary, 'المنافسين بيركزوا على سرعة الرد');

  p = await mk.chooseTopic(p.id, { index: 1 });
  assert.equal(p.topic.title, 'موضوع ب');
  assert.equal(p.status, 'image');
  assert.equal(p.images.length, 3, '3 images');
  assert.ok(p.images.every(i => /^mk_[a-z0-9]+\.jpg$/.test(i.file)), 'saved as jpeg with random names');

  p = await mk.chooseImage(p.id, 2);
  assert.equal(p.status, 'caption');
  assert.equal(p.captions.length, 3, '3 captions');
  assert.equal(p.captions[0].text, 'سطر أول\nاكتب تفاصيل بالتعليقات', 'markdown removed');
  assert.deepEqual(p.captions[0].hashtags, ['#مبيعات', '#AI'], 'hashtags normalised');

  p = await mk.chooseCaption(p.id, { index: 0 });
  assert.equal(p.status, 'time');
  assert.equal(p.times.length, 3, '3 posting times');
  assert.ok(p.times.every(t => new Date(t.iso) > Date.now()), 'only future times');
  assert.ok(p.caption.includes('#مبيعات'), 'caption carries the hashtags');

  p = await mk.schedule(p.id, { index: 1 });
  assert.equal(p.status, 'scheduled');
  assert.equal(p.scheduled_at, p.times[1].iso);
});

test('custom topic, edited caption and custom time are accepted', async () => {
  let p = await mk.createPlan({ customTopic: 'موضوعي الخاص' });
  assert.equal(p.status, 'image');
  assert.equal(p.topic.title, 'موضوعي الخاص');
  p = await mk.chooseImage(p.id, 0);
  p = await mk.chooseCaption(p.id, { text: 'نص كتبته بإيدي' });
  assert.equal(p.caption, 'نص كتبته بإيدي');
  const at = new Date(Date.now() + 3 * 3600e3).toISOString();
  p = await mk.schedule(p.id, { iso: at });
  assert.equal(p.status, 'scheduled');
  await assert.rejects(mk.schedule(p.id, { iso: new Date(Date.now() - 60e3).toISOString() }), /بالمستقبل/);
});

test('steps cannot be skipped', async () => {
  const p = await mk.createPlan({});
  await assert.rejects(mk.chooseImage(p.id, 0), /غير متاحة/);
  await assert.rejects(mk.chooseCaption(p.id, { index: 0 }), /غير متاحة/);
  await assert.rejects(mk.chooseTopic(p.id, { index: 7 }), /اختار موضوع/);
});

test('regenerate gives new topics and never repeats rejected ones in the AI prompt', async () => {
  const p = await mk.createPlan({});
  calls.length = 0;
  const p2 = await mk.regenerate(p.id, 'topics');
  assert.equal(p2.topics.length, 3);
  const prompt = JSON.stringify(calls.find(c => /openrouter/.test(c.url)).body.messages);
  assert.ok(prompt.includes('موضوع أ') && prompt.includes('ممنوع تكرارها'), 'previous topics are sent as "do not repeat"');
});

test('without any AI key the flow still works with ready-made ideas and the free image service', async () => {
  storage.updateSettings({ ai: { openrouter_api_key: '' } }, { skipDbSync: true });
  fake('get', /image\.pollinations\.ai/, async () => (await jpeg('#10b981')));
  const p = await mk.createPlan({});
  assert.equal(p.topics.length, 3);
  assert.equal(p.ai_topics, false);
  const p2 = await mk.chooseTopic(p.id, { index: 0 });
  assert.equal(p2.images.length, 3);
  assert.ok(p2.images.every(i => /Pollinations/.test(i.engine)));
});

test('when every image engine fails the admin sees why and can upload their own image', async () => {
  storage.updateSettings({ ai: { openrouter_api_key: '' } }, { skipDbSync: true });
  fake('get', /image\.pollinations\.ai/, () => status(402, 'busy'));
  let p = await mk.createPlan({ customTopic: 'x' });
  assert.equal(p.images.length, 0);
  assert.match(p.image_error, /مضغوط حالياً/);
  p = await mk.addUploadedImage(p.id, await jpeg('#f43f5e'));
  assert.equal(p.images[0].style, 'صورتك');
  p = await mk.chooseImage(p.id, 0);
  assert.equal(p.status, 'caption');
});

test('best times: 3 future slots, our own best hour is promoted when we have enough posts', () => {
  const now = new Date();
  const base = research.bestTimes([], 3, now);
  assert.equal(base.length, 3);
  assert.ok(base.every(s => new Date(s.iso) > now));
  // 10 posts at 16:00 UTC (= 19:00 Amman) with good engagement
  const own = Array.from({ length: 10 }, (_, i) => ({ timestamp: new Date(Date.UTC(2026, 9, i + 1, 16)).toISOString(), engagement: 100 }));
  const withData = research.bestTimes(own, 6, now);
  assert.ok(withData.some(s => s.from_own_data && s.label.includes('19:00')), 'own best hour offered');
});
