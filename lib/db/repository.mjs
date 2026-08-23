import { assembleDataset, bangkokNow } from "../dataset-builder.mjs";
import { RULESET_VERSION } from "../reconciliation.mjs";
import { DOCUMENT_KINDS, codeOfStatementKind, isStatementKind } from "../parsers/documents.mjs";
import { documentSpan, periodOf, periodsOf, statementPeriod } from "../periods.mjs";
import { accountDigits, accountFor } from "../accounts.mjs";

// Reading and writing the canonical rows.
//
// Uploads accumulate. Each one replaces only the periods its own rows cover — a
// re-uploaded July report supersedes July and leaves June and August alone — and
// then a fresh reconciliation run is recorded over everything stored.
//
// The engine still reads every period at once, because money that is received in
// one month and lands in the bank the next can only be reconciled by a pass that
// can see both. Filtering by month is a question the screens ask afterwards.

const bookingColumns = [
  "reservation_no", "channel_reservation_no", "created_at", "created_date", "completed_at", "creator",
  "guest", "mobile", "channel", "status", "room_type", "room_number", "nights",
  "total_satang", "paid_satang", "ar_satang", "balance_due_satang", "payments", "period",
];

const receiptColumns = [
  "id", "source_row", "date", "kind", "method", "amount_satang", "reservation_no",
  "channel_reservation_no", "channel", "guest", "group", "room_type", "room_number",
  "check_in", "check_out", "note", "period",
];

function placeholders(rowCount, columnCount) {
  return Array.from({ length: rowCount }, (_, row) =>
    `(${Array.from({ length: columnCount }, (_, column) => `$${row * columnCount + column + 1}`).join(", ")})`,
  ).join(", ");
}

const quote = (column) => (column === "group" ? '"group"' : column);

async function insertRows(db, table, columns, rows, toValues, chunkSize = 200) {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = chunk.flatMap(toValues);
    await db.query(
      `INSERT INTO clearclose.${table} (${columns.map(quote).join(", ")}) VALUES ${placeholders(chunk.length, columns.length)}`,
      values,
    );
  }
}

/**
 * ลบเฉพาะงวดที่ชุดข้อมูลใหม่ครอบคลุม
 *
 * นี่คือความต่างข้อเดียวที่ทำให้ระบบเก็บได้หลายเดือน: เดิมการอัปโหลดล้างทั้งตาราง
 * ทุกครั้ง เดือนก่อนหน้าจึงหายไปพร้อมกับไฟล์ใหม่ที่ใส่เข้ามา
 */
async function deletePeriods(db, table, periods) {
  if (!periods.length) return;
  const list = periods.map((_, index) => `$${index + 1}`).join(", ");
  await db.query(`DELETE FROM clearclose.${table} WHERE period IN (${list})`, periods);
}

export async function replaceBookings(db, bookings) {
  const rows = bookings.map((booking) => ({ ...booking, period: periodOf(booking.createdDate) }));
  await deletePeriods(db, "bookings", periodsOf(rows.map((row) => row.period)));
  await insertRows(db, "bookings", bookingColumns, rows, (booking) => [
    booking.reservationNo, booking.channelReservationNo, booking.createdAt, booking.createdDate,
    booking.completedAt, booking.creator, booking.guest, booking.mobile, booking.channel, booking.status,
    booking.roomType, booking.roomNumber, booking.nights, booking.totalSatang, booking.paidSatang,
    booking.arSatang, booking.balanceDueSatang, JSON.stringify(booking.payments ?? []), booking.period,
  ]);
  return periodsOf(rows.map((row) => row.period));
}

export async function replaceReceipts(db, receipts) {
  const rows = receipts.map((receipt) => ({ ...receipt, period: periodOf(receipt.date) }));
  await deletePeriods(db, "receipts", periodsOf(rows.map((row) => row.period)));
  await insertRows(db, "receipts", receiptColumns, rows, (receipt) => [
    receipt.id, receipt.sourceRow, receipt.date, receipt.kind, receipt.method, receipt.amountSatang,
    receipt.reservationNo, receipt.channelReservationNo, receipt.channel, receipt.guest, receipt.group,
    receipt.roomType, receipt.roomNumber, receipt.checkIn, receipt.checkOut, receipt.note, receipt.period,
  ]);
  return periodsOf(rows.map((row) => row.period));
}

export async function replaceStatement(db, statement) {
  // หนึ่งบัญชีมี statement ได้เดือนละฉบับ การอัปโหลดรอบใหม่จึงแทนที่เฉพาะรอบนั้น
  const period = statement.period || statementPeriod(statement);
  await db.query("DELETE FROM clearclose.bank_statements WHERE code = $1 AND period = $2", [statement.code, period]);
  await db.query(
    `INSERT INTO clearclose.bank_statements (code, period, method, source, account_no, account_name, branch, reference, cycle, suffix,
       opening_satang, closing_satang, credit_satang, debit_satang, credit_count, debit_count, control_delta_satang)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      statement.code, period, statement.method, statement.source, statement.accountNo, statement.accountName,
      statement.branch, statement.reference, statement.cycle, statement.suffix, statement.openingSatang,
      statement.closingSatang, statement.creditSatang, statement.debitSatang, statement.creditCount,
      statement.debitCount, statement.controlDeltaSatang,
    ],
  );
  await insertRows(
    db,
    "bank_transactions",
    ["id", "statement_code", "statement_period", "period", "date", "time", "description", "channel", "detail", "direction", "amount_satang", "balance_satang", "page", "row_no"],
    statement.lines,
    (line) => [
      line.id, statement.code, period, periodOf(line.date), line.date, line.time, line.description,
      line.channel, line.detail, line.direction, line.amountSatang, line.balanceSatang, line.page, line.row,
    ],
  );
  return [period];
}

/**
 * รหัสบัญชีและช่องทางรับเงินของ statement ฉบับที่เพิ่งอ่านมา
 *
 * เอกสารบอกได้แค่เลขที่บัญชี ส่วนชื่อที่คนที่นี่ใช้เรียกบัญชีนั้น ("885") และ
 * ช่องทางรับเงินใน PMS ("KbankGL885") ไม่มีอยู่ในเอกสารทั้งคู่ ลำดับการหาจึงเป็น:
 *
 *   1. การตั้งค่า — ผู้ใช้ผูกไว้เอง เป็นคำตอบที่ชัดเจนที่สุด
 *   2. บัญชีเดียวกันที่เคยอัปโหลดไว้แล้ว — ระบบจำจากข้อมูลของตัวเอง อัปโหลดรอบใหม่
 *      จึงไม่กลายเป็นบัญชีใบใหม่ และเอกสารที่เข้าระบบไว้ก่อนหน้านี้ไม่พัง
 *   3. ยังไม่รู้จัก — ใช้เลขท้ายบัญชีเป็นรหัส และเว้นช่องทางไว้ให้คนมาผูก
 */
export async function resolveAccount(db, statement, accounts = []) {
  const configured = accountFor(accounts, statement);
  if (configured?.method) {
    return { code: configured.code || statement.suffix, method: configured.method, source: "settings" };
  }

  const digits = accountDigits(statement.accountNo);
  if (digits) {
    const [known] = await db.query(
      String.raw`SELECT code, method FROM clearclose.bank_statements WHERE regexp_replace(account_no, '\D', '', 'g') = $1 AND method <> '' LIMIT 1`,
      [digits],
    );
    if (known) return { code: known.code, method: known.method, source: "history" };
  }

  return { code: statement.suffix, method: "", source: "unknown" };
}

export async function recordDocument(db, document) {
  const span = documentSpan(document.periods ?? [document.period].filter(Boolean));
  await db.query("DELETE FROM clearclose.documents WHERE kind = $1 AND period = $2", [document.kind, span.period]);
  await db.query(
    `INSERT INTO clearclose.documents (id, kind, period, period_start, period_end, name, sha256, size_bytes, row_count, uploaded_by, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      document.id, document.kind, span.period, span.periodStart, span.periodEnd, document.name,
      document.sha256, document.sizeBytes, document.rowCount, document.uploadedBy, bangkokNow(),
    ],
  );
  return span;
}

/**
 * เก็บไฟล์ต้นฉบับไว้ด้วย เพื่อให้ย้อนกลับไปดูเอกสารที่ตัวเลขงวดนั้นมาจากได้จริง
 * เป็น base64 เพราะ driver ของ Neon คุยผ่าน HTTP ไม่ใช่ binary protocol
 */
export async function saveDocumentFile(db, documentId, file) {
  await db.query(
    `INSERT INTO clearclose.document_files (document_id, file_name, content_type, size_bytes, content_b64, stored_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (document_id) DO UPDATE SET
       file_name = EXCLUDED.file_name, content_type = EXCLUDED.content_type,
       size_bytes = EXCLUDED.size_bytes, content_b64 = EXCLUDED.content_b64, stored_at = EXCLUDED.stored_at`,
    [documentId, file.name, file.contentType, file.sizeBytes, file.contentBase64, bangkokNow()],
  );
}

export async function loadDocumentFile(db, documentId) {
  const [row] = await db.query(
    "SELECT file_name, content_type, size_bytes, content_b64 FROM clearclose.document_files WHERE document_id = $1",
    [documentId],
  );
  if (!row) return null;
  return {
    name: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    contentBase64: row.content_b64,
  };
}

export async function recordAudit(db, action, entityType, entityId, detail) {
  await db.query(
    "INSERT INTO clearclose.audit_events (actor, action, entity_type, entity_id, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    ["web", action, entityType, entityId, JSON.stringify(detail ?? {}), bangkokNow()],
  );
}

// ── งวดที่มีอยู่ในระบบ ───────────────────────────────────────────────────────

/**
 * ทุกงวดที่มีข้อมูลอยู่ พร้อมจำนวนของแต่ละฝั่ง — ตัวกรองงวดบนหน้าจออ่านตัวนี้
 * ทำเป็นคำสั่งเดียวเพราะทุก round trip ไป Neon คือเวลาที่ผู้ใช้รอหน้าจอ
 */
export async function listPeriods(db) {
  const rows = await db.query(`
    SELECT period, sum(receipts)::int AS receipts, sum(bookings)::int AS bookings,
           sum(bank_lines)::int AS bank_lines, sum(receipt_satang)::bigint AS receipt_satang
      FROM (
        SELECT period, count(*) AS receipts, 0 AS bookings, 0 AS bank_lines, sum(amount_satang) AS receipt_satang
          FROM clearclose.receipts WHERE period <> '' GROUP BY period
        UNION ALL
        SELECT period, 0, count(*), 0, 0 FROM clearclose.bookings WHERE period <> '' GROUP BY period
        UNION ALL
        SELECT period, 0, 0, count(*), 0 FROM clearclose.bank_transactions WHERE period <> '' GROUP BY period
      ) AS combined
     GROUP BY period
     ORDER BY period DESC
  `);
  return rows.map((row) => ({
    period: row.period,
    receipts: Number(row.receipts),
    bookings: Number(row.bookings),
    bankLines: Number(row.bank_lines),
    receiptSatang: Number(row.receipt_satang),
  }));
}

// ── การประกอบชุดข้อมูล ───────────────────────────────────────────────────────

/** Every canonical row currently stored, in the shape the engine reads. */
async function loadCanonical(db) {
  const [bookings, receipts, statements, sources] = await Promise.all([
    loadBookings(db),
    loadReceipts(db),
    loadStatements(db),
    loadSources(db),
  ]);
  return { bookings, receipts, statements, sources };
}

async function loadSources(db) {
  const rows = await db.query(
    "SELECT kind, name, row_count, period, period_start, period_end FROM clearclose.documents ORDER BY period DESC, kind ASC",
  );

  // ชนิดของ statement เป็น "statement" ต่อด้วยรหัสบัญชี ซึ่งเปิดรับบัญชีใหม่ได้
  // ไม่จำกัด การแปลงชื่อจึงต้องคำนวณ ไม่ใช่ตารางที่เขียนบัญชีไว้ล่วงหน้า
  const displayKind = (kind) => {
    if (kind === "ledger") return "ledger";
    if (kind === "collection") return "collection_report";
    return isStatementKind(kind) ? `bank_statement_${codeOfStatementKind(kind)}` : kind;
  };
  const displayLabel = (kind) => {
    if (DOCUMENT_KINDS[kind]) return DOCUMENT_KINDS[kind].label;
    return isStatementKind(kind) ? `Statement บัญชี ${codeOfStatementKind(kind)}` : kind;
  };

  return rows.map((row) => ({
    kind: displayKind(row.kind),
    label: displayLabel(row.kind),
    name: row.name,
    rows: Number(row.row_count),
    period: row.period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
  }));
}

/** Rebuilds the dataset from everything stored and records the run. */
export async function runReconciliation(db) {
  const canonical = await loadCanonical(db);
  const dataset = assembleDataset(canonical);
  const id = `RUN-${Date.now().toString(36).toUpperCase()}`;

  await db.query(
    `INSERT INTO clearclose.reconciliation_runs (id, period, scope_periods, ruleset_version, created_at, summary, dataset)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id, dataset.meta.period, JSON.stringify(dataset.meta.periods), dataset.meta.rulesetVersion,
      dataset.meta.generatedAt, JSON.stringify(dataset.reconciliation.summary), JSON.stringify(dataset),
    ],
  );
  await pruneRunSnapshots(db);
  await recordAudit(db, "RECONCILIATION_RUN", "run", id, {
    ...dataset.reconciliation.summary,
    periods: dataset.meta.periods,
  });
  return { id, dataset };
}

const SNAPSHOTS_KEPT = 12;

/**
 * เก็บภาพเต็มของชุดข้อมูลไว้เฉพาะรอบล่าสุด ๆ
 *
 * ภาพเต็มมีไว้ให้เปิดย้อนดูว่าเครื่องมือเห็นอะไรในวันนั้น แต่เมื่อฐานข้อมูลเก็บ
 * หลายเดือน ภาพหนึ่งใบก็ใหญ่ขึ้นตามจำนวนเดือน สรุปตัวเลขกับ audit ยังอยู่ครบทุก
 * รอบไม่มีวันหมดอายุ หายไปแค่ภาพเต็มของรอบเก่า
 */
async function pruneRunSnapshots(db) {
  await db.query(
    `UPDATE clearclose.reconciliation_runs SET dataset = ''
      WHERE dataset <> '' AND id NOT IN (
        SELECT id FROM clearclose.reconciliation_runs ORDER BY created_at DESC LIMIT ${SNAPSHOTS_KEPT}
      )`,
  );
}

async function loadBookings(db) {
  const rows = await db.query("SELECT * FROM clearclose.bookings ORDER BY created_at DESC");
  return rows.map((row) => ({
    reservationNo: row.reservation_no,
    channelReservationNo: row.channel_reservation_no,
    createdAt: row.created_at,
    createdDate: row.created_date,
    completedAt: row.completed_at,
    creator: row.creator,
    guest: row.guest,
    mobile: row.mobile,
    channel: row.channel,
    status: row.status,
    roomType: row.room_type,
    roomNumber: row.room_number,
    nights: Number(row.nights),
    totalSatang: Number(row.total_satang),
    paidSatang: Number(row.paid_satang),
    arSatang: Number(row.ar_satang),
    balanceDueSatang: Number(row.balance_due_satang),
    payments: JSON.parse(row.payments),
  }));
}

async function loadReceipts(db) {
  const rows = await db.query('SELECT * FROM clearclose.receipts ORDER BY date DESC, id ASC');
  return rows.map((row) => ({
    id: row.id,
    sourceRow: Number(row.source_row),
    date: row.date,
    kind: row.kind,
    method: row.method,
    amountSatang: Number(row.amount_satang),
    reservationNo: row.reservation_no,
    channelReservationNo: row.channel_reservation_no,
    channel: row.channel,
    guest: row.guest,
    group: row.group,
    roomType: row.room_type,
    roomNumber: row.room_number,
    checkIn: row.check_in,
    checkOut: row.check_out,
    note: row.note,
  }));
}

/** Every stored statement, each with its own lines — one per account per period. */
async function loadStatements(db) {
  const heads = await db.query("SELECT * FROM clearclose.bank_statements ORDER BY code, period");
  if (!heads.length) return [];

  const lines = await db.query("SELECT * FROM clearclose.bank_transactions ORDER BY statement_code, statement_period, page, row_no");
  const byStatement = new Map();
  for (const line of lines) {
    const key = `${line.statement_code}|${line.statement_period}`;
    const list = byStatement.get(key) ?? [];
    list.push(line);
    byStatement.set(key, list);
  }

  return heads.map((head) => ({
    code: head.code,
    period: head.period,
    method: head.method,
    source: head.source,
    accountNo: head.account_no,
    accountName: head.account_name,
    branch: head.branch,
    reference: head.reference,
    cycle: head.cycle,
    suffix: head.suffix,
    openingSatang: Number(head.opening_satang),
    closingSatang: Number(head.closing_satang),
    creditSatang: Number(head.credit_satang),
    debitSatang: Number(head.debit_satang),
    creditCount: Number(head.credit_count),
    debitCount: Number(head.debit_count),
    controlDeltaSatang: Number(head.control_delta_satang),
    lines: (byStatement.get(`${head.code}|${head.period}`) ?? []).map((line) => ({
      id: line.id,
      date: line.date,
      time: line.time,
      description: line.description,
      channel: line.channel,
      detail: line.detail,
      direction: line.direction,
      amountSatang: Number(line.amount_satang),
      balanceSatang: Number(line.balance_satang),
      page: Number(line.page),
      row: Number(line.row_no),
    })),
  }));
}

/**
 * ภาพที่บันทึกไว้ใช้แสดงผลได้ไหม
 *
 * ภาพเต็มถูกเขียนตอนกระทบยอดเสร็จ มันจึงเป็นผลของ "โค้ดเวอร์ชันที่เขียนมันไว้"
 * ไม่ใช่เวอร์ชันที่กำลังรันอยู่ พอ deploy รุ่นใหม่ทับ ภาพเก่าจะยังถูกเสิร์ฟต่อจนกว่า
 * จะมีคนอัปโหลดอะไรสักอย่าง — หน้าจอเลยแสดงตัวเลขที่กฎรุ่นเก่าคำนวณ และไม่มีสนาม
 * ที่รุ่นใหม่ต้องใช้ อาการคือข้อมูลอยู่ครบในตารางแต่หน้าจอทำเหมือนไม่มีงวด
 */
const snapshotIsCurrent = (dataset) =>
  Boolean(dataset)
  && Array.isArray(dataset.meta?.periods)
  && dataset.reconciliation?.rulesetVersion === RULESET_VERSION;

/**
 * The dataset the UI should render: the latest recorded run.
 *
 * A snapshot left behind by an older deploy is not shown. The rows are still
 * there, so the run is redone from them and recorded — once — and every later
 * request reads the fresh snapshot at full speed. Nobody has to re-upload a
 * month to get the current rules applied to it.
 */
export async function latestDataset(db) {
  const [row] = await db.query(
    "SELECT dataset FROM clearclose.reconciliation_runs WHERE dataset <> '' ORDER BY created_at DESC LIMIT 1",
  );
  const stored = row ? (typeof row.dataset === "string" ? JSON.parse(row.dataset) : row.dataset) : null;
  if (snapshotIsCurrent(stored)) return stored;

  // ไม่มีแถวต้นทางเลยก็ไม่มีอะไรให้คำนวณ — คืน null ให้หน้าจอบอกว่ายังไม่มีข้อมูล
  const [{ total }] = await db.query("SELECT count(*)::int AS total FROM clearclose.receipts");
  if (!Number(total)) return stored;

  const { dataset } = await runReconciliation(db);
  await recordAudit(db, "SNAPSHOT_REBUILT", "run", dataset.meta.period, {
    reason: stored ? "ภาพที่บันทึกไว้มาจากกฎรุ่นก่อน" : "ยังไม่เคยบันทึกภาพไว้",
    previousRulesetVersion: stored?.reconciliation?.rulesetVersion ?? null,
    rulesetVersion: dataset.meta.rulesetVersion,
  });
  return dataset;
}

export async function storedDocuments(db) {
  return db.query(`
    SELECT d.id, d.kind, d.period, d.period_start, d.period_end, d.name, d.sha256,
           d.size_bytes, d.row_count, d.uploaded_at,
           (f.document_id IS NOT NULL) AS has_file
      FROM clearclose.documents d
      LEFT JOIN clearclose.document_files f ON f.document_id = d.id
     ORDER BY d.period DESC, d.kind ASC
  `);
}

// ── การตัดสินใจของผู้ตรวจ ────────────────────────────────────────────────────
//
// เก็บแยกจาก reconciliation_runs โดยตั้งใจ: อัปโหลดเอกสารใหม่ทับของเดิมได้
// โดยไม่ลบสิ่งที่คนเคยตัดสินใจไว้ ถ้าแถวที่อ้างถึงหายไปจริง engine จะรายงานว่า
// การตัดสินใจนั้นใช้ไม่ได้แล้ว แทนที่จะเงียบหาย

const decisionFromRow = (row) => ({
  id: row.id,
  kind: row.kind,
  receiptIds: JSON.parse(row.receipt_ids),
  bankLineIds: JSON.parse(row.bank_line_ids),
  receiptSatang: Number(row.receipt_satang),
  bankSatang: Number(row.bank_satang),
  differenceSatang: Number(row.difference_satang),
  reason: row.reason,
  note: row.note,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
});

export async function listDecisions(db) {
  const rows = await db.query("SELECT * FROM clearclose.match_decisions ORDER BY decided_at ASC, id ASC");
  return rows.map(decisionFromRow);
}

export async function saveDecision(db, decision) {
  const id = decision.id || `DEC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const decidedAt = decision.decidedAt || bangkokNow();
  await db.query(
    `INSERT INTO clearclose.match_decisions
       (id, kind, receipt_ids, bank_line_ids, receipt_satang, bank_satang, difference_satang, reason, note, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
       kind = EXCLUDED.kind, receipt_ids = EXCLUDED.receipt_ids, bank_line_ids = EXCLUDED.bank_line_ids,
       receipt_satang = EXCLUDED.receipt_satang, bank_satang = EXCLUDED.bank_satang,
       difference_satang = EXCLUDED.difference_satang, reason = EXCLUDED.reason, note = EXCLUDED.note,
       decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at`,
    [
      id, decision.kind ?? "MANUAL", JSON.stringify(decision.receiptIds ?? []), JSON.stringify(decision.bankLineIds ?? []),
      decision.receiptSatang ?? 0, decision.bankSatang ?? 0, decision.differenceSatang ?? 0,
      decision.reason ?? "OTHER", decision.note ?? "", decision.decidedBy ?? "web", decidedAt,
    ],
  );
  await recordAudit(db, "DECISION_SAVED", "decision", id, {
    kind: decision.kind, reason: decision.reason,
    receipts: decision.receiptIds?.length ?? 0, lines: decision.bankLineIds?.length ?? 0,
    differenceSatang: decision.differenceSatang ?? 0,
  });
  return { ...decision, id, decidedAt };
}

export async function deleteDecision(db, id) {
  const rows = await db.query("SELECT * FROM clearclose.match_decisions WHERE id = $1", [id]);
  if (!rows.length) return null;
  await db.query("DELETE FROM clearclose.match_decisions WHERE id = $1", [id]);
  await recordAudit(db, "DECISION_REMOVED", "decision", id, decisionFromRow(rows[0]));
  return decisionFromRow(rows[0]);
}

// ── การตั้งค่าที่ใช้ร่วมกันทุกเครื่อง ────────────────────────────────────────

export async function loadStoredSettings(db) {
  const [row] = await db.query("SELECT value FROM clearclose.app_settings WHERE id = 'current'");
  if (!row) return null;
  return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
}

export async function saveStoredSettings(db, settings, actor = "web") {
  const previous = await loadStoredSettings(db);
  await db.query(
    `INSERT INTO clearclose.app_settings (id, value, updated_by, updated_at) VALUES ('current', $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [JSON.stringify(settings), actor, bangkokNow()],
  );
  await recordAudit(db, "SETTINGS_SAVED", "settings", "current", { previous });
  return settings;
}

// ── ใบเสร็จรับเงินของก้อนโอน OTA ─────────────────────────────────────────────
//
// สองข้อบังคับที่ตารางอื่นในระบบไม่มี:
//
//   1. เลขที่เดินต่อกันโดยไม่ข้าม แยกชุดตามเดือนที่รับเงิน
//   2. ใบที่ออกไปแล้วไม่เปลี่ยนตัวเอง — `document` คือสำเนาแช่แข็งของสิ่งที่พิมพ์
//      ออกไปจริง การอ่านใบเก่าจึงไม่แตะข้อมูลต้นทางเลย
//
// การยกเลิกไม่ลบแถวและไม่คืนเลข: ใบที่ถูกยกเลิกยังกินเลขของมันไว้ตลอดไป

const issuedReceiptFromRow = (row) => ({
  id: row.id,
  number: row.number,
  series: row.series,
  sequence: Number(row.sequence),
  decisionId: row.decision_id,
  providerId: row.provider_id,
  payerName: row.payer_name,
  date: row.issued_date,
  period: row.period,
  grossSatang: Number(row.gross_satang),
  deductionSatang: Number(row.deduction_satang),
  netSatang: Number(row.net_satang),
  receiptIds: JSON.parse(row.receipt_ids),
  bankLineIds: JSON.parse(row.bank_line_ids),
  document: typeof row.document === "string" ? JSON.parse(row.document) : row.document,
  issuedBy: row.issued_by,
  issuedAt: row.issued_at,
  voidedAt: row.voided_at,
  voidReason: row.void_reason,
});

export async function listIssuedReceipts(db) {
  const rows = await db.query(
    "SELECT * FROM clearclose.issued_receipts ORDER BY series DESC, sequence DESC",
  );
  return rows.map(issuedReceiptFromRow);
}

export async function findIssuedReceipt(db, number) {
  const [row] = await db.query("SELECT * FROM clearclose.issued_receipts WHERE number = $1", [number]);
  return row ? issuedReceiptFromRow(row) : null;
}

const UNIQUE_VIOLATION = /duplicate key|unique constraint|UNIQUE/i;

/**
 * ออกใบเสร็จหนึ่งใบ แล้วคืนใบที่ออกจริง
 *
 * เลขถูกจองในคำสั่งเดียวกับที่เขียนแถว: `MAX(sequence) + 1` ถูกคำนวณจากในคำสั่ง
 * INSERT เอง ไม่ใช่อ่านมาก่อนแล้วค่อยเขียน ถึงอย่างนั้นสองคำขอที่มาพร้อมกันก็ยัง
 * อ่าน MAX เดียวกันได้ภายใต้ READ COMMITTED ตัวที่กันจริงคือ UNIQUE (series,
 * sequence) — ตัวที่มาทีหลังจะชนแล้วถูกลองใหม่ ได้เลขถัดไป
 *
 * ทางเลือกที่ "สะอาดกว่า" คือ sequence ของ Postgres แต่มันข้ามเลขเมื่อ transaction
 * ถูก rollback ซึ่งใช้กับสมุดเลขที่เอกสารไม่ได้
 */
export async function issueReceipt(db, { document, series, decisionId, actor = "web" }) {
  const issuedAt = bangkokNow();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [next] = await db.query(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM clearclose.issued_receipts WHERE series = $1",
      [series],
    );
    const sequence = Number(next.sequence);
    const number = `${series}-${String(sequence).padStart(4, "0")}`;
    const id = `RCPT-${series}-${String(sequence).padStart(4, "0")}`;
    const stamped = { ...document, number, issuedAt, issuedBy: actor };

    try {
      await db.query(
        `INSERT INTO clearclose.issued_receipts
           (id, number, series, sequence, decision_id, provider_id, payer_name, issued_date, period,
            gross_satang, deduction_satang, net_satang, receipt_ids, bank_line_ids, document, issued_by, issued_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          id, number, series, sequence, decisionId,
          stamped.payer?.providerId ?? "", stamped.payer?.name ?? "",
          stamped.date, stamped.period,
          stamped.grossSatang, stamped.deductionSatang, stamped.netSatang,
          JSON.stringify(stamped.reconciliation?.receiptIds ?? []),
          JSON.stringify(stamped.payment?.bankLineIds ?? []),
          JSON.stringify(stamped), actor, issuedAt,
        ],
      );
    } catch (error) {
      // ชนเลขเพราะมีคนออกใบพร้อมกัน — ลองใหม่ได้ ส่วนการชนที่ decision_id แปลว่า
      // ก้อนนี้มีใบที่ยังใช้ได้อยู่แล้ว ซึ่งลองใหม่กี่ครั้งก็ชนเหมือนเดิม
      const message = String(error?.message ?? "");
      if (UNIQUE_VIOLATION.test(message) && !message.includes("idx_issued_receipts_live")) continue;
      if (message.includes("idx_issued_receipts_live")) {
        throw new Error("ก้อนโอนนี้ออกใบเสร็จไปแล้ว — ยกเลิกใบเดิมก่อนถึงจะออกใบใหม่ได้");
      }
      throw error;
    }

    await recordAudit(db, "RECEIPT_ISSUED", "issued_receipt", number, {
      decisionId, netSatang: stamped.netSatang, payer: stamped.payer?.name ?? "",
    });
    return findIssuedReceipt(db, number);
  }

  throw new Error("จองเลขที่ใบเสร็จไม่สำเร็จ มีคนออกใบพร้อมกันหลายคน ลองอีกครั้ง");
}

/** ยกเลิกใบ — แถวยังอยู่ เลขยังถูกใช้ไปแล้ว และเหตุผลถูกบันทึกไว้เสมอ */
export async function voidReceipt(db, number, reason, actor = "web") {
  const existing = await findIssuedReceipt(db, number);
  if (!existing) return null;
  if (existing.voidedAt) return existing;

  await db.query(
    "UPDATE clearclose.issued_receipts SET voided_at = $2, void_reason = $3 WHERE number = $1",
    [number, bangkokNow(), reason],
  );
  await recordAudit(db, "RECEIPT_VOIDED", "issued_receipt", number, { reason, actor });
  return findIssuedReceipt(db, number);
}
