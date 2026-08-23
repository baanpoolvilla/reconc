-- ไฟล์นี้ถูกสร้างจาก lib/db/schema.mjs — อย่าแก้ตรงนี้
-- แก้ที่ schema.mjs แล้วสั่ง: npm run schema
--
-- migration: 001-base
--
-- ระบบรัน migration ให้เองตอนมีคำขอแรกเข้ามา ไฟล์นี้มีไว้ให้รันเองล่วงหน้า
-- หรือเอาไปตรวจเทียบกับฐานข้อมูลจริง รันซ้ำได้ไม่เสียหาย ทุกคำสั่งเป็น IF NOT EXISTS

CREATE SCHEMA IF NOT EXISTS clearclose;

-- ClearClose canonical schema.
-- Money is always integer satang; never a float. Dates that come off an
-- accounting document stay `text` in ISO form so a timezone can never shift
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

-- บันทึกว่า migration นี้ถูกรันแล้ว ตัวรันในระบบทำบรรทัดนี้ให้เองเสมอ
-- ถ้ารันไฟล์นี้เองต้องรันบรรทัดนี้ด้วย ไม่งั้นระบบจะรันซ้ำ (ซึ่งไม่เสียหาย แต่ไม่จำเป็น)
INSERT INTO clearclose.schema_migrations (id, applied_at)
VALUES ('001-base', to_char(now() + interval '7 hours', 'YYYY-MM-DD"T"HH24:MI:SS'))
ON CONFLICT (id) DO NOTHING;
