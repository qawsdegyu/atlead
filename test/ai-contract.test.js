const { reset } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const ai = require('../src/services/aiService');
const replyEngine = require('../src/services/replyEngine');

function conversation(overrides = {}) {
  return {
    id: 'contract-conv',
    channel: 'whatsapp',
    customer_name: 'سامي',
    lead_stage: 'discovery',
    classification: 'Warm',
    interest_score: 55,
    messages: [],
    ...overrides
  };
}

test.beforeEach(() => reset());

test('invalid AI JSON never becomes a raw customer-facing response', () => {
  const result = ai.cleanAndParseJson('هذا ليس JSON', {
    fallbackReply: 'هاي المعلومة مش متوفرة عندي بدقة حالياً، وبقدر أخلي الفريق يتأكد منها.'
  });
  assert.equal(result.reply_text, 'هاي المعلومة مش متوفرة عندي بدقة حالياً، وبقدر أخلي الفريق يتأكد منها.');
  assert.equal(result.handoff_triggered, false);
  assert.equal(result.lead_stage, 'discovery');
});

test('AI state is normalized: zero is preserved and unknown enums are rejected', () => {
  const result = ai.cleanAndParseJson(JSON.stringify({
    reply_text: 'لا يوجد اهتمام حالياً',
    lead_stage: 'invented_stage',
    classification: 'Unknown',
    buying_probability: 0,
    handoff_triggered: 'true'
  }));
  assert.equal(result.buying_probability, 0);
  assert.equal(result.lead_stage, 'discovery');
  assert.equal(result.classification, 'Warm');
  assert.equal(result.handoff_triggered, true);
});

test('scheduled or call-first AI output cannot force a handoff', () => {
  const result = ai.cleanAndParseJson(JSON.stringify({
    reply_text: 'لنحدد الوقت المناسب',
    scheduling: true,
    handoff_triggered: true,
    lead_stage: 'deal_closing',
    buying_probability: 95
  }));
  assert.equal(result.scheduling, true);
  assert.equal(result.handoff_triggered, false);
});

test('applyAiState writes only valid enums and preserves an explicit zero score', async () => {
  const conv = storage.saveConversation(conversation());
  const saved = await replyEngine.applyAiState(conv, {
    reply_text: 'تمام',
    lead_stage: 'not-a-stage',
    classification: 'NotAClass',
    buying_probability: 0,
    handoff_triggered: false
  }, false);
  assert.equal(saved.lead_stage, 'discovery');
  assert.equal(saved.classification, 'Warm');
  assert.equal(saved.interest_score, 0);
});
