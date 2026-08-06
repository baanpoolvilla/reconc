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
      `INSERT INTO ${table} (${columns.map(quote).join(", ")}) VALUES ${placeholders(chunk.length, columns.length)}`,
      values,
    );
  }
}

export async function replaceBookings(db, bookings) {
  await db.query("DELETE FROM bookings");
  await insertRows(db, "bookings", bookingColumns, bookings, (booking) => [
    booking.reservationNo, booking.channelReservationNo, booking.createdAt, booking.createdDate,
    booking.completedAt, booking.creator, booking.guest, booking.mobile, booking.channel, booking.status,
    booking.roomType, booking.roomNumber, booking.nights, booking.totalSatang, booking.paidSatang,
    booking.arSatang, booking.balanceDueSatang, JSON.stringify(booking.payments ?? []),
  ]);
}

export async function replaceReceipts(db, receipts) {
  await db.query("DELETE FROM receipts");
  await insertRows(db, "receipts", receiptColumns, receipts, (receipt) => [
    receipt.id, receipt.sourceRow, receipt.date, receipt.kind, receipt.method, receipt.amountSatang,
    receipt.reservationNo, receipt.channelReservationNo, receipt.channel, receipt.guest, receipt.group,
    receipt.roomType, receipt.roomNumber, receipt.checkIn, receipt.checkOut, receipt.note,
  ]);
}

export async function replaceStatement(db, statement) {
  await db.query("DELETE FROM bank_statements WHERE code = $1", [statement.code]);
  await db.query(
    `INSERT INTO bank_statements (code, method, source, account_no, account_name, branch, reference, cycle, suffix,
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
  await db.query("DELETE FROM documents WHERE kind = $1", [document.kind]);
  await db.query(
    `INSERT INTO documents (id, kind, name, sha256, size_bytes, row_count, uploaded_by, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [document.id, document.kind, document.name, document.sha256, document.sizeBytes, document.rowCount, document.uploadedBy, bangkokNow()],
  );
}

export async function recordAudit(db, action, entityType, entityId, detail) {
  await db.query(
    "INSERT INTO audit_events (actor, action, entity_type, entity_id, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    ["web", action, entityType, entityId, JSON.stringify(detail ?? {}), bangkokNow()],
  );
}

/** Rebuilds the dataset from whatever is currently stored and records the run. */
export async function runReconciliation(db) {
  const documents = await loadDocuments(db);
  const dataset = buildDataset(documents);
  const id = `RUN-${Date.now().toString(36).toUpperCase()}`;

  await db.query(
    "INSERT INTO reconciliation_runs (id, period, ruleset_version, created_at, summary, dataset) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, dataset.meta.period, dataset.meta.rulesetVersion, dataset.meta.generatedAt, JSON.stringify(dataset.reconciliation.summary), JSON.stringify(dataset)],
  );
  await recordAudit(db, "RECONCILIATION_RUN", "run", id, dataset.reconciliation.summary);
  return { id, dataset };
}

/** Reassembles parsed-document shape from the stored canonical rows. */
async function loadDocuments(db) {
  const order = Object.keys(DOCUMENT_KINDS);
  const stored = await db.query("SELECT id, kind, name FROM documents");
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
  const rows = await db.query("SELECT * FROM bookings ORDER BY created_at DESC");
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
  const rows = await db.query('SELECT * FROM receipts ORDER BY date DESC, id ASC');
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
  const [head] = await db.query("SELECT * FROM bank_statements WHERE code = $1", [code]);
  if (!head) return null;
  const lines = await db.query("SELECT * FROM bank_transactions WHERE statement_code = $1 ORDER BY page, row_no", [code]);
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
  const [row] = await db.query("SELECT dataset FROM reconciliation_runs ORDER BY created_at DESC LIMIT 1");
  if (!row) return null;
  return typeof row.dataset === "string" ? JSON.parse(row.dataset) : row.dataset;
}

export async function storedDocuments(db) {
  return db.query("SELECT id, kind, name, sha256, size_bytes, row_count, uploaded_at FROM documents ORDER BY uploaded_at DESC");
}
