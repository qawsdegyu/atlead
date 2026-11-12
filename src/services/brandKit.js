/**
 * Visual-identity test ("اختبار الهوية"): the brand applied to every medium it will
 * live on — social, print, outdoor, web, merch — designed by the best image model
 * (Nano Banana Pro) from the identity learned from the page + the logo.
 *
 * Runs as a background job (it takes a few minutes); progress is saved after each
 * design so the dashboard fills in live, and a restart never loses finished work.
 */
const marketing = require('./marketingService');
const imageService = require('./imageService');

const CONCURRENCY = 3;
const STALE_MS = 20 * 60 * 1000;

// Copy that can appear on the designs. Short, real, and the same everywhere.
const COPY = {
  name: 'atlead',
  slogan: 'From Leads to Revenue',
  tagline_ar: 'أنظمة مبيعات ذكية',
  cta_ar: 'احجز استشارتك المجانية',
  hook_ar: 'ولا رسالة بتضيع',
  web: 'atlead.ai'
};

// Each medium: what it is, its frame, and a concrete art direction.
const MEDIA = [
  // ---- Social
  { key: 'ig_post', group: 'سوشال ميديا', title: 'منشور إنستغرام', aspect: '4:5',
    brief: `A hero Instagram feed post. The Arabic headline "${COPY.hook_ar}" set huge and bold as the visual anchor, one striking 3D object (a glowing chat bubble turning into a sales graph) as the focal point, the logo small in a corner. Scroll-stopping contrast, magazine-grade typographic hierarchy.` },
  { key: 'ig_story', group: 'سوشال ميديا', title: 'ستوري إنستغرام', aspect: '9:16',
    brief: `A full-screen Instagram Story. Top third: Arabic headline "${COPY.tagline_ar}". Middle: a phone showing a WhatsApp-style conversation answered instantly by an AI assistant. Bottom: a pill-shaped CTA "${COPY.cta_ar}" with a subtle swipe-up arrow. Keep 250px safe zones top and bottom.` },
  { key: 'carousel_cover', group: 'سوشال ميديا', title: 'كاروسيل — الغلاف', aspect: '4:5',
    brief: `The cover slide of an educational carousel titled in Arabic "3 أسباب بتخسر فيها عملاءك". Big numeral "3" as a graphic element, a small "اسحب ←" cue on the edge, a clean grid that clearly continues onto the next slides.` },
  { key: 'carousel_slide', group: 'سوشال ميديا', title: 'كاروسيل — شريحة محتوى', aspect: '4:5',
    brief: `An inside slide of the same carousel: a large "01" index, a short Arabic heading "الرد المتأخر", two lines of supporting text, and one simple line icon. Generous white space, same grid and colours as the cover.` },
  { key: 'fb_cover', group: 'سوشال ميديا', title: 'غلاف فيسبوك', aspect: '21:9',
    brief: `A Facebook page cover. Left/right balanced: the slogan "${COPY.slogan}" and Arabic "${COPY.tagline_ar}" on one side, an abstract visual of messages flowing into a revenue line on the other. Keep the centre-bottom clear (profile picture overlap on mobile).` },
  { key: 'linkedin_banner', group: 'سوشال ميديا', title: 'بانر لينكدإن', aspect: '21:9',
    brief: `A LinkedIn company banner, corporate and confident: the slogan "${COPY.slogan}" set elegantly, a refined data-visualisation texture in brand colours, plenty of negative space. B2B, premium, calm.` },
  { key: 'yt_thumb', group: 'سوشال ميديا', title: 'صورة يوتيوب', aspect: '16:9',
    brief: `A YouTube thumbnail for a video "كيف تضاعف مبيعاتك بالذكاء الاصطناعي": an expressive Arab business owner (surprised, positive), huge Arabic text "ضاعف مبيعاتك" with a bold outline, a rising arrow, high contrast that reads at small size.` },
  // ---- Ads & outdoor
  { key: 'billboard', group: 'إعلانات وطرق', title: 'لوحة إعلانية في الشارع', aspect: '16:9',
    brief: `A photorealistic mockup of a large roadside billboard on a busy Amman street at golden hour (Abdoun bridge or Sweifieh feel), showing the campaign "${COPY.hook_ar}" with the logo. The billboard design itself must be minimal and readable from far: one line, one visual, logo.` },
  { key: 'rollup', group: 'إعلانات وطرق', title: 'رول أب في معرض', aspect: '9:16',
    brief: `A photorealistic mockup of a roll-up banner standing at a tech expo booth. Banner layout: logo at top, Arabic "${COPY.tagline_ar}", three short benefit lines with icons, and a QR code area with "${COPY.cta_ar}" at eye level. Soft exhibition lighting.` },
  { key: 'magazine_ad', group: 'إعلانات وطرق', title: 'إعلان مجلة', aspect: '3:4',
    brief: `A full-page business magazine ad photographed on a desk: a bold editorial composition, Arabic headline "مبيعاتك شغالة 24 ساعة", a premium product-style shot of a phone with notifications, a short body text block and the logo at the bottom.` },
  // ---- Print & stationery
  { key: 'business_card', group: 'مطبوعات', title: 'بطاقة عمل', aspect: '3:2',
    brief: `A photorealistic close-up mockup of premium business cards (front and back) on a textured stone surface with soft directional light: front with the logo centred, back with name "م. مهند", title "Sales Manager", phone, ${COPY.web}. Thick card stock, subtle spot-UV on the logo.` },
  { key: 'letterhead', group: 'مطبوعات', title: 'ورق رسمي ومغلف', aspect: '4:3',
    brief: `A stationery mockup: A4 letterhead, envelope and a compliment slip arranged on a clean desk, top-down view. The letterhead uses the logo top-right (Arabic layout), a thin brand-colour band, and a quiet footer with contact details.` },
  { key: 'brand_board', group: 'مطبوعات', title: 'لوحة الهوية (دليل مختصر)', aspect: '16:9',
    brief: `A brand guidelines board: the logo large, the colour palette as labelled swatches with hex codes, a typography specimen (Arabic and Latin headline/body), a sample icon set and a sample post — laid out like a page from a professional brand book.` },
  // ---- Digital
  { key: 'website', group: 'رقمي', title: 'واجهة الموقع', aspect: '16:9',
    brief: `A photorealistic mockup of the atlead website hero on a MacBook on a modern desk. Website (Arabic, RTL): navigation with logo, a large headline "${COPY.tagline_ar} تحوّل رسائلك لمبيعات", a CTA button "${COPY.cta_ar}", and a dashboard screenshot as the hero visual.` },
  { key: 'app_icon', group: 'رقمي', title: 'أيقونة تطبيق وشاشة البداية', aspect: '9:16',
    brief: `A photorealistic iPhone mockup showing the splash screen of an "atlead" app (logo centred on the brand colour), with the app icon visible on a home-screen row beside it. Crisp, glossy, minimal.` },
  { key: 'slide', group: 'رقمي', title: 'شريحة عرض تقديمي', aspect: '16:9',
    brief: `A presentation slide for a sales pitch: Arabic title "النتائج خلال 30 يوم", three big KPI numbers with short labels (رد أسرع، عملاء أكثر، مبيعات أعلى), a simple bar chart, logo in the corner. Keynote-quality, generous margins.` },
  { key: 'email_header', group: 'رقمي', title: 'هيدر إيميل وتوقيع', aspect: '16:9',
    brief: `A newsletter email shown in a mail client: a branded header banner with the logo and Arabic "نشرة atlead الشهرية", a short article preview, a CTA button, and a polished email signature block at the bottom.` },
  // ---- Environment & merch
  { key: 'office_wall', group: 'المكتب والمنتجات', title: 'لوغو على جدار المكتب', aspect: '4:3',
    brief: `A photorealistic office reception in Amman: the logo as backlit 3D letters on a feature wall in brand colour, a reception desk, warm architectural lighting, a plant. Premium, modern workplace.` },
  { key: 'merch', group: 'المكتب والمنتجات', title: 'تيشيرت وهودي', aspect: '4:5',
    brief: `A lifestyle photo of two young Jordanian team members wearing branded apparel: a black hoodie with the logo on the chest and a t-shirt with "${COPY.slogan}" on the back. Natural light, candid, editorial fashion feel.` },
  { key: 'mug_stationery', group: 'المكتب والمنتجات', title: 'كوب ودفتر وقلم', aspect: '1:1',
    brief: `A top-down flat lay of branded merchandise: ceramic mug, notebook, pen, laptop sticker and a lanyard with an event badge — all in the brand palette with the logo, arranged on a clean surface with soft shadows.` },
  { key: 'car', group: 'المكتب والمنتجات', title: 'سيارة الشركة', aspect: '16:9',
    brief: `A photorealistic company car wrap: a modern compact car parked on an Amman street with the logo on the door, ${COPY.web} and a bold brand-colour graphic sweep along the side. Clean daylight.` }
];

const now = () => new Date().toISOString();

class BrandKit {
  get media() { return MEDIA; }

  state() {
    const kit = marketing.getBrand()?.kit || null;
    if (!kit) return null;
    // A job interrupted by a restart: unfinished items go back to "waiting" so they can be resumed.
    if (kit.status === 'running' && Date.now() - new Date(kit.updated_at || kit.started_at).getTime() > STALE_MS) {
      kit.status = 'stopped';
      kit.items.forEach(i => { if (i.status === 'running') i.status = 'pending'; });
    }
    return kit;
  }

  view() {
    const kit = this.state();
    return kit ? { ...kit, items: kit.items.map(i => ({ ...i, url: i.file ? `/media/${i.file}` : null })) } : null;
  }

  // Read-modify-write of one item (single-threaded, so this is safe between awaits).
  patchItem(key, patch) {
    const kit = this.state();
    if (!kit) return;
    const it = kit.items.find(i => i.key === key);
    if (it) Object.assign(it, patch, { updated_at: now() });
    kit.updated_at = now();
    const done = kit.items.filter(i => i.status === 'done').length;
    const failed = kit.items.filter(i => i.status === 'failed').length;
    if (!kit.items.some(i => i.status === 'pending' || i.status === 'running')) kit.status = 'done';
    kit.progress = { done, failed, total: kit.items.length };
    marketing.saveBrand({ kit });
  }

  prompt(m, note = '') {
    return [
      `You are the lead designer of an award-winning branding studio. Design the "${m.title}" application of this company's visual identity — the kind of work that gets featured on Behance and Brand New.`,
      `Company: ${COPY.name} — ${marketing.companyBrief().slice(0, 300)}`,
      `BRIEF: ${m.brief}`,
      note && `CLIENT FEEDBACK TO APPLY: ${note}`,
      `BRAND IDENTITY (follow strictly): ${marketing.brandDirection()}`,
      'The attached images are the REAL logo and published posts of this brand. Reproduce the logo faithfully (shape, letterforms, colours) wherever a logo appears — never redraw or invent a different mark. Match the palette, typography style and finish of the posts.',
      `The medium's name ("${m.title}") is an internal label for you — never write it on the design.`,
      'Arabic text must be spelled exactly as given, correctly joined and right-to-left; Latin text exactly as given. Write ONLY the copy given in the brief (plus the logo); no extra paragraphs, no lorem ipsum, no gibberish, no invented statistics, no watermarks. Small interface text in mockups may be blurred rather than readable.',
      'Quality bar: world-class art direction, deliberate typographic hierarchy, precise alignment and margins, photorealistic materials and lighting for mockups, one clear focal point, nothing cluttered.'
    ].filter(Boolean).join('\n');
  }

  /** Start (or resume) the job. keys = only some media; fresh = redo finished ones too. */
  start({ keys = null, fresh = false } = {}) {
    const brand = marketing.getBrand();
    if (!brand?.logo && !(brand?.refs || []).length) throw new Error('تعلّم الهوية من صفحتك أو ارفع اللوغو أول (الإعدادات والربط ← هوية التصميم).');
    let kit = this.state();
    if (kit?.status === 'running') throw new Error('يوجد تصميم قيد التنفيذ — انتظر حتى ينتهي.');
    imageService.resetCooldown();
    const wanted = keys ? MEDIA.filter(m => keys.includes(m.key)) : MEDIA;
    if (!wanted.length) throw new Error('اختار وسيلة من القائمة');
    const items = MEDIA.map(m => {
      const old = kit?.items?.find(i => i.key === m.key);
      const redo = wanted.includes(m) && (fresh || !old?.file);
      return redo
        ? { key: m.key, title: m.title, group: m.group, aspect: m.aspect, status: 'pending', file: old?.file || null, history: old?.history || [] }
        : (old || { key: m.key, title: m.title, group: m.group, aspect: m.aspect, status: 'pending', file: null, history: [] });
    });
    const queue = items.filter(i => i.status === 'pending' && wanted.some(m => m.key === i.key)).map(i => i.key);
    if (!queue.length) throw new Error('جميع التصاميم جاهزة — اضغط «أعد التصميم» على ما تريد تغييره.');
    kit = { status: 'running', started_at: now(), updated_at: now(), items, progress: { done: items.filter(i => i.status === 'done').length, failed: 0, total: items.length } };
    marketing.saveBrand({ kit });
    this.run(queue).catch(e => console.error('[BrandKit] job error:', e.message));
    return this.view();
  }

  /** Redo one design, optionally with feedback ("make it darker", "use the logo bigger"). */
  redo(key, note = '') {
    const m = MEDIA.find(x => x.key === key);
    if (!m) throw new Error('وسيلة غير معروفة');
    const kit = this.state();
    if (kit?.status === 'running') throw new Error('يوجد تصميم قيد التنفيذ — انتظر حتى ينتهي.');
    const it = kit?.items?.find(i => i.key === key);
    if (!it) return this.start({ keys: [key], fresh: true });
    imageService.resetCooldown();
    Object.assign(it, { status: 'pending', note: String(note || '').slice(0, 400) });
    kit.status = 'running'; kit.updated_at = now();
    marketing.saveBrand({ kit });
    this.run([key]).catch(e => console.error('[BrandKit] job error:', e.message));
    return this.view();
  }

  async run(queue) {
    const refs = marketing.brandImages({ max: 3 });
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const key = queue.shift();
        const m = MEDIA.find(x => x.key === key);
        const item = this.state()?.items.find(i => i.key === key);
        this.patchItem(key, { status: 'running', error: '' });
        try {
          // With feedback on an existing design: edit it; otherwise design from the brief.
          const r = item?.note && item?.file
            ? await imageService.edit(item.file, this.prompt(m, item.note), refs, { aspect: m.aspect, kind: 'media' })
            : await imageService.generate(this.prompt(m, item?.note), refs, { allowFree: false, aspect: m.aspect, kind: 'media' });
          const history = [...(item?.history || []), ...(item?.file ? [item.file] : [])].slice(-5);
          this.patchItem(key, { status: 'done', file: r.file, engine: r.engine, history, note: '' });
        } catch (e) {
          this.patchItem(key, { status: 'failed', error: e.message.slice(0, 300) });
        }
      }
    });
    await Promise.all(workers);
  }
}

module.exports = new BrandKit();
