/**
 * Bidirectional Dashboard Language Switch (English LTR default ⇄ Arabic RTL).
 * Preserves customer messages, names, knowledge base records, and business content untouched.
 */
(function () {
  // Canonical [Arabic, English] UI label pairs.
  const PAIRS = [
    // Page, Shell & Navigation
    ['atlead | منصة إدارة أنظمة المبيعات الذكية والشات بوت', 'atlead | AI Sales Systems & Chatbot Platform'],
    ['صندوق المحادثات الموحد', 'Unified Inbox'],
    ['إدارة الصفقات والـ CRM', 'Deals & CRM'],
    ['التعليقات والتحويل للخاص', 'Comments & Auto-DM'],
    ['التسويق الذكي وجدولة المنشورات', 'Smart Marketing & Scheduling'],
    ['قاعدة المعرفة والأعمال السابقة', 'Knowledge Base & Portfolio'],
    ['إعدادات الربط والـ APIs', 'Integrations & APIs'],
    ['النظام: متصل ويعمل', 'System: Online'],
    ['المحادثات والمبيعات', 'Messaging & Sales'],
    ['النمو والذكاء الاصطناعي', 'Growth & AI'],
    ['الإعدادات والربط', 'Configuration'],
    ['طي القائمة', 'Collapse sidebar'],
    ['توسيع القائمة', 'Expand sidebar'],
    ['تبديل المظهر', 'Theme switch'],
    ['تغيير ثيم الألوان', 'Switch theme'],
    ['المظهر الفاتح', 'Light theme'],
    ['المظهر الداكن', 'Dark theme'],
    ['فاتح', 'Light'],
    ['داكن', 'Dark'],
    ['تبديل اللغة', 'Language switch'],
    ['التنقل', 'Navigation'],
    ['القائمة', 'Menu'],
    ['المحادثات', 'Inbox'],
    ['العملاء', 'Customers'],
    ['التعليقات', 'Comments'],
    ['التسويق', 'Marketing'],
    ['المعرفة', 'Knowledge'],
    ['الإعدادات', 'Settings'],
    ['إغلاق', 'Close'],
    ['✕ إغلاق', '✕ Close'],

    // Top Header Status Indicators
    ['حالة ربط Meta (فيسبوك وإنستغرام)', 'Meta connection (Facebook & Instagram)'],
    ['حالة ربط واتساب', 'WhatsApp connection'],
    ['حالة قاعدة بيانات Supabase', 'Supabase database status'],
    ['حالة ربط Google Sheets', 'Google Sheets connection'],
    ['Meta متصل', 'Meta connected'],
    ['Meta جاهز للربط', 'Meta ready to connect'],
    ['WhatsApp متصل', 'WhatsApp connected'],
    ['WhatsApp غير مربوط', 'WhatsApp not connected'],
    ['WhatsApp جاهز', 'WhatsApp ready'],
    ['Supabase متصل', 'Supabase connected'],
    ['Supabase محلي/نشط', 'Supabase local/active'],
    ['Sheets متزامن', 'Sheets synced'],
    ['Sheets بانتظار الرابط', 'Sheets not linked'],

    // Unified Inbox
    ['بحث عن عميل أو هاتف...', 'Search customer or phone...'],
    ['الكل', 'All'],
    ['واتساب', 'WhatsApp'],
    ['إنستغرام', 'Instagram'],
    ['ماسنجر', 'Messenger'],
    ['محاكي', 'Simulator'],
    ['هاتف', 'Phone'],
    ['جاهز للصفقة', 'Ready to close'],
    ['لا توجد محادثات مطابقة', 'No matching conversations'],
    ['رجوع للمحادثات', 'Back to conversations'],
    ['بيانات العميل', 'Customer details'],
    ['حذف المحادثة', 'Delete conversation'],
    ['اختر محادثة لعرضها', 'Select a conversation'],
    ['اختر محادثة من القائمة للبدء أو اختبار النظام', 'Pick a conversation from the list to view messages and qualification details.'],
    ['Pick a conversation from the list to start', 'Pick a conversation from the list to start'],
    ['اكتب رداً يدوياً للعميل كـ موظف بشري...', 'Type a manual reply as a human agent...'],
    ['إرسال', 'Send'],
    ['الرد الآلي للشات بوت', 'Chatbot auto-reply'],
    ['مفعل', 'On'],
    ['مفعّل', 'On'],
    ['مفعل ويعمل', 'On and running'],
    ['إيقاف البوت', 'Pause bot'],
    ['إعادة تفعيل البوت', 'Resume bot'],
    ['وصل العميل إلى مرحلة الصفقة، وتم إيقاف البوت تلقائياً حتى يتسلّمه موظف المبيعات.', 'The customer reached the deal stage; the bot stopped automatically until a human agent takes over.'],
    ['بيانات وتأهيل العميل', 'Customer profile & qualification'],
    ['مرحلة العميل:', 'Stage:'],
    ['التصنيف:', 'Classification:'],
    ['نسبة الشراء والاهتمام:', 'Buying probability:'],
    ['المشكلة المحددة:', 'Identified problem:'],
    ['الحل المقترح:', 'Proposed solution:'],
    ['مكالمة الـ AI:', 'AI call:'],
    ['نسخ رابط مكالمة الـ AI', 'Copy AI call link'],
    ['موعد الاستشارة:', 'Consultation:'],
    ['رابط الاجتماع', 'Meeting link'],
    ['ترحيل لـ Google Sheet', 'Push to Google Sheet'],
    ['محادثة جديدة', 'New conversation'],
    ['عميل محتمل', 'Potential customer'],
    ['لم تحدد بعد', 'Not set yet'],
    ['لم يحدد بعد', 'Not set yet'],
    ['لا توجد رسائل سابقة في هذه المحادثة', 'No messages in this conversation yet'],
    ['العميل', 'Customer'],
    ['مساعد atlead الذكي', 'atlead AI assistant'],
    ['الموظف البشري', 'Human agent'],
    ['تعليق', 'Comment'],
    ['البوت', 'Bot'],
    ['الموظف', 'Agent'],
    ['رسالة صوتية', 'Voice note'],
    ['صورة', 'Image'],
    ['موظف يتابع', 'Agent active'],
    ['محول للبشري', 'Handed to human'],
    ['بوت مفعل', 'Bot active'],
    ['الرد الآلي للبوت نشط', 'Bot auto-reply is active'],
    ['بانتظار موظف المبيعات — الرد الآلي مستمر', 'Waiting for sales rep — auto-reply active'],
    ['تم إيقاف البوت يدوياً لهذا العميل.', 'The bot was paused manually for this customer.'],
    ['موقوف يدوياً', 'Paused manually'],
    ['محوّل إلى الموظف — البوت لا يرد', 'Handed to an agent — bot is off'],
    ['فشل الإرسال للمنصة', 'Failed to send to the platform'],
    ['محاكاة — القناة غير مربوطة', 'Simulated — channel not connected'],
    ['حدث خطأ أثناء تبديل حالة البوت', 'Error while switching the bot state'],
    ['تم إرسال الرد بنجاح!', 'Reply sent!'],
    ['فشل إرسال الرد اليدوي', 'Failed to send the manual reply'],
    ['تم تفعيل الرد الآلي للبوت في هذه المحادثة', 'Chatbot auto-reply enabled for this conversation'],
    ['تم إيقاف البوت وتحويل المحادثة للموظف البشري', 'Bot paused and conversation handed to human agent'],
    ['تم حفظ الرد (لم يُرسل للمنصة — تحقق من ربط القناة)', 'Reply saved (not sent to platform — check channel connection)'],
    ['تم حذف المحادثة وبيانات العميل', 'Conversation and customer data deleted'],

    // CRM & Deals
    ['كل عميل، نسبة شرائه ومرحلته — متزامن مع Google Sheets.', 'Every customer, their buying score and stage — synced with Google Sheets.'],
    ['تنزيل Excel', 'Download Excel'],
    ['طريقة ربط Google Sheet', 'How to connect Google Sheet'],
    ['مزامنة كافة الصفقات مع Google Sheet', 'Sync all deals to Google Sheet'],
    ['إجمالي المحادثات', 'Total conversations'],
    ['عملاء مؤهلين (Hot Leads)', 'Qualified (Hot Leads)'],
    ['صفقات جاهزة للإغلاق (Deals)', 'Ready to close (Deals)'],
    ['مرحّلة لـ Google Sheet', 'Synced to Google Sheet'],
    ['اسم العميل', 'Customer name'],
    ['رقم الهاتف / الحساب', 'Phone / account'],
    ['القناة', 'Channel'],
    ['المرحلة', 'Stage'],
    ['التصنيف', 'Classification'],
    ['نسبة الشراء والاهتمام', 'Buying probability'],
    ['المشكلة المحددة', 'Identified problem'],
    ['الحل المقترح', 'Proposed solution'],
    ['حالة الشراء', 'Purchase status'],
    ['تزامن Google Sheet', 'Google Sheet sync'],
    ['إجراءات', 'Actions'],
    ['لا يوجد عملاء مسجلين بعد', 'No registered customers yet'],
    ['لم يشترِ بعد', 'Not purchased yet'],
    ['بانتظار الموظف', 'Waiting for agent'],
    ['اشترى', 'Purchased'],
    ['لم يشترِ', 'Did not buy'],
    ['غير مسجل', 'Not recorded'],
    ['تم إبلاغ الموظف', 'Agent notified'],
    ['— غير مُسند —', '— unassigned —'],
    ['مرحل', 'Synced'],
    ['قيد الانتظار', 'Pending'],
    ['جاري الترحيل إلى Google Sheets...', 'Pushing to Google Sheets...'],
    ['فشل الترحيل إلى جوجل شيت', 'Failed to push to Google Sheets'],
    ['جاري مزامنة كل العملاء مع Google Sheets...', 'Syncing all customers to Google Sheets...'],
    ['مزامنة فورية مع Google Sheet', 'Sync to Google Sheet now'],
    ['إرسال تفاصيل العميل للموظف بالإيميل', 'Email customer details to the agent'],
    ['حذف العميل', 'Delete customer'],
    ['جاري إرسال تفاصيل العميل بالإيميل...', 'Emailing customer details...'],
    ['هذه المحادثة لم تصل بعد لمرحلة تأهيل العميل كـ Lead مسجل', 'This conversation has not been qualified as a lead yet'],

    // Comments & Auto-DM
    ['يرد البوت على التعليقات، ويرسل رسالة خاصة لكل مهتم.', 'The bot replies to comments and messages everyone who is interested.'],
    ['جرّب تعليقاً', 'Try a comment'],
    ['سجل التعليقات الواردة وإجراءات التحويل للخاص', 'Incoming comments & DM actions'],
    ['المنصة', 'Platform'],
    ['صاحب التعليق', 'Commenter'],
    ['نص التعليق', 'Comment'],
    ['تحليل الاهتمام', 'Interest analysis'],
    ['الرد العام على التعليق', 'Public reply'],
    ['الرسالة الخاصة (DM المرسلة)', 'Private message (DM sent)'],
    ['التاريخ', 'Date'],
    ['لا توجد تعليقات مسجلة بعد', 'No recorded comments yet'],
    ['متابع', 'Follower'],
    ['مهتم بالشراء / استفسار', 'Interested / inquiry'],
    ['تفاعل عام', 'General engagement'],
    ['بانتظار الرد...', 'Waiting to reply...'],
    ['محوّل إلى موظف — لم يرد البوت', 'Handed to agent — bot did not reply'],
    ['تم إرسال DM خاص', 'DM sent'],
    ['غير مطلوب', 'Not needed'],
    ['حذف التعليق', 'Delete comment'],
    ['جاري فحص التعليق وتطبيق الرد والرسالة الخاصة...', 'Analysing the comment and sending the reply and DM...'],
    ['عميل تجريبي', 'Test customer'],
    ['فشل محاكاة التعليق', 'Comment simulation failed'],

    // Smart Marketing
    ['موضوع ← صورة ← نص ← موعد، ثم يُنشر المنشور تلقائياً.', 'Topic → image → caption → time, and the post goes out on its own.'],
    ['أرسل اقتراحات اليوم على تليجرام', "Send today's ideas to Telegram"],
    ['منشور جديد', 'New post'],
    ['إنشاء منشور', 'Create post'],
    ['اختبار الهوية', 'Identity test'],
    ['دراسة السوق والمنافسين', 'Market & competitors'],
    ['المنشورات المجدولة والسابقة', 'Scheduled & past posts'],
    ['الإعدادات والربط', 'Setup'],
    ['لا يوجد منشور قيد التحضير. اضغط', 'No post in progress. Press'],
    ['وسندرس السوق ونقترح عليك 3 مواضيع.', 'and we will study the market and suggest 3 topics.'],
    ['هويتك على كل الوسائط', 'Your identity on every medium'],
    ['21 تصميم بهوية صفحتك ولوغوك: سوشال، إعلانات، مطبوعات، رقمي، ومنتجات. المولّد: Nano Banana Pro.', '21 designs matching your page identity and logo: social, ads, print, digital, and merch. Generator: Nano Banana Pro.'],
    ['صمّم كل الوسائط', 'Design every medium'],
    ['أكمل الناقص', 'Finish the rest'],
    ['جاري التصميم…', 'Designing…'],
    ['أعد التصميم', 'Redesign'],
    ['ملاحظة للتعديل (اختياري)', 'Feedback (optional)'],
    ['بالدور', 'Queued'],
    ['تحديث الدراسة الآن', 'Refresh the study now'],
    ['جاري التحميل...', 'Loading...'],
    ['بوت تليجرام (رسالة الصباح والتنبيهات)', 'Telegram bot (morning message and alerts)'],
    ['افتح', 'Open'],
    ['بتليجرام →', 'on Telegram →'],
    ['بتليجرام ←', 'on Telegram ←'],
    ['→ انسخ الرمز (Token) والصقه هنا.', '→ copy the token and paste it here.'],
    ['← انسخ الرمز (Token) والصقه هنا.', '← copy the token and paste it here.'],
    ['افتح البوت الخاص بك وأرسل له', 'Open your bot and send it'],
    ['اضغط', 'Press'],
    ['اكتشف رقم المحادثة', 'Detect chat ID'],
    ['ثم', 'then'],
    ['حفظ', 'Save'],
    ['رقم محادثة المسؤول (Chat ID) — أكثر من واحد افصل بفاصلة', 'Admin chat ID — separate several with commas'],
    ['قناة تليجرام للنشر (اختياري)', 'Telegram channel for publishing (optional)'],
    ['لنشر المنشورات على قناتك أيضاً: أضف البوت مشرفاً في القناة.', 'To publish posts to your channel too, add the bot as a channel admin.'],
    ['أرسل لي على تليجرام أيضاً عند وجود عميل جاهز للتواصل', 'Also alert me on Telegram when a customer is ready to be contacted'],
    ['رسالة تجريبية', 'Test message'],
    ['هوية التصميم', 'Design identity'],
    ['تعلّم من صفحتي', 'Learn from my page'],
    ['أعد التعلّم من صفحتي', 'Re-learn from my page'],
    ['ارفع اللوغو', 'Upload logo'],
    ['أضف تصميماً كمرجع', 'Add a reference design'],
    ['حلّل من جديد', 'Re-analyse'],
    ['اللوغو', 'Logo'],
    ['دراسة السوق', 'Market research'],
    ['حسابات المنافسين على إنستغرام (حتى 8)', 'Competitor Instagram accounts (up to 8)'],
    ['حسابات الأعمال أو صنّاع المحتوى فقط.', 'Business or creator accounts only.'],
    ['كلمات مجالك (للأخبار والترندات)', 'Industry keywords (for news and trends)'],
    ['أتمتة المبيعات، الذكاء الاصطناعي للشركات', 'Sales automation, AI for business'],
    ['وصف شركتك وجمهورك (اختياري — وإلا ستُستخدم قاعدة المعرفة)', 'Describe your company and audience (optional — otherwise the knowledge base is used)'],
    ['من نحن، وماذا نقدّم، ومن هم عملاؤنا المثاليون', 'Who we are, what we offer, and who our ideal customers are'],
    ['الجدول والمحتوى', 'Schedule and content'],
    ['وقت رسالة الصباح', 'Morning message time'],
    ['لغة المنشورات', 'Post language'],
    ['نمط الصور (اختياري، ويُفضّل بالإنجليزية)', 'Image style (optional, preferably in English)'],
    ['موديل توليد الصور (اختياري)', 'Image generation model (optional)'],
    ['تلقائي: Nano Banana Pro (google/gemini-3-pro-image)', 'Automatic: Nano Banana Pro (google/gemini-3-pro-image)'],
    ['أرسل لي الاقتراحات كل صباح', 'Send me suggestions every morning'],
    ['إذا كان مفتاح الذكاء الاصطناعي لا يدعم الصور، استخدم مولّداً مجانياً (Pollinations)', 'If the AI key does not support images, use a free generator (Pollinations)'],
    ['أماكن النشر', 'Where to publish'],
    ['فيسبوك (صفحتك)', 'Facebook (your page)'],
    ['قناة تليجرام', 'Telegram channel'],
    ['الرابط العام للسيرفر (للإنستغرام)', 'Public server URL (for Instagram)'],
    ['يُعبّأ تلقائياً على Railway.', 'Filled in automatically on Railway.'],
    ['حفظ إعدادات التسويق', 'Save marketing settings'],
    ['الموضوع', 'Topic'],
    ['الصورة', 'Image'],
    ['النص', 'Caption'],
    ['وقت النشر', 'Publish time'],
    ['النشر', 'Publish'],
    ['رجوع', 'Back'],
    ['تغيير الوقت', 'Change time'],
    ['السوق اليوم:', 'Market today:'],
    ['1. اختر موضوع المنشور', '1. Choose the post topic'],
    ['2. اختر الصورة', '2. Choose the image'],
    ['3. اختر النص', '3. Choose the caption'],
    ['4. اختر موعد النشر', '4. Choose publish time'],
    ['اضغط على أي صورة لتكبيرها وتعديلها بالمحادثة، أو اعتمدها مباشرة.', 'Click any image to zoom and edit via chat, or approve it directly.'],
    ['عدّل هذه الصورة', 'Edit this image'],
    ['اعتمد هذه الصورة وانتقل إلى النص', 'Use this image and go to caption'],
    ['عدّله بالذكاء الاصطناعي', 'Edit with AI'],
    ['عدّل يدوياً', 'Edit by hand'],
    ['عدّل النص بالمحادثة', 'Edit the caption by chat'],
    ['اعتمد هذا النص وانتقل إلى الموعد', 'Use this caption and pick a time'],
    ['اختر هذا', 'Choose this'],
    ['اعتمد النص المعدّل', 'Use edited caption'],
    ['ما التعديل المطلوب؟', 'What edit do you want?'],
    ['ما التعديل المطلوب على النص؟', 'What edit do you want for the caption?'],
    ['ارفع صورة', 'Upload image'],
    ['ولّد صور جديدة', 'Generate new images'],
    ['اكتب نصوصاً أخرى', 'Write other captions'],
    ['استخدم موضوعي', 'Use my topic'],
    ['ابدأ بموضوعي', 'Start with my topic'],
    ['اقترح 3 مواضيع أخرى', 'Suggest 3 other topics'],
    ['إلغاء', 'Cancel'],
    ['لم يعجبك أي منها؟ اكتب موضوعك...', 'None of these? Write your own topic...'],
    ['أو اكتب موضوعاً من عندك وابدأ به مباشرة...', 'Or write your own topic and start right away...'],
    ['وقت آخر', 'Custom time'],
    ['انشر الآن', 'Publish now'],
    ['إلغاء الجدولة', 'Cancel schedule'],
    ['أعد محاولة النشر', 'Retry publishing'],
    ['لا توجد أوقات مقترحة.', 'No suggested times.'],
    ['لا توجد منشورات بعد.', 'No posts yet.'],
    ['تم إلغاء هذا المنشور.', 'This post was cancelled.'],
    ['تم حفظ إعدادات التسويق', 'Marketing settings saved'],
    ['جاري البحث...', 'Searching...'],
    ['اربطه من هنا', 'Connect here'],
    ['المنافسون — أكثر منشوراتهم تفاعلاً', 'Competitors — their most engaging posts'],
    ['ماذا يسأل عملاؤك (من البوت والتعليقات)', 'What your customers ask (from the bot and comments)'],
    ['أفضل أوقات النشر القادمة', 'Best upcoming posting times'],
    ['أنجح منشوراتكم', 'Your best-performing posts'],
    ['أخبار المجال هذا الأسبوع', 'Industry news this week'],
    ['منشور عن هذا الخبر', 'Post about this news'],
    ['أنشئ منشوراً أفضل عن الموضوع نفسه', 'Create a better post on this topic'],
    ['فتح', 'Open'],
    ['افتح النسخة', 'Open version'],
    ['فتح البوست', 'Open post'],
    ['تم', 'Done'],
    ['فشل', 'Failed'],
    ['تليجرام مربوط', 'Telegram connected'],
    ['تليجرام غير مربوط', 'Telegram not connected'],
    ['AI جاهز', 'AI ready'],
    ['لا يوجد مفتاح AI', 'No AI key'],
    ['فيسبوك: جاهز للنشر', 'Facebook: ready to publish'],
    ['فيسبوك: يحتاج إلى ربط', 'Facebook: needs connecting'],
    ['إنستغرام: جاهز للنشر', 'Instagram: ready to publish'],
    ['إنستغرام: يحتاج إلى ربط', 'Instagram: needs connecting'],
    ['قناة تليجرام: جاهز للنشر', 'Telegram channel: ready to publish'],
    ['قناة تليجرام: يحتاج إلى ربط', 'Telegram channel: needs connecting'],
    ['لم تُحلَّل هوية تصميمك بعد. اضغط «تعلّم من صفحتي» لقراءة منشوراتك على إنستغرام واستخراج الألوان والخطوط وأسلوب التصميم، لتخرج كل صورة جديدة بالأسلوب نفسه.', 'Your design identity has not been analyzed yet. Press "Learn from my page" to read your Instagram posts and extract colors, fonts and design style, so every new image follows the same look.'],

    // Knowledge Base
    ['يجيب البوت من هذه الملفات فقط، وأي تعديل يُطبّق فوراً.', 'The bot answers only from these files — edits apply immediately.'],
    ['ملفات الشركة ومعلومات إضافية', 'Company files and extra info'],
    ['إضافة وثيقة جديدة', 'Add a new document'],
    ['عنوان الوثيقة', 'Document title'],
    ['محتوى الوثيقة', 'Document content'],
    ['الصق نص الوثيقة هنا، وسيجيب البوت منها فور الحفظ.', 'Paste the document text here — the bot answers from it right after saving.'],
    ['إضافة الوثيقة', 'Add document'],
    ['مثال: لدينا عرض هذا الشهر... / ساعات الدوام... / خدمة جديدة... — يجيب البوت فوراً من أي معلومة تكتبها هنا.', "e.g. this month's offer / working hours / a new service — the bot answers from anything you write here."],
    ['حفظ المعلومات', 'Save information'],
    ['التعليمات الكاملة التي يراها البوت', 'The full instructions the bot sees'],
    ['وثيقة', 'Document'],
    ['حفظ الوثيقة', 'Save document'],
    ['يجيب البوت من هذه الوثيقة', 'The bot answers from this document'],
    ['تم الحفظ', 'Saved'],
    ['فشل الحفظ', 'Save failed'],
    ['اكتب عنوان ومحتوى للوثيقة', 'Enter a title and content'],
    ['تمت الإضافة', 'Added'],
    ['فشلت الإضافة', 'Add failed'],

    // Settings & Integrations
    ['الحسابات المربوطة وسلوك البوت. عدّل الإعدادات ثم اضغط حفظ.', 'Connected accounts and bot behavior. Edit, then save.'],
    ['حفظ الإعدادات', 'Save settings'],
    ['تنزيل البيانات (Excel)', 'Download data (Excel)'],
    ['كل البيانات', 'All data'],
    ['كل الرسائل', 'All messages'],
    ['المواعيد', 'Appointments'],
    ['المنشورات', 'Posts'],
    ['مكالمات الـ AI', 'AI calls'],
    ['«كل البيانات» ملف واحد بصفحة لكل نوع.', '"All data" is one file with a sheet for each type.'],
    ['فحص النظام', 'System check'],
    ['افحص كل شيء', 'Check everything'],
    ['يفحص كل ربط على حساباتك الفعلية ويبيّن ما ينقص.', 'Checks every connection on your real accounts and tells you what is missing.'],
    ['جاري الفحص... (حتى 25 ثانية)', 'Checking... (up to 25 seconds)'],
    ['تعذر تشغيل الفحص', 'Could not run the check'],
    ['تم حفظ وتحديث الإعدادات بنجاح!', 'Settings saved!'],
    ['فشل حفظ الإعدادات', 'Failed to save settings'],
    ['نسخ', 'Copy'],
    ['إضافة', 'Add'],
    ['حذف', 'Delete'],
    ['معاينة', 'Preview'],
    ['فيسبوك وإنستغرام', 'Facebook & Instagram'],
    ['فحص الإنستا والتعليقات', 'Check Instagram & comments'],
    ['فحص الاتصال', 'Test connection'],
    ['ربط الحساب', 'Connect account'],
    ['موافقة واحدة على فيسبوك تربط الصفحة وإنستغرام بجميع الصلاحيات.', 'One Facebook approval connects the Page and Instagram with every permission.'],
    ['سجّل دخول بفيسبوك وإنستغرام', 'Sign in with Facebook and Instagram'],
    ['إعادة تسجيل الدخول بفيسبوك', 'Re-sign in with Facebook'],
    ['من App settings ← Basic', 'From App settings ← Basic'],
    ['لتطبيقات Business فقط', 'Business apps only'],
    ['Login Configuration ID (اختياري)', 'Login Configuration ID (optional)'],
    ['رابط الرجوع (Valid OAuth Redirect URI):', 'Return link (Valid OAuth Redirect URI):'],
    ['خطوات أول مرة (5 دقائق) والصلاحيات المطلوبة', 'First-time setup (5 minutes) and required permissions'],
    ['developers.facebook.com ← تطبيقك ←', 'developers.facebook.com → your app →'],
    [': انسخ App ID و App Secret إلى هنا واضغط', ': copy App ID and App Secret here and click'],
    ['من', 'Under'],
    ['أضف', 'add'],
    ['(أو Facebook Login for Business) ← Settings ← الصق', '(or Facebook Login for Business) → Settings → paste the'],
    ['رابط الرجوع', 'redirect URL'],
    ['بخانة Valid OAuth Redirect URIs ← Save.', 'into Valid OAuth Redirect URIs → Save.'],
    ['، اختر صفحتك وحساب إنستغرام، ووافق على جميع الصلاحيات.', ', choose your page and Instagram account, and approve all permissions.'],
    ['ثم اضغط', 'Then click'],
    ['— يجب أن تظهر كل الأسطر بعلامة صح.', '— every line should show a check mark.'],
    ['ملاحظة: ما دام التطبيق في وضع Development، تعمل الصلاحيات لحسابات المشرفين فقط. ليرد البوت على الجميع، يلزم App Review من Meta لصلاحيات الرسائل والتعليقات.', 'Note: while the app is in Development mode, permissions only work for admin accounts. For the bot to reply to everyone, Meta App Review is required for messaging and comment permissions.'],
    ['Page Access Token (رمز وصول الصفحة)', 'Page Access Token'],
    ['يُعبّأ تلقائياً بعد تسجيل الدخول بفيسبوك.', 'Filled in automatically after signing in with Facebook.'],
    ['Page ID (معرف الصفحة)', 'Page ID'],
    ['من إعدادات التطبيق في Meta Developers', 'From app settings in Meta Developers'],
    ['الرد الآلي على التعليقات', 'Auto-reply to comments'],
    ['إرسال رسالة خاصة (DM) للمهتمين', 'Send a private DM to interested commenters'],
    ['رد التعليق الاحتياطي', 'Fallback comment reply'],
    ['الرسالة الخاصة الاحتياطية', 'Fallback private message'],
    ['تُرسل فقط عند تعذّر الذكاء الاصطناعي.', 'Sent only when the AI is unavailable.'],
    ['جاري الاستعلام من Meta مباشرة...', 'Asking Meta directly...'],
    ['لا توجد أحداث حتى الآن — أرسل رسالة أو تعليقاً تجريبياً ثم اضغط الزر مرة أخرى.', 'No events yet — send a test message or comment and click the button again.'],
    ['جاري فحص اتصال Meta API...', 'Testing the Meta API connection...'],
    ['اكتب App ID و App Secret أولاً', 'Enter App ID and App Secret first'],
    ['تم الربط', 'Connected'],
    ['فشل الربط', 'Connection failed'],

    // WhatsApp settings
    ['ربط واتساب', 'WhatsApp connection'],
    ['طريقة الربط', 'Connection method'],
    ['QR كود (جهاز مرتبط)', 'QR code (linked device)'],
    ['WhatsApp Cloud API الرسمي (Meta)', 'Official WhatsApp Cloud API (Meta)'],
    ['رقمك على واتساب (Linked Phone Number)', 'Your WhatsApp number'],
    ['جاري فحص الحالة...', 'Checking status...'],
    ['افتح واتساب على هاتفك ← الإعدادات ← الأجهزة المرتبطة ← ربط جهاز، ثم امسح الكود.', 'Open WhatsApp on your phone → Settings → Linked devices → Link a device, then scan the code.'],
    ['توليد QR', 'Generate QR'],
    ['ربط بكود بدل QR', 'Link with a code instead'],
    ['فصل الرقم', 'Disconnect number'],
    ['Phone Number ID (معرف رقم الهاتف في Meta)', 'Phone Number ID (Meta)'],
    ['جاري فحص اتصال WhatsApp API...', 'Testing the WhatsApp API connection...'],
    ['امسح الكود من هاتفك', 'Scan the code with your phone'],
    ['جاري الاتصال...', 'Connecting...'],
    ['غير مربوط — اضغط "توليد QR"', 'Not connected — click "Generate QR"'],
    ['جاري توليد كود الربط...', 'Generating the link code...'],
    ['واتساب ← الأجهزة المرتبطة ← ربط جهاز ← الربط برقم الهاتف، وأدخل الكود', 'WhatsApp → Linked devices → Link a device → Link with phone number, then enter the code'],
    ['تم الفصل', 'Disconnected'],
    ['تم فصل واتساب وحذف الجلسة', 'WhatsApp disconnected and session cleared'],

    // Bot reply behaviour
    ['سلوك الرد (التأخير والرد المقتبس)', 'Reply behaviour (delay & quoting)'],
    ['مدة الانتظار قبل الرد (بالثواني)', 'Wait before replying (seconds)'],
    ['بعد آخر رسالة من العميل. يُرد على الرسائل المتتالية مرة واحدة.', 'After the customer’s last message. Messages in a row get one reply.'],
    ['الرد كـ "رد على الرسالة" (اقتباس رسالة العميل فوق الرد)', "Reply as a quoted reply to the customer's message"],
    ['إظهار "يكتب الآن..." وعلامة القراءة قبل الرد', 'Show "typing..." and read receipts before replying'],
    ['إيقاف البوت تلقائياً عندما يرد موظف على العميل', 'Pause the bot automatically when an agent replies'],
    ['من لوحة التحكم، الجوال، أو صندوق رسائل فيسبوك وإنستغرام.', 'From the dashboard, the phone, or the Facebook/Instagram inbox.'],
    ['مدة الإيقاف', 'Pause duration'],
    ['حتى إعادة تشغيله يدوياً (موصى به)', 'Until I resume it manually (recommended)'],
    ['ساعة واحدة', '1 hour'],
    ['4 ساعات', '4 hours'],
    ['12 ساعة', '12 hours'],
    ['24 ساعة', '24 hours'],
    ['3 أيام', '3 days'],
    ['لا يعود البوت للعملاء المحوّلين إلى الموظف إلا يدوياً.', 'Customers handed to an agent only get the bot back manually.'],

    // Supabase settings
    ['قاعدة بيانات Supabase', 'Supabase database'],
    ['فحص اتصال Supabase', 'Test Supabase'],
    ['تفعيل حفظ الرسائل والمحادثات في Supabase أولاً بأول', 'Save messages and conversations to Supabase in real time'],
    ['عرض كود الـ SQL لجداول Supabase', 'Show the SQL for the Supabase tables'],
    ['حفظ المحادثات بـ Supabase', 'Conversations saved in Supabase'],
    ['مزامنة كل البيانات الآن', 'Sync all data now'],
    ['جاري فحص اتصال Supabase...', 'Testing Supabase...'],
    ['الرسائل', 'Messages'],
    ['يُحفظ كل تغيير تلقائياً خلال ثانيتين', 'Every change is saved automatically within 2 seconds'],
    ['تعذر قراءة حالة المزامنة', 'Could not read the sync status'],
    ['جاري حفظ كل البيانات بـ Supabase...', 'Saving all data to Supabase...'],
    ['Supabase غير مربوط — المحادثات محفوظة على الخادم فقط. عند الربط تُرفع جميع البيانات السابقة تلقائياً.', 'Supabase is not connected — conversations are only on the server. Once connected, all old data is uploaded automatically.'],

    // Google Sheets & Forms
    ['ربط Google Sheets (كل تفاصيل السيلز)', 'Google Sheets (full sales details)'],
    ['فحص الربط وتجهيز الشيت', 'Test & prepare the sheet'],
    ['رابط الشيت (أو Spreadsheet ID)', 'Sheet link (or Spreadsheet ID)'],
    ['اسم الورقة (Tab)', 'Sheet tab name'],
    ['تُنشأ تلقائياً إن لم تكن موجودة.', 'Created automatically if missing.'],
    ['ملف Service Account (JSON)', 'Service Account file (JSON)'],
    ['Google Cloud ← فعّل Google Sheets API ← Service Accounts ← Keys ← Add key ← JSON، ثم الصق محتوى الملف هنا.', 'Google Cloud → enable the Google Sheets API → Service Accounts → Keys → Add key → JSON, then paste the file content here.'],
    ['شارك الجدول مع هذا البريد بصلاحية', 'Share the sheet with this email as'],
    ['طريقة بديلة: Google Apps Script Webhook', 'Alternative: Google Apps Script webhook'],
    ['تُستخدم فقط عند عدم وجود Service Account.', 'Only used when there is no Service Account.'],
    ['رابط Google Form لاستقبال بيانات العملاء', 'Google Form link for customer data'],
    ['استخدم رابط المجيب العام (وليس رابط التعديل).', 'Use the public responder link (not the edit link).'],
    ['إضافة وتحديث بيانات العملاء تلقائياً في Google Form', 'Add customer data to the Google Form automatically'],
    ['تحديث صف العميل بعد كل رسالة', 'Update the customer row after every message'],
    ['جاري فحص الربط مع Google Sheets...', 'Testing Google Sheets...'],

    // Email notifications & team
    ['إشعارات الإيميل لفريق المبيعات (Gmail)', 'Email notifications for the sales team (Gmail)'],
    ['إرسال إيميل تجريبي', 'Send test email'],
    ['إيميلات الإدارة', 'Management emails'],
    ['Gmail المرسل', 'Sender Gmail'],
    ['من حساب Google ← Security ← App passwords (وليس كلمة مرور البريد).', 'From Google Account → Security → App passwords (not your email password).'],
    ['رابط لوحة التحكم (اختياري)', 'Dashboard link (optional)'],
    ['تفعيل إشعارات الإيميل', 'Enable email notifications'],
    ['أبلغني إذا كتب العميل المحوّل من جديد', 'Tell me when a handed-off customer writes again'],
    ['آخر الإشعارات', 'Latest notifications'],
    ['لا يوجد إيميلات بعد', 'No emails yet'],
    ['لا يوجد إشعارات بعد', 'No notifications yet'],
    ['اكتب إيميل صحيح', 'Enter a valid email'],
    ['اضغط "حفظ وتحديث الإعدادات" لتثبيت التغيير', 'Click "Save settings" to apply'],
    ['تمت الإضافة — اضغط "حفظ وتحديث الإعدادات" لتثبيتها', 'Added — click "Save settings" to apply'],
    ['جاري إرسال بريد تجريبي... (احفظ الإعدادات أولاً إذا عدّلت شيئاً)', 'Sending a test email... (save settings first if you changed something)'],
    ['فريق المبيعات (توزيع العملاء)', 'Sales team (lead distribution)'],
    ['يُسند كل عميل جاهز إلى موظف بالتناوب، ويصله بريد بتفاصيل العميل.', 'Each ready customer is assigned to the next person, who gets an email with the details.'],
    ['اسم الموظف (مثلاً: م. مهند)', 'Agent name (e.g. Eng. Mohannad)'],
    ['لا يوجد موظفون — تُرسل الرسائل إلى بريد الإدارة.', 'No agents — emails go to the admins.'],
    ['اضغط "حفظ وتحديث الإعدادات" للتثبيت', 'Click "Save settings" to apply'],
    ['اكتب اسم الموظف', "Enter the agent's name"],
    ['البريد مضاف مسبقاً', 'Email already added'],
    ['تمت الإضافة — اضغط "حفظ وتحديث الإعدادات"', 'Added — click "Save settings"'],

    // Business hours, calls, phone, calendar, follow-ups, reports, AI, handoff
    ['ساعات الدوام', 'Working hours'],
    ['تفعيل ساعات الدوام', 'Enable working hours'],
    ['الأحد', 'Sunday'],
    ['الاثنين', 'Monday'],
    ['الثلاثاء', 'Tuesday'],
    ['الأربعاء', 'Wednesday'],
    ['الخميس', 'Thursday'],
    ['الجمعة', 'Friday'],
    ['السبت', 'Saturday'],
    ['من', 'From'],
    ['لغاية', 'To'],
    ['إلى', 'To'],
    ['رسالة التحويل خارج الدوام', 'After-hours handoff message'],
    ['{rep} = اسم الموظف، {time} = موعد التواصل (مثلاً "غداً الساعة 09:00").', '{rep} = agent name, {time} = when they will reach out (e.g. "tomorrow at 09:00").'],
    ['أرسل بريد الموظفين في بداية الدوام بدلاً من الليل', 'Hold agent emails until the start of working hours'],
    ['مكالمة الـ AI الصوتية', 'AI voice call'],
    ['يعرض البوت على العميل المهتم مكالمة صوتية مع الـ AI قبل اجتماع المهندس', 'The bot offers interested customers a voice call with the AI before the engineer meeting'],
    ['يرسل البوت رابط مكالمة خاصاً على موقعك. يسأل الـ AI العميل بالصوت، ويحجز له اجتماع المهندس إذا كان جاهزاً، ثم تُحفظ كل التفاصيل في Google Sheets.', 'The bot sends a private call link on your site. The AI asks the customer by voice, books the engineer meeting if they are ready, and every detail is saved to Google Sheets.'],
    ['OpenAI API Key (للصوت)', 'OpenAI API Key (for voice)'],
    ['من platform.openai.com ← API keys. يبقى المفتاح على الخادم فقط.', 'From platform.openai.com → API keys. The key stays on the server only.'],
    ['صوت المساعد', 'Assistant voice'],
    ['أقصى مدة للمكالمة', 'Maximum call length'],
    ['10 دقائق', '10 minutes'],
    ['15 دقيقة', '15 minutes'],
    ['20 دقيقة', '20 minutes'],
    ['30 دقيقة', '30 minutes'],
    ['صلاحية الرابط', 'Link valid for'],
    ['يوم', '1 day'],
    ['3 أيام', '3 days'],
    ['أسبوع', '1 week'],
    ['أسبوعين', '2 weeks'],
    ['أسئلة إضافية يسألها الـ AI (اختياري)', 'Extra questions for the AI (optional)'],
    ['مثال: هل لديكم موقع إلكتروني؟ / كم فرعاً لديكم؟', 'e.g. Do you have a website? / How many branches do you have?'],
    ['النموذج', 'Model'],
    ['أُرسل الرابط للعميل', 'Link sent to the customer'],
    ['المكالمة جارية', 'Call in progress'],
    ['تمت المكالمة', 'Call completed'],
    ['مؤهل للشراء', 'Qualified to buy'],
    ['غير مؤهل حالياً', 'Not qualified yet'],
    ['الخطوة التالية:', 'Next step:'],
    ['نص المكالمة', 'Call transcript'],
    ['تم نسخ رابط المكالمة', 'Call link copied'],
    ['تعذّر إنشاء الرابط', 'Could not create link'],
    ['المساعد', 'Assistant'],
    ['لا يوجد نص.', 'No transcript.'],
    ['تعذّر تحميل النص.', 'Could not load transcript.'],
    ['الرد الآلي على رقم الهاتف', 'AI answering on your phone number'],
    ['ربط الرقم وفحصه', 'Connect and check'],
    ['يرد المساعد على المكالمات، ويحوّل لخدمة العملاء عند الطلب', 'The assistant answers calls and transfers to customer service on request'],
    ['تُحوَّل مكالمات رقمك إلى رقم Twilio، فيرد المساعد بالصوت من ملفات الشركة، ويحجز اجتماع المهندس، ويحوّل المتصل إلى هاتفك عند طلب موظف. تُحفظ كل مكالمة في العملاء و Google Sheets.', 'Calls to your number are forwarded to a Twilio number. The assistant answers by voice from the company files, books the engineer meeting, and transfers the caller to your phone when they ask for a person. Every call is saved to customers and Google Sheets.'],
    ['رقم Twilio (تُحوَّل إليه المكالمات)', 'Twilio number (calls are forwarded here)'],
    ['رقم خدمة العملاء (يرن عند التحويل)', 'Customer-service number (rings on transfer)'],
    ['في الوضع الموصى به يمكن أن يكون رقمك نفسه.', 'In the recommended mode this can be your own number.'],
    ['متى يرد المساعد؟', 'When does the assistant answer?'],
    ['فقط عندما لا أرد، أو الخط مشغول، أو الهاتف مغلق (موصى به)', 'Only when I do not answer, the line is busy, or the phone is off (recommended)'],
    ['على كل المكالمات (التحويل يحتاج رقماً ثانياً)', 'Every call (transfers need a second number)'],
    ['مدة الرنين قبل اعتبار التحويل فائتاً', 'Ring time before a transfer counts as missed'],
    ['15 ثانية', '15 seconds'],
    ['18 ثانية', '18 seconds'],
    ['30 ثانية', '30 seconds'],
    ['يخبر المساعد المتصل أن المكالمة تُسجَّل نصياً', 'The assistant tells callers the call is transcribed'],
    ['جاري الحفظ والربط...', 'Saving and connecting...'],
    ['اطلب هذا الكود من هاتفك (الخط الأردني) واضغط اتصال لتفعيل التحويل:', 'Dial this code from your phone (Jordanian line) and press call to turn on forwarding:'],
    ['أو كل حالة على حدة:', 'Or one case at a time:'],
    ['حجز المواعيد (Google Calendar)', 'Appointments (Google Calendar)'],
    ['فحص التقويم', 'Check calendar'],
    ['يحجز البوت الاستشارات الأونلاين في تقويم المهندس', "The bot books online consultations in the engineer's calendar"],
    ['يقترح البوت الأوقات المتاحة فقط، ويتحقق من التقويم قبل الحجز، ويرسل للعميل رابط الاجتماع.', 'The bot only offers free times, checks the calendar before booking, and sends the customer the meeting link.'],
    ['Gmail المهندس', "Engineer's Gmail"],
    ['غير مربوط', 'Not connected'],
    ['ربط التقويم', 'Connect calendar'],
    ['نسخ رابط الربط للمهندس', 'Copy connect link for the engineer'],
    ['فصل', 'Disconnect'],
    ['يفتح المهندس الرابط، يسجّل الدخول بحساب Google ويضغط «السماح»، فيُربط التقويم ويُفعَّل الحجز تلقائياً.', 'The engineer opens the link, signs in with Google and presses "Allow" — the calendar is connected and booking turns on automatically.'],
    ['إعداد تسجيل الدخول بـ Google (مرة واحدة)', 'Google sign-in setup (one time)'],
    ['من Google Cloud ← APIs & Services ← Credentials ← OAuth client ID (Web application). أضف رابط الرجوع هذا في Authorized redirect URIs:', 'From Google Cloud → APIs & Services → Credentials → OAuth client ID (Web application). Add this redirect link under Authorized redirect URIs:'],
    ['طريقة بديلة بدون تسجيل دخول: شارك التقويم مع حساب الخدمة الموجود في بطاقة Google Sheets بصلاحية «إجراء تغييرات على الأحداث».', 'Alternative without sign-in: share the calendar with the service account from the Google Sheets card, with "Make changes to events".'],
    ['أيام الحجز', 'Booking days'],
    ['متاح على مدار 24 ساعة', 'Available 24 hours'],
    ['مدة الاجتماع', 'Meeting length'],
    ['45 دقيقة', '45 minutes'],
    ['ساعة', '1 hour'],
    ['أقل مهلة قبل الموعد', 'Minimum notice'],
    ['بدون', 'None'],
    ['ساعتان', '2 hours'],
    ['4 ساعات', '4 hours'],
    ['الحجز خلال', 'Book up to'],
    ['شهر', '1 month'],
    ['اسم المهندس', 'Engineer name'],
    ['المهندس', 'Engineer'],
    ['رابط اجتماع ثابت (اختياري)', 'Fixed meeting link (optional)'],
    ['يُنشأ رابط Google Meet لكل موعد تلقائياً. إذا لم يتوفر، يُرسل الرابط الثابت.', 'A Google Meet link is created for each booking. If that is not available, the fixed link is sent.'],
    ['جاري فحص التقويم... (احفظ الإعدادات أولاً إذا عدّلتها)', 'Checking the calendar... (save the settings first if you changed them)'],
    ['تم فصل التقويم', 'Calendar disconnected'],
    ['سجّل الدخول بحساب المهندس واضغط «السماح»، ثم ارجع هنا.', 'Sign in with the engineer account and click "Allow", then come back here.'],
    ['تم نسخ رابط الربط — أرسله للمهندس (صالح لمدة ساعتين)', 'Connect link copied — send it to the engineer (valid for 2 hours)'],
    ['تعذّر إنشاء رابط الربط', 'Could not create connect link'],
    ['متابعة العملاء المنقطعين', 'Follow up with silent customers'],
    ['من سيستلم المتابعة؟', 'Who will get one?'],
    ['إرسال رسالة متابعة تلقائية للعميل المهتم الذي لم يرد', 'Send an automatic follow-up to interested customers who stopped replying'],
    ['بعد انقطاع العميل لمدة', 'After the customer has been silent for'],
    ['ساعتين', '2 hours'],
    ['6 ساعات', '6 hours'],
    ['12 ساعة', '12 hours'],
    ['20 ساعة (موصى به)', '20 hours (recommended)'],
    ['23 ساعة', '23 hours'],
    ['عندما تكون نسبة الشراء على الأقل (%)', 'When the buying probability is at least (%)'],
    ['أقصى عدد رسائل متابعة لكل عميل', 'Max follow-ups per customer'],
    ['رسالة واحدة', 'One message'],
    ['رسالتين', 'Two messages'],
    ['البوت يكتب رسالة المتابعة حسب محادثة كل عميل (يحتاج مفتاح AI)', "The bot writes each follow-up from the customer's conversation (needs an AI key)"],
    ['نص المتابعة الاحتياطي', 'Fallback follow-up text'],
    ['{name} = اسم العميل، {topic} = ما سأل عنه العميل. تُرسل الرسائل في أوقات الدوام فقط، بحد أقصى رسالة واحدة كل دقيقة، وقبل انتهاء مهلة الـ 24 ساعة التي تسمح بها واتساب وMeta للرد.', '{name} = customer name, {topic} = what they asked about. Messages are sent only during business hours, at most one per minute, and before the 24-hour reply window allowed by WhatsApp and Meta ends.'],
    ['ستُرسل متابعة إلى:', 'Follow-ups will go to:'],
    ['لا يوجد عملاء بحاجة إلى متابعة حالياً.', 'No customers need a follow-up right now.'],
    ['التقرير اليومي والنسخ الاحتياطي', 'Daily report & backups'],
    ['إرسال تقرير يومي لإيميلات الإدارة', 'Send a daily report to admin emails'],
    ['وقت التقرير', 'Report time'],
    ['أرسله الآن', 'Send now'],
    ['جاري إرسال التقرير...', 'Sending the report...'],
    ['نسخة احتياطية يومية', 'Daily backup'],
    ['(3 الفجر)', '(3 AM)'],
    ['احتفظ بالنسخ لمدة', 'Keep backups for'],
    ['7 أيام', '7 days'],
    ['14 يوم', '14 days'],
    ['30 يوم', '30 days'],
    ['90 يوم', '90 days'],
    ['نسخة احتياطية الآن', 'Back up now'],
    ['لا توجد نسخ احتياطية بعد.', 'No backups yet.'],
    ['الذكاء الاصطناعي', 'AI'],
    ['من openrouter.ai ← Keys.', 'From openrouter.ai → Keys.'],
    ['الموديل (Model)', 'Model'],
    ['سريع ورخيص (الافتراضي)', 'Fast & cheap (default)'],
    ['أذكى، أغلى', 'Smarter, pricier'],
    ['سريع، ويفهم التسجيلات الصوتية والصور', 'Fast, understands voice & images'],
    ['ردود طبيعية جداً، أغلى', 'Very natural replies, pricier'],
    ['تفعيل الرد على الرسائل الصوتية', 'Reply to voice notes'],
    ['فهم الصور التي يرسلها العميل (لقطة شاشة، منتج، مستند...)', 'Understand images customers send (screenshots, products, documents...)'],
    ['التحويل للموظف', 'Handoff to staff'],
    ['اسم ممثل المبيعات الرسمي للتحويل', 'Official sales rep name for handoff'],
    ['رسالة التحويل', 'Handoff message'],
    ['{rep} = اسم الموظف المسؤول عن العميل (أو الاسم أعلاه إذا لم يوجد فريق).', "{rep} = the assigned agent's name (or the name above if there is no team)."],
    ['التحويل للموظف عند وصول نسبة الشراء إلى (%)', 'Hand off when the buying probability reaches (%)'],
    ['أو إذا وافق على استشارة أو طلب التحدث مع موظف.', 'Or when they agree to a consultation or ask for a person.'],
    ['بعد التحويل يواصل البوت الرد حتى يرد الموظف، ويصل الموظفَ بريدٌ بكل التفاصيل.', 'After handoff the bot stays active until staff reply, and staff get an email with every detail.'],

    // Modals & Misc
    ['كود ربط Google Sheets الفوري', 'Google Sheets connection code'],
    ['افتح جدول Google Sheet، اضغط من الأعلى', 'Open your Google Sheet, then from the top menu click'],
    ['، الصق هذا الكود واضغط Deploy كـ Web App:', ', paste this code and Deploy as a Web App:'],
    ['نسخ الكود', 'Copy code'],
    ['مخطط قاعدة بيانات Supabase (SQL Schema)', 'Supabase SQL schema'],
    ['انسخ هذا الاستعلام ونفذه في', 'Copy this query and run it in'],
    ['لإنشاء كافة الجداول والفهارس المطلوبة:', 'to create all required tables and indexes:'],
    ['نسخ كود SQL', 'Copy SQL'],
    ['تم الحذف', 'Deleted'],
    ['فشل الحذف', 'Delete failed'],
    ['تم نسخ الرابط!', 'Link copied!'],
    ['تم نسخ الإيميل!', 'Email copied!'],
    ['تم نسخ الكود!', 'Code copied!'],
    ['تم نسخ استعلام SQL!', 'SQL query copied!'],

    // Reels & keyword rules
    ["الريلز والمنشورات عندك", "Your reels and posts"],
    ["ريلز", "Reels"],
    ["منشورات", "Posts"],
    ["الاثنين", "Both"],
    ["النوع", "Type"],
    ["المنصة", "Platform"],
    ["ابحث في الوصف", "Search captions"],
    ["اكتب كلمة أو جملة ثم Enter", "Type a word or phrase, then Enter"],
    ["أضف كلمات مفتاحية بقدر ما تريد. الكلمة المفتاحية ممكن تكون كلمة واحدة أو عدة كلمات (مثل \"كم السعر\")، والكلمات المتعددة تطابق أيضاً إذا وردت كل كلماتها في التعليق. الكلمات العربية تُطابق مع الهمزة وبدونها، ومع التاء المربوطة والهاء.", "Add as many keywords as you want. A keyword can be one word or several words (e.g. \"how much\"); a several-word keyword also matches when all its words are in the comment. Arabic spellings are matched with or without hamza and taa marbuta."],
    ['الريلز والكلمات المفتاحية', 'Reels & Keywords'],
    ['الريلز', 'Reels'],
    ['عندما يعلّق أحد بكلمة مفتاحية على الريل، يرد البوت تحت التعليق ويرسل له رسالتك أو رابطك أو ملفك أو نموذج الاستشارة المجانية.', 'When someone comments a keyword on your reel, the bot replies under the comment and sends them your message, link, file or the free consultation form.'],
    ['تحديث', 'Refresh'],
    ['قاعدة كلمة مفتاحية جديدة', 'New keyword rule'],
    ['قواعد الكلمات المفتاحية', 'Keyword rules'],
    ['جرّب تعليقاً', 'Test a comment'],
    ['اكتب تعليقاً، مثلاً: Atlead', 'Type a comment, e.g. Atlead'],
    ['جرّب', 'Test'],
    ['رابط نموذج الاستشارة:', 'Consultation form link:'],
    ['— كل نموذج يُعبّأ يظهر في إدارة الصفقات كعميل محتمل.', '— every filled form appears in Deals & CRM as a Prospect.'],
    ['الريلز عندك', 'Your reels'],
    ['الكل', 'All'],
    ['أظهر المنشورات أيضاً', 'Show posts too'],
    ['تصفية', 'Filter'],
    ['قاعدة الكلمة المفتاحية', 'Keyword rule'],
    ['الكلمات المفتاحية', 'Keywords'],
    ['افصل بينها بفاصلة. الكلمات العربية تُطابق مع الهمزة وبدونها، ومع التاء المربوطة والهاء.', 'Separate with commas. Arabic spellings are matched with or without hamza and taa marbuta.'],
    ['المطابقة', 'Match'],
    ['التعليق يحتوي الكلمة', 'Comment contains the word'],
    ['التعليق هو الكلمة فقط', 'Comment is exactly the word'],
    ['المنصات', 'Platforms'],
    ['الرد العام تحت التعليق', 'Public reply under the comment'],
    ['أرسلنا لك التفاصيل على الخاص.', 'Sent you the details in DM.'],
    ['رد واحد في كل سطر. يختار البوت واحداً عشوائياً حتى لا تتكرر الردود.', 'One reply per line. The bot picks one at random so replies don\'t look repeated.'],
    ['الرسالة الخاصة (DM)', 'Private message (DM)'],
    ['شكراً لتعليقك! هذا ما طلبته:', 'Thanks for your comment! Here is what you asked for:'],
    ['أضف نموذج الاستشارة المجانية', 'Add the free consultation form'],
    ['من يعبّئه يظهر في إدارة الصفقات كعميل محتمل.', 'Whoever fills it appears in Deals & CRM as a Prospect.'],
    ['رابط (اختياري)', 'Link (optional)'],
    ['عنوان الرابط (اختياري)', 'Link title (optional)'],
    ['قائمة الأسعار', 'Price list'],
    ['ملف (اختياري)', 'File (optional)'],
    ['لا يوجد ملف', 'No file'],
    ['رفع ملف', 'Upload file'],
    ['PDF أو صورة أو أي ملف حتى 25 ميغا. يُرسل كرابط تنزيل في الرسالة الخاصة.', 'PDF, image or any file up to 25 MB. It is sent as a download link in the DM.'],
    ['اسم القاعدة', 'Rule name'],
    ['استشارة مجانية', 'Free consultation'],
    ['ما يصل للمعلّق', 'What the commenter receives'],
    ['القاعدة مفعّلة', 'Rule is on'],
    ['حفظ القاعدة', 'Save rule']
  ];

  // Backend-only Arabic messages → English (not needed in TO_AR since backend emits Arabic when applicable)
  const EXTRA_AR_TO_EN = [
    ['أدخل رقم الهاتف أولاً', 'Enter a phone number first'],
    ['المحادثة غير موجودة', 'Conversation not found'],
    ['الرسالة فارغة', 'Message is empty'],
    ['العميل غير موجود', 'Customer not found'],
    ['تم حذف العميل ومحادثته', 'Customer and conversation deleted'],
    ['تم حذف العميل', 'Customer deleted'],
    ['وقت الدوام غير صحيح', 'Invalid business hours'],
    ['بداية الدوام لازم تكون قبل نهايته', 'Start time must be before end time'],
    ['في إيميل موظف مكرر', 'Duplicate sales rep email']
  ];

  const KEY = 'atlead_lang';
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

  const TO_EN = new Map();
  const TO_AR = new Map();
  for (const [ar, en] of PAIRS) {
    TO_EN.set(norm(ar), en);
    if (!TO_AR.has(norm(en))) TO_AR.set(norm(en), ar);
  }
  for (const [ar, en] of EXTRA_AR_TO_EN) {
    TO_EN.set(norm(ar), en);
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);
  const original = new WeakMap();
  const originalAttr = new WeakMap();
  const written = new WeakMap();

  // English is the default application language.
  let lang = localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en';
  let busy = false;

  function isSkipped(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.classList?.contains('no-i18n') || el.hasAttribute?.('data-no-i18n')) return true;
      el = el.parentElement;
    }
    return false;
  }

  function translateTextNode(node) {
    if (isSkipped(node)) return;
    const src = original.has(node) ? original.get(node) : node.nodeValue;
    const key = norm(src);
    if (!key) return;

    if (!original.has(node)) original.set(node, node.nodeValue);

    const lead = src.match(/^\s*/)[0];
    const trail = src.match(/\s*$/)[0];
    const dict = lang === 'ar' ? TO_AR : TO_EN;
    const hit = dict.get(key);
    const nextVal = hit !== undefined ? lead + hit + trail : src;

    if (node.nodeValue !== nextVal) {
      node.nodeValue = nextVal;
      written.set(node, nextVal);
    }
  }

  function translateAttrs(el) {
    if (isSkipped(el)) return;
    for (const attr of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(attr)) continue;
      const saved = originalAttr.get(el) || {};
      const src = saved[attr] ?? el.getAttribute(attr);
      if (saved[attr] === undefined) {
        saved[attr] = src;
        originalAttr.set(el, saved);
      }
      const dict = lang === 'ar' ? TO_AR : TO_EN;
      const hit = dict.get(norm(src));
      const nextVal = hit !== undefined ? hit : src;
      if (el.getAttribute(attr) !== nextVal) el.setAttribute(attr, nextVal);
    }
  }

  function walk(root) {
    if (!root || isSkipped(root)) return;
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => isSkipped(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
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
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.body.classList.toggle('lang-en', lang === 'en');
    document.body.classList.toggle('lang-ar', lang === 'ar');

    walk(document.body);
    const titleEl = document.querySelector('title');
    if (titleEl && titleEl.firstChild) translateTextNode(titleEl.firstChild);

    const btn = document.getElementById('lang-toggle');
    if (btn) {
      const segs = btn.querySelectorAll('.lang-seg');
      if (segs.length) {
        segs.forEach(s => s.classList.toggle('active', s.dataset.lang === lang));
      } else {
        const span = btn.querySelector('span');
        const label = lang === 'en' ? 'العربية' : 'English';
        if (span) span.textContent = label;
        else btn.innerHTML = `<i class="fa-solid fa-globe"></i> <span>${label}</span>`;
      }
      btn.title = lang === 'en' ? 'التبديل إلى العربية' : 'Switch to English';
    }
    busy = false;
  }

  function setLang(next) {
    lang = next === 'ar' ? 'ar' : 'en';
    localStorage.setItem(KEY, lang);
    apply();
    window.dispatchEvent(new CustomEvent('atlead:langchange', { detail: { lang } }));
  }

  function bindButton() {
    let btn = document.getElementById('lang-toggle');
    if (!btn) {
      btn = document.createElement('div');
      btn.id = 'lang-toggle';
      btn.className = 'lang-segmented no-i18n';
      btn.innerHTML = '<button type="button" class="lang-seg" data-lang="en">EN</button><button type="button" class="lang-seg" data-lang="ar">العربية</button>';
      const target = document.querySelector('.top-navbar-actions') || document.querySelector('.top-navbar') || document.body;
      target.appendChild(btn);
    }
    if (!btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        const seg = e.target.closest('.lang-seg');
        if (seg && seg.dataset.lang) setLang(seg.dataset.lang);
        else setLang(lang === 'en' ? 'ar' : 'en');
      });
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (busy) return;
    busy = true;
    for (const m of mutations) {
      if (m.type === 'characterData') {
        if (written.get(m.target) !== m.target.nodeValue) {
          original.delete(m.target);
          written.delete(m.target);
        }
        translateTextNode(m.target);
      } else if (m.type === 'attributes') {
        if (!isSkipped(m.target)) {
          const saved = originalAttr.get(m.target);
          if (saved && m.attributeName) delete saved[m.attributeName];
          translateAttrs(m.target);
        }
      } else {
        m.addedNodes.forEach(walk);
      }
    }
    busy = false;
  });

  function init() {
    bindButton();
    apply();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  function translateText(text) {
    const key = norm(text);
    if (!key) return text;
    return (lang === 'ar' ? TO_AR.get(key) : TO_EN.get(key)) ?? text;
  }

  window.atleadI18n = {
    setLang,
    apply,
    t: translateText,
    tr: (en, ar) => (lang === 'ar' ? ar : en),
    get lang() { return lang; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
