// Reels page: comment a keyword → fixed public reply + one DM (text, link, file, consultation form);
// the filled form becomes a Prospect lead.
const { fake, reset, calls, startApp, http } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const meta = require('../src/services/metaService');
const rules = require('../src/services/commentRules');

let app;
test.before(async () => { app = await startApp(); });
test.after(() => app.close());

test.beforeEach(() => {
  reset();
  storage.updateSettings({
    meta: { page_access_token: 'EAAtest', page_id: 'PAGE1', instagram_account_id: 'IG1', instagram_username: 'atlead.ai', _ids_checked: true, auto_reply_comments: false, auto_dm_on_interest: false },
    ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter' },
    marketing: { public_url: 'https://atlead.example.com' }
  }, { skipDbSync: true });
  fake('post', /\/messages\?/, () => ({ recipient_id: 'IGUSER9', message_id: 'm_1' }));
  fake('post', /\/(replies|comments)\?/, () => ({ id: 'reply_1' }));
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify({ sentiment: 'neutral', is_interested: false, public_reply: 'شكراً لك', auto_dm: '' }) } }] }));
});

async function comment(platform, text, postId = 'REEL1', id = `c_${Math.random().toString(36).slice(2)}`) {
  storage.saveComment({ platform, post_id: postId, comment_id: id, user_id: 'IGUSER9', user_name: 'sara', comment_text: text, status: 'pending' });
  return meta.processComment(platform, id);
}

test('"Atlead" on any reel: fixed reply under the comment + DM with the consultation form', async () => {
  const out = await comment('instagram', 'Atlead 🔥', 'REEL1', 'c_atlead_1');
  assert.equal(out.rule_id, 'rule_atlead', 'the default rule fired');
  const reply = calls.find(c => /c_atlead_1\/replies/.test(c.url));
  assert.ok(reply, 'public reply sent even with AI comment replies off');
  assert.ok(rules.get('rule_atlead').public_replies.includes(reply.body.message));
  const dm = calls.find(c => /\/messages\?/.test(c.url));
  assert.equal(dm.body.recipient.comment_id, 'c_atlead_1');
  assert.match(dm.body.message.text, /https:\/\/atlead\.example\.com\/consult\?ref=c_atlead_1/);
  assert.ok(!calls.some(c => /openrouter/.test(c.url)), 'no AI analysis for a rule match');
  assert.ok(out.conversation_id, 'DM conversation opened in the inbox');
  assert.equal(rules.get('rule_atlead').stats.triggered >= 1, true);
});

test('Arabic spelling and no keyword', async () => {
  const ar = await comment('facebook', 'بدي تفاصيل أتليد لو سمحت');
  assert.equal(ar.rule_id, 'rule_atlead');
  calls.length = 0;
  const none = await comment('instagram', 'فيديو حلو');
  assert.equal(none.rule_id, undefined);
  assert.ok(calls.some(c => /openrouter/.test(c.url)), 'ordinary comments still go to the AI');
});

test('a reel-specific rule sends its own link and file and wins over "all posts"', async () => {
  const saved = await http(app.base, '/api/comment-rules', { method: 'POST', json: {
    name: 'Price guide', platforms: ['instagram'], media_ids: ['REEL7'], keywords: 'السعر, price, atlead',
    public_replies: 'أرسلنا لك الدليل على الخاص.', dm_text: 'هذا دليل الأسعار:', link_url: 'atlead.example.com/pricing', link_label: 'الأسعار',
    file_url: '/files/rule_1_ab.pdf', file_name: 'دليل.pdf', send_form: false
  } });
  assert.equal(saved.status, 200);
  const out = await comment('instagram', 'price?', 'REEL7', 'c_price');
  assert.equal(out.rule_id, saved.body.rule.id);
  const dm = calls.find(c => /\/messages\?/.test(c.url)).body.message.text;
  assert.match(dm, /هذا دليل الأسعار:/);
  assert.match(dm, /الأسعار: https:\/\/atlead\.example\.com\/pricing/);
  assert.match(dm, /دليل\.pdf: https:\/\/atlead\.example\.com\/files\/rule_1_ab\.pdf/);
  assert.doesNotMatch(dm, /consult/);

  // "atlead" on another reel still uses the general rule.
  calls.length = 0;
  assert.equal((await comment('instagram', 'atlead', 'REEL2')).rule_id, 'rule_atlead');

  const t = await http(app.base, '/api/comment-rules/test', { method: 'POST', json: { platform: 'instagram', post_id: 'REEL7', text: 'السعر' } });
  assert.equal(t.body.matched, true);
  assert.equal(t.body.rule_name, 'Price guide');

  const bad = await http(app.base, '/api/comment-rules', { method: 'POST', json: { name: 'x', keywords: '' } });
  assert.equal(bad.status, 400);
  await http(app.base, `/api/comment-rules/${saved.body.rule.id}`, { method: 'DELETE' });
  assert.equal(rules.get(saved.body.rule.id), null);
});

test('the consultation form is public and creates a Prospect lead in the commenter conversation', async () => {
  const page = await http(app.base, '/consult?ref=c_form');
  assert.equal(page.status, 200);
  assert.match(page.body, /استشارتك المجانية/);

  const out = await comment('instagram', 'atlead', 'REEL1', 'c_form');
  const invalid = await http(app.base, '/api/consult', { method: 'POST', json: { name: 'س', phone: '12' } });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.errors.name && invalid.body.errors.phone);

  const ok = await http(app.base, '/api/consult', { method: 'POST', json: {
    name: 'سارة أحمد', phone: '0791234567', email: 'sara@example.com', company: 'Sara Store', business: 'ملابس',
    need: 'chatbot', message: 'بدي بوت للانستغرام', preferred_time: 'الأحد العصر', ref: 'c_form'
  } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.conversation_id, out.conversation_id, 'joined the DM conversation');
  const conv = storage.getConversationById(out.conversation_id);
  assert.equal(conv.lead_stage, 'prospect');
  assert.equal(conv.customer_phone, '0791234567');
  assert.equal(conv.consultation_requested, true);
  const lead = storage.getLeads().find(l => l.conversation_id === conv.id);
  assert.equal(lead.lead_stage, 'prospect');
  assert.equal(lead.name, 'سارة أحمد');
  assert.equal(lead.customer_email, 'sara@example.com');

  // Without a ref: a new website lead.
  const direct = await http(app.base, '/api/consult', { method: 'POST', json: { name: 'Omar', phone: '+962 79 555 1111', need: 'sales' } });
  assert.equal(storage.getConversationById(direct.body.conversation_id).channel, 'website');
});

test('reels list reads Instagram reels and Facebook videos; rule files are public only when used', async () => {
  fake('get', /IG1\/media/, () => ({ data: [
    { id: 'R1', caption: 'Reel one', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://instagram.com/reel/R1', thumbnail_url: 'https://x/t.jpg', timestamp: '2026-11-20T10:00:00+0000', comments_count: 4 },
    { id: 'P1', caption: 'Photo', media_type: 'IMAGE', media_product_type: 'FEED', timestamp: '2026-11-19T10:00:00+0000' }
  ] }));
  fake('get', /PAGE1\/videos/, () => ({ data: [{ id: 'V1', description: 'FB reel', permalink_url: '/reel/V1', picture: 'https://x/v.jpg', created_time: '2026-11-21T10:00:00+0000' }] }));
  // Page 1 of posts links to page 2: every page is read.
  fake('get', /PAGE1\/published_posts/, () => ({
    data: [{ id: 'PAGE1_900', message: 'FB reel', created_time: '2026-11-21T10:00:00+0000', attachments: { data: [{ media_type: 'video', target: { id: 'V1' } }] } }],
    paging: { next: 'https://graph.facebook.com/v21.0/PAGE1/posts_page2' }
  }));
  fake('get', /posts_page2/, () => ({ data: [{ id: 'PAGE1_901', message: 'Offer photo', full_picture: 'https://x/p.jpg', created_time: '2026-11-18T10:00:00+0000', attachments: { data: [{ media_type: 'photo' }] }, comments: { summary: { total_count: 7 } } }] }));
  const res = await http(app.base, '/api/reels');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map(i => i.id), ['V1', 'R1', 'P1', 'PAGE1_901'], 'reels and posts, newest first');
  assert.deepEqual(res.body.items.map(i => i.kind), ['reel', 'reel', 'post', 'post']);
  assert.deepEqual(res.body.items[0].ids, ['V1', 'PAGE1_900'], 'the FB reel keeps its post id too');
  assert.equal(res.body.items[3].comments, 7);
  assert.match(res.body.form_url, /\/consult$/);

  // A rule saved on the FB reel answers comments that arrive with its post id.
  const saved = await http(app.base, '/api/comment-rules', { method: 'POST', json: { platforms: ['facebook'], media_ids: ['V1', 'PAGE1_900'], keywords: ['كم السعر', 'details please'], dm_text: 'الأسعار هنا' } });
  assert.equal((await comment('facebook', 'لو سمحت كم السعر؟', 'PAGE1_900')).rule_id, saved.body.rule.id, 'phrase, contiguous');
  assert.equal((await comment('facebook', 'السعر كم لو سمحت', 'PAGE1_900')).rule_id, saved.body.rule.id, 'phrase, words in another order');
  assert.equal((await comment('facebook', 'please send details', 'PAGE1_900')).rule_id, saved.body.rule.id, 'second keyword');
  assert.notEqual((await comment('facebook', 'كم سعر الشحن', 'PAGE1_901')).rule_id, saved.body.rule.id, 'other post not covered');
  await http(app.base, `/api/comment-rules/${saved.body.rule.id}`, { method: 'DELETE' });

  assert.equal((await http(app.base, '/files/rule_nothing.pdf')).status, 404);
});
