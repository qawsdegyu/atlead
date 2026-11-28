require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../src/services/storageService');
const supabase = require('../src/services/supabaseService');

test('settings read errors are thrown, while a successful no-row query returns null', async () => {
  const originalGetClient = supabase.getClient;
  try {
    supabase.getClient = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'temporary network failure' } }) })
        })
      })
    });
    await assert.rejects(supabase.loadSettings(), /temporary network failure/);

    supabase.getClient = () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
      })
    });
    assert.equal(await supabase.loadSettings(), null, 'no row is a valid empty result, not a read failure');
  } finally {
    supabase.getClient = originalGetClient;
  }
});

test('UUID and hash caches are cleared when the configured Supabase project changes', () => {
  const oldClient = supabase._client;
  const oldClientKey = supabase._clientKey;
  try {
    storage.updateSettings({ supabase: { url: 'https://project-a.supabase.co', anon_key: 'key-a', enabled: true } }, { skipDbSync: true });
    supabase.getClient();
    supabase._convUuidCache.set('local-conversation', 'remote-a');
    supabase._lastHash.conversation.set('local-conversation', 'hash-a');
    supabase._lastHash.lead.set('lead-a', 'hash-a');
    supabase._lastHash.comment.set('comment-a', 'hash-a');

    storage.updateSettings({ supabase: { url: 'https://project-b.supabase.co', anon_key: 'key-b', enabled: true } }, { skipDbSync: true });
    supabase.getClient();

    assert.equal(supabase._convUuidCache.size, 0);
    for (const cache of Object.values(supabase._lastHash)) assert.equal(cache.size, 0);
  } finally {
    supabase._client = oldClient;
    supabase._clientKey = oldClientKey;
    supabase._clearProjectCaches();
    storage.updateSettings({ supabase: { url: '', anon_key: '', service_role_key: '', enabled: false } }, { skipDbSync: true });
  }
});
