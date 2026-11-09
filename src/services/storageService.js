const fs = require('fs');
const path = require('path');

// Persistent storage: DATA_DIR env, or the Railway volume automatically, else ./data.
// On Vercel the project folder is read-only: /tmp is the only writable place (temporary!).
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const CUSTOM_DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || (IS_SERVERLESS ? path.join(require('os').tmpdir(), 'atlead-data') : '');
const DATA_DIR = CUSTOM_DATA_DIR ? path.resolve(CUSTOM_DATA_DIR) : path.join(__dirname, '../../data');
// Voice notes / images: inside the volume in production so they survive redeploys.
const UPLOADS_DIR = CUSTOM_DATA_DIR ? path.join(DATA_DIR, 'uploads') : path.join(__dirname, '../../uploads');
const BACKUPS_DIR = CUSTOM_DATA_DIR ? path.join(DATA_DIR, 'backups') : path.join(__dirname, '../../backups');
for (const dir of [DATA_DIR, UPLOADS_DIR]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json'); // scheduler bookkeeping (last report, round-robin, email queue...)

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache: files are read from disk once, then served from memory.
// Every write goes to memory AND disk immediately, so nothing is lost.
const cache = new Map();

function readJsonFile(filePath, defaultValue = []) {
  if (cache.has(filePath)) return cache.get(filePath);
  try {
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filePath, defaultValue);
      return defaultValue;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    cache.set(filePath, data);
    return data;
  } catch (err) {
    // Never silently replace a corrupted file with an empty one — keep a copy for recovery.
    console.error(`Error reading ${filePath}:`, err.message);
    try { fs.copyFileSync(filePath, `${filePath}.corrupted-${Date.now()}`); } catch { /* ignore */ }
    cache.set(filePath, defaultValue);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  cache.set(filePath, data);
  const json = JSON.stringify(data, null, 2);
  try {
    // Atomic write: a crash mid-write can never leave a half-written (corrupted) file.
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, json, 'utf-8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (err) {
    try {
      fs.writeFileSync(filePath, json, 'utf-8');
      return true;
    } catch (err2) {
      console.error(`Error writing ${filePath}:`, err2.message);
      return false;
    }
  }
}

// Every change is reported here (supabaseSync listens and mirrors it to Supabase).
let changeListener = null;
const notify = (type, id) => { try { if (changeListener && id) changeListener(type, id); } catch { /* never break a write */ } };

class StorageService {
  setChangeListener(fn) {
    changeListener = fn;
  }

  getSettings() {
    return readJsonFile(SETTINGS_FILE, {});
  }

  updateSettings(newSettings, { skipDbSync = false } = {}) {
    const current = this.getSettings();
    const updated = { ...current };
    for (const [key, value] of Object.entries(newSettings || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        updated[key] = { ...(current[key] || {}), ...value };
      } else {
        updated[key] = value;
      }
    }
    writeJsonFile(SETTINGS_FILE, updated);

    // Persist all settings (API keys, tokens, channel config) to the database as well.
    if (!skipDbSync) {
      require('./supabaseService').saveSettings(updated).catch(() => {});
    }
    return updated;
  }

  getConversations() {
    return readJsonFile(CONVERSATIONS_FILE, []);
  }

  getConversationById(id) {
    const list = this.getConversations();
    return list.find(c => c.id === id);
  }

  getConversationByChannelUser(channel, externalUserId) {
    const list = this.getConversations();
    return list.find(c => c.channel === channel && c.external_user_id === externalUserId);
  }

  saveConversation(convData) {
    const list = this.getConversations();
    let index = list.findIndex(c => c.id === convData.id || (c.channel === convData.channel && c.external_user_id === convData.external_user_id));

    const now = new Date().toISOString();
    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...convData,
        updated_at: now
      };
      writeJsonFile(CONVERSATIONS_FILE, list);
      notify('conversation', list[index].id);
      return list[index];
    } else {
      const newConv = {
        ...convData, // keep extra profile fields (wa_jid, customer_summary, source...)
        id: convData.id || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        channel: convData.channel || 'whatsapp',
        external_user_id: convData.external_user_id || 'unknown',
        customer_name: convData.customer_name || 'عميل محتمل',
        customer_phone: convData.customer_phone || '',
        customer_handle: convData.customer_handle || '',
        lead_stage: convData.lead_stage || 'new',
        classification: convData.classification || 'Cold',
        interest_score: convData.interest_score ?? 0, // new customers start at 0% and rise as the AI learns more
        is_bot_active: convData.is_bot_active !== undefined ? convData.is_bot_active : true,
        handoff_at: convData.handoff_at || null,
        handoff_reason: convData.handoff_reason || null,
        messages: convData.messages || [],
        created_at: convData.created_at || now,
        updated_at: now
      };
      list.unshift(newConv);
      writeJsonFile(CONVERSATIONS_FILE, list);
      notify('conversation', newConv.id);
      return newConv;
    }
  }

  addMessage(convId, message) {
    const list = this.getConversations();
    const conv = list.find(c => c.id === convId);
    if (!conv) return null;

    if (!conv.messages) conv.messages = [];
    const newMsg = {
      id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      sender: message.sender || 'customer', // 'customer' | 'bot' | 'agent'
      content: message.content || '',
      media_type: message.media_type || 'text',
      media_url: message.media_url || null,
      is_voice: !!message.is_voice,
      voice_transcript: message.voice_transcript || null,
      audio_duration: message.audio_duration || null,
      external_message_id: message.external_message_id || null, // platform message id (wamid / mid / WA key id)
      reply_to_id: message.reply_to_id || null,                 // local id of the message this one replies to
      reply_to_content: message.reply_to_content || null,
      reply_to_sender: message.reply_to_sender || null,
      wa_raw: message.wa_raw || null,                           // raw Baileys {key, message} needed to quote it
      delivery_status: message.delivery_status || null,
      is_follow_up: !!message.is_follow_up,
      created_at: new Date().toISOString()
    };
    conv.messages.push(newMsg);
    // Raw WhatsApp payloads are only needed to quote recent messages — drop older ones to keep the file small.
    const keepRawFrom = conv.messages.length - 6;
    for (let i = 0; i < keepRawFrom; i++) {
      if (conv.messages[i].wa_raw) conv.messages[i].wa_raw = null;
    }
    conv.last_message_at = newMsg.created_at;
    conv.updated_at = newMsg.created_at;

    writeJsonFile(CONVERSATIONS_FILE, list);
    notify('conversation', convId);
    return newMsg;
  }

  updateMessage(convId, msgId, patch) {
    const list = this.getConversations();
    const conv = list.find(c => c.id === convId);
    const msg = conv?.messages?.find(m => m.id === msgId);
    if (!msg) return null;
    Object.assign(msg, patch);
    writeJsonFile(CONVERSATIONS_FILE, list);
    notify('conversation', convId);
    return msg;
  }

  findMessageByExternalId(convId, externalId) {
    if (!externalId) return null;
    const conv = this.getConversationById(convId);
    return conv?.messages?.find(m => m.external_message_id === externalId) || null;
  }

  getCommentByCommentId(commentId) {
    return this.getComments().find(c => c.comment_id === commentId) || null;
  }

  setBotActive(convId, isActive, reason = '') {
    const list = this.getConversations();
    const conv = list.find(c => c.id === convId);
    if (!conv) return null;

    conv.is_bot_active = isActive;
    if (!isActive) {
      conv.handoff_at = new Date().toISOString();
      conv.handoff_reason = reason || 'إيقاف يدوي من لوحة التحكم';
      conv.lead_stage = 'handed_off';
      conv.pause_reason = 'manual';
      conv.bot_paused_until = null;
    } else {
      // Re-enabled by staff: clear any pause so the bot answers again.
      conv.pause_reason = null;
      conv.bot_paused_until = null;
      conv.paused_at = null;
      conv.pause_source = null;
    }
    writeJsonFile(CONVERSATIONS_FILE, list);
    notify('conversation', convId);
    return conv;
  }

  // Leads
  getLeads() {
    return readJsonFile(LEADS_FILE, []);
  }

  saveLead(leadData) {
    const list = this.getLeads();
    let index = list.findIndex(l => l.id === leadData.id || (leadData.conversation_id && l.conversation_id === leadData.conversation_id));
    const now = new Date().toISOString();

    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...leadData,
        updated_at: now
      };
      writeJsonFile(LEADS_FILE, list);
      notify('lead', list[index].id);
      return list[index];
    } else {
      const newLead = {
        ...leadData,
        id: leadData.id || `lead_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        conversation_id: leadData.conversation_id || null,
        name: leadData.name || 'عميل محتمل',
        phone: leadData.phone || '',
        channel: leadData.channel || 'whatsapp',
        business_type: leadData.business_type || '',
        identified_problem: leadData.identified_problem || '',
        proposed_solution: leadData.proposed_solution || '',
        lead_stage: leadData.lead_stage || 'New',
        classification: leadData.classification || 'Cold',
        buying_probability: Number(leadData.buying_probability) || 0,
        deal_status: leadData.deal_status || 'in_progress',
        notes: leadData.notes || '',
        google_sheet_synced: !!leadData.google_sheet_synced,
        last_synced_at: leadData.last_synced_at || null,
        created_at: now,
        updated_at: now
      };
      list.unshift(newLead);
      writeJsonFile(LEADS_FILE, list);
      notify('lead', newLead.id);
      return newLead;
    }
  }

  // Comments
  // Small key/value store for background jobs.
  getState(key, fallback = null) {
    const state = readJsonFile(STATE_FILE, {});
    return state[key] !== undefined ? state[key] : fallback;
  }

  setState(key, value) {
    const state = { ...readJsonFile(STATE_FILE, {}) };
    state[key] = value;
    writeJsonFile(STATE_FILE, state);
    return value;
  }

  isServerless() {
    return IS_SERVERLESS;
  }

  getDataDir() {
    return DATA_DIR;
  }

  getUploadsDir() {
    return UPLOADS_DIR;
  }

  getBackupsDir() {
    return BACKUPS_DIR;
  }

  getComments() {
    return readJsonFile(COMMENTS_FILE, []);
  }

  saveComment(commentData) {
    const list = this.getComments();
    const index = list.findIndex(c => c.comment_id === commentData.comment_id);
    const now = new Date().toISOString();

    if (index >= 0) {
      list[index] = { ...list[index], ...commentData };
      writeJsonFile(COMMENTS_FILE, list);
      notify('comment', list[index].comment_id);
      return list[index];
    } else {
      const newComment = {
        ...commentData,
        id: `comm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        platform: commentData.platform || 'facebook',
        post_id: commentData.post_id || '',
        comment_id: commentData.comment_id || `c_${Date.now()}`,
        user_id: commentData.user_id || '',
        user_name: commentData.user_name || 'مستخدم فيسبوك/إنستا',
        comment_text: commentData.comment_text || '',
        bot_reply_text: commentData.bot_reply_text || '',
        sentiment: commentData.sentiment || 'inquiry',
        is_interested: commentData.is_interested !== undefined ? commentData.is_interested : true,
        dm_triggered: !!commentData.dm_triggered,
        dm_sent_at: commentData.dm_sent_at || null,
        created_at: now
      };
      list.unshift(newComment);
      writeJsonFile(COMMENTS_FILE, list);
      notify('comment', newComment.comment_id);
      return newComment;
    }
  }
}

module.exports = new StorageService();

