/**
 * /api/marketing — post planner wizard, market research, Telegram setup.
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();

const storageService = require('../services/storageService');
const marketingService = require('../services/marketingService');
const research = require('../services/marketResearch');
const telegram = require('../services/telegramService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

// Every step answers with the updated plan, or a clear Arabic error.
const step = (fn) => async (req, res) => {
  try {
    const plan = await fn(req);
    res.json({ success: true, plan: marketingService.view(plan) });
  } catch (err) {
    console.error('[Marketing API]', err.message);
    res.status(400).json({ success: false, message: err.response?.data?.error?.message || err.message });
  }
};

router.get('/overview', (req, res) => {
  res.json({ success: true, ...marketingService.overview() });
});

router.get('/plans/:id', (req, res) => {
  const plan = marketingService.getPlan(req.params.id);
  if (!plan) return res.status(404).json({ success: false, message: 'الخطة غير موجودة' });
  res.json({ success: true, plan: marketingService.view(plan) });
});

router.post('/plans', step(req => marketingService.createPlan({
  source: req.body.inspired_by ? 'competitor' : 'manual',
  customTopic: req.body.topic || '',
  inspiredBy: req.body.inspired_by || ''
})));

router.post('/plans/:id/topic', step(req => marketingService.chooseTopic(req.params.id, { index: req.body.index, custom: req.body.custom || '' })));
router.post('/plans/:id/image', step(req => marketingService.chooseImage(req.params.id, req.body.index)));
router.post('/plans/:id/image-upload', upload.single('image'), step(req => {
  if (!req.file || !/^image\//.test(req.file.mimetype)) throw new Error('ارفع ملف صورة (JPG / PNG)');
  return marketingService.addUploadedImage(req.params.id, req.file.buffer);
}));
router.post('/plans/:id/caption', step(req => marketingService.chooseCaption(req.params.id, { index: req.body.index ?? null, text: req.body.text || '' })));
router.post('/plans/:id/schedule', step(req => marketingService.schedule(req.params.id, { index: req.body.index ?? null, iso: req.body.iso || '', now: req.body.now === true })));
router.post('/plans/:id/regenerate', step(req => marketingService.regenerate(req.params.id, req.body.step)));
router.post('/plans/:id/retry', step(req => marketingService.publishPlan(req.params.id)));
router.post('/plans/:id/cancel', step(req => marketingService.cancel(req.params.id)));

// Go back one step without losing what was generated.
router.post('/plans/:id/back', step(req => {
  const plan = marketingService.mustGet(req.params.id, ['image', 'caption', 'time', 'scheduled', 'failed']);
  const prev = { image: 'topic', caption: 'image', time: 'caption', scheduled: 'time', failed: 'time' }[plan.status];
  if (prev === 'topic' && !(plan.topics || []).length) throw new Error('هذا البوست بدأ بموضوع من عندك — ابدأ اقتراحات جديدة');
  if (plan.status === 'scheduled' || plan.status === 'failed') {
    plan.results = null;
    plan.times = research.bestTimes(storageService.getState('marketing_research')?.own_posts || [], 3);
  }
  plan.status = prev;
  return marketingService.savePlan(plan);
}));

// Market research: competitors, our best posts, news.
router.get('/research', async (req, res) => {
  try {
    const r = await research.gather({ refresh: req.query.refresh === '1' });
    res.json({
      success: true,
      fetched_at: r.fetched_at,
      competitors: (r.competitors || []).map(c => ({ ...c, posts: (c.posts || []).slice(0, 5) })),
      own_top: [...(r.own_posts || [])].sort((a, b) => b.engagement - a.engagement).slice(0, 5),
      own_count: (r.own_posts || []).length,
      news: (r.news || []).slice(0, 10),
      customers: r.customers,
      best_times: research.bestTimes(r.own_posts || [], 3)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Send the morning message right now (testing / on demand).
router.post('/brief/send', async (req, res) => {
  try {
    const { plan, sent } = await marketingService.sendBrief({ source: 'manual' });
    res.json({
      success: true,
      telegram_sent: sent.success,
      message: sent.success ? 'تم إرسال اقتراحات اليوم على تليجرام ✅' : `الاقتراحات جاهزة هون، بس ما انبعتت على تليجرام: ${sent.error}`,
      plan: marketingService.view(plan)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Telegram setup ---
const typedToken = (req) => {
  const t = String(req.body.bot_token || '').trim();
  return t && !t.startsWith('••••') ? t : null;
};

router.post('/telegram/test', async (req, res) => {
  const token = typedToken(req);
  if (token) storageService.updateSettings({ telegram: { bot_token: token } });
  res.json(await telegram.test());
});

router.post('/telegram/detect', async (req, res) => {
  try {
    const token = typedToken(req);
    if (token) storageService.updateSettings({ telegram: { bot_token: token } });
    const chats = await telegram.detectChats();
    if (!chats.length) {
      return res.json({ success: false, message: 'ما لقينا أي محادثة — افتح البوت بتليجرام وابعثله /start ثم اضغط الزر مرة ثانية.' });
    }
    res.json({ success: true, chats, message: `لقينا ${chats.length} محادثة` });
  } catch (err) {
    res.json({ success: false, message: `تعذر قراءة المحادثات: ${err.message}` });
  }
});

module.exports = router;
