/**
 * Dashboard language switch (Arabic ⇄ English).
 * Arabic is the source language in the HTML; English comes from this dictionary.
 * Works on static HTML and on content rendered later (MutationObserver), and on
 * placeholder / title / aria-label attributes. The choice is saved per browser.
 */
(function () {
  const EN = {
    // Page & navigation
    'atlead | منصة إدارة أنظمة المبيعات الذكية والشات بوت': 'atlead | AI Sales Systems & Chatbot Platform',
    'صندوق المحادثات الموحد': 'Unified Inbox',
    'إدارة الصفقات والـ CRM': 'Deals & CRM',
    'التعليقات والتحويل للخاص': 'Comments & Auto-DM',
    'مختبر تجربة البوت والفويس': 'Bot & Voice Lab',
    'قاعدة المعرفة والأعمال السابقة': 'Knowledge Base & Portfolio',
    'إعدادات الربط والـ APIs': 'Integrations & APIs',
    'التسويق الذكي وجدولة المنشورات': 'Smart Marketing & Scheduling',
    'اختبار الهوية': 'Identity test',
    'هويتك على كل الوسائط': 'Your identity on every medium',
    'صمّم كل الوسائط': 'Design every medium',
    'أكمل الناقص': 'Finish the rest',
    'جاري التصميم…': 'Designing…',
    'أعد التصميم': 'Redesign',
    'ملاحظة للتعديل (اختياري)': 'Feedback (optional)',
    'بالدور': 'Queued',
    'سوشال ميديا': 'Social media',
    'إعلانات وطرق': 'Ads & outdoor',
    'مطبوعات': 'Print',
    'رقمي': 'Digital',
    'المكتب والمنتجات': 'Office & merch',
    'هوية التصميم': 'Design identity',
    'تعلّم من صفحتي': 'Learn from my page',
    'أعد التعلّم من صفحتي': 'Re-learn from my page',
    'ارفع اللوغو': 'Upload logo',
    'أضف تصميماً كمرجع': 'Add a reference design',
    'حلّل من جديد': 'Re-analyse',
    'عدّل هذه الصورة': 'Edit this image',
    'اعتمد هذه الصورة وانتقل إلى النص': 'Use this image and go to caption',
    'عدّله بالذكاء الاصطناعي': 'Edit with AI',
    'عدّل يدوياً': 'Edit by hand',
    'عدّل النص بالمحادثة': 'Edit the caption by chat',
    'اعتمد هذا النص وانتقل إلى الموعد': 'Use this caption and pick a time',
    'كل عميل، نسبة شرائه ومرحلته — متزامن مع Google Sheets.': 'Every customer, their buying score and stage — synced with Google Sheets.',
    'يرد البوت على التعليقات، ويرسل رسالة خاصة لكل مهتم.': 'The bot replies to comments and messages everyone who is interested.',
    'جرّب تعليقاً': 'Try a comment',
    'جرّب البوت': 'Try the bot',
    'اكتب رسالة أو أرسل صورة أو تسجيلاً صوتياً، وشاهد كيف يرد البوت.': 'Type, send an image or a voice note, and see how it replies.',
    'ما فهمه البوت': 'What the bot understood',
    'تصنيف العميل ونسبة الشراء بعد كل رد.': 'Customer classification and buying score after each reply.',
    'العميل جاهز وتحوّل للموظف': 'Customer is ready and handed to staff',
    'توقف البوت مع هذا العميل، وحُفظت بياناته وأُرسلت إلى الفريق.': 'The bot stopped for this customer; their details were saved and sent to the team.',
    'موضوع ← صورة ← نص ← موعد، ثم يُنشر المنشور تلقائياً.': 'Topic → image → caption → time, and the post goes out on its own.',
    'يجيب البوت من هذه الملفات فقط، وأي تعديل يُطبّق فوراً.': 'The bot answers only from these files — edits apply immediately.',
    'ملفات الشركة ومعلومات إضافية': 'Company files and extra info',
    'إضافة وثيقة جديدة': 'Add a new document',
    'التعليمات الكاملة التي يراها البوت': 'The full instructions the bot sees',
    'الحسابات المربوطة وسلوك البوت. عدّل الإعدادات ثم اضغط حفظ.': 'Connected accounts and bot behavior. Edit, then save.',
    'حفظ الإعدادات': 'Save settings',
    'فحص النظام': 'System check',
    'يفحص كل ربط على حساباتك الفعلية ويبيّن ما ينقص.': 'Checks every connection on your real accounts and tells you what is missing.',
    'فيسبوك وإنستغرام': 'Facebook & Instagram',
    'ربط الحساب': 'Connect account',
    'موافقة واحدة على فيسبوك تربط الصفحة وإنستغرام بجميع الصلاحيات.': 'One Facebook approval connects the Page and Instagram with every permission.',
    'رابط الرجوع (Valid OAuth Redirect URI):': 'Return link (Valid OAuth Redirect URI):',
    'يُعبّأ تلقائياً بعد تسجيل الدخول بفيسبوك.': 'Filled in automatically after signing in with Facebook.',
    'رد التعليق الاحتياطي': 'Fallback comment reply',
    'الرسالة الخاصة الاحتياطية': 'Fallback private message',
    'تُرسل فقط عند تعذّر الذكاء الاصطناعي.': 'Sent only when the AI is unavailable.',
    'QR كود (جهاز مرتبط)': 'QR code (linked device)',
    'بعد آخر رسالة من العميل. يُرد على الرسائل المتتالية مرة واحدة.': 'After the customer’s last message. Messages in a row get one reply.',
    'من لوحة التحكم، الجوال، أو صندوق رسائل فيسبوك وإنستغرام.': 'From the dashboard, the phone, or the Facebook/Instagram inbox.',
    'لا يعود البوت للعملاء المحوّلين إلى الموظف إلا يدوياً.': 'Customers handed to staff only get the bot back manually.',
    'تُنشأ تلقائياً إن لم تكن موجودة.': 'Created automatically if missing.',
    'استخدم رابط المجيب العام (وليس رابط التعديل).': 'Use the public responder link (not the edit link).',
    'تحديث صف العميل بعد كل رسالة': 'Update the customer row after every message',
    'إيميلات الإدارة': 'Management emails',
    'من حساب Google ← Security ← App passwords (وليس كلمة مرور البريد).': 'From Google Account → Security → App passwords (not your email password).',
    'رابط لوحة التحكم (اختياري)': 'Dashboard link (optional)',
    'أبلغني إذا كتب العميل المحوّل من جديد': 'Tell me when a handed-off customer writes again',
    'يُسند كل عميل جاهز إلى موظف بالتناوب، ويصله بريد بتفاصيل العميل.': 'Each ready customer is assigned to the next person, who gets an email with the details.',
    'نسخة احتياطية يومية': 'Daily backup',
    'الذكاء الاصطناعي': 'AI',
    'التحويل للموظف': 'Handoff to staff',
    'رسالة التحويل': 'Handoff message',
    'أو إذا وافق على استشارة أو طلب التحدث مع موظف.': 'Or when they agree to a consultation or ask for a person.',
    'بعد التحويل يواصل البوت الرد حتى يرد الموظف، ويصل الموظفَ بريدٌ بكل التفاصيل.': 'After handoff the bot stays silent and staff get an email with every detail.',
    'حسابات الأعمال أو صنّاع المحتوى فقط.': 'Business or creator accounts only.',
    'يُعبّأ تلقائياً على Railway.': 'Filled in automatically on Railway.',
    'إنشاء منشور': 'Create post',
    'دراسة السوق والمنافسين': 'Market & competitors',
    'المنشورات المجدولة والسابقة': 'Scheduled & past posts',
    'الإعدادات والربط': 'Setup',
    'منشور جديد': 'New post',
    'أرسل اقتراحات اليوم على تليجرام': "Send today's ideas to Telegram",
    'النظام: متصل ويعمل': 'System: online',
    'حالة ربط Meta (فيسبوك وإنستغرام)': 'Meta connection (Facebook & Instagram)',
    'حالة ربط واتساب': 'WhatsApp connection',
    'حالة قاعدة بيانات Supabase': 'Supabase database status',
    'حالة ربط Google Sheets': 'Google Sheets connection',

    // Inbox
    'بحث عن عميل أو هاتف...': 'Search customer or phone...',
    'الكل': 'All',
    'واتساب': 'WhatsApp',
    'إنستغرام': 'Instagram',
    'ماسنجر': 'Messenger',
    'محاكي': 'Simulator',
    'جاهز للصفقة': 'Ready to close',
    'اختر محادثة لعرضها': 'Select a conversation',
    'اختر محادثة من القائمة للبدء أو اختبار النظام': 'Pick a conversation from the list to start',
    'اكتب رداً يدوياً للعميل كـ موظف بشري...': 'Type a manual reply as a human agent...',
    'إرسال': 'Send',
    'الرد الآلي للشات بوت': 'Chatbot auto-reply',
    'مفعل': 'On',
    'مفعّل': 'On',
    'مفعل ويعمل': 'On and running',
    'إيقاف البوت': 'Pause bot',
    'إعادة تفعيل البوت': 'Resume bot',
    'اضغط "إعادة تفعيل البوت" عند انتهائها.': 'Click "Resume bot" when you are done.',
    'تم إيقاف البوت يدوياً لهذا العميل.': 'The bot was paused manually for this customer.',
    'الموظف المسؤول:': 'Assigned agent:',
    'السبب:': 'Reason:',
    'وصل العميل إلى مرحلة الصفقة، وتم إيقاف البوت تلقائياً حتى يتسلّمه موظف المبيعات.': 'The customer reached the deal stage; the bot stopped automatically until a human agent takes over.',
    'بيانات وتأهيل العميل': 'Customer profile & qualification',
    'مرحلة العميل:': 'Stage:',
    'التصنيف:': 'Classification:',
    'نسبة الشراء والاهتمام:': 'Buying probability:',
    'المشكلة المحددة:': 'Identified problem:',
    'الحل المقترح:': 'Proposed solution:',
    'ترحيل لـ Google Sheet': 'Push to Google Sheet',
    'محادثة جديدة': 'New conversation',
    'عميل محتمل': 'Potential customer',
    'لم تحدد بعد': 'Not set yet',
    'لم يحدد بعد': 'Not set yet',
    'لا توجد رسائل سابقة في هذه المحادثة': 'No messages in this conversation yet',
    'العميل': 'Customer',
    'مساعد atlead الذكي': 'atlead AI assistant',
    'الموظف البشري': 'Human agent',
    'تعليق': 'Comment',
    'البوت': 'Bot',
    'الموظف': 'Agent',
    'صورة': 'Image',
    'تسجيل صوتي': 'Voice note',
    'فشل الإرسال للمنصة': 'Failed to send to the platform',
    'محاكاة — القناة غير مربوطة': 'Simulated — channel not connected',
    'حدث خطأ أثناء تبديل حالة البوت': 'Error while switching the bot state',
    'تم إرسال الرد بنجاح!': 'Reply sent!',
    'فشل إرسال الرد اليدوي': 'Failed to send the manual reply',
    'موقوف يدوياً': 'Paused manually',
    'محوّل إلى الموظف — البوت لا يرد': 'Handed to an agent — bot is off',
    'حتى إعادة تشغيله': 'until you resume it',
    'من': 'from',

    // CRM
    'سجل العملاء وإدارة الصفقات (Leads & Deals CRM)': 'Leads & Deals CRM',
    'بيانات العملاء، نسب الشراء، ومراحل الاتفاق المتزامنة مع Google Sheets و Supabase': 'Customer data, buying probability and deal stages — synced with Google Sheets and Supabase',
    'طريقة ربط Google Sheet': 'How to connect Google Sheet',
    'مزامنة كافة الصفقات مع Google Sheet': 'Sync all deals to Google Sheet',
    'إجمالي المحادثات': 'Total conversations',
    'عملاء مؤهلين (Hot Leads)': 'Qualified (Hot Leads)',
    'صفقات جاهزة للإغلاق (Deals)': 'Ready to close (Deals)',
    'مرحّلة لـ Google Sheet': 'Synced to Google Sheet',
    'اسم العميل': 'Customer name',
    'رقم الهاتف / الحساب': 'Phone / account',
    'القناة': 'Channel',
    'المرحلة': 'Stage',
    'التصنيف': 'Classification',
    'نسبة الشراء والاهتمام': 'Buying probability',
    'المشكلة المحددة': 'Identified problem',
    'الحل المقترح': 'Proposed solution',
    'حالة الشراء': 'Purchase status',
    'تزامن Google Sheet': 'Google Sheet sync',
    'إجراءات': 'Actions',
    'لم يشترِ بعد': 'Not purchased yet',
    'بانتظار الموظف': 'Waiting for agent',
    'اشترى': 'Purchased',
    'لم يشترِ': 'Did not buy',
    'غير مسجل': 'Not recorded',
    'تم إبلاغ الموظف': 'Agent notified',
    '— غير مُسند —': '— unassigned —',
    'جاري الترحيل إلى Google Sheets...': 'Pushing to Google Sheets...',
    'فشل الترحيل إلى جوجل شيت': 'Failed to push to Google Sheets',
    'جاري مزامنة كل العملاء مع Google Sheets...': 'Syncing all customers to Google Sheets...',
    'مزامنة فورية مع Google Sheet': 'Sync to Google Sheet now',
    'إرسال تفاصيل العميل للموظف بالإيميل': 'Email customer details to the agent',
    'جاري إرسال تفاصيل العميل بالإيميل...': 'Emailing customer details...',
    'هذه المحادثة لم تصل بعد لمرحلة تأهيل العميل كـ Lead مسجل': 'This conversation has not been qualified as a lead yet',

    // Comments
    'ردود التعليقات والتحويل التلقائي للخاص (Auto-DM Engine)': 'Comment replies & Auto-DM engine',
    'يقوم البوت بالرد على تعليقات فيسبوك وإنستغرام تلقائياً، وفي حال كان المعلق مهتماً بالخدمة يرسل له رسالة خاصة (DM) فوراً لبدء التأهيل وإغلاق الصفقة!': 'The bot replies to Facebook and Instagram comments automatically, and sends interested commenters a private DM to start qualifying them.',
    'تجربة محاكاة تعليق جديد وتحويله للخاص': 'Simulate a new comment and auto-DM',
    'سجل التعليقات الواردة وإجراءات التحويل للخاص': 'Incoming comments & DM actions',
    'المنصة': 'Platform',
    'صاحب التعليق': 'Commenter',
    'نص التعليق': 'Comment',
    'تحليل الاهتمام': 'Interest analysis',
    'الرد العام على التعليق': 'Public reply',
    'الرسالة الخاصة (DM المرسلة)': 'Private message (DM sent)',
    'التاريخ': 'Date',
    'متابع': 'Follower',
    'مهتم بالشراء / استفسار': 'Interested / inquiry',
    'تفاعل عام': 'General engagement',
    'بانتظار الرد...': 'Waiting to reply...',
    'محوّل إلى موظف — لم يرد البوت': 'Handed to agent — bot did not reply',
    'أدخل نص التعليق الذي ترغب بمحاكاته على فيسبوك أو إنستغرام:': 'Enter the comment text to simulate on Facebook or Instagram:',
    'جاري فحص التعليق وتطبيق الرد والرسالة الخاصة...': 'Analysing the comment and sending the reply and DM...',
    'عميل تجريبي': 'Test customer',
    'فشل محاكاة التعليق': 'Comment simulation failed',

    // Simulator
    'مختبر تجربة الشات بوت (Simulator)': 'Chatbot Simulator',
    'جرب الحديث مع البوت كتابياً أو عبر تسجيل فويس وشاهد كيف يطبق قواعد atlead': 'Chat with the bot by text, voice or image and watch how it applies atlead\'s rules',
    'إعادة تعيين': 'Reset',
    'اسأل عن الأسعار': 'Ask about prices',
    'اسأل عن سوابق الأعمال': 'Ask about previous work',
    'جرّب مرحلة الصفقة والإغلاق (Handoff)': 'Try the deal / handoff stage',
    'اكتب رسالة لتجربة رد البوت...': 'Type a message to test the bot...',
    'رفع صورة لاختبار فهم البوت للصور': 'Upload an image to test image understanding',
    'رفع تسجيل صوتي لاختباره': 'Upload a voice note to test it',
    'تحليل الذكاء الاصطناعي الحي (AI Inspector)': 'Live AI Inspector',
    'يعرض لك هذا المربع تفاصيل تفكير البوت، تصنيف العميل، وحالة نقطة الإغلاق والاتفاق (Deal Closing).': 'Shows the bot\'s reasoning, the customer classification and the deal-closing state.',
    'مرحلة العميل الحالية (Stage):': 'Current stage:',
    'التصنيف (Classification):': 'Classification:',
    'نسبة الشراء والاهتمام المتوقعة:': 'Expected buying probability:',
    'حالة تشغيل البوت (Bot Active):': 'Bot active:',
    'مفعل': 'On',
    'موقوف (محول للبشري)': 'Off (handed to a human)',
    'تحويل للبشري / ديل (Handoff Triggered):': 'Handoff triggered:',
    'لا (False)': 'No',
    'لا': 'No',
    'نعم (تم الاتفاق والتحويل!)': 'Yes (deal reached and handed off!)',
    'المشكلة المكتشفة:': 'Detected problem:',
    'الحل المقترح من atlead:': 'Proposed atlead solution:',
    'تم الوصول لمرحلة الديل بنجاح!': 'Deal stage reached!',
    'أصدر البوت عبارة التحويل الرسمية لمسؤول المبيعات (م. مهند)، وقام النظام': 'The bot sent the official handoff message to the sales rep, and the system',
    'بإيقاف البوت تلقائياً': 'paused the bot automatically',
    'وترحيل العميل إلى Supabase وجوجل شيت بنجاح. لن يقوم البوت بالرد على أي رسائل قادمة من هذا العميل حتى يستلم الفريق البشري.': 'and saved the customer to Supabase and Google Sheets. The bot will not answer this customer until the human team takes over.',
    'أنت (المستخدم)': 'You (user)',
    'حدث خطأ أثناء معالجة الرسالة في المختبر.': 'Error while processing the message in the lab.',
    'جاري رفع التسجيل الصوتي وتفريغه...': 'Uploading and transcribing the voice note...',
    'تسجيل صوتي (تعذّر تفريغه)': 'Voice note (could not transcribe)',
    'تم استلام التسجيل الصوتي وتفريغه والرد عليه بنجاح.': 'Voice note received, transcribed and answered!',
    'فشل تفريغ التسجيل الصوتي': 'Voice transcription failed',
    'جاري رفع الصورة وتحليلها...': 'Uploading and analysing the image...',
    'فشل تحليل الصورة': 'Image analysis failed',
    'فشل رفع الصورة': 'Image upload failed',

    // Knowledge base
    'قاعدة المعرفة وسوابق الأعمال (Knowledge Base & Portfolio)': 'Knowledge Base & Portfolio',
    'الملفات وسوابق الأعمال المحملة في عقل الشات بوت لتقديم إجابات ذكية وعرض نماذج الأعمال للعملاء': 'The documents and previous work the chatbot answers from',
    'ملف قاعدة المعرفة الرسمية (atlead Sales Chatbot KB)': 'Official knowledge base (atlead Sales Chatbot KB)',
    'تم استخراج وفهرسة 21 صفحة من ملف إرشادات وتوجيهات البيع للشات بوت، وتشمل:': '21 pages of sales guidelines were extracted and indexed, including:',
    'التموضع (Positioning):': 'Positioning:',
    'بناء أنظمة مبيعات متكاملة ومخصصة وحلول رقمية.': 'Building complete, custom sales systems and digital solutions.',
    'شخصية البوت:': 'Bot persona:',
    'موظف مبيعات أردني محترف وودود، لهجة بيضاء، متواضع وواضح.': 'A friendly, professional Jordanian sales rep — clear and humble.',
    'القاعدة الذهبية:': 'Golden rule:',
    'الإجابة أولاً ثم طرح سؤال استكشافي واحد لفهم المشكلة.': 'Answer first, then ask one discovery question.',
    'سياسة الأسعار:': 'Pricing policy:',
    'ممنوع إعطاء أسعار ثابتة بالشات؛ الخطوة الأولى استشارة مجانية 30 دقيقة.': 'No fixed prices in chat; the first step is a free 30-minute consultation.',
    'نقطة الإغلاق والتحويل:': 'Closing & handoff:',
    'التحويل لمسؤول المبيعات (م. مهند) وإيقاف البوت تماماً.': 'Hand over to the sales rep and stop the bot completely.',
    'سوابق الأعمال والخبرات (Atlead Portfolio - 41 صفحة)': 'Previous work (atlead Portfolio — 41 pages)',
    'محمل في عقل البوت كافة تفاصيل المشاريع والأنظمة الرقمية التسعة المكتملة، وأهمها:': 'The bot knows all nine completed projects, including:',
    'منصة تجارة إلكترونية B2B لمعدات السلامة العامة وأنظمة القياس بـ 166 منتج.': 'B2B e-commerce platform for safety & measurement equipment with 166 products.',
    'منصة طلبات إلكترونية لمطبخ متخصص.': 'Online ordering platform for a specialised kitchen.',
    'أنظمة RAG وذكاء اصطناعي:': 'RAG & AI systems:',
    'أنظمة تدريب واستشارات ذكية ومساعدات حجز مواعيد.': 'Smart training, consulting and booking assistants.',
    'تكامل CRM وأتمتة العمليات:': 'CRM integration & automation:',
    'ربط المحادثات مع جداول جوجل وقواعد البيانات.': 'Connecting conversations to Google Sheets and databases.',
    'معلومات إضافية للبوت (أحدث من الملفات — الأولوية لها)': 'Extra information for the bot (newer than the files — takes priority)',
    'إضافة وثيقة جديدة (خدمة، عرض، أسعار داخلية، سياسة...)': 'Add a new document (service, offer, policy...)',
    'عنوان الوثيقة': 'Document title',
    'محتوى الوثيقة': 'Document content',
    'الصق نص الوثيقة هنا، وسيجيب البوت منها فور الحفظ.': 'Paste the document text here — the bot answers from it right after saving.',
    'إضافة الوثيقة': 'Add document',
    'مثال: لدينا عرض هذا الشهر... / ساعات الدوام... / خدمة جديدة... — يجيب البوت فوراً من أي معلومة تكتبها هنا.': 'e.g. this month\'s offer / working hours / a new service — the bot answers from anything you write here.',
    'حفظ المعلومات': 'Save information',
    'التوجيهات البرمجية الحية للبوت (System Prompt Active)': 'Live system prompt',
    'وثيقة': 'Document',
    'حفظ الوثيقة': 'Save document',
    'يجيب البوت من هذه الوثيقة': 'The bot answers from this document',
    'تم الحفظ': 'Saved',
    'فشل الحفظ': 'Save failed',
    'اكتب عنوان ومحتوى للوثيقة': 'Enter a title and content',
    'تمت الإضافة': 'Added',
    'فشلت الإضافة': 'Add failed',

    // Settings — general
    'مركز الربط وإدارة المفاتيح والـ APIs (Integrations Hub)': 'Integrations Hub',
    'تحكم بجميع مفاتيح الربط لأرقام واتساب، إنستغرام، فيسبوك، سوبر بيز، وجوجل شيت وحفظها فوراً': 'Manage all keys for WhatsApp, Instagram, Facebook, Supabase and Google Sheets',
    'حفظ وتحديث الإعدادات': 'Save settings',
    'فحص النظام الكامل': 'Full system check',
    'افحص كل شيء': 'Check everything',
    'بعد ما تحفظ إعداداتك، اضغط الزر: بنفحص كل ربط على حساباتك الحقيقية (AI، واتساب، Meta، الداتابيز، الشيت، Gmail) وبنحكيلك بالضبط شو ناقص.': 'After saving, click the button: we test every connection on your real accounts (AI, WhatsApp, Meta, database, Sheets, Gmail) and tell you exactly what is missing.',
    'تم حفظ وتحديث الإعدادات بنجاح!': 'Settings saved!',
    'فشل حفظ الإعدادات': 'Failed to save settings',
    'نسخ': 'Copy',
    'إضافة': 'Add',
    'حذف': 'Delete',
    'معاينة': 'Preview',

    // Settings — Meta
    'إعدادات فيسبوك وإنستغرام (Meta API)': 'Facebook & Instagram (Meta API)',
    'فحص الإنستا والتعليقات': 'Check Instagram & comments',
    'فحص الاتصال': 'Test connection',
    'Page Access Token (رمز وصول الصفحة)': 'Page Access Token',
    'رمز الوصول الخاص بصفحة فيسبوك وحساب إنستغرام للأعمال المرتبط بها.': 'Access token of the Facebook Page and its linked Instagram business account.',
    'Page ID (معرف الصفحة)': 'Page ID',
    'App Secret (اختياري — للتحقق من توقيع الويب هوك)': 'App Secret (optional — verifies webhook signatures)',
    'من إعدادات التطبيق في Meta Developers': 'From the app settings in Meta Developers',
    'رمز التحقق الذي تدخله في Meta Developer Portal عند إعداد الـ Webhook.': 'The verify token you enter in the Meta Developer Portal when setting up the webhook.',
    'Webhook Callback URL (رابط الويب هوك الخاص بك):': 'Your webhook callback URL:',
    'الرد الآلي على التعليقات': 'Auto-reply to comments',
    'إرسال رسالة خاصة (DM) للمهتمين': 'Send a private DM to interested commenters',
    'الرد العام على التعليق (يُستخدم إذا لم يتوفر مفتاح AI)': 'Public comment reply (used when no AI key is available)',
    'الرسالة الخاصة الأولى لصاحب التعليق (إذا لم يتوفر مفتاح AI)': 'First private message to the commenter (when no AI key is available)',
    'مع مفتاح Gemini/OpenAI، البوت يكتب الرد العام والرسالة الخاصة حسب سؤال كل شخص.': 'With an AI key, the bot writes the public reply and the DM based on each person\'s question.',
    'جاري الاستعلام من Meta مباشرة...': 'Asking Meta directly...',
    'لا توجد أحداث حتى الآن — أرسل رسالة أو تعليقاً تجريبياً ثم اضغط الزر مرة أخرى.': 'No events yet — send a test message or comment and click the button again.',
    'جاري فحص اتصال Meta API...': 'Testing the Meta API connection...',
    'Meta متصل': 'Meta connected',
    'Meta جاهز للربط': 'Meta ready to connect',

    // Settings — WhatsApp
    'ربط واتساب': 'WhatsApp connection',
    'طريقة الربط': 'Connection method',
    'QR كود — ربط رقمك مباشرة كجهاز مرتبط (مثل واتساب ويب)': 'QR code — link your number as a linked device (like WhatsApp Web)',
    'WhatsApp Cloud API الرسمي (Meta)': 'Official WhatsApp Cloud API (Meta)',
    'رقمك على واتساب (Linked Phone Number)': 'Your WhatsApp number',
    'جاري فحص الحالة...': 'Checking status...',
    'افتح واتساب على هاتفك ← الإعدادات ← الأجهزة المرتبطة ← ربط جهاز، ثم امسح الكود.': 'Open WhatsApp on your phone → Settings → Linked devices → Link a device, then scan the code.',
    'توليد QR': 'Generate QR',
    'ربط بكود بدل QR': 'Link with a code instead',
    'فصل الرقم': 'Disconnect number',
    'Phone Number ID (معرف رقم الهاتف في Meta)': 'Phone Number ID (Meta)',
    'جاري فحص اتصال WhatsApp API...': 'Testing the WhatsApp API connection...',
    'WhatsApp غير مربوط': 'WhatsApp not connected',
    'WhatsApp متصل': 'WhatsApp connected',
    'WhatsApp جاهز': 'WhatsApp ready',
    'امسح الكود من هاتفك': 'Scan the code with your phone',
    'جاري الاتصال...': 'Connecting...',
    'غير مربوط — اضغط "توليد QR"': 'Not connected — click "Generate QR"',
    'جاري توليد كود الربط...': 'Generating the link code...',
    'واتساب ← الأجهزة المرتبطة ← ربط جهاز ← الربط برقم الهاتف، وأدخل الكود': 'WhatsApp → Linked devices → Link a device → Link with phone number, then enter the code',
    'هل تريد فصل رقم واتساب عن البوت؟': 'Disconnect this WhatsApp number from the bot?',
    'تم الفصل': 'Disconnected',

    // Settings — reply behaviour
    'سلوك الرد (التأخير والرد المقتبس)': 'Reply behaviour (delay & quoting)',
    'مدة الانتظار قبل الرد (بالثواني)': 'Wait before replying (seconds)',
    'البوت ينتظر هذه المدة بعد آخر رسالة من العميل. إذا بعث العميل أكثر من رسالة ورا بعض، بيرد عليهم كلهم مرة وحدة — هذا بيحمي الرقم من الحظر.': 'The bot waits this long after the customer\'s last message and answers several messages at once — this protects the number from being banned.',
    'الرد كـ "رد على الرسالة" (اقتباس رسالة العميل فوق الرد)': 'Reply as a quoted reply to the customer\'s message',
    'إظهار "يكتب الآن..." وعلامة القراءة قبل الرد': 'Show "typing..." and read receipts before replying',
    'إيقاف البوت تلقائياً عندما يرد موظف على العميل': 'Pause the bot automatically when an agent replies',
    'سواء رد الموظف من لوحة التحكم، أو من الواتساب على الجوال/واتساب ويب، أو من صندوق رسائل فيسبوك/تطبيق إنستغرام.': 'Whether the agent replies from the dashboard, WhatsApp on the phone / WhatsApp Web, or the Facebook / Instagram inbox.',
    'مدة الإيقاف': 'Pause duration',
    'حتى إعادة تشغيله يدوياً (موصى به)': 'Until I resume it manually (recommended)',
    'ساعة واحدة': '1 hour',
    '4 ساعات': '4 hours',
    '12 ساعة': '12 hours',
    '24 ساعة': '24 hours',
    '3 أيام': '3 days',
    'بعد انتهاء المدة، أول رسالة جديدة من العميل بيرد عليها البوت. العملاء المحوّلين للموظف (مرحلة الشراء) ما بيرجعلهم البوت أبداً إلا يدوياً.': 'After the pause, the bot answers the customer\'s next message. Customers handed to an agent (buying stage) never get the bot back unless you resume it manually.',

    // Settings — Supabase
    'قاعدة بيانات Supabase': 'Supabase database',
    'فحص اتصال Supabase': 'Test Supabase',
    'تفعيل حفظ الرسائل والمحادثات في Supabase أولاً بأول': 'Save messages and conversations to Supabase in real time',
    'عرض كود الـ SQL لجداول Supabase': 'Show the SQL for the Supabase tables',
    'حفظ المحادثات بـ Supabase': 'Conversations saved in Supabase',
    'مزامنة كل البيانات الآن': 'Sync all data now',
    'جاري فحص اتصال Supabase...': 'Testing Supabase...',
    'Supabase متصل': 'Supabase connected',
    'Supabase محلي/نشط': 'Supabase local/active',
    'المحادثات': 'Conversations',
    'الرسائل': 'Messages',
    'العملاء': 'Customers',
    'التعليقات': 'Comments',
    'يُحفظ كل تغيير تلقائياً خلال ثانيتين': 'Every change is saved automatically within 2 seconds',
    'تعذر قراءة حالة المزامنة': 'Could not read the sync status',
    'جاري حفظ كل البيانات بـ Supabase...': 'Saving all data to Supabase...',

    // Settings — Google
    'ربط Google Sheets (كل تفاصيل السيلز)': 'Google Sheets (full sales details)',
    'فحص الربط وتجهيز الشيت': 'Test & prepare the sheet',
    'رابط الشيت (أو Spreadsheet ID)': 'Sheet link (or Spreadsheet ID)',
    'اسم الورقة (Tab)': 'Sheet tab name',
    'إذا مش موجودة بتنعمل تلقائياً مع عناوين الأعمدة.': 'Created automatically with column headers if missing.',
    'ملف Service Account (JSON)': 'Service Account file (JSON)',
    'Google Cloud ← فعّل Google Sheets API ← Service Accounts ← Keys ← Add key ← JSON، ثم الصق محتوى الملف هنا.': 'Google Cloud → enable the Google Sheets API → Service Accounts → Keys → Add key → JSON, then paste the file content here.',
    'شارك الجدول مع هذا البريد بصلاحية': 'Share the sheet with this email as',
    'طريقة بديلة: Google Apps Script Webhook': 'Alternative: Google Apps Script webhook',
    'تُستخدم فقط عند عدم وجود Service Account.': 'Only used when there is no Service Account.',
    'رابط Google Form لاستقبال بيانات العملاء': 'Google Form link for customer data',
    'يتم إرسال السجل كإجابة للنموذج مباشرة بدون API Key. لا تضع رابط التعديل؛ استخدم رابط المجيب العام.': 'Each record is submitted as a form response — no API key needed. Use the public responder link, not the edit link.',
    'إضافة وتحديث بيانات العملاء تلقائياً في Google Form': 'Add customer data to the Google Form automatically',
    'تحديث صف العميل تلقائياً بعد كل رسالة (المرحلة، نسبة الشراء، شو طلب، الملخص...)': 'Update the customer\'s row after every message (stage, probability, requests, summary...)',
    'جاري فحص الربط مع Google Sheets...': 'Testing Google Sheets...',
    'Sheets متزامن': 'Sheets synced',
    'Sheets بانتظار الرابط': 'Sheets not linked',

    // Settings — notifications & team
    'إشعارات الإيميل لفريق المبيعات (Gmail)': 'Email notifications for the sales team (Gmail)',
    'إرسال إيميل تجريبي': 'Send test email',
    'إيميلات الإدارة (بيوصلها كل تحويل + التقرير اليومي)': 'Admin emails (get every handoff + the daily report)',
    'Gmail المرسل': 'Sender Gmail',
    'حساب Google ← Security ← فعّل 2-Step Verification ← App passwords ← أنشئ كلمة سر والصقها هون (مش كلمة سر الإيميل).': 'Google account → Security → turn on 2-Step Verification → App passwords → create one and paste it here (not your email password).',
    'رابط لوحة التحكم (اختياري — لزر "فتح المحادثة" بالإيميل)': 'Dashboard link (optional — for the "Open conversation" button in emails)',
    'تفعيل إشعارات الإيميل': 'Enable email notifications',
    'بلّغني إذا العميل المحوّل بعث رسالة جديدة (مرة كل 30 دقيقة كحد أقصى)': 'Notify me when a handed-off customer sends a new message (at most every 30 minutes)',
    'آخر الإشعارات': 'Latest notifications',
    'لا يوجد إيميلات بعد': 'No emails yet',
    'لا يوجد إشعارات بعد': 'No notifications yet',
    'اكتب إيميل صحيح': 'Enter a valid email',
    'اضغط "حفظ وتحديث الإعدادات" لتثبيت التغيير': 'Click "Save settings" to apply',
    'تمت الإضافة — اضغط "حفظ وتحديث الإعدادات" لتثبيتها': 'Added — click "Save settings" to apply',
    'جاري إرسال بريد تجريبي... (احفظ الإعدادات أولاً إذا عدّلت شيئاً)': 'Sending a test email... (save settings first if you changed something)',
    'فريق المبيعات (توزيع العملاء)': 'Sales team (lead distribution)',
    'العميل اللي بيتحوّل بينسند لموظف بالدور، والبوت بيحكي للعميل اسم الموظف، والإيميل بيوصل للموظف نفسه (+ إيميلات الإدارة). إذا القائمة فاضية، الإيميل بيوصل للإدارة بس.': 'Handed-off customers are assigned to agents in turn; the bot tells the customer the agent\'s name and the agent gets the email (plus admin emails). If the list is empty, only admins are emailed.',
    'اسم الموظف (مثلاً: م. مهند)': 'Agent name (e.g. Eng. Mohannad)',
    'لا يوجد موظفون — تُرسل الرسائل إلى بريد الإدارة.': 'No agents — emails go to the admins.',
    'اضغط "حفظ وتحديث الإعدادات" للتثبيت': 'Click "Save settings" to apply',
    'اكتب اسم الموظف': 'Enter the agent\'s name',
    'البريد مضاف مسبقاً': 'Email already added',
    'تمت الإضافة — اضغط "حفظ وتحديث الإعدادات"': 'Added — click "Save settings"',

    // Settings — hours, follow-ups, reports
    'ساعات الدوام': 'Working hours',
    'تفعيل ساعات الدوام': 'Enable working hours',
    '(البوت بيرد 24 ساعة، بس بيعرف إمتى الموظف متوفر)': '(the bot replies 24/7 but knows when agents are available)',
    'الأحد': 'Sunday',
    'الاثنين': 'Monday',
    'الثلاثاء': 'Tuesday',
    'الأربعاء': 'Wednesday',
    'الخميس': 'Thursday',
    'الجمعة': 'Friday',
    'السبت': 'Saturday',
    'لغاية': 'to',
    'رسالة التحويل خارج الدوام': 'After-hours handoff message',
    '{rep} = اسم الموظف، {time} = موعد التواصل (مثلاً "غداً الساعة 09:00").': '{rep} = agent name, {time} = when they will reach out (e.g. "tomorrow at 09:00").',
    'أرسل بريد الموظفين في بداية الدوام بدلاً من الليل': 'Hold agent emails until the start of working hours',
    'متابعة العملاء المنقطعين': 'Follow up with silent customers',
    'من سيستلم المتابعة؟': 'Who will get one?',
    'إرسال رسالة متابعة تلقائية للعميل المهتم الذي لم يرد': 'Send an automatic follow-up to interested customers who stopped replying',
    'بعد انقطاع العميل لمدة': 'After the customer has been silent for',
    'ساعتين': '2 hours',
    '6 ساعات': '6 hours',
    '20 ساعة (موصى به)': '20 hours (recommended)',
    '23 ساعة': '23 hours',
    'عندما تكون نسبة الشراء على الأقل (%)': 'When the buying probability is at least (%)',
    'أقصى عدد رسائل متابعة لكل عميل': 'Max follow-ups per customer',
    'رسالة واحدة': 'One message',
    'رسالتين': 'Two messages',
    'البوت يكتب رسالة المتابعة حسب محادثة كل عميل (يحتاج مفتاح AI)': 'The bot writes each follow-up from the customer\'s conversation (needs an AI key)',
    'نص المتابعة الاحتياطي': 'Fallback follow-up text',
    'ستُرسل متابعة إلى:': 'Follow-ups will go to:',
    'لا يوجد عملاء بحاجة إلى متابعة حالياً.': 'No customers need a follow-up right now.',
    'التقرير اليومي والنسخ الاحتياطي': 'Daily report & backups',
    'إرسال تقرير يومي لإيميلات الإدارة': 'Send a daily report to admin emails',
    'وقت التقرير': 'Report time',
    'أرسله الآن': 'Send now',
    'جاري إرسال التقرير...': 'Sending the report...',
    'نسخة احتياطية يومية تلقائية': 'Automatic daily backup',
    '(الساعة 3 الفجر، بمجلد backups)': '(at 3 AM, in the backups folder)',
    'احتفظ بالنسخ لمدة': 'Keep backups for',
    '7 أيام': '7 days',
    '14 يوم': '14 days',
    '30 يوم': '30 days',
    '90 يوم': '90 days',
    'نسخة احتياطية الآن': 'Back up now',
    'لا توجد نسخ احتياطية بعد.': 'No backups yet.',

    // Settings — AI & handoff
    'إعدادات الذكاء الاصطناعي ومعالجة الصوت (AI & Voice Engine)': 'AI & Voice Engine',
    'من openrouter.ai ← Keys. البوت بيجاوب العملاء من ملفات الشركة عن طريق هذا المفتاح.': 'From openrouter.ai → Keys. The bot answers customers from the company files using this key.',
    'الموديل (Model)': 'Model',
    'سريع ورخيص (الافتراضي)': 'Fast & cheap (default)',
    'أذكى، أغلى': 'Smarter, pricier',
    'سريع، ويفهم التسجيلات الصوتية والصور': 'Fast, understands voice & images',
    'ردود طبيعية جداً، أغلى': 'Very natural replies, pricier',
    'تفعيل الرد على الرسائل الصوتية': 'Reply to voice notes',
    'فهم الصور التي يرسلها العميل (لقطة شاشة، منتج، مستند...)': 'Understand images customers send (screenshots, products, documents...)',
    'قواعد الإغلاق والتحويل للبشري (Deal Closing Rules)': 'Deal closing & human handoff rules',
    'اسم ممثل المبيعات الرسمي للتحويل': 'Official sales rep name for handoff',
    'رسالة التحويل الرسمية عند نقطة الاتفاق (Handoff Message)': 'Official handoff message',
    '{rep} = اسم الموظف المسؤول عن العميل (أو الاسم أعلاه إذا لم يوجد فريق).': '{rep} = the assigned agent\'s name (or the name above if there is no team).',
    'التحويل للموظف عند وصول نسبة الشراء إلى (%)': 'Hand off when the buying probability reaches (%)',
    'بيتحول العميل كمان إذا وافق على استشارة/ديمو أو طلب يحكي مع شخص، حتى لو النسبة أقل.': 'The customer is also handed off when they accept a consultation/demo or ask for a person, even below this score.',
    'بعد التحويل البوت بيوقف نهائياً مع هذا العميل': 'After handoff the bot stops for good with this customer',
    '— على كل رسائله وتعليقاته، وبيوصل إيميل للموظف بكل تفاصيله. الموظف بس اللي بيرد (وبيقدر يرجّع البوت يدوياً من صندوق المحادثات).': '— on all their messages and comments, and the agent gets an email with every detail. Only the agent replies (they can resume the bot from the inbox).',

    // Modals
    'كود ربط Google Sheets الفوري': 'Google Sheets connection code',
    '✕ إغلاق': '✕ Close',
    'افتح جدول Google Sheet، اضغط من الأعلى': 'Open your Google Sheet, then from the top menu click',
    '، الصق هذا الكود واضغط Deploy كـ Web App:': ', paste this code and Deploy as a Web App:',
    'نسخ الكود': 'Copy code',
    'مخطط قاعدة بيانات Supabase (SQL Schema)': 'Supabase SQL schema',
    'انسخ هذا الاستعلام ونفذه في': 'Copy this query and run it in',
    'لإنشاء كافة الجداول والفهارس المطلوبة:': 'to create all required tables and indexes:',
    'نسخ كود SQL': 'Copy SQL',
    'جاري الفحص... (حتى 25 ثانية)': 'Checking... (up to 25 seconds)',
    'تعذر تشغيل الفحص': 'Could not run the check',
    'Supabase غير مربوط — المحادثات محفوظة على الخادم فقط. عند الربط تُرفع جميع البيانات السابقة تلقائياً.': 'Supabase is not connected — conversations are only on the server. Once connected, all old data is uploaded automatically.',
    'متابع مهتم': "Interested follower",
    'الرد الآلي للبوت نشط': "Bot auto-reply is active",
    'لا يوجد منشور قيد التحضير. اضغط': "No post in progress. Press",
    'وسندرس السوق ونقترح عليك 3 مواضيع.': "and we will study the market and suggest 3 topics.",
    'تحديث الدراسة الآن': "Refresh the study now",
    'جاري التحميل...': "Loading...",
    'بوت تليجرام (رسالة الصباح والتنبيهات)': "Telegram bot (morning message and alerts)",
    'افتح': "Open",
    'بتليجرام ←': "on Telegram ←",
    '← انسخ الرمز (Token) والصقه هنا.': "← copy the token and paste it here.",
    'افتح البوت الخاص بك وأرسل له': "Open your bot and send it",
    'اضغط': "Press",
    'اكتشف رقم المحادثة': "Detect chat ID",
    'ثم': "then",
    'حفظ': "Save",
    'رقم محادثة المسؤول (Chat ID) — أكثر من واحد افصل بفاصلة': "Admin chat ID — separate several with commas",
    'قناة تليجرام للنشر (اختياري)': "Telegram channel for publishing (optional)",
    'لنشر المنشورات على قناتك أيضاً: أضف البوت مشرفاً في القناة.': "To publish posts to your channel too, add the bot as a channel admin.",
    'أرسل لي على تليجرام أيضاً عند وجود عميل جاهز للتواصل': "Also alert me on Telegram when a customer is ready to be contacted",
    'رسالة تجريبية': "Test message",
    'دراسة السوق': "Market research",
    'حسابات المنافسين على إنستغرام (حتى 8)': "Competitor Instagram accounts (up to 8)",
    'كلمات مجالك (للأخبار والترندات)': "Industry keywords (for news and trends)",
    'وصف شركتك وجمهورك (اختياري — وإلا ستُستخدم قاعدة المعرفة)': "Describe your company and audience (optional — otherwise the knowledge base is used)",
    'الجدول والمحتوى': "Schedule and content",
    'وقت رسالة الصباح': "Morning message time",
    'لغة المنشورات': "Post language",
    'نمط الصور (اختياري، ويُفضّل بالإنجليزية)': "Image style (optional, preferably in English)",
    'موديل توليد الصور (اختياري)': "Image generation model (optional)",
    'أرسل لي الاقتراحات كل صباح': "Send me suggestions every morning",
    'إذا كان مفتاح الذكاء الاصطناعي لا يدعم الصور، استخدم مولّداً مجانياً (Pollinations)': "If the AI key does not support images, use a free generator (Pollinations)",
    'أماكن النشر': "Where to publish",
    'فيسبوك (صفحتك)': "Facebook (your page)",
    'قناة تليجرام': "Telegram channel",
    'الرابط العام للسيرفر (للإنستغرام)': "Public server URL (for Instagram)",
    'حفظ إعدادات التسويق': "Save marketing settings",
    'سجّل دخول بفيسبوك وإنستغرام': "Sign in with Facebook and Instagram",
    'Login Configuration ID (اختياري)': "Login Configuration ID (optional)",
    'خطوات أول مرة (5 دقائق) والصلاحيات المطلوبة': "First-time setup (5 minutes) and required permissions",
    'developers.facebook.com ← تطبيقك ←': "developers.facebook.com ← your app ←",
    ': انسخ App ID و App Secret إلى هنا واضغط': ": copy the App ID and App Secret here and press",
    'أضف': "Add",
    '(أو Facebook Login for Business) ← Settings ← الصق': "(or Facebook Login for Business) ← Settings ← paste the",
    'رابط الرجوع': "redirect URL",
    'بخانة Valid OAuth Redirect URIs ← Save.': "into Valid OAuth Redirect URIs ← Save.",
    '، اختر صفحتك وحساب إنستغرام، ووافق على جميع الصلاحيات.': ", choose your page and Instagram account, and approve all permissions.",
    'ثم اضغط': "Then press",
    '— يجب أن تظهر كل الأسطر بعلامة صح.': "— every line should show a check mark.",
    '— عرض صفحاتك': "— list your pages",
    '— صفحات مملوكة لـ Business Manager': "— pages owned by Business Manager",
    '— رسائل الماسنجر': "— Messenger messages",
    '— الاشتراك بالويب هوك': "— webhook subscription",
    '— قراءة منشورات الصفحة': "— read page posts",
    '— قراءة تعليقات الفيس': "— read Facebook comments",
    '— الرد على تعليقات الفيس': "— reply to Facebook comments",
    '— نشر البوستات على فيسبوك': "— publish posts on Facebook",
    '— قراءة حساب الإنستا والمنافسين': "— read the Instagram account and competitors",
    '— رسائل الإنستا (DM)': "— Instagram messages (DM)",
    '— الرد على تعليقات الإنستا': "— reply to Instagram comments",
    '— نشر البوستات على إنستغرام': "— publish posts on Instagram",
    'ملاحظة: ما دام التطبيق في وضع Development، تعمل الصلاحيات لحسابات المشرفين فقط. ليرد البوت على الجميع، يلزم App Review من Meta لصلاحيات الرسائل والتعليقات.': "Note: while the app is in Development mode, permissions only work for admin accounts. For the bot to reply to everyone, Meta App Review is required for messaging and comment permissions.",
    'إيميل Gmail المرسل أو App Password غير مدخل': "Sender Gmail address or App Password is missing",
    '{name} = اسم العميل، {topic} = ما سأل عنه العميل. تُرسل الرسائل في أوقات الدوام فقط، بحد أقصى رسالة واحدة كل دقيقة، وقبل انتهاء مهلة الـ 24 ساعة التي تسمح بها واتساب وMeta للرد.': "{name} = customer name, {topic} = what they asked about. Messages are sent only during business hours, at most one per minute, and before the 24-hour reply window allowed by WhatsApp and Meta ends.",
    '(3 الفجر)': "(3 AM)",
    'من openrouter.ai ← Keys.': "from openrouter.ai ← Keys.",
    'أتمتة المبيعات، الذكاء الاصطناعي للشركات': "Sales automation, AI for business",
    'تلقائي: Nano Banana Pro (google/gemini-3-pro-image)': "Automatic: Nano Banana Pro (google/gemini-3-pro-image)",
    'من App settings ← Basic': "From App settings ← Basic",
    'لتطبيقات Business فقط': "Business apps only",
    'تليجرام مربوط': "Telegram connected",
    'تليجرام غير مربوط': "Telegram not connected",
    'AI جاهز': "AI ready",
    'لا يوجد مفتاح AI': "No AI key",
    'فيسبوك: يحتاج إلى ربط': "Facebook: needs connecting",
    'إنستغرام: يحتاج إلى ربط': "Instagram: needs connecting",
    'فيسبوك: جاهز للنشر': "Facebook: ready to publish",
    'إنستغرام: جاهز للنشر': "Instagram: ready to publish",
    'قناة تليجرام: جاهز للنشر': "Telegram channel: ready to publish",
    'قناة تليجرام: يحتاج إلى ربط': "Telegram channel: needs connecting",
    'الموضوع': "Topic",
    'الصورة': "Image",
    'النص': "Caption",
    'وقت النشر': "Publish time",
    'النشر': "Publish",
    'السوق اليوم:': "Market today:",
    '1. اختر موضوع المنشور': "1. Choose the post topic",
    'استخدم موضوعي': "Use my topic",
    'اقترح 3 مواضيع أخرى': "Suggest 3 other topics",
    'إلغاء': "Cancel",
    'لم يعجبك أي منها؟ اكتب موضوعك...': "None of these? Write your own topic...",
    'لا يوجد مفتاح AI يدعم توليد الصور (Gemini / OpenAI / OpenRouter)': "No AI key supports image generation (Gemini / OpenAI / OpenRouter)",
    'منشور إنستغرام': "Instagram post",
    'ستوري إنستغرام': "Instagram story",
    'كاروسيل — الغلاف': "Carousel — cover",
    'كاروسيل — شريحة محتوى': "Carousel — content slide",
    'غلاف فيسبوك': "Facebook cover",
    'بانر لينكدإن': "LinkedIn banner",
    'صورة يوتيوب': "YouTube thumbnail",
    'لوحة إعلانية في الشارع': "Street billboard",
    'رول أب في معرض': "Exhibition roll-up",
    'إعلان مجلة': "Magazine ad",
    'بطاقة عمل': "Business card",
    'ورق رسمي ومغلف': "Letterhead and envelope",
    'لوحة الهوية (دليل مختصر)': "Brand board (short guide)",
    'واجهة الموقع': "Website hero",
    'أيقونة تطبيق وشاشة البداية': "App icon and splash screen",
    'شريحة عرض تقديمي': "Presentation slide",
    'هيدر إيميل وتوقيع': "Email header and signature",
    'لوغو على جدار المكتب': "Logo on the office wall",
    'تيشيرت وهودي': "T-shirt and hoodie",
    'كوب ودفتر وقلم': "Mug, notebook and pen",
    'سيارة الشركة': "Company car",
    'المنافسون — أكثر منشوراتهم تفاعلاً': "Competitors — their most engaging posts",
    'يلزم ربط حساب إنستغرام أعمال (بطاقة Meta في الإعدادات) لقراءة حسابات المنافسين.': "An Instagram business account must be connected (Meta card in Settings) to read competitor accounts.",
    'ماذا يسأل عملاؤك (من البوت والتعليقات)': "What your customers ask (from the bot and comments)",
    'طلباتهم': "Their requests",
    'أفضل أوقات النشر القادمة': "Best upcoming posting times",
    'بداية الدوام — يتصفح الناس مواقع التواصل عند وصولهم': "Start of the workday — people check social media when they arrive",
    'استراحة الغداء': "Lunch break",
    'ذروة المساء بعد الدوام': "Evening peak after work",
    'بعد صلاة الجمعة والغداء': "After Friday prayer and lunch",
    'عصر الجمعة — وقت تصفح هادئ': "Friday afternoon — relaxed browsing",
    'مساء الجمعة': "Friday evening",
    'صباح السبت المتأخر': "Late Saturday morning",
    'عصر السبت': "Saturday afternoon",
    'مساء ما قبل بداية الأسبوع': "The evening before the week starts",
    'أعلى تفاعل على منشوراتكم السابقة في هذه الساعة': "Highest engagement on your past posts at this hour",
    'محسوبة من أوقات الذروة في الأردن والمنطقة، وتزداد دقتها مع زيادة النشر.': "Based on peak times in Jordan and the region; it gets more accurate the more you post.",
    'أنجح منشوراتكم': "Your best-performing posts",
    'تعذّرت قراءة منشوراتكم (تحقّق من ربط Meta).': "Could not read your posts (check the Meta connection).",
    'أخبار المجال هذا الأسبوع': "Industry news this week",
    'منشور عن هذا الخبر': "Post about this news",
    "حجز المواعيد (Google Calendar)": "Appointments (Google Calendar)",
    "فحص التقويم": "Check calendar",
    "يحجز البوت الاستشارات الأونلاين في تقويم المهندس": "The bot books online consultations in the engineer's calendar",
    "يقترح البوت الأوقات المتاحة فقط، ويتحقق من التقويم قبل الحجز، ويرسل للعميل رابط الاجتماع.": "The bot only offers free times, checks the calendar before booking, and sends the customer the meeting link.",
    "تقويم المهندس (بريده على Google)": "Engineer's calendar (their Google email)",
    "شارك التقويم مع حساب الخدمة الموجود في بطاقة Google Sheets: Google Calendar ← إعدادات التقويم ← المشاركة مع أشخاص محددين ← صلاحية «إجراء تغييرات على الأحداث».": "Share the calendar with the service account from the Google Sheets card: Google Calendar ← calendar settings ← Share with specific people ← \"Make changes to events\".",
    "أيام الحجز": "Booking days",
    "متاح على مدار 24 ساعة": "Available 24 hours",
    "إلى": "To",
    "مدة الاجتماع": "Meeting length",
    "30 دقيقة": "30 minutes",
    "45 دقيقة": "45 minutes",
    "أقل مهلة قبل الموعد": "Minimum notice",
    "بدون": "None",
    "ساعتان": "2 hours",
    "4 ساعات": "4 hours",
    "الحجز خلال": "Book up to",
    "3 أيام": "3 days",
    "أسبوع": "1 week",
    "أسبوعين": "2 weeks",
    "شهر": "1 month",
    "اسم المهندس": "Engineer name",
    "رابط اجتماع ثابت (اختياري)": "Fixed meeting link (optional)",
    "يُنشأ رابط Google Meet لكل موعد تلقائياً. إذا لم يتوفر، يُرسل الرابط الثابت.": "A Google Meet link is created for each booking. If that is not available, the fixed link is sent.",
    "موعد الاستشارة:": "Consultation:",
    "رابط الاجتماع": "Meeting link",
    "جاري فحص التقويم... (احفظ الإعدادات أولاً إذا عدّلتها)": "Checking the calendar... (save the settings first if you changed them)",
    "حساب الخدمة:": "Service account:",
    'لم تُحلَّل هوية تصميمك بعد. اضغط «تعلّم من صفحتي» لقراءة منشوراتك على إنستغرام واستخراج الألوان والخطوط وأسلوب التصميم، لتخرج كل صورة جديدة بالأسلوب نفسه.': "Your design identity has not been analyzed yet. Press \"Learn from my page\" to read your Instagram posts and extract colors, fonts and design style, so every new image follows the same look."
  };

  const KEY = 'atlead_lang';
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  // Lookup tolerant to whitespace differences.
  const DICT = new Map(Object.entries(EN).map(([ar, en]) => [norm(ar), en]));
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const original = new WeakMap(); // text node → original Arabic
  const originalAttr = new WeakMap(); // element → {attr: original}
  const written = new WeakMap(); // text node → value we wrote (to tell our writes from the app's)
  let lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'ar';
  let busy = false;

  function translateTextNode(node) {
    const src = original.has(node) ? original.get(node) : node.nodeValue;
    const key = norm(src);
    if (!key) return;
    if (lang === 'en') {
      const en = DICT.get(key);
      if (en === undefined) return;
      if (!original.has(node)) original.set(node, node.nodeValue);
      const lead = src.match(/^\s*/)[0];
      const trail = src.match(/\s*$/)[0];
      if (node.nodeValue !== lead + en + trail) {
        node.nodeValue = lead + en + trail;
        written.set(node, node.nodeValue);
      }
    } else if (original.has(node)) {
      node.nodeValue = original.get(node);
      original.delete(node);
    }
  }

  function translateAttrs(el) {
    for (const attr of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(attr)) continue;
      const saved = originalAttr.get(el) || {};
      const src = saved[attr] ?? el.getAttribute(attr);
      if (lang === 'en') {
        const en = DICT.get(norm(src));
        if (en === undefined) continue;
        saved[attr] = src;
        originalAttr.set(el, saved);
        if (el.getAttribute(attr) !== en) el.setAttribute(attr, en);
      } else if (saved[attr] !== undefined) {
        el.setAttribute(attr, saved[attr]);
        delete saved[attr];
      }
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(root.tagName)) return;
    translateAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && ['SCRIPT', 'STYLE', 'TEXTAREA'].includes(n.tagName))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === Node.TEXT_NODE) translateTextNode(n);
      else translateAttrs(n);
    }
  }

  function apply() {
    busy = true;
    // The layout is designed right-to-left, so it stays as is; only the text
    // direction of English strings is fixed (no ":Stage" style punctuation flips).
    document.documentElement.lang = lang;
    document.body.classList.toggle('lang-en', lang === 'en');
    if (!document.getElementById('i18n-style')) {
      const st = document.createElement('style');
      st.id = 'i18n-style';
      st.textContent = 'body.lang-en :is(p,span,label,h1,h2,h3,h4,h5,h6,small,td,th,button,a,li,option,summary,strong,b,em,div.form-hint,.form-label){unicode-bidi:plaintext;}' +
        'body.lang-en :is(input,textarea)::placeholder{direction:ltr;}';
      document.head.appendChild(st);
    }
    walk(document.body);
    const t = document.querySelector('title');
    if (t) translateTextNode(t.firstChild);
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.innerHTML = lang === 'en' ? '<i class="fa-solid fa-language"></i> العربية' : '<i class="fa-solid fa-language"></i> English';
    busy = false;
  }

  function setLang(next) {
    lang = next;
    localStorage.setItem(KEY, lang);
    apply();
  }

  function injectButton() {
    if (document.getElementById('lang-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'lang-toggle';
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm';
    btn.style.cssText = 'position: fixed; bottom: 18px; left: 18px; z-index: 9999; box-shadow: 0 4px 14px rgba(0,0,0,.25);';
    btn.addEventListener('click', () => setLang(lang === 'en' ? 'ar' : 'en'));
    document.body.appendChild(btn);
  }

  // Content rendered later (conversation lists, toasts, results...) gets translated too.
  const observer = new MutationObserver((mutations) => {
    if (busy || lang !== 'en') return;
    busy = true;
    for (const m of mutations) {
      if (m.type === 'characterData') {
        // The app changed this text after we translated it → start from the new value.
        if (written.get(m.target) !== m.target.nodeValue) { original.delete(m.target); written.delete(m.target); }
        translateTextNode(m.target);
      }
      else if (m.type === 'attributes') translateAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
    busy = false;
  });

  function init() {
    injectButton();
    apply();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.atleadI18n = { setLang, t: (ar) => (lang === 'en' ? DICT.get(norm(ar)) ?? ar : ar), get lang() { return lang; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
