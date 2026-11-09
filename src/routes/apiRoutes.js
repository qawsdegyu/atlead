const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storageService = require('../services/storageService');
const supabaseService = require('../services/supabaseService');
const googleSheetsService = require('../services/googleSheetsService');
const metaService = require('../services/metaService');
const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const knowledgeService = require('../services/knowledgeService');
const waQrService = require('../services/waQrService');
const replyEngine = require('../services/replyEngine');
const crmService = require('../services/crmService');
const notificationService = require('../services/notificationService');

// Multer storage for voice uploads & knowledge files
const uploadDir = storageService.getUploadsDir();
try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (err) { console.warn('[uploads] cannot create folder:', err.message); }

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

// --- SETTINGS ROUTES ---
// Secrets are never sent back to the browser in full. The dashboard receives a
// masked value ("••••••••abcd"); if it is posted back unchanged, it is ignored.
const SECRET_FIELDS = {
  meta: ['page_access_token', 'app_secret'],
  whatsapp: ['access_token'],
  supabase: ['service_role_key', 'anon_key'],
  ai: ['gemini_api_key', 'openai_api_key', 'anthropic_api_key'],
  google_sheets: ['service_account_json', 'private_key'],
  notifications: ['gmail_app_password']
};
const MASK = '••••••••';
const isMasked = (v) => typeof v === 'string' && v.startsWith(MASK);
const unmask = (v) => (isMasked(v) || v === '' ? null : v);

function maskSettings(settings) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  for (const [section, keys] of Object.entries(SECRET_FIELDS)) {
    for (const k of keys) {
      const v = out[section]?.[k];
      if (typeof v === 'string' && v) out[section][k] = MASK + (k === 'service_account_json' ? '' : v.slice(-4));
    }
  }
  const sa = googleSheetsService.parseServiceAccount(settings.google_sheets?.service_account_json);
  out.google_sheets = { ...(out.google_sheets || {}), service_account_email: sa?.client_email || '' };
  return out;
}

function stripMasked(body) {
  const clean = JSON.parse(JSON.stringify(body || {}));
  for (const [section, keys] of Object.entries(SECRET_FIELDS)) {
    for (const k of keys) {
      if (clean[section] && isMasked(clean[section][k])) delete clean[section][k];
    }
  }
  return clean;
}

router.get('/settings', (req, res) => {
  res.json({ success: true, settings: maskSettings(storageService.getSettings()) });
});

router.post('/settings', (req, res) => {
  const body = stripMasked(req.body);

  if (body.google_sheets?.service_account_json) {
    const sa = googleSheetsService.parseServiceAccount(body.google_sheets.service_account_json);
    if (!sa) return res.status(400).json({ success: false, message: 'ملف Service Account غير صالح — الصق محتوى ملف JSON كامل كما هو.' });
  }
  if (body.google_sheets?.sheet_id) {
    body.google_sheets.sheet_id = googleSheetsService.extractSpreadsheetId(body.google_sheets.sheet_id);
  }
  if (body.notifications && Array.isArray(body.notifications.recipients)) {
    const emails = body.notifications.recipients.map(e => String(e).trim().toLowerCase()).filter(Boolean);
    const bad = emails.filter(e => !notificationService.constructor.isEmail(e));
    if (bad.length) return res.status(400).json({ success: false, message: `إيميل غير صحيح: ${bad.join(', ')}` });
    body.notifications.recipients = [...new Set(emails)];
  }
  if (body.sales_team && Array.isArray(body.sales_team.members)) {
    const members = [];
    for (const m of body.sales_team.members) {
      const name = String(m?.name || '').trim();
      const email = String(m?.email || '').trim().toLowerCase();
      if (!name && !email) continue;
      if (!name || !notificationService.constructor.isEmail(email)) {
        return res.status(400).json({ success: false, message: `بيانات موظف غير صحيحة: ${name || email}` });
      }
      members.push({ id: m.id || email, name, email, active: m.active !== false });
    }
    if (new Set(members.map(m => m.email)).size !== members.length) {
      return res.status(400).json({ success: false, message: 'في إيميل موظف مكرر' });
    }
    body.sales_team.members = members;
  }
  if (body.business_hours) {
    const bh = body.business_hours;
    if ((bh.start && !/^\d{2}:\d{2}$/.test(bh.start)) || (bh.end && !/^\d{2}:\d{2}$/.test(bh.end))) {
      return res.status(400).json({ success: false, message: 'وقت الدوام غير صحيح' });
    }
    if (bh.start && bh.end && bh.start >= bh.end) {
      return res.status(400).json({ success: false, message: 'بداية الدوام لازم تكون قبل نهايته' });
    }
    if (Array.isArray(bh.days)) bh.days = [...new Set(bh.days.map(Number).filter(d => d >= 0 && d <= 6))];
  }
  if (body.handoff?.closing_deal_threshold_percent !== undefined) {
    const t = Number(body.handoff.closing_deal_threshold_percent);
    body.handoff.closing_deal_threshold_percent = Number.isFinite(t) ? Math.min(100, Math.max(1, t)) : 85;
  }

  // New Meta token → re-detect own Page/IG ids (prevents the bot answering its own comments).
  if (body.meta?.page_access_token) body.meta._ids_checked = false;

  const updated = storageService.updateSettings(body);
  // Supabase just connected/changed → push all existing data to it.
  if (body.supabase) setTimeout(() => require('../services/supabaseSync').fullSync().catch(() => {}), 1000);
  if (body.meta?.page_access_token) metaService.ensureOwnIds().catch(() => {});
  if (body.whatsapp?.mode === 'cloud_api') waQrService.stop().catch(() => {});
  res.json({ success: true, message: 'تم حفظ وتحديث الإعدادات بنجاح!', settings: maskSettings(updated) });
});

// --- SUPABASE SYNC ---
router.get('/supabase/status', async (req, res) => {
  res.json({ success: true, ...(await require('../services/supabaseSync').status()) });
});

router.post('/supabase/sync', async (req, res) => {
  const result = await require('../services/supabaseSync').fullSync();
  res.json(result);
});

router.post('/settings/test-supabase', async (req, res) => {
  const { url, key } = req.body;
  const result = await supabaseService.testConnection(url || null, unmask(key));
  res.json(result);
});

router.post('/settings/test-google-sheets', async (req, res) => {
  const overrides = {};
  const sa = unmask(req.body.service_account_json);
  if (sa) overrides.service_account_json = sa;
  if (req.body.sheet_id) overrides.sheet_id = req.body.sheet_id;
  if (req.body.sheet_name) overrides.sheet_name = req.body.sheet_name;
  if (req.body.webhook_url) overrides.webhook_url = req.body.webhook_url;
  const result = await googleSheetsService.testConnection(overrides);
  res.json(result);
});

// --- SYSTEM HEALTH CHECK (real accounts) ---
router.get('/health', async (req, res) => {
  res.json({ success: true, ...(await require('../services/healthService').runAll()) });
});

// --- REPORTS / BACKUP / FOLLOW-UPS / TEAM ---
router.post('/reports/daily/send', async (req, res) => {
  const result = await require('../services/reportService').send();
  res.json({ success: result.success, message: result.success ? `تم إرسال التقرير إلى: ${result.recipients.join(', ')}` : `فشل الإرسال: ${result.error}`, stats: result.stats });
});

router.get('/reports/daily/preview', (req, res) => {
  const reportService = require('../services/reportService');
  res.send(reportService.renderHtml(reportService.buildStats()));
});

router.post('/backup/now', (req, res) => {
  try {
    const result = require('../services/backupService').runBackup('manual');
    res.json({ success: true, message: `تم حفظ نسخة احتياطية: backups/${result.folder}`, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: `فشل النسخ الاحتياطي: ${err.message}` });
  }
});

router.get('/backup/list', (req, res) => {
  const backupService = require('../services/backupService');
  res.json({ success: true, last: storageService.getState('last_backup'), backups: backupService.list().slice(0, 20) });
});

router.get('/follow-ups/preview', (req, res) => {
  const list = require('../services/followUpService').findCandidates().map(c => ({
    conversation_id: c.conv.id, name: c.conv.customer_name, channel: c.conv.channel, score: c.conv.interest_score, silent_hours: Math.round(c.silentHours * 10) / 10
  }));
  res.json({ success: true, candidates: list });
});

router.get('/team', (req, res) => {
  res.json({ success: true, team: crmService.getTeam() });
});

router.patch('/leads/:id/assign', async (req, res) => {
  const result = await crmService.reassign(req.params.id, req.body.rep_id);
  if (!result.success) return res.status(400).json({ success: false, message: result.error });
  res.json({ success: true, message: `تم إسناد العميل إلى ${result.rep.name}${result.email.success ? ' وإرسال التفاصيل له بالإيميل ✅' : ''}` });
});

// --- EMAIL NOTIFICATIONS ---
router.post('/notifications/test', async (req, res) => {
  const result = await notificationService.sendTest(Array.isArray(req.body.recipients) && req.body.recipients.length ? req.body.recipients : null);
  res.json({
    success: result.success,
    message: result.success ? `تم إرسال إيميل تجريبي إلى: ${result.recipients.join(', ')}` : `فشل الإرسال: ${result.error}`
  });
});

router.get('/notifications/log', (req, res) => {
  res.json({ success: true, log: notificationService.getLog(50) });
});

router.post('/settings/test-meta', async (req, res) => {
  // Use what's typed in the form (token + Page ID) — and save it, so the bot can use it right away.
  const token = unmask(req.body.page_access_token);
  const pageId = String(req.body.page_id || '').trim();
  const patch = {};
  if (token) { patch.page_access_token = token; patch._ids_checked = false; }
  if (/^\d{5,}$/.test(pageId)) patch.page_id = pageId;
  const appSecret = unmask(req.body.app_secret);
  if (appSecret) patch.app_secret = String(appSecret).trim();
  if (Object.keys(patch).length) storageService.updateSettings({ meta: patch });
  const result = await metaService.testConnection();
  res.json(result);
});

router.post('/settings/test-whatsapp', async (req, res) => {
  const { phone_number_id, access_token } = req.body;
  const result = await whatsappService.testConnection(phone_number_id || null, unmask(access_token));
  res.json(result);
});

// --- WHATSAPP QR (linked device) ---
router.get('/whatsapp/status', (req, res) => {
  res.json({ success: true, mode: whatsappService.getMode(), ...waQrService.getStatus() });
});

router.post('/whatsapp/connect', async (req, res) => {
  try {
    storageService.updateSettings({ whatsapp: { mode: 'qr' } });
    const status = await waQrService.connect();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, message: `تعذر بدء اتصال واتساب: ${err.message}` });
  }
});

router.post('/whatsapp/pairing-code', async (req, res) => {
  const phone = req.body.phone || storageService.getSettings().whatsapp?.linked_phone;
  if (!phone) return res.status(400).json({ success: false, message: 'أدخل رقم الهاتف أولاً' });
  try {
    const code = await waQrService.requestPairingCode(phone);
    res.json({ success: true, code });
  } catch (err) {
    res.status(400).json({ success: false, message: `تعذر توليد كود الربط: ${err.message}` });
  }
});

router.post('/whatsapp/logout', async (req, res) => {
  const status = await waQrService.logout();
  res.json({ success: true, message: 'تم فصل واتساب وحذف الجلسة', ...status });
});

// --- CONVERSATIONS ROUTES ---
router.get('/conversations', (req, res) => {
  const { channel, stage } = req.query;
  let list = storageService.getConversations();

  if (channel && channel !== 'all') {
    list = list.filter(c => c.channel === channel);
  }
  if (stage && stage !== 'all') {
    list = list.filter(c => c.lead_stage === stage);
  }

  res.json({ success: true, conversations: list });
});

router.get('/conversations/:id', (req, res) => {
  const conv = storageService.getConversationById(req.params.id);
  if (!conv) return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
  res.json({ success: true, conversation: conv });
});

router.post('/conversations/:id/toggle-bot', async (req, res) => {
  const { is_active, reason } = req.body;
  const conv = storageService.setBotActive(req.params.id, is_active, reason);
  if (!conv) return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
  if (!is_active) replyEngine.cancel(conv.id);

  await supabaseService.saveConversation(conv);
  crmService.upsertLead(conv.id).catch(() => {});
  res.json({
    success: true,
    message: is_active ? 'تم تفعيل الرد الآلي للبوت في هذه المحادثة' : 'تم إيقاف البوت وتحويل المحادثة للموظف البشري',
    conversation: conv
  });
});

router.post('/conversations/:id/reply', async (req, res) => {
  const { text, reply_to_id } = req.body;
  const conv = storageService.getConversationById(req.params.id);
  if (!conv) return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
  if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'الرسالة فارغة' });

  let adapter = null;
  if (conv.channel === 'whatsapp') adapter = whatsappService.getAdapter();
  else if (conv.channel === 'facebook_messenger' || conv.channel === 'instagram_dm') adapter = metaService.getAdapter(conv.channel);

  // A human replied: cancel any pending automatic bot reply for this conversation.
  replyEngine.cancel(conv.id);
  const { msg, sent } = await replyEngine.sendAgentMessage(conv, text.trim(), adapter, reply_to_id || null);

  res.json({
    success: true,
    message: sent ? 'تم إرسال الرد بنجاح!' : 'تم حفظ الرد (لم يُرسل للمنصة — تحقق من ربط القناة)',
    sent,
    data: msg
  });
});

// --- LEADS & CRM ROUTES ---
router.get('/leads', (req, res) => {
  const list = storageService.getLeads();
  res.json({ success: true, leads: list });
});

router.post('/leads/:id/sync-sheet', async (req, res) => {
  const lead = storageService.getLeads().find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ success: false, message: 'العميل غير موجود' });
  const result = await googleSheetsService.syncLead({ ...lead, _manual: true });
  res.json(result);
});

router.post('/leads/:id/notify', async (req, res) => {
  const result = await crmService.resendHandoffEmail(req.params.id);
  res.json({
    success: result.success,
    message: result.success ? `تم إرسال تفاصيل العميل إلى: ${result.recipients.join(', ')}` : `فشل الإرسال: ${result.error}`
  });
});

router.post('/leads/sync-all', async (req, res) => {
  res.json(await googleSheetsService.syncAll());
});

// Sales team marks the outcome: won / lost / pending_human / not_purchased
router.patch('/leads/:id', async (req, res) => {
  const { purchase_status, notes } = req.body;
  const allowed = ['won', 'lost', 'pending_human', 'not_purchased'];
  if (purchase_status && !allowed.includes(purchase_status)) {
    return res.status(400).json({ success: false, message: 'حالة شراء غير صحيحة' });
  }
  const result = await crmService.setPurchaseStatus(req.params.id, purchase_status, notes);
  if (!result) return res.status(404).json({ success: false, message: 'العميل غير موجود' });
  res.json({ success: true, message: 'تم تحديث حالة العميل' + (result.sync.success ? ' ومزامنتها مع الشيت ✅' : ''), lead: result.lead });
});

// --- COMMENTS ROUTES ---
router.get('/comments', (req, res) => {
  const comments = storageService.getComments();
  res.json({ success: true, comments });
});

router.post('/comments/simulate', async (req, res) => {
  const { platform, post_id, message, user_name } = req.body;
  const result = await metaService.handleIncomingComment(platform || 'facebook', {
    comment_id: 'sim_comm_' + Date.now(),
    post_id: post_id || 'post_101',
    from: { id: 'user_' + Date.now(), name: user_name || 'متابع مهتم' },
    message: message || 'كم سعر النظام لو سمحت وبدي تفاصيل؟'
  }, { simulated: true });
  res.json(result);
});

// --- DASHBOARD STATS ---
router.get('/stats', (req, res) => {
  const convs = storageService.getConversations();
  const leads = storageService.getLeads();
  const comments = storageService.getComments();

  const totalConversations = convs.length;
  const hotLeads = leads.filter(l => l.classification === 'Hot' || l.buying_probability >= 75).length;
  const handedOffDeals = convs.filter(c => c.lead_stage === 'deal_closing' || c.lead_stage === 'handed_off' || !c.is_bot_active).length;
  const syncedSheets = leads.filter(l => l.google_sheet_synced).length;
  const totalComments = comments.length;
  const interestedComments = comments.filter(c => c.is_interested).length;

  res.json({
    success: true,
    stats: {
      totalConversations,
      hotLeads,
      handedOffDeals,
      syncedSheets,
      totalComments,
      interestedComments,
      byChannel: {
        whatsapp: convs.filter(c => c.channel === 'whatsapp').length,
        instagram: convs.filter(c => c.channel === 'instagram_dm').length,
        facebook: convs.filter(c => c.channel === 'facebook_messenger').length,
        simulator: convs.filter(c => c.channel === 'simulator').length
      }
    }
  });
});

// --- BOT TEST SIMULATOR (Live Testing in Dashboard) ---
// Uses exactly the same AI + memory + handoff + email + Sheets logic as the real channels
// (without the 10s delay, so you can test quickly).
function getOrCreateSimConversation(conversationId, name) {
  const existing = conversationId ? storageService.getConversationById(conversationId) : null;
  if (existing) return existing;
  return storageService.saveConversation({
    channel: 'simulator',
    external_user_id: 'test_client_' + Date.now(),
    customer_name: name,
    lead_stage: 'new',
    is_bot_active: true
  });
}

async function runSimulatorTurn(conv, text) {
  conv = storageService.getConversationById(conv.id);
  if (conv.is_bot_active === false) {
    return { bot_active: false, reply: null, conversation: conv };
  }
  const history = { ...conv, messages: conv.messages.slice(0, -1) };
  const aiResult = await aiService.generateReply(history, text);
  const handoff = crmService.shouldHandoff(aiResult);
  const replyText = handoff ? crmService.prepareHandoffMessage(conv.id) : aiResult.reply_text;
  if (handoff) storageService.saveConversation({ id: conv.id, is_bot_active: false });

  const lastCustomer = conv.messages[conv.messages.length - 1];
  storageService.addMessage(conv.id, {
    sender: 'bot',
    content: replyText,
    media_type: 'text',
    reply_to_id: lastCustomer?.id || null,
    reply_to_content: lastCustomer?.content || null,
    reply_to_sender: 'customer'
  });
  const updated = await replyEngine.applyAiState(storageService.getConversationById(conv.id), aiResult, handoff);
  const lead = storageService.getLeads().find(l => l.conversation_id === conv.id) || null;
  return { bot_active: updated.is_bot_active !== false, reply: replyText, ai_details: { ...aiResult, handoff_triggered: handoff }, lead, conversation: updated };
}

router.post('/simulator/chat', async (req, res) => {
  const { message, conversation_id } = req.body;
  if (!message || !String(message).trim()) return res.status(400).json({ success: false, message: 'الرسالة فارغة' });
  const conv = getOrCreateSimConversation(conversation_id, 'عميل تجريبي (Simulator)');

  storageService.addMessage(conv.id, { sender: 'customer', content: String(message), media_type: 'text' });
  const result = await runSimulatorTurn(conv, String(message));
  if (!result.bot_active && !result.reply) {
    result.reply = 'المحادثة محولة لموظف بشري — البوت ما بيرد على هذا العميل نهائياً. (تقدر تعيد تفعيله يدوياً من صندوق المحادثات)';
  }
  res.json({ success: true, ...result });
});

router.post('/simulator/voice', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'لم يتم إرفاق ملف صوتي' });
  }
  const conv = getOrCreateSimConversation(req.body.conversation_id, 'عميل صوتي (Voice Test)');

  const transcript = (await aiService.transcribeAudio(req.file.path, req.file.mimetype || 'audio/ogg'))
    || 'رسالة صوتية (تعذر التفريغ — أضف مفتاح Gemini API في الإعدادات)';

  storageService.addMessage(conv.id, {
    sender: 'customer',
    content: transcript,
    media_type: 'audio',
    media_url: `/uploads/${req.file.filename}`,
    is_voice: true,
    voice_transcript: transcript
  });

  const result = await runSimulatorTurn(conv, transcript);
  if (!result.bot_active && !result.reply) {
    result.reply = 'تم استلام الفويس. المحادثة محولة لموظف بشري — البوت ما بيرد.';
  }
  res.json({ success: true, transcript, ...result });
});

// Knowledge Base info
router.get('/knowledge', (req, res) => {
  const docs = knowledgeService.getDocuments();
  res.json({
    success: true,
    documents: docs.map(d => ({ title: d.title, chars: d.text.length })),
    faq_count: knowledgeService.getFaq().length,
    extra_text: knowledgeService.getExtraKnowledge(),
    system_prompt: knowledgeService.getSystemPrompt()
  });
});

router.post('/knowledge', (req, res) => {
  const extra = String(req.body?.extra_text ?? '').slice(0, 20000);
  storageService.updateSettings({ knowledge: { extra_text: extra } });
  res.json({ success: true, message: 'تم حفظ المعلومات الإضافية — البوت صار يستخدمها بالردود ✅' });
});

module.exports = router;

