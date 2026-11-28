const { fake, reset, calls } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../src/services/storageService');
const replyEngine = require('../src/services/replyEngine');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let releaseFirstReply;
let firstReplyStarted;
let generationCount;

function setupDelayedAi() {
  const holdFirst = new Promise(resolve => { releaseFirstReply = resolve; });
  firstReplyStarted = new Promise(resolve => { firstReplyStartedResolve = resolve; });
  generationCount = 0;
  fake('post', /openrouter\.ai/, async () => {
    generationCount += 1;
    if (generationCount === 1) {
      firstReplyStartedResolve();
      await holdFirst;
    }
    return { choices: [{ message: { content: JSON.stringify({ reply_text: `answer-${generationCount}`, buying_probability: 30 }) } }] };
  });
}

let firstReplyStartedResolve;

test.beforeEach(() => {
  reset();
  setupDelayedAi();
  storage.updateSettings({
    ai: { openrouter_api_key: 'sk-or-test', provider: 'openrouter' },
    bot: { reply_delay_seconds: 0, typing_indicator: false, pause_on_human_reply: true, human_pause_hours: 0 },
    business_hours: { enabled: false }
  }, { skipDbSync: true });
});

test.afterEach(() => {
  releaseFirstReply?.();
  releaseFirstReply = null;
});

async function waitForIdle() {
  for (let i = 0; i < 100; i++) {
    if (replyEngine.pending.size === 0) return;
    await sleep(10);
  }
  assert.equal(replyEngine.pending.size, 0, 'reply engine returned to idle');
}

function adapter(sent) {
  return { isReady: () => true, send: async (_conv, text) => { sent.push(text); return { ok: true }; } };
}

test('a new customer message during AI generation is included before the bot sends its answer', async () => {
  const sent = [];
  const channelAdapter = adapter(sent);
  await replyEngine.ingest({ channel: 'whatsapp', externalUserId: '+962790000101', customerName: 'عميل', text: 'كم السعر؟', adapter: channelAdapter });
  await firstReplyStarted;
  await replyEngine.ingest({ channel: 'whatsapp', externalUserId: '+962790000101', customerName: 'عميل', text: 'وهل يوجد اشتراك شهري؟', adapter: channelAdapter });
  releaseFirstReply();
  await waitForIdle();

  assert.equal(generationCount, 2, 'the stale draft is discarded and regenerated');
  assert.deepEqual(sent, ['answer-2'], 'only the regenerated answer is sent');
  const secondPrompt = JSON.stringify(calls.filter(c => /openrouter\.ai/.test(c.url))[1]?.body?.messages || []);
  assert.match(secondPrompt, /كم السعر\؟/);
  assert.match(secondPrompt, /اشتراك شهري/);
});

test('human takeover while the model is thinking invalidates the pending bot response', async () => {
  const sent = [];
  const channelAdapter = adapter(sent);
  await replyEngine.ingest({ channel: 'whatsapp', externalUserId: '+962790000102', customerName: 'عميل', text: 'أريد التحدث مع المبيعات', adapter: channelAdapter });
  await firstReplyStarted;
  const conv = storage.getConversationByChannelUser('whatsapp', '+962790000102');
  replyEngine.recordHumanMessage(conv.id, 'أهلاً، معك فريق المبيعات', 'staff-message-1');
  releaseFirstReply();
  await waitForIdle();

  assert.deepEqual(sent, [], 'the old AI response must not race the employee');
  assert.equal(storage.getConversationById(conv.id).is_bot_active, false);
});

test('customer summary adds new facts without replacing earlier facts', async () => {
  const conv = storage.saveConversation({
    id: 'summary-preservation', channel: 'whatsapp', external_user_id: '+962790000103',
    customer_name: 'عميل', customer_summary: 'يدير متجراً للأقمشة في عمّان.', messages: []
  });
  await replyEngine.applyAiState(conv, {
    customer_summary: 'يريد زيادة المبيعات عبر واتساب.',
    customer_requests: '',
    buying_probability: 25,
    lead_stage: 'discovery',
    classification: 'Warm'
  }, false);

  const saved = storage.getConversationById(conv.id);
  assert.match(saved.customer_summary, /متجراً للأقمشة/);
  assert.match(saved.customer_summary, /زيادة المبيعات عبر واتساب/);
});
