/**
 * System health check — verifies every integration with the REAL accounts and
 * explains in plain Arabic what is wrong and how to fix it.
 */
const axios = require('axios');
const nodemailer = require('nodemailer');
const storageService = require('./storageService');
const supabaseService = require('./supabaseService');
const googleSheetsService = require('./googleSheetsService');
const notificationService = require('./notificationService');
const aiService = require('./aiService');
const metaService = require('./metaService');
const waQrService = require('./waQrService');
const whatsappService = require('./whatsappService');

const GRAPH = 'https://graph.facebook.com/v21.0';
const ok = (key, label, message) => ({ key, label, status: 'ok', message });
const warn = (key, label, message) => ({ key, label, status: 'warn', message });
const fail = (key, label, message) => ({ key, label, status: 'error', message });

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: انتهت المهلة (${ms / 1000}s)`)), ms))]);
}

class HealthService {
  async checkAi() {
    const label = 'الذكاء الاصطناعي (ردود البوت)';
    const ai = storageService.getSettings().ai || {};
    const provider = ai.provider || 'gemini';
    const key = provider === 'openai' ? ai.openai_api_key : ai.gemini_api_key;
    if (!key) {
      return fail('ai', label, `ما في مفتاح ${provider === 'openai' ? 'OpenAI' : 'Gemini'} — البوت رح يرد بردود بسيطة جاهزة بدل الذكاء الاصطناعي، وما رح يفهم العملاء صح. أضف المفتاح من بطاقة الذكاء الاصطناعي.`);
    }
    try {
      const r = await aiService.callJson('أنت أداة فحص. أعد JSON فقط.', 'أعد {"ok": true}');
      if (r && r.ok === true) return ok('ai', label, `${provider === 'openai' ? 'OpenAI' : 'Gemini'} شغال (${provider === 'openai' ? ai.openai_model || 'gpt-4o' : ai.gemini_model || 'gemini-2.5-flash'}).`);
      return warn('ai', label, 'المفتاح شغال بس الرد مش بالشكل المتوقع — جرّب البوت من المحاكي.');
    } catch (err) {
      const m = err.response?.data?.error?.message || err.message;
      if (/not found|is not supported|404/i.test(m)) return fail('ai', label, `اسم الموديل غير صحيح أو انتهى: ${m}`);
      if (/API key|permission|401|403/i.test(m)) return fail('ai', label, `المفتاح غير صالح: ${m}`);
      if (/quota|429|exhausted/i.test(m)) return fail('ai', label, `خلص رصيد/حد الاستخدام: ${m}`);
      return fail('ai', label, m);
    }
  }

  async checkWhatsApp() {
    const label = 'واتساب';
    const mode = whatsappService.getMode();
    if (mode === 'qr') {
      const st = waQrService.getStatus();
      if (st.status !== 'connected') {
        return fail('whatsapp', label, `مش مربوط (${st.status})${st.last_error ? ` — ${st.last_error}` : ''}. اضغط "توليد QR" وامسحه من الأجهزة المرتبطة.`);
      }
      if (st.number_mismatch) return warn('whatsapp', label, `مربوط بالرقم +${st.connected_number} بس هذا مش الرقم اللي كاتبه (${st.expected_number}).`);
      return ok('whatsapp', label, `مربوط عبر QR بالرقم +${st.connected_number}${st.connected_name ? ` (${st.connected_name})` : ''}.`);
    }
    const r = await whatsappService.testConnection();
    return r.success ? ok('whatsapp', label, r.message) : fail('whatsapp', label, r.message);
  }

  async checkMeta() {
    const results = [];
    const cfg = storageService.getSettings().meta || {};
    const label = 'فيسبوك وإنستغرام (Meta)';
    if (!cfg.page_access_token) {
      return [warn('meta', label, 'ما في Page Access Token — الرد على فيسبوك وإنستغرام والتعليقات متوقف.')];
    }
    try {
      const me = await axios.get(`${GRAPH}/me`, { params: { access_token: cfg.page_access_token, fields: 'id,name,instagram_business_account{id,username}' }, timeout: 10000 });
      await metaService.ensureOwnIds();
      const ig = me.data.instagram_business_account;
      results.push(ok('meta', label, `متصل بصفحة "${me.data.name}"${ig ? ` + إنستغرام @${ig.username}` : ''}.`));
      if (!ig) results.push(warn('meta_ig', 'حساب إنستغرام', 'ما في حساب إنستغرام أعمال مربوط بهذه الصفحة — رسائل وتعليقات إنستغرام ما رح توصل. اربطه من إعدادات الصفحة.'));
    } catch (err) {
      const m = err.response?.data?.error?.message || err.message;
      return [fail('meta', label, /expired|Session has expired/i.test(m) ? `التوكن منتهي — اعمل Page Access Token دائم جديد. (${m})` : `التوكن غير صالح: ${m}`)];
    }

    try {
      const fields = await metaService.getPageSubscription();
      const missing = ['messages', 'feed', 'message_echoes'].filter(f => !fields.includes(f));
      results.push(missing.length
        ? fail('meta_sub', 'اشتراك الصفحة بالويب هوك', `الصفحة مش مشتركة بـ: ${missing.join(', ')} — اضغط "فحص الاتصال" ببطاقة Meta وبنشترك تلقائياً.`)
        : ok('meta_sub', 'اشتراك الصفحة بالويب هوك', `مشتركة بـ: ${fields.join(', ')}.`));
    } catch (err) {
      results.push(warn('meta_sub', 'اشتراك الصفحة بالويب هوك', `تعذر الفحص: ${err.response?.data?.error?.message || err.message}`));
    }

    results.push(cfg.app_secret
      ? ok('meta_secret', 'حماية الويب هوك', 'App Secret مضاف — أي طلب مزيف بينرفض.')
      : warn('meta_secret', 'حماية الويب هوك', 'أضف App Secret عشان السيرفر يرفض أي رسائل مزيفة مش جاية من Meta.'));
    return results;
  }

  async checkSupabase() {
    const label = 'قاعدة البيانات (Supabase)';
    const supaCfg = storageService.getSettings().supabase || {};
    if (supaCfg.url && supaCfg.enabled === false) {
      return fail('supabase', label, 'البيانات مدخلة بس خيار "تفعيل حفظ الرسائل والمحادثات في Supabase" مش مفعّل — فعّله واحفظ.');
    }
    const client = supabaseService.getClient();
    if (!client) {
      return fail('supabase', label, 'مش مربوطة — البيانات محفوظة على السيرفر بس، وإذا انمسح السيرفر بتروح ذاكرة العملاء. أضف URL و Service Role Key.');
    }
    const tables = {
      conversations: 'id,local_id,customer_summary,customer_email,purchase_status,wa_jid,pause_reason,bot_paused_until,assigned_to_name,follow_up_count',
      messages: 'id,local_id,conversation_local_id,delivery_status,is_follow_up',
      leads: 'id,local_id,customer_email,purchase_status,customer_summary,assigned_to_name,purchase_status_at',
      comments: 'id,status,dm_text',
      app_settings: 'key',
      whatsapp_auth: 'id',
      notification_log: 'id,recipients'
    };
    const problems = [];
    await Promise.all(Object.entries(tables).map(async ([table, cols]) => {
      const { error } = await client.from(table).select(cols).limit(1);
      if (error) problems.push(`${table}: ${error.message}`);
    }));
    if (problems.length) {
      const keyIssue = problems.some(p => /permission|JWT|Invalid API key|401/i.test(p));
      return fail('supabase', label, keyIssue
        ? `المفتاح ما عنده صلاحية — استخدم Service Role Key (مش anon). ${problems[0]}`
        : `الجداول ناقصة أو قديمة — شغّل ملف supabase_schema.sql كامل بـ SQL Editor. (${problems.join(' | ')})`);
    }
    const cfg = storageService.getSettings().supabase || {};
    if (!cfg.service_role_key && cfg.anon_key) {
      return warn('supabase', label, 'شغالة، بس انت مستخدم anon key — الأفضل Service Role Key.');
    }
    // Reading works even with the public key (RLS just returns nothing) — so test a real WRITE.
    const { error: writeError } = await client.from('app_settings').upsert({ key: '_healthcheck', value: { at: new Date().toISOString() } }, { onConflict: 'key' });
    if (writeError) {
      return fail('supabase', label, /row-level security|permission denied|42501/i.test(writeError.message)
        ? 'المفتاح المستخدم هو المفتاح العام (anon / publishable) وما بيقدر يحفظ إشي. حط المفتاح السري بدالُه: Supabase ← Project Settings ← API Keys ← Secret key (sb_secret_...) أو service_role.'
        : `فشل الحفظ بـ Supabase: ${writeError.message}`);
    }

    const sync = await require('./supabaseSync').status();
    const r = sync.remote || {};
    const counts = `${r.conversations ?? '?'} محادثة، ${r.messages ?? '?'} رسالة، ${r.leads ?? '?'} عميل، ${r.comments ?? '?'} تعليق محفوظين`;
    if (sync.pending > 0 || sync.last_error) {
      return warn('supabase', label, `متصلة — ${counts}. في ${sync.pending} تغيير بانتظار الحفظ (بيعيد المحاولة كل دقيقة)${sync.last_error ? ': ' + sync.last_error.message : ''}.`);
    }
    return ok('supabase', label, `متصلة، وكل المحادثات بتنحفظ تلقائياً ✅ — ${counts}.`);
  }

  async checkSheets() {
    const label = 'Google Sheets';
    if (!googleSheetsService.isConfigured()) {
      return warn('sheets', label, 'مش مربوط — بيانات العملاء ما رح تنزل على الشيت.');
    }
    if (storageService.getSettings().google_sheets?.auto_sync === false) {
      const r = await googleSheetsService.testConnection();
      return warn('sheets', label, `${r.message} — بس التحديث التلقائي متوقف.`);
    }
    const r = await googleSheetsService.testConnection();
    return r.success ? ok('sheets', label, r.message) : fail('sheets', label, r.message);
  }

  async checkEmail() {
    const label = 'إشعارات Gmail';
    const cfg = notificationService.getConfig();
    if (!cfg.enabled) return warn('email', label, 'الإشعارات متوقفة — الموظف ما رح يعرف لما يكون في عميل جاهز.');
    if (!cfg.recipients.length) return fail('email', label, 'ما في إيميلات مستلمين — أضف إيميل الموظف.');
    if (!cfg.gmailUser || !cfg.gmailPassword) return fail('email', label, 'أدخل Gmail المرسل و App Password.');
    try {
      await nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: cfg.gmailUser, pass: cfg.gmailPassword } }).verify();
      return ok('email', label, `تسجيل الدخول لـ ${cfg.gmailUser} ناجح — الإشعارات بتوصل لـ ${cfg.recipients.join(', ')}.`);
    } catch (err) {
      return fail('email', label, /Invalid login|BadCredentials|Username and Password/i.test(err.message)
        ? 'Gmail رفض الدخول — لازم App Password (مش كلمة سر الإيميل) مع تفعيل التحقق بخطوتين.'
        : err.message);
    }
  }

  checkSecurity() {
    const out = [];
    if (storageService.isServerless()) {
      out.push(fail('hosting', 'الاستضافة (Vercel)', 'Vercel ما بيشغّل سيرفر دايم: ربط واتساب بالـ QR، والرد بعد 10 ثواني، والمتابعة، والتقرير اليومي، والنسخ الاحتياطي ما بيشتغلوا، والبيانات المحلية بتنمسح. انقل البوت على Railway (الخطوات بملف DEPLOY_RAILWAY.md).'));
    }
    out.push(process.env.ADMIN_PASSWORD
      ? ok('admin', 'حماية لوحة التحكم', 'لوحة التحكم محمية بكلمة سر.')
      : warn('admin', 'حماية لوحة التحكم', 'ما في ADMIN_PASSWORD — أي حدا بيعرف الرابط بيدخل. ضيفه بملف .env قبل الرفع على النت.'));
    const dash = notificationService.getConfig().dashboardUrl || '';
    if (!dash || /localhost|127\.0\.0\.1/.test(dash)) {
      out.push(warn('public_url', 'رابط السيرفر', 'السيرفر على localhost — Meta ما بتقدر توصل للويب هوك. لازم ترفعه على دومين HTTPS (أو ngrok للتجربة)، وتحط الرابط بإعدادات الإيميل.'));
    } else if (!dash.startsWith('https://')) {
      out.push(warn('public_url', 'رابط السيرفر', 'Meta بتطلب HTTPS للويب هوك.'));
    } else {
      out.push(ok('public_url', 'رابط السيرفر', `${dash} — الويب هوك: ${dash}/webhook/meta`));
    }
    return out;
  }

  checkBotRules() {
    const s = storageService.getSettings();
    const delay = Number(s.bot?.reply_delay_seconds ?? 10);
    const out = [];
    out.push(delay >= 8
      ? ok('delay', 'تأخير الرد', `${delay} ثواني بعد آخر رسالة، مع "يكتب الآن..." والرد المقتبس.`)
      : warn('delay', 'تأخير الرد', `التأخير ${delay} ثواني — أقل من 8 بيزيد خطر حظر رقم الواتساب.`));
    out.push(s.bot?.pause_on_human_reply === false
      ? warn('human_pause', 'إيقاف البوت لما يرد موظف', 'متوقف — إذا رد موظف على عميل، البوت رح يكمل يرد معه.')
      : ok('human_pause', 'إيقاف البوت لما يرد موظف', Number(s.bot?.human_pause_hours) > 0 ? `مفعّل — البوت بيوقف ${s.bot.human_pause_hours} ساعة.` : 'مفعّل — البوت بيوقف لحد ما ترجّعه يدوياً.'));
    const team = require('./crmService').getTeam();
    out.push(team.length
      ? ok('team', 'فريق المبيعات', `${team.length} موظف بالدور: ${team.map(m => m.name).join('، ')}.`)
      : warn('team', 'فريق المبيعات', 'ما في موظفين — كل التحويلات بتروح لإيميلات الإدارة باسم الممثل العام.'));

    const bh = require('./businessHours');
    const bhCfg = bh.getConfig();
    out.push(bhCfg.enabled
      ? ok('hours', 'ساعات الدوام', `${bhCfg.days.map(d => bh.DAY_NAMES[d]).join('، ')} من ${bhCfg.start} لـ ${bhCfg.end} — هلق ${bh.isOpen() ? 'دوام ✅' : 'خارج الدوام'}.`)
      : warn('hours', 'ساعات الدوام', 'متوقفة — البوت بيحكي للعميل "بأسرع وقت" حتى بالليل.'));

    const fu = require('./followUpService').getConfig();
    out.push(fu.enabled
      ? ok('followup', 'متابعة العملاء الساكتين', `بعد ${fu.afterHours} ساعة للعملاء من ${fu.minProbability}% فما فوق، حد أقصى ${fu.maxPerCustomer} لكل عميل.`)
      : warn('followup', 'متابعة العملاء الساكتين', 'متوقفة.'));

    const rep = require('./reportService').getConfig();
    const managers = notificationService.getConfig().recipients;
    out.push(!rep.enabled
      ? warn('report', 'التقرير اليومي', 'متوقف.')
      : managers.length
        ? ok('report', 'التقرير اليومي', `كل يوم الساعة ${rep.time} إلى ${managers.join(', ')}.`)
        : warn('report', 'التقرير اليومي', 'مفعّل بس ما في إيميلات إدارة — أضف إيميل ببطاقة الإشعارات.'));

    const last = storageService.getState('last_backup');
    const bk = require('./backupService').getConfig();
    out.push(!bk.enabled
      ? warn('backup', 'النسخ الاحتياطي', 'متوقف.')
      : last?.at && Date.now() - new Date(last.at).getTime() < 30 * 3600 * 1000
        ? ok('backup', 'النسخ الاحتياطي', `آخر نسخة: backups/${last.folder}.`)
        : warn('backup', 'النسخ الاحتياطي', 'مفعّل — أول نسخة بتنعمل تلقائياً، أو اضغط "نسخة احتياطية هلق".'));

    out.push(s.handoff?.handoff_message
      ? ok('handoff', 'التحويل للموظف', `عند ${s.handoff?.closing_deal_threshold_percent ?? 85}% أو موافقة العميل — البوت بيوقف نهائياً مع العميل.`)
      : warn('handoff', 'التحويل للموظف', 'رسالة التحويل فاضية — بنستخدم رسالة افتراضية.'));
    return out;
  }

  async runAll() {
    const safe = (label, key, p) => withTimeout(Promise.resolve().then(p), 25000, label).catch(err => fail(key, label, err.message));
    const results = await Promise.all([
      safe('الذكاء الاصطناعي', 'ai', () => this.checkAi()),
      safe('واتساب', 'whatsapp', () => this.checkWhatsApp()),
      safe('Meta', 'meta', () => this.checkMeta()),
      safe('Supabase', 'supabase', () => this.checkSupabase()),
      safe('Google Sheets', 'sheets', () => this.checkSheets()),
      safe('Gmail', 'email', () => this.checkEmail())
    ]);
    const all = [...results.flat(), ...this.checkBotRules(), ...this.checkSecurity()];
    return {
      checked_at: new Date().toISOString(),
      summary: {
        ok: all.filter(r => r.status === 'ok').length,
        warn: all.filter(r => r.status === 'warn').length,
        error: all.filter(r => r.status === 'error').length
      },
      results: all
    };
  }
}

module.exports = new HealthService();
