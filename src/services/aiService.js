const axios = require('axios');
const fs = require('fs');
const knowledgeService = require('./knowledgeService');
const storageService = require('./storageService');

function normalizeArabic(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[إأآ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove harakat
    .trim();
}

class AiService {
  async generateReply(conversation, incomingMessage) {
    const settings = storageService.getSettings();
    const aiConfig = settings.ai || {};
    const provider = aiConfig.provider || 'gemini';
    const systemPrompt = knowledgeService.getSystemPrompt();

    // Prepare message history
    const history = (conversation.messages || []).slice(-20).map(m => ({
      role: m.sender === 'customer' ? 'user' : 'model',
      parts: [{ text: `${m.sender === 'customer' ? 'العميل: ' : m.sender === 'agent' ? 'موظف المبيعات: ' : 'المساعد: '}${m.content}` }]
    }));

    const lastMsgAt = conversation.messages?.length ? conversation.messages[conversation.messages.length - 1].created_at : null;
    const daysSince = lastMsgAt ? Math.floor((Date.now() - new Date(lastMsgAt).getTime()) / 86400000) : 0;

    const userPrompt = `
الرسالة الجديدة من العميل: "${incomingMessage}"

بيانات العميل المحفوظة (ذاكرة من المحادثات السابقة):
- القناة: ${conversation.channel}
- الاسم: ${conversation.customer_name || 'غير معروف'}
- رقم الهاتف: ${conversation.customer_phone || 'غير مسجل'}
- نوع النشاط: ${conversation.business_type || 'غير معروف'}
- طلبات العميل السابقة: ${conversation.customer_requests || 'لا يوجد'}
- المشكلة: ${conversation.identified_problem || 'غير محددة'}
- الحل المقترح: ${conversation.proposed_solution || 'غير محدد'}
- التردد/الاعتراضات: ${conversation.objections || 'لا يوجد'}
- ملخص ما حصل: ${conversation.customer_summary || 'محادثة جديدة'}
- مرحلة العميل السابقة: ${conversation.lead_stage || 'new'}
- نسبة الشراء السابقة: ${conversation.interest_score || 20}%
${daysSince >= 1 ? `- ملاحظة: العميل راجع بعد ${daysSince} يوم من آخر رسالة — كمّل معه من وين ما وقفتوا.` : ''}

قم بتحليل الرسالة، وتوليد الرد المناسب حسب قواعد atlead الدقيقة، وتحديد حالة العميل وتصنيفه، وما إذا وصل لمرحلة الديل/التحويل للبشري.
أعد النتيجة بصيغة JSON حصراً.
`;

    // 1. Try Google Gemini
    if (provider === 'gemini' && aiConfig.gemini_api_key) {
      try {
        const reply = await this.callGemini(aiConfig.gemini_api_key, aiConfig.gemini_model || 'gemini-2.5-flash', systemPrompt, history, userPrompt);
        return reply;
      } catch (err) {
        console.error('Gemini API Error:', err.response?.data || err.message);
      }
    }

    // 2. Try OpenAI
    if (provider === 'openai' && aiConfig.openai_api_key) {
      try {
        const reply = await this.callOpenAI(aiConfig.openai_api_key, aiConfig.openai_model || 'gpt-4o', systemPrompt, history, userPrompt);
        return reply;
      } catch (err) {
        console.error('OpenAI API Error:', err.response?.data || err.message);
      }
    }

    // 3. Smart Rule-Based Fallback (Works 100% locally even without API keys configured!)
    return this.ruleBasedReply(conversation, incomingMessage);
  }

  async callGemini(apiKey, model, systemPrompt, history, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    // Gemini contents format
    const contents = [
      {
        role: 'user',
        parts: [{ text: systemPrompt }]
      },
      {
        role: 'model',
        parts: [{ text: 'أنا جاهز ومستعد لتمثيل شركة atlead كمستشار مبيعات أردني محترف وفق كافة القواعد المحددة.' }]
      }
    ];

    for (const h of history) {
      contents.push({
        role: h.role === 'model' ? 'model' : 'user',
        parts: h.parts
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    const response = await axios.post(url, {
      contents,
      generationConfig: {
        temperature: 0.5,
        responseMimeType: 'application/json'
      }
    }, { timeout: 25000 });

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return this.cleanAndParseJson(rawText);
  }

  async callOpenAI(apiKey, model, systemPrompt, history, userPrompt) {
    const url = 'https://api.openai.com/v1/chat/completions';

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    for (const h of history) {
      messages.push({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: h.parts[0].text
      });
    }

    messages.push({ role: 'user', content: userPrompt });

    const response = await axios.post(url, {
      model: model || 'gpt-4o',
      messages,
      temperature: 0.5,
      response_format: { type: 'json_object' }
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 25000
    });

    const rawText = response.data?.choices?.[0]?.message?.content;
    return this.cleanAndParseJson(rawText);
  }

  cleanAndParseJson(text) {
    try {
      if (!text) throw new Error('Empty response');
      // Remove any markdown code fence if present
      let cleaned = text.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);
      return {
        reply_text: parsed.reply_text || 'أهلاً بك في atlead! كيف نقدر نساعدك اليوم؟',
        identified_problem: parsed.identified_problem || null,
        proposed_solution: parsed.proposed_solution || null,
        lead_stage: parsed.lead_stage || 'discovery',
        classification: parsed.classification || 'Warm',
        buying_probability: parsed.buying_probability || 40,
        handoff_triggered: !!parsed.handoff_triggered,
        customer_name: parsed.customer_name || null,
        customer_phone: parsed.customer_phone || null,
        business_type: parsed.business_type || null,
        customer_requests: parsed.customer_requests
          ? (Array.isArray(parsed.customer_requests) ? parsed.customer_requests.join('، ') : String(parsed.customer_requests))
          : null,
        customer_summary: parsed.customer_summary || null,
        objections: parsed.objections || null
      };
    } catch (e) {
      console.warn('Failed to parse AI JSON, using fallback parser:', e.message);
      return {
        reply_text: text || 'أهلاً وسهلاً بك في شركة atlead، كيف بقدر أساعدك اليوم في تطوير مبيعات شركتك؟',
        identified_problem: null,
        proposed_solution: null,
        lead_stage: 'discovery',
        classification: 'Warm',
        buying_probability: 45,
        handoff_triggered: false,
        customer_name: null,
        customer_phone: null
      };
    }
  }

  // Intelligent fallback engine when AI keys are not yet provided
  ruleBasedReply(conversation, text) {
    const t = normalizeArabic(text);
    const settings = storageService.getSettings();
    const handoffMsg = settings.handoff?.handoff_message || 
      'تمام، م. مهند من قسم المبيعات في شركة atlead رح يتواصل معك بأسرع وقت لمتابعة كافة التفاصيل وترتيب كل شيء معك. شكراً لاهتمامك وثقتك.';

    // Check deal / agreement triggers
    const agreementTriggers = [
      'اتفقنا', 'موافق', 'احجزلي', 'بدي احجز', 'حابب احجز', 'بدي استشاره', 'بدي ديمو', 'demo', 'جاهز اشتري',
      'بدي اشتري', 'بدي اشترك', 'بدي ابدا', 'خلينا نبدا', 'رقم الحساب', 'العقد', 'ابعتلي العقد', 'تواصلوا معي',
      'كلموني', 'اتصلوا فيي', 'مهند', 'بدي احكي مع حدا', 'بدي احكي مع موظف', 'شخص حقيقي', 'نرتب موعد', 'بدي موعد'
    ];
    if (agreementTriggers.some(trigger => t.includes(trigger))) {
      return {
        reply_text: handoffMsg,
        identified_problem: 'طلب موعد استشارة / جاهزية للاتفاق',
        proposed_solution: 'AI Sales Systems Implementation',
        lead_stage: 'deal_closing',
        classification: 'Hot',
        buying_probability: 95,
        handoff_triggered: true,
        customer_name: null,
        customer_phone: null
      };
    }

    // Check pricing inquiry
    if (t.includes('سعر') || t.includes('اسعار') || t.includes('بكم') || t.includes('تكلفه') || t.includes('price') || t.includes('cost')) {
      return {
        reply_text: 'أهلاً بك! كل نظام بنبنيه في atlead بيكون مخصص ومفصل تماماً حسب حجم شركتك والأنظمة اللي بتستخدمها، لهيك ما بنعطي باقات جاهزة. الخطوة الأولى بنعمل جلسة استشارة مجانية مدتها 30 دقيقة نفهم فيها طبيعة التحديات عندك ونعطيك خطة عمل وتكلفة دقيقة. شو نوع شغلك بالظبط؟',
        identified_problem: 'استفسار عن الأسعار والباقات',
        proposed_solution: 'جلسة استشارة مجانية لتقييم الاحتياج وتحديد التكلفة',
        lead_stage: 'discovery',
        classification: 'Warm',
        buying_probability: 55,
        handoff_triggered: false
      };
    }

    // Check portfolio / previous work inquiry
    if (t.includes('سابقه') || t.includes('اعمالكم') || t.includes('مشاريعكم') || t.includes('portfolio') || t.includes('شو عملتوا') || t.includes('زبائنكم') || t.includes('خبراتكم')) {
      return {
        reply_text: 'نفذنا بفضل الله أكثر من 9 مشاريع وأنظمة رقمية متقدمة لشركات في قطاعات مختلفة، مثل منصة التجارة الإلكترونية B2B لشركة AGS Technology (agsco.shop) لمعدات السلامة مع كتالوج 166 منتج، وموقع ومنصة الطلبات Moe\'s PureBite، بالإضافة لأنظمة مبيعات ذكية وأتمتة للعديد من الأنشطة. شو المجال أو المشكلة اللي حابب نحلها عندك لنعطيك تفاصيل مشابهة؟',
        identified_problem: 'الاطلاع على سوابق الأعمال والمشاريع',
        proposed_solution: 'عرض دراسات الحالة المماثلة لنشاط العميل',
        lead_stage: 'discovery',
        classification: 'Warm',
        buying_probability: 60,
        handoff_triggered: false
      };
    }

    // Check what is atlead / services inquiry
    if (t.includes('مين انتو') || t.includes('مين شركه') || t.includes('شو بتعملو') || t.includes('خدماتكم') || t.includes('شو الخدمات')) {
      return {
        reply_text: 'أهلاً وسهلاً بك! إحنا في شركة atlead متخصصين في بناء وتصميم أنظمة المبيعات الذكية (AI Sales Systems) وأتمتة العمليات وتأهيل العملاء للشركات حتى نحول استفساراتكم لمبيعات فعلية. شو أكتر تحدي بيواجهكم حالياً بالمبيعات أو بمتابعة العملاء؟',
        identified_problem: 'التعرف على خدمات الشركة وتخصصها',
        proposed_solution: 'AI Sales Systems',
        lead_stage: 'discovery',
        classification: 'Warm',
        buying_probability: 40,
        handoff_triggered: false
      };
    }

    // General welcoming reply
    return {
      reply_text: 'أهلاً وسهلاً بك! معك المساعد الذكي من شركة atlead. كيف بنقدر نساعدك ونطور مبيعات شركتك اليوم؟ شو نوع البزنس تبعكم؟',
      identified_problem: null,
      proposed_solution: null,
      lead_stage: 'new',
      classification: 'Cold',
      buying_probability: 30,
      handoff_triggered: false
    };
  }

  // Audio transcription (Voice notes - الفويسّات)
  async transcribeAudio(audioFilePath, mimeType = 'audio/ogg') {
    const settings = storageService.getSettings();
    const aiConfig = settings.ai || {};

    // 1. Try Gemini Multimodal Audio
    if (aiConfig.gemini_api_key) {
      try {
        const audioBuffer = fs.readFileSync(audioFilePath);
        const base64Audio = audioBuffer.toString('base64');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.gemini_model || 'gemini-2.5-flash'}:generateContent?key=${aiConfig.gemini_api_key}`;

        const response = await axios.post(url, {
          contents: [{
            parts: [
              {
                text: 'أنت خبير تفريغ صوتي دقيق للغة العربية واللهجة الأردنية. قم بتفريغ هذا التسجيل الصوتي بدقة تامة واكتب النص المنطوق فقط بدون أي مقدمات أو تعليقات إضافية:'
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Audio
                }
              }
            ]
          }]
        }, { timeout: 35000 });

        const transcript = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (transcript) return transcript;
      } catch (err) {
        console.error('Gemini Audio Transcription Error:', err.response?.data || err.message);
      }
    }

    // 2. Try OpenAI Whisper
    if (aiConfig.openai_api_key) {
      try {
        const FormData = require('multer'); // or direct form-data
        // Fallback or basic handling
      } catch (err) {
        console.error('Whisper Audio Transcription Error:', err.message);
      }
    }

    // No transcription engine available: don't invent content, just flag it.
    return null;
  }

  // Comment Analysis for Facebook & Instagram Posts
  /**
   * Understand an image the customer sent (screenshot, product photo, document...).
   * Returns a short Arabic description, or null if no vision-capable key / disabled.
   */
  async describeImage(filePath, mimeType = 'image/jpeg') {
    const aiConfig = storageService.getSettings().ai || {};
    if (aiConfig.image_understanding_enabled === false) return null;
    let buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch {
      return null;
    }
    if (buffer.length > 7 * 1024 * 1024) return null; // too big for inline upload
    const prompt = 'العميل بعث هذه الصورة بمحادثة مبيعات. صف محتواها باختصار (جملتين كحد أقصى) بالعربي: شو بتعرض؟ وإذا فيها نص أو أرقام مهمة أو رسالة خطأ اكتبها. بدون مقدمات.';
    const base64 = buffer.toString('base64');
    const mime = /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mimeType) ? mimeType : 'image/jpeg';

    if (aiConfig.gemini_api_key && (aiConfig.provider !== 'openai' || !aiConfig.openai_api_key)) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.gemini_model || 'gemini-2.5-flash'}:generateContent?key=${aiConfig.gemini_api_key}`;
        const res = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }]
        }, { timeout: 30000 });
        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } catch (err) {
        console.error('Gemini image error:', err.response?.data?.error?.message || err.message);
      }
    }
    if (aiConfig.openai_api_key) {
      try {
        const res = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: aiConfig.openai_model || 'gpt-4o',
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] }],
          max_tokens: 200
        }, { headers: { Authorization: `Bearer ${aiConfig.openai_api_key}` }, timeout: 30000 });
        const text = res.data?.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } catch (err) {
        console.error('OpenAI image error:', err.response?.data?.error?.message || err.message);
      }
    }
    return null;
  }

  // Builds the text the bot "sees" for an image message.
  imageMessageText(caption, description) {
    const parts = [];
    if (caption) parts.push(caption);
    parts.push(description ? `[صورة من العميل: ${description}]` : '[العميل بعث صورة]');
    return parts.join('\n');
  }

  // Generic "give me JSON" call used for comment analysis.
  async callJson(systemPrompt, userPrompt) {
    const aiConfig = storageService.getSettings().ai || {};
    const provider = aiConfig.provider || 'gemini';
    const parse = (t) => {
      let c = (t || '').trim().replace(/^```json/, '').replace(/^```/, '').replace(/```$/, '').trim();
      return JSON.parse(c);
    };

    if (provider === 'gemini' && aiConfig.gemini_api_key) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.gemini_model || 'gemini-2.5-flash'}:generateContent?key=${aiConfig.gemini_api_key}`;
      const res = await axios.post(url, {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json' }
      }, { timeout: 20000 });
      return parse(res.data?.candidates?.[0]?.content?.parts?.[0]?.text);
    }
    if (provider === 'openai' && aiConfig.openai_api_key) {
      const res = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: aiConfig.openai_model || 'gpt-4o',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.4,
        response_format: { type: 'json_object' }
      }, { headers: { Authorization: `Bearer ${aiConfig.openai_api_key}` }, timeout: 20000 });
      return parse(res.data?.choices?.[0]?.message?.content);
    }
    return null;
  }

  async analyzeComment(commentText, { userName = '', platform = 'facebook' } = {}) {
    const settings = storageService.getSettings();
    const metaConfig = settings.meta || {};

    // 1. AI analysis (when an API key is configured)
    try {
      const kb = knowledgeService.getSystemPrompt();
      const system = `${kb}

أنت الآن ترد على تعليق عام على منشور ${platform === 'instagram' ? 'إنستغرام' : 'فيسبوك'} لشركة atlead.
القواعد:
- إذا كان التعليق استفساراً عن الشغل أو الخدمات أو الأسعار أو طلب تفاصيل أو تواصل: is_interested = true.
  - public_reply: رد عام قصير ولطيف باللهجة الأردنية يقول له إننا رح نتواصل معه على الخاص (لا تذكر أسعار أو تفاصيل في الرد العام).
  - auto_dm: أول رسالة خاصة نبعثها له، ترحب به وتجاوب على استفساره باختصار وتسأله سؤال استكشافي واحد عن شغله.
- إذا كان التعليق مجرد تفاعل (شكر، إعجاب، منشن لصديق، إيموجي): is_interested = false، و public_reply رد شكر قصير، و auto_dm فارغ.
- إذا كان التعليق سلبياً أو سباماً: is_interested = false، sentiment = "negative"، public_reply رد مهذب جداً أو فارغ.
أعد JSON فقط بالشكل: {"is_interested": bool, "sentiment": "interested|neutral|negative|inquiry", "public_reply": "...", "auto_dm": "..."}`;
      const result = await this.callJson(system, `اسم المعلّق: ${userName || 'غير معروف'}\nنص التعليق: "${commentText}"`);
      if (result && typeof result.is_interested === 'boolean') {
        return {
          is_interested: result.is_interested,
          sentiment: result.sentiment || (result.is_interested ? 'interested' : 'neutral'),
          public_reply: result.public_reply || '',
          auto_dm: result.auto_dm || metaConfig.auto_dm_template || ''
        };
      }
    } catch (err) {
      console.warn('AI comment analysis failed, using keyword fallback:', err.response?.data?.error?.message || err.message);
    }

    // 2. Keyword fallback
    const lower = (commentText || '').toLowerCase();

    // Keywords that show commercial interest or inquiry
    const interestKeywords = [
      'سعر', 'اسعار', 'بكم', 'تفاصيل', 'مهتم', 'كم', 'حجز', 'تواصل', 
      'شراء', 'خدمة', 'عرض', 'شات بوت', 'سيستم', 'واتساب', 'demo', 
      'price', 'cost', 'interested', 'details', 'how much', 'info'
    ];

    const isInterested = interestKeywords.some(kw => lower.includes(kw));

    const publicReply = isInterested
      ? metaConfig.comment_reply_template || 'أهلاً بك! تم إرسال كافة التفاصيل ورابط التواصل على الخاص (DM) لخدمتك بأفضل شكل 🚀'
      : 'شكراً لتعليقك وتفاعلك معنا في atlead! يسعدنا دائماً تواصلكم.';

    const privateDm = metaConfig.auto_dm_template || 
      'أهلاً وسهلاً بك! لاحظنا اهتمامك بتطوير أنظمة المبيعات الذكية لشركتك. معك المساعد الذكي من شركة atlead، كيف نقدر نساعدك ونطور مبيعاتك اليوم؟';

    return {
      is_interested: isInterested,
      sentiment: isInterested ? 'interested' : 'neutral',
      public_reply: publicReply,
      auto_dm: privateDm
    };
  }
}

module.exports = new AiService();
