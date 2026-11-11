// Design identity learned from the page, on-brand generation with Nano Banana Pro,
// and the edit chats for the image and the caption.
const { fake, reset, calls, jpeg } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const mk = require('../src/services/marketingService');
const imageService = require('../src/services/imageService');

const IG = '17841400000000000';
let img;

function fakeWorld({ proFails = false } = {}) {
  // Instagram: profile + 4 posts with engagement
  fake('get', new RegExp(`graph\\.facebook\\.com/v21\\.0/${IG}\\?`), () => ({ username: 'atlead.ai', profile_picture_url: 'https://cdn.example/logo.png' }));
  fake('get', new RegExp(`graph\\.facebook\\.com/v21\\.0/${IG}/media`), () => ({ data: [1, 2, 3, 4].map(n => ({ media_type: 'IMAGE', media_url: `https://cdn.example/p${n}.jpg`, like_count: n * 10, comments_count: n, timestamp: `2026-11-0${n}T10:00:00Z` })) }));
  fake('get', /cdn\.example\//, () => img);
  // OpenRouter: vision (brand analysis), text (concepts/captions), images
  fake('post', /openrouter\.ai\/api\/v1\/chat\/completions/, (req) => {
    const b = req.body;
    if (b.modalities) {
      if (proFails && b.model === 'google/gemini-3-pro-image') return { __status: 402, data: { error: { message: 'no credit' } } };
      return { choices: [{ message: { images: [{ image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` } }] } }] };
    }
    const all = JSON.stringify(b.messages);
    let json = {};
    if (all.includes('reverse-engineer')) json = { summary_ar: 'هوية كحلية بسيطة', palette: [{ hex: '#0B1F3A', role: 'background' }, { hex: '#3B82F6', role: 'accent' }, { hex: 'blue', role: 'bad' }], typography: 'bold Arabic sans', layout: 'headline top', logo_usage: 'bottom-left small', mood: 'calm, premium', dont: ['neon'], art_direction_en: 'Navy background, blue accents, bold Arabic headline at top.' };
    else if (all.includes('post concepts')) json = { concepts: [1, 2, 3].map(n => ({ style: `مفهوم ${n}`, headline: `عنوان ${n}`, prompt: `concept ${n}` })) };
    else if (all.includes('الطلب الجديد')) json = { caption: '**كابشن أقصر**\n#atlead', reply: 'قصّرته' };
    return { choices: [{ message: { content: JSON.stringify(json) } }] };
  });
}

test.before(async () => { img = await jpeg('#0b1f3a'); });
test.beforeEach(() => {
  reset();
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-test', provider: 'openrouter' },
    meta: { page_access_token: 'PAGE', page_id: '111', instagram_account_id: IG },
    marketing: { image_model: '' }
  }, { skipDbSync: true });
  imageService._bad = new Map();
});

test('learns the design identity from the page\'s own Instagram posts', async () => {
  fakeWorld();
  const b = await mk.learnBrand();
  assert.equal(b.source, '@atlead.ai');
  assert.equal(b.refs.length, 4, 'all 4 posts kept as references');
  assert.ok(b.logo, 'profile picture kept as the logo');
  assert.deepEqual(b.guide.palette.map(c => c.hex), ['#0B1F3A', '#3B82F6'], 'invalid colours dropped');
  const vision = calls.find(c => /openrouter/.test(c.url) && JSON.stringify(c.body).includes('reverse-engineer'));
  const sentImages = vision.body.messages[1].content.filter(p => p.type === 'image_url');
  assert.equal(sentImages.length, 5, 'the vision model sees the posts + logo');
  assert.match(mk.brandDirection(), /#0B1F3A/);
});

test('new posts are generated with Nano Banana Pro, in 4:5, with the brand references', async () => {
  fakeWorld();
  await mk.learnBrand();
  calls.length = 0;
  const p = await mk.createPlan({ customTopic: 'سرعة الرد' });
  assert.equal(p.images.length, 3);
  assert.ok(p.images.every(i => i.engine === 'Nano Banana Pro'));
  assert.deepEqual(p.images.map(i => i.headline), ['عنوان 1', 'عنوان 2', 'عنوان 3']);
  const gen = calls.filter(c => c.body?.modalities);
  assert.equal(gen[0].body.model, 'google/gemini-3-pro-image');
  assert.equal(gen[0].body.image_config.aspect_ratio, '4:5');
  const parts = gen[0].body.messages[0].content;
  assert.equal(parts.filter(x => x.type === 'image_url').length, 4, 'logo + 3 page posts as references');
  const text = parts.find(x => x.type === 'text').text;
  assert.match(text, /Render this headline exactly/);
  assert.match(text, /#0B1F3A/, 'exact brand colours in the prompt');
  const meta = await require('sharp')(imageService.filePath(p.images[0].file)).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1350], 'saved as 1080x1350');
});

test('falls back to Nano Banana 2.1 when Pro is unavailable', async () => {
  fakeWorld({ proFails: true });
  const p = await mk.createPlan({ customTopic: 'x' });
  assert.ok(p.images.length >= 1);
  assert.ok(p.images.every(i => i.engine === 'Nano Banana 2.1'));
});

test('image chat: an edit sends the chosen image first and adds a new version', async () => {
  fakeWorld();
  let p = await mk.createPlan({ customTopic: 'تعديل' });
  const original = p.images[1].file;
  calls.length = 0;
  p = await mk.editImage(p.id, original, 'كبّر العنوان');
  assert.equal(p.images.length, 4, 'original kept, new version added');
  assert.equal(p.images[0].parent, original);
  assert.equal(p.images[0].style, 'تعديل 1');
  assert.equal(p.images[0].note, 'كبّر العنوان');
  const call = calls.find(c => c.body?.modalities);
  const parts = call.body.messages[0].content;
  assert.match(parts[0].text, /كبّر العنوان/);
  assert.equal(parts[1].image_url.url, imageService.dataUrl(original), 'the image being edited goes first');
  assert.deepEqual(p.image_chat.map(m => m.role), ['user', 'assistant']);
  // a second edit on the new version counts as version 2 of the same design
  p = await mk.editImage(p.id, p.images[0].file, 'غيّر الخلفية');
  assert.equal(p.images[0].style, 'تعديل 2');
  await assert.rejects(mk.editImage(p.id, 'mk_notinplan.jpg', 'x'), /اختار صورة/);
  await assert.rejects(mk.editImage(p.id, original, '  '), /اكتب/);
});

test('caption chat: rewrites by instruction, keeps a history, and is approved as the caption', async () => {
  fakeWorld();
  let p = await mk.createPlan({ customTopic: 'كابشن' });
  p = await mk.chooseImage(p.id, 0);
  p = await mk.captionChat(p.id, 'كابشن طويل جداً\n#a', 'خلّيه أقصر');
  assert.equal(p.caption_draft, 'كابشن أقصر\n#atlead', 'markdown removed');
  assert.deepEqual(p.caption_chat.map(m => m.role), ['user', 'assistant']);
  assert.equal(p.caption_chat[1].text, 'قصّرته');
  const req = calls.filter(c => /openrouter/.test(c.url)).pop();
  assert.match(JSON.stringify(req.body.messages), /كابشن طويل جداً/, 'current caption sent');
  p = await mk.chooseCaption(p.id, { text: p.caption_draft });
  assert.equal(p.status, 'time');
  assert.equal(p.caption, 'كابشن أقصر\n#atlead');
});

test('owner can upload a logo / design and remove references', async () => {
  fakeWorld();
  await mk.learnBrand();
  let b = await mk.addBrandFile(await jpeg('#ffffff'), 'logo');
  assert.equal(b.logo_from_profile, false);
  b = await mk.addBrandFile(await jpeg('#123456'), 'ref');
  assert.equal(b.refs.length, 5);
  b = mk.removeBrandFile(b.refs[0]);
  assert.equal(b.refs.length, 4);
});
