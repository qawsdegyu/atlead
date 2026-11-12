// #4: after the handoff the bot keeps answering, and stops only when a human rep replies.
const { fake, reset, calls } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const replyEngine = require('../src/services/replyEngine');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let aiAnswer;

function fakeAi() {
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify(aiAnswer) } }] }));
}

async function say(phone, text, sent) {
  await replyEngine.ingest({
    channel: 'whatsapp', externalUserId: phone, customerName: 'سامر', text,
    adapter: { isReady: () => true, send: async (c, t) => { sent.push(t); return { ok: true }; }, typing: async () => {} }
  });
  for (let i = 0; i < 60; i++) { await sleep(50); if (!replyEngine.pending.size) break; }
}

test.beforeEach(() => {
  reset();
  fakeAi();
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter' },
    bot: { reply_delay_seconds: 0, typing_indicator: false, pause_on_human_reply: true, human_pause_hours: 0 },
    handoff: { keep_bot_until_human: true, closing_deal_threshold_percent: 85, handoff_message: 'تمام، {rep} رح يتواصل معك.', representative_name: 'م. مهند' },
    business_hours: { enabled: false }
  }, { skipDbSync: true });
});

test('handoff: message sent once, bot keeps answering, then stops when a rep replies', async () => {
  const sent = [];
  const phone = '+962790000001';
  aiAnswer = { reply_text: 'تمام', buying_probability: 90, lead_stage: 'deal_closing', handoff_triggered: true };
  await say(phone, 'بدي أحجز استشارة', sent);
  let conv = storage.getConversationByChannelUser('whatsapp', phone);
  assert.match(sent[0], /رح يتواصل معك/, 'handoff message sent');
  assert.ok(conv.handoff_at, 'marked as handed off');
  assert.notEqual(conv.is_bot_active, false, 'bot still on');
  const lead = storage.getLeads().find(l => l.conversation_id === conv.id);
  assert.equal(lead.purchase_status, 'pending_human');
  assert.equal(lead.bot_state, 'waiting_human');

  // The customer asks another question before the rep calls: the bot answers it normally.
  aiAnswer = { reply_text: 'الاستشارة مجانية ومدتها 30 دقيقة.', buying_probability: 92, handoff_triggered: true };
  calls.length = 0;
  await say(phone, 'كم مدة الاستشارة؟', sent);
  assert.equal(sent[1], 'الاستشارة مجانية ومدتها 30 دقيقة.', 'normal answer, handoff message not repeated');
  const prompt = JSON.stringify(calls.find(c => /openrouter/.test(c.url)).body.messages);
  assert.match(prompt, /تحوّل لموظف المبيعات/, 'the AI knows the customer is waiting for the rep');

  // The rep replies from the phone → the bot stops.
  conv = storage.getConversationByChannelUser('whatsapp', phone);
  replyEngine.recordHumanMessage(conv.id, 'أهلاً، معك مهند من atlead', 'msg_x', 'الجوال');
  conv = storage.getConversationByChannelUser('whatsapp', phone);
  assert.equal(conv.is_bot_active, false);
  assert.equal(conv.pause_reason, 'human_reply');
  await say(phone, 'تمام شكراً', sent);
  assert.equal(sent.length, 2, 'bot silent after the rep took over');
});

test('setting keep_bot_until_human = false keeps the old behaviour (silent right after handoff)', async () => {
  storage.updateSettings({ handoff: { keep_bot_until_human: false } }, { skipDbSync: true });
  const sent = [];
  const phone = '+962790000002';
  aiAnswer = { reply_text: 'تمام', buying_probability: 95, handoff_triggered: true };
  await say(phone, 'موافق', sent);
  const conv = storage.getConversationByChannelUser('whatsapp', phone);
  assert.equal(conv.is_bot_active, false);
  aiAnswer = { reply_text: 'جواب', buying_probability: 95 };
  await say(phone, 'سؤال ثاني', sent);
  assert.equal(sent.length, 1);
});
