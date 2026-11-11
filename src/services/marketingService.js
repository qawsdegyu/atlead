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

const DEFAULTS = { enabled: true, morning_time: '09:00', language: 'ar', free_image_fallback: true, publish_facebook: true, publish_instagram: true, publish_telegram_channel: false };

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
    return { plans: Array.isArray(data.plans) ? data.plans : [], last_brief: data.last_brief || null };
  } catch (e) {
    console.error('[Marketing] cannot read marketing.json:', e.message);
    return { plans: [], last_brief: null };
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
      write({ plans: remote.plans, last_brief: remote.last_brief || local.last_brief }, { fromDb: true });
      console.log(`[Marketing] Restored ${remote.plans.length} posts from Supabase`);
      return { restored: true, count: remote.plans.length };
    }
    if (local.plans.length && newest(local) > newest(remote)) { dbDirty = true; await syncToDb(); }
    return { restored: false };
  }

  /** Scheduler: retry anything that did not reach the database yet (posts + images). */
  async syncDb() {
    await syncToDb();
    await imageService.backupMissing(read().plans.flatMap(p => [p.image_file, ...(p.images || []).map(i => i.file)]).filter(Boolean));
  }

  dbStatus() {
    return { enabled: require('./supabaseService').isEnabled(), pending: dbDirty };
  }

  listPlans(){ return read().plans.map(p => this.view(p)); }
  getPlan(id) { return read().plans.find(p => p.id === id) || null; }

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

  langRule() {
    const l = this.getConfig().language;
    if (l === 'en') return 'اكتب كل النصوص بالإنجليزية (احترافي وودود).';
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
    return { topics, market_summary: 'اقتراحات جاهزة (ما في مفتاح AI شغال حالياً — اربط مفتاح بالإعدادات عشان الاقتراحات تنبني على دراسة السوق).', ai: false };
  }

  async imagePrompts(topic) {
    const brand = String(this.getConfig().brand_style || '').trim() || 'modern, clean, professional tech brand; deep navy and sky-blue palette with soft glow';
    const rules = 'Square 1:1 social media post image. Absolutely no text, no letters, no numbers, no logos, no watermarks. High quality, eye-catching, uncluttered composition with one clear focal point.';
    try {
      const out = await this.aiJson(
        'You are a senior art director for social media ads. You write short, vivid prompts for an AI image generator.',
        `Company: ${this.companyBrief().slice(0, 600)}
Post topic: ${topic.title}
Idea: ${topic.angle}
Brand look: ${brand}

Write exactly 3 DIFFERENT image prompts in English for this post, each in a different visual style:
1) photorealistic scene with people or a real workplace (Middle Eastern / Arab business context),
2) polished 3D illustration,
3) minimal conceptual graphic / visual metaphor.
Each prompt: 40-70 words, describes subject, setting, lighting, mood and colors. ${rules}
Return JSON only: {"prompts":[{"style":"اسم الستايل بالعربي (كلمتين)","prompt":"..."}]}`, 0.9);
      const list = (out.prompts || []).filter(p => p && p.prompt).slice(0, 3).map(p => ({ style: String(p.style || 'تصميم').slice(0, 40), prompt: `${String(p.prompt).slice(0, 700)} ${rules}` }));
      if (list.length) return list;
    } catch (e) {
      console.error('[Marketing] image prompts failed:', e.response?.data?.error?.message || e.message);
    }
    const subject = `${topic.title}. ${topic.angle || ''}`.slice(0, 300);
    return [
      { style: 'صورة واقعية', prompt: `Photorealistic photo of a confident Arab business owner in a modern office using a laptop and smartphone, concept: ${subject}. Natural light, shallow depth of field. ${brand}. ${rules}` },
      { style: 'رسم ثلاثي الأبعاد', prompt: `Polished 3D illustration, concept: ${subject}. Floating chat bubbles, charts and a friendly robot assistant, soft studio lighting. ${brand}. ${rules}` },
      { style: 'تصميم بسيط', prompt: `Minimal conceptual graphic, visual metaphor for: ${subject}. Simple geometric shapes, lots of negative space, bold contrast. ${brand}. ${rules}` }
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
- آخر سطر دعوة واضحة للتفاعل: إما "اكتب (تفاصيل) بالتعليقات وبنبعتلك على الخاص" أو "راسلنا على الخاص" — (البوت عندنا بيرد على التعليقات تلقائياً ويحولها لمحادثة خاصة).
- إيموجي باعتدال، بدون مبالغة ولا وعود كاذبة ولا أسعار.
- لا تستخدم Markdown (لا ** ولا #) داخل النص.
- لكل كابشن 5-8 هاشتاغات مناسبة (عربي وإنجليزي) بحقل منفصل.
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
    const prompts = await this.imagePrompts(plan.topic);
    const made = await imageService.generateMany(prompts);
    const fresh = this.mustGet(id);
    // Keep earlier good images (e.g. an uploaded one) and add the new ones.
    fresh.images = [...made.filter(m => m.file).map(m => ({ file: m.file, style: m.style, engine: m.engine })), ...(fresh.images || []).filter(im => im.file)].slice(0, 9);
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
      if (at.getTime() < Date.now()) throw new Error('هذا الوقت عدّى — اختار وقت ثاني');
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
      Object.assign(plan, { status: 'failed', error: 'ملف الصورة مش موجود على السيرفر' });
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
        Object.assign(plan, { status: 'failed', error: `فات موعد النشر (${p.scheduled_label || ''}) لأن السيرفر كان متوقف — اختار وقت جديد أو انشر الآن.` });
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
      plans: this.listPlans().slice(0, 40)
    };
  }
}

module.exports = new MarketingService();
