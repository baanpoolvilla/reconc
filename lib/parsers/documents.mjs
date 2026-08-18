import { readWorkbookBuffer } from "./xlsx.mjs";

import { parseStatementBuffer } from "./statement.mjs";

// Turns an uploaded file into canonical rows. Each parser is pure: bytes in,
// rows out, no filesystem and no database, so the build script and the upload
// endpoint run exactly the same code.

export {
  DOCUMENT_KINDS,
  codeOfStatementKind,
  detectDocumentKind,
  isStatementKind,
  statementKind,
  documentPatterns,
  isAmbiguousDocumentName,
} from "../document-names.mjs";

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

/**
 * เปิดไฟล์ Excel แล้วคืนชีตแรก
 *
 * ตัวอ่าน zip พูดภาษาของ zip ("end-of-central-directory record not found") ซึ่ง
 * ไม่ได้บอกคนที่เพิ่งลากไฟล์มาวางว่าต้องทำอะไรต่อ ตรงนี้แปลให้เป็นสิ่งที่แก้ได้
 */
function firstSheet(buffer) {
  let sheets;
  try {
    sheets = readWorkbookBuffer(buffer);
  } catch {
    throw new Error("เปิดไฟล์ไม่ได้ — ต้องเป็น .xlsx จริง ไม่ใช่ .xls หรือ .csv ที่เปลี่ยนนามสกุลมา");
  }
  const [sheet] = sheets;
  if (!sheet) throw new Error("ไฟล์ Excel นี้ไม่มีชีตข้อมูลอยู่เลย");
  return sheet;
}

function headerIndex(rows) {
  return rows.findIndex((row) => row.some((cell) => cell === "Reservation Creation Time" || cell === "Date"));
}

/** Ledger export → bookings, keyed by the reservation creation time the matcher relies on. */
export function parseLedger(buffer) {
  const sheet = firstSheet(buffer);
  const header = headerIndex(sheet.rows);
  if (header < 0) throw new Error("ไม่พบหัวตาราง Reservation Creation Time — ไฟล์นี้ไม่ใช่บัญชีแยกประเภทที่ระบบต้นทางออกให้");

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
  const sheet = firstSheet(buffer);
  const header = headerIndex(sheet.rows);
  if (header < 0) throw new Error("ไม่พบหัวตาราง Date — ไฟล์นี้ไม่ใช่รายงานการรับเงินที่ระบบต้นทางออกให้");

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

/**
 * Statement PDF → one canonical statement with its transaction lines.
 *
 * รหัสบัญชี (`code`) มาจากเลขที่บัญชีในเอกสาร ไม่ใช่จากชื่อไฟล์อีกต่อไป ส่วน
 * `method` — ช่องทางรับเงินที่ใช้จับคู่กับรายงานการรับเงิน — เป็นความรู้ที่ไม่มี
 * อยู่ในเอกสารเลย จึงเว้นว่างไว้ให้การตั้งค่าเป็นคนบอก
 */
export function parseStatement(buffer, sourceName) {
  const statement = parseStatementBuffer(buffer, sourceName);
  return { ...statement, code: statement.suffix, method: "" };
}

/** Parses one uploaded file into whatever canonical rows it carries. */
export function parseDocument(kind, buffer, fileName) {
  if (kind === "ledger") return { kind, bookings: parseLedger(buffer) };
  if (kind === "collection") return { kind, receipts: parseCollectionReport(buffer) };
  return { kind, statement: parseStatement(buffer, fileName) };
}
