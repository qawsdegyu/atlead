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
    const providers = aiService.getProviders();
    if (!providers.length) {
      return fail('ai', label, 'لا يوجد مفتاح ذكاء اصطناعي — سيرد البوت من الأجوبة المعتمدة في ملفات الشركة فقط. أضف مفتاحاً من بطاقة الذكاء الاصطناعي.');
    }
    const results = [];
    for (const p of providers) {
      try {
        const text = await aiService.chat(p, 'أنت أداة فحص. أعد JSON فقط.', [], 'أعد {"ok": true}', { json: true, timeout: 20000 });
        results.push({ p, ok: /"ok"\s*:\s*true/.test(text) });
      } catch (err) {
        const m = err.response?.data?.error?.message || err.message;
        let why = m;
        if (/not found|is not supported|404/i.test(m)) why = `اسم الموديل غير صحيح: ${m}`;
        else if (/API key|invalid|permission|401|403|authentication/i.test(m)) why = `المفتاح مرفوض: ${m}`;
        else if (/quota|429|exhausted|credit|balance/i.test(m)) why = `نفد الرصيد أو حد الاستخدام: ${m}`;
        results.push({ p, ok: false, why });
      }
    }
    const working = results.filter(r => r.ok);
    const describe = r => `${r.p.label} (يبدأ بـ ${r.p.key.slice(0, 4)}…، ${r.p.model})`;
    if (working.length) {
      const broken = results.filter(r => !r.ok);
      return (broken.length ? warn : ok)('ai', label,
        `المساعد الذكي يعمل عبر ${describe(working[0])}، ويجيب من ملفات الشركة.` +
        (broken.length ? ` مفتاح آخر لا يعمل: ${broken.map(r => `${describe(r)} — ${r.why || 'رد غير متوقع'}`).join(' | ')}` : ''));
    }
    return fail('ai', label, `لا يوجد مفتاح يعمل — يرد البوت من الأجوبة المعتمدة فقط. ${results.map(r => `${describe(r)}: ${r.why || 'رد غير متوقع'}`).join(' | ')}`);
  }

  async checkWhatsApp() {
    const label = 'واتساب';
    const mode = whatsappService.getMode();
    if (mode === 'qr') {
      const st = waQrService.getStatus();
      if (st.status !== 'connected') {
        return fail('whatsapp', label, `غير مربوط (${st.status})${st.last_error ? ` — ${st.last_error}` : ''}. اضغط "توليد QR" وامسحه من الأجهزة المرتبطة.`);
      }
      if (st.number_mismatch) return warn('whatsapp', label, `مربوط بالرقم +${st.connected_number} لكنه يختلف عن الرقم المُدخل (${st.expected_number}).`);
      return ok('whatsapp', label, `مربوط عبر QR بالرقم +${st.connected_number}${st.connected_name ? ` (${st.connected_name})` : ''}.`);
    }
    const r = await whatsappService.testConnection();
    return r.success ? ok('whatsapp', label, r.message) : fail('whatsapp', label, r.message);
  }

  async checkMeta() {
    const results = [];
    const cfg = require('./metaService').config();
    const label = 'فيسبوك وإنستغرام (Meta)';
    if (!cfg.page_access_token) {
      return [warn('meta', label, 'لا يوجد Page Access Token — الرد على فيسبوك وإنستغرام والتعليقات متوقف.')];
    }
    try {
      const me = { data: await metaService.getPageIdentity(cfg.page_access_token) };
      await metaService.ensureOwnIds();
      const ig = me.data.instagram_business_account;
      results.push(ok('meta', label, `متصل بصفحة "${me.data.name || me.data.id}"${ig ? ` + إنستغرام @${ig.username}` : ''}.`));
      if (me.data.igError) {
        results.push(warn('meta_ig', 'حساب إنستغرام', 'الرمز لا يملك صلاحية قراءة حساب إنستغرام وتعليقات الصفحة (pages_read_engagement / instagram_basic). أضف الصلاحيات في تطبيق Meta وأنشئ رمزاً جديداً.'));
      } else if (!ig) {
        results.push(warn('meta_ig', 'حساب إنستغرام', 'لا يوجد حساب إنستغرام أعمال مربوط بهذه الصفحة، فلن تصل رسائل إنستغرام وتعليقاته. اربطه من إعدادات الصفحة.'));
      }
    } catch (err) {
      const m = err.response?.data?.error?.message || err.message;
      return [fail('meta', label, /expired|Session has expired/i.test(m) ? `الرمز منتهي الصلاحية — أنشئ Page Access Token دائماً جديداً. (${m})` : `الرمز غير صالح: ${m}`)];
    }

    try {
      const fields = await metaService.getPageSubscription();
      const missing = ['messages', 'feed', 'message_echoes'].filter(f => !fields.includes(f));
      results.push(missing.length
        ? fail('meta_sub', 'اشتراك الصفحة بالويب هوك', `الصفحة غير مشتركة في: ${missing.join(', ')} — اضغط "فحص الاتصال" في بطاقة Meta ليتم الاشتراك تلقائياً.`)
        : ok('meta_sub', 'اشتراك الصفحة بالويب هوك', `مشتركة في: ${fields.join(', ')}.`));
    } catch (err) {
      results.push(warn('meta_sub', 'اشتراك الصفحة بالويب هوك', `تعذر الفحص: ${err.response?.data?.error?.message || err.message}`));
    }

    results.push(cfg.app_secret
      ? ok('meta_secret', 'حماية الويب هوك', 'App Secret مضاف — يُرفض أي طلب مزيف.')
      : warn('meta_secret', 'حماية الويب هوك', 'أضف App Secret ليرفض الخادم أي رسائل مزيفة لا تأتي من Meta.'));
    return results;
  }

  async checkSupabase() {
    const label = 'قاعدة البيانات (Supabase)';
    const supaCfg = storageService.getSettings().supabase || {};
    if (supaCfg.url && supaCfg.enabled === false) {
      return fail('supabase', label, 'البيانات مُدخلة، لكن خيار "تفعيل حفظ الرسائل والمحادثات في Supabase" غير مفعّل — فعّله ثم احفظ.');
    }
    const client = supabaseService.getClient();
    if (!client) {
      return fail('supabase', label, 'غير مربوطة — البيانات محفوظة على الخادم فقط، وقد تُفقد ذاكرة العملاء إذا مُسح الخادم. أضف URL و Service Role Key.');
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
        ? `المفتاح لا يملك صلاحية — استخدم Service Role Key (وليس anon). ${problems[0]}`
        : `الجداول ناقصة أو قديمة — شغّل ملف supabase_schema.sql كاملاً في SQL Editor. (${problems.join(' | ')})`);
    }
    const cfg = storageService.getSettings().supabase || {};
    if (!cfg.service_role_key && cfg.anon_key) {
      return warn('supabase', label, 'تعمل، لكنك تستخدم anon key — يُفضّل Service Role Key.');
    }
    // Reading works even with the public key (RLS just returns nothing) — so test a real WRITE.
    const { error: writeError } = await client.from('app_settings').upsert({ key: '_healthcheck', value: { at: new Date().toISOString() } }, { onConflict: 'key' });
    if (writeError) {
      return fail('supabase', label, /row-level security|permission denied|42501/i.test(writeError.message)
        ? 'المفتاح المستخدم هو المفتاح العام (anon / publishable) ولا يستطيع الحفظ. ضع المفتاح السري بدلاً منه: Supabase ← Project Settings ← API Keys ← Secret key (sb_secret_...) أو service_role.'
        : `فشل الحفظ في Supabase: ${writeError.message}`);
    }

    const sync = await require('./supabaseSync').status();
    const r = sync.remote || {};
    const counts = `${r.conversations ?? '?'} محادثة، ${r.messages ?? '?'} رسالة، ${r.leads ?? '?'} عميل، ${r.comments ?? '?'} تعليق محفوظة`;
    if (sync.pending > 0 || sync.last_error) {
      return warn('supabase', label, `متصلة — ${counts}. يوجد ${sync.pending} تغيير بانتظار الحفظ (تُعاد المحاولة كل دقيقة)${sync.last_error ? ': ' + sync.last_error.message : ''}.`);
    }
    return ok('supabase', label, `متصلة، وتُحفظ جميع المحادثات تلقائياً — ${counts}.`);
  }

  async checkKnowledge() {
    const label = 'قاعدة المعرفة (مصدر ردود البوت)';
    const ks = require('./knowledgeService');
    if (ks.remoteKnowledgeStatus === 'not_loaded') await ks.loadFromSupabase();
    const docs = ks.getRuntimeDocuments();
    const chars = docs.reduce((n, d) => n + String(d.text || '').length, 0);
    if (!docs.length) return fail('knowledge', label, 'لا توجد وثيقة مفعّلة — لا يملك البوت معلومات يجيب منها. فعّل وثيقة من صفحة قاعدة المعرفة.');
    const source = ks.remoteKnowledgeStatus === 'loaded' ? 'Supabase' : 'الملفات المحلية (تعذّر التحميل من Supabase)';
    const msg = `${docs.length} وثيقة (${chars.toLocaleString()} حرف) + ${ks.getFaq().length} سؤال شائع — المصدر: ${source}.`;
    return ks.remoteKnowledgeStatus === 'loaded' ? ok('knowledge', label, msg) : warn('knowledge', label, msg);
  }

  async checkSheets() {
    const label = 'Google Sheets / Form';
    if (!googleSheetsService.isConfigured()) {
      return warn('sheets', label, 'غير مربوط — لن تُرسل بيانات العملاء إلى الجدول أو النموذج.');
    }
    if (storageService.getSettings().google_sheets?.auto_sync === false) {
      const r = await googleSheetsService.testConnection();
      return warn('sheets', label, `${r.message} — لكن التحديث التلقائي متوقف.`);
    }
    const r = await googleSheetsService.testConnection();
    return r.success ? ok('sheets', label, r.message) : fail('sheets', label, r.message);
  }

  async checkEmail() {
    const label = 'إشعارات Gmail';
    const cfg = notificationService.getConfig();
    if (!cfg.enabled) return warn('email', label, 'الإشعارات متوقفة — لن يُبلَّغ الموظف عند وجود عميل جاهز.');
    if (!cfg.recipients.length) return fail('email', label, 'لا توجد عناوين بريد للمستلمين — أضف بريد الموظف.');
    if (!cfg.gmailUser || !cfg.gmailPassword) return fail('email', label, 'أدخل Gmail المرسل و App Password.');
    try {
      await nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: cfg.gmailUser, pass: cfg.gmailPassword } }).verify();
      return ok('email', label, `تسجيل الدخول إلى ${cfg.gmailUser} ناجح — تصل الإشعارات إلى ${cfg.recipients.join(', ')}.`);
    } catch (err) {
      return fail('email', label, /Invalid login|BadCredentials|Username and Password/i.test(err.message)
        ? 'رفض Gmail الدخول — يلزم App Password (وليس كلمة مرور البريد) مع تفعيل التحقق بخطوتين.'
        : err.message);
    }
  }

  checkSecurity() {
    const out = [];
    if (storageService.isServerless()) {
      out.push(fail('hosting', 'الاستضافة (Vercel)', 'لا يشغّل Vercel خادماً دائماً: لن يعمل ربط واتساب عبر QR والرد المؤجل والمتابعة والتقرير اليومي والنسخ الاحتياطي، وتُمسح البيانات المحلية. انقل البوت إلى Railway (الخطوات في ملف DEPLOY_RAILWAY.md).'));
    }
    out.push(process.env.ADMIN_PASSWORD
      ? ok('admin', 'حماية لوحة التحكم', 'لوحة التحكم محمية بكلمة سر.')
      : warn('admin', 'حماية لوحة التحكم', 'لا يوجد ADMIN_PASSWORD — يستطيع أي شخص يعرف الرابط الدخول. أضفه في ملف .env قبل النشر.'));
    const dash = notificationService.getConfig().dashboardUrl || '';
    if (!dash || /localhost|127\.0\.0\.1/.test(dash)) {
      out.push(warn('public_url', 'رابط السيرفر', 'الخادم على localhost — لا تستطيع Meta الوصول إلى الويب هوك. ارفعه على نطاق HTTPS (أو ngrok للتجربة) وأضف الرابط في إعدادات البريد.'));
    } else if (!dash.startsWith('https://')) {
      out.push(warn('public_url', 'رابط السيرفر', 'تتطلب Meta رابط HTTPS للويب هوك.'));
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
      ? ok('delay', 'تأخير الرد', `${delay} ثوانٍ بعد آخر رسالة، مع "يكتب الآن..." والرد المقتبس.`)
      : warn('delay', 'تأخير الرد', `التأخير ${delay} ثوانٍ — أقل من 8 يزيد خطر حظر رقم واتساب.`));
    out.push(s.bot?.pause_on_human_reply === false
      ? warn('human_pause', 'إيقاف البوت عند رد الموظف', 'متوقف — إذا رد موظف على عميل، سيواصل البوت الرد أيضاً.')
      : ok('human_pause', 'إيقاف البوت عند رد الموظف', Number(s.bot?.human_pause_hours) > 0 ? `مفعّل — يتوقف البوت ${s.bot.human_pause_hours} ساعة.` : 'مفعّل — يتوقف البوت حتى إعادة تشغيله يدوياً.'));
    const team = require('./crmService').getTeam();
    out.push(team.length
      ? ok('team', 'فريق المبيعات', `${team.length} موظف بالتناوب: ${team.map(m => m.name).join('، ')}.`)
      : warn('team', 'فريق المبيعات', 'لا يوجد موظفون — تُرسل جميع التحويلات إلى بريد الإدارة باسم الممثل العام.'));

    const bh = require('./businessHours');
    const bhCfg = bh.getConfig();
    out.push(bhCfg.enabled
      ? ok('hours', 'ساعات الدوام', `${bhCfg.days.map(d => bh.DAY_NAMES[d]).join('، ')} من ${bhCfg.start} إلى ${bhCfg.end} — الآن ${bh.isOpen() ? 'دوام' : 'خارج الدوام'}.`)
      : warn('hours', 'ساعات الدوام', 'متوقفة — يخبر البوت العميل "بأسرع وقت" حتى في الليل.'));

    const fu = require('./followUpService').getConfig();
    out.push(fu.enabled
      ? ok('followup', 'متابعة العملاء المنقطعين', `بعد ${fu.afterHours} ساعة للعملاء من ${fu.minProbability}% فما فوق، حد أقصى ${fu.maxPerCustomer} لكل عميل.`)
      : warn('followup', 'متابعة العملاء المنقطعين', 'متوقفة.'));

    const rep = require('./reportService').getConfig();
    const managers = notificationService.getConfig().recipients;
    out.push(!rep.enabled
      ? warn('report', 'التقرير اليومي', 'متوقف.')
      : managers.length
        ? ok('report', 'التقرير اليومي', `كل يوم الساعة ${rep.time} إلى ${managers.join(', ')}.`)
        : warn('report', 'التقرير اليومي', 'مفعّل، لكن لا توجد عناوين بريد للإدارة — أضف بريداً في بطاقة الإشعارات.'));

    const last = storageService.getState('last_backup');
    const bk = require('./backupService').getConfig();
    out.push(!bk.enabled
      ? warn('backup', 'النسخ الاحتياطي', 'متوقف.')
      : last?.at && Date.now() - new Date(last.at).getTime() < 30 * 3600 * 1000
        ? ok('backup', 'النسخ الاحتياطي', `آخر نسخة: backups/${last.folder}.`)
        : warn('backup', 'النسخ الاحتياطي', 'مفعّل — تُنشأ أول نسخة تلقائياً، أو اضغط "نسخة احتياطية الآن".'));

    out.push(s.handoff?.handoff_message
      ? ok('handoff', 'التحويل للموظف', `عند ${s.handoff?.closing_deal_threshold_percent ?? 85}% أو موافقة العميل — ${s.handoff?.keep_bot_until_human === false ? 'يتوقف البوت مع العميل فوراً.' : 'يواصل البوت الرد حتى يرد الموظف.'}`)
      : warn('handoff', 'التحويل للموظف', 'رسالة التحويل فارغة — تُستخدم رسالة افتراضية.'));
    return out;
  }

  /** Telegram bot + smart marketing: connection, publishing readiness, database backup. */
  async checkMarketing() {
    const out = [];
    const telegram = require('./telegramService');
    const tg = telegram.getConfig();
    if (!tg.token) {
      out.push(warn('telegram', 'بوت تليجرام', 'غير مربوط — لن تصلك رسالة الصباح (اقتراحات المنشورات) وتنبيهات العملاء الجاهزين. اربطه من التسويق الذكي ← الإعدادات والربط.'));
    } else {
      try {
        const me = await telegram.call('getMe', {}, { timeout: 10000 });
        out.push(tg.chatIds.length
          ? ok('telegram', 'بوت تليجرام', `@${me.username} يعمل، ويرسل إلى ${tg.chatIds.length} محادثة.`)
          : warn('telegram', 'بوت تليجرام', `@${me.username} يعمل، لكن لا يوجد رقم محادثة — أرسل /start للبوت واضغط «اكتشف رقم المحادثة».`));
      } catch (err) {
        out.push(fail('telegram', 'بوت تليجرام', `الرمز مرفوض: ${err.message}`));
      }
    }
    const ch = require('./socialPublisher').channels();
    for (const [key, c] of Object.entries(ch)) {
      if (!c.enabled) continue;
      out.push(c.ready ? ok(`publish_${key}`, `النشر على ${c.label}`, 'جاهز للنشر التلقائي.') : warn(`publish_${key}`, `النشر على ${c.label}`, c.note));
    }
    const db = require('./marketingService').dbStatus();
    out.push(!db.enabled
      ? warn('marketing_db', 'حفظ المنشورات في قاعدة البيانات', 'Supabase غير مربوط — المنشورات والصور محفوظة على الخادم فقط.')
      : db.pending
        ? warn('marketing_db', 'حفظ المنشورات في قاعدة البيانات', 'توجد تغييرات لم تصل إلى Supabase بعد — تُعاد المحاولة كل دقيقة.')
        : ok('marketing_db', 'حفظ المنشورات في قاعدة البيانات', 'المنشورات والصور وتاريخ آخر رسالة صباحية محفوظة في Supabase.'));
    return out;
  }

  async checkCalendar() {
    const cal = require('./calendarService');
    const cfg = cal.getConfig();
    const label = 'حجز المواعيد (Google Calendar)';
    if (!cfg.enabled) return warn('calendar', label, 'متوقف — يقترح البوت التواصل دون حجز موعد فعلي. فعّله من إعدادات الربط ← حجز المواعيد.');
    const r = await cal.test();
    return r.success ? ok('calendar', label, r.message) : fail('calendar', label, r.message);
  }

  checkPhone() {
    const p = require('./phoneService');
    const c = p.getConfig();
    const label = 'الرد الآلي على الهاتف';
    if (!c.enabled) return warn('phone', label, 'متوقف — المكالمات على رقمك لا يرد عليها المساعد.');
    if (!c.twilio_account_sid || !c.twilio_auth_token || !c.twilio_number) return fail('phone', label, 'تنقص بيانات Twilio (Account SID، Auth Token، الرقم).');
    if (!p.openaiKey()) return fail('phone', label, 'ينقص OpenAI API Key (بطاقة مكالمة الـ AI).');
    if (!c.transfer_number) return warn('phone', label, 'لا يوجد رقم خدمة عملاء للتحويل — عند طلب موظف سيُبلَّغ الفريق ليعاود الاتصال.');
    return ok('phone', label, `مفعّل على ${c.twilio_number}، والتحويل إلى ${c.transfer_number}.`);
  }

  async runAll() {
    const safe = (label, key, p) => withTimeout(Promise.resolve().then(p), 25000, label).catch(err => fail(key, label, err.message));
    const results = await Promise.all([
      safe('الذكاء الاصطناعي', 'ai', () => this.checkAi()),
      safe('واتساب', 'whatsapp', () => this.checkWhatsApp()),
      safe('Meta', 'meta', () => this.checkMeta()),
      safe('Supabase', 'supabase', () => this.checkSupabase()),
      safe('Google Sheets', 'sheets', () => this.checkSheets()),
      safe('قاعدة المعرفة', 'knowledge', () => this.checkKnowledge()),
      safe('Gmail', 'email', () => this.checkEmail()),
      safe('التسويق الذكي وتليجرام', 'marketing', () => this.checkMarketing()),
      safe('Google Calendar', 'calendar', () => this.checkCalendar()),
      safe('الهاتف', 'phone', () => this.checkPhone())
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
