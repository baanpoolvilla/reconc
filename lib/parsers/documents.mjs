import { readWorkbookBuffer } from "./xlsx.mjs";
import { parseStatementBuffer } from "./statement.mjs";

// Turns an uploaded file into canonical rows. Each parser is pure: bytes in,
// rows out, no filesystem and no database, so the build script and the upload
// endpoint run exactly the same code.

export const DOCUMENT_KINDS = {
  ledger: { label: "บัญชีแยกประเภท", accept: ".xlsx", matches: (name) => name.includes("บัญชีแยกประเภท") && name.endsWith(".xlsx") },
  collection: { label: "รายงานการรับเงิน", accept: ".xlsx", matches: (name) => name.includes("รายงานการรับเงิน") && name.endsWith(".xlsx") },
  statement885: { label: "Statement บัญชี 885", accept: ".pdf", matches: (name) => name.startsWith("885") && name.endsWith(".pdf") },
  statement987: { label: "Statement บัญชี 987", accept: ".pdf", matches: (name) => name.startsWith("987") && name.endsWith(".pdf") },
};

export const STATEMENT_ACCOUNTS = {
  statement885: { code: "885", method: "KbankGL885" },
  statement987: { code: "987", method: "KbankGL987" },
};

/** Infers which of the four documents a file is, from its name. */
export function detectDocumentKind(fileName) {
  return Object.keys(DOCUMENT_KINDS).find((kind) => DOCUMENT_KINDS[kind].matches(fileName)) ?? null;
}

export function toSatang(text) {
  const clean = String(text ?? "").replace(/,/g, "").trim();
  if (!clean) return 0;
  const value = Number(clean);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function toIsoDate(text) {
  const match = /(\d{4})[-/](\d{2})[-/](\d{2})/.exec(String(text ?? ""));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export function toIsoDateTime(text) {
  const match = /(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text ?? ""));
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}` : "";
}

function headerIndex(rows) {
  return rows.findIndex((row) => row.some((cell) => cell === "Reservation Creation Time" || cell === "Date"));
}

/** Ledger export → bookings, keyed by the reservation creation time the matcher relies on. */
export function parseLedger(buffer) {
  const [sheet] = readWorkbookBuffer(buffer);
  const header = headerIndex(sheet.rows);
  if (header < 0) throw new Error("ไม่พบหัวตาราง Reservation Creation Time ในไฟล์บัญชีแยกประเภท");

  const bookings = [];
  for (const row of sheet.rows.slice(header + 2)) {
    const reservationNo = row[3]?.trim();
    if (!reservationNo || !/^\d{6,}$/.test(reservationNo)) continue;

    const payments = [];
    if (row[13] && toSatang(row[14]) !== 0) payments.push({ method: row[13], amountSatang: toSatang(row[14]) });
    if (row[15] && toSatang(row[16]) !== 0) payments.push({ method: row[15], amountSatang: toSatang(row[16]) });

    const createdAt = toIsoDateTime(row[1]);
    bookings.push({
      reservationNo,
      channelReservationNo: row[4] ?? "",
      createdAt,
      createdDate: createdAt.slice(0, 10),
      completedAt: toIsoDateTime(row[0]),
      creator: row[2] ?? "",
      guest: row[5] ?? "",
      mobile: row[6] ?? "",
      channel: row[7] ?? "",
      status: row[8] ?? "",
      roomType: row[9] ?? "",
      roomNumber: row[10] ?? "",
      nights: Number(row[11] || 0),
      totalSatang: toSatang(row[12]),
      payments,
      paidSatang: payments.reduce((sum, payment) => sum + payment.amountSatang, 0),
      arSatang: toSatang(row[18]),
      balanceDueSatang: toSatang(row[19]),
    });
  }
  return bookings;
}

/** Collection report → receipt rows. */
export function parseCollectionReport(buffer) {
  const [sheet] = readWorkbookBuffer(buffer);
  const header = headerIndex(sheet.rows);
  if (header < 0) throw new Error("ไม่พบหัวตาราง Date ในไฟล์รายงานการรับเงิน");

  const receipts = [];
  sheet.rows.slice(header + 1).forEach((row, offset) => {
    const date = toIsoDate(row[0]);
    const reservationNo = row[4]?.trim();
    if (!date || !reservationNo) return;
    const amountSatang = toSatang(row[3]);
    if (amountSatang === 0) return;

    const isRefund = row[1] === "REFUND";
    receipts.push({
      id: `RCP-${date.replace(/-/g, "")}-${String(offset + 1).padStart(4, "0")}`,
      sourceRow: header + 2 + offset,
      date,
      kind: isRefund ? "REFUND" : "RECEIVE",
      method: row[2] ?? "",
      amountSatang: isRefund ? -Math.abs(amountSatang) : amountSatang,
      reservationNo,
      channelReservationNo: row[5] ?? "",
      channel: row[6] ?? "",
      guest: (row[7] ?? "").replace(/\s+/g, " ").trim(),
      group: row[8] ?? "",
      roomType: row[9] ?? "",
      roomNumber: row[10] ?? "",
      checkIn: toIsoDate(row[11]),
      checkOut: toIsoDate(row[12]),
      note: row[13] ?? "",
    });
  });
  return receipts;
}

/** Statement PDF → one canonical statement with its transaction lines. */
export function parseStatement(kind, buffer, sourceName) {
  const account = STATEMENT_ACCOUNTS[kind];
  if (!account) throw new Error(`ไม่รู้จักชนิดเอกสาร ${kind}`);
  return { ...account, ...parseStatementBuffer(buffer, sourceName) };
}

/** Parses one uploaded file into whatever canonical rows it carries. */
export function parseDocument(kind, buffer, fileName) {
  if (kind === "ledger") return { kind, bookings: parseLedger(buffer) };
  if (kind === "collection") return { kind, receipts: parseCollectionReport(buffer) };
  return { kind, statement: parseStatement(kind, buffer, fileName) };
}
