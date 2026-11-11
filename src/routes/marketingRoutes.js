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
    const m = err.response?.data?.error?.message || err.message;
    res.status(400).json({ success: false, message: m === 'NO_AI_KEY' ? 'ما في مفتاح ذكاء اصطناعي شغال — حطه بإعدادات الربط ← الذكاء الاصطناعي.' : m });
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
// Edit chats: "make the title bigger" on an image, "shorter and more formal" on the caption.
router.post('/plans/:id/image-chat', step(req => marketingService.editImage(req.params.id, req.body.file, req.body.message)));
router.post('/plans/:id/caption-chat', step(req => marketingService.captionChat(req.params.id, req.body.text || '', req.body.message)));
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

// --- Visual identity (learned from the page's own posts) ---
const brandReply = (res, brand, message) => res.json({
  success: true, message,
  brand: brand ? { ...brand, logo_url: brand.logo ? `/media/${brand.logo}` : null, ref_urls: (brand.refs || []).map(f => ({ file: f, url: `/media/${f}` })) } : null
});
const brandFail = (res, err) => res.status(400).json({ success: false, message: err.response?.data?.error?.message || err.message });

router.post('/brand/learn', async (req, res) => {
  try { brandReply(res, await marketingService.learnBrand(), 'تعلّمنا هوية التصميم من صفحتك ✅'); } catch (e) { brandFail(res, e); }
});
router.post('/brand/reanalyze', async (req, res) => {
  try { brandReply(res, await marketingService.reanalyzeBrand(), 'حدّثنا هوية التصميم ✅'); } catch (e) { brandFail(res, e); }
});
router.post('/brand/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !/^image\//.test(req.file.mimetype)) throw new Error('ارفع ملف صورة (PNG / JPG)');
    const kind = req.body.kind === 'logo' ? 'logo' : 'ref';
    brandReply(res, await marketingService.addBrandFile(req.file.buffer, kind), kind === 'logo' ? 'تم حفظ اللوغو ✅' : 'تمت إضافة التصميم كمرجع ✅');
  } catch (e) { brandFail(res, e); }
});
router.post('/brand/remove', (req, res) => {
  try { brandReply(res, marketingService.removeBrandFile(String(req.body.file || '')), 'تم الحذف'); } catch (e) { brandFail(res, e); }
});

// --- Identity test: the brand designed on every medium (background job) ---
const brandKit = require('../services/brandKit');
router.get('/brand-kit', (req, res) => {
  res.json({ success: true, kit: brandKit.view(), media: brandKit.media.map(m => ({ key: m.key, title: m.title, group: m.group, aspect: m.aspect })) });
});
router.post('/brand-kit/start', (req, res) => {
  try {
    const keys = Array.isArray(req.body.keys) && req.body.keys.length ? req.body.keys.map(String) : null;
    res.json({ success: true, kit: brandKit.start({ keys, fresh: req.body.fresh === true }), message: 'بدأ التصميم — الصور بتظهر وحدة وحدة ✨' });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
});
router.post('/brand-kit/redo', (req, res) => {
  try {
    res.json({ success: true, kit: brandKit.redo(String(req.body.key || ''), req.body.note || ''), message: 'جاري إعادة التصميم…' });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
});

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
