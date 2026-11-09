const fs = require('fs');
const path = require('path');

const KB_DIR = path.join(__dirname, '../../data/knowledge');
const KB_FILE = path.join(KB_DIR, 'atlead_kb.json');
// Clean text extracted from the company PDFs (Sales Chatbot KB + Company Portfolio).
const DOC_FILES = [
  { file: 'kb_document.txt', title: 'ملف قاعدة المعرفة ودليل المبيعات (atlead Sales Chatbot Knowledge Base)' },
  { file: 'portfolio_document.txt', title: 'ملف تعريف الشركة وسوابق الأعمال (atlead Company Portfolio)' }
];
const FAQ_FILE = path.join(KB_DIR, 'faq.json');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[^\p{L}\p{N}\s@.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class KnowledgeService {
  constructor() {
    this.kbData = null;
    this.documents = null;
    this.remoteDocuments = null;
    this.remoteKnowledgeStatus = 'not_loaded';
    this.faq = null;
    this.loadKB();
  }

  loadKB() {
    try {
      if (fs.existsSync(KB_FILE)) {
        const raw = fs.readFileSync(KB_FILE, 'utf-8');
        this.kbData = JSON.parse(raw);
      }
    } catch (err) {
      console.error('Error loading Knowledge Base:', err.message);
    }
    this.documents = DOC_FILES
      .filter(d => fs.existsSync(path.join(KB_DIR, d.file)))
      .map(d => ({ title: d.title, text: fs.readFileSync(path.join(KB_DIR, d.file), 'utf-8') }));
    try {
      this.faq = fs.existsSync(FAQ_FILE) ? JSON.parse(fs.readFileSync(FAQ_FILE, 'utf-8')) : [];
    } catch (err) {
      console.error('Error loading FAQ:', err.message);
      this.faq = [];
    }
    console.log(`[Knowledge] Loaded ${this.documents.length} documents (${this.documents.reduce((n, d) => n + d.text.length, 0)} chars) and ${this.faq.length} FAQ entries.`);
  }

  getKnowledgeBase() {
    if (!this.kbData) this.loadKB();
    return this.kbData;
  }

  getDocuments() {
    if (!this.documents) this.loadKB();
    return this.documents;
  }

  getFaq() {
    if (!this.faq) this.loadKB();
    return this.faq;
  }

  /**
   * Supabase is the runtime source of truth. Local files are used only once to
   * seed an empty knowledge_docs table; replies then read the remote rows.
   */
  async loadFromSupabase() {
    try {
      const supabase = require('./supabaseService').getClient();
      if (!supabase) { this.remoteKnowledgeStatus = 'supabase_not_configured'; return false; }
      let { data, error } = await supabase
        .from('knowledge_docs')
        .select('id,title,doc_type,file_path,content,metadata,is_active,created_at')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      // Seed only a truly empty table (not when the admin switched every document off).
      let totalRows = data?.length || 0;
      if (!totalRows) {
        const all = await supabase.from('knowledge_docs').select('id', { count: 'exact', head: true });
        if (all.error) throw all.error;
        totalRows = all.count || 0;
      }
      if (!totalRows) {
        const seed = this.getDocuments().map(d => ({
          title: d.title, doc_type: 'text', file_path: null, content: d.text,
          metadata: { source_key: d.title.includes('Portfolio') ? 'portfolio_document' : 'kb_document', seeded_from: 'approved_atlead_documents', seeded_at: new Date().toISOString(), editable: true }, is_active: true
        }));
        if (fs.existsSync(FAQ_FILE)) {
          seed.push({
            title: 'الأسئلة الشائعة المعتمدة', doc_type: 'json', file_path: 'data/knowledge/faq.json',
            content: fs.readFileSync(FAQ_FILE, 'utf-8'),
            metadata: { source_key: 'faq', seeded_from: 'approved_atlead_documents', seeded_at: new Date().toISOString(), editable: true }, is_active: true
          });
        }
        if (seed.length) {
          const inserted = await supabase.from('knowledge_docs').insert(seed).select('id,title,doc_type,file_path,content,metadata,is_active,created_at');
          if (inserted.error) throw inserted.error;
          data = inserted.data || [];
        }
      }
      this.remoteDocuments = (data || []).filter(d => d.content && d.metadata?.source_key !== 'faq').map(d => ({
        title: d.title, text: d.content, file_path: d.file_path || '', metadata: d.metadata || {}
      }));
      this.remoteKnowledgeStatus = this.remoteDocuments.length ? 'loaded' : 'empty';
      console.log(`[Knowledge] Runtime source: Supabase knowledge_docs (${this.remoteDocuments.length} documents).`);
      return this.remoteDocuments.length > 0;
    } catch (err) {
      this.remoteKnowledgeStatus = 'error';
      console.error('[Knowledge] Supabase load failed:', err.message);
      return false;
    }
  }

  async getEditableDocuments() {
    if (this.remoteKnowledgeStatus === 'not_loaded') await this.loadFromSupabase();
    const supabase = require('./supabaseService').getClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('knowledge_docs')
      .select('id,title,doc_type,file_path,content,metadata,is_active,created_at')
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    return data || [];
  }

  async updateDocument(id, patch = {}) {
    const supabase = require('./supabaseService').getClient();
    if (!supabase) throw new Error('Supabase غير مربوط');
    const update = {};
    if (patch.title !== undefined) update.title = String(patch.title).trim().slice(0, 255);
    if (patch.content !== undefined) update.content = String(patch.content).slice(0, 200000);
    if (patch.file_path !== undefined) update.file_path = String(patch.file_path).slice(0, 1000);
    if (patch.is_active !== undefined) update.is_active = Boolean(patch.is_active);
    if (!Object.keys(update).length) throw new Error('لا توجد تغييرات للحفظ');
    const { data, error } = await supabase
      .from('knowledge_docs')
      .update(update)
      .eq('id', id)
      .select('id,title,doc_type,file_path,content,metadata,is_active,created_at')
      .limit(1);
    if (error) throw error;
    await this.loadFromSupabase();
    return data?.[0] || null;
  }

  async createDocument({ title, content, file_path = '' } = {}) {
    const supabase = require('./supabaseService').getClient();
    if (!supabase) throw new Error('Supabase غير مربوط');
    const t = String(title || '').trim().slice(0, 255);
    const c = String(content || '').trim().slice(0, 200000);
    if (!t || !c) throw new Error('اكتب عنوان ومحتوى للوثيقة');
    const { data, error } = await supabase
      .from('knowledge_docs')
      .insert({ title: t, content: c, doc_type: 'text', file_path: String(file_path || '').slice(0, 1000) || null, metadata: { source_key: 'dashboard', created_from: 'dashboard', editable: true }, is_active: true })
      .select('id,title,doc_type,file_path,content,metadata,is_active,created_at')
      .limit(1);
    if (error) throw error;
    await this.loadFromSupabase();
    return data?.[0] || null;
  }

  getRuntimeDocuments() {
    // Supabase loaded fine → it's the source, even if the admin switched documents off.
    if (this.remoteKnowledgeStatus === 'loaded' || this.remoteKnowledgeStatus === 'empty') return this.remoteDocuments || [];
    return this.getDocuments();
  }

  // Extra knowledge the admin writes in the dashboard (settings.knowledge.extra_text).
  getExtraKnowledge() {
    try {
      return String(require('./storageService').getSettings().knowledge?.extra_text || '').trim();
    } catch {
      return '';
    }
  }

  /**
   * Best FAQ answer for a customer message, or null.
   * Scores keyword hits (whole phrase match on normalized text); avoids answers already sent.
   */
  findFaqAnswer(message, { exclude = [] } = {}) {
    const t = ` ${normalize(message)} `;
    if (!t.trim()) return null;
    const sent = new Set(exclude.map(normalize));
    let best = null;
    for (const item of this.getFaq()) {
      let score = 0;
      for (const kw of item.keywords || []) {
        const k = normalize(kw);
        if (k && t.includes(k)) score += k.split(' ').length + 1;
      }
      if (!score || sent.has(normalize(item.a))) continue;
      if (!best || score > best.score) best = { ...item, score };
    }
    return best;
  }

  getSystemPrompt() {
    const kb = this.getKnowledgeBase();
    if (!kb) {
      return "أنت المساعد الذكي لشركة atlead المتخصصة في أنظمة المبيعات الذكية.";
    }

    const docs = this.getRuntimeDocuments();
    const extra = this.getExtraKnowledge();
    const faq = this.getFaq();
    const remoteNote = this.remoteDocuments?.length
      ? 'مصدر هذه الوثائق وقت التشغيل هو Supabase knowledge_docs. لا تستخدم ملفات الكود أو GitHub كمصدر إجابة.'
      : 'تحذير: لم تُحمّل وثائق Supabase بعد؛ لا تعطِ روابط أو تفاصيل غير موجودة صراحة في المرجع.';
    const reference = `
=== المرجع الرسمي (مصدر الحقيقة الوحيد) ===
تحت هذا السطر النص الكامل لملفات الشركة المعتمدة. جاوب من هذه الملفات فقط:
- إذا المعلومة موجودة فيها، جاوب منها بصياغتك وبلهجة أردنية مختصرة (2-4 جمل) ولا تنسخ الجداول حرفياً.
- إذا المعلومة مش موجودة، لا تخترع أبداً: استخدم عبارة "المعلومة غير المتوفرة" من القاعدة 7.
- النص مستخرج آلياً من PDF، فممكن تلاقي ترتيب كلمات غريب بسيط؛ افهم المعنى.
- لا تكرر نفس الرد اللي بعته قبل بنفس المحادثة؛ إذا العميل كرر سؤاله، جاوبه بطريقة مختلفة أو اسأله سؤال يوضح قصده.
${remoteNote}
${faq.length ? `\n--- أسئلة شائعة بأجوبة معتمدة ---\n${faq.map(f => `س: ${f.q}\nج: ${f.a}`).join('\n\n')}\n` : ''}
${extra ? `\n--- معلومات إضافية من إدارة atlead (أحدث من الملفات، والأولوية لها) ---\n${extra}\n` : ''}
    ${docs.map(d => {
      const link = d.file_path || d.metadata?.url || d.metadata?.source_url || d.metadata?.link || '';
      return `\n--- ${d.title}${link ? ` | الرابط/المسار: ${link}` : ''} ---\n${d.text}`;
    }).join('\n')}
`;

    return `
أنت المساعد الذكي والمستشار البيعي الرسمي لشركة "atlead" (تُكتب دائماً بالأحرف الصغيرة atlead - شعارنا: From Leads to Revenue).
دورك: موظف مبيعات أردني محترف وودود، تتحدث بلهجة أردنية بيضاء مهنية، طبيعية، بسيطة وبدون تكلف، وإذا تحدث العميل باللغة الإنجليزية ترد بالإنجليزية بنفس الاحترافية.

=== تموضع الشركة (Positioning) ===
atlead شركة متخصصة في تصميم وبناء أنظمة المبيعات الذكية (AI Sales Systems)، وأتمتة العمليات، وتطوير الحلول الرقمية المخصصة للشركات.
نساعد الشركات على استقبال العملاء المحتملين وتأهيلهم وإدارة التواصل والمتابعة ورفع كفاءة المبيعات.
هام: atlead ليست مجرد شركة لبيع الشات بوتس التقليدية، بل نبني أنظمة مبيعات متكاملة ومخصصة لحل مشاكل كل شركة ومجالها.

=== خدماتنا الأساسية ===
1. أنظمة مبيعات ذكية متكاملة (AI Sales Systems).
2. أنظمة تأهيل العملاء المحتملين وتصنيفهم (AI Lead Qualification Systems).
3. أتمتة المتابعة الذكية وإعادة التفعيل عبر واتساب والإيميل (Follow-up Automation).
4. مساعدات ذكية مدربة على مستندات الشركة للرد الصوتي والكتابي على كافة القنوات (WhatsApp, IG, FB).
5. تكامل الأنظمة وربط المحادثات مع CRM و Google Sheets وقواعد البيانات.
6. تطوير وتصميم مواقع ومنصات ومتاجر إلكترونية وحلول برمجية مخصصة.

=== سوابق الأعمال والخبرات (Portfolio) ===
نفذ الفريق التقني 9 مشاريع وأنظمة رقمية متقدمة في مجالات متعددة، منها:
- متجر ومنصة تجارة إلكترونية B2B لشركة AGS Technology (agsco.shop) لمعدات السلامة العامة وأنظمة القياس مع كتالوج 166 منتج وتكامل مبيعات متكامل.
- منصة طلبات إلكترونية لمطبخ Moe's PureBite (moespurebite.com).
- منصات تدريب واستشارات وأنظمة حجز ومساعدات ذكية للشركات في قطاعات التوزيع، التجارة، والخدمات.

=== القواعد الذهبية للحديث مع العميل (Golden Rules) ===
1. أجب أولاً: عند وصول سؤال من العميل، أجب عنه بإيجاز ومباشرة دون مراوغة.
2. افهم المشكلة: بعد الإجابة، اسأل سؤالاً استكشافياً واحداً فقط بطريقة طبيعية لفهم نشاطه أو التحدي عنده (مثال: "شو نوع شغلك بالظبط؟"، "شو أكتر نقطة بتتعبكم بمتابعة العملاء أو استفساراتهم؟").
3. ممنوع إرسال قائمة الخدمات الطويلة دفعة واحدة في بداية المحادثة.
4. ممنوع إعطاء أي أسعار قطعية أو باقات أو تخمينات في الشات: "كل حل بنبنيه بيكون مخصص ومفصل حسب حجم شغلك والأنظمة اللي بتستخدمها، لهيك أول خطوة بنعمل جلسة استشارة مجانية مع الفريق لنفهم احتياجك بالضبط ونعطيك خطة وتكلفة دقيقة".
5. الاستشارة المجانية: مدتها 30 دقيقة (أونلاين) لمناقشة المشكلة وبناء خطة العمل المقترحة.
6. الديمو (Demo): يُعرض فقط عندما يكون العميل مهتماً ولديه رغبة واضحة ومتردد، وهو ديمو مخصص مجاني لمدة أسبوع.
7. أي معلومة غير مؤكدة لديك أو تفاصيل تقنية/تعاقدية خاصة: قل: "هاي المعلومة مش متوفرة عندي بدقة حالياً حتى أجاوبك بشكل كامل، بس بقدر أخلي الفريق يرتبها معك ويعطيك كل التفاصيل".
8. القنوات الرسمية للشركة: واتساب (00962780908299)، إنستغرام (@atlead.ai)، فيسبوك (@atlead.ai). مسؤول المبيعات: "م. مهند من قسم المبيعات".

=== القاعدة الحاسمة: نقطة الاتفاق والإغلاق (Deal Closing & Human Handoff) ===
متى يتم تحويل المحادثة للبشري؟
- عندما يوافق العميل على الاستشارة المجانية أو يطلب موعداً.
- عندما يطلب تجربة الديمو.
- عندما يطلب العميل صراحة التواصل مع مسؤول أو شخص حقيقي.
- عندما يقتنع بالحل ويصل لمرحلة الاتفاق على بدء العمل (Deal Closing).

في هذه اللحظة، يجب أن تكون رسالتك الختامية:
"تمام، م. مهند من قسم المبيعات في شركة atlead رح يتواصل معك بأسرع وقت لمتابعة كافة التفاصيل وترتيب كل شيء معك. شكراً لاهتمامك وثقتك."

=== تنسيق الرد الإلزامي بصيغة JSON ===
يجب دائماً أن تعيد ردك بصيغة JSON نظيفة بدون علامات markdown غير صالحة، تحتوي الحقول التالية:
{
  "reply_text": "نص الرد الذي سيصل للعميل باللهجة الأردنية المهنية المحددة",
  "identified_problem": "المشكلة التي يعاني منها العميل إن وجدت باختصار",
  "proposed_solution": "الحل المناسب المقترح إن وجد",
  "lead_stage": "new" أو "discovery" أو "qualified" أو "hot" أو "deal_closing" أو "handed_off",
  "classification": "Cold" أو "Warm" أو "Hot",
  "buying_probability": 85, (رقم من 10 إلى 100 يعبر عن نسبة الشراء والاهتمام)
  "handoff_triggered": false (أو true إذا وصل العميل لمرحلة الموافقة على الديل/الاستشارة/الديمو/طلب بشري),
  "customer_name": "اسم العميل إن ذكره أو null",
  "customer_phone": "رقم هاتف العميل إن ذكره أو null",
  "business_type": "نوع نشاط/مجال العميل إن عُرف أو null",
  "customer_requests": "قائمة مختصرة بكل ما طلبه أو سأل عنه العميل حتى الآن (تراكمية، لا تحذف طلبات سابقة)",
  "customer_summary": "ملخص سيلز تراكمي محدث لكل ما حصل مع العميل: من هو، شو بده، وين وصلنا، شو الخطوة الجاية (3-5 جمل)",
  "objections": "أي تردد أو اعتراض عند العميل (السعر، الوقت، الثقة...) أو null",
  "company_name": "اسم شركة/محل العميل إن ذكره أو null",
  "customer_email": "إيميل العميل إن ذكره أو null",
  "consultation_requested": false (true فقط إذا العميل طلب أو وافق على الاستشارة المجانية),
  "demo_requested": false (true فقط إذا العميل طلب أو وافق على الديمو)
}

=== ذاكرة العميل ===
- ستصلك "بيانات العميل المحفوظة" من المحادثات السابقة. إذا العميل راجع بعد فترة، كمّل معه من وين ما وصلتوا ولا تعيد الترحيب أو الأسئلة اللي جاوب عليها سابقاً.
- حدّث customer_summary و customer_requests بحيث تحتوي المعلومات القديمة + الجديدة.
- إذا العميل جاهز للشراء/الاستشارة لكن ما أعطى رقم هاتفه (خاصة على إنستغرام وفيسبوك)، اطلب رقمه بلطف قبل التحويل حتى يقدر الموظف يتواصل معه.
${reference}`;
  }
}

module.exports = new KnowledgeService();
