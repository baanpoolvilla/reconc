-- ไฟล์นี้ถูกสร้างจาก lib/db/schema.mjs — อย่าแก้ตรงนี้
-- แก้ที่ schema.mjs แล้วสั่ง: npm run schema
--
-- migration: 002-periods
--
-- ระบบรัน migration ให้เองตอนมีคำขอแรกเข้ามา ไฟล์นี้มีไว้ให้รันเองล่วงหน้า
-- หรือเอาไปตรวจเทียบกับฐานข้อมูลจริง รันซ้ำได้ไม่เสียหาย ทุกคำสั่งเป็น IF NOT EXISTS

ALTER TABLE clearclose.bookings ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '';

UPDATE clearclose.bookings SET period = substr(created_date, 1, 7)
 WHERE period = '' AND created_date ~ '^[0-9]{4}-[0-9]{2}';

CREATE INDEX IF NOT EXISTS idx_bookings_period ON clearclose.bookings (period);

ALTER TABLE clearclose.receipts ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '';

UPDATE clearclose.receipts SET period = substr(date, 1, 7)
 WHERE period = '' AND date ~ '^[0-9]{4}-[0-9]{2}';

CREATE INDEX IF NOT EXISTS idx_receipts_period ON clearclose.receipts (period);

ALTER TABLE clearclose.bank_statements ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '';

-- รอบบนหน้า statement พิมพ์เป็น "01/07/2026 - 31/07/2026" ปีเป็น ค.ศ. เต็ม
UPDATE clearclose.bank_statements SET period = substr(cycle, 7, 4) || '-' || substr(cycle, 4, 2)
 WHERE period = '' AND cycle ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}';

UPDATE clearclose.bank_statements s SET period = COALESCE(
   (SELECT min(substr(t.date, 1, 7)) FROM clearclose.bank_transactions t WHERE t.statement_code = s.code), '')
 WHERE s.period = '';

ALTER TABLE clearclose.bank_transactions ADD COLUMN IF NOT EXISTS statement_period text NOT NULL DEFAULT '';

UPDATE clearclose.bank_transactions t SET statement_period = s.period
  FROM clearclose.bank_statements s
 WHERE t.statement_code = s.code AND t.statement_period = '';

-- งวดของบรรทัดคือเดือนของตัวมันเอง ไม่ใช่ของ statement: รอบที่คร่อมเดือนจึง
-- ฟิลเตอร์ได้ถูกต้อง ส่วน statement_period มีไว้ชี้กลับไปที่หัวเอกสารเท่านั้น
ALTER TABLE clearclose.bank_transactions ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '';

UPDATE clearclose.bank_transactions SET period = substr(date, 1, 7)
 WHERE period = '' AND date ~ '^[0-9]{4}-[0-9]{2}';

CREATE INDEX IF NOT EXISTS idx_bank_transactions_period ON clearclose.bank_transactions (period);

ALTER TABLE clearclose.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_statement_code_fkey;

ALTER TABLE clearclose.bank_statements DROP CONSTRAINT IF EXISTS bank_statements_pkey;

ALTER TABLE clearclose.bank_statements ADD CONSTRAINT bank_statements_pkey PRIMARY KEY (code, period);

ALTER TABLE clearclose.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_statement_fkey;

ALTER TABLE clearclose.bank_transactions ADD CONSTRAINT bank_transactions_statement_fkey
  FOREIGN KEY (statement_code, statement_period)
  REFERENCES clearclose.bank_statements (code, period) ON DELETE CASCADE;

ALTER TABLE clearclose.documents ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '';
ALTER TABLE clearclose.documents ADD COLUMN IF NOT EXISTS period_start text NOT NULL DEFAULT '';
ALTER TABLE clearclose.documents ADD COLUMN IF NOT EXISTS period_end text NOT NULL DEFAULT '';

-- เอกสารที่อัปโหลดไว้ก่อนมีคอลัมน์งวด: เดาจากแถวที่มันสร้างไว้ ไม่ต้องอัปโหลดซ้ำ
UPDATE clearclose.documents d SET period = COALESCE((SELECT min(period) FROM clearclose.bookings WHERE period <> ''), '')
 WHERE d.kind = 'ledger' AND d.period = '';

UPDATE clearclose.documents d SET period = COALESCE((SELECT min(period) FROM clearclose.receipts WHERE period <> ''), '')
 WHERE d.kind = 'collection' AND d.period = '';

UPDATE clearclose.documents d SET period = COALESCE(
   (SELECT min(s.period) FROM clearclose.bank_statements s WHERE 'statement' || s.code = d.kind), '')
 WHERE d.kind LIKE 'statement%' AND d.period = '';

UPDATE clearclose.documents SET period_start = period WHERE period_start = '';
UPDATE clearclose.documents SET period_end = period WHERE period_end = '';

-- หนึ่งเอกสารต่อหนึ่งชนิดต่อหนึ่งงวด — อัปโหลดงวดเดิมซ้ำแทนที่ของเดิม
-- อัปโหลดงวดใหม่เพิ่มเข้าไปโดยไม่แตะของเดือนก่อน
ALTER TABLE clearclose.documents DROP CONSTRAINT IF EXISTS documents_kind_sha256_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_kind_period ON clearclose.documents (kind, period);

-- ไฟล์ต้นฉบับที่อัปโหลดเข้ามา เก็บเป็น base64 ในตารางของตัวเอง เพื่อให้ตาราง
-- documents ยังเบาพอที่จะ list ได้เร็ว สี่ไฟล์ต่อเดือนรวมกันไม่ถึงหนึ่งเมกะไบต์
CREATE TABLE IF NOT EXISTS clearclose.document_files (
  document_id   text PRIMARY KEY REFERENCES clearclose.documents (id) ON DELETE CASCADE,
  file_name     text NOT NULL,
  content_type  text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes    integer NOT NULL DEFAULT 0,
  content_b64   text NOT NULL,
  stored_at     text NOT NULL
);

-- งวดทั้งหมดที่รอบนี้มองเห็น เก็บไว้เพราะการกระทบยอดข้ามเดือนอ่านข้อมูลมากกว่า
-- หนึ่งงวด และรายงานต้องบอกได้ว่าตัวเลขชุดนั้นมาจากช่วงไหน
ALTER TABLE clearclose.reconciliation_runs ADD COLUMN IF NOT EXISTS scope_periods text NOT NULL DEFAULT '[]';

-- บันทึกว่า migration นี้ถูกรันแล้ว ตัวรันในระบบทำบรรทัดนี้ให้เองเสมอ
-- ถ้ารันไฟล์นี้เองต้องรันบรรทัดนี้ด้วย ไม่งั้นระบบจะรันซ้ำ (ซึ่งไม่เสียหาย แต่ไม่จำเป็น)
INSERT INTO clearclose.schema_migrations (id, applied_at)
VALUES ('002-periods', to_char(now() + interval '7 hours', 'YYYY-MM-DD"T"HH24:MI:SS'))
ON CONFLICT (id) DO NOTHING;
