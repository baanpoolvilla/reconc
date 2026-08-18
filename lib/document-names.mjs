// ชนิดเอกสารและกฎการอ่านชื่อไฟล์
//
// แยกจาก lib/parsers/documents.mjs โดยตั้งใจ: ไฟล์นี้เป็นข้อความล้วน ไม่ import
// node:fs หรือ node:zlib หน้าจอฝั่งเบราว์เซอร์จึงบอกได้ทันทีว่าไฟล์ที่เพิ่งเลือกมา
// เป็นเอกสารชนิดไหน โดยไม่ลาก zip/pdf/xlsx reader ทั้งชุดเข้าไปอยู่ใน bundle

const hasExtension = (name, extension) => String(name).toLowerCase().endsWith(extension);

/**
 * เลขบัญชีปรากฏในชื่อไฟล์แบบเป็นก้อนตัวเลขของตัวเอง
 *
 * เดิมกฎคือ "ชื่อไฟล์ต้องขึ้นต้นด้วยเลขบัญชี" ซึ่งตรงกับที่ K BIZ ตั้งชื่อให้พอดี
 * (885resultFile_...) แต่พอคนดาวน์โหลดมาแล้วตั้งชื่อใหม่ให้อ่านรู้เรื่อง เช่น
 * Statement_885_สิงหาคม.pdf ไฟล์ที่ถูกต้องทุกประการกลับถูกปฏิเสธ
 *
 * ขอบเขตของตัวเลขสำคัญ: 885 ใน "Statement_885_" นับ แต่ 885 ใน "20260885" ไม่นับ
 * เพราะมันเป็นส่วนหนึ่งของเลขอื่น ไม่ใช่เลขบัญชี
 */
const hasAccountCode = (name, code) => new RegExp(String.raw`(?:^|\D)${code}(?:\D|$)`).test(String(name));

export const DOCUMENT_KINDS = {
  ledger: {
    label: "บัญชีแยกประเภท",
    accept: ".xlsx",
    pattern: "*บัญชีแยกประเภท*.xlsx",
    detail: "ไฟล์ Excel ที่มีคอลัมน์ Reservation Creation Time",
    matches: (name) => String(name).includes("บัญชีแยกประเภท") && hasExtension(name, ".xlsx"),
  },
  collection: {
    label: "รายงานการรับเงิน",
    accept: ".xlsx",
    pattern: "*รายงานการรับเงิน*.xlsx",
    detail: "ไฟล์ Excel ที่มีคอลัมน์ Date, Payment Method, Amount",
    matches: (name) => String(name).includes("รายงานการรับเงิน") && hasExtension(name, ".xlsx"),
  },
  statement885: {
    label: "Statement บัญชี 885",
    accept: ".pdf",
    pattern: "*885*.pdf",
    detail: "PDF จาก K BIZ · ชื่อไฟล์ต้องมีเลข 885 อยู่",
    matches: (name) => hasAccountCode(name, "885") && hasExtension(name, ".pdf"),
  },
  statement987: {
    label: "Statement บัญชี 987",
    accept: ".pdf",
    pattern: "*987*.pdf",
    detail: "PDF จาก K BIZ · ชื่อไฟล์ต้องมีเลข 987 อยู่",
    matches: (name) => hasAccountCode(name, "987") && hasExtension(name, ".pdf"),
  },
};

export const STATEMENT_ACCOUNTS = {
  statement885: { code: "885", method: "KbankGL885" },
  statement987: { code: "987", method: "KbankGL987" },
};

const kindsMatching = (fileName) =>
  Object.keys(DOCUMENT_KINDS).filter((kind) => DOCUMENT_KINDS[kind].matches(fileName));

/**
 * Infers which of the four documents a file is, from its name.
 *
 * คลุมเครือ = ไม่รู้จัก ชื่อที่เข้าได้สองชนิดพร้อมกัน (เช่นมีทั้ง 885 และ 987 อยู่
 * ในชื่อเดียว) ต้องถูกปฏิเสธให้คนไปแก้ชื่อ ดีกว่าเดาเอาแล้วเก็บเข้าบัญชีผิด
 */
export function detectDocumentKind(fileName) {
  const hits = kindsMatching(fileName);
  return hits.length === 1 ? hits[0] : null;
}

/** ชื่อไฟล์นี้เข้าได้หลายชนิดหรือเปล่า — ใช้บอกผู้ใช้ว่าทำไมถึงไม่ผ่าน */
export function isAmbiguousDocumentName(fileName) {
  return kindsMatching(fileName).length > 1;
}

/** รูปแบบชื่อที่ระบบรับ เอาไว้บอกผู้ใช้เมื่อไฟล์ไม่ผ่าน */
export const documentPatterns = () =>
  Object.values(DOCUMENT_KINDS).map((spec) => `${spec.label} (${spec.pattern})`).join(" · ");
