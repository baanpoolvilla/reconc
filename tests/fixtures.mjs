import { assembleDataset } from "../lib/dataset-builder.mjs";

// ชุดข้อมูลสังเคราะห์สำหรับเทสต์
//
// เทสต์เคยอ่านเอกสารบัญชีจริงในโฟลเดอร์ data/ ซึ่งมีชื่อผู้เข้าพัก เบอร์โทร และ
// รายการเดินบัญชีธนาคารอยู่ข้างใน ไฟล์พวกนั้นไม่ควรอยู่ในที่ที่ commit ได้ และ
// ระบบก็ไม่ได้อ่านมันแล้ว — ข้อมูลจริงเข้าทางเดียวคือการอัปโหลดเข้า Postgres
//
// ไฟล์นี้จึงประกอบเดือนหนึ่งขึ้นมาเองให้ครบทุกรูปแบบที่ engine ต้องเจอ: จับคู่ได้
// สามแบบ ข้อยกเว้นครบทุกเหตุ ก้อนโอน OTA ที่หักคอมแล้ว รายการคืนเงิน ช่องทางที่
// ไม่มีบัญชีธนาคาร และกลุ่มที่ค่าตั้งต้นตัดออก ตัวเลขทุกตัวเป็นของสมมติทั้งหมด

const PERIOD = "2026-07";

const booking = (reservationNo, createdDate, overrides = {}) => ({
  reservationNo,
  channelReservationNo: `CH-${reservationNo}`,
  createdAt: `${createdDate}T09:30:00`,
  createdDate,
  completedAt: `${createdDate}T09:35:00`,
  creator: "frontdesk",
  guest: `ผู้เข้าพัก ${reservationNo}`,
  mobile: `08${reservationNo.slice(-8)}`,
  channel: "Direct",
  status: "Confirmed",
  roomType: "Pool Villa",
  roomNumber: reservationNo.slice(-2),
  nights: 2,
  totalSatang: 0,
  payments: [],
  paidSatang: 0,
  arSatang: 0,
  balanceDueSatang: 0,
  ...overrides,
});

const receipt = (id, reservationNo, date, amountSatang, method, overrides = {}) => ({
  id,
  sourceRow: Number(id.replace(/\D/g, "")) || 1,
  date,
  kind: amountSatang < 0 ? "REFUND" : "RECEIVE",
  method,
  amountSatang,
  reservationNo,
  channelReservationNo: `CH-${reservationNo}`,
  channel: "Direct",
  guest: `ผู้เข้าพัก ${reservationNo}`,
  group: "Baanpool-บางแสน",
  roomType: "Pool Villa",
  roomNumber: reservationNo.slice(-2),
  checkIn: date,
  checkOut: date,
  note: "",
  ...overrides,
});

const credit = (id, date, amountSatang, overrides = {}) => ({
  id,
  date,
  time: "10:15",
  description: "รับโอนเงิน",
  channel: "Internet/Mobile KBank",
  detail: "จาก KBANK X1234",
  direction: "credit",
  amountSatang,
  balanceSatang: amountSatang,
  page: 1,
  row: Number(id.replace(/\D/g, "")) || 1,
  ...overrides,
});

function statement(code, method, lines) {
  const credits = lines.filter((line) => line.direction === "credit");
  const debits = lines.filter((line) => line.direction === "debit");
  const creditSatang = credits.reduce((sum, line) => sum + line.amountSatang, 0);
  const debitSatang = debits.reduce((sum, line) => sum + line.amountSatang, 0);
  return {
    code,
    period: PERIOD,
    method,
    source: `${code}-${PERIOD}.pdf`,
    accountNo: `123-4-5${code}-6`,
    accountName: "บริษัททดสอบ จำกัด",
    branch: "สาขาทดสอบ",
    reference: `REF-${code}`,
    cycle: "01/07/2026 - 31/07/2026",
    suffix: code,
    openingSatang: 0,
    // ยอดคุมต้องลงตัวพอดี เทสต์หลายตัวยืนยันว่า controlDelta เป็นศูนย์
    closingSatang: creditSatang - debitSatang,
    creditSatang,
    debitSatang,
    creditCount: credits.length,
    debitCount: debits.length,
    controlDeltaSatang: 0,
    lines,
  };
}

// ── เงินเข้าบัญชี ────────────────────────────────────────────────────────────

const lines987 = [
  credit("987-01", "2026-07-03", 250000),                                   // R03 · 1:1
  credit("987-02", "2026-07-05", 300000),                                   // R04 · N:1
  credit("987-03", "2026-07-08", 120000),                                   // R05 · 1:N
  credit("987-04", "2026-07-08", 180000),                                   // R05 · 1:N
  credit("987-05", "2026-07-12", 999900),                                   // ยอดไม่ตรงกับที่รับมา
  credit("987-06", "2026-07-15", 777700),                                   // ไม่มีรายการรับเงินรองรับ
  credit("987-07", "2026-07-20", 1350000, {                                 // ก้อนโอน OTA หักคอม 10%
    channel: "ธุรกรรมต่างประเทศ",
    detail: "จาก SMART SCBT X9633 MCP Operating",
  }),
];

const lines885 = [
  credit("885-01", "2026-07-10", 400000),                                   // R03 · 1:1
  credit("885-02", "2026-07-18", 260000),                                   // ไม่มีรายการรับเงินรองรับ
];

// ── รายการรับเงินและคำจอง ────────────────────────────────────────────────────

const rows = [
  // จับคู่ได้ทั้งสามรูปแบบ
  { id: "RCP-0001", no: "700000001", date: "2026-07-03", satang: 250000, method: "KbankGL987" },
  { id: "RCP-0002", no: "700000002", date: "2026-07-05", satang: 100000, method: "KbankGL987" },
  { id: "RCP-0003", no: "700000003", date: "2026-07-05", satang: 200000, method: "KbankGL987" },
  { id: "RCP-0004", no: "700000004", date: "2026-07-08", satang: 300000, method: "KbankGL987" },
  { id: "RCP-0005", no: "700000005", date: "2026-07-10", satang: 400000, method: "KbankGL885" },

  // ข้อยกเว้นครบทุกเหตุ
  { id: "RCP-0006", no: "700000006", date: "2026-07-12", satang: 500000, method: "KbankGL987" },
  { id: "RCP-0007", no: "700000007", date: "2026-07-22", satang: 150000, method: "KbankGL987" },
  { id: "RCP-0008", no: "700000008", date: "2026-07-25", satang: -50000, method: "KbankGL987" },

  // ก้อนโอน OTA — ยอดเต็ม 15,000 เข้าจริง 13,500
  { id: "RCP-0010", no: "700000010", date: "2026-07-14", satang: 1000000, method: "TRIPCOM COLLECT", channel: "Trip.com" },
  { id: "RCP-0011", no: "700000011", date: "2026-07-16", satang: 500000, method: "TRIPCOM COLLECT", channel: "Trip.com" },

  // ช่องทางที่ไม่มีบัญชีธนาคารในระบบ
  { id: "RCP-0012", no: "700000012", date: "2026-07-28", satang: 30000, method: "Cash" },

  // กลุ่มและช่องทางที่ค่าตั้งต้นตัดออก
  { id: "RCP-0013", no: "700000013", date: "2026-07-06", satang: 620000, method: "KbankGL987", group: "Medina-บางแสน" },
  { id: "RCP-0014", no: "700000014", date: "2026-07-09", satang: 480000, method: "KbankGL987", group: "Medina-หัวหิน" },
  { id: "RCP-0015", no: "700000015", date: "2026-07-11", satang: 350000, method: "Kbank-Posh", group: "Baanpool-หัวหิน" },
  { id: "RCP-0016", no: "700000016", date: "2026-07-13", satang: 275000, method: "Kbank-Posh", group: "Baanpool-หัวหิน" },
  // เข้าเงื่อนไขทั้งกลุ่มทรัพย์สินและช่องทางพร้อมกัน — มีไว้พิสูจน์ว่ากฎถูกตรวจตามลำดับ
  { id: "RCP-0018", no: "700000018", date: "2026-07-21", satang: 190000, method: "Kbank-Posh", group: "Medina-บางแสน" },

  // คำจองที่ถูกยกเลิก มีไว้ให้กฎ "ตัดตามสถานะคำจอง" มีอะไรให้ตัด
  { id: "RCP-0017", no: "700000017", date: "2026-07-19", satang: 210000, method: "KbankGL987", status: "Cancelled" },
];

// RCP-0009 ไม่มีคำจองรองรับโดยตั้งใจ — เป็นเหตุ MISSING_BOOKING
const orphan = receipt("RCP-0009", "700000999", "2026-07-24", 90000, "KbankGL987");

const bookings = rows.map((row) => booking(row.no, row.date, {
  status: row.status ?? "Confirmed",
  totalSatang: Math.abs(row.satang),
  paidSatang: Math.abs(row.satang),
  channel: row.channel ?? "Direct",
}));

const receipts = [
  ...rows.map((row) => receipt(row.id, row.no, row.date, row.satang, row.method, {
    ...(row.group ? { group: row.group } : {}),
    ...(row.channel ? { channel: row.channel } : {}),
  })),
  orphan,
];

const sources = [
  { kind: "ledger", label: "บัญชีแยกประเภท", name: "ledger.xlsx", rows: bookings.length, period: PERIOD, periodStart: PERIOD, periodEnd: PERIOD },
  { kind: "collection_report", label: "รายงานการรับเงิน", name: "collection.xlsx", rows: receipts.length, period: PERIOD, periodStart: PERIOD, periodEnd: PERIOD },
  { kind: "bank_statement_885", label: "Statement บัญชี 885", name: "885.pdf", rows: lines885.length, period: PERIOD, periodStart: PERIOD, periodEnd: PERIOD },
  { kind: "bank_statement_987", label: "Statement บัญชี 987", name: "987.pdf", rows: lines987.length, period: PERIOD, periodStart: PERIOD, periodEnd: PERIOD },
];

/** ชุดข้อมูลใหม่ทุกครั้งที่เรียก — เทสต์ที่แก้ของในนั้นจะได้ไม่กวนกันเอง */
export function makeDataset() {
  return assembleDataset({
    bookings: structuredClone(bookings),
    receipts: structuredClone(receipts),
    statements: [
      statement("885", "KbankGL885", structuredClone(lines885)),
      statement("987", "KbankGL987", structuredClone(lines987)),
    ],
    sources: structuredClone(sources),
  });
}

export const FIXTURE_PERIOD = PERIOD;
