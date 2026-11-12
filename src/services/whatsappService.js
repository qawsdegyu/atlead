/**
 * WhatsApp channel facade.
 *  - mode "qr"        -> linked device via QR code (waQrService / Baileys)  [default]
 *  - mode "cloud_api" -> official WhatsApp Cloud API (Meta) with webhook
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const storageService = require('./storageService');
const replyEngine = require('./replyEngine');
const aiService = require('./aiService');
const waQrService = require('./waQrService');

const GRAPH_API_VERSION = 'v21.0';

class WhatsAppService {
  getMode() {
    return storageService.getSettings().whatsapp?.mode || 'qr';
  }

  // Adapter for the reply engine / manual agent replies, based on the active mode.
  getAdapter() {
    return this.getMode() === 'cloud_api' ? this.cloudAdapter : waQrService.adapter;
  }

  async testConnection(phoneIdOverride = null, tokenOverride = null) {
    if (this.getMode() === 'qr' && !phoneIdOverride) {
      const st = waQrService.getStatus();
      return st.status === 'connected'
        ? { success: true, message: `واتساب مربوط عبر QR بالرقم +${st.connected_number}${st.connected_name ? ` (${st.connected_name})` : ''}` }
        : { success: false, message: 'واتساب غير مربوط حالياً. اضغط "توليد QR" وامسحه من هاتفك.' };
    }

    const settings = storageService.getSettings();
    const phoneId = phoneIdOverride || settings.whatsapp?.phone_number_id;
    const token = tokenOverride || settings.whatsapp?.access_token;

    if (!phoneId || !token) {
      return { success: false, message: 'معرف رقم واتساب (Phone Number ID) أو رمز الوصول (Access Token) غير مدخل.' };
    }

    try {
      const response = await axios.get(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      return {
        success: true,
        message: `تم التحقق بنجاح من رقم واتساب: ${response.data.display_phone_number || response.data.id} (${response.data.verified_name || 'atlead'})`,
        data: response.data
      };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      return { success: false, message: `فشل الاتصال بـ WhatsApp Cloud API: ${msg}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Cloud API webhook (only used in cloud_api mode)
  // ---------------------------------------------------------------------------
  async handleIncomingMessage(entry) {
    try {
      for (const change of entry?.changes || []) {
        const value = change.value;
        if (!value?.messages?.length) continue;

        for (const msgObj of value.messages) {
          const contact = value.contacts?.find(c => c.wa_id === msgObj.from) || value.contacts?.[0];
          const fromNumber = msgObj.from;
          const contactName = contact?.profile?.name || `عميل واتساب (${fromNumber})`;

          let incomingText = '';
          let isVoice = false;
          let voiceTranscript = null;
          let mediaUrl = null;
          let mediaType = null;

          if (msgObj.type === 'text') {
            incomingText = msgObj.text?.body || '';
          } else if (msgObj.type === 'audio' || msgObj.type === 'voice') {
            isVoice = true;
            const media = msgObj.audio || msgObj.voice;
            const audioPath = await this.downloadMedia(media?.id);
            if (audioPath) {
              mediaUrl = `/uploads/${path.basename(audioPath)}`;
              voiceTranscript = await aiService.transcribeAudio(audioPath, (media?.mime_type || 'audio/ogg').split(';')[0]);
            }
            incomingText = voiceTranscript || aiService.VOICE_FAILED_TEXT;
          } else if (msgObj.type === 'image') {
            mediaType = 'image';
            const imgPath = await this.downloadMedia(msgObj.image?.id, 'jpg');
            let description = null;
            if (imgPath) {
              mediaUrl = `/uploads/${path.basename(imgPath)}`;
              description = await aiService.describeImage(imgPath, (msgObj.image?.mime_type || 'image/jpeg').split(';')[0]);
            }
            incomingText = aiService.imageMessageText(msgObj.image?.caption || '', description);
          } else if (msgObj.type === 'button') {
            incomingText = msgObj.button?.text || '';
          } else if (msgObj.type === 'interactive') {
            incomingText = msgObj.interactive?.button_reply?.title || msgObj.interactive?.list_reply?.title || '';
          }
          if (!incomingText) continue;

          await replyEngine.ingest({
            channel: 'whatsapp',
            externalUserId: fromNumber,
            customerName: contactName,
            customerPhone: `+${fromNumber}`,
            convExtra: { wa_transport: 'cloud_api' },
            text: incomingText,
            externalMessageId: msgObj.id,
            isVoice,
            mediaType,
            mediaUrl,
            voiceTranscript,
            adapter: this.cloudAdapter
          });
        }
      }
      return { success: true };
    } catch (err) {
      console.error('WhatsApp handleIncomingMessage error:', err.message);
      return { success: false, error: err.message };
    }
  }

  get cloudAdapter() {
    const creds = () => {
      const s = storageService.getSettings().whatsapp || {};
      return { phoneId: s.phone_number_id, token: s.access_token };
    };
    return {
      isReady: () => { const c = creds(); return !!(c.phoneId && c.token); },
      send: async (conv, text, { quoted } = {}) => {
        const { phoneId, token } = creds();
        if (!phoneId || !token) {
          console.warn('WhatsApp Cloud API credentials not set. Simulated send:', text);
          return { ok: false, simulated: true };
        }
        const body = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: String(conv.external_user_id).replace(/\D/g, ''),
          type: 'text',
          text: { preview_url: /https?:\/\//.test(text), body: text } // links (e.g. the call link) show as a tappable card
        };
        if (quoted?.external_message_id) body.context = { message_id: quoted.external_message_id };
        try {
          const res = await axios.post(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`, body, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            timeout: 10000
          });
          return { ok: true, external_message_id: res.data?.messages?.[0]?.id || null };
        } catch (err) {
          console.error('Error sending WhatsApp message:', err.response?.data || err.message);
          return { ok: false };
        }
      },
      // Marks the message as read and shows the typing indicator.
      typing: async (conv, { quoted } = {}) => {
        const { phoneId, token } = creds();
        if (!phoneId || !token || !quoted?.external_message_id) return;
        try {
          await axios.post(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`, {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: quoted.external_message_id,
            typing_indicator: { type: 'text' }
          }, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
        } catch { /* optional feature */ }
      }
    };
  }

  // Backwards-compatible helper
  async sendMessage(toNumber, messageText) {
    const res = await this.getAdapter().send({ external_user_id: toNumber, customer_phone: toNumber }, messageText, {});
    return !!res?.ok;
  }

  async downloadMedia(mediaId, ext = 'ogg') {
    const token = storageService.getSettings().whatsapp?.access_token;
    if (!mediaId || !token) return null;

    try {
      const infoRes = await axios.get(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
      const downloadUrl = infoRes.data?.url;
      if (!downloadUrl) return null;

      const mediaRes = await axios.get(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'arraybuffer',
        timeout: 20000
      });

      const uploadsDir = storageService.getUploadsDir();
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      const filePath = path.join(uploadsDir, `${ext === 'ogg' ? 'voice' : 'media'}_${Date.now()}_${mediaId}.${ext}`);
      fs.writeFileSync(filePath, Buffer.from(mediaRes.data));
      return filePath;
    } catch (err) {
      console.error('Error downloading WhatsApp media:', err.message);
      return null;
    }
  }
}

module.exports = new WhatsAppService();
