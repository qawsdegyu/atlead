require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const storageService = require('./src/services/storageService');
// Registers the storage change listener right away: every change is mirrored to Supabase.
const supabaseSync = require('./src/services/supabaseSync');
const apiRoutes = require('./src/routes/apiRoutes');
const webhookRoutes = require('./src/routes/webhookRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({
  limit: '50mb',
  // Keep the raw body so Meta webhook signatures (X-Hub-Signature-256) can be verified.
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Public health check for the hosting platform (Railway) — no data exposed.
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

// Public legal pages required by Meta to publish the app (Live mode).
const legalPage = (title, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — atlead</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.7;color:#222}h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:1.6em}</style>
</head><body><h1>${title}</h1><p><em>Last updated: ${new Date().toISOString().slice(0, 10)}</em></p>${body}</body></html>`;

app.get('/privacy', (req, res) => res.send(legalPage('Privacy Policy', `
<p>atlead ("we") operates an automated sales assistant that replies to messages and comments sent to our Facebook Page, Instagram account and WhatsApp number.</p>
<h2>Data we collect</h2>
<p>When you message or comment on our accounts we receive your name, your platform user ID, the content of your messages (text and images), and any contact details you choose to share (such as phone number or email).</p>
<h2>How we use it</h2>
<p>We use this data only to answer your questions, follow up on your request, and let our sales team contact you. We do not sell your data or use it for advertising.</p>
<h2>Storage and retention</h2>
<p>Conversations are stored in our secured database and internal sales records for as long as needed to serve you, and deleted on request.</p>
<h2>Sharing</h2>
<p>Data is processed by our service providers (Meta, hosting, database and AI providers) only to operate this service.</p>
<h2>Your rights / deletion</h2>
<p>You can ask us to delete your data at any time — see <a href="/data-deletion">Data Deletion Instructions</a>.</p>
<h2>Contact</h2>
<p>Send us a message on our Facebook Page or Instagram account.</p>`)));

app.get('/data-deletion', (req, res) => res.send(legalPage('Data Deletion Instructions', `
<p>To delete all data atlead holds about you, send the message <strong>"delete my data"</strong> to our Facebook Page or Instagram account, or contact us through the Page.</p>
<p>We will delete your conversation history and contact details from our systems within 30 days and confirm once done.</p>
<p>You can also remove the app's access from Facebook: Settings &amp; Privacy → Settings → Apps and Websites.</p>`)));

app.get('/terms', (req, res) => res.send(legalPage('Terms of Service', `
<p>By messaging atlead's accounts you agree that replies may be generated automatically by an AI assistant and reviewed by our team. Information provided by the assistant is for general guidance; final offers and prices are confirmed by our sales team.</p>`)));

// Post images must be public: Instagram downloads the image from this URL when publishing.
// Only files created by the post planner (random, unguessable names) are served.
app.get('/media/:name', async (req, res) => {
  // Restored from Supabase Storage if this server lost the file (redeploy / wiped disk).
  const file = await require('./src/services/imageService').ensureLocal(req.params.name);
  if (!file) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(file, { dotfiles: 'allow' }); // the name is already validated
});

// Webhooks must stay public (Meta calls them). Everything else = admin dashboard.
app.use('/webhook', webhookRoutes);

// The customer's AI voice call page (public; access = the private link token).
const callRoutes = require('./src/routes/callRoutes');
app.use('/call', callRoutes.page);
app.use('/api/call', callRoutes.api);

// Google Calendar: the engineer signs in with Google once (link from the dashboard). State-protected.
const calendarPage = (ok, title, body) => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>atlead — ${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0b;color:#f4f4f5;font-family:system-ui,Tahoma,sans-serif;padding:24px;text-align:center}
.card{max-width:420px}.mark{font-size:30px;font-weight:700;background:linear-gradient(90deg,#ef3b2d,#ff6f20,#ffa04d);-webkit-background-clip:text;background-clip:text;color:transparent;direction:ltr}
h1{font-size:22px;margin:22px 0 10px;color:${ok ? '#4ade80' : '#ffb37f'}}p{color:#a8a8b0;line-height:1.7}</style></head><body><div class="card"><div class="mark">atlead.</div><h1>${title}</h1><p>${body}</p></div></body></html>`;
app.get('/connect-calendar/:token', (req, res) => {
  const url = require('./src/services/calendarService').googleAuthUrl(String(req.params.token));
  if (!url) return res.status(410).send(calendarPage(false, 'الرابط منتهي', 'انتهت صلاحية رابط الربط. اطلب رابطاً جديداً من لوحة تحكم atlead.'));
  res.redirect(url);
});
app.get('/oauth/google/callback', async (req, res) => {
  if (req.query.error) return res.status(400).send(calendarPage(false, 'لم يتم الربط', 'تم إلغاء الموافقة على Google. يمكنك فتح الرابط مرة أخرى والضغط على «السماح».'));
  try {
    const { email } = await require('./src/services/calendarService').finishConnect(String(req.query.code || ''), String(req.query.state || ''));
    res.send(calendarPage(true, 'تم ربط التقويم', `تقويم ${escAttr(email || 'Google')} مربوط الآن بـ atlead. سيحجز المساعد مواعيد الاستشارة فيه تلقائياً في الأوقات المتاحة فقط. يمكنك إغلاق هذه الصفحة.`));
  } catch (e) {
    res.status(400).send(calendarPage(false, 'لم يتم الربط', escAttr(e.response?.data?.error_description || e.message)));
  }
});

// AI phone line (Twilio). Public, but every request must carry a valid Twilio signature.
const phoneService = require('./src/services/phoneService');
const twiml = (res, body) => res.type('text/xml').send(body);
app.post('/voice/incoming', (req, res) => {
  if (!phoneService.validSignature(req)) return res.status(403).send('Forbidden');
  twiml(res, phoneService.incoming(req.body));
});
app.post('/voice/after-dial', (req, res) => {
  if (!phoneService.validSignature(req)) return res.status(403).send('Forbidden');
  twiml(res, phoneService.afterDial(req.body, String(req.query.t || '')));
});

// Admin protection: set ADMIN_PASSWORD (and optionally ADMIN_USER) in the environment.
// Two ways in: a login page (/login → signed session cookie) or HTTP Basic auth.
const crypto = require('crypto');
const SESSION_COOKIE = 'atl_admin';
const SESSION_DAYS = 30;
const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
const sign = (value) => crypto.createHmac('sha256', String(process.env.ADMIN_PASSWORD)).update(value).digest('hex');
const makeSession = () => {
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  return `${exp}.${sign(exp)}`;
};
const validSession = (raw) => {
  const [exp, sig] = String(raw || '').split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && safeEqual(sig, sign(exp));
};
const readCookie = (req, name) => {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
};

const safeNext = (n) => (/^\/(?![/\\])/.test(String(n || '')) ? String(n) : '/');
const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const loginPage = (error = '', next = '/') => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>تسجيل الدخول — atlead</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
form{background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.08);width:300px}
h1{font-size:1.3rem;margin:0 0 20px}label{display:block;font-size:.9rem;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:1rem}
button{margin-top:20px;width:100%;padding:11px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font-size:1rem;cursor:pointer}
.err{color:#c00;font-size:.9rem;margin-top:10px}</style></head><body>
<form method="post" action="/login"><input type="hidden" name="next" value="${escAttr(next)}"><h1>لوحة تحكم atlead</h1>
<label>اسم المستخدم</label><input name="username" autocomplete="username" value="admin">
<label>كلمة السر</label><input name="password" type="password" autocomplete="current-password" autofocus>
${error ? `<div class="err">${error}</div>` : ''}<button type="submit">دخول</button></form></body></html>`;

app.get('/login', (req, res) => res.send(loginPage('', safeNext(req.query.next))));
app.post('/login', (req, res) => {
  const password = process.env.ADMIN_PASSWORD;
  const user = process.env.ADMIN_USER || 'admin';
  if (!password) return res.redirect('/');
  const { username = '', password: pass = '', next = '/' } = req.body || {};
  if (safeEqual(String(username).trim(), user) && safeEqual(pass, password)) {
    res.set('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(makeSession())}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
    return res.redirect(safeNext(next)); // e.g. the link from the Telegram morning message
  }
  res.status(401).send(loginPage('اسم المستخدم أو كلمة السر غلط', safeNext(next)));
});
app.get('/logout', (req, res) => {
  res.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  res.redirect('/login');
});

app.use((req, res, next) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();
  if (validSession(readCookie(req, SESSION_COOKIE))) return next();
  const user = process.env.ADMIN_USER || 'admin';
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (safeEqual(u, user) && safeEqual(rest.join(':'), password)) return next();
  }
  // Browsers get the login page; API calls get a plain 401.
  if (req.method === 'GET' && !req.path.startsWith('/api') && (req.headers.accept || '').includes('text/html')) {
    return res.redirect(req.originalUrl && req.originalUrl !== '/' ? `/login?next=${encodeURIComponent(req.originalUrl)}` : '/login');
  }
  res.status(401).json({ success: false, message: 'Authentication required' });
});

// Static files (Dashboard UI & Uploads)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(storageService.getUploadsDir()));

// Mount routes
app.use('/api/marketing', require('./src/routes/marketingRoutes'));
app.use('/api', apiRoutes);

app.get('/google_apps_script.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'google_apps_script.js'));
});
app.get('/supabase_schema.sql', (req, res) => {
  res.sendFile(path.join(__dirname, 'supabase_schema.sql'));
});

// Seed initial realistic data if empty
function seedDemoDataIfEmpty() {
  const convs = storageService.getConversations();
  if (convs.length === 0) {
    console.log('Seeding initial demo data for atlead dashboard...');

    // 1. A WhatsApp lead who agreed on deal / consultation (Handoff active, bot paused)
    const conv1 = storageService.saveConversation({
      id: 'conv_demo_whatsapp_01',
      channel: 'whatsapp',
      external_user_id: '+962791234567',
      customer_name: 'أحمد التميمي (مؤسسة الأفق للتوزيع)',
      customer_phone: '+962791234567',
      lead_stage: 'deal_closing',
      classification: 'Hot',
      interest_score: 95,
      is_bot_active: false,
      handoff_at: new Date().toISOString(),
      handoff_reason: 'وافق على جلسة الاستشارة المجانية وطلب التواصل من الفريق'
    });

    storageService.addMessage(conv1.id, {
      sender: 'customer',
      content: 'مرحبا، نحنا شركة توزيع استيراد بالاردن، وبوصلنا فوق الـ 200 رسالة يومياً ع الواتساب وفيسبوك والموظفين ما بلحقوا يردوا وبتضيع علينا مبيعات.'
    });
    storageService.addMessage(conv1.id, {
      sender: 'bot',
      content: 'أهلاً وسهلاً بك أستاذ أحمد! هاي بالظبط من أكتر المشاكل اللي بنحلها في atlead عبر أنظمة المبيعات الذكية (AI Sales Systems) وتأهيل العملاء التلقائي بحيث البوت يستقبل الاستفسار، يفهم الطلب ويسجله بالـ CRM بدون أي تأخير. الاستفسارات بتجيكم من الواتساب بس ولا كمان من منصات ثانية؟'
    });
    storageService.addMessage(conv1.id, {
      sender: 'customer',
      content: 'بتجينا من واتساب وفيسبوك وإنستا. تمام ممتاز، كيف بنقدر نرتب موعد أو نبدأ معكم ونشوف كيف النظام بشتغل؟'
    });
    storageService.addMessage(conv1.id, {
      sender: 'bot',
      content: 'تمام، م. مهند من قسم المبيعات في شركة atlead رح يتواصل معك بأسرع وقت لمتابعة كافة التفاصيل وترتيب كل شيء معك. شكراً لاهتمامك وثقتك.'
    });

    // Lead 1
    storageService.saveLead({
      conversation_id: conv1.id,
      name: 'أحمد التميمي',
      phone: '+962791234567',
      channel: 'whatsapp',
      business_type: 'تجارة وتوزيع الجملة',
      identified_problem: 'ضغط هائل في رسائل الواتساب وتأخر الرد وضياع صفقات',
      proposed_solution: 'AI Sales System + WhatsApp Lead Qualification',
      lead_stage: 'Deal Agreed',
      classification: 'Hot',
      buying_probability: 95,
      deal_status: 'agreed',
      notes: 'تم تحويله إلى م. مهند. جاهز للتعاقد وتم إيقاف البوت في المحادثة.',
      google_sheet_synced: true
    });

    // 2. An Instagram DM lead in discovery
    const conv2 = storageService.saveConversation({
      id: 'conv_demo_ig_02',
      channel: 'instagram_dm',
      external_user_id: 'ig_sara_design',
      customer_name: 'سارة خالد (@saradesign_jo)',
      customer_handle: '@saradesign_jo',
      lead_stage: 'discovery',
      classification: 'Warm',
      interest_score: 65,
      is_bot_active: true
    });
    storageService.addMessage(conv2.id, {
      sender: 'customer',
      content: 'مرحبا، شفت البوست تبعكم عن أتمتة مبيعات المتاجر، شو الأسعار عندكم؟'
    });
    storageService.addMessage(conv2.id, {
      sender: 'bot',
      content: 'أهلاً وسهلاً بك سارة! كل نظام بنبنيه في atlead بيكون مخصص ومفصل حسب حجم شغلك والأنظمة اللي بتستخدميها، لهيك ما بنعطي أسعار جاهزة. بنعمل جلسة استشارة مجانية مدتها 30 دقيقة نفهم فيها احتياج متجرك بالضبط ونعطيك خطة عمل وتكلفة دقيقة. شو نوع المنتجات اللي بتقدموها بمتجركم؟'
    });

    // Lead 2
    storageService.saveLead({
      conversation_id: conv2.id,
      name: 'سارة خالد',
      phone: 'غير مسجل بعد',
      channel: 'instagram_dm',
      business_type: 'متجر إلكتروني وتصميم',
      identified_problem: 'استفسار عن أسعار أتمتة المتاجر',
      proposed_solution: 'جلسة استشارة مجانية لتقييم الاحتياج',
      lead_stage: 'Discovery',
      classification: 'Warm',
      buying_probability: 65,
      deal_status: 'in_progress',
      notes: 'تم توضيح سياسة التسعير واقتراح الاستشارة المجانية.'
    });

    // 3. Sample Facebook comment with Auto-DM
    storageService.saveComment({
      platform: 'facebook',
      post_id: 'post_sales_systems_01',
      comment_id: 'fb_comm_99128',
      user_name: 'عمر القواسمي',
      comment_text: 'بدي أعرف كم تكلفة الشات بوت للعيادات وكيف بقدر أجربه؟',
      bot_reply_text: 'أهلاً بك أستاذ عمر! تم إرسال كافة التفاصيل ورابط التواصل على الخاص (DM) لخدمتك بأفضل شكل 🚀',
      sentiment: 'interested',
      is_interested: true,
      dm_triggered: true,
      dm_sent_at: new Date().toISOString()
    });
  }
}

// Demo data only when explicitly requested (SEED_DEMO=true) — keeps real CRM/Sheets clean.
if (process.env.SEED_DEMO === 'true') seedDemoDataIfEmpty();

// Catch all to serve frontend
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
async function bootstrap() {
  const supabaseService = require('./src/services/supabaseService');
  const waQrService = require('./src/services/waQrService');
  const metaService = require('./src/services/metaService');

  // 1. Default settings for new features
  const s = storageService.getSettings();
  storageService.updateSettings({
    whatsapp: { mode: s.whatsapp?.mode || 'qr' },
    notifications: {
      enabled: s.notifications?.enabled ?? true,
      recipients: s.notifications?.recipients || [],
      notify_new_messages_after_handoff: s.notifications?.notify_new_messages_after_handoff ?? true
    },
    handoff: {
      closing_deal_threshold_percent: s.handoff?.closing_deal_threshold_percent ?? 85,
      auto_stop_bot_after_handoff: true,
      // The rep's name in the handoff text becomes {rep}, so the assigned rep's name is used.
      ...(s.handoff?.handoff_message && s.handoff?.representative_name && s.handoff.handoff_message.includes(s.handoff.representative_name)
        ? { handoff_message: s.handoff.handoff_message.split(s.handoff.representative_name).join('{rep}') }
        : {})
    },
    business_hours: { ...require('./src/services/businessHours').DEFAULTS, ...(s.business_hours || {}) },
    follow_up: { enabled: true, after_hours: 20, min_probability: 60, max_per_customer: 2, use_ai: true, ...(s.follow_up || {}) },
    daily_report: { enabled: true, time: '20:00', ...(s.daily_report || {}) },
    backup: { enabled: true, keep_days: 14, ...(s.backup || {}) },
    sales_team: { members: [], ...(s.sales_team || {}) },
    marketing: { enabled: true, morning_time: '09:00', language: 'ar', free_image_fallback: true, publish_facebook: true, publish_instagram: true, publish_telegram_channel: false, ...(s.marketing || {}) },
    telegram: { notify_handoffs: true, ...(s.telegram || {}) },
    ai: { image_understanding_enabled: s.ai?.image_understanding_enabled ?? true },
    bot: {
      reply_delay_seconds: s.bot?.reply_delay_seconds ?? 10,
      quote_replies: s.bot?.quote_replies ?? true,
      typing_indicator: s.bot?.typing_indicator ?? true,
      pause_on_human_reply: s.bot?.pause_on_human_reply ?? true,
      human_pause_hours: s.bot?.human_pause_hours ?? 0
    }
  }, { skipDbSync: true });

  // 2. Load settings (API keys, tokens...) from the database if Supabase is configured
  const dbSettings = await supabaseService.loadSettings();
  if (dbSettings) {
    storageService.updateSettings(dbSettings, { skipDbSync: true });
    console.log('[Settings] Loaded from Supabase (app_settings)');
  } else if (supabaseService.isEnabled()) {
    await supabaseService.saveSettings(storageService.getSettings());
  }

  // Runtime answers must come from Supabase knowledge_docs, not from the GitHub checkout.
  await require('./src/services/knowledgeService').loadFromSupabase();

  // Marketing posts (and the day of the last morning message) come back from the database.
  await require('./src/services/marketingService').restoreFromDb().catch(err => console.error('[Marketing] restore error:', err.message));

  if (storageService.isServerless()) {
    console.warn('⚠️ Serverless hosting detected (Vercel): WhatsApp QR, 10s delayed replies, follow-ups, daily report and backups need an always-on server (Railway).');
    return;
  }

  // 2b. Send everything to Supabase (backfills data saved before Supabase was connected)
  setTimeout(() => supabaseSync.fullSync().catch(err => console.error('[Supabase] initial sync error:', err.message)), 10000);

  // 3. Restore WhatsApp QR session (if previously linked)
  await waQrService.autoStart();

  // 3b. Customers who wrote just before a restart lost their 10s timer → answer them.
  //     Wait a bit so WhatsApp has time to reconnect first.
  setTimeout(() => {
    const replyEngine = require('./src/services/replyEngine');
    const whatsappService = require('./src/services/whatsappService');
    replyEngine.resumePending(conv => require('./src/services/schedulerService').getAdapter(conv));
  }, 20000);

  // 3c. Detect own Page / Instagram ids (prevents replying to our own comments)
  metaService.ensureOwnIds().catch(() => {});

  // 5. Background jobs: follow-ups, daily report, backups, emails held after hours
  require('./src/services/schedulerService').start();

  // 4. Resume comments that were waiting for a reply when the server stopped
  storageService.getComments().filter(c => c.status === 'pending').forEach(c => {
    metaService.processComment(c.platform, c.comment_id).catch(() => {});
  });
}

bootstrap().catch(err => console.error('Bootstrap error:', err.message));

// Vercel (serverless) imports the app instead of running a server.
module.exports = app;

if (!process.env.VERCEL) phoneService.attach(app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 atlead Sales Chatbot & Omnichannel CRM is Running!`);
  console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('⚠️  ADMIN_PASSWORD not set — dashboard is open to anyone who can reach this server.');
  console.log(`📡 Meta Webhook:  http://localhost:${PORT}/webhook/meta`);
  console.log(`💬 WhatsApp Webhook: http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`====================================================`);
}));
