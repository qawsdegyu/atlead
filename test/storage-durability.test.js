const { reset } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../src/services/storageService');
const { dataDir } = require('./helpers');

test.beforeEach(() => reset());

test('a failed local write is surfaced and does not replace the cached or on-disk customer record', () => {
  const conv = storage.saveConversation({
    id: 'durability-check', channel: 'whatsapp', external_user_id: '+962790000201', customer_name: 'اسم محفوظ', messages: []
  });
  const filePath = path.join(dataDir, 'conversations.json');
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function (file, ...args) {
    if (String(file).includes('conversations.json')) throw new Error('disk full');
    return originalWrite.call(this, file, ...args);
  };
  try {
    assert.throws(() => storage.saveConversation({ id: conv.id, customer_name: 'تغيير غير محفوظ' }), /Could not persist conversations\.json/);
  } finally {
    fs.writeFileSync = originalWrite;
  }

  assert.equal(storage.getConversationById(conv.id).customer_name, 'اسم محفوظ');
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(onDisk.find(item => item.id === conv.id).customer_name, 'اسم محفوظ');

  fs.writeFileSync = function (file, ...args) {
    if (String(file).endsWith('state.json') || String(file).endsWith('state.json.tmp')) throw new Error('disk full');
    return originalWrite.call(this, file, ...args);
  };
  try {
    assert.throws(() => storage.getState('first-read'), /Could not persist state\.json/);
  } finally {
    fs.writeFileSync = originalWrite;
  }
});
