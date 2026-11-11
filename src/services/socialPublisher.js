/**
 * Publishes a finished post (image + caption) to every connected place:
 *  - Facebook Page   (needs pages_manage_posts on the Page token)
 *  - Instagram       (needs instagram_content_publish + a public https URL for the image)
 *  - Telegram channel (optional — the bot must be an admin of the channel)
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const storageService = require('./storageService');
const telegramService = require('./telegramService');
const notificationService = require('./notificationService');

const GRAPH = 'https://graph.facebook.com/v21.0';
const errMsg = (e) => e.response?.data?.error?.message || e.message;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isPublic = (u) => /^https:\/\/(?!localhost|127\.|\[::1\])/.test(String(u || ''));

class SocialPublisher {
  /** Public https address of this server (Instagram downloads the image from it). */
  publicBaseUrl() {
    const candidates = [
      storageService.getSettings().marketing?.public_url,
      process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '',
      notificationService.getConfig().dashboardUrl
    ].map(u => String(u || '').trim().replace(/\/+$/, ''));
    return candidates.find(isPublic) || '';
  }

  /** Where each post can go right now, and why not if it can't. */
  channels() {
    const s = storageService.getSettings();
    const meta = s.meta || {};
    const mk = s.marketing || {};
    const tg = telegramService.getConfig();
    const base = this.publicBaseUrl();
    // Known only after the one-click connect; a hand-pasted token is tried as is.
    const scopes = require('./metaService').publishScopesStatus() || {};
    const fbScope = scopes.pages_manage_posts !== false;
    const igScope = scopes.instagram_content_publish !== false;
    const reconnect = ' — اضغط «سجّل دخول بفيسبوك وإنستغرام» بإعدادات الربط ووافق على صلاحية النشر';
    return {
      facebook: {
        label: 'فيسبوك', enabled: mk.publish_facebook !== false,
        ready: !!(meta.page_access_token && meta.page_id && fbScope),
        note: !(meta.page_access_token && meta.page_id) ? 'اربط صفحة فيسبوك («سجّل دخول بفيسبوك وإنستغرام» بإعدادات الربط)'
          : !fbScope ? `ناقص صلاحية pages_manage_posts${reconnect}` : ''
      },
      instagram: {
        label: 'إنستغرام', enabled: mk.publish_instagram !== false,
        ready: !!(meta.page_access_token && meta.instagram_account_id && base && igScope),
        note: !meta.instagram_account_id ? 'ما في حساب إنستغرام أعمال مربوط بالصفحة'
          : !igScope ? `ناقص صلاحية instagram_content_publish${reconnect}`
            : !base ? 'إنستغرام بيحتاج رابط عام https للسيرفر (بيشتغل تلقائياً على Railway، أو اكتب الرابط العام بالإعدادات)' : ''
      },
      telegram: {
        label: 'قناة تليجرام', enabled: mk.publish_telegram_channel === true,
        ready: !!(tg.token && tg.channelId),
        note: tg.token && tg.channelId ? '' : 'اكتب معرّف القناة وخلّي البوت أدمن فيها'
      }
    };
  }

  async toFacebook(filePath, caption) {
    const meta = storageService.getSettings().meta || {};
    const form = new FormData();
    form.append('source', new Blob([fs.readFileSync(filePath)], { type: 'image/jpeg' }), path.basename(filePath));
    form.append('caption', caption);
    form.append('access_token', meta.page_access_token);
    const res = await axios.post(`${GRAPH}/${meta.page_id}/photos`, form, { timeout: 90000, maxBodyLength: Infinity });
    const postId = res.data?.post_id || res.data?.id;
    return { id: postId, url: postId ? `https://www.facebook.com/${postId}` : '' };
  }

  async toInstagram(fileName, caption) {
    const meta = storageService.getSettings().meta || {};
    const token = meta.page_access_token;
    const ig = meta.instagram_account_id;
    const imageUrl = `${this.publicBaseUrl()}/media/${fileName}`;
    const container = (await axios.post(`${GRAPH}/${ig}/media`, null, {
      params: { image_url: imageUrl, caption: caption.slice(0, 2200), access_token: token }, timeout: 60000
    })).data?.id;
    // Wait until Instagram finished downloading the image.
    for (let i = 0; i < 10; i++) {
      const st = (await axios.get(`${GRAPH}/${container}`, { params: { fields: 'status_code,status', access_token: token }, timeout: 20000 })).data || {};
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram رفض الصورة: ${st.status || st.status_code}`);
      await sleep(3000);
    }
    const id = (await axios.post(`${GRAPH}/${ig}/media_publish`, null, { params: { creation_id: container, access_token: token }, timeout: 60000 })).data?.id;
    let url = '';
    try {
      url = (await axios.get(`${GRAPH}/${id}`, { params: { fields: 'permalink', access_token: token }, timeout: 15000 })).data?.permalink || '';
    } catch { /* optional */ }
    return { id, url };
  }

  async toTelegramChannel(filePath, caption) {
    const { channelId } = telegramService.getConfig();
    const msg = await telegramService.sendPhoto(filePath, caption, channelId);
    const user = msg?.chat?.username;
    return { id: String(msg?.message_id || ''), url: user ? `https://t.me/${user}/${msg.message_id}` : '' };
  }

  /**
   * Publish to every enabled + ready channel. `only` limits it (used for retries).
   * Returns { facebook: { ok, id, url, error }, ... } for the channels that were attempted.
   */
  async publish({ filePath, fileName, caption }, only = null) {
    const ch = this.channels();
    const results = {};
    const run = async (key, fn) => {
      if (only && !only.includes(key)) return;
      if (!ch[key].enabled) return;
      if (!ch[key].ready) { results[key] = { ok: false, skipped: true, error: ch[key].note }; return; }
      try {
        results[key] = { ok: true, ...(await fn()), at: new Date().toISOString() };
      } catch (e) {
        let m = errMsg(e);
        if (/permission|\(#200\)|\(#10\)|OAuth/i.test(m)) {
          m += key === 'facebook' ? ' — الرمز ناقصه صلاحية pages_manage_posts' : key === 'instagram' ? ' — الرمز ناقصه صلاحية instagram_content_publish' : '';
        }
        results[key] = { ok: false, error: m };
        console.error(`[Publish] ${key} failed:`, m);
      }
    };
    await run('facebook', () => this.toFacebook(filePath, caption));
    await run('instagram', () => this.toInstagram(fileName, caption));
    await run('telegram', () => this.toTelegramChannel(filePath, caption));
    return results;
  }
}

module.exports = new SocialPublisher();
