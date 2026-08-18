import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbookBuffer } from "../lib/parsers/xlsx.mjs";
import { parseStatementBuffer } from "../lib/parsers/statement.mjs";
import { DOCUMENT_KINDS, detectDocumentKind, parseDocument } from "../lib/parsers/documents.mjs";

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
