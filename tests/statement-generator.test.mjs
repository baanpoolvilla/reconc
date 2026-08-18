import assert from "node:assert/strict";
import test from "node:test";

import { makeStatementPdf } from "../scripts/make-statement-pdf.mjs";
import { parseStatementBuffer } from "../lib/parsers/statement.mjs";

// ตัวสร้าง Statement ทดสอบ กับตัวอ่านตัวจริง
//
// ไฟล์ทดสอบที่ "หน้าตาเหมือน" statement แต่วางข้อความคนละพิกัด อ่านไม่ออก — เจอมา
// แล้วกับไฟล์ที่เนื้อหาถูกทุกตัวแต่ตัวอ่านหาเลขที่บัญชีไม่เจอ ตัวสร้างจึงต้องวาง
// ข้อความตรงพิกัดเดียวกับที่ adapter อ่าน และวิธีพิสูจน์คือส่งกลับเข้าตัวอ่านตัวจริง
//
// เทสต์นี้จึงคุมสองอย่างพร้อมกัน: ตัวสร้างสร้างของที่ใช้ได้ และ adapter ยังอ่าน
// รูปแบบนั้นออก ถ้าฝั่งใดฝั่งหนึ่งเพี้ยน เทสต์นี้แดง

const build = (overrides = {}) => makeStatementPdf({
  accountNo: "199-1-33588-5",
  accountName: "บริษัททดสอบ จำกัด",
  branch: "สาขาทดสอบ",
  month: "2026-08",
  openingSatang: 5000000,
  count: 40,
  ...overrides,
});

test("ไฟล์ที่สร้างเดินผ่านตัวอ่านตัวจริงได้ทุกฟิลด์", () => {
  const { pdf } = build();
  const statement = parseStatementBuffer(pdf, "generated.pdf");

  assert.equal(statement.bank, "kbank", "ต้องถูกจำแนกเป็นธนาคารที่ตั้งใจสร้าง");
  assert.equal(statement.accountNo, "199-1-33588-5");
  assert.equal(statement.accountName, "บริษัททดสอบ จำกัด");
  assert.equal(statement.branch, "สาขาทดสอบ");
  assert.equal(statement.cycle, "01/08/2026 - 31/08/2026");
});

test("ยอดคุมของไฟล์ที่สร้างลงตัว — ด่านเดียวกับที่ธนาคารจริงต้องผ่าน", () => {
  const { pdf } = build();
  const statement = parseStatementBuffer(pdf, "generated.pdf");

  assert.equal(statement.controlDeltaSatang, 0);
  assert.equal(
    statement.openingSatang + statement.creditSatang - statement.debitSatang,
    statement.closingSatang,
  );
});

test("จำนวนรายการและทิศทางเงินตรงกับที่สั่งสร้าง", () => {
  const { pdf, lines } = build({ count: 25 });
  const statement = parseStatementBuffer(pdf, "generated.pdf");

  assert.equal(statement.lines.length, lines.length);
  assert.equal(statement.creditCount, lines.filter((line) => !line.debit).length);
  assert.equal(statement.debitCount, lines.filter((line) => line.debit).length);
  assert.ok(statement.debitCount > 0, "ต้องมีทั้งเงินเข้าและเงินออก ไม่ใช่ทางเดียว");
});

test("ทุกบรรทัดมีวันที่ ยอด และรหัสที่ใช้ได้จริง", () => {
  const { pdf } = build();
  const statement = parseStatementBuffer(pdf, "generated.pdf");

  for (const line of statement.lines) {
    assert.match(line.date, /^2026-08-\d{2}$/, "วันที่ต้องอยู่ในเดือนที่สั่ง");
    assert.match(line.time, /^\d{2}:\d{2}$/);
    assert.ok(Number.isInteger(line.amountSatang) && line.amountSatang > 0);
    assert.ok(Number.isInteger(line.balanceSatang));
  }
  assert.equal(
    new Set(statement.lines.map((line) => line.id)).size,
    statement.lines.length,
    "รหัสบรรทัดต้องไม่ซ้ำ ไม่งั้นการจับคู่ที่ยืนยันไว้จะชี้ผิดใบ",
  );
});

test("สั่งเดือนไหนก็ได้ ไม่ผูกกับเดือนใดเดือนหนึ่ง", () => {
  const statement = parseStatementBuffer(build({ month: "2027-02" }).pdf, "feb.pdf");

  assert.equal(statement.cycle, "01/02/2027 - 28/02/2027", "ต้องรู้จำนวนวันของเดือนนั้นจริง");
  assert.ok(statement.lines.every((line) => line.date.startsWith("2027-02")));
});

test("สั่งบัญชีไหนก็ได้ และรหัสบัญชีมาจากเลขที่บัญชี", () => {
  const statement = parseStatementBuffer(build({ accountNo: "025-3-66398-7" }).pdf, "other.pdf");

  assert.equal(statement.accountNo, "025-3-66398-7");
  assert.equal(statement.suffix, "987", "รหัสบัญชีคือเลขสามตัวท้าย ตรงกับที่คนเรียกกันและที่อยู่ในชื่อไฟล์");
});

test("รหัสบัญชีคือเลขสามตัวท้ายของเลขที่บัญชี ตรงกับที่ธนาคารตั้งชื่อไฟล์", () => {
  // 199-1-33588-5 → 885 · 025-3-66398-7 → 987 — เลขเดียวกับที่ K BIZ ใส่ไว้หน้า
  // ชื่อไฟล์ (885resultFile...) ระบบจึงไม่ต้องพึ่งชื่อไฟล์ให้บอกซ้ำ
  for (const [accountNo, code] of [["199-1-33588-5", "885"], ["025-3-66398-7", "987"], ["111-2-33333-4", "334"]]) {
    const statement = parseStatementBuffer(build({ accountNo }).pdf, "x.pdf");
    assert.equal(statement.suffix, code, accountNo);
    assert.ok(statement.lines.every((line) => line.id.startsWith(`${code}-`)), "รหัสบรรทัดต้องขึ้นต้นด้วยรหัสบัญชีเดียวกัน");
  }
});
