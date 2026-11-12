/**
 * Smart post planner.
 *
 * Every morning: study the market (competitors, our own posts, what customers ask,
 * news) → 3 post topics → Telegram message to the admin. The admin then walks
 * through a multiple-choice wizard on the dashboard:
 *   topic → image → caption → time → the post is published automatically at that
 *   time on Facebook, Instagram and (optionally) a Telegram channel.
 *
 * A "plan" is one post going through those steps. Plans live in data/marketing.json.
 */
const fs = require('fs');
const path = require('path');
const storageService = require('./storageService');
const aiService = require('./aiService');
const knowledgeService = require('./knowledgeService');
const businessHours = require('./businessHours');
const research = require('./marketResearch');
const imageService = require('./imageService');
const publisher = require('./socialPublisher');
const telegram = require('./telegramService');

const FILE = path.join(storageService.getDataDir(), 'marketing.json');
const KEEP_PLANS = 80;
const LATE_LIMIT_MIN = 90; // a post that is this late (server was down) is not published blindly
const esc = telegram.esc;

const DEFAULTS = { enabled: true, morning_time: '09:00', language: 'en', free_image_fallback: true, publish_facebook: true, publish_instagram: true, publish_telegram_channel: false };

const FALLBACK_TOPICS = [
  { title: 'ليش العملاء بيروحوا لغيرك؟ سرعة الرد', angle: 'العميل اللي ما بينرد عليه بأول دقائق بيشتري من غيرك — كيف الرد الفوري بيرفع المبيعات.', why: 'مشكلة يومية عند أغلب الشركات', format: 'مشكلة وحل' },
  { title: '3 علامات إن شركتك بتخسر عملاء بدون ما تعرف', angle: 'رسائل بدون رد، متابعة ضايعة، وبيانات عملاء مبعثرة.', why: 'محتوى تعليمي بيخلي القارئ يشوف حاله فيه', format: 'تعليمي بنقاط' },
  { title: 'سؤال لأصحاب الشركات: كم رسالة بتوصلكم باليوم؟', angle: 'بوست تفاعلي بيفتح نقاش وبيجيب تعليقات من أصحاب القرار.', why: 'التعليقات بتتحول لمحادثات خاصة تلقائياً', format: 'تفاعلي / سؤال' },
  { title: 'قبل وبعد: يوم موظف المبيعات مع نظام ذكي', angle: 'مقارنة بسيطة بين الشغل اليدوي والشغل المؤتمت.', why: 'المقارنات بتوضح القيمة بسرعة', format: 'قبل / بعد' },
  { title: 'خرافة: "الشات بوت بيطفّش العملاء"', angle: 'الفرق بين بوت بردود جاهزة ونظام بيفهم العميل وبيحوله للموظف بالوقت الصح.', why: 'بيرد على اعتراض شائع', format: 'تصحيح مفهوم' },
  { title: 'كيف تعرف مين من عملائك جاهز يشتري؟', angle: 'تصنيف العملاء حسب الجاهزية بدل ما تتصل بالكل.', why: 'بيخاطب مدراء المبيعات مباشرة', format: 'نصيحة عملية' }
];

// Posts live in data/marketing.json AND in Supabase (app_settings, key "marketing"),
// so a redeploy or a wiped disk loses nothing. The day of the last morning message is
// stored with them, so it is never sent twice in one day after a restart.
const DB_KEY = 'marketing';
let dbDirty = false;
let dbTimer = null;

function read() {
  try {
    const data = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf-8')) : {};
    return { plans: Array.isArray(data.plans) ? data.plans : [], last_brief: data.last_brief || null, brand: data.brand || null };
  } catch (e) {
    console.error('[Marketing] cannot read marketing.json:', e.message);
    return { plans: [], last_brief: null, brand: null };
  }
}

function write(data, { fromDb = false } = {}) {
  data.plans = data.plans.slice(0, KEEP_PLANS);
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, FILE);
  if (fromDb) return;
  dbDirty = true;
  clearTimeout(dbTimer);
  dbTimer = setTimeout(() => syncToDb().catch(() => {}), 1500);
}

/** Mirror everything to Supabase. Failed writes stay dirty and are retried every minute. */
async function syncToDb() {
  const sb = require('./supabaseService');
  if (!dbDirty || !sb.isEnabled()) return false;
  dbDirty = false;
  const ok = await sb.saveKv(DB_KEY, { ...read(), saved_at: new Date().toISOString() });
  if (!ok) dbDirty = true;
  return ok;
}

function parseJson(text) {
  let c = String(text || '').trim().replace(/^```(json)?/, '').replace(/```$/, '').trim();
  const start = c.indexOf('{'); const end = c.lastIndexOf('}');
  if (start >= 0 && end > start) c = c.slice(start, end + 1);
  return JSON.parse(c);
}

class MarketingService {
  getConfig() {
    const m = { ...DEFAULTS, ...(storageService.getSettings().marketing || {}) };
    if (!/^\d{2}:\d{2}$/.test(m.morning_time || '')) m.morning_time = DEFAULTS.morning_time;
    return m;
  }

  // ---- storage ------------------------------------------------------------
  /**
   * On startup: if this server has no posts (new deploy / wiped disk) but the
   * database has them, bring them back. The newest copy wins.
   */
  async restoreFromDb() {
    const sb = require('./supabaseService');
    if (!sb.isEnabled()) return { restored: false };
    const remote = await sb.loadKv(DB_KEY);
    const local = read();
    const newest = (d) => Math.max(0, ...(d?.plans || []).map(p => new Date(p.updated_at || p.created_at || 0).getTime()));
    if (remote?.plans?.length && newest(remote) > newest(local)) {
      write({ plans: remote.plans, last_brief: remote.last_brief || local.last_brief, brand: remote.brand || local.brand }, { fromDb: true });
      console.log(`[Marketing] Restored ${remote.plans.length} posts from Supabase`);
      return { restored: true, count: remote.plans.length };
    }
    if (local.plans.length && newest(local) > newest(remote)) { dbDirty = true; await syncToDb(); }
    return { restored: false };
  }

  /** Scheduler: retry anything that did not reach the database yet (posts + images). */
  async syncDb() {
    await syncToDb();
    const d = read();
    const brandFiles = [d.brand?.logo, ...(d.brand?.refs || []), ...(d.brand?.kit?.items || []).flatMap(i => [i.file, ...(i.history || [])])];
    await imageService.backupMissing([...d.plans.flatMap(p => [p.image_file, ...(p.images || []).map(i => i.file)]), ...brandFiles].filter(Boolean));
  }

  dbStatus() {
    return { enabled: require('./supabaseService').isEnabled(), pending: dbDirty };
  }

  listPlans(){ return read().plans.map(p => this.view(p)); }
  getPlan(id) { return read().plans.find(p => p.id === id) || null; }
  allPlans() { return read().plans; }

  savePlan(plan) {
    const data = read();
    plan.updated_at = new Date().toISOString();
    const i = data.plans.findIndex(p => p.id === plan.id);
    if (i >= 0) data.plans[i] = plan; else data.plans.unshift(plan);
    write(data);
    return plan;
  }

  /** What the dashboard sees: adds image URLs and the final caption. */
  view(plan) {
    if (!plan) return null;
    return {
      ...plan,
      images: (plan.images || []).map(im => ({ ...im, url: im.file ? `/media/${im.file}` : '' })),
      topic: plan.topic || null,
      image: plan.image_file ? { file: plan.image_file, url: `/media/${plan.image_file}` } : null
    };
  }

  dashboardUrl() {
    const n = require('./notificationService').getConfig().dashboardUrl;
    return publisher.publicBaseUrl() || n || `http://localhost:${process.env.PORT || 3000}`;
  }

  // ---- AI -----------------------------------------------------------------
  companyBrief() {
    const custom = String(this.getConfig().business_description || '').trim();
    if (custom) return custom.slice(0, 2500);
    const kb = knowledgeService.getKnowledgeBase() || {};
    const parts = [
      kb.company_name ? `الشركة: ${kb.company_name}${kb.slogan ? ` — ${kb.slogan}` : ''}` : '',
      kb.positioning || '',
      kb.services ? `الخدمات: ${JSON.stringify(kb.services).slice(0, 1200)}` : '',
      kb.target_audience ? `الجمهور: ${JSON.stringify(kb.target_audience).slice(0, 400)}` : '',
      knowledgeService.getExtraKnowledge().slice(0, 500)
    ].filter(Boolean);
    return parts.join('\n') || 'شركة تقدم أنظمة مبيعات ذكية وأتمتة للشركات.';
  }

  /** On-image headline in the post language (an English post never gets Arabic text on the image). */
  headlineFor(headline, topic = {}) {
    const h = String(headline || '').trim().slice(0, 80);
    if (this.getConfig().language !== 'en') return h.slice(0, 80);
    if (h && !/[\u0600-\u06FF]/.test(h)) return h;
    const t = String(topic.title || '');
    return t && !/[\u0600-\u06FF]/.test(t) ? t.slice(0, 60) : 'Never miss a customer again';
  }

  langRule() {
    const l = this.getConfig().language;
    if (l === 'en') return 'اللغة: اكتب كل النصوص بالإنجليزية فقط (احترافية وودودة) — العنوان والكابشن والدعوة للتفاعل والهاشتاغات. ممنوع أي كلمة عربية.';
    if (l === 'both') return 'اكتب النص بالعربية (لهجة أردنية بيضاء خفيفة) ثم تحته ترجمة إنجليزية مختصرة.';
    return 'اكتب بالعربية بلهجة أردنية بيضاء خفيفة ومفهومة لكل العرب، بدون تكلّف.';
  }

  async aiJson(system, user, temperature = 0.85) {
    const { text } = await aiService.chatWithFailover(system, [], user, { json: true, temperature, timeout: 60000 });
    return parseJson(text);
  }

  recentTopics(days = 14) {
    const since = Date.now() - days * 86400000;
    return read().plans.filter(p => new Date(p.created_at).getTime() > since)
      .flatMap(p => [...(p.topic ? [p.topic.title] : (p.topics || []).map(t => t.title)), ...(p.rejected_topics || [])]).filter(Boolean).slice(0, 40);
  }

  async suggestTopics(r) {
    const today = businessHours.localParts();
    const system = `أنت مدير تسويق محتوى (Social Media Strategist) خبير بالسوق الأردني والعربي، وبتشتغل لهذه الشركة:
${this.companyBrief()}

مهمتك: اقتراح مواضيع بوستات لإنستغرام وفيسبوك هدفها تجيب عملاء فعليين (استفسارات ورسائل)، مش بس لايكات.`;
    const user = `اليوم: ${businessHours.DAY_NAMES[today.weekday]} ${today.dateKey}

=== دراسة السوق ===
${research.toPromptText(r)}

=== مواضيع اقترحناها آخر أسبوعين (ممنوع تكرارها أو تكرار فكرتها) ===
${this.recentTopics().map(t => `- ${t}`).join('\n') || '- لا يوجد'}

المطلوب: اقترح بالضبط 3 مواضيع لبوست اليوم، كل واحد من نوع مختلف (مثلاً: مشكلة وحل / إثبات ونتيجة / تفاعلي أو مرتبط بترند).
- اعتمد أولاً على شو بيسألوا العملاء فعلياً، وعلى اللي نجح عند المنافسين وعندنا.
- استلهم من المنافسين بس لا تنسخ منهم ولا تذكر أسماءهم.
- لا تذكر أسعار ولا وعود بأرقام غير موجودة بالبيانات.
${this.langRule()}

أعد JSON فقط بهذا الشكل:
{"market_summary":"جملتين عن أهم شي لاحظته بالسوق اليوم","topics":[{"title":"عنوان قصير وجذاب","angle":"الفكرة والزاوية بجملة أو جملتين","why":"ليش هذا الموضوع اليوم (على أي بيانات اعتمدت)","format":"نوع البوست"}]}`;
    try {
      const out = await this.aiJson(system, user);
      const topics = (out.topics || []).filter(t => t && t.title).slice(0, 3).map(t => ({
        title: String(t.title).slice(0, 140), angle: String(t.angle || '').slice(0, 500), why: String(t.why || '').slice(0, 300), format: String(t.format || '').slice(0, 60)
      }));
      if (topics.length) return { topics, market_summary: String(out.market_summary || '').slice(0, 600), ai: true };
    } catch (e) {
      console.error('[Marketing] topic suggestion failed:', e.response?.data?.error?.message || e.message);
    }
    // No working AI key → rotate through ready-made ideas so the flow still works.
    const used = new Set(this.recentTopics());
    const pool = [...FALLBACK_TOPICS.filter(t => !used.has(t.title)), ...FALLBACK_TOPICS];
    const start = Number(today.dateKey.replace(/-/g, '')) % pool.length;
    const topics = [0, 1, 2].map(i => pool[(start + i) % pool.length]).filter((t, i, a) => a.findIndex(x => x.title === t.title) === i);
    return { topics, market_summary: 'اقتراحات جاهزة (لا يوجد مفتاح ذكاء اصطناعي يعمل حالياً — أضف مفتاحاً في الإعدادات لتُبنى الاقتراحات على دراسة السوق).', ai: false };
  }

  // ---- visual identity (learned from the page's own posts) ------------------
  getBrand() { return read().brand || null; }

  saveBrand(brand) {
    const data = read();
    data.brand = { ...(data.brand || {}), ...brand, updated_at: new Date().toISOString() };
    write(data);
    return data.brand;
  }

  /** The design rules as one block of English for the image model and the art director. */
  brandDirection() {
    const b = this.getBrand();
    const g = b?.guide;
    const manual = String(this.getConfig().brand_style || '').trim();
    if (!g) return manual || 'Modern, clean, premium B2B tech brand. Deep navy and confident blue palette, generous white space, crisp sans-serif typography.';
    const palette = (g.palette || []).map(c => `${c.hex} (${c.role})`).join(', ');
    return [
      g.art_direction_en,
      palette && `Exact brand palette: ${palette}.`,
      g.typography && `Typography: ${g.typography}.`,
      g.layout && `Layout system: ${g.layout}.`,
      g.logo_usage && `Logo: ${g.logo_usage}.`,
      g.imagery && `Imagery: ${g.imagery}.`,
      (g.dont || []).length && `Never: ${g.dont.join('; ')}.`,
      manual && `Extra direction from the owner: ${manual}.`
    ].filter(Boolean).join(' ');
  }

  /** Logo + up to 3 of the page's own posts, sent to the image model as references. */
  brandImages({ max = 3 } = {}) {
    const b = this.getBrand();
    if (!b) return [];
    return [b.logo, ...(b.refs || []).slice(0, max)].filter(Boolean).map(f => imageService.dataUrl(f)).filter(Boolean);
  }

  /**
   * Learn the visual identity from the page's own Instagram (or Facebook) posts:
   * palette, type, layout, logo placement, mood — and keep the best posts as references.
   */
  async learnBrand() {
    const axios = require('axios');
    const meta = require('./metaService').config();
    const token = meta.page_access_token;
    if (!token) throw new Error('اربط فيسبوك وإنستغرام أول (سجّل دخول بفيسبوك من الإعدادات).');
    const G = 'https://graph.facebook.com/v21.0';
    const candidates = [];
    let profilePic = null;
    let account = '';
    if (meta.instagram_account_id) {
      try {
        const me = (await axios.get(`${G}/${meta.instagram_account_id}`, { params: { fields: 'username,profile_picture_url', access_token: token }, timeout: 15000 })).data;
        account = me.username ? `@${me.username}` : '';
        profilePic = me.profile_picture_url || null;
        const media = (await axios.get(`${G}/${meta.instagram_account_id}/media`, {
          params: { fields: 'media_type,media_url,thumbnail_url,like_count,comments_count,timestamp', limit: 30, access_token: token }, timeout: 20000
        })).data?.data || [];
        for (const m of media) {
          const url = m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url;
          if (url) candidates.push({ url, score: (m.like_count || 0) + (m.comments_count || 0) * 3, at: m.timestamp });
        }
      } catch (e) { console.warn('[Brand] Instagram media:', e.response?.data?.error?.message || e.message); }
    }
    if (candidates.length < 3 && meta.page_id) {
      try {
        const posts = (await axios.get(`${G}/${meta.page_id}/posts`, { params: { fields: 'full_picture,created_time', limit: 25, access_token: token }, timeout: 20000 })).data?.data || [];
        for (const p of posts) if (p.full_picture) candidates.push({ url: p.full_picture, score: 0, at: p.created_time });
        if (!account) account = 'صفحة فيسبوك';
      } catch (e) { console.warn('[Brand] Facebook posts:', e.response?.data?.error?.message || e.message); }
    }
    if (!candidates.length) throw new Error('ما لقينا صور منشورة على الصفحة نتعلم منها — ارفع صور تصاميمك واللوغو يدوياً.');

    // Best-performing first, then the most recent — 6 posts are enough to see the system.
    candidates.sort((a, b) => b.score - a.score || String(b.at).localeCompare(String(a.at)));
    const refs = [];
    for (const c of candidates.slice(0, 8)) {
      if (refs.length >= 6) break;
      try {
        const buf = Buffer.from((await axios.get(c.url, { responseType: 'arraybuffer', timeout: 20000 })).data);
        refs.push(await imageService.save(buf, 'ref'));
      } catch { /* skip */ }
    }
    if (!refs.length) throw new Error('ما قدرنا نحمّل صور الصفحة.');
    const current = this.getBrand() || {};
    let logo = current.logo || null;
    if (!logo && profilePic) {
      try { logo = await imageService.save(Buffer.from((await axios.get(profilePic, { responseType: 'arraybuffer', timeout: 15000 })).data), 'ref'); } catch { /* optional */ }
    }

    const guide = await this.analyzeBrand([...refs.slice(0, 5), logo].filter(Boolean));
    return this.saveBrand({ guide, refs, logo, source: account || 'الصفحة', posts_analyzed: refs.length, learned_at: new Date().toISOString(), logo_from_profile: !current.logo && !!logo });
  }

  /** A vision model reads the posts and writes the design system down. */
  async analyzeBrand(files) {
    const images = files.map(f => imageService.dataUrl(f)).filter(Boolean);
    const system = 'You are a senior brand designer. You reverse-engineer a company\'s visual identity from its published social media posts, precisely and concretely, so another designer can produce new posts that look like they came from the same studio.';
    const prompt = `These are published posts of the company (the last image may be its logo / profile picture).
Company: ${this.companyBrief().slice(0, 500)}

Extract the visual identity. Be specific (hex codes, positions, proportions), not generic.
Return JSON only:
{
 "summary_ar": "جملتين بالعربي تلخص الهوية البصرية",
 "palette": [{"hex":"#RRGGBB","role":"background | primary | accent | text"}],
 "typography": "font families/styles seen (e.g. bold geometric Arabic sans for headlines, size hierarchy, weight, alignment, RTL)",
 "layout": "grid, margins, where the headline sits, how much text, use of shapes/cards/frames",
 "logo_usage": "where and how big the logo appears",
 "imagery": "photo vs 3D vs illustration, lighting, people, objects, textures",
 "text_on_image": "how much text appears on the posts and in which language",
 "mood": "3-5 adjectives",
 "do": ["..."],
 "dont": ["..."],
 "art_direction_en": "One dense paragraph (80-120 words) instructing an image model to produce a new post in exactly this identity."
}`;
    const g = await aiService.visionJson(system, prompt, images);
    if (!g || !g.art_direction_en) throw new Error('ما قدر الذكاء الاصطناعي يحلل التصاميم — جرّب مرة ثانية.');
    g.palette = (g.palette || []).filter(c => /^#[0-9a-f]{6}$/i.test(c.hex || '')).slice(0, 8);
    return g;
  }

  /** Logo or extra design reference uploaded by the owner. */
  async addBrandFile(buffer, kind = 'ref') {
    const file = await imageService.save(buffer, 'ref');
    const b = this.getBrand() || {};
    if (kind === 'logo') return this.saveBrand({ logo: file, logo_from_profile: false });
    return this.saveBrand({ refs: [file, ...(b.refs || [])].slice(0, 8) });
  }

  removeBrandFile(file) {
    const b = this.getBrand() || {};
    if (b.logo === file) return this.saveBrand({ logo: null });
    return this.saveBrand({ refs: (b.refs || []).filter(f => f !== file) });
  }

  /** Re-read the identity from the current references (after adding/removing some). */
  async reanalyzeBrand() {
    const b = this.getBrand() || {};
    const files = [...(b.refs || []).slice(0, 5), b.logo].filter(Boolean);
    if (!files.length) throw new Error('ما في صور مرجعية — اضغط «تعلّم من صفحتي» أو ارفع تصاميمك.');
    return this.saveBrand({ guide: await this.analyzeBrand(files), learned_at: new Date().toISOString() });
  }

  /**
   * Art director: 3 different concepts for this post, each in the page's identity,
   * each with a short on-image headline.
   */
  async imagePrompts(topic) {
    const brand = this.brandDirection();
    const lang = this.getConfig().language;
    const headlineLang = lang === 'en' ? 'English' : 'Arabic (Levantine-friendly, simple Modern Standard wording)';
    const fixed = (headline) => [
      'Format: vertical 4:5 Instagram/Facebook feed post, 1080x1350, social-ad quality, sharp and print-clean.',
      'The reference images show this brand\'s REAL published posts and logo: match their palette, typography style, layout system, spacing and finish so the new post looks like it came from the same designer. Do not copy their wording or photos.',
      headline ? `Render this headline exactly, letter for letter, correctly shaped and right-to-left if Arabic, large and legible, as the only text on the image: "${headline}".` : 'No text on the image.',
      'Place the brand logo from the references small and clean in a corner with safe margins (if a logo is provided).',
      'No watermarks, no fake UI text, no gibberish letters, no extra captions, no borders unless the references use them.'
    ].join(' ');
    try {
      const out = await this.aiJson(
        `You are the creative director of a top social-media design studio in Amman. You design scroll-stopping, on-brand B2B posts that make business owners message the company. You think in visual hierarchy: one idea, one focal point, one headline.`,
        `Company: ${this.companyBrief().slice(0, 600)}
Post topic: ${topic.title}
Idea: ${topic.angle || ''}

BRAND IDENTITY (follow strictly):
${brand}

Create exactly 3 DIFFERENT post concepts, each a different composition but all clearly the same brand:
A) a human, photographic scene (Arab business owner / team in a real Jordanian workplace) with the headline on a brand-colour panel,
B) a bold typographic layout where the headline is the hero, supported by one simple icon or 3D object,
C) a conceptual visual metaphor (before/after, problem/solution, or a striking object) with the headline.
For each concept write:
- "headline": 3-7 words in ${headlineLang}, punchy, a hook (no prices, no promises with numbers),
- "prompt": 90-140 words in English for the image model: subject, composition (where the headline sits, where the focal point is), camera/lens or render style, lighting, exact brand colours by hex, materials, mood.
Return JSON only: {"concepts":[{"style":"اسم المفهوم بالعربي (كلمتين)","headline":"...","prompt":"..."}]}`, 0.85);
      const list = (out.concepts || out.prompts || []).filter(p => p && p.prompt).slice(0, 3).map(p => ({
        style: String(p.style || 'تصميم').slice(0, 40),
        headline: this.headlineFor(p.headline, topic),
        prompt: `${String(p.prompt).slice(0, 1200)} BRAND: ${brand} ${fixed(this.headlineFor(p.headline, topic))}`
      }));
      if (list.length) return list;
    } catch (e) {
      console.error('[Marketing] image prompts failed:', e.response?.data?.error?.message || e.message);
    }
    const subject = `${topic.title}. ${topic.angle || ''}`.slice(0, 300);
    const h = this.headlineFor(topic.title, topic);
    return [
      { style: 'صورة واقعية', headline: h, prompt: `Photorealistic scene of a confident Arab business owner in a modern Amman office reviewing customer messages on a phone, concept: ${subject}. Natural window light, 50mm lens, shallow depth of field, headline on a solid brand-colour panel at the top. BRAND: ${brand} ${fixed(h)}` },
      { style: 'تصميم طباعي', headline: h, prompt: `Bold typographic post: the headline is the hero, centred, supported by one glossy 3D chat-bubble icon, clean background in the brand colours, generous margins. Concept: ${subject}. BRAND: ${brand} ${fixed(h)}` },
      { style: 'فكرة بصرية', headline: h, prompt: `Conceptual visual metaphor for: ${subject}. One striking object, studio lighting, minimal set, strong contrast, headline in the upper third. BRAND: ${brand} ${fixed(h)}` }
    ];
  }

  async captions(topic) {
    const system = `أنت كاتب محتوى سوشال ميديا محترف (Copywriter) لهذه الشركة:
${this.companyBrief()}`;
    const user = `اكتب 3 كابشنات مختلفة لبوست إنستغرام/فيسبوك عن:
العنوان: ${topic.title}
الفكرة: ${topic.angle || ''}

الأنماط الثلاثة:
1) "قصير وجذاب": 2-3 أسطر، هوك قوي بأول سطر.
2) "قصة ومشكلة-حل": 5-7 أسطر قصيرة، بتبدأ بموقف بيعرفه صاحب الشغل.
3) "تعليمي بنقاط": 3-4 نقاط مرقمة أو بإيموجي، كل نقطة سطر.

قواعد:
- أول سطر لازم يوقف التمرير (سؤال أو جملة صادمة بلطف).
- آخر سطر دعوة واضحة للتفاعل: ${this.getConfig().language === 'en' ? 'إما "Comment DETAILS and we will DM you" أو "Send us a message"' : 'إما "اكتب (تفاصيل) بالتعليقات وبنبعتلك على الخاص" أو "راسلنا على الخاص"'} — (البوت عندنا بيرد على التعليقات تلقائياً ويحولها لمحادثة خاصة).
- إيموجي باعتدال، بدون مبالغة ولا وعود كاذبة ولا أسعار.
- لا تستخدم Markdown (لا ** ولا #) داخل النص.
- لكل كابشن 5-8 هاشتاغات مناسبة ${this.getConfig().language === 'en' ? '(بالإنجليزية فقط)' : '(عربي وإنجليزي)'} بحقل منفصل.
${this.langRule()}

أعد JSON فقط: {"captions":[{"style":"قصير وجذاب","text":"...","hashtags":["#..."]}]}`;
    try {
      const out = await this.aiJson(system, user);
      const list = (out.captions || []).filter(c => c && c.text).slice(0, 3).map(c => ({
        style: String(c.style || '').slice(0, 40),
        text: aiService.toPlainText(String(c.text)).slice(0, 1800),
        hashtags: (Array.isArray(c.hashtags) ? c.hashtags : String(c.hashtags || '').split(/\s+/))
          .map(h => String(h).trim().replace(/\s+/g, '_')).filter(Boolean).map(h => (h.startsWith('#') ? h : `#${h}`)).slice(0, 10)
      }));
      if (list.length) return list;
    } catch (e) {
      console.error('[Marketing] captions failed:', e.response?.data?.error?.message || e.message);
    }
    if (this.getConfig().language === 'en') {
      const etags = ['#atlead', '#SalesAutomation', '#AI', '#Chatbot', '#CustomerExperience', '#Jordan', '#SmallBusiness'];
      const hasAr = (t) => /[\u0600-\u06FF]/.test(t || '');
      const title = hasAr(topic.title) ? 'Never lose a customer to a late reply' : topic.title;
      const angle = hasAr(topic.angle) ? 'Customers buy from whoever answers first. An AI sales assistant replies in seconds, day and night.' : (topic.angle || '');
      const ecta = 'Comment "DETAILS" and we will send you everything in a private message.';
      return [
        { style: 'Short hook', text: `${title}\n${angle}\n\n${ecta}`, hashtags: etags },
        { style: 'Problem and solution', text: `Most businesses face this every single day.\n${angle || title}\n\nThe answer is not more staff. It is a system that works with you 24/7.\n\n${ecta}`, hashtags: etags },
        { style: 'Educational', text: `${title}\n\n- Faster replies to every customer\n- No follow-up slips through\n- All customer data in one place\n\n${ecta}`, hashtags: etags }
      ];
    }
    const tags = ['#atlead', '#مبيعات', '#أتمتة', '#ذكاء_اصطناعي', '#الأردن', '#AI', '#Sales'];
    const cta = 'اكتب "تفاصيل" بالتعليقات وبنبعتلك على الخاص 👇';
    return [
      { style: 'قصير وجذاب', text: `${topic.title} 🤔\n${topic.angle || ''}\n\n${cta}`, hashtags: tags },
      { style: 'مشكلة وحل', text: `كتير شركات بتواجه هالشي كل يوم 👇\n${topic.angle || topic.title}\n\nالحل مش موظفين أكتر — الحل نظام بيشتغل معك 24/7.\n\n${cta}`, hashtags: tags },
      { style: 'تعليمي', text: `${topic.title}\n\n✅ رد أسرع على العملاء\n✅ متابعة ما بتضيع\n✅ بيانات مرتبة بمكان واحد\n\n${cta}`, hashtags: tags }
    ];
  }

  // ---- wizard steps -------------------------------------------------------
  /** Step 1: a new plan with 3 topics (or straight to images when a topic is given). */
  async createPlan({ source = 'manual', customTopic = '', inspiredBy = '', refresh = false } = {}) {
    const plan = {
      id: `plan_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      date: businessHours.localParts().dateKey,
      source,
      status: 'topic',
      created_at: new Date().toISOString()
    };
    if (String(customTopic).trim()) {
      plan.topics = [];
      this.savePlan(plan);
      return this.chooseTopic(plan.id, { custom: customTopic, inspiredBy });
    }
    const r = await research.gather({ refresh });
    const { topics, market_summary, ai } = await this.suggestTopics(r);
    Object.assign(plan, { topics, market_summary, ai_topics: ai });
    return this.savePlan(plan);
  }

  mustGet(id, allowed = null) {
    const plan = this.getPlan(id);
    if (!plan) throw new Error('الخطة غير موجودة');
    if (allowed && !allowed.includes(plan.status)) throw new Error('هذه الخطوة غير متاحة بالحالة الحالية للبوست');
    return plan;
  }

  /** Step 2: topic chosen → generate the images to choose from. */
  async chooseTopic(id, { index = null, custom = '', inspiredBy = '' } = {}) {
    const plan = this.mustGet(id, ['topic', 'image', 'caption', 'time']);
    if (String(custom).trim()) {
      plan.topic = {
        title: String(custom).trim().slice(0, 140),
        angle: inspiredBy
          ? `بوست بأسلوبنا وبمعلوماتنا عن نفس الموضوع اللي نجح بالسوق (بدون نسخ): ${String(inspiredBy).replace(/\s+/g, ' ').slice(0, 300)}`
          : '',
        why: inspiredBy ? 'موضوع أثبت نجاحه عند المنافسين' : 'موضوع من اختيارك', format: '', custom: true
      };
      plan.topic_index = null;
    } else {
      const t = (plan.topics || [])[Number(index)];
      if (!t) throw new Error('اختار موضوع من القائمة');
      plan.topic = t;
      plan.topic_index = Number(index);
    }
    Object.assign(plan, { status: 'image', images: [], image_file: null, captions: [], caption: null, times: [], scheduled_at: null });
    this.savePlan(plan);
    return this.generateImages(id);
  }

  async generateImages(id) {
    const plan = this.mustGet(id, ['image', 'caption', 'time']);
    imageService.resetCooldown(); // a person asked for images now — retry every model
    const prompts = await this.imagePrompts(plan.topic);
    const made = await imageService.generateMany(prompts, this.brandImages());
    const fresh = this.mustGet(id);
    // Keep earlier good images (e.g. an uploaded one) and add the new ones.
    fresh.images = [...made.filter(m => m.file).map(m => ({ file: m.file, style: m.style, engine: m.engine, headline: m.headline || '' })), ...(fresh.images || []).filter(im => im.file)].slice(0, 16);
    fresh.image_error = made.every(m => m.error) ? made[0]?.error || 'تعذر توليد الصور' : '';
    fresh.status = 'image';
    return this.savePlan(fresh);
  }

  /** The admin uploaded their own image instead of (or in addition to) the generated ones. */
  async addUploadedImage(id, buffer) {
    const plan = this.mustGet(id, ['image', 'caption', 'time']);
    const file = await imageService.save(buffer);
    plan.images = [{ file, style: 'صورتك', engine: 'upload' }, ...(plan.images || [])];
    plan.image_error = '';
    return this.savePlan(plan);
  }

  /**
   * Image chat: edit one of the images by instruction. The result is added as a new
   * version next to the original, so nothing is lost and you can compare.
   */
  async editImage(id, file, message) {
    const plan = this.mustGet(id, ['image', 'caption', 'time']);
    const msg = String(message || '').trim().slice(0, 600);
    if (!msg) throw new Error('اكتب التعديل المطلوب');
    const src = (plan.images || []).find(im => im.file === file);
    if (!src) throw new Error('اختار صورة من القائمة');
    imageService.resetCooldown();
    const history = (plan.image_chat || []).filter(m => m.target === file || m.result === file).slice(-6)
      .map(m => `- ${m.role === 'user' ? 'Owner asked' : 'Done'}: ${m.text}`).join('\n');
    const prompt = [
      'You are a senior designer editing the FIRST attached image (an existing social-media post).',
      `Apply this change requested by the owner (may be in Arabic): "${msg}".`,
      'Change only what is asked. Keep everything else the same: composition, headline wording and spelling, logo, colours, style and 4:5 framing — unless the request says otherwise.',
      'If the request changes text, render the new text exactly, correctly shaped right-to-left for Arabic.',
      history && `Earlier edits on this design:\n${history}`,
      `Brand identity to stay within: ${this.brandDirection()}`,
      'The other attached images (if any) are the brand logo and published posts — use them only as style references.'
    ].filter(Boolean).join('\n');
    const r = await imageService.edit(file, prompt, this.brandImages({ max: 1 }));
    const fresh = this.mustGet(id);
    const version = (fresh.images || []).filter(im => im.parent === file || im.root === (src.root || file)).length + 1;
    fresh.images = [{ file: r.file, style: `تعديل ${version}`, engine: r.engine, parent: file, root: src.root || file, note: msg, headline: src.headline || '' }, ...(fresh.images || [])].slice(0, 16);
    fresh.image_chat = [...(fresh.image_chat || []),
      { role: 'user', text: msg, target: file, at: new Date().toISOString() },
      { role: 'assistant', text: 'تم التعديل.', result: r.file, target: file, at: new Date().toISOString() }].slice(-40);
    fresh.image_error = '';
    return this.savePlan(fresh);
  }

  /**
   * Caption chat: rewrite the caption by instruction ("shorter", "more formal", "add a question").
   * Returns the plan with caption_draft updated; nothing is chosen until you approve it.
   */
  async captionChat(id, current, message) {
    const plan = this.mustGet(id, ['caption', 'time']);
    const msg = String(message || '').trim().slice(0, 600);
    const text = String(current || plan.caption_draft || plan.caption || '').trim();
    if (!msg) throw new Error('اكتب التعديل المطلوب');
    if (!text) throw new Error('اختار أو اكتب كابشن أول');
    const history = (plan.caption_chat || []).slice(-8).map(m => `${m.role === 'user' ? 'صاحب الشركة' : 'أنت'}: ${m.text}`).join('\n');
    const voice = this.getBrand()?.guide?.mood ? `نبرة الهوية: ${this.getBrand().guide.mood}` : '';
    const out = await this.aiJson(
      `أنت كاتب محتوى سوشال ميديا محترف لهذه الشركة:
${this.companyBrief()}
${voice}
بتعدّل الكابشن حسب طلب صاحب الشركة بالزبط، وبتحافظ على باقي الكابشن إلا إذا طلب غير هيك. بدون Markdown، بدون أسعار، والدعوة للتفاعل بآخره بتضل.`,
      `موضوع البوست: ${plan.topic?.title || ''}
الكابشن الحالي:
"""
${text}
"""
${history ? `المحادثة لحد هلق:\n${history}\n` : ''}الطلب الجديد: ${msg}
${this.langRule()}

أعد JSON فقط: {"caption":"الكابشن كامل بعد التعديل مع الهاشتاغات بآخره","reply":"جملة قصيرة شو غيّرت"}`, 0.6);
    const caption = aiService.toPlainText(String(out.caption || '')).slice(0, 2200);
    if (!caption) throw new Error('ما قدر الذكاء الاصطناعي يعدّل — جرّب صياغة ثانية');
    plan.caption_draft = caption;
    plan.caption_chat = [...(plan.caption_chat || []),
      { role: 'user', text: msg, at: new Date().toISOString() },
      { role: 'assistant', text: String(out.reply || 'تم التعديل').slice(0, 300), caption, at: new Date().toISOString() }].slice(-40);
    return this.savePlan(plan);
  }

  /** Step 3: image chosen → write the captions to choose from. */
  async chooseImage(id, index) {
    const plan = this.mustGet(id, ['image', 'caption', 'time']);
    const im = (plan.images || [])[Number(index)];
    if (!im?.file) throw new Error('اختار صورة من القائمة');
    plan.image_file = im.file;
    plan.status = 'caption';
    if (!plan.captions?.length) plan.captions = await this.captions(plan.topic);
    return this.savePlan(plan);
  }

  async regenerate(id, step) {
    const plan = this.mustGet(id, ['topic', 'image', 'caption', 'time']);
    if (step === 'topics') {
      const r = await research.gather();
      // Remember the rejected ones so the new list is different.
      plan.rejected_topics = [...(plan.rejected_topics || []), ...(plan.topics || []).map(t => t.title)].slice(-30);
      this.savePlan(plan);
      const { topics, market_summary, ai } = await this.suggestTopics(r);
      Object.assign(plan, { topics, market_summary, ai_topics: ai, status: 'topic', topic: null });
      return this.savePlan(plan);
    }
    if (step === 'images') return this.generateImages(id);
    if (step === 'captions') {
      plan.captions = await this.captions(plan.topic);
      plan.caption = null;
      if (plan.status === 'time') plan.status = 'caption';
      return this.savePlan(plan);
    }
    throw new Error('خطوة غير معروفة');
  }

  /** Step 4: caption chosen (optionally edited) → offer the best times. */
  async chooseCaption(id, { index = null, text = '' } = {}) {
    const plan = this.mustGet(id, ['caption', 'time']);
    let final = String(text || '').trim();
    if (!final) {
      const c = (plan.captions || [])[Number(index)];
      if (!c) throw new Error('اختار كابشن من القائمة');
      final = `${c.text}\n\n${(c.hashtags || []).join(' ')}`.trim();
    }
    plan.caption = final.slice(0, 2200);
    plan.caption_index = index === null ? null : Number(index);
    const r = await research.gather().catch(() => ({ own_posts: [] }));
    plan.times = research.bestTimes(r.own_posts || [], 3);
    plan.status = 'time';
    return this.savePlan(plan);
  }

  /** Step 5: time chosen → scheduled (or published right away with now = true). */
  async schedule(id, { index = null, iso = '', now = false } = {}) {
    const plan = this.mustGet(id, ['time', 'scheduled', 'failed']);
    if (!plan.image_file || !plan.caption) throw new Error('البوست ناقص صورة أو كابشن');
    if (now) {
      plan.scheduled_at = new Date().toISOString();
      plan.scheduled_label = 'الآن';
      plan.status = 'scheduled';
      this.savePlan(plan);
      return this.publishPlan(id);
    }
    let at = null; let label = '';
    if (iso) {
      at = new Date(iso);
      if (Number.isNaN(at.getTime())) throw new Error('وقت غير صحيح');
      if (at.getTime() < Date.now() + 60 * 1000) throw new Error('الوقت لازم يكون بالمستقبل');
      label = at.toLocaleString('en-GB', { timeZone: businessHours.getConfig().timezone, hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } else {
      const t = (plan.times || [])[Number(index)];
      if (!t) throw new Error('اختار وقت من القائمة');
      at = new Date(t.iso);
      label = t.label;
      if (at.getTime() < Date.now()) throw new Error('هذا الوقت قد مضى — اختر وقتاً آخر');
    }
    Object.assign(plan, { scheduled_at: at.toISOString(), scheduled_label: label, status: 'scheduled', results: null, error: '' });
    return this.savePlan(plan);
  }

  cancel(id) {
    const plan = this.mustGet(id);
    if (['published', 'publishing'].includes(plan.status)) throw new Error('البوست انتشر — ما بينفع إلغاؤه من هون');
    plan.status = 'cancelled';
    return this.savePlan(plan);
  }

  // ---- publishing ---------------------------------------------------------
  async publishPlan(id, only = null) {
    const plan = this.mustGet(id, ['scheduled', 'failed', 'partial']);
    // Restored from the database storage if this server lost the file.
    const filePath = await imageService.ensureLocal(plan.image_file);
    if (!filePath) {
      Object.assign(plan, { status: 'failed', error: 'ملف الصورة غير موجود على الخادم' });
      return this.savePlan(plan);
    }
    const before = plan.results || {};
    plan.status = 'publishing';
    this.savePlan(plan);

    // On a retry, only the channels that did not succeed are attempted again.
    const retry = only || (Object.keys(before).length ? Object.keys(before).filter(k => !before[k].ok) : null);
    let results = {};
    try {
      results = await publisher.publish({ filePath, fileName: plan.image_file, caption: plan.caption }, retry);
    } catch (e) {
      results = { _error: { ok: false, error: e.message } };
    }
    const fresh = this.mustGet(id);
    fresh.results = { ...before, ...results };
    const vals = Object.values(fresh.results);
    const ok = vals.filter(v => v.ok).length;
    fresh.status = !vals.length ? 'failed' : ok === vals.length ? 'published' : ok ? 'partial' : 'failed';
    fresh.error = !vals.length ? 'ما في أي منصة مفعّلة للنشر — فعّل فيسبوك/إنستغرام من إعدادات التسويق' : '';
    fresh.published_at = ok ? new Date().toISOString() : fresh.published_at || null;
    this.savePlan(fresh);
    this.notifyPublished(fresh).catch(() => {});
    return fresh;
  }

  async notifyPublished(plan) {
    if (!telegram.isConfigured()) return;
    const ch = publisher.channels();
    const lines = Object.entries(plan.results || {}).map(([k, v]) =>
      v.ok ? `✅ ${ch[k]?.label || k}${v.url ? ` — <a href="${esc(v.url)}">فتح البوست</a>` : ''}` : `❌ ${ch[k]?.label || k}: ${esc(v.error || 'فشل')}`);
    const head = plan.status === 'published' ? '🚀 <b>البوست انتشر</b>' : plan.status === 'partial' ? '⚠️ <b>البوست انتشر جزئياً</b>' : '❌ <b>فشل نشر البوست</b>';
    await telegram.sendMessage(`${head}\n📌 ${esc(plan.topic?.title || '')}\n\n${lines.join('\n') || esc(plan.error || '')}`, {
      buttons: [[{ text: 'فتح لوحة التسويق', url: `${this.dashboardUrl()}/?tab=marketing&plan=${plan.id}` }]], type: 'publish_result'
    });
  }

  /** Scheduler (every minute): publish the posts whose time has come. */
  async publishDue() {
    const now = Date.now();
    for (const p of read().plans) {
      if (p.status !== 'scheduled' || !p.scheduled_at) continue;
      const at = new Date(p.scheduled_at).getTime();
      if (at > now) continue;
      if (now - at > LATE_LIMIT_MIN * 60000) {
        // The server was down at the chosen time: don't post at a random hour — ask the admin.
        const plan = this.getPlan(p.id);
        Object.assign(plan, { status: 'failed', error: `فات موعد النشر (${p.scheduled_label || ''}) لأن الخادم كان متوقفاً — اختر وقتاً جديداً أو انشر الآن.` });
        this.savePlan(plan);
        telegram.sendMessage(`⏰ <b>فات موعد بوست</b>\n📌 ${esc(plan.topic?.title || '')}\n${esc(plan.error)}`, {
          buttons: [[{ text: 'اختار وقت جديد', url: `${this.dashboardUrl()}/?tab=marketing&plan=${plan.id}` }]], type: 'missed_post'
        }).catch(() => {});
        continue;
      }
      console.log(`[Marketing] publishing scheduled post ${p.id}`);
      await this.publishPlan(p.id).catch(e => console.error('[Marketing] publish error:', e.message));
    }
    // A crash mid-publish leaves "publishing" forever → surface it instead of hiding it.
    for (const p of read().plans) {
      if (p.status === 'publishing' && now - new Date(p.updated_at).getTime() > 15 * 60000) {
        const plan = this.getPlan(p.id);
        Object.assign(plan, { status: 'failed', error: 'النشر انقطع (السيرفر أعاد التشغيل) — تأكد من الصفحة قبل ما تعيد المحاولة حتى ما يتكرر البوست.' });
        this.savePlan(plan);
      }
    }
  }

  // ---- morning brief ------------------------------------------------------
  briefMessage(plan) {
    const base = this.dashboardUrl();
    const link = `${base}/?tab=marketing&plan=${plan.id}`;
    const nums = ['1️⃣', '2️⃣', '3️⃣'];
    const text = [
      '☀️ <b>صباح الخير! اقتراحات بوست اليوم</b>',
      plan.market_summary ? `\n📊 <b>السوق اليوم:</b> ${esc(plan.market_summary)}` : '',
      '',
      ...(plan.topics || []).map((t, i) => `${nums[i] || '•'} <b>${esc(t.title)}</b>${t.format ? ` <i>(${esc(t.format)})</i>` : ''}\n${esc(t.angle)}${t.why ? `\n💡 ${esc(t.why)}` : ''}\n`),
      `👇 اختار الموضوع، وبعدها الصورة والكابشن ووقت النشر:\n${esc(link)}`
    ].filter(l => l !== '').join('\n');
    const buttons = [
      ...(plan.topics || []).map((t, i) => [{ text: `${nums[i] || ''} ${t.title}`.slice(0, 60), url: `${link}&topic=${i}` }]),
      [{ text: '✏️ بدي موضوع ثاني', url: link }]
    ];
    return { text, buttons };
  }

  /** Create today's plan and send it to the admin on Telegram. */
  async sendBrief({ source = 'morning' } = {}) {
    const plan = await this.createPlan({ source, refresh: true });
    const { text, buttons } = this.briefMessage(plan);
    const sent = await telegram.sendMessage(text, { buttons, type: 'morning_brief' });
    plan.telegram_sent = sent.success;
    this.savePlan(plan);
    return { plan, sent };
  }

  /** Scheduler: once a day at the configured time (never hours late, e.g. after a restart at night). */
  async maybeSendMorningBrief() {
    const cfg = this.getConfig();
    if (!cfg.enabled || !telegram.isConfigured()) return null;
    const now = businessHours.localParts();
    const start = businessHours.toMinutes(cfg.morning_time);
    if (now.minutes < start || now.minutes > start + 6 * 60) return null;
    const data = read();
    if (data.last_brief === now.dateKey) return null;
    data.last_brief = now.dateKey;
    write(data); // saved to the database too → never twice a day, even after a redeploy
    const res = await this.sendBrief();
    console.log(`[Marketing] morning brief ${now.dateKey}: ${res.sent.success ? 'sent' : 'not sent — ' + res.sent.error}`);
    return res;
  }

  // ---- dashboard ----------------------------------------------------------
  overview() {
    const tg = telegram.getConfig();
    return {
      config: this.getConfig(),
      telegram: { configured: telegram.isConfigured(), has_token: !!tg.token, chat_ids: tg.chatIds },
      channels: publisher.channels(),
      public_url: publisher.publicBaseUrl(),
      ai_ready: aiService.getProviders().length > 0,
      brand: (() => { const b = this.getBrand(); return b ? { ...b, logo_url: b.logo ? `/media/${b.logo}` : null, ref_urls: (b.refs || []).map(f => ({ file: f, url: `/media/${f}` })) } : null; })(),
      image_engine: imageService.attempts().map(a => imageService.label(a))[0] || '',
      plans: this.listPlans().slice(0, 40)
    };
  }
}

module.exports = new MarketingService();
