// Everything ends up in the database, and comes back after the server loses its disk:
// customer conversations (AI memory), marketing posts, post images, Telegram log.
const { fake, reset, calls, jpeg, dataDir } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const storage = require('../src/services/storageService');
const sb = require('../src/services/supabaseService');

// ---- in-memory Supabase (same methods the app calls) ----
const db = { kv: {}, files: {}, conversations: {}, messages: [], notifications: [] };
sb.isEnabled = () => true;
sb.getClient = () => ({});
sb.saveSettings = async () => true;
sb.saveKv = async (k, v) => { db.kv[k] = JSON.parse(JSON.stringify(v)); return true; };
sb.loadKv = async (k) => db.kv[k] ?? null;
sb.uploadFile = async (bucket, name, buf) => { db.files[`${bucket}/${name}`] = Buffer.from(buf); return true; };
sb.downloadFile = async (bucket, name) => db.files[`${bucket}/${name}`] || null;
sb.saveConversation = async (conv) => { db.conversations[conv.id] = { ...conv, messages: undefined }; return { id: `uuid_${conv.id}` }; };
sb.saveMessagesBulk = async (msgs, conv) => { db.messages.push(...msgs.map(m => ({ ...m, conv: conv.id }))); return true; };
sb.saveLead = async () => true;
sb.saveComment = async () => true;
sb.saveMessage = async () => true;
sb.logNotification = async (e) => { db.notifications.push(e); };
sb.currentTarget = () => 'fake-db';

const mk = require('../src/services/marketingService');
const imageService = require('../src/services/imageService');
const supabaseSync = require('../src/services/supabaseSync');
const telegram = require('../src/services/telegramService');

const MK_FILE = path.join(dataDir, 'marketing.json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test.beforeEach(() => reset());

test('every customer conversation and message is written to the database', async () => {
  const conv = storage.saveConversation({ channel: 'whatsapp', external_user_id: '+962700000001', customer_name: 'سامي' });
  storage.addMessage(conv.id, { sender: 'customer', content: 'مرحبا بدي نظام للمتجر' });
  storage.addMessage(conv.id, { sender: 'bot', content: 'أهلاً! شو نوع متجرك؟' });
  await supabaseSync.fullSync();
  assert.ok(db.conversations[conv.id], 'conversation saved');
  assert.deepEqual(db.messages.filter(m => m.conv === conv.id).map(m => m.content), ['مرحبا بدي نظام للمتجر', 'أهلاً! شو نوع متجرك؟']);
  storage.addMessage(conv.id, { sender: 'customer', content: 'متجر ملابس' });
  await supabaseSync.fullSync();
  assert.equal(db.messages.filter(m => m.conv === conv.id).length, 3, 'only the new message is added, nothing duplicated');
});

test('AI memory: a returning customer the server forgot is restored from the database and the AI sees the history', async () => {
  storage.updateSettings({ ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter' }, bot: { reply_delay_seconds: 0, typing_indicator: false } }, { skipDbSync: true });
  let aiRequest = null;
  fake('post', /openrouter\.ai/, (req) => {
    aiRequest = req.body;
    return { choices: [{ message: { content: JSON.stringify({ reply_text: 'تمام، كمّلنا من وين وقفنا', buying_probability: 70, lead_stage: 'discovery' }) } }] };
  });
  // What the database remembers about this customer (the local server knows nothing).
  sb.fetchConversationWithHistory = async (channel, id) => (id === '+962799999999' ? {
    id: 'conv_restored_1', channel, external_user_id: id, customer_name: 'ليلى', business_type: 'عيادة أسنان',
    identified_problem: 'مواعيد ضايعة على الواتساب', customer_summary: 'مهتمة بنظام حجز مواعيد', interest_score: 60,
    lead_stage: 'discovery', is_bot_active: true, restored_from_db: true,
    messages: [
      { id: 'm1', sender: 'customer', content: 'عندي عيادة وبضيعوا علينا مواعيد', created_at: '2026-11-01T10:00:00Z' },
      { id: 'm2', sender: 'bot', content: 'كم موعد تقريباً بالأسبوع؟', created_at: '2026-11-01T10:00:10Z' }
    ]
  } : null);
  const sent = [];
  const replyEngine = require('../src/services/replyEngine');
  await replyEngine.ingest({
    channel: 'whatsapp', externalUserId: '+962799999999', customerName: 'ليلى', text: 'حوالي 50 موعد',
    adapter: { isReady: () => true, send: async (c, t) => { sent.push(t); return { ok: true }; }, typing: async () => {} }
  });
  for (let i = 0; i < 50 && !sent.length; i++) await sleep(100);

  assert.equal(sent[0], 'تمام، كمّلنا من وين وقفنا', 'bot replied');
  const everything = JSON.stringify(aiRequest.messages);
  assert.ok(everything.includes('عندي عيادة وبضيعوا علينا مواعيد'), 'old messages sent to the AI');
  assert.ok(everything.includes('كم موعد تقريباً بالأسبوع؟'), 'old bot replies sent to the AI');
  assert.ok(everything.includes('عيادة أسنان') && everything.includes('مواعيد ضايعة'), 'saved profile (business, problem) sent to the AI');
  assert.ok(everything.includes('حوالي 50 موعد'), 'new message included');
  const local = storage.getConversationByChannelUser('whatsapp', '+962799999999');
  assert.equal(local.id, 'conv_restored_1', 'same conversation continues (not a new one)');
});

test('marketing posts are saved to the database and restored after the disk is wiped', async () => {
  const plan = mk.savePlan({ id: 'plan_db1', date: '2026-11-11', status: 'scheduled', created_at: new Date().toISOString(), topic: { title: 'بوست محفوظ' }, caption: 'c', scheduled_at: new Date(Date.now() + 3600e3).toISOString() });
  await mk.syncDb();
  assert.equal(db.kv.marketing.plans[0].id, plan.id, 'post is in the database');

  fs.rmSync(MK_FILE);           // server lost its disk
  assert.equal(mk.getPlan('plan_db1'), null);
  const r = await mk.restoreFromDb();
  assert.equal(r.restored, true);
  assert.equal(mk.getPlan('plan_db1').topic.title, 'بوست محفوظ', 'post is back, still scheduled');
  assert.equal(mk.getPlan('plan_db1').status, 'scheduled');
});

test('post images are copied to database storage and restored before publishing', async () => {
  const name = await imageService.save(await jpeg());
  await sleep(20);
  assert.ok(db.files[`marketing-images/${name}`], 'image uploaded');
  fs.rmSync(imageService.filePath(name));
  const file = await imageService.ensureLocal(name);
  assert.ok(file && fs.existsSync(file), 'image restored from the database');
  assert.equal(await imageService.ensureLocal('mk_doesnotexist.jpg'), null);
});

test('the morning message is not sent twice in one day, even after a restart that wiped the disk', async () => {
  fake('post', /api\.telegram\.org\/botT:K\/sendMessage/, () => ({ ok: true, result: { message_id: 1 } }));
  fake('get', /news\.google\.com/, () => '<rss></rss>');
  const m = require('../src/services/businessHours').localParts().minutes - 1;
  const oneMinuteAgo = `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, '0')}:${String((m + 1440) % 60).padStart(2, '0')}`;
  storage.updateSettings({ telegram: { bot_token: 'T:K', chat_ids: ['1'] }, marketing: { enabled: true, morning_time: oneMinuteAgo }, ai: { openrouter_api_key: '' } }, { skipDbSync: true });
  const first = await mk.maybeSendMorningBrief();
  assert.ok(first && first.sent.success);
  await mk.syncDb();
  fs.rmSync(MK_FILE);
  await mk.restoreFromDb();
  assert.equal(await mk.maybeSendMorningBrief(), null, 'not sent again');
  assert.equal(calls.filter(c => /sendMessage/.test(c.url)).length, 1);
});

test('every Telegram message is recorded in the database log', async () => {
  fake('post', /api\.telegram\.org\/botT:K\/sendMessage/, () => ({ ok: true, result: { message_id: 2 } }));
  storage.updateSettings({ telegram: { bot_token: 'T:K', chat_ids: ['1'] } }, { skipDbSync: true });
  db.notifications.length = 0;
  await telegram.sendMessage('<b>عنوان</b>\nنص', { type: 'morning_brief' });
  assert.equal(db.notifications.length, 1);
  assert.equal(db.notifications[0].type, 'telegram_morning_brief');
  assert.equal(db.notifications[0].subject, 'عنوان');
  assert.equal(db.notifications[0].status, 'sent');
  assert.deepEqual(db.notifications[0].recipients, ['telegram:1']);
});

test('settings (Telegram token, chat ids, Meta connection) are saved to the database', async () => {
  let saved = null;
  sb.saveSettings = async (s) => { saved = s; return true; };
  storage.updateSettings({ telegram: { bot_token: 'T:SAVED', chat_ids: ['9'] }, meta: { page_access_token: 'PAGE' } });
  await sleep(10);
  assert.equal(saved.telegram.bot_token, 'T:SAVED');
  assert.deepEqual(saved.telegram.chat_ids, ['9']);
  assert.equal(saved.meta.page_access_token, 'PAGE');
});
