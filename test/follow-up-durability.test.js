const { reset } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../src/services/storageService');
const followUp = require('../src/services/followUpService');

test.beforeEach(() => {
  reset();
  storage.updateSettings({
    follow_up: { enabled: true, after_hours: 20, min_probability: 50, max_per_customer: 2, use_ai: false },
    handoff: { closing_deal_threshold_percent: 85 }
  }, { skipDbSync: true });
});

test('an unconfirmed follow-up delivery is recorded but does not count as sent', async () => {
  const customerAt = new Date(Date.now() - 21 * 3600 * 1000).toISOString();
  const conv = storage.saveConversation({
    id: 'follow-up-failed', channel: 'whatsapp', external_user_id: '+962790000501',
    customer_name: 'سارة', is_bot_active: true, interest_score: 60, follow_up_count: 0,
    messages: [
      { id: 'customer-last', sender: 'customer', content: 'مهتمة بالخدمة', created_at: customerAt },
      { id: 'bot-last', sender: 'bot', content: 'أكيد، كيف أساعدك؟', created_at: new Date(Date.now() - 20 * 3600 * 1000).toISOString() }
    ]
  });
  const adapter = { isReady: () => true, send: async () => ({ ok: false }) };

  const result = await followUp.runOnce(() => adapter, { ignoreHours: true });
  const saved = storage.getConversationById(conv.id);
  assert.equal(result.sent, 0);
  assert.equal(result.delivered, false);
  assert.equal(saved.follow_up_count, 0);
  assert.equal(saved.last_follow_up_at, undefined);
  assert.match(saved.notes, /تعذّر تأكيد تسليم/);
  assert.equal(saved.follow_up_for_message, 'customer-last', 'do not retry an externally ambiguous send blindly');
  assert.equal(saved.messages.at(-1).delivery_status, 'failed');
});
