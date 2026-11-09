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
    'جاهز للديل 🎯': 'Ready to close 🎯',
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
    'اضغط "إعادة تفعيل البوت" لما تخلص.': 'Click "Resume bot" when you are done.',
    'تم إيقاف البوت يدوياً لهذا العميل.': 'The bot was paused manually for this customer.',
    'الموظف المسؤول:': 'Assigned agent:',
    'السبب:': 'Reason:',
    'العميل وصل لمرحلة الديل وتم إيقاف البوت تلقائياً حتى يستلم الموظف البشري.': 'The customer reached the deal stage; the bot stopped automatically until a human agent takes over.',
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
    'محوّل للموظف — البوت ما بيرد': 'Handed to an agent — bot is off',
    'لحد ما ترجّعه': 'until you resume it',
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
    'بانتظار الموظف ⏳': 'Waiting for agent ⏳',
    'اشترى ✅': 'Purchased ✅',
    'لم يشترِ ❌': 'Did not buy ❌',
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
    '🔥 مهتم بالشراء / استفسار': '🔥 Interested / inquiry',
    'تفاعل عام': 'General engagement',
    '⏳ بانتظار الرد...': '⏳ Waiting to reply...',
    '🔒 محوّل لموظف — البوت ما رد': '🔒 Handed to agent — bot did not reply',
    'أدخل نص التعليق الذي ترغب بمحاكاته على فيسبوك أو إنستغرام:': 'Enter the comment text to simulate on Facebook or Instagram:',
    'جاري فحص التعليق وتطبيق الرد والرسالة الخاصة...': 'Analysing the comment and sending the reply and DM...',
    'عميل مجرب': 'Test customer',
    'فشل محاكاة التعليق': 'Comment simulation failed',

    // Simulator
    'مختبر تجربة الشات بوت (Simulator)': 'Chatbot Simulator',
    'جرب الحديث مع البوت كتابياً أو عبر تسجيل فويس وشاهد كيف يطبق قواعد atlead': 'Chat with the bot by text, voice or image and watch how it applies atlead\'s rules',
    'إعادة تعيين': 'Reset',
    'اسأل عن الأسعار': 'Ask about prices',
    'اسأل عن سوابق الأعمال': 'Ask about previous work',
    'جرب مرحلة الديل والإغلاق (Handoff)': 'Try the deal / handoff stage',
    'اكتب رسالة لتجربة رد البوت...': 'Type a message to test the bot...',
    'رفع صورة لاختبار فهم البوت للصور': 'Upload an image to test image understanding',
    'رفع تسجيل صوتي (فويس) لاختباره': 'Upload a voice note to test it',
    'تحليل الذكاء الاصطناعي الحي (AI Inspector)': 'Live AI Inspector',
    'يعرض لك هذا المربع تفاصيل تفكير البوت، تصنيف العميل، وحالة نقطة الإغلاق والاتفاق (Deal Closing).': 'Shows the bot\'s reasoning, the customer classification and the deal-closing state.',
    'مرحلة العميل الحالية (Stage):': 'Current stage:',
    'التصنيف (Classification):': 'Classification:',
    'نسبة الشراء والاهتمام المتوقعة:': 'Expected buying probability:',
    'حالة تشغيل البوت (Bot Active):': 'Bot active:',
    'مفعل 🟢': 'On 🟢',
    'موقوف (محول للبشري) 🛑': 'Off (handed to a human) 🛑',
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
    'جاري رفع الفويس وتفريغه صوتياً...': 'Uploading and transcribing the voice note...',
    '🎤 فويس (ما قدر يفرّغه)': '🎤 Voice note (could not transcribe)',
    'تم استقبال الفويس والتفريغ والرد الذكي بنجاح!': 'Voice note received, transcribed and answered!',
    'فشل تفريغ الفويس الصوتي': 'Voice transcription failed',
    '🖼️ جاري رفع الصورة وتحليلها...': '🖼️ Uploading and analysing the image...',
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
    'الصق نص الوثيقة هون — البوت بيجاوب منها فوراً بعد الحفظ.': 'Paste the document text here — the bot answers from it right after saving.',
    'إضافة الوثيقة': 'Add document',
    'مثال: عنا عرض هالشهر... / ساعات الدوام... / خدمة جديدة... — أي معلومة بتكتبها هون البوت بجاوب منها فوراً.': 'e.g. this month\'s offer / working hours / a new service — the bot answers from anything you write here.',
    'حفظ المعلومات': 'Save information',
    'التوجيهات البرمجية الحية للبوت (System Prompt Active)': 'Live system prompt',
    'وثيقة': 'Document',
    'حفظ الوثيقة': 'Save document',
    'البوت بيجاوب من هاي الوثيقة': 'The bot answers from this document',
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
    'عم نسأل Meta مباشرة...': 'Asking Meta directly...',
    'ولا حدث لهلأ — ابعت رسالة أو تعليق تجريبي واضغط الزر مرة ثانية.': 'No events yet — send a test message or comment and click the button again.',
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
    'متأكد بدك تفصل رقم الواتساب عن البوت؟': 'Disconnect this WhatsApp number from the bot?',
    'تم الفصل': 'Disconnected',

    // Settings — reply behaviour
    'سلوك الرد (التأخير والرد المقتبس)': 'Reply behaviour (delay & quoting)',
    'مدة الانتظار قبل الرد (بالثواني)': 'Wait before replying (seconds)',
    'البوت ينتظر هذه المدة بعد آخر رسالة من العميل. إذا بعث العميل أكثر من رسالة ورا بعض، بيرد عليهم كلهم مرة وحدة — هذا بيحمي الرقم من الحظر.': 'The bot waits this long after the customer\'s last message and answers several messages at once — this protects the number from being banned.',
    'الرد كـ "رد على الرسالة" (اقتباس رسالة العميل فوق الرد)': 'Reply as a quoted reply to the customer\'s message',
    'إظهار "يكتب الآن..." وعلامة القراءة قبل الرد': 'Show "typing..." and read receipts before replying',
    'إيقاف البوت تلقائياً لما يرد موظف على العميل': 'Pause the bot automatically when an agent replies',
    'سواء رد الموظف من لوحة التحكم، أو من الواتساب على الجوال/واتساب ويب، أو من صندوق رسائل فيسبوك/تطبيق إنستغرام.': 'Whether the agent replies from the dashboard, WhatsApp on the phone / WhatsApp Web, or the Facebook / Instagram inbox.',
    'مدة الإيقاف': 'Pause duration',
    'لحد ما أرجّعه يدوياً (موصى به)': 'Until I resume it manually (recommended)',
    'ساعة وحدة': '1 hour',
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
    'كل تغيير بينحفظ تلقائياً خلال ثانيتين': 'Every change is saved automatically within 2 seconds',
    'تعذر قراءة حالة المزامنة': 'Could not read the sync status',
    'جاري حفظ كل البيانات بـ Supabase...': 'Saving all data to Supabase...',

    // Settings — Google
    'ربط Google Sheets (كل تفاصيل السيلز)': 'Google Sheets (full sales details)',
    'فحص الربط وتجهيز الشيت': 'Test & prepare the sheet',
    'رابط الشيت (أو Spreadsheet ID)': 'Sheet link (or Spreadsheet ID)',
    'اسم الورقة (Tab)': 'Sheet tab name',
    'إذا مش موجودة بتنعمل تلقائياً مع عناوين الأعمدة.': 'Created automatically with column headers if missing.',
    'ملف Service Account (JSON)': 'Service Account file (JSON)',
    'Google Cloud ← فعّل Google Sheets API ← Service Accounts ← Keys ← Add key ← JSON، والصق محتوى الملف هون.': 'Google Cloud → enable the Google Sheets API → Service Accounts → Keys → Add key → JSON, then paste the file content here.',
    'اعمل Share للشيت مع هذا الإيميل كـ': 'Share the sheet with this email as',
    'طريقة بديلة: Google Apps Script Webhook': 'Alternative: Google Apps Script webhook',
    'تُستخدم فقط إذا ما في Service Account.': 'Only used when there is no Service Account.',
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
    'جاري إرسال إيميل تجريبي... (احفظ الإعدادات أولاً إذا عدلت شي)': 'Sending a test email... (save settings first if you changed something)',
    'فريق المبيعات (توزيع العملاء)': 'Sales team (lead distribution)',
    'العميل اللي بيتحوّل بينسند لموظف بالدور، والبوت بيحكي للعميل اسم الموظف، والإيميل بيوصل للموظف نفسه (+ إيميلات الإدارة). إذا القائمة فاضية، الإيميل بيوصل للإدارة بس.': 'Handed-off customers are assigned to agents in turn; the bot tells the customer the agent\'s name and the agent gets the email (plus admin emails). If the list is empty, only admins are emailed.',
    'اسم الموظف (مثلاً: م. مهند)': 'Agent name (e.g. Eng. Mohannad)',
    'ما في موظفين — الإيميلات بتروح للإدارة.': 'No agents — emails go to the admins.',
    'اضغط "حفظ وتحديث الإعدادات" للتثبيت': 'Click "Save settings" to apply',
    'اكتب اسم الموظف': 'Enter the agent\'s name',
    'الإيميل موجود': 'Email already added',
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
    '{rep} = اسم الموظف، {time} = إمتى رح يتواصل (مثلاً "بكرا الساعة 09:00").': '{rep} = agent name, {time} = when they will reach out (e.g. "tomorrow at 09:00").',
    'خلّي إيميلات الموظفين تنبعت أول الدوام بدل ما توصل بالليل': 'Hold agent emails until the start of working hours',
    'متابعة العملاء اللي سكتوا': 'Follow up with silent customers',
    'مين رح تنبعتله؟': 'Who will get one?',
    'إرسال رسالة متابعة تلقائية للعميل المهتم اللي ما رد': 'Send an automatic follow-up to interested customers who stopped replying',
    'بعد سكوت العميل بـ': 'After the customer has been silent for',
    'ساعتين': '2 hours',
    '6 ساعات': '6 hours',
    '20 ساعة (موصى به)': '20 hours (recommended)',
    '23 ساعة': '23 hours',
    'لما تكون نسبة الشراء على الأقل (%)': 'When the buying probability is at least (%)',
    'أقصى عدد رسائل متابعة لكل عميل': 'Max follow-ups per customer',
    'رسالة وحدة': 'One message',
    'رسالتين': 'Two messages',
    'البوت يكتب رسالة المتابعة حسب محادثة كل عميل (يحتاج مفتاح AI)': 'The bot writes each follow-up from the customer\'s conversation (needs an AI key)',
    'نص المتابعة الاحتياطي': 'Fallback follow-up text',
    'رح تنبعت متابعة لـ:': 'Follow-ups will go to:',
    'ما في عملاء بحاجة متابعة هلق.': 'No customers need a follow-up right now.',
    'التقرير اليومي والنسخ الاحتياطي': 'Daily report & backups',
    'إرسال تقرير يومي لإيميلات الإدارة': 'Send a daily report to admin emails',
    'وقت التقرير': 'Report time',
    'ابعته هلق': 'Send now',
    'جاري إرسال التقرير...': 'Sending the report...',
    'نسخة احتياطية يومية تلقائية': 'Automatic daily backup',
    '(الساعة 3 الفجر، بمجلد backups)': '(at 3 AM, in the backups folder)',
    'احتفظ بالنسخ لمدة': 'Keep backups for',
    '7 أيام': '7 days',
    '14 يوم': '14 days',
    '30 يوم': '30 days',
    '90 يوم': '90 days',
    'نسخة احتياطية هلق': 'Back up now',
    'لسا ما في نسخ احتياطية.': 'No backups yet.',

    // Settings — AI & handoff
    'إعدادات الذكاء الاصطناعي ومعالجة الصوت (AI & Voice Engine)': 'AI & Voice Engine',
    'من openrouter.ai ← Keys. البوت بيجاوب العملاء من ملفات الشركة عن طريق هذا المفتاح.': 'From openrouter.ai → Keys. The bot answers customers from the company files using this key.',
    'الموديل (Model)': 'Model',
    'سريع ورخيص (الافتراضي)': 'Fast & cheap (default)',
    'أذكى، أغلى': 'Smarter, pricier',
    'سريع، بيفهم الفويس والصور': 'Fast, understands voice & images',
    'ردود طبيعية جداً، أغلى': 'Very natural replies, pricier',
    'تفعيل الرد على الرسائل الصوتية (الفويسّات)': 'Reply to voice notes',
    'فهم الصور اللي بيبعتها العميل (سكرين شوت، منتج، ورقة...)': 'Understand images customers send (screenshots, products, documents...)',
    'قواعد الإغلاق والتحويل للبشري (Deal Closing Rules)': 'Deal closing & human handoff rules',
    'اسم ممثل المبيعات الرسمي للتحويل': 'Official sales rep name for handoff',
    'رسالة التحويل الرسمية عند نقطة الاتفاق (Handoff Message)': 'Official handoff message',
    '{rep} = اسم الموظف المسؤول عن العميل (أو الاسم اللي فوق إذا ما في فريق).': '{rep} = the assigned agent\'s name (or the name above if there is no team).',
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
    '⚠️ Supabase مش مربوط — المحادثات محفوظة على السيرفر بس. أول ما تربطه، كل البيانات القديمة بتنرفع لحالها.': '⚠️ Supabase is not connected — conversations are only on the server. Once connected, all old data is uploaded automatically.'
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
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
    document.body.classList.toggle('lang-en', lang === 'en');
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
