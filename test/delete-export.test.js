// Trash buttons remove data for good (locally and from Supabase); Excel export contains every kind of data.
const { startApp, http, reset } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const storage = require('../src/services/storageService');
const supabase = require('../src/services/supabaseService');
const marketing = require('../src/services/marketingService');

let app;
const dbDeletes = [];
test.before(async () => {
  app = await startApp();
  // Record what would be deleted from the database.
  supabase.deleteConversation = async (c) => { dbDeletes.push(['conversation', c.id]); return { success: true }; };
  supabase.deleteLead = async (l) => { dbDeletes.push(['lead', l.id]); return { success: true }; };
  supabase.deleteComment = async (id) => { dbDeletes.push(['comment', id]); return { success: true }; };
});
test.after(() => app.close());
test.beforeEach(() => { reset(); dbDeletes.length = 0; });

function seed(name) {
  const conv = storage.saveConversation({ channel: 'whatsapp', external_user_id: `9627${Math.random().toString().slice(2, 10)}`, customer_name: name, lead_stage: 'discovery' });
  storage.addMessage(conv.id, { sender: 'customer', content: `مرحبا أنا ${name}`, media_type: 'text' });
  storage.addMessage(conv.id, { sender: 'bot', content: 'أهلاً وسهلاً', media_type: 'text' });
  const lead = storage.saveLead({ conversation_id: conv.id, name, phone: '0790000000', channel: 'whatsapp' });
  return { conv, lead };
}

test('deleting a conversation removes it, its messages and its customer record — here and in the database', async () => {
  const { conv, lead } = seed('حذف1');
  const r = await http(app.base, `/api/conversations/${conv.id}`, { method: 'DELETE' });
  assert.equal(r.body.success, true);
  assert.ok(!storage.getConversationById(conv.id));
  assert.equal(storage.getLeads().some(l => l.id === lead.id), false);
  assert.deepEqual(dbDeletes, [['conversation', conv.id]]);
});

test('deleting a customer in the CRM removes the customer and the conversation behind it', async () => {
  const { conv, lead } = seed('حذف2');
  const r = await http(app.base, `/api/leads/${lead.id}`, { method: 'DELETE' });
  assert.equal(r.body.success, true);
  assert.ok(!storage.getConversationById(conv.id));
  assert.equal(storage.getLeads().some(l => l.id === lead.id), false);
  assert.deepEqual(dbDeletes.map(d => d[0]).sort(), ['conversation', 'lead']);
});

test('deleting a comment removes it from the log', async () => {
  storage.saveComment({ comment_id: 'cm_del', platform: 'facebook', user_name: 'x', comment_text: 'بكم؟' });
  const r = await http(app.base, '/api/comments/cm_del', { method: 'DELETE' });
  assert.equal(r.body.success, true);
  assert.equal(storage.getCommentByCommentId('cm_del'), null);
  assert.equal((await http(app.base, '/api/comments/cm_del', { method: 'DELETE' })).status, 404);
});

test('Excel export: one sheet per kind of data, with the real rows', async () => {
  const { conv } = seed('تصدير');
  storage.saveConversation({ id: conv.id, appointment_at: new Date(Date.now() + 86400000).toISOString(), appointment_label: 'الأحد 16/11 الساعة 10:00', appointment_link: 'https://meet.google.com/x' });
  storage.saveComment({ comment_id: 'cm_exp', platform: 'instagram', user_name: 'sara', comment_text: 'كم السعر؟', is_interested: true });
  marketing.savePlan({ id: 'plan_exp', date: '2026-11-12', status: 'published', topic: { title: 'Fast replies win customers' }, caption: 'Reply in seconds.', results: { facebook: { ok: true, url: 'https://fb.com/p/1' } } });

  const res = await fetch(`${app.base}/api/export?scope=all&lang=ar`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  assert.match(res.headers.get('content-disposition'), /atlead-all-.*\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['العملاء', 'المحادثات', 'الرسائل', 'التعليقات', 'المواعيد', 'المنشورات']);
  const text = (name) => wb.getWorksheet(name).getSheetValues().flat().map(String).join(' | ');
  assert.match(text('الرسائل'), /مرحبا أنا تصدير/);
  assert.match(text('التعليقات'), /كم السعر؟/);
  assert.match(text('المواعيد'), /meet\.google\.com\/x/);
  assert.match(text('المنشورات'), /Fast replies win customers/);
  assert.match(text('المنشورات'), /fb\.com\/p\/1/);
});

test('Excel export in English and for a single page', async () => {
  const res = await fetch(`${app.base}/api/export?scope=comments&lang=en`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Comments']);
  assert.equal(wb.worksheets[0].getRow(1).getCell(3).value, 'Comment');
  assert.equal((await http(app.base, '/api/export?scope=nope')).status, 400);
});
