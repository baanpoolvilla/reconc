import { periodOf } from "./periods.mjs";

// ใบเสร็จรับเงินของก้อนโอน OTA
//
// หนึ่งก้อนโอนที่กระทบยอดแล้ว = ใบเสร็จรับเงินหนึ่งใบ ออกให้ OTA เจ้าของก้อนนั้น
//
// สองข้อที่ทำให้เอกสารชุดนี้ต่างจากรายงานทั่วไปในระบบ และเป็นสองข้อที่ตรรกะทั้ง
// ไฟล์นี้ถูกเขียนขึ้นมาเพื่อมัน:
//
//   1. **ใบเสร็จรับเงินรับรองเงินที่รับมาจริง** ยอดบนใบจึงเป็นยอดสุทธิที่เข้าบัญชี
//      ไม่ใช่ยอดเต็มของคำจอง ส่วนต่าง (ถ้ามี) ถูกแสดงเป็นบรรทัดหักไว้ให้เห็น ไม่ใช่
//      ซ่อนด้วยการเขียนยอดใดยอดหนึ่งลงไปเฉย ๆ
//
//   2. **ใบที่ออกไปแล้วห้ามเปลี่ยน** เอกสารถูกแช่แข็งเป็นสำเนาตั้งแต่วินาทีที่ออก
//      อัปโหลดเอกสารเดือนนั้นใหม่ แก้การตั้งค่า หรือยกเลิกการจับคู่ ก็ไม่ทำให้ใบที่
//      ส่งออกไปแล้วเปลี่ยนตัวเลขตามหลัง ใบที่ผิดต้องถูก "ยกเลิก" แล้วออกใบใหม่
//      เลขที่ถูกยกเลิกไม่ถูกนำกลับมาใช้ซ้ำ และไม่มีการเรียงเลขใหม่
//
// ระบบไม่ออกใบเสร็จให้ก้อนที่ยังไม่ได้กระทบยอด — ออกใบรับรองเงินที่ยังไม่รู้ว่า
// เป็นของคำจองไหน คือการรับรองสิ่งที่ยังไม่รู้

export const RECEIPT_DOCUMENT_LABEL = "ใบเสร็จรับเงิน";

/** ข้อมูลผู้ออกเอกสาร — ไม่มีอยู่ในเอกสารบัญชีใดเลย ต้องมาจากการตั้งค่าเท่านั้น */
export const DEFAULT_ORGANIZATION = {
  name: "",
  taxId: "",
  branch: "สำนักงานใหญ่",
  address: "",
  phone: "",
};

export function normalizeOrganization(raw) {
  const source = raw ?? {};
  const text = (value, fallback = "") => String(value ?? fallback).replace(/\s+/g, " ").trim();
  return {
    name: text(source.name),
    // เลขประจำตัวผู้เสียภาษี 13 หลัก เก็บเฉพาะตัวเลข การจัดรูปแบบเป็นเรื่องตอนแสดงผล
    taxId: String(source.taxId ?? "").replace(/\D/g, "").slice(0, 13),
    branch: text(source.branch, DEFAULT_ORGANIZATION.branch),
    address: String(source.address ?? "").replace(/[ \t]+/g, " ").trim(),
    phone: text(source.phone),
  };
}

/** ครบพอที่จะออกเอกสารให้คนนอกดูหรือยัง */
export function organizationReady(organization) {
  return Boolean(organization?.name && organization?.taxId?.length === 13);
}

export function missingOrganizationFields(organization) {
  const missing = [];
  if (!organization?.name) missing.push("ชื่อผู้ออกใบเสร็จ");
  if (!organization?.taxId) missing.push("เลขประจำตัวผู้เสียภาษี");
  else if (organization.taxId.length !== 13) missing.push("เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก");
  return missing;
}

// ── เลขที่เอกสาร ─────────────────────────────────────────────────────────────
//
// เลขรันแยกชุดตามเดือนที่รับเงิน และเดินต่อกันภายในชุดโดยไม่ข้าม เลขที่ถูกยกเลิก
// ยังนับเป็นเลขที่ใช้ไปแล้ว — สมุดเลขที่มีช่องว่างโดยไม่มีใบยกเลิกกำกับ คือสิ่งที่
// ผู้ตรวจสอบบัญชีจะถามหาเป็นอย่างแรก

export const RECEIPT_PREFIX = "RC";

/** ชุดเลขของงวดหนึ่ง เช่น "RC-202607" */
export function receiptSeries(isoDate) {
  const period = periodOf(isoDate) || "";
  return `${RECEIPT_PREFIX}-${period.replace("-", "")}`;
}

export function formatReceiptNumber(series, sequence) {
  return `${series}-${String(sequence).padStart(4, "0")}`;
}

// ── ก้อนที่ออกใบเสร็จได้ ─────────────────────────────────────────────────────

/**
 * กลุ่มที่กระทบยอดแล้วและเป็นก้อนโอนของ OTA
 *
 * รับเฉพาะกลุ่มที่คนกดยืนยันเอง (มี decision) และเป็นชนิด OTA — กลุ่มที่กฎอัตโนมัติ
 * จับได้เองเป็นเงินที่ลูกค้าโอนมาตรง ๆ ไม่ใช่ก้อนโอนของ OTA
 */
export function settledOtaGroups(dataset) {
  return dataset.reconciliation.groups.filter((group) => group.type === "OTA" && group.decision);
}

/**
 * งานที่ค้างอยู่: ก้อนที่กระทบยอดแล้วแต่ยังไม่มีใบเสร็จ
 *
 * เทียบด้วย decision id เพราะนั่นคือสิ่งที่ไม่เปลี่ยนเมื่ออัปโหลดเอกสารใหม่ ส่วน
 * id ของกลุ่มถูกคำนวณใหม่ทุกรอบ
 */
export function pendingReceipts(dataset, issued) {
  const done = new Set(issued.filter((item) => !item.voidedAt).map((item) => item.decisionId));
  return settledOtaGroups(dataset).filter((group) => !done.has(group.decision.id));
}

const providerOfGroup = (group, settlement) => {
  const haystack = group.lines
    .map((line) => `${line.channel ?? ""} ${line.description ?? ""} ${line.detail ?? ""}`)
    .join(" ")
    .toLowerCase();
  return (settlement?.providers ?? []).find((provider) =>
    provider.patterns.some((pattern) => haystack.includes(pattern.toLowerCase()))) ?? null;
};

/**
 * เอกสารหนึ่งใบ ในรูปที่พร้อมแสดงและพร้อมเก็บเป็นสำเนาแช่แข็ง
 *
 * ทุกอย่างที่ใบนี้ต้องใช้ถูกคัดลอกลงไปตรงนี้ ไม่มีการอ้างถึงแถวในฐานข้อมูลเพื่อไป
 * อ่านตอนแสดงผลทีหลัง — นั่นคือสิ่งที่ทำให้ใบเปลี่ยนตัวเองได้เมื่อข้อมูลต้นทางเปลี่ยน
 */
export function buildReceiptDocument({ group, settlement, organization, number, issuedAt, issuedBy = "web" }) {
  const provider = providerOfGroup(group, settlement);
  const payerName = provider?.payerName || provider?.label || group.lines[0]?.channel || "OTA";

  const lines = group.receipts.map((receipt) => ({
    reservationNo: receipt.reservationNo,
    guest: receipt.guest,
    roomType: receipt.roomType,
    roomNumber: receipt.roomNumber,
    checkIn: receipt.checkIn,
    checkOut: receipt.checkOut,
    receiptDate: receipt.receiptDate,
    amountSatang: receipt.amountSatang,
  }));

  const grossSatang = lines.reduce((sum, line) => sum + line.amountSatang, 0);
  const netSatang = group.bankSatang;
  // ยอดเต็มมากกว่ายอดที่เข้าบัญชี = OTA หักอะไรบางอย่างไว้ ติดลบคือรับมามากกว่าที่
  // บันทึกไว้ ซึ่งไม่ใช่ค่าคอม จึงเรียกกลาง ๆ ว่าส่วนต่างและให้เหตุผลของผู้ตรวจอธิบาย
  const deductionSatang = grossSatang - netSatang;

  return {
    documentLabel: RECEIPT_DOCUMENT_LABEL,
    number,
    issuedAt,
    issuedBy,
    // วันที่บนใบเสร็จคือวันที่เงินเข้าบัญชีจริง ไม่ใช่วันที่กดออกเอกสาร
    date: group.date,
    period: group.period,
    issuer: { ...organization },
    payer: {
      name: payerName,
      providerId: provider?.id ?? "",
      taxId: provider?.taxId ?? "",
    },
    payment: {
      method: "โอนเข้าบัญชีธนาคาร",
      accountNo: group.accountNo,
      accountName: group.accountName,
      accountCode: group.account,
      statementSource: group.statementSource,
      bankLineIds: group.lines.map((line) => line.id),
      detail: group.lines.map((line) => line.detail || line.description).filter(Boolean).join(" · "),
    },
    lines,
    grossSatang,
    deductionSatang,
    deductionLabel: group.decision?.reasonLabel ?? "",
    netSatang,
    note: group.decision?.note ?? "",
    reconciliation: {
      decisionId: group.decision?.id ?? "",
      decidedBy: group.decision?.decidedBy ?? "",
      decidedAt: group.decision?.decidedAt ?? "",
      receiptIds: group.receipts.map((receipt) => receipt.id),
      sourcePeriods: group.sourcePeriods,
    },
  };
}

/** สิ่งที่ต้องแก้ก่อนถึงจะออกใบนี้ได้ — รายการว่างคือออกได้ */
export function blockersFor(group, organization) {
  const blockers = missingOrganizationFields(organization);
  if (!group?.decision) blockers.push("ก้อนนี้ยังไม่ได้กระทบยอด");
  if (!group?.receipts?.length) blockers.push("ก้อนนี้ไม่มีคำจองอยู่ในกลุ่ม");
  if (!(group?.bankSatang > 0)) blockers.push("ยอดเงินที่รับมาต้องมากกว่าศูนย์");
  return blockers;
}

/** ยอดรวมของใบที่ออกไปแล้ว ใช้โชว์บนหน้าจอ */
export function issuedTotals(issued) {
  const live = issued.filter((item) => !item.voidedAt);
  return {
    count: live.length,
    voidedCount: issued.length - live.length,
    netSatang: live.reduce((sum, item) => sum + item.netSatang, 0),
  };
}
