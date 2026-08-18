import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { extractPdfTextFromBuffer, groupIntoLines } from "./pdf.mjs";
import { bankLabels, detectBank } from "./banks/index.mjs";

// ตัวอ่าน Statement — ส่วนที่ไม่ขึ้นกับธนาคาร
//
// หน้าที่ของไฟล์นี้มีสามอย่าง: ดึงข้อความพร้อมพิกัดออกจาก PDF, เลือกว่าเอกสารนี้
// เป็นของธนาคารไหน, แล้วตรวจว่าสิ่งที่ adapter อ่านมาครบจริง
//
// ข้อสุดท้ายสำคัญที่สุด ยอดคุม (ยอดยกมา + ฝาก − ถอน = ยอดยกไป) เป็นข้อพิสูจน์ว่า
// อ่านครบทุกบรรทัด ตกไปบรรทัดเดียวก็ไม่ลงตัว การบังคับข้อนี้กับทุกธนาคารเท่ากัน
// คือสิ่งที่ทำให้เพิ่มธนาคารได้โดยไม่ต้องเชื่อ adapter ตัวใหม่แบบไม่มีเงื่อนไข

/** Parses a bank statement PDF into canonical lines. */
export function parseStatementPdf(path) {
  return parseStatementBuffer(readFileSync(path), basename(path));
}

/** Same, for a statement already in memory — an upload, for instance. */
export function parseStatementBuffer(buffer, sourceName) {
  const pages = extractPdfTextFromBuffer(buffer);
  const allLines = pages.map((page) => groupIntoLines(page));

  // ไม่มีหน้าไหนมีข้อความให้อ่านเลย — เช่นไฟล์ที่สแกนมาเป็นรูป ถ้าปล่อยผ่าน
  // บรรทัดถัดไปจะพังเป็น "undefined is not iterable" ซึ่งบอกอะไรใครไม่ได้เลย
  if (!allLines.length || !allLines[0]) {
    throw new Error("อ่านข้อความในไฟล์ไม่ได้เลย — ไฟล์ที่สแกนมาเป็นรูปภาพใช้ไม่ได้ ต้องเป็น PDF ที่ธนาคารออกให้โดยตรง");
  }

  const bank = detectBank(allLines);
  if (!bank) {
    throw new Error(`ไม่รู้จักรูปแบบ Statement ของเอกสารนี้ — ตอนนี้ระบบอ่านได้: ${bankLabels()}`);
  }

  const read = bank.parse(allLines);

  if (!read.accountNo) {
    throw new Error(`อ่านเลขที่บัญชีจากเอกสารไม่ได้ (${bank.label})`);
  }
  if (!read.lines.length) {
    throw new Error(`ไม่มีรายการเดินบัญชีให้อ่านสักบรรทัด (${bank.label})`);
  }

  const credits = read.lines.filter((line) => line.direction === "credit");
  const debits = read.lines.filter((line) => line.direction === "debit");
  const creditSatang = credits.reduce((sum, line) => sum + line.amountSatang, 0);
  const debitSatang = debits.reduce((sum, line) => sum + line.amountSatang, 0);
  const openingSatang = read.openingSatang ?? 0;
  const closingSatang = read.closingSatang ?? 0;
  const controlDeltaSatang = openingSatang + creditSatang - debitSatang - closingSatang;

  // ยอดคุมไม่ลงตัว = อ่านมาไม่ครบ ตัวเลขชุดนี้เอาไปกระทบยอดไม่ได้ และการรับไว้
  // เงียบ ๆ แย่กว่าการปฏิเสธ เพราะไม่มีใครรู้ว่าขาดบรรทัดไหนไป
  if (controlDeltaSatang !== 0) {
    throw new Error(
      `ยอดคุมของ Statement ไม่ลงตัว ต่างอยู่ ${(controlDeltaSatang / 100).toFixed(2)} บาท `
      + "— แปลว่าอ่านรายการมาไม่ครบ ระบบจึงไม่รับไฟล์นี้",
    );
  }

  return {
    bank: bank.id,
    bankLabel: bank.label,
    source: sourceName,
    accountNo: read.accountNo,
    accountName: read.accountName ?? "",
    branch: read.branch ?? "",
    reference: read.reference ?? "",
    cycle: read.cycle ?? "",
    suffix: read.suffix ?? "",
    openingSatang,
    closingSatang,
    creditSatang,
    debitSatang,
    creditCount: credits.length,
    debitCount: debits.length,
    controlDeltaSatang,
    lines: read.lines,
  };
}
