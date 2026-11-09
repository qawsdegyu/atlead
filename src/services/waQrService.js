/**
 * WhatsApp via QR code (linked device, like WhatsApp Web) using Baileys.
 * Scan the QR from the dashboard with the business phone:
 *   WhatsApp > Settings > Linked devices > Link a device.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');
const storageService = require('./storageService');
const replyEngine = require('./replyEngine');
const aiService = require('./aiService');
// Baileys (WhatsApp library) is loaded only when WhatsApp is actually used:
// keeps startup light and lets the dashboard run on serverless hosts.
let baileys = null;
let authStore = null;
let makeWASocket, DisconnectReason = {}, fetchLatestBaileysVersion, downloadMediaMessage, Browsers, normalizeMessageContent;
function loadBaileys() {
  if (baileys) return;
  if (storageService.isServerless()) {
    throw new Error('ربط واتساب بالـ QR بده سيرفر شغال دايماً (Railway) — ما بيشتغل على Vercel');
  }
  baileys = require('@whiskeysockets/baileys');
  makeWASocket = baileys.makeWASocket || baileys.default;
  ({ DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, Browsers, normalizeMessageContent } = baileys);
  authStore = require('./waAuthStore');
}
const useDbAuthState = (...a) => { loadBaileys(); return authStore.useDbAuthState(...a); };
const clearAuthState = (...a) => { loadBaileys(); return authStore.clearAuthState(...a); };
const hasSavedSession = (...a) => { loadBaileys(); return authStore.hasSavedSession(...a); };

const logger = pino({ level: 'silent' });
const UPLOADS_DIR = storageService.getUploadsDir();
const MAX_MESSAGE_AGE_SECONDS = 120; // don't answer old history synced after reconnecting

const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^00/, '');

class WaQrService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // disconnected | connecting | qr | connected
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.me = null;
    this.lastError = null;
    this.manualStop = false;
    this.reconnectTimer = null;
    this.retries = 0;
    this.sentIds = new Set();
  }

  getStatus() {
    const settings = storageService.getSettings();
    const expected = digits(settings.whatsapp?.linked_phone);
    const connectedNumber = this.me ? digits(this.me.id.split(':')[0].split('@')[0]) : null;
    return {
      status: this.status,
      qr: this.status === 'qr' ? this.qrDataUrl : null,
      pairing_code: this.status === 'qr' ? this.pairingCode : null,
      connected_number: connectedNumber,
      connected_name: this.me?.name || null,
      expected_number: expected || null,
      number_mismatch: !!(connectedNumber && expected && !connectedNumber.endsWith(expected.slice(-9))),
      last_error: this.lastError
    };
  }

  isConnected() {
    return this.status === 'connected' && !!this.sock;
  }

  async autoStart() {
    const settings = storageService.getSettings();
    if ((settings.whatsapp?.mode || 'qr') !== 'qr') return;
    if (await hasSavedSession()) {
      console.log('[WhatsApp QR] Restoring saved session...');
      this.connect().catch(err => console.error('[WhatsApp QR] autoStart error:', err.message));
    }
  }

  async connect() {
    if (this.sock && (this.status === 'connected' || this.status === 'connecting' || this.status === 'qr')) {
      return this.getStatus();
    }
    loadBaileys();
    this.manualStop = false;
    this.status = 'connecting';
    this.lastError = null;
    this.pairingCode = null;

    const { state, saveCreds } = await useDbAuthState();
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch { /* use bundled version */ }

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger,
      browser: Browsers ? Browsers.macOS('Desktop') : ['atlead', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      if (sock !== this.sock) return; // stale socket
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.status = 'qr';
        try {
          this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
        } catch (e) {
          this.lastError = e.message;
        }
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.qrDataUrl = null;
        this.pairingCode = null;
        this.retries = 0;
        this.me = sock.user || null;
        console.log(`[WhatsApp QR] Connected as ${this.me?.id}`);
        storageService.updateSettings({
          whatsapp: { qr_connected_number: this.getStatus().connected_number, qr_connected_at: new Date().toISOString() }
        });
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        this.sock = null;
        if (code === DisconnectReason.loggedOut) {
          console.log('[WhatsApp QR] Logged out from phone. Clearing session.');
          this.status = 'disconnected';
          this.me = null;
          await clearAuthState();
          storageService.updateSettings({ whatsapp: { qr_connected_number: '' } });
          return;
        }
        if (this.manualStop) {
          this.status = 'disconnected';
          return;
        }
        // QR shown but nobody scanned it in time → stop (user can press "توليد QR" again).
        if (code === DisconnectReason.timedOut && this.status === 'qr') {
          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.lastError = 'انتهت صلاحية QR بدون مسح — اضغط "توليد QR" مرة ثانية';
          return;
        }
        // Same number opened on another server/session → don't fight over it.
        if (code === DisconnectReason.connectionReplaced) {
          this.status = 'disconnected';
          this.lastError = 'تم فتح نفس الجلسة من مكان آخر (سيرفر ثاني شغال؟). شغّل نسخة وحدة بس من البوت ثم اضغط "توليد QR".';
          return;
        }
        // Corrupted / rejected session → wipe it so a fresh QR can be scanned.
        if (code === DisconnectReason.badSession || code === DisconnectReason.multideviceMismatch || code === DisconnectReason.forbidden) {
          this.status = 'disconnected';
          this.me = null;
          this.lastError = `الجلسة غير صالحة (${code}) — تم حذفها، امسح QR جديد.`;
          await clearAuthState();
          storageService.updateSettings({ whatsapp: { qr_connected_number: '' } });
          return;
        }
        // restartRequired (515) right after scanning, or a network drop: reconnect.
        this.status = 'connecting';
        this.lastError = lastDisconnect?.error?.message || null;
        const wait = code === DisconnectReason.restartRequired ? 500 : Math.min(30000, 2000 * ++this.retries);
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), wait);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          if (msg.key?.fromMe) {
            await this.recordOwnMessage(msg);
            continue;
          }
          await this.handleIncoming(msg);
        } catch (err) {
          console.error('[WhatsApp QR] incoming message error:', err.message);
        }
      }
    });

    return this.getStatus();
  }

  async requestPairingCode(phone) {
    if (!this.sock) await this.connect();
    // Wait until the socket is ready to request a code.
    for (let i = 0; i < 20 && this.status === 'connecting'; i++) await new Promise(r => setTimeout(r, 500));
    if (!this.sock || this.sock.authState?.creds?.registered) {
      throw new Error('الجهاز مربوط مسبقاً أو الاتصال غير جاهز');
    }
    const code = await this.sock.requestPairingCode(digits(phone));
    this.pairingCode = code;
    return code;
  }

  async logout() {
    if (storageService.isServerless()) return this.getStatus();
    this.manualStop = true;
    clearTimeout(this.reconnectTimer);
    try {
      if (this.sock) await this.sock.logout();
    } catch { /* ignore */ }
    try { this.sock?.end?.(); } catch { /* ignore */ }
    this.sock = null;
    this.status = 'disconnected';
    this.me = null;
    this.qrDataUrl = null;
    await clearAuthState();
    storageService.updateSettings({ whatsapp: { qr_connected_number: '' } });
    return this.getStatus();
  }

  async stop() {
    this.manualStop = true;
    clearTimeout(this.reconnectTimer);
    try { this.sock?.end?.(); } catch { /* ignore */ }
    this.sock = null;
    this.status = 'disconnected';
  }

  // -------------------------------------------------------------------------
  // INCOMING
  // -------------------------------------------------------------------------
  isPrivateChat(jid) {
    return !!jid && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));
  }

  // Real phone number of the customer. WhatsApp v7 may hide it behind a "LID" id.
  async resolvePhone(key) {
    const jid = key.remoteJid || '';
    const pnJid = [key.remoteJidAlt, key.senderPn, jid].find(j => typeof j === 'string' && j.endsWith('@s.whatsapp.net'));
    if (pnJid) return pnJid.split('@')[0].split(':')[0];
    if (jid.endsWith('@lid')) {
      try {
        const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(jid);
        if (pn) return pn.split('@')[0].split(':')[0];
      } catch { /* mapping not known yet */ }
    }
    return null;
  }

  // Finds the existing conversation for this chat (by phone or by WhatsApp jid).
  findConversationKey(jid, phone) {
    const list = storageService.getConversations().filter(c => c.channel === 'whatsapp');
    const byJid = list.find(c => c.wa_jid === jid);
    if (byJid) return byJid.external_user_id;
    if (phone && list.some(c => c.external_user_id === phone)) return phone;
    return phone || jid.split('@')[0];
  }

  // A message sent from the business phone itself (sales employee typing on WhatsApp).
  async recordOwnMessage(msg) {
    const key = msg.key || {};
    if (this.sentIds.has(key.id)) return; // sent by the bot itself
    const jid = key.remoteJid || '';
    if (!this.isPrivateChat(jid)) return;
    const content = normalizeMessageContent ? normalizeMessageContent(msg.message) : msg.message;
    const text = content?.conversation || content?.extendedTextMessage?.text || content?.imageMessage?.caption || '';
    if (!text) return;
    const phone = await this.resolvePhone(key);
    const conv = storageService.getConversationByChannelUser('whatsapp', this.findConversationKey(jid, phone));
    if (!conv || storageService.findMessageByExternalId(conv.id, key.id)) return;
    replyEngine.recordHumanMessage(conv.id, text, key.id, 'واتساب (الجوال)');
  }

  async handleIncoming(msg) {
    const key = msg.key || {};
    const jid = key.remoteJid || '';
    if (key.fromMe) return;
    if (!this.isPrivateChat(jid)) return; // groups, status, channels, broadcasts

    const ts = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp ?? 0);
    if (ts && Date.now() / 1000 - ts > MAX_MESSAGE_AGE_SECONDS) return;

    const content = normalizeMessageContent ? normalizeMessageContent(msg.message) : msg.message;
    if (!content || content.protocolMessage || content.reactionMessage || content.senderKeyDistributionMessage && Object.keys(content).length === 1) return;

    const phone = await this.resolvePhone(key);
    const externalUserId = this.findConversationKey(jid, phone);
    const name = msg.pushName || (phone ? `عميل واتساب (+${phone})` : 'عميل واتساب');

    let text = content.conversation
      || content.extendedTextMessage?.text
      || content.imageMessage?.caption
      || content.videoMessage?.caption
      || content.documentMessage?.caption
      || content.buttonsResponseMessage?.selectedDisplayText
      || content.listResponseMessage?.title
      || content.templateButtonReplyMessage?.selectedDisplayText
      || '';

    let isVoice = false;
    let mediaType = null;
    let mediaUrl = null;
    let transcript = null;

    if (content.audioMessage) {
      isVoice = true;
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: this.sock?.updateMediaMessage });
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const fileName = `wa_voice_${Date.now()}_${key.id}.ogg`;
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(filePath, buffer);
        mediaUrl = `/uploads/${fileName}`;
        const settings = storageService.getSettings();
        if (settings.ai?.voice_transcription_enabled !== false) {
          transcript = await aiService.transcribeAudio(filePath, content.audioMessage.mimetype?.split(';')[0] || 'audio/ogg');
        }
      } catch (err) {
        console.error('[WhatsApp QR] voice download error:', err.message);
      }
      text = transcript || aiService.VOICE_FAILED_TEXT;
    } else if (content.imageMessage) {
      mediaType = 'image';
      const caption = content.imageMessage.caption || '';
      let description = null;
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: this.sock?.updateMediaMessage });
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        const mime = (content.imageMessage.mimetype || 'image/jpeg').split(';')[0];
        const fileName = `wa_img_${Date.now()}_${key.id}.${mime.split('/')[1] || 'jpg'}`;
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(filePath, buffer);
        mediaUrl = `/uploads/${fileName}`;
        description = await aiService.describeImage(filePath, mime);
      } catch (err) {
        console.error('[WhatsApp QR] image download error:', err.message);
      }
      text = aiService.imageMessageText(caption, description);
    } else if (!text) {
      if (content.imageMessage) text = '(صورة)';
      else if (content.videoMessage) text = '(فيديو)';
      else if (content.documentMessage) text = '(ملف)';
      else if (content.stickerMessage) text = '(ملصق)';
      else if (content.locationMessage) text = '(موقع)';
      else if (content.contactMessage) text = '(جهة اتصال)';
      else return; // unsupported/system message
    }

    await replyEngine.ingest({
      channel: 'whatsapp',
      externalUserId,
      customerName: name,
      customerPhone: phone ? `+${phone}` : '',
      convExtra: { wa_jid: jid, wa_transport: 'qr', ...(phone ? { customer_phone: `+${phone}` } : {}) },
      text,
      externalMessageId: key.id,
      waRaw: { key: { remoteJid: key.remoteJid, id: key.id, fromMe: false, participant: key.participant }, message: msg.message },
      isVoice,
      mediaType,
      mediaUrl,
      voiceTranscript: transcript,
      adapter: this.adapter
    });
  }

  // -------------------------------------------------------------------------
  // OUTGOING (adapter used by replyEngine)
  // -------------------------------------------------------------------------
  jidFor(conv) {
    if (conv.wa_jid) return conv.wa_jid;
    return `${digits(conv.customer_phone || conv.external_user_id)}@s.whatsapp.net`;
  }

  get adapter() {
    return {
      isReady: () => this.isConnected(),
      send: async (conv, text, { quoted } = {}) => {
        if (!this.isConnected()) {
          console.warn('[WhatsApp QR] Not connected. Message not sent:', text);
          return { ok: false };
        }
        const jid = this.jidFor(conv);
        const options = {};
        if (quoted?.wa_raw?.key && quoted?.wa_raw?.message) {
          options.quoted = quoted.wa_raw; // shows as a swipe-reply on the customer's message
        }
        const sent = await this.sock.sendMessage(jid, { text }, options);
        if (sent?.key?.id) {
          this.sentIds.add(sent.key.id);
          if (this.sentIds.size > 2000) this.sentIds.delete(this.sentIds.values().next().value);
        }
        try { await this.sock.sendPresenceUpdate('paused', jid); } catch { /* ignore */ }
        return { ok: true, external_message_id: sent?.key?.id || null };
      },
      typing: async (conv) => {
        if (!this.isConnected()) return;
        const jid = this.jidFor(conv);
        try {
          await this.sock.presenceSubscribe(jid);
          await this.sock.sendPresenceUpdate('composing', jid);
        } catch { /* ignore */ }
      },
      markRead: async (conv, { quoted } = {}) => {
        if (!this.isConnected() || !quoted?.wa_raw?.key) return;
        try { await this.sock.readMessages([quoted.wa_raw.key]); } catch { /* ignore */ }
      }
    };
  }
}

module.exports = new WaQrService();
