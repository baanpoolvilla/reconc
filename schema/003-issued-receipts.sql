-- ไฟล์นี้ถูกสร้างจาก lib/db/schema.mjs — อย่าแก้ตรงนี้
-- แก้ที่ schema.mjs แล้วสั่ง: npm run schema
--
-- migration: 003-issued-receipts
--
-- ระบบรัน migration ให้เองตอนมีคำขอแรกเข้ามา ไฟล์นี้มีไว้ให้รันเองล่วงหน้า
-- หรือเอาไปตรวจเทียบกับฐานข้อมูลจริง รันซ้ำได้ไม่เสียหาย ทุกคำสั่งเป็น IF NOT EXISTS

CREATE TABLE IF NOT EXISTS clearclose.issued_receipts (
  id             text PRIMARY KEY,
  number         text NOT NULL UNIQUE,
  series         text NOT NULL,
  sequence       integer NOT NULL,
  decision_id    text NOT NULL,
  provider_id    text NOT NULL DEFAULT '',
  payer_name     text NOT NULL DEFAULT '',
  issued_date    text NOT NULL,
  period         text NOT NULL DEFAULT '',
  gross_satang   bigint NOT NULL DEFAULT 0,
  deduction_satang bigint NOT NULL DEFAULT 0,
  net_satang     bigint NOT NULL DEFAULT 0,
  receipt_ids    text NOT NULL DEFAULT '[]',
  bank_line_ids  text NOT NULL DEFAULT '[]',
  document       text NOT NULL DEFAULT '{}',
  issued_by      text NOT NULL DEFAULT 'web',
  issued_at      text NOT NULL,
  voided_at      text NOT NULL DEFAULT '',
  void_reason    text NOT NULL DEFAULT '',
  UNIQUE (series, sequence)
);

CREATE INDEX IF NOT EXISTS idx_issued_receipts_series ON clearclose.issued_receipts (series, sequence);

CREATE INDEX IF NOT EXISTS idx_issued_receipts_decision ON clearclose.issued_receipts (decision_id);

-- ก้อนที่กระทบยอดแล้วหนึ่งก้อน มีใบเสร็จที่ยังใช้ได้ได้ใบเดียว ใบที่ถูกยกเลิกแล้ว
-- ไม่กันที่ จึงออกใบใหม่แทนใบที่ผิดได้โดยไม่ต้องแตะเลขเดิม
CREATE UNIQUE INDEX IF NOT EXISTS idx_issued_receipts_live
  ON clearclose.issued_receipts (decision_id) WHERE voided_at = '';

-- บันทึกว่า migration นี้ถูกรันแล้ว ตัวรันในระบบทำบรรทัดนี้ให้เองเสมอ
-- ถ้ารันไฟล์นี้เองต้องรันบรรทัดนี้ด้วย ไม่งั้นระบบจะรันซ้ำ (ซึ่งไม่เสียหาย แต่ไม่จำเป็น)
INSERT INTO clearclose.schema_migrations (id, applied_at)
VALUES ('003-issued-receipts', to_char(now() + interval '7 hours', 'YYYY-MM-DD"T"HH24:MI:SS'))
ON CONFLICT (id) DO NOTHING;
