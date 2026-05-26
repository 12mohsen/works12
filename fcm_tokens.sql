-- ══════════════════════════════════════════════════════════
-- جدول fcm_tokens لحفظ توكنات FCM لكل جهاز
-- 🛠️ نسخة آمنة (idempotent) — تعمل على قاعدة جديدة أو قديمة:
--    • إن لم يكن الجدول موجوداً → ينشئه كاملاً
--    • إن كان الجدول موجوداً وينقصه عمود → يضيفه (لن تظهر مشكلة "column role does not exist")
--    • تنشئ كل الفهارس والدالة والسياسات بشكل آمن
--
-- شغّل هذا الكود في:  Supabase → SQL Editor → New Query → Run
-- ══════════════════════════════════════════════════════════

-- 1) دالة تحديث updated_at تلقائياً (تُنشأ مرة واحدة لكل المشروع)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) الجدول الأساسي (إن لم يكن موجوداً)
CREATE TABLE IF NOT EXISTS fcm_tokens (
  id           SERIAL PRIMARY KEY,
  token        TEXT UNIQUE NOT NULL,
  user_email   TEXT,
  user_id      TEXT,
  user_name    TEXT,
  role         TEXT,                  -- 'admin' | 'vendor' | 'customer'
  vendor_id    TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- 3) ⭐ إضافة الأعمدة الناقصة (لمن أنشأ الجدول بنسخة قديمة)
--     هذه السطور هي حل خطأ:  "column \"role\" does not exist"
ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS user_id    TEXT;
ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS user_name  TEXT;
ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS role       TEXT;
ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS vendor_id  TEXT;
ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 4) فهارس للبحث السريع عند الإرسال
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_email  ON fcm_tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_role   ON fcm_tokens(role);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_vendor ON fcm_tokens(vendor_id);

-- 5) تفعيل RLS وسياسة عامة (تستخدم service_role للحفظ والقراءة)
ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on fcm_tokens" ON fcm_tokens;
CREATE POLICY "Allow all on fcm_tokens" ON fcm_tokens FOR ALL USING (true) WITH CHECK (true);

-- 6) تحديث تلقائي لـ updated_at عند كل UPDATE
DROP TRIGGER IF EXISTS set_updated_at ON fcm_tokens;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fcm_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════════════
-- 🔎 تحقق سريع بعد التشغيل:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'fcm_tokens';
-- يجب أن ترى: id, token, user_email, user_id, user_name,
--               role, vendor_id, user_agent, created_at, updated_at
-- ══════════════════════════════════════════════════════════
