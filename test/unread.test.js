// Inbox: the number next to "Conversations" counts chats with unopened customer messages.
const { reset, startApp, http } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../src/services/storageService');

let app;
test.before(async () => { app = await startApp(); });
test.after(() => app.close());
test.beforeEach(() => { reset(); delete process.env.ADMIN_PASSWORD; });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const unreadOf = async (id) => (await http(app.base, '/api/conversations')).body.conversations.find(c => c.id === id).unread_count;

test('unread messages count until the chat is opened, then new ones count again', async () => {
  const conv = storage.saveConversation({ channel: 'whatsapp', external_user_id: '962790001122', customer_name: 'Hala' });
  storage.addMessage(conv.id, { sender: 'customer', content: 'مرحبا' });
  storage.addMessage(conv.id, { sender: 'bot', content: 'أهلاً' });
  storage.addMessage(conv.id, { sender: 'customer', content: 'كم السعر؟' });
  storage.addMessage(conv.id, { sender: 'customer', content: 'وبتشتغلوا بالأردن؟' });
  assert.equal(await unreadOf(conv.id), 2, 'never opened: the latest customer messages');

  const read = await http(app.base, `/api/conversations/${conv.id}/read`, { method: 'POST' });
  assert.equal(read.status, 200);
  assert.equal(await unreadOf(conv.id), 0, 'opened → read');

  await sleep(5);
  storage.addMessage(conv.id, { sender: 'customer', content: 'تمام' });
  assert.equal(await unreadOf(conv.id), 1, 'a new message after opening');
  assert.equal((await http(app.base, '/api/conversations/nope/read', { method: 'POST' })).status, 404);
});

test('whoever writes last is at the top of the inbox', async () => {
  const a = storage.saveConversation({ channel: 'whatsapp', external_user_id: '962790000301', customer_name: 'Old' });
  storage.addMessage(a.id, { sender: 'customer', content: 'قديمة' });
  await sleep(5);
  const b = storage.saveConversation({ channel: 'instagram_dm', external_user_id: 'ig_302', customer_name: 'New' });
  storage.addMessage(b.id, { sender: 'customer', content: 'جديدة' });
  let ids = (await http(app.base, '/api/conversations')).body.conversations.map(c => c.id);
  assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
  await sleep(5);
  storage.addMessage(a.id, { sender: 'customer', content: 'رجعت' });
  ids = (await http(app.base, '/api/conversations')).body.conversations.map(c => c.id);
  assert.equal(ids[0], a.id, 'a new message moves the chat to the top');
});
