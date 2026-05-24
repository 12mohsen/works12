-- ══════════════════════════════════════════════════════════════
-- جدول fcm_tokens — لتخزين رموز إشعارات FCM
-- شغّل هذا الكود في SQL Editor في لوحة تحكم Supabase (مرة واحدة)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  user_email   TEXT NOT NULL DEFAULT '',
  user_name    TEXT DEFAULT '',
  user_role    TEXT NOT NULL DEFAULT 'customer',  -- admin / vendor / customer
  fcm_token    TEXT UNIQUE NOT NULL,
  device_info  TEXT DEFAULT '',
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- فهارس لتسريع الاستعلامات
CREATE INDEX IF NOT EXISTS idx_fcm_role   ON fcm_tokens(user_role);
CREATE INDEX IF NOT EXISTS idx_fcm_email  ON fcm_tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_fcm_uid    ON fcm_tokens(user_id);

-- RLS مع سياسة وصول كامل
ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on fcm_tokens" ON fcm_tokens;
CREATE POLICY "Allow all on fcm_tokens" ON fcm_tokens
  FOR ALL USING (true) WITH CHECK (true);

-- تحديث updated_at تلقائياً
DROP TRIGGER IF EXISTS set_updated_at ON fcm_tokens;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON fcm_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
