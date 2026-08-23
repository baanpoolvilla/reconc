// The canonical schema, kept as a string rather than a .sql file: this module is
// bundled into a serverless function, where reading a sibling file at runtime is
// not reliable.
//
// Money is always integer satang; never a float. Dates that come off an accounting
// document stay as ISO text so a timezone can never shift them — the matching rule
// compares calendar days, not instants.
//
// Every object lives in its own schema so ClearClose can share a database with
// other applications without colliding on generic table names.
//
// Changes ship as ordered migrations, each applied at most once and recorded in
// clearclose.schema_migrations. A database that already carries an earlier
// version is upgraded in place — no reload of past months, nothing dropped.

const BASE = `CREATE SCHEMA IF NOT EXISTS clearclose;

-- ClearClose canonical schema.
-- Money is always integer satang; never a float. Dates that come off an
-- accounting document stay \`text\` in ISO form so a timezone can never shift
-- them — the matching rule compares calendar days, not instants.

CREATE TABLE IF NOT EXISTS clearclose.documents (
  id            text PRIMARY KEY,
  kind          text NOT NULL,
  name          text NOT NULL,
  sha256        text NOT NULL,
  size_bytes    integer NOT NULL,
  row_count     integer NOT NULL DEFAULT 0,
  uploaded_by   text NOT NULL DEFAULT 'web',
  uploaded_at   text NOT NULL,
  UNIQUE (kind, sha256)
);

CREATE TABLE IF NOT EXISTS clearclose.bookings (
  reservation_no          text PRIMARY KEY,
  channel_reservation_no  text NOT NULL DEFAULT '',
  created_at              text NOT NULL DEFAULT '',
  created_date            text NOT NULL DEFAULT '',
  completed_at            text NOT NULL DEFAULT '',
  creator                 text NOT NULL DEFAULT '',
  guest                   text NOT NULL DEFAULT '',
  mobile                  text NOT NULL DEFAULT '',
  channel                 text NOT NULL DEFAULT '',
  status                  text NOT NULL DEFAULT '',
  room_type               text NOT NULL DEFAULT '',
  room_number             text NOT NULL DEFAULT '',
  nights                  integer NOT NULL DEFAULT 0,
  total_satang            bigint NOT NULL DEFAULT 0,
  paid_satang             bigint NOT NULL DEFAULT 0,
  ar_satang               bigint NOT NULL DEFAULT 0,
  balance_due_satang      bigint NOT NULL DEFAULT 0,
  payments                text NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_bookings_created_date ON clearclose.bookings (created_date);

CREATE TABLE IF NOT EXISTS clearclose.receipts (
  id                      text PRIMARY KEY,
  source_row              integer NOT NULL DEFAULT 0,
  date                    text NOT NULL,
  kind                    text NOT NULL DEFAULT 'RECEIVE',
  method                  text NOT NULL DEFAULT '',
  amount_satang           bigint NOT NULL DEFAULT 0,
  reservation_no          text NOT NULL DEFAULT '',
  channel_reservation_no  text NOT NULL DEFAULT '',
  channel                 text NOT NULL DEFAULT '',
  guest                   text NOT NULL DEFAULT '',
  "group"                 text NOT NULL DEFAULT '',
  room_type               text NOT NULL DEFAULT '',
  room_number             text NOT NULL DEFAULT '',
  check_in                text NOT NULL DEFAULT '',
  check_out               text NOT NULL DEFAULT '',
  note                    text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_receipts_reservation ON clearclose.receipts (reservation_no);
CREATE INDEX IF NOT EXISTS idx_receipts_method ON clearclose.receipts (method);

CREATE TABLE IF NOT EXISTS clearclose.bank_statements (
  code                  text PRIMARY KEY,
  method                text NOT NULL,
  source                text NOT NULL DEFAULT '',
  account_no            text NOT NULL DEFAULT '',
  account_name          text NOT NULL DEFAULT '',
  branch                text NOT NULL DEFAULT '',
  reference             text NOT NULL DEFAULT '',
  cycle                 text NOT NULL DEFAULT '',
  suffix                text NOT NULL DEFAULT '',
  opening_satang        bigint NOT NULL DEFAULT 0,
  closing_satang        bigint NOT NULL DEFAULT 0,
  credit_satang         bigint NOT NULL DEFAULT 0,
  debit_satang          bigint NOT NULL DEFAULT 0,
  credit_count          integer NOT NULL DEFAULT 0,
  debit_count           integer NOT NULL DEFAULT 0,
  control_delta_satang  bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clearclose.bank_transactions (
  id              text PRIMARY KEY,
  statement_code  text NOT NULL REFERENCES clearclose.bank_statements (code) ON DELETE CASCADE,
  date            text NOT NULL,
  time            text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  channel         text NOT NULL DEFAULT '',
  detail          text NOT NULL DEFAULT '',
  direction       text NOT NULL,
  amount_satang   bigint NOT NULL DEFAULT 0,
  balance_satang  bigint NOT NULL DEFAULT 0,
  page            integer NOT NULL DEFAULT 0,
  row_no          integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON clearclose.bank_transactions (statement_code, date);

-- One reconciliation run per upload. Keeping the resolved dataset alongside the
-- normalised rows lets a review reopen exactly what the engine saw that day,
-- even after a later upload replaces the source rows.
CREATE TABLE IF NOT EXISTS clearclose.reconciliation_runs (
  id               text PRIMARY KEY,
  period           text NOT NULL DEFAULT '',
  ruleset_version  text NOT NULL,
  created_at       text NOT NULL,
  summary          text NOT NULL DEFAULT '{}',
  dataset          text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_created ON clearclose.reconciliation_runs (created_at DESC);

-- What a reviewer decided by hand, which is the one thing in the system that is
-- neither read from a document nor derived by a rule. Kept as its own table so a
-- re-upload of the source documents never destroys it: a decision names row ids,
-- and the engine reports it as stale if those rows stop existing.
CREATE TABLE IF NOT EXISTS clearclose.match_decisions (
  id                 text PRIMARY KEY,
  kind               text NOT NULL DEFAULT 'MANUAL',
  receipt_ids        text NOT NULL DEFAULT '[]',
  bank_line_ids      text NOT NULL DEFAULT '[]',
  receipt_satang     bigint NOT NULL DEFAULT 0,
  bank_satang        bigint NOT NULL DEFAULT 0,
  difference_satang  bigint NOT NULL DEFAULT 0,
  reason             text NOT NULL DEFAULT 'OTHER',
  note               text NOT NULL DEFAULT '',
  decided_by         text NOT NULL DEFAULT 'web',
  decided_at         text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_decisions_decided ON clearclose.match_decisions (decided_at DESC);

-- Settings live on the server so every device sees the same reconciliation.
-- One row, replaced whole; the previous value is kept in audit_events.
CREATE TABLE IF NOT EXISTS clearclose.app_settings (
  id          text PRIMARY KEY,
  value       text NOT NULL,
  updated_by  text NOT NULL DEFAULT 'web',
  updated_at  text NOT NULL
);

CREATE TABLE IF NOT EXISTS clearclose.audit_events (
  id           bigserial PRIMARY KEY,
  actor        text NOT NULL DEFAULT 'web',
  action       text NOT NULL,
  entity_type  text NOT NULL DEFAULT '',
  entity_id    text NOT NULL DEFAULT '',
  detail       text NOT NULL DEFAULT '{}',
  created_at   text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON clearclose.audit_events (created_at DESC);
`;

// ── 002 · งวดบัญชี ───────────────────────────────────────────────────────────
//
// จนถึงรุ่นก่อนหน้านี้ ระบบเก็บได้ครั้งละหนึ่งเดือน เพราะการอัปโหลดล้างทั้งตาราง
// และไม่มีคอลัมน์ไหนบอกว่าแถวเป็นของงวดไหน migration นี้เติมงวดให้ทุกแถว แล้ว
// ย้ายกุญแจของ statement จาก "เลขบัญชี" เป็น "เลขบัญชี + งวด" หนึ่งบัญชีจึงมี
// statement ได้หลายเดือนพร้อมกัน
//
// ข้อมูลที่มีอยู่แล้วถูก backfill จากวันที่ในแถวของตัวเอง ไม่ต้องอัปโหลดซ้ำ

const PERIODS = `ALTER TABLE clearclose.bookings ADD COLUMN IF NOT EXISTS period text NOT NULL DEFAULT '';

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
`;

// ── 003 · ใบเสร็จรับเงินของก้อนโอน OTA ──────────────────────────────────────
//
// เอกสารที่ออกให้คนนอกมีข้อบังคับที่รายงานภายในไม่มี: เลขที่ต้องเดินต่อกันโดยไม่
// ข้าม ใบที่ออกไปแล้วต้องไม่เปลี่ยนตัวเองเมื่อข้อมูลต้นทางเปลี่ยน และใบที่ผิดต้อง
// ถูกยกเลิกอย่างเห็นได้ ไม่ใช่ลบทิ้ง
//
// ตารางนี้จึงเก็บ `document` เป็นสำเนาแช่แข็งของสิ่งที่พิมพ์ออกไปจริง ๆ ไม่ใช่แค่
// ตัวชี้กลับไปที่แถวต้นทาง การอัปโหลดเดือนนั้นใหม่ไม่ทำให้ใบที่ส่งไปแล้วเปลี่ยนตาม
//
// `voided_at` เป็นข้อความว่างเมื่อใบยังใช้ได้ แถวไม่เคยถูกลบ เลขที่ไม่เคยถูกใช้ซ้ำ

const ISSUED_RECEIPTS = `CREATE TABLE IF NOT EXISTS clearclose.issued_receipts (
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
`;

export const MIGRATIONS = [
  { id: "001-base", sql: BASE },
  { id: "002-periods", sql: PERIODS },
  { id: "003-issued-receipts", sql: ISSUED_RECEIPTS },
];

/** The full schema as one script — the shape a fresh database ends up in. */
export const SCHEMA_SQL = MIGRATIONS.map((migration) => migration.sql).join("\n");
