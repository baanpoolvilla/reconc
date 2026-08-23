-- ไฟล์นี้ถูกสร้างจาก lib/db/schema.mjs — อย่าแก้ตรงนี้
-- แก้ที่ schema.mjs แล้วสั่ง: npm run schema
--
-- migration: 004-line-holds
--
-- ระบบรัน migration ให้เองตอนมีคำขอแรกเข้ามา ไฟล์นี้มีไว้ให้รันเองล่วงหน้า
-- หรือเอาไปตรวจเทียบกับฐานข้อมูลจริง รันซ้ำได้ไม่เสียหาย ทุกคำสั่งเป็น IF NOT EXISTS

CREATE TABLE IF NOT EXISTS clearclose.line_holds (
  bank_line_id     text PRIMARY KEY,
  account          text NOT NULL DEFAULT '',
  period           text NOT NULL DEFAULT '',
  line_date        text NOT NULL DEFAULT '',
  amount_satang    bigint NOT NULL DEFAULT 0,
  detail           text NOT NULL DEFAULT '',
  reason           text NOT NULL DEFAULT 'OTHER',
  note             text NOT NULL DEFAULT '',
  expected_period  text NOT NULL DEFAULT '',
  held_by          text NOT NULL DEFAULT 'web',
  held_at          text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_line_holds_period ON clearclose.line_holds (period);

CREATE INDEX IF NOT EXISTS idx_line_holds_expected ON clearclose.line_holds (expected_period);

-- บันทึกว่า migration นี้ถูกรันแล้ว ตัวรันในระบบทำบรรทัดนี้ให้เองเสมอ
-- ถ้ารันไฟล์นี้เองต้องรันบรรทัดนี้ด้วย ไม่งั้นระบบจะรันซ้ำ (ซึ่งไม่เสียหาย แต่ไม่จำเป็น)
INSERT INTO clearclose.schema_migrations (id, applied_at)
VALUES ('004-line-holds', to_char(now() + interval '7 hours', 'YYYY-MM-DD"T"HH24:MI:SS'))
ON CONFLICT (id) DO NOTHING;
