// ชนิดเอกสารและกฎการอ่านชื่อไฟล์
//
// แยกจาก lib/parsers/documents.mjs โดยตั้งใจ: ไฟล์นี้เป็นข้อความล้วน ไม่ import
// node:fs หรือ node:zlib หน้าจอฝั่งเบราว์เซอร์จึงบอกได้ทันทีว่าไฟล์ที่เพิ่งเลือกมา
// เป็นเอกสารชนิดไหน โดยไม่ลาก zip/pdf/xlsx reader ทั้งชุดเข้าไปอยู่ใน bundle

const hasExtension = (name, extension) => String(name).toLowerCase().endsWith(extension);

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
  // Statement คือ PDF ใบไหนก็ได้
  //
  // เดิมชื่อไฟล์ต้องมีเลขบัญชีอยู่ เพราะระบบใช้ชื่อไฟล์ตัดสินว่าเป็นบัญชีไหน แต่
  // เลขที่บัญชีอยู่ในเอกสารอยู่แล้ว การอ่านจากในเอกสารจึงถูกต้องกว่าและไม่บังคับ
  // ให้ใครตั้งชื่อไฟล์ตามที่ระบบชอบ — และเป็นเงื่อนไขที่จะรองรับธนาคารอื่นได้
  statement: {
    label: "Statement ธนาคาร",
    accept: ".pdf",
    pattern: "*.pdf",
    detail: "PDF ที่ธนาคารออกให้ · ระบบอ่านเลขที่บัญชีจากในเอกสารเอง",
    matches: (name) => hasExtension(name, ".pdf"),
  },
};

/**
 * ชนิดที่เก็บลงฐานข้อมูลของ statement บัญชีหนึ่ง
 *
 * รูปแบบเดิมคือ statement885 / statement987 ซึ่งเป็น "statement" ต่อด้วยรหัสบัญชี
 * อยู่แล้ว แถวที่เก็บไว้ก่อนหน้านี้จึงเข้ากันได้โดยไม่ต้อง migrate อะไรเลย
 */
export const statementKind = (code) => `statement${String(code ?? "").trim()}`;

/** ชนิดนี้เป็น statement ของบัญชีใดบัญชีหนึ่งหรือเปล่า */
export const isStatementKind = (kind) => String(kind ?? "").startsWith("statement");

/** รหัสบัญชีที่ซ่อนอยู่ในชนิด — statement885 → 885 */
export const codeOfStatementKind = (kind) => String(kind ?? "").replace(/^statement/, "");

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
