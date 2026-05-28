-- ══════════════════════════════════════════════════════════════
-- assistants_schema.sql   —   works12
-- يضمن أن جدول users في Supabase يحوي عمود permissions
-- وأن RLS تسمح بالقراءة بـ anonKey (مطلوب للمزامنة بين المتصفحات)
--
-- شغّل هذا الملف مرة واحدة في:
--   Supabase  →  SQL Editor  →  New Query  →  Run
--
-- آمن (idempotent): يمكن تشغيله مرات متعددة بدون مشاكل.
-- ══════════════════════════════════════════════════════════════

-- 1) إضافة عمود permissions إن لم يكن موجوداً
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB;

-- 2) فهرس لتسريع البحث عن المساعدين
CREATE INDEX IF NOT EXISTS idx_users_role_admin
  ON users(email) WHERE role = 'admin';

-- 3) تفعيل RLS (إن لم يكن مفعّلاً)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 4) سياسات القراءة والكتابة للـ anon و authenticated
--    (مطلوبة لأن المتصفح الثاني يستعلم قبل تسجيل الدخول بـ anonKey)
DROP POLICY IF EXISTS "users_select_all" ON users;
CREATE POLICY "users_select_all" ON users
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "users_insert_all" ON users;
CREATE POLICY "users_insert_all" ON users
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "users_update_all" ON users;
CREATE POLICY "users_update_all" ON users
  FOR UPDATE
  TO anon, authenticated
  USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 🔎 تحقق سريع بعد التشغيل:
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'users' AND column_name = 'permissions';
-- يجب أن ترى: permissions | jsonb
--
-- SELECT email, role, permissions FROM users WHERE role = 'admin';
-- يجب أن ترى المساعدين الذين أضفتهم (بعد فتح التطبيق على جهاز
-- الأدمن — selfHeal سيرفعهم تلقائياً).
-- ══════════════════════════════════════════════════════════════
