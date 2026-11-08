-- ==============================================================================
-- ATLEAD SALES CHATBOT & OMNICHANNEL CRM - SUPABASE DATABASE SCHEMA (v2)
-- شركة آت ليد (atlead) - مخطط قاعدة البيانات الكامل
--
-- طريقة الاستخدام:
--   Supabase ← SQL Editor ← New query ← الصق الملف كامل ← Run
--
-- الملف آمن للتشغيل أكثر من مرة (Idempotent):
--   - إذا الجداول مش موجودة: بينشئها كاملة.
--   - إذا عندك النسخة القديمة من الجداول: بيضيف الأعمدة الناقصة بدون ما يحذف أي بيانات.
--
-- مهم: في صفحة الإعدادات استخدم Service Role Key (مش anon) لأن الجداول محمية بـ RLS.
-- ==============================================================================


-- ==============================================================================
-- 1. المحادثات وملف العميل (Conversations + Customer Profile)
--    كل عميل على كل قناة له صف واحد. هنا بتنحفظ "ذاكرة" البوت عن العميل
--    عشان لما يرجع يبعث، البوت يكمل من وين ما وصل.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel VARCHAR(50) NOT NULL,              -- whatsapp | facebook_messenger | instagram_dm | simulator
    external_user_id VARCHAR(255) NOT NULL,    -- رقم الهاتف / PSID / IGSID
    customer_name VARCHAR(255) DEFAULT 'عميل محتمل',
    customer_phone VARCHAR(100),
    customer_email VARCHAR(255),
    customer_handle VARCHAR(100),              -- @username
    lead_stage VARCHAR(50) DEFAULT 'new',      -- new | discovery | qualified | hot | deal_closing | handed_off
    classification VARCHAR(20) DEFAULT 'Cold', -- Cold | Warm | Hot
    interest_score INTEGER DEFAULT 20,         -- نسبة الشراء 0-100
    is_bot_active BOOLEAN DEFAULT TRUE,        -- FALSE = محوّل لموظف بشري، البوت ما بيرد نهائياً
    handoff_at TIMESTAMPTZ,
    handoff_reason TEXT,
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (channel, external_user_id)
);

-- أعمدة ملف العميل (تنضاف للجداول القديمة إذا مش موجودة)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS local_id TEXT;                -- معرف المحادثة داخل السيرفر
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS business_type TEXT;           -- نوع نشاط العميل
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_requests TEXT;       -- شو طلب العميل
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS identified_problem TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS proposed_solution TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_summary TEXT;        -- ملخص كل اللي صار مع العميل
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS objections TEXT;              -- تردد/اعتراضات العميل
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS purchase_status VARCHAR(30) DEFAULT 'not_purchased'; -- not_purchased | pending_human | won | lost
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS human_notified_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS wa_jid TEXT;                  -- معرف واتساب الداخلي (ربط QR)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS wa_transport VARCHAR(20);     -- qr | cloud_api
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source VARCHAR(50);           -- dm | comment
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source_comment_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(20);         -- handoff | human_reply | manual (سبب إيقاف البوت)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pause_source TEXT;                -- وين رد الموظف (لوحة التحكم / الجوال / إنستغرام...)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_paused_until TIMESTAMPTZ;     -- NULL = لحد ما يرجع يدوياً
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_to_id TEXT;              -- الموظف المسؤول (فريق المبيعات)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_to_name TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_to_email TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS follow_up_count INTEGER DEFAULT 0; -- رسائل المتابعة المرسلة
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_local_id ON conversations(local_id);
CREATE INDEX IF NOT EXISTS idx_conversations_channel_user ON conversations(channel, external_user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_stage ON conversations(lead_stage);
CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversations(is_bot_active);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);


-- ==============================================================================
-- 2. الرسائل (Messages) - سجل المحادثة الكامل
-- ==============================================================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender VARCHAR(20) NOT NULL,                -- customer | bot | agent
    content TEXT NOT NULL DEFAULT '',
    media_type VARCHAR(50) DEFAULT 'text',      -- text | audio | image | document
    media_url TEXT,
    is_voice BOOLEAN DEFAULT FALSE,
    voice_transcript TEXT,
    audio_duration_seconds INTEGER,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS local_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_local_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_message_id TEXT;      -- wamid / mid / WA key id
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_external_id TEXT;     -- الرسالة اللي انرد عليها (Quote)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20);   -- sent | failed | simulated
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_follow_up BOOLEAN DEFAULT FALSE; -- رسالة متابعة تلقائية

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_local_id ON messages(local_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_local_id ON messages(conversation_local_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_message_id);


-- ==============================================================================
-- 3. العملاء المحتملين وتفاصيل السيلز (Leads / CRM) - نفس بيانات Google Sheet
-- ==============================================================================
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL DEFAULT 'عميل محتمل',
    phone VARCHAR(100),
    channel VARCHAR(50),
    company_name VARCHAR(255),
    business_type VARCHAR(255),
    identified_problem TEXT,
    proposed_solution TEXT,
    lead_stage VARCHAR(50) DEFAULT 'New',
    classification VARCHAR(20) DEFAULT 'Cold',
    buying_probability INTEGER DEFAULT 25,
    consultation_booked BOOLEAN DEFAULT FALSE,
    demo_requested BOOLEAN DEFAULT FALSE,
    deal_status VARCHAR(50) DEFAULT 'in_progress', -- in_progress | handed_off | won | lost
    notes TEXT,
    google_sheet_synced BOOLEAN DEFAULT FALSE,
    google_sheet_row_index INTEGER,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE leads ADD COLUMN IF NOT EXISTS local_id TEXT;                 -- معرف العميل داخل السيرفر (= أول عمود بالشيت)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversation_local_id TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_handle VARCHAR(100);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_requests TEXT;        -- شو طلب
ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_summary TEXT;         -- ملخص السيلز الكامل
ALTER TABLE leads ADD COLUMN IF NOT EXISTS objections TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS purchase_status VARCHAR(30) DEFAULT 'not_purchased';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS handed_off_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS human_notified_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_customer_message TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to_email TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_count INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS purchase_status_at TIMESTAMPTZ;      -- إمتى انحدد اشترى/لم يشترِ

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_local_id ON leads(local_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(lead_stage);
CREATE INDEX IF NOT EXISTS idx_leads_synced ON leads(google_sheet_synced);
CREATE INDEX IF NOT EXISTS idx_leads_probability ON leads(buying_probability DESC);
CREATE INDEX IF NOT EXISTS idx_leads_deal_status ON leads(deal_status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to_email);


-- ==============================================================================
-- 4. التعليقات على فيسبوك وإنستغرام (Comments + Private Reply)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL,             -- facebook | instagram
    post_id VARCHAR(255),
    comment_id VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(255),
    user_name VARCHAR(255),
    comment_text TEXT NOT NULL,
    bot_reply_text TEXT,
    sentiment VARCHAR(50) DEFAULT 'neutral',
    is_interested BOOLEAN DEFAULT FALSE,
    dm_triggered BOOLEAN DEFAULT FALSE,
    dm_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE comments ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'; -- pending | done | skipped
ALTER TABLE comments ADD COLUMN IF NOT EXISTS dm_text TEXT;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS public_reply_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS conversation_local_id TEXT;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_comments_platform_post ON comments(platform, post_id);
CREATE INDEX IF NOT EXISTS idx_comments_is_interested ON comments(is_interested);


-- ==============================================================================
-- 5. قاعدة المعرفة (Knowledge Base Documents)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS knowledge_docs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    doc_type VARCHAR(50) DEFAULT 'pdf',
    file_path TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ==============================================================================
-- 6. إعدادات النظام ومفاتيح الـ API (System Settings)
--    كل الإعدادات (توكنات Meta، مفاتيح AI، Google Sheets، إيميلات الإشعارات...)
--    بتنحفظ هنا تحت key = 'settings'
-- ==============================================================================
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ==============================================================================
-- 7. جلسة واتساب المربوطة عبر QR (WhatsApp linked-device session keys)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS whatsapp_auth (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ==============================================================================
-- 8. سجل الإشعارات (إيميلات التحويل للموظف)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,                  -- handoff | new_message_after_handoff | test
    conversation_local_id TEXT,
    lead_local_id TEXT,
    recipients TEXT[] NOT NULL DEFAULT '{}',
    subject TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'sent', -- sent | failed
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_conv ON notification_log(conversation_local_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at DESC);


-- ==============================================================================
-- 9. تحديث updated_at تلقائياً
-- ==============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_leads_updated_at ON leads;
CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_settings_updated_at ON app_settings;
CREATE TRIGGER update_app_settings_updated_at
BEFORE UPDATE ON app_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ==============================================================================
-- 10. عرض جاهز لكل تفاصيل السيلز (View) - افتحه من Table Editor
-- ==============================================================================
DROP VIEW IF EXISTS sales_pipeline;
CREATE VIEW sales_pipeline AS
SELECT
    l.local_id                              AS lead_id,
    l.name                                  AS customer_name,
    l.phone,
    l.customer_email,
    l.channel,
    l.customer_handle,
    l.business_type,
    l.customer_requests,
    l.identified_problem,
    l.proposed_solution,
    l.lead_stage,
    l.classification,
    l.buying_probability,
    l.purchase_status,
    l.purchase_status_at,
    l.assigned_to_name,
    l.follow_up_count,
    l.deal_status,
    l.handed_off_at,
    l.human_notified_at,
    l.customer_summary,
    l.objections,
    l.message_count,
    l.last_customer_message,
    l.first_contact_at,
    l.updated_at,
    c.is_bot_active,
    c.pause_reason
FROM leads l
LEFT JOIN conversations c ON c.local_id = l.conversation_local_id;


-- ==============================================================================
-- 11. الحماية (Row Level Security)
--     مفعّلة بدون policies = الجداول مقفلة على مفتاح anon/المتصفح.
--     السيرفر بيستخدم Service Role Key اللي بيتجاوز RLS.
-- ==============================================================================
ALTER TABLE conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_docs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_auth    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- الـ View يتبع صلاحيات المستخدم اللي بيستعلم (Postgres 15+ / Supabase)
ALTER VIEW sales_pipeline SET (security_invoker = true);

-- ==============================================================================
-- انتهى. ✅
-- ==============================================================================
