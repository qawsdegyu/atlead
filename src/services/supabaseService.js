const { createClient } = require('@supabase/supabase-js');
const storageService = require('./storageService');

/**
 * Accepts any form people paste and returns the project URL Supabase expects:
 *   https://abc.supabase.co/rest/v1/            → https://abc.supabase.co
 *   https://supabase.com/dashboard/project/abc  → https://abc.supabase.co
 *   abc.supabase.co                              → https://abc.supabase.co
 */
function normalizeSupabaseUrl(raw) {
  if (!raw) return raw;
  let s = String(raw).trim().replace(/^["']|["']$/g, '');
  const dash = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,})/i);
  if (dash) return `https://${dash[1]}.supabase.co`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return s;
  }
}

const cleanKey = (k) => (k ? String(k).trim().replace(/^["']|["']$/g, '') : k);

class SupabaseService {
  constructor() {
    this._client = null;
    this._clientKey = null;
    this._convUuidCache = new Map(); // local conversation id -> supabase uuid
    this._lastHash = { conversation: new Map(), lead: new Map(), comment: new Map() }; // skip unchanged writes
  }

  // Normalised URL of the connected project (used to detect a switch to another database).
  currentTarget() {
    const config = storageService.getSettings().supabase || {};
    return normalizeSupabaseUrl(config.url || process.env.SUPABASE_URL) || null;
  }

  _hash(record) {
    return require('crypto').createHash('sha1').update(JSON.stringify(record)).digest('hex');
  }

  getClient() {
    const settings = storageService.getSettings();
    const config = settings.supabase || {};
    const url = normalizeSupabaseUrl(config.url || process.env.SUPABASE_URL);
    const key = cleanKey(config.service_role_key || config.anon_key || process.env.SUPABASE_KEY);

    if (!url || !key || config.enabled === false) {
      return null;
    }

    const cacheKey = `${url}|${key}`;
    if (this._client && this._clientKey === cacheKey) return this._client;

    try {
      this._client = createClient(url, key, { auth: { persistSession: false } });
      this._clientKey = cacheKey;
      return this._client;
    } catch (err) {
      console.error('Error initializing Supabase client:', err.message);
      return null;
    }
  }

  isEnabled() {
    return !!this.getClient();
  }

  async testConnection(urlOverride = null, keyOverride = null) {
    const settings = storageService.getSettings();
    const url = normalizeSupabaseUrl(urlOverride || settings.supabase?.url || process.env.SUPABASE_URL);
    const key = cleanKey(keyOverride || settings.supabase?.service_role_key || settings.supabase?.anon_key || process.env.SUPABASE_KEY);

    if (!url || !key) {
      return { success: false, message: 'رابط Supabase URL أو المفتاح غير مدخل.' };
    }

    try {
      const client = createClient(url, key, { auth: { persistSession: false } });
      const { error } = await client.from('conversations').select('id').limit(1);
      if (error && error.code !== 'PGRST116') {
        if (error.message.includes('does not exist') || error.code === '42P01' || error.code === 'PGRST205') {
          return {
            success: true,
            warning: true,
            message: 'تم الاتصال بـ Supabase بنجاح! الجداول غير منشأة بعد، يرجى تنفيذ ملف supabase_schema.sql في Supabase SQL Editor.'
          };
        }
        return { success: false, message: `فشل الاتصال: ${error.message}` };
      }
      return { success: true, message: 'تم الاتصال بقاعدة بيانات Supabase بنجاح والتحقق من الجداول!' };
    } catch (err) {
      return { success: false, message: `خطأ في الاتصال: ${err.message}` };
    }
  }

  // ---------------------------------------------------------------------------
  // SETTINGS (API keys, tokens, channel config) -> app_settings table
  // ---------------------------------------------------------------------------
  async saveSettings(settings) {
    const client = this.getClient();
    if (!client) return false;
    // The Supabase credentials themselves must stay local (needed to reach the DB).
    const { supabase, ...rest } = settings || {};
    try {
      const { error } = await client
        .from('app_settings')
        .upsert({ key: 'settings', value: rest, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) {
        console.warn('Supabase saveSettings warning:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Supabase saveSettings error:', err.message);
      return false;
    }
  }

  async loadSettings() {
    const client = this.getClient();
    if (!client) return null;
    try {
      const { data, error } = await client.from('app_settings').select('value').eq('key', 'settings').maybeSingle();
      if (error) {
        console.warn('Supabase loadSettings warning:', error.message);
        return null;
      }
      return data?.value || null;
    } catch (err) {
      console.error('Supabase loadSettings error:', err.message);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // WHATSAPP (QR) SESSION KEYS -> whatsapp_auth table
  // ---------------------------------------------------------------------------
  async getAuthKey(id) {
    const client = this.getClient();
    if (!client) return undefined;
    try {
      const { data, error } = await client.from('whatsapp_auth').select('data').eq('id', id).maybeSingle();
      if (error) return undefined;
      return data ? data.data : null;
    } catch {
      return undefined;
    }
  }

  async setAuthKeys(rows) {
    const client = this.getClient();
    if (!client || rows.length === 0) return;
    try {
      const { error } = await client.from('whatsapp_auth').upsert(
        rows.map(r => ({ id: r.id, data: r.data, updated_at: new Date().toISOString() })),
        { onConflict: 'id' }
      );
      if (error) console.warn('Supabase whatsapp_auth upsert warning:', error.message);
    } catch (err) {
      console.error('Supabase setAuthKeys error:', err.message);
    }
  }

  async deleteAuthKeys(ids) {
    const client = this.getClient();
    if (!client || ids.length === 0) return;
    try {
      await client.from('whatsapp_auth').delete().in('id', ids);
    } catch (err) {
      console.error('Supabase deleteAuthKeys error:', err.message);
    }
  }

  async clearAuth() {
    const client = this.getClient();
    if (!client) return;
    try {
      await client.from('whatsapp_auth').delete().neq('id', '');
    } catch (err) {
      console.error('Supabase clearAuth error:', err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // CONVERSATIONS / MESSAGES / LEADS / COMMENTS
  // ---------------------------------------------------------------------------

  /**
   * Upsert that tolerates an older schema: if Postgres complains about an unknown
   * column, retry with only the base columns (and remind the user to run the SQL).
   */
  async _upsert(table, record, onConflict, baseKeys) {
    const client = this.getClient();
    if (!client) return null;
    let { data, error } = await client.from(table).upsert(record, onConflict ? { onConflict } : undefined).select().single();
    if (error && (error.code === 'PGRST204' || error.code === '42703' || /column/i.test(error.message)) && baseKeys) {
      if (!this._warnedSchema) {
        console.warn('⚠️ Supabase schema is outdated — run supabase_schema.sql again in the SQL Editor.');
        this._warnedSchema = true;
      }
      const base = {};
      for (const k of baseKeys) if (k in record) base[k] = record[k];
      const conflict = onConflict && baseKeys.includes(onConflict) ? { onConflict } : undefined;
      ({ data, error } = conflict
        ? await client.from(table).upsert(base, conflict).select().single()
        : await client.from(table).insert(base).select().single());
    }
    if (error) {
      console.warn(`Supabase ${table} upsert warning:`, error.message);
      if (/row-level security/i.test(error.message) && !this._warnedKey) {
        console.warn('⚠️ SUPABASE_KEY is the public (anon/publishable) key — use the Secret / service_role key so the bot can save data.');
        this._warnedKey = true;
      }
      return null;
    }
    return data;
  }

  async saveConversation(conv) {
    if (!this.getClient() || !conv) return null;
    try {
      const record = {
        channel: conv.channel,
        external_user_id: conv.external_user_id,
        customer_name: conv.customer_name,
        customer_phone: conv.customer_phone || null,
        customer_handle: conv.customer_handle || null,
        customer_email: conv.customer_email || null,
        lead_stage: conv.lead_stage,
        classification: conv.classification,
        interest_score: conv.interest_score,
        is_bot_active: conv.is_bot_active !== false,
        handoff_at: conv.handoff_at || null,
        handoff_reason: conv.handoff_reason || null,
        last_message_at: conv.last_message_at || conv.updated_at || conv.created_at || null,
        metadata: { local_id: conv.id },
        // profile / memory
        local_id: conv.id,
        business_type: conv.business_type || null,
        customer_requests: conv.customer_requests || null,
        identified_problem: conv.identified_problem || null,
        proposed_solution: conv.proposed_solution || null,
        customer_summary: conv.customer_summary || null,
        objections: conv.objections || null,
        purchase_status: conv.purchase_status || 'not_purchased',
        human_notified_at: conv.human_notified_at || null,
        wa_jid: conv.wa_jid || null,
        wa_transport: conv.wa_transport || null,
        source: conv.source || null,
        source_comment_id: conv.source_comment_id || null,
        pause_reason: conv.pause_reason || null,
        pause_source: conv.pause_source || null,
        paused_at: conv.paused_at || null,
        bot_paused_until: conv.bot_paused_until || null,
        assigned_to_id: conv.assigned_to_id || null,
        assigned_to_name: conv.assigned_to_name || null,
        assigned_to_email: conv.assigned_to_email || null,
        assigned_at: conv.assigned_at || null,
        follow_up_count: conv.follow_up_count || 0,
        last_follow_up_at: conv.last_follow_up_at || null
      };
      const hash = this._hash(record);
      if (this._lastHash.conversation.get(conv.id) === hash && this._convUuidCache.has(conv.id)) {
        return { id: this._convUuidCache.get(conv.id), unchanged: true };
      }
      const data = await this._upsert('conversations', record, 'channel,external_user_id', BASE_CONVERSATION_KEYS);
      if (data?.id) {
        this._convUuidCache.set(conv.id, data.id);
        this._lastHash.conversation.set(conv.id, hash);
      }
      return data;
    } catch (err) {
      console.error('Supabase saveConversation error:', err.message);
      return null;
    }
  }

  async _resolveConversationUuid(convOrId) {
    const conv = typeof convOrId === 'string' ? storageService.getConversationById(convOrId) : convOrId;
    if (!conv) return null;
    if (this._convUuidCache.has(conv.id)) return this._convUuidCache.get(conv.id);
    const saved = await this.saveConversation(conv);
    return saved?.id || null;
  }

  _messageRecord(msg, conv, conversationUuid) {
    const quoted = msg.reply_to_id ? conv?.messages?.find(m => m.id === msg.reply_to_id) : null;
    return {
      conversation_id: conversationUuid,
      sender: msg.sender,
      content: msg.content || '',
      media_type: msg.media_type || 'text',
      media_url: msg.media_url || null,
      is_voice: !!msg.is_voice,
      voice_transcript: msg.voice_transcript || null,
      audio_duration_seconds: msg.audio_duration || null,
      raw_payload: { local_id: msg.id, reply_to_id: msg.reply_to_id || null },
      created_at: msg.created_at || new Date().toISOString(),
      local_id: msg.id,
      conversation_local_id: conv?.id || null,
      external_message_id: msg.external_message_id || null,
      reply_to_external_id: quoted?.external_message_id || null,
      reply_to_content: msg.reply_to_content || null,
      delivery_status: msg.delivery_status || null,
      is_follow_up: !!msg.is_follow_up
    };
  }

  /**
   * Messages are written by the sync (supabaseSync.js) in order and in batches,
   * with automatic retry. Calling this just makes sure the conversation is queued.
   */
  async saveMessage(msg, convOrId = null) {
    const convId = typeof convOrId === 'string' ? convOrId : convOrId?.id;
    if (convId) require('./supabaseSync').markDirty('conversation', convId);
    return null;
  }

  // Upsert many messages at once (chunks of 200). Returns true when all were stored.
  async saveMessagesBulk(msgs, conv, conversationUuid) {
    const client = this.getClient();
    if (!client || !msgs.length) return !!client;
    const records = msgs.map(m => this._messageRecord(m, conv, conversationUuid));
    for (let i = 0; i < records.length; i += 200) {
      let chunk = records.slice(i, i + 200);
      let { error } = await client.from('messages').upsert(chunk, { onConflict: 'local_id' });
      if (error && (error.code === 'PGRST204' || error.code === '42703' || /column/i.test(error.message))) {
        if (!this._warnedSchema) {
          console.warn('⚠️ Supabase schema is outdated — run supabase_schema.sql again in the SQL Editor.');
          this._warnedSchema = true;
        }
        chunk = chunk.map(r => { const b = {}; for (const k of BASE_MESSAGE_KEYS) if (k in r) b[k] = r[k]; return b; });
        ({ error } = await client.from('messages').insert(chunk));
      }
      if (error) {
        console.warn('Supabase messages upsert warning:', error.message);
        return false;
      }
    }
    return true;
  }

  // Row counts in Supabase (for the dashboard status).
  async countRows() {
    const client = this.getClient();
    if (!client) return null;
    const out = {};
    for (const table of ['conversations', 'messages', 'leads', 'comments']) {
      try {
        const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
        out[table] = error ? null : count;
      } catch {
        out[table] = null;
      }
    }
    return out;
  }

  async saveLead(lead) {
    if (!this.getClient() || !lead) return null;
    try {
      const record = {
        name: lead.name || 'عميل محتمل',
        phone: lead.phone || null,
        channel: lead.channel || null,
        business_type: lead.business_type || null,
        company_name: lead.company_name || null,
        consultation_booked: !!lead.consultation_requested,
        demo_requested: !!lead.demo_requested,
        identified_problem: lead.identified_problem || null,
        proposed_solution: lead.proposed_solution || null,
        lead_stage: lead.lead_stage || null,
        classification: lead.classification || null,
        buying_probability: Number(lead.buying_probability) || 0,
        deal_status: lead.deal_status || 'in_progress',
        notes: lead.notes || null,
        google_sheet_synced: !!lead.google_sheet_synced,
        last_synced_at: lead.last_synced_at || null,
        local_id: lead.id,
        conversation_local_id: lead.conversation_id || null,
        customer_handle: lead.customer_handle || null,
        customer_email: lead.customer_email || null,
        customer_requests: lead.customer_requests || null,
        customer_summary: lead.customer_summary || null,
        objections: lead.objections || null,
        purchase_status: lead.purchase_status || 'not_purchased',
        handed_off_at: lead.handed_off_at || null,
        human_notified_at: lead.human_notified_at || null,
        message_count: lead.message_count || 0,
        last_customer_message: lead.last_customer_message || null,
        first_contact_at: lead.first_contact_at || lead.created_at || null,
        assigned_to_name: lead.assigned_to_name || null,
        assigned_to_email: lead.assigned_to_email || null,
        follow_up_count: lead.follow_up_count || 0,
        purchase_status_at: lead.purchase_status_at || null
      };
      if (lead.conversation_id) {
        const uuid = await this._resolveConversationUuid(lead.conversation_id);
        if (uuid) record.conversation_id = uuid;
      }
      const hash = this._hash(record);
      if (this._lastHash.lead.get(lead.id) === hash) return { unchanged: true };
      const data = await this._upsert('leads', record, 'local_id', BASE_LEAD_KEYS);
      if (data) this._lastHash.lead.set(lead.id, hash);
      return data;
    } catch (err) {
      console.error('Supabase saveLead error:', err.message);
      return null;
    }
  }

  async saveComment(comment) {
    if (!this.getClient() || !comment) return null;
    try {
      const record = {
        platform: comment.platform,
        post_id: comment.post_id || null,
        comment_id: comment.comment_id,
        user_id: comment.user_id || null,
        user_name: comment.user_name || null,
        comment_text: comment.comment_text || '',
        bot_reply_text: comment.bot_reply_text || null,
        sentiment: comment.sentiment || 'neutral',
        is_interested: !!comment.is_interested,
        dm_triggered: !!comment.dm_triggered,
        dm_sent_at: comment.dm_sent_at || null,
        status: comment.status || 'pending',
        dm_text: comment.dm_text || null,
        public_reply_sent: !!comment.public_reply_sent,
        conversation_local_id: comment.conversation_id || null,
        processed_at: comment.processed_at || null
      };
      const hash = this._hash(record);
      if (this._lastHash.comment.get(comment.comment_id) === hash) return { unchanged: true };
      const data = await this._upsert('comments', record, 'comment_id', BASE_COMMENT_KEYS);
      if (data) this._lastHash.comment.set(comment.comment_id, hash);
      return data;
    } catch (err) {
      console.error('Supabase saveComment error:', err.message);
      return null;
    }
  }

  /**
   * Customer memory: when a customer writes and the local cache doesn't know them
   * (new server, redeploy, wiped disk), load their conversation + recent messages
   * from the database so the bot continues exactly where it stopped.
   */
  async fetchConversationWithHistory(channel, externalUserId, messageLimit = 40) {
    const client = this.getClient();
    if (!client) return null;
    try {
      const { data: row, error } = await client
        .from('conversations')
        .select('*')
        .eq('channel', channel)
        .eq('external_user_id', externalUserId)
        .maybeSingle();
      if (error || !row) return null;

      const { data: msgs } = await client
        .from('messages')
        .select('*')
        .eq('conversation_id', row.id)
        .order('created_at', { ascending: false })
        .limit(messageLimit);

      const localId = row.local_id || row.metadata?.local_id || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      this._convUuidCache.set(localId, row.id);

      return {
        id: localId,
        channel: row.channel,
        external_user_id: row.external_user_id,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone || '',
        customer_handle: row.customer_handle || '',
        customer_email: row.customer_email || '',
        lead_stage: row.lead_stage,
        classification: row.classification,
        interest_score: row.interest_score,
        is_bot_active: row.is_bot_active !== false,
        handoff_at: row.handoff_at,
        handoff_reason: row.handoff_reason,
        last_message_at: row.last_message_at,
        business_type: row.business_type || null,
        customer_requests: row.customer_requests || null,
        identified_problem: row.identified_problem || null,
        proposed_solution: row.proposed_solution || null,
        customer_summary: row.customer_summary || null,
        objections: row.objections || null,
        purchase_status: row.purchase_status || 'not_purchased',
        human_notified_at: row.human_notified_at || null,
        wa_jid: row.wa_jid || null,
        wa_transport: row.wa_transport || null,
        source: row.source || null,
        pause_reason: row.pause_reason || null,
        pause_source: row.pause_source || null,
        paused_at: row.paused_at || null,
        bot_paused_until: row.bot_paused_until || null,
        assigned_to_id: row.assigned_to_id || null,
        assigned_to_name: row.assigned_to_name || null,
        assigned_to_email: row.assigned_to_email || null,
        assigned_at: row.assigned_at || null,
        follow_up_count: row.follow_up_count || 0,
        last_follow_up_at: row.last_follow_up_at || null,
        created_at: row.created_at,
        restored_from_db: true,
        messages: (msgs || []).reverse().map(m => ({
          id: m.local_id || m.raw_payload?.local_id || `msg_db_${m.id}`,
          sender: m.sender,
          content: m.content,
          media_type: m.media_type || 'text',
          media_url: m.media_url || null,
          is_voice: !!m.is_voice,
          voice_transcript: m.voice_transcript || null,
          external_message_id: m.external_message_id || null,
          reply_to_content: m.reply_to_content || null,
          delivery_status: m.delivery_status || null,
          created_at: m.created_at
        }))
      };
    } catch (err) {
      console.error('Supabase fetchConversationWithHistory error:', err.message);
      return null;
    }
  }

  async logNotification(entry) {
    const client = this.getClient();
    if (!client) return;
    try {
      const { error } = await client.from('notification_log').insert({
        type: entry.type,
        conversation_local_id: entry.conversation_id || null,
        lead_local_id: entry.lead_id || null,
        recipients: entry.recipients || [],
        subject: entry.subject || null,
        status: entry.status || 'sent',
        error: entry.error || null
      });
      if (error) console.warn('Supabase notification_log warning:', error.message);
    } catch (err) {
      console.error('Supabase logNotification error:', err.message);
    }
  }
}

// Columns that exist in the very first schema version (used as a fallback).
const BASE_CONVERSATION_KEYS = ['channel', 'external_user_id', 'customer_name', 'customer_phone', 'customer_handle', 'lead_stage', 'classification', 'interest_score', 'is_bot_active', 'handoff_at', 'handoff_reason', 'last_message_at', 'metadata'];
const BASE_MESSAGE_KEYS = ['conversation_id', 'sender', 'content', 'media_type', 'media_url', 'is_voice', 'voice_transcript', 'audio_duration_seconds', 'raw_payload', 'created_at'];
const BASE_LEAD_KEYS = ['name', 'phone', 'channel', 'business_type', 'identified_problem', 'proposed_solution', 'lead_stage', 'classification', 'buying_probability', 'deal_status', 'notes', 'google_sheet_synced', 'last_synced_at', 'conversation_id'];
const BASE_COMMENT_KEYS = ['platform', 'post_id', 'comment_id', 'user_id', 'user_name', 'comment_text', 'bot_reply_text', 'sentiment', 'is_interested', 'dm_triggered', 'dm_sent_at'];

module.exports = new SupabaseService();
