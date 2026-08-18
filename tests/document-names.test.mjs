import assert from "node:assert/strict";
import test from "node:test";

import { DOCUMENT_KINDS, detectDocumentKind, isAmbiguousDocumentName } from "../lib/parsers/documents.mjs";

// ระบบดูชนิดเอกสารจากชื่อไฟล์อย่างเดียว กฎการอ่านชื่อจึงต้องทนกับความจริงว่า
// คนดาวน์โหลดไฟล์มาแล้วตั้งชื่อใหม่ให้ตัวเองอ่านรู้เรื่อง — โดยไม่หลวมจนเดาผิด

test("ชื่อที่ธนาคารและ PMS ออกให้ ยังอ่านออกเหมือนเดิม", () => {
  assert.equal(detectDocumentKind("885resultFile_20260805_133241.pdf"), "statement885");
  assert.equal(detectDocumentKind("987resultFile_20260805_133150.pdf"), "statement987");
  assert.equal(detectDocumentKind("บันทึกบัญชีแยกประเภท (1).xlsx"), "ledger");
  assert.equal(detectDocumentKind("รายงานการรับเงิน (2).xlsx"), "collection");
});

test("ชื่อที่คนตั้งเองให้อ่านรู้เรื่อง ก็ต้องอ่านออก", () => {
  // เดิมกฎคือ "ต้องขึ้นต้นด้วยเลขบัญชี" ไฟล์ที่ถูกต้องทุกประการจึงถูกปฏิเสธ
  // เพียงเพราะมีคำว่า Statement_ นำหน้า
  assert.equal(detectDocumentKind("Statement_885_สิงหาคม_2569_TEST.pdf"), "statement885");
  assert.equal(detectDocumentKind("Statement_987_สิงหาคม_2569_TEST.pdf"), "statement987");
  assert.equal(detectDocumentKind("บันทึกบัญชีแยกประเภท_สิงหาคม_2569_TEST.xlsx"), "ledger");
  assert.equal(detectDocumentKind("รายงานการรับเงิน_สิงหาคม_2569_TEST.xlsx"), "collection");
  assert.equal(detectDocumentKind("สำเนา 885 ส.ค. 69.pdf"), "statement885");
});

test("นามสกุลไฟล์ไม่สนตัวพิมพ์", () => {
  assert.equal(detectDocumentKind("885_สิงหาคม.PDF"), "statement885");
  assert.equal(detectDocumentKind("รายงานการรับเงิน.XLSX"), "collection");
});

test("เลขบัญชีต้องเป็นก้อนตัวเลขของตัวเอง ไม่ใช่เศษของเลขอื่น", () => {
  // 885 ที่เป็นท้ายของ 20260885 ไม่ใช่เลขบัญชี — เดาแบบนั้นคือเก็บเข้าบัญชีผิด
  assert.equal(detectDocumentKind("Statement_20260885.pdf"), null);
  assert.equal(detectDocumentKind("resultFile_9871234.pdf"), null);
});

test("ชนิดไฟล์ต้องตรงด้วย ไม่ใช่ดูแค่ชื่อ", () => {
  assert.equal(detectDocumentKind("885_สิงหาคม.xlsx"), null, "statement ต้องเป็น PDF");
  assert.equal(detectDocumentKind("รายงานการรับเงิน.pdf"), null, "รายงานต้องเป็น xlsx");
});

test("ชื่อที่เข้าได้สองชนิดถูกปฏิเสธ ไม่ใช่เดาเอาชนิดแรก", () => {
  const both = "Statement_885_987_สิงหาคม.pdf";

  assert.equal(isAmbiguousDocumentName(both), true);
  assert.equal(detectDocumentKind(both), null, "กำกวมต้องให้คนไปแก้ชื่อ ไม่ใช่เก็บเข้าบัญชีที่เจอก่อน");
  assert.equal(isAmbiguousDocumentName("885resultFile_20260805_133241.pdf"), false);
});

test("ชื่อที่ไม่เข้าเลยยังถูกปฏิเสธตามเดิม", () => {
  assert.equal(detectDocumentKind("อะไรก็ไม่รู้.pdf"), null);
  assert.equal(detectDocumentKind("report.xlsx"), null);
  assert.equal(detectDocumentKind(""), null);
});

test("ทุกชนิดมีรูปแบบชื่อที่เอาไปบอกผู้ใช้ได้", () => {
  for (const [kind, spec] of Object.entries(DOCUMENT_KINDS)) {
    assert.ok(spec.pattern, `${kind} ต้องมี pattern ไว้แสดงบนหน้าจอ`);
    assert.ok(spec.label, `${kind} ต้องมี label`);
  }
  assert.equal(DOCUMENT_KINDS.statement885.pattern, "*885*.pdf");
});

// ── ไฟล์ที่ผิดรูปแบบ ────────────────────────────────────────────────────────
//
// ชื่อไฟล์ถูกไม่ได้แปลว่าข้างในถูก ตัวอ่านต้องบอกให้คนแก้ถูกจุด ไม่ใช่พังเป็น
// ข้อความของภาษาโปรแกรม — บั๊กจริงที่เจอคือ PDF ที่อ่านข้อความไม่ออกทำให้เกิด
// "undefined is not iterable" ซึ่งขึ้นหน้าจอผู้ใช้ว่า "e is not iterable"

test("PDF ที่ไม่ใช่ Statement ของ K BIZ บอกได้ว่าต้องใช้ไฟล์แบบไหน", async () => {
  const { parseDocument } = await import("../lib/parsers/documents.mjs");
  const notAStatement = Buffer.from("%PDF-1.4\nอะไรสักอย่าง\n%%EOF", "utf8");

  assert.throws(
    () => parseDocument("statement885", notAStatement, "Statement_885_สิงหาคม.pdf"),
    (error) => {
      assert.doesNotMatch(error.message, /is not iterable|undefined|null/, "ต้องไม่ใช่ข้อความของภาษาโปรแกรม");
      assert.match(error.message, /Statement_885_สิงหาคม\.pdf/, "ต้องบอกว่าไฟล์ไหน");
      assert.match(error.message, /K BIZ/, "ต้องบอกว่าต้องใช้ไฟล์แบบไหนแทน");
      return true;
    },
  );
});

test("ไฟล์ที่ไม่ใช่ .xlsx จริง บอกได้ว่าผิดตรงไหน", async () => {
  const { parseDocument } = await import("../lib/parsers/documents.mjs");
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
