import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "./lib/xlsx.mjs";
import { parseStatementPdf } from "./lib/statement.mjs";
import { reconcile } from "../lib/reconciliation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const outputPath = join(root, "lib", "dataset.generated.json");

const LEDGER_HINT = "บัญชีแยกประเภท";
const COLLECTION_HINT = "รายงานการรับเงิน";

function toSatang(text) {
  const clean = String(text ?? "").replace(/,/g, "").trim();
  if (!clean) return 0;
  const value = Number(clean);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function toIsoDate(text) {
  const match = /(\d{4})[-/](\d{2})[-/](\d{2})/.exec(String(text ?? ""));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function toIsoDateTime(text) {
  const match = /(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text ?? ""));
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}`;
}

function dataDirEntries() {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir).filter((file) => !file.startsWith("."));
}

const matchers = {
  ledger: (file) => file.includes(LEDGER_HINT) && file.endsWith(".xlsx"),
  collection: (file) => file.includes(COLLECTION_HINT) && file.endsWith(".xlsx"),
  statement885: (file) => file.startsWith("885") && file.endsWith(".pdf"),
  statement987: (file) => file.startsWith("987") && file.endsWith(".pdf"),
};

function findDataFile(kind, label) {
  const name = dataDirEntries().find(matchers[kind]);
  if (!name) throw new Error(`ไม่พบไฟล์ ${label} ในโฟลเดอร์ data/`);
  return join(dataDir, name);
}

/**
 * An empty data/ folder is a valid state: the app deploys without any source
 * documents and shows its empty state. A *partly* filled folder is not — that
 * is a mistake worth failing on, so the operator notices the missing file.
 */
function dataFolderState() {
  const entries = dataDirEntries();
  const present = Object.entries(matchers).filter(([, match]) => entries.some(match)).map(([kind]) => kind);
  if (present.length === 0) return "empty";
  return present.length === Object.keys(matchers).length ? "complete" : "partial";
}

function headerIndex(rows) {
  return rows.findIndex((row) => row.some((cell) => cell === "Reservation Creation Time" || cell === "Date"));
}

function buildBookings() {
  const path = findDataFile("ledger", "บัญชีแยกประเภท (.xlsx)");
  const [sheet] = readWorkbook(path);
  const rows = sheet.rows;
  const header = headerIndex(rows);
  const bookings = [];

  for (const row of rows.slice(header + 2)) {
    const reservationNo = row[3]?.trim();
    if (!reservationNo || !/^\d{6,}$/.test(reservationNo)) continue;

    const payments = [];
    if (row[13] && toSatang(row[14]) !== 0) payments.push({ method: row[13], amountSatang: toSatang(row[14]) });
    if (row[15] && toSatang(row[16]) !== 0) payments.push({ method: row[15], amountSatang: toSatang(row[16]) });

    bookings.push({
      reservationNo,
      channelReservationNo: row[4] ?? "",
      createdAt: toIsoDateTime(row[1]),
      createdDate: toIsoDateTime(row[1]).slice(0, 10),
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

  return { source: path.split(/[\\/]/).pop(), bookings };
}

function buildReceipts() {
  const path = findDataFile("collection", "รายงานการรับเงิน (.xlsx)");
  const [sheet] = readWorkbook(path);
  const rows = sheet.rows;
  const header = headerIndex(rows);
  const receipts = [];

  rows.slice(header + 1).forEach((row, offset) => {
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

  return { source: path.split(/[\\/]/).pop(), receipts };
}

function buildStatements() {
  return [
    { code: "885", method: "KbankGL885", ...parseStatementPdf(findDataFile("statement885", "Statement 885*.pdf")) },
    { code: "987", method: "KbankGL987", ...parseStatementPdf(findDataFile("statement987", "Statement 987*.pdf")) },
  ];
}

// Asia/Bangkok local time, so it reads the same way as every timestamp in the
// source documents.
const generatedAt = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace("Z", "");

const state = dataFolderState();
if (state === "partial") {
  const entries = dataDirEntries();
  const missing = Object.entries(matchers).filter(([, match]) => !entries.some(match)).map(([kind]) => kind);
  throw new Error(`โฟลเดอร์ data/ มีเอกสารไม่ครบ ขาด: ${missing.join(", ")} — ใส่ให้ครบทั้งสี่ไฟล์ หรือเอาออกให้หมดเพื่อ build แบบไม่มีข้อมูล`);
}

let dataset;

if (state === "empty") {
  dataset = {
    meta: { generatedAt, period: "", rulesetVersion: "2.0.0", sources: [] },
    bookings: [],
    receipts: [],
    statements: [],
  };
  dataset.reconciliation = reconcile(dataset);
  console.log("data/ ว่าง — สร้างชุดข้อมูลเปล่า ระบบจะขึ้นหน้าจอสถานะ 'ยังไม่มีเอกสาร'");
} else {
  const ledger = buildBookings();
  const collection = buildReceipts();
  const statements = buildStatements();

  dataset = {
    meta: {
      generatedAt,
      period: collection.receipts.map((receipt) => receipt.date).sort()[0]?.slice(0, 7) ?? "",
      rulesetVersion: "2.0.0",
      sources: [
        { kind: "ledger", name: ledger.source, rows: ledger.bookings.length },
        { kind: "collection_report", name: collection.source, rows: collection.receipts.length },
        ...statements.map((statement) => ({ kind: `bank_statement_${statement.code}`, name: statement.source, rows: statement.lines.length })),
      ],
    },
    bookings: ledger.bookings,
    receipts: collection.receipts,
    statements,
  };
  dataset.reconciliation = reconcile(dataset);

  console.log(`bookings        ${dataset.bookings.length}`);
  console.log(`receipts        ${dataset.receipts.length}`);
  for (const statement of statements) {
    console.log(`statement ${statement.code}    ${statement.lines.length} lines · control delta ${statement.controlDeltaSatang}`);
  }
  const { summary } = dataset.reconciliation;
  console.log(`matched groups  ${summary.matchedGroups} (${summary.matchRate}%)`);
  console.log(`exceptions      ${summary.exceptionCount}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(dataset)}\n`, "utf8");
console.log(`written         ${outputPath}`);
