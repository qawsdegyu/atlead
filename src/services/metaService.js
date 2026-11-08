/**
 * Meta Graph API — Facebook Messenger, Instagram DM, and post comments (FB + IG).
 *
 * DMs:      routed through replyEngine (10s delay, typing indicator, quoted reply).
 * Comments: after the delay, the bot replies publicly under the comment
 *           ("رح نتواصل معك على الخاص") and, if it's a business inquiry, sends a
 *           Private Reply DM to the commenter. That DM opens a conversation in the
 *           inbox, so the bot keeps the chat going privately.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');
const aiService = require('./aiService');
const replyEngine = require('./replyEngine');
const crmService = require('./crmService');
const notificationService = require('./notificationService');

const GRAPH_API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const UPLOADS_DIR = storageService.getUploadsDir();

const metaConfig = () => storageService.getSettings().meta || {};
const ECHO_SETTLE_MS = Number(process.env.ECHO_SETTLE_MS || 3000);

class MetaService {
  async testConnection(tokenOverride = null) {
    const token = tokenOverride || metaConfig().page_access_token;
    if (!token) {
      return { success: false, message: 'رمز الوصول الخاص بصفحة فيسبوك/إنستغرام (Page Access Token) غير مدخل.' };
    }

    try {
      const identity = await this.getPageIdentity(token);
      const response = { data: identity };
      const ig = identity.instagram_business_account;
      // Auto-fill IDs if they're empty
      const cfg = metaConfig();
      const patch = {};
      if (!cfg.page_id && response.data.id) patch.page_id = response.data.id;
      if (!cfg.instagram_account_id && ig?.id) patch.instagram_account_id = ig.id;
      if (ig?.username) patch.instagram_username = ig.username;
      if (Object.keys(patch).length && !tokenOverride) storageService.updateSettings({ meta: { ...patch, _ids_checked: true } });
      let subNote = '';
      if (!tokenOverride) {
        const sub = await this.subscribePage();
        subNote = sub.success ? ' — تم اشتراك الصفحة بالرسائل والتعليقات ✅' : ` — ⚠️ تعذر اشتراك الصفحة بالويب هوك: ${sub.message}`;
      }

      return {
        success: true,
        message: `تم الاتصال بنجاح بصفحة: ${response.data.name || 'الصفحة'} (ID: ${response.data.id})${ig ? ` + إنستغرام @${ig.username}` : identity.igError ? ' — (ما قدرنا نقرأ حساب الإنستغرام: الرمز ناقصه صلاحية pages_read_engagement / instagram_basic — الماسنجر شغال عادي)' : ' — لا يوجد حساب إنستغرام أعمال مربوط بالصفحة'}${subNote}`,
        data: response.data
      };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      const code = err.response?.data?.error?.code;
      // A Messenger-only page token can't read the Page node (needs pages_read_engagement),
      // but it CAN reply to messages. If we know the Page ID, verify what matters instead:
      // subscribing the Page to the webhook (pages_manage_metadata).
      const cfg = metaConfig();
      if (code !== 190 && cfg.page_id && !tokenOverride) {
        const sub = await this.subscribePage();
        if (sub.success) {
          storageService.updateSettings({ meta: { _ids_checked: true } });
          return {
            success: true,
            message: `✅ الماسنجر مربوط: الصفحة ${cfg.page_id} مشتركة بالرسائل والبوت بيقدر يرد. ⚠️ الرمز ناقصه صلاحية pages_read_engagement، فقراءة التعليقات وربط الإنستغرام ما رح يشتغلوا لحد ما تعمل رمز جديد فيه هاي الصلاحية.`
          };
        }
        return { success: false, message: `فشل الاتصال بـ Meta: ${msg} — ومحاولة اشتراك الصفحة فشلت كمان: ${sub.message}` };
      }
      if (code === 190) return { success: false, message: `الرمز غير صالح أو منتهي — أنشئ رمز جديد. (${msg})` };
      return { success: false, message: `فشل الاتصال بـ Meta Graph API: ${msg}${cfg.page_id ? '' : ' — اكتب Page ID بالخانة واضغط فحص الاتصال مرة ثانية.'}` };
    }
  }

  /**
   * Page id/name (+ linked Instagram when the token is allowed to read it).
   * Reading the Instagram link needs extra permissions (pages_read_engagement /
   * instagram_basic); a Messenger-only token must still work, so fall back gracefully.
   */
  async getPageIdentity(token) {
    const get = (fields) => axios.get(`${GRAPH}/me`, { params: { access_token: token, fields }, timeout: 10000 });
    try {
      return (await get('id,name,instagram_business_account{id,username}')).data;
    } catch (err) {
      const igError = err.response?.data?.error?.message || err.message;
      if (err.response?.data?.error?.code === 190) throw err; // invalid/expired token
      try {
        return { ...(await get('id,name')).data, igError };
      } catch {
        return { ...(await get('id')).data, igError };
      }
    }
  }

  isOwnAccount(id) {
    const cfg = metaConfig();
    return !!id && (id === cfg.page_id || id === cfg.instagram_account_id || id === cfg.instagram_username);
  }

  /**
   * Make sure we know our own Page ID + Instagram account ID. Without them the bot
   * could treat its own public comment replies as new comments and loop forever.
   */
  async ensureOwnIds() {
    const cfg = metaConfig();
    if (!cfg.page_access_token || (cfg.page_id && cfg._ids_checked)) return;
    if (this._idsPromise) return this._idsPromise;
    this._idsPromise = (async () => {
      try {
        const res = { data: await this.getPageIdentity(cfg.page_access_token) };
        const ig = res.data.instagram_business_account;
        storageService.updateSettings({ meta: {
          // The token's own page is the source of truth.
          page_id: res.data.id,
          instagram_account_id: ig?.id || cfg.instagram_account_id || '',
          instagram_username: ig?.username || cfg.instagram_username || '',
          _ids_checked: true
        } });
      } catch (err) {
        console.warn('[Meta] Could not read own page/IG ids:', err.response?.data?.error?.message || err.message);
        // Page ID already known (typed/saved) → don't retry on every message.
        if (cfg.page_id && err.response?.data?.error?.code !== 190) storageService.updateSettings({ meta: { _ids_checked: true } });
      } finally {
        this._idsPromise = null;
      }
    })();
    return this._idsPromise;
  }

  // Subscribe the Page to the webhook fields the bot needs (messages + comments).
  async subscribePage() {
    const cfg = metaConfig();
    if (!cfg.page_access_token || !cfg.page_id) return { success: false, message: 'Page token / Page ID غير متوفر' };
    try {
      await axios.post(`${GRAPH}/${cfg.page_id}/subscribed_apps`, null, {
        params: { access_token: cfg.page_access_token, subscribed_fields: 'messages,messaging_postbacks,message_echoes,feed' },
        timeout: 10000
      });
      return { success: true };
    } catch (err) {
      return { success: false, message: err.response?.data?.error?.message || err.message };
    }
  }

  async getPageSubscription() {
    const cfg = metaConfig();
    const res = await axios.get(`${GRAPH}/${cfg.page_id}/subscribed_apps`, { params: { access_token: cfg.page_access_token }, timeout: 10000 });
    const fields = new Set();
    for (const app of res.data.data || []) for (const f of app.subscribed_fields || []) fields.add(typeof f === 'string' ? f : f.name);
    return [...fields];
  }

  // ---------------------------------------------------------------------------
  // DIRECT MESSAGES
  // ---------------------------------------------------------------------------
  async handleIncomingMessage(channel, senderId, messageData) {
    await this.ensureOwnIds();
    if (this.isOwnAccount(senderId)) return { success: true, ignored: true };

    let incomingText = messageData.text || '';
    let isVoice = false;
    let voiceTranscript = null;
    let mediaUrl = null;
    let mediaType = null;

    const attachment = messageData.attachments?.[0];
    if (attachment?.type === 'audio') {
      isVoice = true;
      const localPath = await this.downloadToUploads(attachment.payload?.url, 'meta_voice');
      if (localPath) {
        mediaUrl = `/uploads/${path.basename(localPath)}`;
        if (storageService.getSettings().ai?.voice_transcription_enabled !== false) {
          voiceTranscript = await aiService.transcribeAudio(localPath, 'audio/mp4');
        }
      }
      incomingText = voiceTranscript || 'رسالة صوتية من العميل';
    } else if (messageData.sticker_id) {
      incomingText = messageData.text || '👍'; // Messenger "like" button arrives as a sticker image
    } else if (attachment?.type === 'image') {
      mediaType = 'image';
      const localPath = await this.downloadToUploads(attachment.payload?.url, 'meta_img', 'jpg');
      let description = null;
      if (localPath) {
        mediaUrl = `/uploads/${path.basename(localPath)}`;
        description = await aiService.describeImage(localPath, 'image/jpeg');
      }
      incomingText = aiService.imageMessageText(messageData.text || '', description);
    } else if (!incomingText && attachment) {
      incomingText = attachment.type === 'video' ? '(فيديو)' : attachment.type === 'sticker' || messageData.sticker_id ? '👍' : '(ملف مرفق)';
    }
    if (!incomingText) return { success: true, ignored: true };

    const senderName = await this.fetchUserName(channel, senderId);

    return replyEngine.ingest({
      channel,
      externalUserId: senderId,
      customerName: senderName || (channel === 'instagram_dm' ? 'متابع إنستغرام' : 'مستخدم فيسبوك'),
      customerHandle: senderName && channel === 'instagram_dm' ? `@${senderName}` : '',
      text: incomingText,
      externalMessageId: messageData.mid || null,
      isVoice,
      mediaType,
      mediaUrl,
      voiceTranscript,
      adapter: this.getAdapter(channel)
    });
  }

  async fetchUserName(channel, userId) {
    const token = metaConfig().page_access_token;
    if (!token) return null;
    try {
      const fields = channel === 'instagram_dm' ? 'username,name' : 'first_name,last_name';
      const res = await axios.get(`${GRAPH}/${userId}`, { params: { access_token: token, fields }, timeout: 8000 });
      return res.data.username || res.data.name || [res.data.first_name, res.data.last_name].filter(Boolean).join(' ') || null;
    } catch {
      return null;
    }
  }

  getAdapter(channel) {
    return {
      isReady: () => !!metaConfig().page_access_token,
      send: async (conv, text, { quoted } = {}) => {
        const res = await this.sendDirectMessage(channel, conv.external_user_id, text, quoted?.external_message_id || null);
        return res;
      },
      typing: async (conv) => {
        await this.senderAction(conv.external_user_id, 'mark_seen');
        await this.senderAction(conv.external_user_id, 'typing_on');
      }
    };
  }

  async senderAction(recipientId, action) {
    const token = metaConfig().page_access_token;
    if (!token) return;
    try {
      await axios.post(`${GRAPH}/me/messages`, { recipient: { id: recipientId }, sender_action: action }, {
        params: { access_token: token }, timeout: 8000
      });
    } catch { /* optional */ }
  }

  /**
   * Send a DM. If replyToMid is given, the message is sent as a reply to that
   * message (quoted bubble). Falls back to a normal message if the API rejects it.
   */
  async sendDirectMessage(channel, recipientId, text, replyToMid = null) {
    const token = metaConfig().page_access_token;
    if (!token) {
      console.warn('Meta Page Access Token not configured. Simulated send:', text);
      return { ok: false, simulated: true };
    }

    const base = { recipient: { id: recipientId }, message: { text }, messaging_type: 'RESPONSE' };
    const attempt = async (body) => axios.post(`${GRAPH}/me/messages`, body, { params: { access_token: token }, timeout: 10000 });

    try {
      const res = await attempt(replyToMid ? { ...base, reply_to: { mid: replyToMid } } : base);
      this.rememberSent(res.data?.message_id, text);
      return { ok: true, external_message_id: res.data?.message_id || null };
    } catch (err) {
      if (replyToMid) {
        console.warn('Quoted reply rejected by Meta, sending as normal message:', err.response?.data?.error?.message || err.message);
        try {
          const res = await attempt(base);
          this.rememberSent(res.data?.message_id, text);
          return { ok: true, external_message_id: res.data?.message_id || null };
        } catch (err2) {
          console.error('Error sending Meta DM:', err2.response?.data || err2.message);
          return { ok: false };
        }
      }
      console.error('Error sending Meta DM:', err.response?.data || err.message);
      return { ok: false };
    }
  }

  async downloadToUploads(url, prefix, ext = 'm4a') {
    if (!url) return null;
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
      if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      const filePath = path.join(UPLOADS_DIR, `${prefix}_${Date.now()}.${ext}`);
      fs.writeFileSync(filePath, Buffer.from(res.data));
      return filePath;
    } catch (err) {
      console.error('Error downloading Meta media:', err.message);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // STAFF REPLIES FROM META INBOX / INSTAGRAM APP (message echoes)
  // ---------------------------------------------------------------------------
  rememberSent(mid, text) {
    if (!this._sent) this._sent = new Map();
    const key = mid || `text:${String(text).trim()}`;
    this._sent.set(key, Date.now());
    if (this._sent.size > 3000) this._sent.delete(this._sent.keys().next().value);
  }

  /**
   * Every message the Page sends comes back as an "echo". If it wasn't sent by the
   * bot/dashboard, a staff member typed it in Meta Business Suite / the IG app →
   * save it in the conversation and pause the bot for that customer.
   */
  async handleEcho(channel, customerId, message) {
    if (!customerId || this.isOwnAccount(customerId)) return { ignored: true };
    const text = message.text || (message.attachments?.length ? '(مرفق من الموظف)' : '');
    if (!text) return { ignored: true };
    // Our API response (with the message id) can arrive after the echo — give it a moment.
    await new Promise(r => setTimeout(r, ECHO_SETTLE_MS));

    const conv = storageService.getConversationByChannelUser(channel, customerId);
    if (!conv) return { ignored: true, reason: 'not a known customer' };
    if (message.mid && (this._sent?.has(message.mid) || storageService.findMessageByExternalId(conv.id, message.mid))) {
      return { ignored: true, reason: 'sent by bot' };
    }
    // Fallback: same text sent by the bot/dashboard in the last 5 minutes = ours.
    const recentOwn = (conv.messages || []).slice(-10).some(m =>
      (m.sender === 'bot' || m.sender === 'agent') && m.content.trim() === text.trim() &&
      Date.now() - new Date(m.created_at).getTime() < 5 * 60 * 1000);
    if (recentOwn || this._sent?.has(`text:${text.trim()}`)) return { ignored: true, reason: 'sent by bot' };

    replyEngine.recordHumanMessage(conv.id, text, message.mid || null, channel === 'instagram_dm' ? 'تطبيق إنستغرام' : 'صندوق رسائل فيسبوك');
    return { recorded: true };
  }

  // ---------------------------------------------------------------------------
  // COMMENTS (Facebook + Instagram)
  // ---------------------------------------------------------------------------
  /**
   * commentData: { comment_id, post_id, from: {id, name|username}, message }
   * Saves the comment immediately, then replies after the configured delay.
   */
  async handleIncomingComment(platform, commentData, { simulated = false } = {}) {
    const { comment_id, post_id, from, message } = commentData;
    if (!comment_id || !message) return { success: true, ignored: true };
    if (!simulated) await this.ensureOwnIds();
    if (this.isOwnAccount(from?.id) || this.isOwnAccount(from?.username)) return { success: true, ignored: true, reason: 'own comment' };
    // Extra safety: never answer a comment that is exactly one of our own recent replies.
    const recentReplies = storageService.getComments().slice(0, 200).map(c => c.bot_reply_text).filter(Boolean);
    if (recentReplies.includes(String(message).trim())) return { success: true, ignored: true, reason: 'echo of bot reply' };
    if (storageService.getCommentByCommentId(comment_id)) return { success: true, duplicate: true };

    const saved = storageService.saveComment({
      platform,
      post_id,
      comment_id,
      user_id: from?.id || 'unknown',
      user_name: from?.name || from?.username || 'متابع',
      comment_text: message,
      status: 'pending',
      simulated
    });
    supabaseService.saveComment(saved).catch(() => {});

    const { delaySeconds } = replyEngine.getBotConfig();
    setTimeout(() => {
      this.processComment(platform, saved.comment_id).catch(err => console.error('[Comments] process error:', err.message));
    }, delaySeconds * 1000);

    return { success: true, scheduled: true, delay_seconds: delaySeconds, comment_id };
  }

  async processComment(platform, commentId) {
    const cfg = metaConfig();
    const comment = storageService.getCommentByCommentId(commentId);
    if (!comment || comment.status === 'done') return;

    // Customer already handed off to a human → the bot doesn't answer them anywhere.
    const dmChannel = platform === 'instagram' ? 'instagram_dm' : 'facebook_messenger';
    const handedOff = comment.user_id && comment.user_id !== 'unknown' ? storageService.getConversationByChannelUser(dmChannel, comment.user_id) : null;
    if (handedOff && handedOff.is_bot_active === false) {
      const skipped = storageService.saveComment({ comment_id: commentId, status: 'skipped', processed_at: new Date().toISOString(), conversation_id: handedOff.id });
      await supabaseService.saveComment(skipped);
      notificationService.notifyNewMessageAfterHandoff(handedOff, `💬 تعليق على منشور: ${comment.comment_text}`).catch(() => {});
      return skipped;
    }

    const analysis = await aiService.analyzeComment(comment.comment_text, { userName: comment.user_name, platform });
    const hasToken = !!cfg.page_access_token;
    const patch = {
      comment_id: commentId,
      sentiment: analysis.sentiment,
      is_interested: analysis.is_interested,
      bot_reply_text: analysis.public_reply,
      status: 'done',
      processed_at: new Date().toISOString()
    };

    // 1. Public reply under the comment
    if (cfg.auto_reply_comments !== false && analysis.public_reply) {
      const ok = comment.simulated || !hasToken ? false : await this.replyToCommentPublicly(platform, commentId, analysis.public_reply);
      patch.public_reply_sent = ok;
    }

    // 2. Private DM to interested commenters
    if (analysis.is_interested && cfg.auto_dm_on_interest !== false && analysis.auto_dm) {
      let recipientId = null;
      if (!comment.simulated && hasToken) {
        recipientId = await this.sendPrivateReply(commentId, analysis.auto_dm);
      }
      if (recipientId || comment.simulated || !hasToken) {
        patch.dm_triggered = true;
        patch.dm_sent_at = new Date().toISOString();
        patch.dm_text = analysis.auto_dm;
        if (!recipientId) patch.dm_simulated = true;

        // Open (or continue) the private conversation in the inbox.
        const channel = platform === 'instagram' ? 'instagram_dm' : 'facebook_messenger';
        const userId = recipientId || comment.user_id;
        const conv = storageService.getConversationByChannelUser(channel, userId) || storageService.saveConversation({
          channel,
          external_user_id: userId,
          customer_name: comment.user_name,
          customer_handle: platform === 'instagram' ? `@${comment.user_name}` : '',
          lead_stage: 'discovery',
          classification: 'Warm',
          interest_score: 55,
          is_bot_active: true,
          source: 'comment',
          source_comment_id: commentId
        });
        const dmMsg = storageService.addMessage(conv.id, {
          sender: 'bot',
          content: analysis.auto_dm,
          external_message_id: recipientId ? this._lastPrivateReplyMid : null,
          reply_to_content: `💬 تعليق على المنشور: ${comment.comment_text}`,
          reply_to_sender: 'comment',
          delivery_status: recipientId ? 'sent' : 'simulated'
        });
        if (!conv.customer_requests) {
          storageService.saveConversation({ id: conv.id, customer_requests: `تعليق: ${comment.comment_text}` });
        }
        await supabaseService.saveConversation(storageService.getConversationById(conv.id));
        supabaseService.saveMessage(dmMsg, conv.id).catch(() => {});
        crmService.upsertLead(conv.id).catch(() => {});
        patch.conversation_id = conv.id;
      }
    }

    const updated = storageService.saveComment(patch);
    await supabaseService.saveComment(updated);
    return updated;
  }

  // FB: POST /{comment-id}/comments   IG: POST /{ig-comment-id}/replies
  async replyToCommentPublicly(platform, commentId, replyText) {
    const token = metaConfig().page_access_token;
    if (!token) return false;
    const edge = platform === 'instagram' ? 'replies' : 'comments';
    try {
      await axios.post(`${GRAPH}/${commentId}/${edge}`, { message: replyText }, { params: { access_token: token }, timeout: 10000 });
      return true;
    } catch (err) {
      console.error('Error replying to comment publicly:', err.response?.data || err.message);
      return false;
    }
  }

  // Private Reply (works for both FB and IG comments with a Page token). Returns the recipient id.
  async sendPrivateReply(commentId, dmText) {
    const cfg = metaConfig();
    const token = cfg.page_access_token;
    if (!token) return null;
    try {
      const res = await axios.post(`${GRAPH}/${cfg.page_id || 'me'}/messages`, {
        recipient: { comment_id: commentId },
        message: { text: dmText }
      }, { params: { access_token: token }, timeout: 10000 });
      this.rememberSent(res.data?.message_id, dmText);
      this._lastPrivateReplyMid = res.data?.message_id || null;
      return res.data?.recipient_id || null;
    } catch (err) {
      console.error('Error sending private reply from comment:', err.response?.data || err.message);
      return null;
    }
  }
}

module.exports = new MetaService();
