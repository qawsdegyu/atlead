// #6: the bot answers only from what it knows — invented prices / numbers never reach the customer.
const { fake, reset, calls } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../src/services/storageService');
const ai = require('../src/services/aiService');

let answers;
test.beforeEach(() => {
  reset();
  storage.updateSettings({ ai: { openrouter_api_key: 'sk-or-x', provider: 'openrouter' } }, { skipDbSync: true });
  fake('post', /openrouter\.ai/, () => ({ choices: [{ message: { content: JSON.stringify(answers.shift()) } }] }));
});

const conv = { channel: 'whatsapp', messages: [], customer_name: 'سامي' };

test('an invented price is replaced by the approved pricing answer', async () => {
  answers = [{ reply_text: 'نظامنا بيبدأ من 500 دينار شهرياً', buying_probability: 40 }];
  const r = await ai.generateReply(conv, 'كم السعر؟');
  assert.doesNotMatch(r.reply_text, /500/);
  assert.match(r.reply_text, /استشارة مجانية/);
  assert.equal(r.grounding_fixed, true);
  assert.equal(calls.filter(c => /openrouter/.test(c.url)).length, 1, 'prices are never retried — straight to the safe answer');
});

test('an invented figure is rewritten once; a clean rewrite is used', async () => {
  answers = [
    { reply_text: 'عملاؤنا زادت مبيعاتهم 40% خلال شهر', buying_probability: 40 },
    { reply_text: 'أنظمتنا بتساعد على رد أسرع ومتابعة ما بتضيع. شو نوع شغلك؟', buying_probability: 40 }
  ];
  const r = await ai.generateReply(conv, 'شو بتفرق معي؟');
  assert.equal(r.reply_text, 'أنظمتنا بتساعد على رد أسرع ومتابعة ما بتضيع. شو نوع شغلك؟');
  const second = calls.filter(c => /openrouter/.test(c.url))[1];
  assert.match(JSON.stringify(second.body.messages), /40%/, 'the AI is told which numbers are not in the files');
});

test('if the rewrite still invents numbers, the honest "needs confirming" answer is sent', async () => {
  answers = [{ reply_text: 'عنا 50 عميل', buying_probability: 30 }, { reply_text: 'عنا 70 عميل', buying_probability: 30 }];
  const r = await ai.generateReply(conv, 'كم عميل عندكم؟');
  assert.match(r.reply_text, /مش متوفرة عندي بدقة/);
});

test('numbers from the files or from the customer pass untouched', async () => {
  answers = [{ reply_text: 'الاستشارة مجانية ومدتها 30 دقيقة، و50 موعد بالأسبوع رقم كبير فعلاً.', buying_probability: 50 }];
  const r = await ai.generateReply(conv, 'عنا حوالي 50 موعد بالأسبوع');
  assert.equal(r.grounding_fixed, undefined);
  assert.match(r.reply_text, /30 دقيقة/);
});

test('English customers get the English safe answer', async () => {
  answers = [{ reply_text: 'Our plans start at $299 per month', buying_probability: 40 }];
  const r = await ai.generateReply(conv, 'How much does it cost?');
  assert.match(r.reply_text, /free 30-minute online consultation/);
});
