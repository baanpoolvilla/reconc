import assert from "node:assert/strict";
import test from "node:test";

import { readWorkbookBuffer } from "../lib/parsers/xlsx.mjs";

// รูปร่างของไฟล์ .xlsx ที่ถูกต้องตามมาตรฐาน แต่เขียนคนละแบบกัน
//
// OOXML ปล่อยให้เครื่องมือที่สร้างไฟล์เลือกได้หลายอย่าง และตัวอ่านของเราเคยรับ
// ได้แบบเดียว: แบบที่ Excel เขียน ไฟล์จากเครื่องมืออื่นที่ถูกต้องทุกประการจึงถูก
// อ่านเป็น "ไม่มีชีตข้อมูล" ซึ่งเป็นข้อความที่ทำให้คนไปนั่งแก้ไฟล์ที่ไม่ได้ผิด
//
// ไฟล์ในเทสต์นี้ประกอบขึ้นเองทั้งหมด จึงไม่ต้องพึ่งเอกสารจริงที่ commit ไม่ได้

/** ZIP แบบไม่บีบอัด พอสำหรับประกอบ .xlsx ขึ้นมาทดสอบ */
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const body = Buffer.from(content, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);           // stored
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 10);          // stored
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, end]);
}

const sheetXml = (prefix) => `<?xml version="1.0"?>
<${prefix}worksheet xmlns:x="http://x">
  <${prefix}sheetData>
    <${prefix}row r="1">
      <${prefix}c r="A1" t="s"><${prefix}v>0</${prefix}v></${prefix}c>
      <${prefix}c r="B1" t="s"><${prefix}v>1</${prefix}v></${prefix}c>
    </${prefix}row>
    <${prefix}row r="2">
      <${prefix}c r="A2"><${prefix}v>42</${prefix}v></${prefix}c>
      <${prefix}c r="B2" t="inlineStr"><${prefix}is><${prefix}t>สวัสดี</${prefix}t></${prefix}is></${prefix}c>
    </${prefix}row>
  </${prefix}sheetData>
</${prefix}worksheet>`;

const sharedXml = (prefix) => `<?xml version="1.0"?>
<${prefix}sst xmlns:x="http://x">
  <${prefix}si><${prefix}t>Date</${prefix}t></${prefix}si>
  <${prefix}si><${prefix}t>Amount</${prefix}t></${prefix}si>
</${prefix}sst>`;

function workbook({ prefix = "", targetFirst = false } = {}) {
  const relationship = targetFirst
    ? '<Relationship Type="http://x/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R1" />'
    : '<Relationship Id="R1" Type="http://x/worksheet" Target="worksheets/sheet1.xml" />';

  return makeZip({
    "xl/workbook.xml": `<?xml version="1.0"?><${prefix}workbook xmlns:x="http://x"><${prefix}sheets><${prefix}sheet name="Sheet1" sheetId="1" r:id="R1" xmlns:r="http://r" /></${prefix}sheets></${prefix}workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://p">${relationship}</Relationships>`,
    "xl/sharedStrings.xml": sharedXml(prefix),
    "xl/worksheets/sheet1.xml": sheetXml(prefix),
  });
}

const expectedRows = [["Date", "Amount"], ["42", "สวัสดี"]];

test("ไฟล์แบบที่ Excel เขียน อ่านได้ตามเดิม", () => {
  const [sheet] = readWorkbookBuffer(workbook());

  assert.equal(sheet.name, "Sheet1");
  assert.deepEqual(sheet.rows, expectedRows);
});

test("ไฟล์ที่ใช้ namespace prefix ทุกแท็ก ก็ต้องอ่านได้", () => {
  // <x:sheet/> <x:row/> <x:c/> ถูกต้องตามมาตรฐานเท่ากับแบบไม่มี prefix
  const [sheet] = readWorkbookBuffer(workbook({ prefix: "x:" }));

  assert.ok(sheet, "ไฟล์ที่มี prefix ต้องไม่ถูกอ่านเป็นไม่มีชีต");
  assert.deepEqual(sheet.rows, expectedRows);
});

test("ลำดับ attribute ในไฟล์ rels ไม่มีความหมาย", () => {
  // บางเครื่องมือเขียน Target ก่อน Id และใส่ path เต็มขึ้นต้นด้วย /xl/
  const [sheet] = readWorkbookBuffer(workbook({ targetFirst: true }));

  assert.ok(sheet, "อ่าน Target ที่มาก่อน Id ไม่ได้ = หาชีตไม่เจอ");
  assert.deepEqual(sheet.rows, expectedRows);
});

test("ทั้งสองอย่างพร้อมกัน — prefix และ Target มาก่อน Id", () => {
  const [sheet] = readWorkbookBuffer(workbook({ prefix: "x:", targetFirst: true }));

  assert.ok(sheet);
  assert.deepEqual(sheet.rows, expectedRows);
});

test("ไฟล์ที่ไม่มีชีตจริง ๆ ยังคืนค่าว่าง ไม่ใช่เดาให้", () => {
  const empty = makeZip({
    "xl/workbook.xml": '<?xml version="1.0"?><workbook><sheets/></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships/>',
  });

  assert.deepEqual(readWorkbookBuffer(empty), []);
});
