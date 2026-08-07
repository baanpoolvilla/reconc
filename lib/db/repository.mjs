import { bangkokNow, buildDataset } from "../dataset-builder.mjs";
import { DOCUMENT_KINDS } from "../parsers/documents.mjs";

// Reading and writing the canonical rows. Each upload replaces the rows for the
// document it carries — a re-uploaded statement supersedes the previous one
// rather than doubling it — then a fresh reconciliation run is recorded.

const bookingColumns = [
  "reservation_no", "channel_reservation_no", "created_at", "created_date", "completed_at", "creator",
  "guest", "mobile", "channel", "status", "room_type", "room_number", "nights",
  "total_satang", "paid_satang", "ar_satang", "balance_due_satang", "payments",
];

const receiptColumns = [
  "id", "source_row", "date", "kind", "method", "amount_satang", "reservation_no",
  "channel_reservation_no", "channel", "guest", "group", "room_type", "room_number",
  "check_in", "check_out", "note",
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

export async function replaceBookings(db, bookings) {
  await db.query("DELETE FROM clearclose.bookings");
  await insertRows(db, "bookings", bookingColumns, bookings, (booking) => [
    booking.reservationNo, booking.channelReservationNo, booking.createdAt, booking.createdDate,
    booking.completedAt, booking.creator, booking.guest, booking.mobile, booking.channel, booking.status,
    booking.roomType, booking.roomNumber, booking.nights, booking.totalSatang, booking.paidSatang,
    booking.arSatang, booking.balanceDueSatang, JSON.stringify(booking.payments ?? []),
  ]);
}

export async function replaceReceipts(db, receipts) {
  await db.query("DELETE FROM clearclose.receipts");
  await insertRows(db, "receipts", receiptColumns, receipts, (receipt) => [
    receipt.id, receipt.sourceRow, receipt.date, receipt.kind, receipt.method, receipt.amountSatang,
    receipt.reservationNo, receipt.channelReservationNo, receipt.channel, receipt.guest, receipt.group,
    receipt.roomType, receipt.roomNumber, receipt.checkIn, receipt.checkOut, receipt.note,
  ]);
}

export async function replaceStatement(db, statement) {
  await db.query("DELETE FROM clearclose.bank_statements WHERE code = $1", [statement.code]);
  await db.query(
    `INSERT INTO clearclose.bank_statements (code, method, source, account_no, account_name, branch, reference, cycle, suffix,
       opening_satang, closing_satang, credit_satang, debit_satang, credit_count, debit_count, control_delta_satang)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      statement.code, statement.method, statement.source, statement.accountNo, statement.accountName,
      statement.branch, statement.reference, statement.cycle, statement.suffix, statement.openingSatang,
      statement.closingSatang, statement.creditSatang, statement.debitSatang, statement.creditCount,
      statement.debitCount, statement.controlDeltaSatang,
    ],
  );
  await insertRows(
    db,
    "bank_transactions",
    ["id", "statement_code", "date", "time", "description", "channel", "detail", "direction", "amount_satang", "balance_satang", "page", "row_no"],
    statement.lines,
    (line) => [
      line.id, statement.code, line.date, line.time, line.description, line.channel, line.detail,
      line.direction, line.amountSatang, line.balanceSatang, line.page, line.row,
    ],
  );
}

export async function recordDocument(db, document) {
  await db.query("DELETE FROM clearclose.documents WHERE kind = $1", [document.kind]);
  await db.query(
    `INSERT INTO clearclose.documents (id, kind, name, sha256, size_bytes, row_count, uploaded_by, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [document.id, document.kind, document.name, document.sha256, document.sizeBytes, document.rowCount, document.uploadedBy, bangkokNow()],
  );
}

export async function recordAudit(db, action, entityType, entityId, detail) {
  await db.query(
    "INSERT INTO clearclose.audit_events (actor, action, entity_type, entity_id, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    ["web", action, entityType, entityId, JSON.stringify(detail ?? {}), bangkokNow()],
  );
}

/** Rebuilds the dataset from whatever is currently stored and records the run. */
export async function runReconciliation(db) {
  const documents = await loadDocuments(db);
  const dataset = buildDataset(documents);
  const id = `RUN-${Date.now().toString(36).toUpperCase()}`;

  await db.query(
    "INSERT INTO clearclose.reconciliation_runs (id, period, ruleset_version, created_at, summary, dataset) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, dataset.meta.period, dataset.meta.rulesetVersion, dataset.meta.generatedAt, JSON.stringify(dataset.reconciliation.summary), JSON.stringify(dataset)],
  );
  await recordAudit(db, "RECONCILIATION_RUN", "run", id, dataset.reconciliation.summary);
  return { id, dataset };
}

/** Reassembles parsed-document shape from the stored canonical rows. */
async function loadDocuments(db) {
  const order = Object.keys(DOCUMENT_KINDS);
  const stored = await db.query("SELECT id, kind, name FROM clearclose.documents");
  const documents = [];

  for (const row of [...stored].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    if (row.kind === "ledger") {
      documents.push({ kind: row.kind, name: row.name, bookings: await loadBookings(db) });
    } else if (row.kind === "collection") {
      documents.push({ kind: row.kind, name: row.name, receipts: await loadReceipts(db) });
    } else {
      const statement = await loadStatement(db, row.kind.replace("statement", ""));
      if (statement) documents.push({ kind: row.kind, name: row.name, statement });
    }
  }
  return documents;
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

async function loadStatement(db, code) {
  const [head] = await db.query("SELECT * FROM clearclose.bank_statements WHERE code = $1", [code]);
  if (!head) return null;
  const lines = await db.query("SELECT * FROM clearclose.bank_transactions WHERE statement_code = $1 ORDER BY page, row_no", [code]);
  return {
    code: head.code,
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
    lines: lines.map((line) => ({
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
  };
}

/** The dataset the UI should render: the latest recorded run, if any. */
export async function latestDataset(db) {
  const [row] = await db.query("SELECT dataset FROM clearclose.reconciliation_runs ORDER BY created_at DESC LIMIT 1");
  if (!row) return null;
  return typeof row.dataset === "string" ? JSON.parse(row.dataset) : row.dataset;
}

export async function storedDocuments(db) {
  return db.query("SELECT id, kind, name, sha256, size_bytes, row_count, uploaded_at FROM clearclose.documents ORDER BY uploaded_at DESC");
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
