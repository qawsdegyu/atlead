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

// The Meta app (App ID / Secret) can be set once on the server (Railway variables):
// then users only ever see "سجّل دخول بفيسبوك". Dashboard values still win if typed.
const envApp = () => ({
  app_id: String(process.env.META_APP_ID || '').trim(),
  app_secret: String(process.env.META_APP_SECRET || '').trim(),
  login_config_id: String(process.env.META_LOGIN_CONFIG_ID || '').trim()
});
const metaConfig = () => {
  const cfg = storageService.getSettings().meta || {};
  const env = envApp();
  return {
    ...cfg,
    app_id: cfg.app_id || env.app_id,
    app_secret: cfg.app_secret || env.app_secret,
    login_config_id: cfg.login_config_id || env.login_config_id
  };
};
const ECHO_SETTLE_MS = Number(process.env.ECHO_SETTLE_MS || 3000);

// Every permission the system uses (chat, comments, research, publishing).
const REQUIRED_SCOPES = {
  pages_show_list: 'عرض صفحاتك',
  business_management: 'صفحات مملوكة لـ Business Manager',
  pages_messaging: 'رسائل الماسنجر',
  pages_manage_metadata: 'الاشتراك بالويب هوك',
  pages_read_engagement: 'قراءة منشورات الصفحة',
  pages_read_user_content: 'قراءة تعليقات الفيس',
  pages_manage_engagement: 'الرد على تعليقات الفيس',
  pages_manage_posts: 'نشر البوستات على فيسبوك',
  instagram_basic: 'قراءة حساب الإنستا والمنافسين',
  instagram_manage_messages: 'رسائل الإنستا (DM)',
  instagram_manage_comments: 'الرد على تعليقات الإنستا',
  instagram_content_publish: 'نشر البوستات على إنستغرام'
};
const PUBLISH_SCOPES = ['pages_manage_posts', 'instagram_content_publish'];

class MetaService {
  get REQUIRED_SCOPES() { return REQUIRED_SCOPES; }

  /** Meta settings with the server-level app credentials filled in. */
  config() { return metaConfig(); }

  /** true when the Meta app is configured on the server (users only see the login button). */
  appManagedByServer() {
    const env = envApp();
    return !!(env.app_id && env.app_secret);
  }

  // ---- One-click connect (Facebook Login → permanent Page token, all permissions) ----
  /** Our app id: typed in the dashboard, or read from the current token. */
  async getAppId() {
    const cfg = metaConfig();
    if (cfg.app_id) return String(cfg.app_id).trim();
    if (!cfg.page_access_token) return null;
    try {
      const id = (await axios.get(`${GRAPH}/app`, { params: { access_token: cfg.page_access_token, fields: 'id' }, timeout: 10000 })).data?.id;
      if (id) storageService.updateSettings({ meta: { app_id: id } });
      return id || null;
    } catch {
      return null;
    }
  }

  /** Facebook Login dialog URL. The admin approves once; the callback stores the tokens. */
  async oauthStartUrl(redirectUri) {
    const cfg = metaConfig();
    const appId = await this.getAppId();
    if (!appId) throw new Error('اكتب App ID بإعدادات Meta (من developers.facebook.com ← تطبيقك ← App settings ← Basic).');
    if (!cfg.app_secret) throw new Error('اكتب App Secret بإعدادات Meta (بنفس الصفحة: App settings ← Basic) واضغط حفظ.');
    const state = require('crypto').randomBytes(16).toString('hex');
    storageService.setState('meta_oauth', { state, redirectUri, at: Date.now() });
    const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: 'code' });
    // Business-type apps can use a "Facebook Login for Business" configuration instead of a scope list.
    if (cfg.login_config_id) params.set('config_id', String(cfg.login_config_id).trim());
    else {
      params.set('scope', Object.keys(REQUIRED_SCOPES).join(','));
      params.set('auth_type', 'rerequest'); // ask again for anything declined before
    }
    return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params}`;
  }

  /** Callback: code → user token → long-lived → permanent Page token (saved) → webhook subscription. */
  async oauthCallback({ code, state, error_description }) {
    const saved = storageService.getState('meta_oauth') || {};
    if (error_description) throw new Error(`Facebook: ${error_description}`);
    if (!code || !state || state !== saved.state || Date.now() - (saved.at || 0) > 20 * 60 * 1000) {
      throw new Error('رابط الربط انتهى أو غير صالح — اضغط زر الربط مرة ثانية.');
    }
    storageService.setState('meta_oauth', null);
    const cfg = metaConfig();
    const appId = await this.getAppId();
    const ex = (await axios.get(`${GRAPH}/oauth/access_token`, {
      params: { client_id: appId, client_secret: cfg.app_secret, redirect_uri: saved.redirectUri, code }, timeout: 15000
    })).data;
    if (!ex?.access_token) throw new Error('Facebook ما رجّع رمز دخول');

    // Which permissions were actually granted (the admin can untick some in the dialog).
    let granted = [];
    try {
      const perms = (await axios.get(`${GRAPH}/me/permissions`, { params: { access_token: ex.access_token }, timeout: 10000 })).data?.data || [];
      granted = perms.filter(p => p.status === 'granted').map(p => p.permission);
    } catch { /* optional */ }

    const conv = await this.convertUserTokenToPageToken(ex.access_token);
    if (!conv.converted || conv.error) throw new Error(conv.error || 'ما قدرنا نجيب رمز الصفحة');
    storageService.updateSettings({ meta: {
      ...(this.appManagedByServer() ? {} : { app_id: appId }),
      page_name: conv.page?.name || '',
      granted_scopes: granted, connected_at: new Date().toISOString(), _ids_checked: true
    } });
    const sub = await this.subscribePage();
    const missing = granted.length ? Object.keys(REQUIRED_SCOPES).filter(s => !granted.includes(s)) : [];
    return {
      page: conv.page?.name || conv.page?.id,
      instagram: conv.page?.instagram_business_account?.username || '',
      longLived: conv.longLived,
      subscribed: sub.success,
      missing
    };
  }

  /** Can we publish? (used by the marketing tab). */
  publishScopesStatus() {
    const granted = metaConfig().granted_scopes || [];
    if (!granted.length) return null; // unknown (token pasted by hand)
    return Object.fromEntries(PUBLISH_SCOPES.map(s => [s, granted.includes(s)]));
  }
  /**
   * If a USER token was pasted (e.g. from Graph API Explorer), turn it into the
   * Page token automatically: (optionally) make it long-lived with the App Secret,
   * then read /me/accounts and take the configured Page's token.
   * Returns { converted, pageToken, page, longLived, note } or { converted: false }.
   */
  async convertUserTokenToPageToken(token) {
    let accounts;
    try {
      accounts = (await axios.get(`${GRAPH}/me/accounts`, {
        params: { access_token: token, fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 100 },
        timeout: 10000
      })).data?.data;
    } catch {
      return { converted: false }; // not a user token (page tokens can't list accounts)
    }
    if (!Array.isArray(accounts)) return { converted: false };
    if (!accounts.length) return { converted: true, error: 'رمز المستخدم ما عنده صلاحية على أي صفحة — عند "Generate Access Token" اختار صفحة Atlead - AI ووافق.' };

    const cfg = metaConfig();
    let userToken = token;
    let longLived = false;
    // Long-lived user token → Page tokens derived from it never expire.
    if (cfg.app_secret) {
      try {
        const app = (await axios.get(`${GRAPH}/app`, { params: { access_token: token }, timeout: 10000 })).data;
        const ex = (await axios.get(`${GRAPH}/oauth/access_token`, {
          params: { grant_type: 'fb_exchange_token', client_id: app.id, client_secret: cfg.app_secret, fb_exchange_token: token },
          timeout: 10000
        })).data;
        if (ex?.access_token) {
          userToken = ex.access_token;
          longLived = true;
          accounts = (await axios.get(`${GRAPH}/me/accounts`, {
            params: { access_token: userToken, fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 100 },
            timeout: 10000
          })).data?.data || accounts;
        }
      } catch (err) {
        console.warn('[Meta] long-lived exchange failed:', err.response?.data?.error?.message || err.message);
      }
    }

    const page = accounts.find(p => p.id === cfg.page_id) || (accounts.length === 1 ? accounts[0] : null);
    if (!page) {
      return { converted: true, error: `رمز المستخدم بيدير ${accounts.length} صفحات (${accounts.map(p => p.name).join('، ')}). اكتب Page ID تبع الصفحة المطلوبة بالخانة وجرب مرة ثانية.` };
    }
    const ig = page.instagram_business_account;
    storageService.updateSettings({ meta: {
      page_access_token: page.access_token,
      page_id: page.id,
      ...(ig?.id ? { instagram_account_id: ig.id, instagram_username: ig.username || '' } : {}),
      _ids_checked: true
    } });
    return { converted: true, pageToken: page.access_token, page, longLived };
  }

  async testConnection(tokenOverride = null) {
    let token = tokenOverride || metaConfig().page_access_token;
    if (!token) {
      return { success: false, message: 'رمز الوصول الخاص بصفحة فيسبوك/إنستغرام (Page Access Token) غير مدخل.' };
    }

    // A user token was pasted? Convert it to the Page token automatically.
    let convertNote = '';
    const conv = await this.convertUserTokenToPageToken(token);
    if (conv.converted) {
      if (conv.error) return { success: false, message: conv.error };
      token = conv.pageToken;
      tokenOverride = null; // the Page token is now saved
      convertNote = conv.longLived
        ? ' — 🔁 حوّلت رمز المستخدم لرمز الصفحة الدائم (ما بينتهي) ✅'
        : ' — 🔁 حوّلت رمز المستخدم لرمز الصفحة. ⚠️ الرمز مؤقت (ساعة تقريباً): حط App Secret بالخانة واضغط فحص الاتصال مرة ثانية عشان يصير دائم.';
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
      {
        const sub = await this.subscribePage(tokenOverride);
        subNote = sub.success ? ' — تم اشتراك الصفحة بالرسائل والتعليقات ✅' : ` — ⚠️ تعذر اشتراك الصفحة بالويب هوك: ${sub.message}`;
      }

      return {
        success: true,
        message: `تم الاتصال بنجاح بصفحة: ${response.data.name || 'الصفحة'} (ID: ${response.data.id})${ig ? ` + إنستغرام @${ig.username}` : identity.igError ? ' — (ما قدرنا نقرأ حساب الإنستغرام: الرمز ناقصه صلاحية pages_read_engagement / instagram_basic — الماسنجر شغال عادي)' : ' — لا يوجد حساب إنستغرام أعمال مربوط بالصفحة'}${subNote}${convertNote}`,
        data: response.data
      };
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      const code = err.response?.data?.error?.code;
      // A Messenger-only page token can't read the Page node (needs pages_read_engagement),
      // but it CAN reply to messages. If we know the Page ID, verify what matters instead:
      // subscribing the Page to the webhook (pages_manage_metadata).
      const cfg = metaConfig();
      if (code !== 190 && cfg.page_id) {
        const sub = await this.subscribePage(tokenOverride);
        if (sub.success) {
          storageService.updateSettings({ meta: { _ids_checked: true } });
          return {
            success: true,
            message: `✅ الماسنجر مربوط${convertNote}: الصفحة ${cfg.page_id} مشتركة بالرسائل والبوت بيقدر يرد. ⚠️ الرمز ناقصه صلاحية pages_read_engagement، فقراءة التعليقات وربط الإنستغرام ما رح يشتغلوا لحد ما تعمل رمز جديد فيه هاي الصلاحية.`
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
  async subscribePage(tokenOverride = null) {
    const cfg = metaConfig();
    const token = tokenOverride || cfg.page_access_token;
    if (!token || !cfg.page_id) return { success: false, message: 'Page token / Page ID غير متوفر' };
    try {
      await axios.post(`${GRAPH}/${cfg.page_id}/subscribed_apps`, null, {
        params: { access_token: token, subscribed_fields: 'messages,messaging_postbacks,message_echoes,feed' },
        timeout: 10000
      });
      return { success: true };
    } catch (err) {
      return { success: false, message: err.response?.data?.error?.message || err.message };
    }
  }

  // ---- Diagnostics -------------------------------------------------------
  // Last webhook events Meta sent us (kept in memory) — proves whether Instagram /
  // comments events actually arrive.
  logWebhookEvent(event) {
    if (!this._webhookLog) this._webhookLog = [];
    this._webhookLog.unshift({ at: new Date().toISOString(), ...event });
    if (this._webhookLog.length > 60) this._webhookLog.length = 60;
  }

  getWebhookLog() {
    return this._webhookLog || [];
  }

  /**
   * Asks Meta directly what works: token permissions, app webhook subscriptions,
   * Instagram messaging access, and comment read/reply access.
   */
  async diagnose() {
    const cfg = metaConfig();
    const token = cfg.page_access_token;
    const checks = [];
    const add = (key, label, ok, detail, fix = '') => checks.push({ key, label, ok, detail, fix });
    const get = async (path, params = {}) => (await axios.get(`${GRAPH}/${path}`, { params: { access_token: token, ...params }, timeout: 15000 })).data;
    const errMsg = (e) => e.response?.data?.error?.message || e.message;
    if (!token || !cfg.page_id) {
      add('token', 'رمز الصفحة', false, 'ما في Page Token أو Page ID محفوظ.', 'اربط الصفحة من بطاقة Meta.');
      return { checks, webhook_log: this.getWebhookLog() };
    }

    // 1) Token permissions (needs App Secret for an app access token)
    let scopes = [];
    let appId = null;
    if (cfg.app_secret) {
      try {
        appId = (await get('app', { fields: 'id' })).id;
        const dbg = (await axios.get(`${GRAPH}/debug_token`, {
          params: { input_token: token, access_token: `${appId}|${cfg.app_secret}` }, timeout: 15000
        })).data?.data || {};
        scopes = dbg.scopes || [];
        add('token', 'صلاحية الرمز', !!dbg.is_valid,
          `${dbg.is_valid ? 'صالح' : 'غير صالح'} — ${dbg.expires_at ? (dbg.expires_at === 0 ? 'دائم' : `ينتهي ${new Date(dbg.expires_at * 1000).toISOString().slice(0, 10)}`) : 'دائم'}`);
      } catch (e) {
        add('token', 'صلاحية الرمز', false, errMsg(e));
      }
    }
    // business_management / pages_show_list only matter while connecting, not on the Page token.
    const need = Object.fromEntries(Object.entries(REQUIRED_SCOPES).filter(([k]) => !['business_management', 'pages_show_list'].includes(k)));
    if (!scopes.length && cfg.granted_scopes?.length) scopes = cfg.granted_scopes; // from the one-click connect
    if (scopes.length) {
      const missing = Object.keys(need).filter(s => !scopes.includes(s));
      add('scopes', 'صلاحيات الرمز', missing.length === 0,
        missing.length ? `ناقص: ${missing.map(s => `${s} (${need[s]})`).join('، ')}` : `كل الصلاحيات موجودة (${Object.keys(need).length}).`,
        missing.length ? 'اضغط «سجّل دخول بفيسبوك وإنستغرام» ووافق على كل الصلاحيات بنافذة فيسبوك.' : '');
      const pub = PUBLISH_SCOPES.filter(s => !scopes.includes(s));
      add('publish', 'نشر البوستات (التسويق الذكي)', pub.length === 0,
        pub.length ? `ناقص: ${pub.join('، ')}` : 'فيسبوك وإنستغرام جاهزين للنشر.',
        pub.length ? 'اضغط «سجّل دخول بفيسبوك وإنستغرام». إذا ما ظهرت الصلاحية بنافذة فيسبوك: أضفها للتطبيق من App Review ← Permissions and Features.' : '');
    }

    // 2) App-level webhook subscriptions (which objects/fields Meta sends us)
    if (appId && cfg.app_secret) {
      try {
        const subs = (await axios.get(`${GRAPH}/${appId}/subscriptions`, { params: { access_token: `${appId}|${cfg.app_secret}` }, timeout: 15000 })).data?.data || [];
        const fieldsOf = (obj) => (subs.find(s => s.object === obj)?.fields || []).map(f => f.name);
        const page = fieldsOf('page');
        const ig = fieldsOf('instagram');
        add('app_page_webhook', 'ويب هوك الصفحة (فيسبوك)', page.includes('messages') && page.includes('feed'),
          page.length ? `مشترك بـ: ${page.join(', ')}` : 'مش مشترك',
          !page.includes('feed') ? 'فعّل حقل feed لكائن Page بإعدادات Webhooks بالتطبيق (هذا اللي بيجيب تعليقات الفيس).' : '');
        add('app_ig_webhook', 'ويب هوك الإنستا', ig.includes('messages') && ig.includes('comments'),
          ig.length ? `مشترك بـ: ${ig.join(', ')}` : 'مش مشترك',
          !(ig.includes('messages') && ig.includes('comments')) ? 'فعّل messages و comments لكائن Instagram بإعدادات Webhooks بالتطبيق.' : '');
      } catch (e) {
        add('app_webhooks', 'اشتراكات الويب هوك بالتطبيق', false, errMsg(e));
      }
    }

    // 3) Page subscription
    try {
      const fields = await this.getPageSubscription();
      add('page_sub', 'اشتراك الصفحة بالتطبيق', fields.includes('messages') && fields.includes('feed'), `مشتركة بـ: ${fields.join(', ') || 'ولا اشي'}`);
    } catch (e) {
      add('page_sub', 'اشتراك الصفحة بالتطبيق', false, errMsg(e));
    }

    // 4) Instagram account + messaging access
    if (!cfg.instagram_account_id) {
      add('ig_account', 'حساب الإنستا', false, 'ما في حساب إنستغرام أعمال مربوط بالصفحة.', 'اربط الإنستا بالصفحة ثم اضغط فحص الاتصال.');
    } else {
      try {
        const ig = await get(cfg.instagram_account_id, { fields: 'id,username' });
        add('ig_account', 'حساب الإنستا', true, `@${ig.username}`);
      } catch (e) {
        add('ig_account', 'حساب الإنستا', false, errMsg(e));
      }
      try {
        const conv = await get(`${cfg.page_id}/conversations`, { platform: 'instagram', limit: 3, fields: 'id,updated_time' });
        add('ig_dm', 'رسائل الإنستا (DM)', true, `الوصول شغال — ${conv.data?.length || 0} محادثة ظاهرة.`);
      } catch (e) {
        const m = errMsg(e);
        add('ig_dm', 'رسائل الإنستا (DM)', false, m,
          /access to messages|connected tools|not enabled|messaging/i.test(m)
            ? 'من تطبيق الإنستا: الإعدادات ← الرسائل والردود ← الأدوات المتصلة ← فعّل "السماح بالوصول إلى الرسائل".'
            : 'تأكد إن الرمز فيه instagram_manage_messages وإن الإنستا مربوط بالصفحة.');
      }
      try {
        const media = await get(`${cfg.instagram_account_id}/media`, { fields: 'id,comments_count', limit: 5 });
        const withComments = (media.data || []).find(m => m.comments_count > 0);
        if (withComments) {
          await get(`${withComments.id}/comments`, { limit: 1 });
          add('ig_comments', 'تعليقات الإنستا', true, 'القراءة شغالة.');
        } else {
          add('ig_comments', 'تعليقات الإنستا', true, `${(media.data || []).length} منشور — ما في تعليقات لنفحصها.`);
        }
      } catch (e) {
        add('ig_comments', 'تعليقات الإنستا', false, errMsg(e), 'لازم صلاحية instagram_manage_comments بالرمز.');
      }
    }

    // 5) Facebook comments read access
    try {
      const feed = await get(`${cfg.page_id}/posts`, { fields: 'id,comments.limit(1){id}', limit: 3 });
      add('fb_comments', 'تعليقات الفيس', true, `${(feed.data || []).length} منشور مقروء.`);
    } catch (e) {
      add('fb_comments', 'تعليقات الفيس', false, errMsg(e), 'لازم pages_read_engagement و pages_read_user_content بالرمز.');
    }

    // 6) App mode
    if (appId) {
      try {
        const app = (await axios.get(`${GRAPH}/${appId}`, { params: { fields: 'name', access_token: `${appId}|${cfg.app_secret}` }, timeout: 10000 })).data;
        add('app', 'التطبيق', true, `${app.name} — منشور. ملاحظة: بدون App Review البوت بيرد بس على حسابات إلها دور بالتطبيق (أدمن/مختبر).`);
      } catch { /* optional */ }
    }

    return { checks, webhook_log: this.getWebhookLog() };
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
      incomingText = voiceTranscript || aiService.VOICE_FAILED_TEXT;
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
