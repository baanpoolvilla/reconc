import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ตัวสร้าง Statement PDF สำหรับทดสอบ
//
// ตัวอ่านของแต่ละธนาคารยึด "ตำแหน่ง" ของข้อความ ไม่ใช่ลำดับ เพราะบรรทัดหนึ่งมี
// ตัวเลขได้หลายก้อนและมีแต่พิกัดที่บอกได้ว่าก้อนไหนคือยอดเงิน ก้อนไหนคือยอดคงเหลือ
// ไฟล์ทดสอบที่วางข้อความคนละที่จึงอ่านไม่ออก แม้เนื้อหาจะถูกทุกตัว
//
// สคริปต์นี้วางข้อความตรงพิกัดเดียวกับที่ K BIZ ใช้ ไฟล์ที่ได้จึงเดินผ่านตัวอ่าน
// ตัวจริงทุกขั้นรวมถึงด่านยอดคุม โดยไม่ต้องเอาเอกสารการเงินจริงมาไว้ในเครื่อง
//
//   node scripts/make-statement-pdf.mjs --account 199-1-33588-5 --month 2026-08 --out data/885.pdf
//
// ทุกยอดเป็นจำนวนเต็มสตางค์ และยอดคงเหลือเดินต่อกันจริง ยอดคุมจึงลงตัวเสมอ
// (ยอดยกมา + ฝาก − ถอน = ยอดยกไป) ซึ่งเป็นเงื่อนไขที่ระบบบังคับกับทุกธนาคาร

const PAGE = { width: 595, height: 842 };

// พิกัดคอลัมน์ที่ lib/parsers/banks/kbank.mjs อ่าน — ต้องตรงกัน ไม่งั้นไฟล์ที่สร้าง
// ก็จะเป็นไฟล์ที่ "หน้าตาเหมือน" แต่ระบบอ่านไม่ออก เหมือนที่เจอมาแล้ว
const COLUMN = { date: 40, time: 78, description: 120, amount: 240, balance: 300, channel: 340, detail: 405 };

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index]?.startsWith("--")) out[argv[index].slice(2)] = argv[index + 1];
  }
  return out;
}

/** ข้อความไทยใน PDF ต้องผ่าน CMap ที่เราประกาศเอง จึงเก็บตัวอักษรที่ใช้ทั้งหมดไว้ */
function buildFont(texts) {
  const characters = [...new Set(texts.join("").split(""))].filter((character) => character !== "\n");
  const codeOf = new Map(characters.map((character, index) => [character, index + 1]));
  const entries = characters
    .map((character) => `<${codeOf.get(character).toString(16).padStart(4, "0").toUpperCase()}> <${character.codePointAt(0).toString(16).padStart(4, "0").toUpperCase()}>`)
    .join("\n");

  const cmap = [
    "/CIDInit /ProcSet findresource begin",
    "begincmap",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    `${characters.length} beginbfchar`,
    entries,
    "endbfchar",
    "endcmap end",
  ].join("\n");

  return { codeOf, cmap };
}

const escapePdf = (bytes) => bytes.map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");

/** ข้อความหนึ่งชิ้นที่พิกัด (x, y) — ใช้ Tm แบบเดียวกับที่ตัวอ่านรู้จัก */
function draw(text, x, y, codeOf) {
  const bytes = [];
  for (const character of text) {
    const code = codeOf.get(character);
    if (code === undefined) continue;
    bytes.push((code >> 8) & 0xff, code & 0xff);
  }
  if (!bytes.length) return "";
  return `BT /F1 9 Tf 1 0 0 1 ${x} ${y} Tm (${escapePdf(bytes)}) Tj ET\n`;
}

const money = (satang) => (satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thaiDate = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y.slice(2)}`; };

/**
 * รายการเดินบัญชีสมมติของหนึ่งเดือน
 * ยอดคงเหลือเดินต่อกันจริง เพื่อให้ direction ที่ตัวอ่านคำนวณจากผลต่างถูกต้อง
 */
function buildLines(month, openingSatang, count) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const lines = [];
  let balance = openingSatang;

  for (let index = 0; index < count; index += 1) {
    const day = Math.min(daysInMonth, 1 + Math.floor((index * daysInMonth) / count));
    // ก้อนที่ลงท้าย 7 เป็นรายการถอน ที่เหลือเป็นเงินเข้า — ให้มีทั้งสองทางในไฟล์เดียว
    const debit = index % 7 === 6;
    const amountSatang = (debit ? 60000 : 250000) + (index % 9) * 50000;
    balance += debit ? -amountSatang : amountSatang;

    lines.push({
      date: `${month}-${String(day).padStart(2, "0")}`,
      time: `${String(9 + (index % 8)).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}`,
      description: debit ? "ถอนเงิน" : "รับโอนเงิน",
      channel: debit ? "K BIZ" : "Internet/Mobile KBank",
      detail: `TEST-${String(index + 1).padStart(4, "0")}`,
      amountSatang,
      balanceSatang: balance,
      debit,
    });
  }
  return lines;
}

function makeStatementPdf({ accountNo, accountName, branch, month, openingSatang, count }) {
  const [year, monthNumber] = month.split("-");
  const lastDay = new Date(Date.UTC(Number(year), Number(monthNumber), 0)).getUTCDate();
  const cycle = `01/${monthNumber}/${year} - ${lastDay}/${monthNumber}/${year}`;
  const lines = buildLines(month, openingSatang, count);

  const header = [
    ["ชื่อบัญชี", accountName],
    ["เลขที่บัญชีเงินฝาก", accountNo],
    ["สาขาเจ้าของบัญชี", branch],
    ["เลขที่อ้างอิง", `TEST-${year}${monthNumber}`],
    ["รอบระหว่างวันที่", cycle],
  ];

  const everyText = [
    ...header.flat(),
    ...lines.flatMap((line) => [line.description, line.channel, line.detail, line.time, thaiDate(line.date), money(line.amountSatang), money(line.balanceSatang)]),
    money(openingSatang),
    "ยอดยกมา", "วันที่", "เวลา", "รายการ", "ถอน / ฝาก", "ยอดคงเหลือ", "ช่องทาง", "รายละเอียด",
  ];
  const { codeOf, cmap } = buildFont(everyText);

  // หัวเอกสาร — ป้ายกับค่าต้องเป็นสอง run ติดกันบนบรรทัดเดียว ตัวอ่านหยิบ run ถัดไป
  let content = "";
  let y = PAGE.height - 60;
  for (const [label, value] of header) {
    content += draw(label, 40, y, codeOf);
    content += draw(value, 160, y, codeOf);
    y -= 14;
  }

  y -= 16;
  content += draw("วันที่", COLUMN.date, y, codeOf);
  content += draw("เวลา", COLUMN.time, y, codeOf);
  content += draw("รายการ", COLUMN.description, y, codeOf);
  content += draw("ถอน / ฝาก", COLUMN.amount, y, codeOf);
  content += draw("ยอดคงเหลือ", COLUMN.balance, y, codeOf);
  content += draw("ช่องทาง", COLUMN.channel, y, codeOf);
  content += draw("รายละเอียด", COLUMN.detail, y, codeOf);

  // ยอดยกมา — บรรทัดที่มีวันที่แต่ไม่มีเวลา คือวิธีที่ตัวอ่านรู้ว่านี่คือยอดตั้งต้น
  y -= 16;
  content += draw(thaiDate(`${month}-01`), COLUMN.date, y, codeOf);
  content += draw("ยอดยกมา", COLUMN.description, y, codeOf);
  content += draw(money(openingSatang), COLUMN.balance, y, codeOf);

  for (const line of lines) {
    y -= 14;
    content += draw(thaiDate(line.date), COLUMN.date, y, codeOf);
    content += draw(line.time, COLUMN.time, y, codeOf);
    content += draw(line.description, COLUMN.description, y, codeOf);
    content += draw(money(line.amountSatang), COLUMN.amount, y, codeOf);
    content += draw(money(line.balanceSatang), COLUMN.balance, y, codeOf);
    content += draw(line.channel, COLUMN.channel, y, codeOf);
    content += draw(line.detail, COLUMN.detail, y, codeOf);
  }

  const cmapStream = deflateSync(Buffer.from(cmap, "latin1"));
  const contentStream = deflateSync(Buffer.from(content, "latin1"));

  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  const push = (text) => parts.push(Buffer.from(text, "latin1"));

  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>\nendobj\n`);
  push("4 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /TestFont /Encoding /Identity-H /ToUnicode 5 0 R >>\nendobj\n");
  push(`5 0 obj\n<< /Filter [ /FlateDecode ] /Length ${cmapStream.length} >>\nstream\n`);
  parts.push(cmapStream);
  push("\nendstream\nendobj\n");
  push(`6 0 obj\n<< /Filter [ /FlateDecode ] /Length ${contentStream.length} >>\nstream\n`);
  parts.push(contentStream);
  push("\nendstream\nendobj\n%%EOF\n");

  return { pdf: Buffer.concat(parts), lines, cycle };
}

export { makeStatementPdf };

const isMain = process.argv[1]?.endsWith("make-statement-pdf.mjs");
if (isMain) {
  const options = args(process.argv.slice(2));
  const month = options.month ?? "2026-08";
  const accountNo = options.account ?? "199-1-33588-5";
  const out = options.out ?? `statement-${month}.pdf`;

  const { pdf, lines, cycle } = makeStatementPdf({
    accountNo,
    accountName: options.name ?? "บริษัททดสอบ จำกัด",
    branch: options.branch ?? "สาขาทดสอบ",
    month,
    openingSatang: Number(options.opening ?? 5000000),
    count: Number(options.lines ?? 40),
  });

  writeFileSync(out, pdf);
  const credits = lines.filter((line) => !line.debit);
  console.log(`เขียน ${out}`);
  console.log(`  บัญชี ${accountNo} · รอบ ${cycle}`);
  console.log(`  ${lines.length} รายการ (เงินเข้า ${credits.length} / เงินออก ${lines.length - credits.length})`);
  console.log("  ตรวจด้วย: node --test tests/statement-generator.test.mjs");
}
