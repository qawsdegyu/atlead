require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const storageService = require('./src/services/storageService');
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

// Webhooks must stay public (Meta calls them). Everything else = admin dashboard.
app.use('/webhook', webhookRoutes);

// Admin protection: set ADMIN_PASSWORD (and optionally ADMIN_USER) in .env
// before putting the dashboard online. The browser will ask for username/password.
app.use((req, res, next) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();
  const user = process.env.ADMIN_USER || 'admin';
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    const p = rest.join(':');
    const ok = (a, b) => {
      const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
      return ba.length === bb.length && require('crypto').timingSafeEqual(ba, bb);
    };
    if (ok(u, user) && ok(p, password)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="atlead admin", charset="UTF-8"');
  res.status(401).send('Authentication required');
});

// Static files (Dashboard UI & Uploads)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(storageService.getUploadsDir()));

// Mount routes
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

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 atlead Sales Chatbot & Omnichannel CRM is Running!`);
  console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('⚠️  ADMIN_PASSWORD not set — dashboard is open to anyone who can reach this server.');
  console.log(`📡 Meta Webhook:  http://localhost:${PORT}/webhook/meta`);
  console.log(`💬 WhatsApp Webhook: http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`====================================================`);
});
