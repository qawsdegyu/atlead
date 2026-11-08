# 🚂 نشر البوت على Railway

## 1) أنشئ المشروع
1. ادخل [railway.com](https://railway.com) وسجّل دخول بحساب GitHub.
2. **New Project** ← **Deploy from GitHub repo** ← اختار `qawsdegyu/atlead`.
3. Railway بيقرأ `railway.json` لحاله (أمر التشغيل `npm start` + فحص `/healthz`).

## 2) أضف التخزين الدائم (Volume) — ضروري
بدونه بتروح المحادثات وجلسة الواتساب مع كل إعادة نشر.
1. افتح الخدمة (Service) ← كليك يمين على المربع ← **Attach Volume** (أو Ctrl/Cmd + K ← Volume).
2. **Mount path:** `/data`
3. البوت بيستخدمه تلقائياً (ما بدك متغير `DATA_DIR`).

## 3) المتغيرات (Variables)
الخدمة ← **Variables** ← **Raw Editor** والصق (عدّل القيم):

```
ADMIN_USER=admin
ADMIN_PASSWORD=اكتب-كلمة-سر-قوية-هون
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_KEY=الـService-Role-Key
```

- `SUPABASE_KEY`: من Supabase ← Project Settings ← API Keys ← **service_role** (مش anon).
- لا تضيف `PORT` — Railway بيعطيه لحاله.

## 4) رابط عام (Domain)
الخدمة ← **Settings** ← **Networking** ← **Generate Domain**.
بيعطيك رابط زي `https://atlead-production.up.railway.app`.

## 5) قاعدة البيانات
Supabase ← **SQL Editor** ← الصق `supabase_schema.sql` كامل ← **Run**.

## 6) أول تشغيل
1. افتح الرابط ← بيطلب اسم المستخدم وكلمة السر (من الخطوة 3).
2. **إعدادات الربط والـ APIs**: عبّي Supabase، مفتاح Gemini، Meta، Google Sheets، Gmail، فريق المبيعات ← **حفظ**.
3. **ربط واتساب** ← توليد QR ← امسحه من الجوال (الأجهزة المرتبطة).
4. **Meta Developers** ← تطبيقك ← Webhooks:
   - Callback URL: `https://رابطك/webhook/meta`
   - Verify Token: نفس اللي بالإعدادات (افتراضي `attlead_meta_verify_token_2026`)
   - Page: `messages`, `messaging_postbacks`, `message_echoes`, `feed`
   - Instagram: `messages`, `comments`
5. بطاقة Meta ← **فحص الاتصال** (بيشترك الصفحة تلقائياً).
6. **فحص النظام الكامل** ← "افحص كل شيء" ← لازم يطلع كله ✅.

## ملاحظات مهمة
- **نسخة وحدة بس** (Replicas = 1) — نسختين بيفصلوا جلسة الواتساب عن بعض. `railway.json` مضبوط على 1.
- كل `git push` على `main` بيعمل نشر جديد تلقائياً، والبيانات بتضل بالـ Volume.
- السجلات (Logs): الخدمة ← **Deployments** ← **View Logs**.
