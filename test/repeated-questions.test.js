// Regression coverage for repeated FAQ questions and cumulative customer memory.
const { fake, reset, calls } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const aiService = require('../src/services/aiService');
const knowledgeService = require('../src/services/knowledgeService');
const storageService = require('../src/services/storageService');
const replyEngine = require('../src/services/replyEngine');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForReply(conversationId) {
  for (let i = 0; i < 100; i++) {
    if (!replyEngine.pending.has(conversationId)) return;
    await sleep(25);
  }
  assert.fail(`reply did not finish for ${conversationId}`);
}

test.beforeEach(() => {
  reset();
  delete process.env.OPENROUTER_API_KEY;
  storageService.updateSettings({
    ai: { provider: 'openrouter', openrouter_api_key: '' },
    bot: { reply_delay_seconds: 0, typing_indicator: false, pause_on_human_reply: true, human_pause_hours: 0 },
    business_hours: { enabled: false }
  }, { skipDbSync: true });
});

test('a paraphrased repeat of an answered FAQ gets the approved answer without asking the old follow-up again', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify({ reply_text: 'irrelevant model reply' }) } }] }));
  const priorQuestion = 'شو هي atlead؟';
  const faq = knowledgeService.findFaqAnswer(priorQuestion);
  assert.ok(faq);

  const result = await aiService.generateReply({
    channel: 'whatsapp',
    business_type: 'تجارة أقمشة',
    messages: [
      { sender: 'customer', content: priorQuestion },
      { sender: 'bot', content: faq.a }
    ]
  }, 'مين انتو؟');

  assert.equal(result.source, 'knowledge_repeat');
  assert.match(result.reply_text, /atlead/);
  assert.doesNotMatch(result.reply_text, /شو نوع شغلك|شو طبيعة شغلك|\?؟/);
  assert.equal(calls.filter(call => /openrouter/.test(call.url)).length, 0, 'approved knowledge handles an already-answered FAQ without a model round trip');
});

test('the fallback does not ask a customer with a known business type what their business is', async () => {
  const result = await aiService.generateReply({
    channel: 'whatsapp',
    business_type: 'تجارة أقمشة',
    messages: []
  }, 'شو بتعملوا؟ شو خدماتكم؟');

  assert.equal(result.source, 'fallback');
  assert.match(result.reply_text, /بنساعد الشركات/);
  assert.doesNotMatch(result.reply_text, /شو نوع شغلك|شو طبيعة شغلك|what kind of business/i);
  assert.match(result.reply_text, /تحدي|مبيعات|متابعة/);
});

test('repeating a price question does not duplicate the extracted customer request in memory', async () => {
  const sent = [];
  const phone = '+962790000003';
  const adapter = {
    isReady: () => true,
    send: async (_conversation, text) => { sent.push(text); return { ok: true }; },
    typing: async () => {}
  };

  for (const [index, text] of ['كم السعر؟', 'كم السعر؟'].entries()) {
    await replyEngine.ingest({
      channel: 'whatsapp',
      externalUserId: phone,
      customerName: 'سامر',
      text,
      externalMessageId: `repeat-price-${index}`,
      adapter
    });
    const conversation = storageService.getConversationByChannelUser('whatsapp', phone);
    await waitForReply(conversation.id);
  }

  const conversation = storageService.getConversationByChannelUser('whatsapp', phone);
  assert.equal(conversation.customer_requests, 'استفسار عن الأسعار');
  assert.equal(sent.length, 2, 'the bot continues to answer the customer');
});
