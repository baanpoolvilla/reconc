import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_KINDS,
  codeOfStatementKind,
  detectDocumentKind,
  isAmbiguousDocumentName,
  inspectPickedFiles,
  isStatementKind,
  parseDocument,
  statementKind,
} from "../lib/parsers/documents.mjs";

// ชื่อไฟล์บอกได้แค่ว่าเอกสารนี้เป็นชนิดไหน ไม่ได้บอกว่าเป็นบัญชีไหน
//
// เดิมชื่อไฟล์ต้องมีเลขบัญชีอยู่ (885resultFile...) เพราะระบบใช้ชื่อไฟล์ตัดสินว่า
// เป็นบัญชีใด แต่เลขที่บัญชีอยู่ในเอกสารอยู่แล้ว การบังคับให้ชื่อไฟล์บอกซ้ำจึงเป็น
// ภาระที่ไม่จำเป็น และเป็นสิ่งที่กันธนาคารรายอื่นออกไปโดยไม่มีเหตุผล

test("ไฟล์ Excel แยกชนิดจากคำในชื่อ", () => {
  assert.equal(detectDocumentKind("บันทึกบัญชีแยกประเภท (1).xlsx"), "ledger");
  assert.equal(detectDocumentKind("บันทึกบัญชีแยกประเภท_สิงหาคม_2569_TEST.xlsx"), "ledger");
  assert.equal(detectDocumentKind("รายงานการรับเงิน (2).xlsx"), "collection");
  assert.equal(detectDocumentKind("รายงานการรับเงิน_สิงหาคม_2569_TEST.xlsx"), "collection");
});

test("PDF ใบไหนก็เป็น Statement ได้ ไม่ต้องมีเลขบัญชีในชื่อ", () => {
  // ชื่อพวกนี้เคยถูกปฏิเสธทั้งหมด ทั้งที่เป็นเอกสารที่ถูกต้อง
  for (const name of [
    "885resultFile_20260805_133241.pdf",
    "Statement_885_สิงหาคม_2569_TEST.pdf",
    "statement.pdf",
    "SCB_มกราคม_2570.pdf",
    "เดินบัญชี ก.ค..PDF",
  ]) {
    assert.equal(detectDocumentKind(name), "statement", name);
  }
});

test("นามสกุลไฟล์ไม่สนตัวพิมพ์", () => {
  assert.equal(detectDocumentKind("รายงานการรับเงิน.XLSX"), "collection");
  assert.equal(detectDocumentKind("statement.PDF"), "statement");
});

test("ชนิดไฟล์ต้องตรงด้วย ไม่ใช่ดูแค่ชื่อ", () => {
  assert.equal(detectDocumentKind("รายงานการรับเงิน.pdf"), "statement", "นามสกุลชนะคำในชื่อ");
  assert.equal(detectDocumentKind("อะไรก็ไม่รู้.xlsx"), null, "xlsx ที่ไม่มีคำบอกชนิด ยังไม่รู้จัก");
});

test("ชื่อที่เข้าได้สองชนิดถูกปฏิเสธ ไม่ใช่เดาเอาชนิดแรก", () => {
  const both = "บัญชีแยกประเภท และ รายงานการรับเงิน รวมกัน.xlsx";

  assert.equal(isAmbiguousDocumentName(both), true);
  assert.equal(detectDocumentKind(both), null, "กำกวมต้องให้คนไปแก้ชื่อ ไม่ใช่เก็บเข้าชนิดที่เจอก่อน");
  assert.equal(isAmbiguousDocumentName("รายงานการรับเงิน (2).xlsx"), false);
});

test("ชื่อที่ไม่เข้าเลยยังถูกปฏิเสธตามเดิม", () => {
  assert.equal(detectDocumentKind("report.docx"), null);
  assert.equal(detectDocumentKind(""), null);
});

test("ชนิดของ statement ในฐานข้อมูลคือ statement ต่อด้วยรหัสบัญชี", () => {
  // รูปแบบเดิมคือ statement885 อยู่แล้ว แถวที่เก็บไว้ก่อนหน้านี้จึงเข้ากันได้เลย
  assert.equal(statementKind("885"), "statement885");
  assert.equal(statementKind("SCB1"), "statementSCB1");
  assert.equal(codeOfStatementKind("statement885"), "885");
  assert.ok(isStatementKind("statement987"));
  assert.ok(!isStatementKind("collection"));
});

test("ทุกชนิดมีรูปแบบชื่อที่เอาไปบอกผู้ใช้ได้", () => {
  for (const [kind, spec] of Object.entries(DOCUMENT_KINDS)) {
    assert.ok(spec.pattern, `${kind} ต้องมี pattern ไว้แสดงบนหน้าจอ`);
    assert.ok(spec.label, `${kind} ต้องมี label`);
  }
  assert.equal(DOCUMENT_KINDS.statement.pattern, "*.pdf");
});

// ── ไฟล์ที่ผิดรูปแบบ ────────────────────────────────────────────────────────
//
// ชื่อไฟล์ถูกไม่ได้แปลว่าข้างในถูก ตัวอ่านต้องบอกให้คนแก้ถูกจุด ไม่ใช่พังเป็น
// ข้อความของภาษาโปรแกรม — บั๊กจริงที่เจอคือ PDF ที่อ่านข้อความไม่ออกทำให้เกิด
// "undefined is not iterable" ซึ่งขึ้นหน้าจอผู้ใช้ว่า "e is not iterable"

test("PDF ที่อ่านข้อความไม่ออก บอกได้ว่าต้องใช้ไฟล์แบบไหน", () => {
  const scanned = Buffer.from("%PDF-1.4\nอะไรสักอย่าง\n%%EOF", "utf8");

  assert.throws(
    () => parseDocument("statement", scanned, "statement.pdf"),
    (error) => {
      assert.doesNotMatch(error.message, /is not iterable|undefined|null/, "ต้องไม่ใช่ข้อความของภาษาโปรแกรม");
      assert.match(error.message, /รูปภาพ|ธนาคารออกให้/, "ต้องบอกว่าต้องใช้ไฟล์แบบไหนแทน");
      return true;
    },
  );
});

test("ไฟล์ที่ไม่ใช่ .xlsx จริง บอกได้ว่าผิดตรงไหน", () => {
  const notAWorkbook = Buffer.from("ไม่ใช่ zip", "utf8");

  assert.throws(
    () => parseDocument("collection", notAWorkbook, "รายงานการรับเงิน.xlsx"),
    (error) => {
      assert.doesNotMatch(error.message, /central directory|ZIP/i, "ต้องไม่พูดภาษาของ zip");
      assert.match(error.message, /\.xlsx/);
      return true;
    },
  );
});

// ── ตรวจไฟล์ที่เลือกไว้ ก่อนกดอัปโหลด ───────────────────────────────────────

const pick = (name, size = 1024) => ({ name, size });
const problems = (files) => inspectPickedFiles(files).map((item) => item.problem);

test("Statement หลายบัญชีในครั้งเดียวคือการใช้งานปกติ ไม่ใช่ไฟล์ซ้ำ", () => {
  // บั๊กจริง: พอ PDF ทุกใบเป็นชนิด statement เหมือนกัน ตัวเช็คซ้ำที่เขียนไว้ตอน
  // statement885/statement987 เป็นคนละชนิด กลับหาว่าไฟล์คนละบัญชีเป็นไฟล์ซ้ำ
  const picked = inspectPickedFiles([
    pick("Statement_885_สิงหาคม_2569_TEST.pdf"),
    pick("Statement_987_สิงหาคม_2569_TEST.pdf"),
    pick("บันทึกบัญชีแยกประเภท_สิงหาคม_2569_TEST.xlsx"),
    pick("รายงานการรับเงิน_สิงหาคม_2569_TEST.xlsx"),
  ]);

  assert.deepEqual(picked.map((item) => item.problem), [null, null, null, null]);
  assert.deepEqual(picked.map((item) => item.kind), ["statement", "statement", "ledger", "collection"]);
});

test("เอกสารที่มีได้ใบเดียวต่อรอบ ยังถูกจับได้เมื่อหยิบมาซ้ำ", () => {
  const twoLedgers = problems([
    pick("บันทึกบัญชีแยกประเภท (1).xlsx"),
    pick("บันทึกบัญชีแยกประเภท (2).xlsx"),
  ]);

  assert.ok(twoLedgers.every((problem) => problem?.includes("ซ้ำ")), "สองใบแปลว่าหยิบผิด");
  assert.deepEqual(problems([pick("รายงานการรับเงิน (1).xlsx"), pick("รายงานการรับเงิน (2).xlsx")]).filter(Boolean).length, 2);
});

test("ไฟล์ว่าง ไฟล์ใหญ่เกิน และชื่อที่ไม่รู้จัก ถูกบอกเหตุผลรายไฟล์", () => {
  assert.equal(problems([pick("statement.pdf", 0)])[0], "ไฟล์ว่าง");
  assert.equal(problems([pick("statement.pdf", 26 * 1024 * 1024)])[0], "ใหญ่เกิน 25 MB");
  assert.equal(problems([pick("อะไรก็ไม่รู้.docx")])[0], "ไม่รู้จักชนิดเอกสารจากชื่อนี้");
  assert.match(problems([pick("บัญชีแยกประเภท และ รายงานการรับเงิน.xlsx")])[0], /หลายชนิด/);
});
