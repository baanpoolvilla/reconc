// ชนิดเหตุการณ์ในสมุดตรวจ
//
// อยู่แยกจาก repository.mjs โดยตั้งใจ: หน้าจอฝั่งเบราว์เซอร์ต้องใช้ป้ายพวกนี้ และ
// repository พก node:fs กับตัวต่อฐานข้อมูลมาด้วย การให้หน้าจออ่านจากที่นั่นตรง ๆ
// ลาก server-only code เข้า bundle ฝั่ง client ทั้งก้อน แล้ว build พังตอนสุดท้าย
//
// ชื่อ action ตรงนี้ต้องตรงกับที่ recordAudit() เขียนลงฐานข้อมูลจริง
export const AUDIT_ACTIONS = {
  DOCUMENT_UPLOADED: { label: "นำเข้าเอกสาร", tone: "blue" },
  DOCUMENT_REJECTED: { label: "ไฟล์ถูกปฏิเสธ", tone: "amber" },
  DOCUMENT_DELETED: { label: "ลบเอกสาร", tone: "red" },
  DECISION_SAVED: { label: "ยืนยันการจับคู่", tone: "green" },
  DECISION_REMOVED: { label: "ยกเลิกการจับคู่", tone: "amber" },
  RECEIPT_ISSUED: { label: "ออกใบเสร็จ", tone: "green" },
  RECEIPT_VOIDED: { label: "ยกเลิกใบเสร็จ", tone: "red" },
  SETTINGS_SAVED: { label: "แก้การตั้งค่า", tone: "slate" },
  SNAPSHOT_REBUILT: { label: "คำนวณผลใหม่", tone: "slate" },
};
