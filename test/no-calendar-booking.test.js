// The WhatsApp case: "بدي احجز استشاره مجانيه" with no calendar connected and the AI call off.
// The bot must ask for a day and time, record it, and only then hand over (team confirms).
const { fake, reset } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const ai = require('../src/services/aiService');
const crm = require('../src/services/crmService');
const replyEngine = require('../src/services/replyEngine');
const sheets = require('../src/services/googleSheetsService');

let answers;
test.beforeEach(() => {
  reset();
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter', openai_api_key: '' },
    calendar: { enabled: false }, ai_call: { enabled: false },
    handoff: { handoff_message: 'تمام، {rep} رح يتواصل معك.', representative_name: 'م. مهند' },
    business_hours: { enabled: false }
  }, { skipDbSync: true });
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify(answers.shift() || { reply_text: 'تمام' }) } }] }));
});

async function say(conv, text) {
  storage.addMessage(conv.id, { sender: 'customer', content: text, media_type: 'text' });
  conv = storage.getConversationById(conv.id);
  const r = await ai.generateReply({ ...conv, messages: conv.messages.slice(0, -1) }, text);
  const handoff = crm.shouldHandoff(r) && !conv.handoff_at;
  const reply = crm.replyForTurn(conv.id, r, handoff);
  storage.addMessage(conv.id, { sender: 'bot', content: reply, media_type: 'text' });
  await replyEngine.applyAiState(storage.getConversationById(conv.id), r, handoff);
  return { reply, handoff };
}

test('"بدي احجز استشاره مجانيه": asks for a day and time instead of the instant handoff, then records it', async () => {
  let conv = storage.saveConversation({ channel: 'whatsapp', external_user_id: '962780900000', customer_name: 'operix' });
  // The model wants to hand off straight away (what happened on WhatsApp).
  answers = [{ reply_text: 'تمام', handoff_triggered: true, buying_probability: 90 }];
  const first = await say(conv, 'بدي احجز استشاره مجانيه');
  assert.equal(first.handoff, false, 'no instant handoff');
  assert.match(first.reply, /أي يوم ووقت/);
  assert.doesNotMatch(first.reply, /رح يتواصل معك/);

  answers = [{ reply_text: 'ممتاز', buying_probability: 85 }];
  const second = await say(conv, 'يوم الأحد الساعة 11 الصبح');
  assert.equal(second.handoff, true, 'now the team is told');
  assert.match(second.reply, /سجّلت طلبك للاستشارة المجانية: يوم الأحد الساعة 11 الصبح/);
  conv = storage.getConversationById(conv.id);
  assert.equal(conv.requested_meeting_time, 'يوم الأحد الساعة 11 الصبح');
  assert.match(conv.handoff_reason, /الوقت المطلوب: يوم الأحد الساعة 11 الصبح/);
  const lead = storage.getLeads().find(l => l.conversation_id === conv.id);
  assert.ok(sheets.leadToRow(lead).some(v => /مطلوب \(يحتاج تأكيد\): يوم الأحد/.test(v)), 'in Google Sheets');
});

test('English: same flow', async () => {
  const conv = storage.saveConversation({ channel: 'whatsapp', external_user_id: '962780900001', customer_name: 'Sam' });
  answers = [{ reply_text: 'Sure', handoff_triggered: true, buying_probability: 90 }];
  const first = await say(conv, 'I want to book a free consultation');
  assert.equal(first.handoff, false);
  assert.match(first.reply, /Which day and time/);
  answers = [{ reply_text: 'Great' }];
  const second = await say(conv, 'Sunday at 11 am');
  assert.match(second.reply, /noted your request for a free consultation: Sunday at 11 am/);
});

test('a message mentioning Facebook is not mistaken for a booking request', async () => {
  const conv = storage.saveConversation({ channel: 'whatsapp', external_user_id: '962780900002', customer_name: 'x' });
  answers = [{ reply_text: 'We reply on Facebook and Instagram too.' }];
  const r = await say(conv, 'Do you work with Facebook pages?');
  assert.equal(r.reply, 'We reply on Facebook and Instagram too.');
});
