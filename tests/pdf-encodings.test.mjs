import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { extractPdfTextFromBuffer, groupIntoLines } from "../lib/parsers/pdf.mjs";

// วิธีเข้ารหัสที่ PDF อนุญาต แต่ตัวอ่านเคยรองรับแบบเดียว
//
// PDF ปล่อยให้ไฟล์เลือกได้ว่าจะบีบอัด stream กี่ชั้น และรหัสตัวอักษรกว้างกี่ไบต์
// ตัวอ่านเคยรองรับเฉพาะแบบที่ K BIZ ใช้ ไฟล์ที่ถูกต้องตามมาตรฐานแต่เข้ารหัสคนละแบบ
// จึงถูกอ่านว่า "ไม่มีข้อความในไฟล์เลย" ซึ่งชี้ให้คนไปสงสัยไฟล์ของตัวเอง ทั้งที่
// ตัวอ่านเป็นฝ่ายทำไม่ได้
//
// PDF ในไฟล์นี้ประกอบขึ้นเองทั้งหมด จึงไม่ต้องพึ่งเอกสารจริงที่ commit ไม่ได้

/** ASCII85 ตามที่ PDF spec นิยาม — ด้านเข้ารหัส มีไว้ทดสอบด้านถอด */
function encodeAscii85(buffer) {
  let out = "";
  for (let index = 0; index < buffer.length; index += 4) {
    const chunk = buffer.subarray(index, index + 4);
    let value = 0;
    for (let byte = 0; byte < 4; byte += 1) value = value * 256 + (chunk[byte] ?? 0);
    const digits = [];
    for (let position = 0; position < 5; position += 1) {
      digits.unshift(String.fromCharCode(33 + (value % 85)));
      value = Math.floor(value / 85);
    }
    out += digits.slice(0, chunk.length + 1).join("");
  }
  return `${out}~>`;
}

/**
 * PDF เล็กที่สุดที่มีข้อความหนึ่งบรรทัด
 *
 * รหัสตัวอักษรใส่เป็นไบต์ดิบใน string literal ซึ่ง PDF อนุญาต และตรงกับที่เอกสาร
 * จริงทำ — ไม่ต้องใช้ octal escape ให้สับสน
 *
 * @param {object} options
 * @param {1|2} options.codeWidth ความกว้างของรหัสตัวอักษร (ไบต์)
 * @param {boolean} options.ascii85 ห่อ content stream ด้วย ASCII85 ก่อน Flate ไหม
 */
function makePdf({ codeWidth, ascii85 }) {
  const hex = (code) => code.toString(16).padStart(codeWidth * 2, "0").toUpperCase();

  // รหัส 1 และ 2 หมายถึง "ก" (U+0E01) และ "ข" (U+0E02)
  const cmap = [
    "/CIDInit /ProcSet findresource begin",
    "begincmap",
    "1 begincodespacerange",
    `<${hex(0)}> <${hex(codeWidth === 1 ? 0xff : 0xffff)}>`,
    "endcodespacerange",
    "2 beginbfchar",
    `<${hex(1)}> <0E01>`,
    `<${hex(2)}> <0E02>`,
    "endbfchar",
    "endcmap end",
  ].join("\n");

  const codes = codeWidth === 1 ? [1, 2] : [0, 1, 0, 2];
  const literal = String.fromCharCode(...codes);
  const content = `BT 1 0 0 1 120 700 Tm /F1 12 Tf (${literal}) Tj ET`;

  const cmapFlate = deflateSync(Buffer.from(cmap, "latin1"));
  const contentFlate = deflateSync(Buffer.from(content, "latin1"));
  const body = ascii85 ? Buffer.from(encodeAscii85(contentFlate), "latin1") : contentFlate;
  const filter = ascii85 ? "[ /ASCII85Decode /FlateDecode ]" : "[ /FlateDecode ]";

  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter [ /FlateDecode ] >>\nstream\n", "latin1"),
    cmapFlate,
    Buffer.from(`\nendstream\nendobj\n2 0 obj\n<< /Filter ${filter} >>\nstream\n`, "latin1"),
    body,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
}

function textOf(pdf) {
  const [page] = extractPdfTextFromBuffer(pdf);
  assert.ok(page, "ต้องอ่านได้อย่างน้อยหนึ่งหน้า");
  return groupIntoLines(page)[0].runs.map((run) => run.text).join("");
}

test("รหัสตัวอักษร 2 ไบต์ กับ Flate ชั้นเดียว — แบบที่ K BIZ ใช้", () => {
  assert.equal(textOf(makePdf({ codeWidth: 2, ascii85: false })), "กข");
});

test("รหัสตัวอักษร 1 ไบต์ ก็ต้องอ่านออก", () => {
  // การบังคับว่ารหัสกว้าง 2 ไบต์เสมอ ทำให้ไฟล์แบบนี้ถอดออกมาเป็นข้อความว่างทั้งไฟล์
  assert.equal(textOf(makePdf({ codeWidth: 1, ascii85: false })), "กข");
});

test("stream ที่เข้ารหัส ASCII85 ทับ Flate ถูกถอดตามลำดับที่ /Filter ประกาศ", () => {
  assert.equal(textOf(makePdf({ codeWidth: 2, ascii85: true })), "กข");
});

test("ทั้งสองอย่างพร้อมกัน — รหัส 1 ไบต์ และเข้ารหัสสองชั้น", () => {
  assert.equal(textOf(makePdf({ codeWidth: 1, ascii85: true })), "กข");
});

test("พิกัดของข้อความยังอ่านได้ เพราะการแบ่งคอลัมน์ของ statement ใช้พิกัด", () => {
  const [page] = extractPdfTextFromBuffer(makePdf({ codeWidth: 1, ascii85: true }));

  assert.equal(page.runs[0].x, 120);
  assert.equal(page.runs[0].y, 700);
});
