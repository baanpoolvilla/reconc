import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbookBuffer } from "../lib/parsers/xlsx.mjs";
import { parseStatementBuffer } from "../lib/parsers/statement.mjs";
import { DOCUMENT_KINDS, detectDocumentKind, parseDocument } from "../lib/parsers/documents.mjs";
import { kbank } from "../lib/parsers/banks/kbank.mjs";

// เทสต์ตัวอ่านไฟล์ กับเอกสารจริงถ้ามีอยู่ในเครื่อง
//
// ระบบไม่อ่านโฟลเดอร์ data/ อีกแล้ว — ข้อมูลจริงเข้าทางเดียวคืออัปโหลดเข้า Postgres
// แต่ตัวอ่าน PDF/XLSX ยังต้องพิสูจน์กับเอกสารจริงที่ธนาคารและ PMS ออกให้ ไม่ใช่กับ
// ไฟล์ที่เราแต่งขึ้นเอง เพราะสิ่งที่มันต้องทนคือรูปแบบของเขา ไม่ใช่ของเรา
//
// เอกสารพวกนั้น commit ไม่ได้ (มีชื่อผู้เข้าพัก เบอร์โทร และรายการเดินบัญชี) เทสต์ชุด
// นี้จึงข้ามไปเองเมื่อไม่มีไฟล์ และทำงานให้เมื่อมี — วางไฟล์เดือนไหนก็ได้ใน data/
// แล้วสั่ง npm test เพื่อตรวจว่ารูปแบบไฟล์เดือนนั้นยังอ่านออก ก่อนอัปโหลดขึ้นระบบจริง

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const files = existsSync(dataDir) ? readdirSync(dataDir).filter((file) => !file.startsWith(".")) : [];
const read = (name) => readFileSync(`${dataDir}${name}`);

const found = Object.fromEntries(
  Object.keys(DOCUMENT_KINDS).map((kind) => [kind, files.find((file) => DOCUMENT_KINDS[kind].matches(file))]),
);
const absent = { skip: "ไม่มีเอกสารจริงในโฟลเดอร์ data/ ของเครื่องนี้ — ข้ามไป" };

test("ทุกไฟล์ใน data/ ถูกจำแนกชนิดได้จากชื่อไฟล์", files.length ? {} : absent, () => {
  for (const file of files) {
    assert.ok(detectDocumentKind(file), `${file} ไม่เข้ารูปแบบชื่อของเอกสารชนิดใดเลย`);
  }
});

test("บัญชีแยกประเภทมีคอลัมน์เวลาที่สร้างคำจอง", found.ledger ? {} : absent, () => {
  const [sheet] = readWorkbookBuffer(read(found.ledger));
  const header = sheet.rows.find((row) => row.includes("Reservation Creation Time"));

  assert.ok(header, "ไม่พบหัวตารางของบัญชีแยกประเภท");
  assert.equal(header[1], "Reservation Creation Time");
  assert.equal(header[3], "PMS Reservation No.");

  // วันที่สร้างคำจองคือวันเดียวที่กฎ R01 มองหา ทุกแถวจึงต้องอ่านออกเป็น ISO
  const bookings = parseDocument("ledger", read(found.ledger), found.ledger).bookings;
  assert.ok(bookings.length > 0, "อ่านคำจองไม่ได้สักแถว");
  for (const booking of bookings) {
    assert.match(booking.createdDate, /^\d{4}-\d{2}-\d{2}$/, `${booking.reservationNo} วันที่สร้างคำจองอ่านไม่ออก`);
  }
});

test("รายงานการรับเงินมีคอลัมน์วันที่ ช่องทาง ยอด และเลขที่จอง", found.collection ? {} : absent, () => {
  const [sheet] = readWorkbookBuffer(read(found.collection));
  const header = sheet.rows.find((row) => row[0] === "Date");

  assert.deepEqual(header.slice(0, 5), ["Date", "Item", "Payment Method", "Amount", "Reservation Number"]);

  const receipts = parseDocument("collection", read(found.collection), found.collection).receipts;
  assert.ok(receipts.length > 0, "อ่านรายการรับเงินไม่ได้สักแถว");
  for (const receipt of receipts) {
    assert.match(receipt.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isInteger(receipt.amountSatang), "ยอดเงินต้องเป็นจำนวนเต็มสตางค์");
  }
  assert.equal(new Set(receipts.map((row) => row.id)).size, receipts.length, "รหัสรายการรับเงินซ้ำกัน");
});

// ยอดคุมคือข้อพิสูจน์ว่าอ่าน statement ครบทุกบรรทัด: ยอดยกมา + เงินเข้า − เงินออก
// ต้องลงพอดีกับยอดยกไปที่ธนาคารพิมพ์ไว้ ขาดบรรทัดเดียวก็ไม่ลงตัว ตัวอ่านบังคับข้อนี้
// กับทุกธนาคารเท่ากัน จึงเป็นด่านที่ทำให้เพิ่มธนาคารใหม่ได้โดยไม่ต้องเชื่อแบบไม่มีเงื่อนไข
const statements = files.filter((file) => DOCUMENT_KINDS.statement.matches(file));

test("Statement ทุกฉบับใน data/ อ่านออกและยอดคุมลงตัว", statements.length ? {} : absent, () => {
  for (const name of statements) {
    const statement = parseStatementBuffer(read(name), name);

    assert.ok(statement.bank, `${name} ต้องรู้ว่าเป็นเอกสารของธนาคารไหน`);
    assert.ok(statement.accountNo, `${name} อ่านเลขที่บัญชีไม่ได้`);
    assert.equal(statement.controlDeltaSatang, 0, `${name} ยอดคุมไม่ลงตัว แปลว่าอ่านบรรทัดไม่ครบ`);

    assert.equal(statement.creditCount, statement.lines.filter((line) => line.direction === "credit").length);
    assert.equal(statement.debitCount, statement.lines.filter((line) => line.direction === "debit").length);
    assert.ok(statement.lines.every((line) => /^\d{4}-\d{2}-\d{2}$/.test(line.date)), `${name} มีวันที่อ่านไม่ออก`);
    assert.ok(statement.lines.every((line) => Number.isInteger(line.amountSatang)), `${name} มียอดที่ไม่ใช่จำนวนเต็มสตางค์`);
    assert.equal(new Set(statement.lines.map((line) => line.id)).size, statement.lines.length, `${name} รหัสบรรทัดซ้ำกัน`);
  }
});

// ── รายละเอียดที่ K BIZ ห่อลงบรรทัดใหม่ ──────────────────────────────────────
//
// คอลัมน์สุดท้ายของ statement มีความกว้างตายตัว ข้อความที่ยาวเกินถูกห่อลงบรรทัด
// ถัดไปเป็นบรรทัดที่ไม่มีวันที่ ตัวอ่านที่มองหาเฉพาะบรรทัดที่ขึ้นต้นด้วยวันที่ จะ
// ทิ้งท่อนหลังไปทั้งท่อน
//
// ท่อนหลังนั้นไม่ใช่ของประดับ: ชื่อ OTA เจ้าของก้อนโอนอยู่ในนั้นพอดี ("BOOKING.C")
// ทิ้งไปแล้วเหลือแต่เลขบัญชีของธนาคารต้นทาง ซึ่งบอกไม่ได้ว่าก้อนเป็นของใคร

const runs = (...pairs) => ({ runs: pairs.map(([text, x]) => ({ text, x })) });

const header = [
  runs(["เลขที่บัญชีเงินฝาก", 345], ["025-3-66398-7", 420]),
  runs(["รอบระหว่างวันที่", 345], ["01/07/2026 - 31/07/2026", 420]),
  runs(["ชื่อบัญชี", 30], ["บริษัททดสอบ จำกัด", 90]),
];

test("รายละเอียดที่ถูกห่อลงบรรทัดใหม่ ถูกต่อกลับเข้าแถวเดิม", () => {
  const page = [
    ...header,
    runs(["20-07-26", 68], ["ยอดยกมา", 123], ["0.00", 300]),
    runs(["21-07-26", 68], ["02:26", 101], ["รับโอนเงินอัตโนมัติ", 123], ["12,600.82", 241], ["12,600.82", 300],
      ["โอนเข้า/หักบัญชีอัตโนมัติ", 333], ["จาก SMART SCBT X4311 (NRBA)(1)", 404]),
    runs(["BOOKING.C++", 404]),
  ];

  const [line] = kbank.parse([page]).lines;

  assert.equal(line.detail, "จาก SMART SCBT X4311 (NRBA)(1)BOOKING.C");
  assert.match(line.detail, /BOOKING/, "ชื่อเจ้าของก้อนโอนต้องอ่านออก");
  assert.equal(line.channel, "โอนเข้า/หักบัญชีอัตโนมัติ", "การต่อท่อนต้องไม่ไปปนกับคอลัมน์อื่น");
  assert.equal(line.amountSatang, 1260082);
});

test("ท่อนที่ห่อลงมาถูกต่อแบบไม่แทรกช่องว่าง เพราะมันถูกตัดกลางคำ", () => {
  const page = [
    ...header,
    runs(["20-07-26", 68], ["ยอดยกมา", 123], ["0.00", 300]),
    runs(["24-07-26", 68], ["02:25", 101], ["รับโอนเงินอัตโนมัติ", 123], ["17,875.20", 241], ["17,875.20", 300],
      ["โอนเข้า/หักบัญชีอัตโนมัติ", 333], ["จาก SMART SCBT X9633 MCP Operating a+", 404]),
    runs(["+", 404]),
  ];

  const [line] = kbank.parse([page]).lines;

  // "a+" กับ "+" ต่อกันเป็น "a++" ซึ่งคือเครื่องหมายว่าธนาคารตัดข้อความ ไม่ใช่
  // ตัวอักษรของข้อความ จึงถูกตัดออกทั้งคู่
  assert.equal(line.detail, "จาก SMART SCBT X9633 MCP Operating a");
});

test("บรรทัดที่ไม่ได้อยู่ติดใต้แถว ไม่ถูกดูดเข้ามาเป็นรายละเอียด", () => {
  // ท้ายหน้าสุดท้ายมีที่อยู่บริษัทพิมพ์อยู่ในคอลัมน์ขวาเหมือนกัน ถ้าต่อทุกบรรทัด
  // ที่อยู่คอลัมน์นั้น รายการสุดท้ายของทุกหน้าจะมีที่อยู่ธนาคารห้อยท้าย
  const page = [
    ...header,
    runs(["20-07-26", 68], ["ยอดยกมา", 123], ["0.00", 300]),
    runs(["21-07-26", 68], ["11:23", 101], ["รับโอนเงิน", 123], ["13,000.00", 241], ["13,000.00", 300],
      ["Internet/Mobile TTB", 333], ["จาก TTB X9857 น.ส. อรปรียา ทัศนา++", 404]),
    runs(["ออกโดย K BIZ", 60]),
    runs(["400/22 ถนนพหลโยธิน แขวงสามเสนใน", 420]),
  ];

  const [line] = kbank.parse([page]).lines;

  assert.equal(line.detail, "จาก TTB X9857 น.ส. อรปรียา ทัศนา");
});
