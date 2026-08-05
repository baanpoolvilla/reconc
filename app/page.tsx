"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

type ViewId = "overview" | "uploads" | "runs" | "review" | "reservations" | "statements" | "invoices" | "ota" | "audit" | "rules";
type Tone = "green" | "blue" | "amber" | "red" | "slate";
type ExceptionItem = {
  id: string; reason: string; title: string; reservation: string; source: string; target: string;
  delta: string; age: string; severity: "สูง" | "กลาง" | "ต่ำ"; status: "ต้องตรวจสอบ" | "รอเอกสาร" | "มอบหมายแล้ว"; owner: string;
};
type DocumentItem = { name: string; type: string; documentType: string; period: string; rows: string; status: string; control: string; time: string };
type StatementMatch = {
  id: string; date: string; time: string; account: string; bankRefs: string[]; description: string; bankAmount: string;
  matchType: "1:1" | "N:1" | "1:N" | "Exception"; score: number; dateDelta: string; status: string; tone: Tone; page: string;
  bookings: { reservation: string; guest: string; stay: string; receiptId: string; receiptDate: string; amount: string; allocated: string; method: string; sourceRow: string }[];
};
type BookingReconciliation = {
  reservation: string; bookedAt: string; guest: string; property: string; stay: string; total: string; paymentCount: number; paidTotal: string;
  status: string; tone: Tone; payments: { no: number; paidAt: string; receipt: string; amount: string; statementDate: string; account: string; statementAmount: string; bankRef: string; matchGroup: string; result: string; tone: Tone }[];
};

const monthOptions = [
  { value: "2026-08", label: "สิงหาคม 2569" }, { value: "2026-07", label: "กรกฎาคม 2569" }, { value: "2026-06", label: "มิถุนายน 2569" },
];
const documentTypeLabels: Record<string, string> = {
  collection_report: "รายงานรับเงิน", ledger: "บัญชีแยกประเภท", bank_statement_885: "Statement •••885",
  bank_statement_987: "Statement •••987", bank_statement_posh: "Statement Kbank-Posh", ota_settlement: "OTA Settlement",
};
const monthLabel = (period: string) => monthOptions.find((month) => month.value === period)?.label ?? period;

const navGroups: { label: string; items: { id: ViewId; label: string; icon: string; badge?: string }[] }[] = [
  { label: "งานประจำวัน", items: [
    { id: "overview", label: "ภาพรวม", icon: "⌂" }, { id: "uploads", label: "ศูนย์นำเข้า", icon: "↑", badge: "P1" },
    { id: "runs", label: "รอบกระทบยอด", icon: "↔" }, { id: "review", label: "คิวตรวจสอบ", icon: "!", badge: "49" },
  ] },
  { label: "ข้อมูลบัญชี", items: [
    { id: "reservations", label: "รายการจอง", icon: "#" }, { id: "statements", label: "รายการเดินบัญชี", icon: "▤", badge: "P2" },
    { id: "invoices", label: "เอกสารภาษี", icon: "□", badge: "P3" }, { id: "ota", label: "OTA Settlement", icon: "◎", badge: "P4" },
  ] },
  { label: "ควบคุมระบบ", items: [
    { id: "audit", label: "ประวัติการทำงาน", icon: "◷" }, { id: "rules", label: "กฎและการตั้งค่า", icon: "⚙" },
  ] },
];

const titles: Record<ViewId, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "ภาพรวมรอบบัญชี", title: "เห็นทุกยอดต่าง ก่อนปิดบัญชี", description: "กรกฎาคม 2569 · อัปเดตจากข้อมูล 4 แหล่ง · ruleset v1.0.0" },
  uploads: { eyebrow: "Phase 1 · Ingestion", title: "ศูนย์นำเข้าเอกสาร", description: "รับไฟล์ ตรวจซ้ำ ทำ Control checks และติดตามทุกขั้นตอนในที่เดียว" },
  runs: { eyebrow: "Reconciliation Engine", title: "รอบกระทบยอด", description: "ผลการจับคู่แบบ 1:1, N:1 และ 1:N พร้อมเหตุผลที่ตรวจสอบย้อนกลับได้" },
  review: { eyebrow: "Exception Workflow", title: "คิวตรวจสอบข้อยกเว้น", description: "ตัดสินใจจากหลักฐานสองฝั่ง โดยไม่แก้ไขข้อมูลต้นฉบับ" },
  reservations: { eyebrow: "Canonical Finance Data", title: "รายการจองและการรับเงิน", description: "มุมมองเดียวของ receipt, ledger, bank และ invoice ต่อเลขที่จอง" },
  statements: { eyebrow: "Phase 2 · Bank Reconciliation", title: "รายการเดินบัญชีธนาคาร", description: "Control total, classification และการจับคู่ยอดฝากสำหรับบัญชี 885 และ 987" },
  invoices: { eyebrow: "Phase 3 · Invoice", title: "ศูนย์เอกสารภาษี", description: "สร้าง อนุมัติ ออก ส่ง และควบคุมเวอร์ชันเอกสารจากยอดที่กระทบแล้ว" },
  ota: { eyebrow: "Phase 4 · OTA Settlement", title: "กระทบยอด OTA แบบสามทาง", description: "Booking ↔ Settlement line ↔ Bank payout พร้อมแยก commission และ refund" },
  audit: { eyebrow: "Governance", title: "ประวัติการทำงาน", description: "ทุกการอนุมัติ แก้ mapping ออกเอกสาร และนำเข้าไฟล์มีหลักฐานครบถ้วน" },
  rules: { eyebrow: "Ruleset v1.0.0", title: "กฎและการตั้งค่า", description: "กำหนด tolerance, date window, score และ payment mapping แบบ versioned" },
};

const initialExceptions: ExceptionItem[] = [
  { id: "EX-00042", reason: "AMOUNT_MISMATCH", title: "ยอดรับเงินไม่ตรงกับยอดฝากธนาคาร", reservation: "10862708254763192824", source: "฿4,000.00", target: "฿380.00", delta: "฿3,620.00", age: "2 ชม.", severity: "สูง", status: "ต้องตรวจสอบ", owner: "ยังไม่มอบหมาย" },
  { id: "EX-00041", reason: "METHOD_MISMATCH", title: "ช่องทางรับเงินต่างกัน แต่ยอดรวมตรงกัน", reservation: "10578393061567240019", source: "฿12,600.00", target: "฿12,600.00", delta: "฿0.00", age: "4 ชม.", severity: "กลาง", status: "มอบหมายแล้ว", owner: "ศิริพร" },
  { id: "EX-00039", reason: "MISSING_RESERVATION", title: "ไม่พบเลขที่จองในบัญชีแยกประเภท", reservation: "10900237654890017264", source: "฿5,500.00", target: "—", delta: "฿5,500.00", age: "1 วัน", severity: "กลาง", status: "รอเอกสาร", owner: "กิตติยา" },
  { id: "EX-00038", reason: "INVALID_ROW", title: "ข้อมูลแถวต้นทางไม่สมบูรณ์", reservation: "ไม่ระบุ", source: "—", target: "—", delta: "—", age: "1 วัน", severity: "ต่ำ", status: "ต้องตรวจสอบ", owner: "ยังไม่มอบหมาย" },
];

const initialDocuments: DocumentItem[] = [
  { name: "Collection_Report_Jul_2026.xlsx", type: "รายงานรับเงิน", documentType: "collection_report", period: "2026-07", rows: "387 แถว", status: "เผยแพร่แล้ว", control: "ผ่าน", time: "วันนี้ 13:42" },
  { name: "Ledger_Jul_2026.xlsx", type: "บัญชีแยกประเภท", documentType: "ledger", period: "2026-07", rows: "854 payment lines", status: "เผยแพร่แล้ว", control: "ผ่าน", time: "วันนี้ 13:38" },
  { name: "KBank_885_Jul_2026.pdf", type: "Statement •••885", documentType: "bank_statement_885", period: "2026-07", rows: "52 รายการ", status: "กระทบยอดแล้ว", control: "฿0.00", time: "วันนี้ 13:31" },
  { name: "KBank_987_Jul_2026.pdf", type: "Statement •••987", documentType: "bank_statement_987", period: "2026-07", rows: "122 รายการ", status: "กระทบยอดแล้ว", control: "฿0.00", time: "วันนี้ 13:25" },
  { name: "Booking_Settlement_0726.csv", type: "OTA Settlement", documentType: "ota_settlement", period: "2026-07", rows: "39 bookings", status: "ตรวจสอบแล้ว", control: "ผ่าน", time: "เมื่อวาน 17:06" },
];

const statementMatches: StatementMatch[] = [
  { id: "GRP-885-0725-01", date: "25 ก.ค. 2569", time: "14:18", account: "•••885", bankRefs: ["KB885-250726-1842"], description: "TRANSFER FROM NAPASSORN", bankAmount: "฿6,450.00", matchType: "N:1", score: 92, dateDelta: "+1 วัน", status: "จับคู่แล้ว", tone: "green", page: "Statement หน้า 2 · บรรทัด 31", bookings: [
    { reservation: "10158230476834210083", guest: "คุณนภัสสร อินทร์แก้ว", stay: "25–26 ก.ค. 2569", receiptId: "REC-0725-0188", receiptDate: "24 ก.ค. 2569", amount: "฿500.00", allocated: "฿500.00", method: "KbankGL885", sourceRow: "Collection row 214" },
    { reservation: "10158230476834210083", guest: "คุณนภัสสร อินทร์แก้ว", stay: "25–26 ก.ค. 2569", receiptId: "REC-0725-0189", receiptDate: "24 ก.ค. 2569", amount: "฿5,950.00", allocated: "฿5,950.00", method: "KbankGL885", sourceRow: "Collection row 215" },
  ] },
  { id: "GRP-885-0726-02", date: "26 ก.ค. 2569", time: "11:06", account: "•••885", bankRefs: ["KB885-260726-1106"], description: "TRANSFER FROM ORATHAI", bankAmount: "฿380.00", matchType: "Exception", score: 42, dateDelta: "0 วัน", status: "ยอดต่าง ฿3,620", tone: "red", page: "Statement หน้า 2 · บรรทัด 37", bookings: [
    { reservation: "10862708254763192824", guest: "คุณอรทัย ศรีสุข", stay: "26–28 ก.ค. 2569", receiptId: "REC-0726-0204", receiptDate: "26 ก.ค. 2569", amount: "฿4,000.00", allocated: "฿380.00 candidate", method: "KbankGL885", sourceRow: "Collection row 232" },
  ] },
  { id: "GRP-885-0724-03", date: "24 ก.ค. 2569", time: "09:42", account: "•••885", bankRefs: ["KB885-240726-0942"], description: "TRANSFER FROM DANIEL W", bankAmount: "฿12,600.00", matchType: "1:1", score: 95, dateDelta: "+1 วัน", status: "จับคู่แล้ว", tone: "green", page: "Statement หน้า 2 · บรรทัด 25", bookings: [
    { reservation: "10578393061567240019", guest: "Mr. Daniel Wong", stay: "24–27 ก.ค. 2569", receiptId: "REC-0723-0172", receiptDate: "23 ก.ค. 2569", amount: "฿12,600.00", allocated: "฿12,600.00", method: "KbankGL885", sourceRow: "Collection row 198" },
  ] },
  { id: "GRP-987-0727-04", date: "27 ก.ค. 2569", time: "16:12", account: "•••987", bankRefs: ["KB987-270726-1612"], description: "MOBILE TRANSFER SOMCHAI", bankAmount: "฿11,000.00", matchType: "N:1", score: 91, dateDelta: "0 วัน", status: "จับคู่แล้ว", tone: "green", page: "Statement หน้า 4 · บรรทัด 68", bookings: [
    { reservation: "10491182076341028570", guest: "คุณสมชาย จิตดี", stay: "27–28 ก.ค. 2569", receiptId: "REC-0727-0216", receiptDate: "27 ก.ค. 2569", amount: "฿5,500.00", allocated: "฿5,500.00", method: "KbankGL987", sourceRow: "Collection row 246" },
    { reservation: "10491182076341028570", guest: "คุณสมชาย จิตดี", stay: "27–28 ก.ค. 2569", receiptId: "REC-0727-0217", receiptDate: "27 ก.ค. 2569", amount: "฿5,500.00", allocated: "฿5,500.00", method: "KbankGL987", sourceRow: "Collection row 247" },
  ] },
  { id: "GRP-987-0728-05", date: "28 ก.ค. 2569", time: "10:31", account: "•••987", bankRefs: ["KB987-280726-1029", "KB987-280726-1031"], description: "2 BANK CREDITS · SAME SENDER", bankAmount: "฿5,900 + ฿3,000", matchType: "1:N", score: 90, dateDelta: "0 วัน", status: "จับคู่แล้ว", tone: "blue", page: "Statement หน้า 4 · บรรทัด 75–76", bookings: [
    { reservation: "10672049581300645218", guest: "คุณปาริชาติ แสงทอง", stay: "28–29 ก.ค. 2569", receiptId: "REC-0728-0231", receiptDate: "28 ก.ค. 2569", amount: "฿8,900.00", allocated: "฿8,900.00", method: "KbankGL987", sourceRow: "Collection row 261" },
  ] },
  { id: "GRP-987-0729-06", date: "29 ก.ค. 2569", time: "18:44", account: "•••987", bankRefs: ["KB987-290726-1844"], description: "SMART SCBT BATCH 50400", bankAmount: "฿50,400.00", matchType: "N:1", score: 88, dateDelta: "+1 วัน", status: "รอ Settlement", tone: "amber", page: "Statement หน้า 5 · บรรทัด 83", bookings: [
    { reservation: "10578393061567240019", guest: "Mr. Daniel Wong", stay: "24–27 ก.ค. 2569", receiptId: "OTA-REC-301", receiptDate: "28 ก.ค. 2569", amount: "฿12,600.00", allocated: "฿12,600.00", method: "Trip Collect", sourceRow: "Collection row 281" },
    { reservation: "10763244081296770511", guest: "Ms. Grace Lee", stay: "25–28 ก.ค. 2569", receiptId: "OTA-REC-302", receiptDate: "28 ก.ค. 2569", amount: "฿12,600.00", allocated: "฿12,600.00", method: "Trip Collect", sourceRow: "Collection row 282" },
    { reservation: "10977136480127883402", guest: "Mr. Ken Ito", stay: "26–29 ก.ค. 2569", receiptId: "OTA-REC-303", receiptDate: "28 ก.ค. 2569", amount: "฿12,600.00", allocated: "฿12,600.00", method: "Trip Collect", sourceRow: "Collection row 283" },
    { reservation: "10344091766280471509", guest: "Ms. Mina Park", stay: "27–30 ก.ค. 2569", receiptId: "OTA-REC-304", receiptDate: "28 ก.ค. 2569", amount: "฿12,600.00", allocated: "฿12,600.00", method: "Trip Collect", sourceRow: "Collection row 284" },
  ] },
];

const bookingReconciliations: BookingReconciliation[] = [
  { reservation: "10158230476834210083", bookedAt: "12 ก.ค. 2569 · 10:24", guest: "คุณนภัสสร อินทร์แก้ว", property: "The Palm Pool Villa A", stay: "25–26 ก.ค. 2569", total: "฿18,900.00", paymentCount: 3, paidTotal: "฿18,900.00", status: "ชำระครบ · กระทบยอดแล้ว", tone: "green", payments: [
    { no: 1, paidAt: "24 ก.ค. 2569", receipt: "REC-0725-0188", amount: "฿500.00", statementDate: "25 ก.ค. 2569 · 14:18", account: "KBank •••885", statementAmount: "฿6,450.00", bankRef: "KB885-250726-1842", matchGroup: "GRP-885-0725-01 · N:1", result: "รวมกับงวด 2 ตรงยอด Statement", tone: "green" },
    { no: 2, paidAt: "24 ก.ค. 2569", receipt: "REC-0725-0189", amount: "฿5,950.00", statementDate: "25 ก.ค. 2569 · 14:18", account: "KBank •••885", statementAmount: "฿6,450.00", bankRef: "KB885-250726-1842", matchGroup: "GRP-885-0725-01 · N:1", result: "รวมกับงวด 1 ตรงยอด Statement", tone: "green" },
    { no: 3, paidAt: "25 ก.ค. 2569", receipt: "REC-0725-0196", amount: "฿12,450.00", statementDate: "26 ก.ค. 2569 · 09:06", account: "KBank •••885", statementAmount: "฿12,450.00", bankRef: "KB885-260726-0906", matchGroup: "GRP-885-0726-07 · 1:1", result: "ยอดตรงกัน", tone: "green" },
  ] },
  { reservation: "10862708254763192824", bookedAt: "18 ก.ค. 2569 · 16:40", guest: "คุณอรทัย ศรีสุข", property: "Moonlight Pool Villa 2", stay: "26–28 ก.ค. 2569", total: "฿12,000.00", paymentCount: 3, paidTotal: "฿4,000.00", status: "ยอดต่าง · รอตรวจสอบ", tone: "red", payments: [
    { no: 1, paidAt: "26 ก.ค. 2569", receipt: "REC-0726-0204", amount: "฿4,000.00", statementDate: "26 ก.ค. 2569 · 11:06", account: "KBank •••885", statementAmount: "฿380.00", bankRef: "KB885-260726-1106", matchGroup: "GRP-885-0726-02 · Exception", result: "ยอดต่าง ฿3,620.00", tone: "red" },
    { no: 2, paidAt: "ยังไม่ชำระ", receipt: "—", amount: "฿4,000.00", statementDate: "—", account: "—", statementAmount: "—", bankRef: "—", matchGroup: "ยังไม่มีรายการจับคู่", result: "รอชำระ", tone: "amber" },
    { no: 3, paidAt: "ยังไม่ชำระ", receipt: "—", amount: "฿4,000.00", statementDate: "—", account: "—", statementAmount: "—", bankRef: "—", matchGroup: "ยังไม่มีรายการจับคู่", result: "รอชำระ", tone: "amber" },
  ] },
  { reservation: "10491182076341028570", bookedAt: "21 ก.ค. 2569 · 09:15", guest: "คุณสมชาย จิตดี", property: "Baan Ruen Rom Pool Villa", stay: "27–28 ก.ค. 2569", total: "฿11,000.00", paymentCount: 2, paidTotal: "฿11,000.00", status: "ชำระครบ · กระทบยอดแล้ว", tone: "green", payments: [
    { no: 1, paidAt: "27 ก.ค. 2569", receipt: "REC-0727-0216", amount: "฿5,500.00", statementDate: "27 ก.ค. 2569 · 16:12", account: "KBank •••987", statementAmount: "฿11,000.00", bankRef: "KB987-270726-1612", matchGroup: "GRP-987-0727-04 · N:1", result: "รวมกับงวด 2 ตรงยอด Statement", tone: "green" },
    { no: 2, paidAt: "27 ก.ค. 2569", receipt: "REC-0727-0217", amount: "฿5,500.00", statementDate: "27 ก.ค. 2569 · 16:12", account: "KBank •••987", statementAmount: "฿11,000.00", bankRef: "KB987-270726-1612", matchGroup: "GRP-987-0727-04 · N:1", result: "รวมกับงวด 1 ตรงยอด Statement", tone: "green" },
  ] },
  { reservation: "10672049581300645218", bookedAt: "22 ก.ค. 2569 · 14:08", guest: "คุณปาริชาติ แสงทอง", property: "Seaside Pool Villa 5", stay: "28–29 ก.ค. 2569", total: "฿8,900.00", paymentCount: 1, paidTotal: "฿8,900.00", status: "ชำระครบ · กระทบยอดแล้ว", tone: "blue", payments: [
    { no: 1, paidAt: "28 ก.ค. 2569", receipt: "REC-0728-0231", amount: "฿8,900.00", statementDate: "28 ก.ค. 2569 · 10:29–10:31", account: "KBank •••987", statementAmount: "฿5,900 + ฿3,000", bankRef: "KB987-280726-1029 / 1031", matchGroup: "GRP-987-0728-05 · 1:N", result: "Receipt เดียวตรงกับ 2 ยอด Statement", tone: "blue" },
  ] },
];

const runRows = [
  { id: "RUN-0726-004", phase: "P1", name: "Receipt ↔ Ledger", sources: "526 กลุ่ม", matched: "477", exception: "49", rate: "90.7%", status: "เสร็จแล้ว", tone: "green" as Tone },
  { id: "RUN-0726-003", phase: "P2", name: "KBank •••885 ↔ Receipt", sources: "52 receipts", matched: "51", exception: "1", rate: "98.1%", status: "มีข้อยกเว้น", tone: "amber" as Tone },
  { id: "RUN-0726-002", phase: "P2", name: "KBank •••987 ↔ Receipt", sources: "97 receipts", matched: "77", exception: "20", rate: "79.4%", status: "กำลังตรวจ", tone: "blue" as Tone },
  { id: "RUN-0726-001", phase: "P4", name: "OTA three-way settlement", sources: "69 bookings", matched: "66", exception: "3", rate: "95.7%", status: "เสร็จแล้ว", tone: "green" as Tone },
];

const reservations = [
  { id: "10862708254763192824", guest: "คุณอรทัย ศรีสุข", stay: "26–28 ก.ค. 2569", method: "KbankGL885", receipt: "฿4,000.00", ledger: "฿4,000.00", bank: "฿380.00", status: "ยอดต่าง" },
  { id: "10578393061567240019", guest: "Mr. Daniel Wong", stay: "24–27 ก.ค. 2569", method: "Trip Collect", receipt: "฿12,600.00", ledger: "฿12,600.00", bank: "OTA batch", status: "จับคู่แล้ว" },
  { id: "10158230476834210083", guest: "คุณนภัสสร อินทร์แก้ว", stay: "25–26 ก.ค. 2569", method: "KbankGL885", receipt: "฿6,450.00", ledger: "฿6,450.00", bank: "฿6,450.00", status: "Grouped match" },
  { id: "10377124987002561170", guest: "Ms. Amelia Chen", stay: "18–21 ก.ค. 2569", method: "Booking Collect", receipt: "฿18,900.00", ledger: "฿18,900.00", bank: "OTA batch", status: "จับคู่แล้ว" },
];

const initialInvoices = [
  { id: "INV-0042", no: "RC-2569-00042", customer: "บริษัท ทราเวลเวิร์ค จำกัด", reservation: "10578393061567240019", total: "฿12,600.00", status: "รออนุมัติ", sent: "—" },
  { id: "INV-0041", no: "RC-2569-00041", customer: "Mr. Daniel Wong", reservation: "10377124987002561170", total: "฿18,900.00", status: "ส่งแล้ว", sent: "31 ก.ค. 14:02" },
  { id: "INV-0040", no: "RC-2569-00040", customer: "คุณนภัสสร อินทร์แก้ว", reservation: "10158230476834210083", total: "฿6,450.00", status: "ออกแล้ว", sent: "รอส่ง" },
  { id: "INV-0039", no: "RC-2569-00039", customer: "Trip.com Travel Singapore", reservation: "OTA-TRIP-0726", total: "฿72,800.00", status: "ร่าง", sent: "—" },
];

const audits = [
  { time: "14:28:12", actor: "สุวรรณา ว.", action: "อนุมัติ grouped match", entity: "GRP-00645", detail: "฿500 + ฿5,950 ↔ ฿6,450", tone: "green" as Tone },
  { time: "14:16:44", actor: "ศิริพร", action: "มอบหมายข้อยกเว้น", entity: "EX-00041", detail: "METHOD_MISMATCH → กิตติยา", tone: "blue" as Tone },
  { time: "14:02:09", actor: "ระบบ", action: "ส่งใบเสร็จสำเร็จ", entity: "RC-2569-00041", detail: "provider message: msg_71842", tone: "green" as Tone },
  { time: "13:42:31", actor: "สุวรรณา ว.", action: "นำเข้าเอกสาร", entity: "DOC-0087", detail: "Collection_Report_Jul_2026.xlsx", tone: "slate" as Tone },
  { time: "13:42:33", actor: "ระบบ", action: "Control check ผ่าน", entity: "BATCH-0031", detail: "636 valid · 1 invalid · duplicate 0", tone: "green" as Tone },
  { time: "13:31:18", actor: "ระบบ", action: "สร้าง exception", entity: "EX-00042", detail: "AMOUNT_MISMATCH · delta ฿3,620.00", tone: "red" as Tone },
];

function Pill({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) { return <span className={`pill ${tone}`}>{children}</span>; }
function PageHeading({ view, action }: { view: ViewId; action?: ReactNode }) {
  const copy = titles[view];
  return <div className="page-heading"><div><span className="page-eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>{action}</div>;
}
function Metric({ label, value, detail, tone = "slate", badge }: { label: string; value: string; detail: string; tone?: Tone; badge?: string }) {
  return <article className="metric-card"><div><span>{label}</span>{badge && <Pill tone={tone}>{badge}</Pill>}</div><strong>{value}</strong><p>{detail}</p><i className={`metric-line ${tone}`} /></article>;
}

export default function Home() {
  const [active, setActive] = useState<ViewId>("overview");
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [selectedException, setSelectedException] = useState<ExceptionItem | null>(initialExceptions[0]);
  const [exceptionFilter, setExceptionFilter] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [documents, setDocuments] = useState(initialDocuments);
  const [invoices, setInvoices] = useState(initialInvoices);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState("2026-07");
  const [uploadDefaults, setUploadDefaults] = useState({ period: "2026-07", documentType: "collection_report" });
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState("");

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const go = (view: ViewId) => { setActive(view); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openUpload = (period = selectedPeriod, documentType = "collection_report") => { setUploadDefaults({ period, documentType }); setUploadOpen(true); };
  const filteredExceptions = useMemo(() => exceptions.filter((item) => {
    const statusMatch = exceptionFilter === "ทั้งหมด" || item.status === exceptionFilter;
    return statusMatch && `${item.id} ${item.reason} ${item.title} ${item.reservation}`.toLowerCase().includes(search.toLowerCase());
  }), [exceptions, exceptionFilter, search]);

  useEffect(() => {
    fetch("/api/documents").then((response) => response.json()).then((payload: { documents?: { name: string; documentType: string; period: string; status: string; createdAt: string }[] }) => {
      if (!payload.documents?.length) return;
      const stored = payload.documents.map((doc): DocumentItem => ({
        name: doc.name, type: documentTypeLabels[doc.documentType] ?? doc.documentType, documentType: doc.documentType, period: doc.period,
        rows: doc.status === "queued" ? "รอ parser" : "พร้อมใช้", status: doc.status === "queued" ? "เข้าคิวแล้ว" : doc.status,
        control: doc.status === "queued" ? "รอตรวจ" : "ผ่าน", time: new Date(doc.createdAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      }));
      setDocuments((current) => [...stored, ...current.filter((local) => !stored.some((remote) => remote.name === local.name && remote.period === local.period))]);
    }).catch(() => undefined);
  }, []);

  const resolveException = async (item: ExceptionItem) => {
    setExceptions((current) => current.filter((candidate) => candidate.id !== item.id));
    setSelectedException(null);
    notify(`${item.id} ถูกบันทึกว่าแก้ไขแล้ว`);
    fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resolve_exception", id: item.id, value: "approved_match" }) }).catch(() => undefined);
  };

  const issueInvoice = async (id: string) => {
    setInvoices((current) => current.map((invoice) => invoice.id === id ? { ...invoice, status: "ออกแล้ว", sent: "รอส่ง" } : invoice));
    notify("ออกเอกสารและสร้างเวอร์ชัน PDF แล้ว");
    fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "issue_invoice", id }) }).catch(() => undefined);
  };

  const uploadDocument = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.name) { notify("กรุณาเลือกไฟล์ก่อนดำเนินการ"); return; }
    setUploading(true);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: data });
      const payload = await response.json() as { error?: string; document?: { documentType: string; period: string } };
      if (!response.ok) throw new Error(payload.error ?? "Upload failed");
      const documentType = String(data.get("documentType")); const period = String(data.get("period"));
      setDocuments((current) => [{ name: file.name, type: documentTypeLabels[documentType] ?? documentType, documentType, period, rows: "รอ parser", status: "เข้าคิวแล้ว", control: "รอตรวจ", time: "เมื่อสักครู่" }, ...current]);
      setUploadOpen(false); notify("อัปโหลดสำเร็จและส่งเข้าคิวประมวลผลแล้ว"); form.reset();
    } catch (error) { notify(error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ"); }
    finally { setUploading(false); }
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => go("overview")}><span className="brand-mark"><i /><i /><i /></span><span><b>ClearClose</b><small>ACCOUNT OPERATIONS</small></span></button>
      <button className="org-switcher"><span>SA</span><span><b>Smart Order</b><small>บริษัท สบายดี จำกัด</small></span><i>⌄</i></button>
      <nav aria-label="เมนูหลัก">{navGroups.map((group) => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => go(item.id)}><span className="nav-icon">{item.icon}</span><b>{item.label}</b>{item.badge && <em>{item.badge}</em>}</button>)}</div>)}</nav>
      <div className="sidebar-status"><p><span /> ระบบพร้อมใช้งาน</p><button><span>สว</span><span><b>สุวรรณา ว.</b><small>ผู้ดูแลระบบ</small></span><i>•••</i></button></div>
    </aside>
    <main>
      <header className="topbar"><div className="topbar-brand"><span className="brand-mark"><i /><i /><i /></span><b>ClearClose</b></div><div className="period"><small>รอบบัญชี</small><select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}>{monthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}</select></div><div className="top-actions"><span className="live-state"><i /> LIVE STORAGE</span><button className="square-button" aria-label="ค้นหา">⌕</button><button className="square-button alert" aria-label="แจ้งเตือน">○<i /></button><button className="primary-button" onClick={() => openUpload()}>＋ นำเข้าเอกสาร</button></div></header>
      <div className="content">
        {active === "overview" && <Overview onGo={go} onUpload={() => openUpload()} />}
        {active === "uploads" && <Uploads documents={documents} period={selectedPeriod} setPeriod={setSelectedPeriod} onUpload={openUpload} />}
        {active === "runs" && <Runs />}
        {active === "review" && <Review exceptions={filteredExceptions} allCount={exceptions.length} filter={exceptionFilter} setFilter={setExceptionFilter} search={search} setSearch={setSearch} selected={selectedException} setSelected={setSelectedException} onResolve={resolveException} />}
        {active === "reservations" && <Reservations />}
        {active === "statements" && <Statements period={selectedPeriod} onUpload={openUpload} />}
        {active === "invoices" && <Invoices invoices={invoices} onIssue={issueInvoice} notify={notify} />}
        {active === "ota" && <Ota />}
        {active === "audit" && <Audit />}
        {active === "rules" && <Rules notify={notify} />}
        <footer><span>ClearClose · ruleset v1.0.0</span><p>Asia/Bangkok · ข้อมูลสาธิตจากรอบ กรกฎาคม 2569</p><button onClick={() => notify("เปิดศูนย์ช่วยเหลือแล้ว")}>ศูนย์ช่วยเหลือ ↗</button></footer>
      </div>
    </main>
    {uploadOpen && <UploadModal key={`${uploadDefaults.period}-${uploadDefaults.documentType}`} busy={uploading} defaults={uploadDefaults} onClose={() => setUploadOpen(false)} onSubmit={uploadDocument} />}
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </div>;
}

function Overview({ onGo, onUpload }: { onGo: (view: ViewId) => void; onUpload: () => void }) {
  const [selectedBooking, setSelectedBooking] = useState<BookingReconciliation>(bookingReconciliations[0]);
  return <>
    <PageHeading view="overview" action={<div className="readiness"><span className="readiness-ring"><b>87</b><small>%</small></span><span><small>ความพร้อมปิดบัญชี</small><b>ใกล้พร้อมตรวจทาน</b><p>เหลือ 49 รายการที่ต้องจัดการ</p></span></div>} />
    <section className="metrics-grid"><Metric label="ยอดรับสุทธิ" value="฿2,274,426.29" detail="จากรายงานรับเงิน 387 รายการ" tone="blue" badge="↗ 12.4%" /><Metric label="จับคู่สำเร็จ" value="90.7%" detail="477 จาก 526 กลุ่มรายการ" tone="green" badge="เป้าหมาย 95%" /><Metric label="รอตรวจสอบ" value="49 กลุ่ม" detail="ยอดผลต่างรวม ฿9,120.00" tone="amber" badge="สูง 1" /><Metric label="Control checks" value="3/3 ผ่าน" detail="Ledger · Statement 885 · 987" tone="green" badge="สมดุล" /></section>
    <section className="panel booking-recon-panel">
      <PanelTitle kicker="Booking payment reconciliation" title="รายละเอียดการกระทบยอดรายจอง" action={<button className="text-button" onClick={() => onGo("statements")}>ดู Statement ทั้งหมด →</button>} />
      <div className="booking-recon-intro"><span>↔</span><p><b>ดูได้ทันทีว่าแต่ละการจองแบ่งจ่ายกี่ครั้ง และแต่ละงวดตรงกับยอดใดใน Statement</b><small>คลิกแถวการจองเพื่อเปิดรายละเอียดทุกงวดชำระ พร้อม Bank reference และรูปแบบการจับคู่ 1:1, N:1 หรือ 1:N</small></p></div>
      <div className="responsive-table"><table className="booking-recon-table"><thead><tr><th>วันที่จอง / เลขที่จอง</th><th>บ้านพัก / ผู้จอง</th><th>วันเข้าพัก</th><th>ยอดจองรวม</th><th>แบ่งจ่าย</th><th>ชำระแล้ว</th><th>สถานะกระทบยอด</th><th /></tr></thead><tbody>{bookingReconciliations.map((booking) => <tr key={booking.reservation} className={selectedBooking.reservation === booking.reservation ? "selected" : ""} onClick={() => setSelectedBooking(booking)}><td><b>{booking.bookedAt}</b><small className="block mono">{booking.reservation}</small></td><td><b>{booking.property}</b><small className="block">{booking.guest}</small></td><td>{booking.stay}</td><td><strong>{booking.total}</strong></td><td><span className="payment-count"><b>{booking.paymentCount}</b> ครั้ง</span></td><td><b>{booking.paidTotal}</b></td><td><Pill tone={booking.tone}>{booking.status}</Pill></td><td><button className="row-button" aria-label={`เปิดรายละเอียดการจอง ${booking.reservation}`}>›</button></td></tr>)}</tbody></table></div>
      <div className="booking-payment-detail">
        <div className="booking-payment-head"><div><small>รายละเอียดการจองที่เลือก</small><h3>{selectedBooking.property}</h3><p>{selectedBooking.guest} · <span className="mono">{selectedBooking.reservation}</span></p></div><div><span><small>วันที่จอง</small><b>{selectedBooking.bookedAt}</b></span><span><small>ยอดรวม</small><b>{selectedBooking.total}</b></span><span><small>แบ่งจ่าย</small><b>{selectedBooking.paymentCount} ครั้ง</b></span><Pill tone={selectedBooking.tone}>{selectedBooking.status}</Pill></div></div>
        <div className="payment-installments">{selectedBooking.payments.map((payment) => <article key={`${selectedBooking.reservation}-${payment.no}`} className={payment.tone === "red" ? "danger" : ""}>
          <div className="installment-label"><span>{payment.no}</span><p><small>งวดที่ {payment.no} จาก {selectedBooking.paymentCount}</small><b>{payment.amount}</b><em>{payment.paidAt}</em></p><Pill tone={payment.tone}>{payment.result}</Pill></div>
          <div className="installment-flow"><div><small>รายการรับเงิน</small><b>{payment.amount}</b><span className="mono">{payment.receipt}</span></div><i>→</i><div className="match-rule"><small>กลุ่มจับคู่</small><b>{payment.matchGroup}</b><span>{payment.result}</span></div><i>→</i><div><small>ยอดใน Statement</small><b>{payment.statementAmount}</b><span>{payment.account} · {payment.statementDate}</span></div></div>
          <div className="bank-reference"><span>Bank reference</span><code>{payment.bankRef}</code><button onClick={() => onGo("statements")}>เปิดรายการ Statement →</button></div>
        </article>)}</div>
        <div className="booking-control-total"><span><small>ยอดจองรวม</small><b>{selectedBooking.total}</b></span><i>=</i><span><small>ยอดรับเงินสะสม</small><b>{selectedBooking.paidTotal}</b></span><span className={`control-result ${selectedBooking.tone}`}><b>{selectedBooking.tone === "red" ? "! ยังปิดยอดไม่ได้" : "✓ ยอดชำระครบ"}</b><small>{selectedBooking.status}</small></span></div>
      </div>
    </section>
    <section className="phase-strip">{[
      ["01", "Ingestion & Ledger", "รับไฟล์และจับคู่ Receipt ↔ Ledger", "เสร็จแล้ว", "green"], ["02", "Bank 885 / 987", "จับคู่ 1:1 และ grouped match", "98.1%", "blue"],
      ["03", "Invoice", "ออกและส่งเอกสารจากยอดที่ยืนยัน", "3 รอดำเนินการ", "amber"], ["04", "OTA Settlement", "กระทบยอด Booking / Trip / Airbnb", "95.7%", "green"],
    ].map((phase) => <button key={phase[0]} onClick={() => onGo(phase[0] === "01" ? "uploads" : phase[0] === "02" ? "statements" : phase[0] === "03" ? "invoices" : "ota")}><span>{phase[0]}</span><p><b>{phase[1]}</b><small>{phase[2]}</small></p><Pill tone={phase[4] as Tone}>{phase[3]}</Pill></button>)}</section>
    <section className="two-column"><div className="panel"><PanelTitle kicker="Reconciliation" title="สถานะการจับคู่ล่าสุด" action={<button className="text-button" onClick={() => onGo("runs")}>ดูทั้งหมด →</button>} /><RunTable compact /><div className="success-note"><span>✓</span><p><b>Grouped match ที่ตรวจพบ</b><small>฿500 + ฿5,950 จับคู่กับยอดฝาก ฿6,450 ด้วยกฎ N:1</small></p><Pill tone="green">score 92</Pill></div></div><div className="panel"><PanelTitle kicker="Next actions" title="งานที่ควรทำต่อ" /><div className="task-list"><button onClick={() => onGo("review")}><span className="task-icon red">!</span><p><b>ตรวจยอดต่าง ฿3,620.00</b><small>EX-00042 · SLA เหลือ 6 ชั่วโมง</small></p><strong>ตรวจสอบ →</strong></button><button onClick={() => onGo("invoices")}><span className="task-icon amber">□</span><p><b>อนุมัติเอกสารภาษี 3 ฉบับ</b><small>ยอดรวม ฿37,950.00</small></p><strong>เปิดคิว →</strong></button><button onClick={() => onGo("ota")}><span className="task-icon blue">◎</span><p><b>ตรวจ OTA settlement 3 รายการ</b><small>Booking.com และ Trip.com</small></p><strong>ตรวจสอบ →</strong></button><button onClick={onUpload}><span className="task-icon slate">↑</span><p><b>Statement Kbank-Posh ยังไม่ครบ</b><small>ต้องใช้เพื่อปิดทุก payment method</small></p><strong>นำเข้า →</strong></button></div></div></section>
  </>;
}

function Uploads({ documents, period, setPeriod, onUpload }: { documents: DocumentItem[]; period: string; setPeriod: (value: string) => void; onUpload: (period: string, type: string) => void }) {
  const monthDocuments = documents.filter((document) => document.period === period);
  const requirements = [
    { type: "collection_report", label: "รายงานรับเงิน", detail: "Excel · รายการรับ/คืนเงิน", required: true },
    { type: "ledger", label: "บัญชีแยกประเภท", detail: "Excel · Reservation + payment lines", required: true },
    { type: "bank_statement_885", label: "Statement •••885", detail: "PDF · KBank GL885", required: true },
    { type: "bank_statement_987", label: "Statement •••987", detail: "PDF · KBank GL987", required: true },
    { type: "bank_statement_posh", label: "Statement Kbank-Posh", detail: "PDF · ช่องทาง Posh", required: false },
    { type: "ota_settlement", label: "OTA Settlement", detail: "CSV/XLSX · Booking, Trip, Airbnb", required: false },
  ];
  const ready = requirements.filter((requirement) => monthDocuments.some((document) => document.documentType === requirement.type)).length;
  return <>
    <PageHeading view="uploads" action={<div className="month-picker"><span>เดือนเอกสาร</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{monthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}</select></div>} />
    <section className="month-summary"><div><span className="month-calendar"><b>{period.slice(5)}</b><small>{period.slice(0, 4)}</small></span><p><small>ชุดเอกสารประจำเดือน</small><b>{monthLabel(period)}</b><span>{ready} จาก {requirements.length} ประเภท · Required {requirements.filter((item) => item.required && monthDocuments.some((document) => document.documentType === item.type)).length}/4</span></p></div><div className="month-progress"><span><i style={{ width: `${Math.round((ready / requirements.length) * 100)}%` }} /></span><b>{Math.round((ready / requirements.length) * 100)}% ครบถ้วน</b><button className="primary-button" onClick={() => onUpload(period, "collection_report")}>＋ อัปโหลดไฟล์เดือนนี้</button></div></section>
    <section className="document-checklist">{requirements.map((requirement) => {
      const document = monthDocuments.find((item) => item.documentType === requirement.type);
      return <article key={requirement.type} className={document ? "ready" : "missing"}><div><span className={`check-icon ${document ? "ready" : "missing"}`}>{document ? "✓" : "+"}</span><p><b>{requirement.label}</b><small>{requirement.detail}</small></p>{requirement.required ? <Pill tone="blue">จำเป็น</Pill> : <Pill>เพิ่มเติม</Pill>}</div>{document ? <><strong>{document.name}</strong><span><Pill tone={document.control === "ผ่าน" || document.control === "฿0.00" ? "green" : "amber"}>{document.status}</Pill><button onClick={() => onUpload(period, requirement.type)}>อัปโหลดแทนที่</button></span></> : <><strong>ยังไม่มีไฟล์สำหรับ {monthLabel(period)}</strong><span><Pill tone={requirement.required ? "red" : "slate"}>{requirement.required ? "ยังไม่ครบ" : "ไม่บังคับ"}</Pill><button onClick={() => onUpload(period, requirement.type)}>เลือกไฟล์</button></span></>}</article>;
    })}</section>
    <section className="panel pipeline-panel"><PanelTitle kicker="Processing pipeline" title="ขั้นตอนหลังอัปโหลด" /><div className="pipeline">{["Uploaded", "Parsing", "Validating", "Published", "Reconciling", "Completed"].map((step, index) => <div key={step}><span>{index + 1}</span><b>{step}</b><small>{index === 0 ? "R2 + SHA-256" : index === 1 ? "ตามชนิดเอกสาร" : index === 2 ? "control totals" : index === 3 ? "canonical rows" : index === 4 ? "ruleset version" : "พร้อมตรวจ"}</small></div>)}</div></section>
    <section className="panel data-panel"><PanelTitle kicker={`Documents · ${monthLabel(period)}`} title="ประวัติไฟล์ของเดือนนี้" action={<button className="primary-button" onClick={() => onUpload(period, "collection_report")}>＋ เพิ่มเอกสาร</button>} />{monthDocuments.length ? <div className="responsive-table"><table><thead><tr><th>ชื่อไฟล์</th><th>ประเภท</th><th>ข้อมูล</th><th>Control</th><th>สถานะ</th><th>เวลานำเข้า</th><th /></tr></thead><tbody>{monthDocuments.map((doc) => <tr key={`${doc.name}-${doc.time}`}><td><span className={`file-icon ${doc.name.endsWith(".pdf") ? "pdf" : doc.name.endsWith(".csv") ? "csv" : "sheet"}`}>{doc.name.endsWith(".pdf") ? "P" : doc.name.endsWith(".csv") ? "C" : "X"}</span><b>{doc.name}</b></td><td>{doc.type}</td><td>{doc.rows}</td><td><Pill tone={doc.control === "ผ่าน" || doc.control === "฿0.00" ? "green" : "amber"}>{doc.control}</Pill></td><td>{doc.status}</td><td>{doc.time}</td><td><button className="row-button">›</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><span>↑</span><h3>ยังไม่มีเอกสารสำหรับ {monthLabel(period)}</h3><p>เริ่มจากรายงานรับเงินและบัญชีแยกประเภท แล้วจึงเพิ่ม Statement ของแต่ละบัญชี</p><button className="primary-button" onClick={() => onUpload(period, "collection_report")}>อัปโหลดเอกสารแรก</button></div>}</section>
  </>;
}

function Runs() { return <><PageHeading view="runs" action={<button className="secondary-button">⟳ รันใหม่ด้วย ruleset ล่าสุด</button>} /><section className="metrics-grid"><Metric label="รอบทั้งหมด" value="4 รอบ" detail="ครอบคลุม Phase 1, 2 และ 4" tone="blue" /><Metric label="รายการที่จับคู่" value="671" detail="จาก candidate ทั้งหมด 741" tone="green" /><Metric label="Grouped matches" value="12 กลุ่ม" detail="N:1 จำนวน 8 · 1:N จำนวน 4" tone="green" /><Metric label="คะแนนเฉลี่ย" value="94.2" detail="Auto-match threshold ≥ 85" tone="amber" /></section><section className="panel data-panel"><PanelTitle kicker="Run history" title="ผลการกระทบยอด" action={<button className="text-button">เปรียบเทียบรอบ →</button>} /><RunTable /></section><section className="case-grid"><article className="case-card"><Pill tone="green">N:1 · MATCHED</Pill><h3>หลาย Receipt → Bank เดียว</h3><div className="equation"><span>฿500</span><i>＋</i><span>฿5,950</span><b>=</b><span className="bank-value">฿6,450</span></div><p>reservation เดียวกัน · วันที่ธนาคาร +1 วัน · score 92</p></article><article className="case-card"><Pill tone="green">1:N · MATCHED</Pill><h3>Receipt เดียว → หลาย Bank</h3><div className="equation"><span className="bank-value">฿8,900</span><b>=</b><span>฿5,900</span><i>＋</i><span>฿3,000</span></div><p>sender เดียวกัน · exact total · score 90</p></article><article className="case-card danger"><Pill tone="red">EXCEPTION</Pill><h3>ยอดต่าง ห้ามปรับอัตโนมัติ</h3><div className="equation"><span>฿4,000</span><b>≠</b><span>฿380</span><i>→</i><span className="delta-value">฿3,620</span></div><p>AMOUNT_MISMATCH · ส่งเข้าคิวตรวจสอบ</p></article></section></>;
}

function Review({ exceptions, allCount, filter, setFilter, search, setSearch, selected, setSelected, onResolve }: { exceptions: ExceptionItem[]; allCount: number; filter: string; setFilter: (value: string) => void; search: string; setSearch: (value: string) => void; selected: ExceptionItem | null; setSelected: (value: ExceptionItem | null) => void; onResolve: (value: ExceptionItem) => void }) {
  return <><PageHeading view="review" action={<div className="heading-stats"><span><b>{allCount}</b><small>รายการเปิด</small></span><span><b>฿9,120</b><small>ยอดผลต่าง</small></span></div>} /><section className="panel data-panel"><div className="review-toolbar"><div className="tabs">{["ทั้งหมด", "ต้องตรวจสอบ", "รอเอกสาร", "มอบหมายแล้ว"].map((name) => <button key={name} className={filter === name ? "active" : ""} onClick={() => setFilter(name)}>{name}{name === "ทั้งหมด" && <span>{allCount}</span>}</button>)}</div><label className="search-box">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาเลขที่จอง รหัส หรือเหตุผล" /></label></div><div className="responsive-table"><table><thead><tr><th>รายการ / เหตุผล</th><th>เลขที่จอง</th><th>ยอดต้นทาง</th><th>ยอดที่เทียบ</th><th>ผลต่าง</th><th>อายุ</th><th>ผู้รับผิดชอบ</th><th /></tr></thead><tbody>{exceptions.map((item) => <tr key={item.id} className={selected?.id === item.id ? "selected" : ""}><td><div className="reason"><span className={`severity ${item.severity === "สูง" ? "high" : item.severity === "กลาง" ? "medium" : "low"}`}>{item.severity === "สูง" ? "!" : item.severity === "กลาง" ? "•" : "i"}</span><span><b>{item.title}</b><small>{item.id} · {item.reason}</small></span></div></td><td className="mono">{item.reservation}</td><td>{item.source}</td><td>{item.target}</td><td className={item.delta !== "฿0.00" && item.delta !== "—" ? "negative" : ""}>{item.delta}</td><td>{item.age}</td><td>{item.owner}</td><td><button className="row-button" onClick={() => setSelected(item)}>›</button></td></tr>)}</tbody></table></div>{exceptions.length === 0 && <div className="empty-state"><span>✓</span><h3>ไม่มีรายการในตัวกรองนี้</h3><p>ลองเปลี่ยนสถานะหรือคำค้นหา</p></div>}{selected && <div className="evidence"><div className="evidence-header"><span><small>หลักฐานการจับคู่</small><b>{selected.id} · {selected.reason}</b></span><button onClick={() => setSelected(null)}>×</button></div><div className="evidence-grid"><article><small>รายงานรับเงิน</small><b>{selected.source}</b><p>26 ก.ค. 2569 · KbankGL885</p></article><span className="not-equal">≠<small>ผลต่าง<br /><b>{selected.delta}</b></small></span><article><small>รายการธนาคาร</small><b>{selected.target}</b><p>26 ก.ค. 2569 · Transfer</p></article><div className="rule-box"><small>กฎที่ทำงาน</small><b>ยอดต่างต้องเป็น 0.00</b><p>ระบบจะไม่ปรับยอดอัตโนมัติ</p></div><div className="evidence-actions"><button className="secondary-button">ขอเอกสาร</button><button className="primary-button" onClick={() => onResolve(selected)}>อนุมัติการแก้ไข</button></div></div></div>}</section></>;
}

function Reservations() { const [selected, setSelected] = useState(reservations[0]); return <><PageHeading view="reservations" action={<label className="search-box wide">⌕<input placeholder="ค้นหาเลขที่จอง ชื่อลูกค้า หรือยอดเงิน" /></label>} /><section className="master-detail"><div className="panel reservation-list"><div className="list-header"><b>665 รายการจอง</b><button>☷ ตัวกรอง</button></div>{reservations.map((item) => <button key={item.id} className={selected.id === item.id ? "active" : ""} onClick={() => setSelected(item)}><span><b>{item.guest}</b><small className="mono">{item.id}</small><small>{item.stay} · {item.method}</small></span><span><b>{item.receipt}</b><Pill tone={item.status === "ยอดต่าง" ? "red" : item.status === "Grouped match" ? "blue" : "green"}>{item.status}</Pill></span></button>)}</div><div className="panel reservation-detail"><PanelTitle kicker="Reservation detail" title={selected.guest} action={<Pill tone={selected.status === "ยอดต่าง" ? "red" : "green"}>{selected.status}</Pill>} /><div className="reservation-meta"><span><small>Reservation No.</small><b className="mono">{selected.id}</b></span><span><small>วันเข้าพัก</small><b>{selected.stay}</b></span><span><small>Payment method</small><b>{selected.method}</b></span></div><div className="money-flow"><article><small>Receipt</small><b>{selected.receipt}</b><span>รายงานรับเงิน</span></article><i>→</i><article><small>Ledger</small><b>{selected.ledger}</b><span>บัญชีแยกประเภท</span></article><i>→</i><article className={selected.status === "ยอดต่าง" ? "mismatch" : ""}><small>Bank / Settlement</small><b>{selected.bank}</b><span>{selected.status === "ยอดต่าง" ? "ผลต่าง ฿3,620.00" : "ยืนยันแล้ว"}</span></article></div><div className="timeline"><h3>ลำดับเหตุการณ์</h3>{["สร้างรายการจองใน Smart Order", "บันทึกรับเงินและนำเข้า Ledger", "กระทบยอดด้วย ruleset v1.0.0", selected.status === "ยอดต่าง" ? "สร้าง AMOUNT_MISMATCH" : "ยืนยันการจับคู่สำเร็จ"].map((event, index) => <div key={event}><span className={index === 3 && selected.status === "ยอดต่าง" ? "danger" : ""}>{index + 1}</span><p><b>{event}</b><small>{25 + index} ก.ค. 2569 · {10 + index}:24 น.</small></p></div>)}</div></div></section></>;
}

function Statements({ period, onUpload }: { period: string; onUpload: (period: string, type: string) => void }) {
  const [accountFilter, setAccountFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StatementMatch | null>(statementMatches[0]);
  const visibleMatches = statementMatches.filter((match) => {
    if (period !== "2026-07") return false;
    const accountMatch = accountFilter === "all" || match.account.endsWith(accountFilter);
    const statusMatch = matchFilter === "all" || (matchFilter === "matched" ? match.tone === "green" : match.tone !== "green");
    const haystack = `${match.id} ${match.account} ${match.description} ${match.bankRefs.join(" ")} ${match.bookings.map((booking) => `${booking.reservation} ${booking.guest} ${booking.receiptId}`).join(" ")}`.toLowerCase();
    return accountMatch && statusMatch && haystack.includes(query.toLowerCase());
  });

  return <>
    <PageHeading view="statements" action={<button className="primary-button large" onClick={() => onUpload(period, "bank_statement_885")}>＋ นำเข้า Statement เดือนนี้</button>} />
    {period === "2026-07" ? <section className="statement-grid">
      <StatementCard suffix="885" opening="฿4,887.33" credit="฿208,590.00" debit="฿6,000.00" closing="฿207,477.33" matched="50/51" tone="green" onClick={() => setAccountFilter("885")} />
      <StatementCard suffix="987" opening="฿119,580.88" credit="฿931,565.54" debit="฿791,272.85" closing="฿259,873.57" matched="77/97" tone="blue" onClick={() => setAccountFilter("987")} />
    </section> : <section className="panel month-empty-banner"><span>□</span><p><b>ยังไม่มี Statement ที่ประมวลผลแล้วสำหรับ {monthLabel(period)}</b><small>อัปโหลด Statement 885 หรือ 987 เพื่อสร้างรายการจับคู่ของเดือนนี้</small></p><button className="primary-button" onClick={() => onUpload(period, "bank_statement_885")}>อัปโหลด Statement</button></section>}
    <section className="panel statement-match-panel">
      <PanelTitle kicker={`Statement matching · ${monthLabel(period)}`} title="ยอดใน Statement ↔ รายการจอง" action={<Pill tone="blue">คลิกแถวเพื่อดูหลักฐาน</Pill>} />
      <div className="statement-toolbar">
        <div className="tabs">{[["all", "ทุกบัญชี"], ["885", "•••885"], ["987", "•••987"]].map(([value, label]) => <button key={value} className={accountFilter === value ? "active" : ""} onClick={() => setAccountFilter(value)}>{label}</button>)}</div>
        <div className="tabs compact">{[["all", "ทั้งหมด"], ["matched", "จับคู่แล้ว"], ["review", "ต้องตรวจ"]].map(([value, label]) => <button key={value} className={matchFilter === value ? "active" : ""} onClick={() => setMatchFilter(value)}>{label}</button>)}</div>
        <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขจอง ชื่อลูกค้า หรือ Bank ref" /></label>
      </div>
      <div className="demo-data-note"><span>i</span><p><b>ตัวอย่างการจับคู่จากชุดข้อมูลเดิม</b><small>เมื่ออัปโหลดเอกสารใหม่ ระบบจะแสดงเลขหน้า แถวต้นทาง และยอดจัดสรรของเดือนที่เลือกในรูปแบบเดียวกัน</small></p></div>
      <div className="responsive-table"><table className="statement-match-table"><thead><tr><th>วันเวลา / บัญชี</th><th>รายการใน Statement</th><th>ยอด Statement</th><th>รายการจองที่จับคู่</th><th>รูปแบบ</th><th>ผล</th><th /></tr></thead><tbody>{visibleMatches.map((match) => <tr key={match.id} className={selected?.id === match.id ? "selected" : ""} onClick={() => setSelected(match)}><td><b>{match.date} · {match.time}</b><small className="block mono">{match.account} · {match.bankRefs[0]}</small></td><td><b>{match.description}</b><small className="block">{match.page}</small></td><td><strong>{match.bankAmount}</strong></td><td><div className="booking-preview"><b>{match.bookings.length} รายการรับเงิน</b>{match.bookings.slice(0, 2).map((booking) => <small key={booking.receiptId}><span className="mono">{booking.reservation}</span> · {booking.amount}</small>)}</div></td><td><Pill tone={match.matchType === "Exception" ? "red" : "blue"}>{match.matchType}</Pill></td><td><Pill tone={match.tone}>{match.status}</Pill><small className="block">score {match.score}</small></td><td><button className="row-button" aria-label={`เปิดรายละเอียด ${match.id}`}>›</button></td></tr>)}</tbody></table></div>
      {!visibleMatches.length && <div className="empty-state"><span>⌕</span><h3>ไม่พบรายการที่ตรงกับตัวกรอง</h3><p>ลองเลือกทุกบัญชีหรือเปลี่ยนคำค้นหา</p></div>}
      {selected && period === "2026-07" && <div className="statement-match-detail">
        <div className="match-detail-head"><span><small>หลักฐานการจับคู่แบบตรวจสอบย้อนกลับได้</small><h3>{selected.id}</h3></span><span><Pill tone={selected.tone}>{selected.status}</Pill><button onClick={() => setSelected(null)}>×</button></span></div>
        <div className="match-evidence-grid">
          <article className="bank-evidence"><span className="evidence-label">BANK STATEMENT</span><h4>{selected.bankAmount}</h4><b>{selected.description}</b><dl><div><dt>บัญชี</dt><dd>{selected.account}</dd></div><div><dt>วันที่ / เวลา</dt><dd>{selected.date} · {selected.time}</dd></div><div><dt>Bank reference</dt><dd className="mono">{selected.bankRefs.join(", ")}</dd></div><div><dt>ตำแหน่งต้นฉบับ</dt><dd>{selected.page}</dd></div></dl></article>
          <div className="match-connector"><span>{selected.matchType}</span><b>{selected.score}</b><small>match score</small><i>→</i><p>ช่วงวันที่ {selected.dateDelta}</p></div>
          <div className="booking-allocations"><span className="evidence-label">BOOKING / RECEIPT ALLOCATION</span>{selected.bookings.map((booking) => <article className="allocation-row" key={`${selected.id}-${booking.receiptId}`}><div><b>{booking.guest}</b><button className="reservation-link">Reservation <span className="mono">{booking.reservation}</span> ↗</button><small>เข้าพัก {booking.stay}</small></div><dl><div><dt>Receipt</dt><dd className="mono">{booking.receiptId}</dd></div><div><dt>วันที่รับเงิน</dt><dd>{booking.receiptDate}</dd></div><div><dt>ยอด Receipt</dt><dd>{booking.amount}</dd></div><div><dt>ยอดจัดสรรกับ Bank</dt><dd><strong>{booking.allocated}</strong></dd></div><div><dt>ช่องทาง</dt><dd>{booking.method}</dd></div><div><dt>แถวต้นทาง</dt><dd>{booking.sourceRow}</dd></div></dl></article>)}</div>
        </div>
        <div className="allocation-summary"><span><small>Statement amount</small><b>{selected.bankAmount}</b></span><i>=</i><span><small>ยอดจัดสรรจาก Receipt</small><b>{selected.bookings.map((booking) => booking.amount).join(" + ")}</b></span><span className={`control-result ${selected.tone}`}><b>{selected.tone === "green" ? "✓ Control ตรงกัน" : "! ต้องตรวจสอบ"}</b><small>{selected.status}</small></span></div>
        <div className="rule-evidence"><p><small>เหตุผลจาก Ruleset v1.0.0</small><b>{selected.matchType === "1:1" ? "ยอดตรงกัน + วันที่อยู่ในช่วง + ช่องทางตรง" : selected.matchType === "N:1" ? "ผลรวมหลาย Receipt เท่ากับยอดฝากหนึ่งรายการ" : selected.matchType === "1:N" ? "ยอด Receipt หนึ่งรายการเท่ากับผลรวมหลายยอดฝาก" : "ยอดไม่เท่ากัน ระบบจึงไม่อนุมัติอัตโนมัติ"}</b></p><div><button className="secondary-button">เปิดรายการจอง</button><button className="primary-button">{selected.tone === "green" ? "ดู Audit trail" : "ส่งเข้าคิวตรวจสอบ"}</button></div></div>
      </div>}
    </section>
  </>;
}

function Invoices({ invoices, onIssue, notify }: { invoices: typeof initialInvoices; onIssue: (id: string) => void; notify: (value: string) => void }) { return <><PageHeading view="invoices" action={<button className="primary-button large" onClick={() => notify("สร้างร่างเอกสารใหม่แล้ว")}>＋ สร้างเอกสาร</button>} /><section className="metrics-grid"><Metric label="ร่าง" value="4 ฉบับ" detail="ยอดรวม ฿111,750.00" tone="slate" /><Metric label="รออนุมัติ" value="3 ฉบับ" detail="ต้องอนุมัติก่อนออกเลข" tone="amber" /><Metric label="ออกแล้ว" value="28 ฉบับ" detail="ยอดรวม ฿286,420.00" tone="blue" /><Metric label="ส่งสำเร็จ" value="27 ฉบับ" detail="Delivery rate 96.4%" tone="green" /></section><section className="panel data-panel"><PanelTitle kicker="Invoice workflow" title="เอกสารทั้งหมด" action={<div className="table-actions"><button>สถานะทั้งหมด⌄</button><button>⇩ Export</button></div>} /><div className="responsive-table"><table><thead><tr><th>เลขที่เอกสาร</th><th>ลูกค้า / Reservation</th><th>ยอดรวม</th><th>เวอร์ชัน</th><th>สถานะ</th><th>การส่ง</th><th /></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><b>{invoice.no}</b><small className="block mono">{invoice.id}</small></td><td><b>{invoice.customer}</b><small className="block mono">{invoice.reservation}</small></td><td><b>{invoice.total}</b></td><td>v1 · PDF</td><td><Pill tone={invoice.status === "ส่งแล้ว" ? "green" : invoice.status === "ออกแล้ว" ? "blue" : invoice.status === "รออนุมัติ" ? "amber" : "slate"}>{invoice.status}</Pill></td><td>{invoice.sent}</td><td>{invoice.status === "รออนุมัติ" ? <button className="small-primary" onClick={() => onIssue(invoice.id)}>อนุมัติและออก</button> : <button className="row-button" onClick={() => notify(`เปิดตัวอย่าง ${invoice.no}`)}>›</button>}</td></tr>)}</tbody></table></div></section><section className="invoice-flow">{["Draft", "Approved", "Issued", "PDF v1", "Delivered"].map((step, index) => <div key={step}><span>{index + 1}</span><b>{step}</b><small>{index === 0 ? "ข้อมูลผู้ซื้อ" : index === 1 ? "ผู้ตรวจอนุมัติ" : index === 2 ? "Running number" : index === 3 ? "SHA-256 + Storage" : "Email / signed link"}</small></div>)}</section></>;
}

function Ota() { return <><PageHeading view="ota" action={<button className="secondary-button">⟳ นำเข้า Settlement ล่าสุด</button>} /><section className="ota-providers">{[["Booking.com", "39 bookings", "฿205,165.09", "฿187,402.15", "green"], ["Trip.com", "39 bookings", "฿277,723.49", "฿254,811.90", "blue"], ["Airbnb", "11 bookings", "฿227,452.85", "฿211,190.22", "amber"]].map((row) => <article key={row[0]}><div><span className={`ota-logo ${row[4]}`}>{row[0].slice(0, 1)}</span><p><b>{row[0]}</b><small>{row[1]}</small></p><Pill tone={row[4] as Tone}>{row[4] === "amber" ? "รอตรวจ 1" : "Matched"}</Pill></div><span><small>ยอด Booking</small><b>{row[2]}</b></span><span><small>Net payout</small><b>{row[3]}</b></span></article>)}</section><section className="panel three-way"><PanelTitle kicker="Three-way reconciliation" title="เส้นทางกระทบยอด OTA" /><div className="three-way-flow"><article><span>01</span><div><small>Smart Order</small><b>Booking / Receipt</b><p>69 bookings · gross ฿710,341.43</p></div><Pill tone="green">66 matched</Pill></article><i>→</i><article><span>02</span><div><small>OTA Provider</small><b>Settlement lines</b><p>commission · refund · withholding</p></div><Pill tone="blue">net ฿653,404.27</Pill></article><i>→</i><article><span>03</span><div><small>Bank Account</small><b>Batch payout</b><p>SMART SCBT / foreign reference</p></div><Pill tone="green">3 payouts</Pill></article></div></section><section className="panel data-panel"><PanelTitle kicker="Settlement batches" title="ผลการตรวจสามทาง" /><div className="responsive-table"><table><thead><tr><th>Batch</th><th>Provider</th><th>Bookings</th><th>Gross</th><th>Fees / Refund</th><th>Net</th><th>Bank payout</th><th>ผล</th></tr></thead><tbody><tr><td className="mono">BKG-0726-A</td><td>Booking.com</td><td>19</td><td>฿205,165.09</td><td>−฿17,762.94</td><td>฿187,402.15</td><td>฿187,402.15</td><td><Pill tone="green">ตรงกัน</Pill></td></tr><tr><td className="mono">TRP-0726-C</td><td>Trip.com</td><td>39</td><td>฿277,723.49</td><td>−฿22,911.59</td><td>฿254,811.90</td><td>฿254,811.90</td><td><Pill tone="green">ตรงกัน</Pill></td></tr><tr><td className="mono">AIR-0726-B</td><td>Airbnb</td><td>11</td><td>฿227,452.85</td><td>−฿16,262.63</td><td>฿211,190.22</td><td>฿210,810.22</td><td><Pill tone="red">ต่าง ฿380</Pill></td></tr></tbody></table></div></section></>;
}

function Audit() { return <><PageHeading view="audit" action={<button className="secondary-button">⇩ ส่งออก Audit log</button>} /><section className="metrics-grid three"><Metric label="เหตุการณ์เดือนนี้" value="1,284" detail="ระบบ 72% · ผู้ใช้ 28%" tone="blue" /><Metric label="Manual actions" value="36" detail="มีเหตุผลและผู้อนุมัติครบ" tone="amber" /><Metric label="ความสมบูรณ์" value="100%" detail="ไม่พบ audit gap" tone="green" /></section><section className="panel audit-panel"><div className="audit-toolbar"><div><button className="active">ทั้งหมด</button><button>Manual</button><button>System</button><button>Security</button></div><label className="search-box">⌕<input placeholder="ค้นหา actor, action หรือ entity" /></label></div><div className="audit-list">{audits.map((event) => <div key={`${event.time}-${event.entity}`}><span className={`audit-dot ${event.tone}`} /><time>{event.time}</time><p><b>{event.action}</b><small>{event.detail}</small></p><span><b>{event.actor}</b><small>{event.entity}</small></span><button className="row-button">›</button></div>)}</div></section></>;
}

function Rules({ notify }: { notify: (value: string) => void }) { const [values, setValues] = useState({ date: "2", auto: "95", review: "85", tolerance: "0.00" }); return <><PageHeading view="rules" action={<div className="rule-actions"><Pill tone="green">Active · v1.0.0</Pill><button className="primary-button" onClick={() => notify("บันทึก ruleset v1.1.0 เป็น Draft แล้ว")}>บันทึกเป็นเวอร์ชันใหม่</button></div>} /><section className="rules-grid"><div className="panel rule-editor"><PanelTitle kicker="Matching thresholds" title="เกณฑ์การจับคู่" />{[["Date window", "จำนวนวันที่ธนาคารช้ากว่าวันรับเงิน", "date", "วัน"], ["Auto-match score", "คะแนนขั้นต่ำสำหรับอนุมัติอัตโนมัติ", "auto", "คะแนน"], ["Review score", "คะแนนขั้นต่ำสำหรับเสนอ Candidate", "review", "คะแนน"], ["Amount tolerance", "ผลต่างที่อนุญาต ค่าเริ่มต้นต้องเป็นศูนย์", "tolerance", "บาท"]].map((row) => <label className="rule-field" key={row[2]}><span><b>{row[0]}</b><small>{row[1]}</small></span><span><input value={values[row[2] as keyof typeof values]} onChange={(event) => setValues({ ...values, [row[2]]: event.target.value })} /><em>{row[3]}</em></span></label>)}</div><div className="panel"><PanelTitle kicker="Rule sequence" title="ลำดับกฎที่เปิดใช้" /><div className="rule-sequence">{[["R01", "Exact reference + amount", "100"], ["R02", "Exact date + amount + unique name", "95"], ["R03", "Date window + partial name", "85–94"], ["R04", "Grouped N:1 / 1:N", "85–94"], ["R05", "Amount delta ≠ 0 → Exception", "BLOCK"]].map((rule) => <div key={rule[0]}><span>{rule[0]}</span><p><b>{rule[1]}</b><small>เปิดใช้งาน</small></p><em>{rule[2]}</em><button className="toggle on"><i /></button></div>)}</div></div></section><section className="two-column"><div className="panel"><PanelTitle kicker="Payment mapping" title="การ normalize ช่องทางชำระ" /><div className="mapping-list">{[["BOOKINGCOM COLLECT", "BOOKING_COLLECT"], ["Booking Collect", "BOOKING_COLLECT"], ["TRIPCOM COLLECT", "TRIP_COLLECT"], ["AIRBNB COLLECT", "AIRBNB_COLLECT"]].map((map) => <div key={map[0]}><code>{map[0]}</code><span>→</span><b>{map[1]}</b><button>แก้ไข</button></div>)}</div></div><div className="panel"><PanelTitle kicker="Version history" title="ประวัติ Ruleset" /><div className="version-list"><div><span>v1.0.0</span><p><b>Production rules</b><small>5 ส.ค. 2569 · สุวรรณา ว.</small></p><Pill tone="green">ใช้งานอยู่</Pill></div><div><span>v0.9.2</span><p><b>เพิ่ม grouped matching</b><small>1 ส.ค. 2569 · ศิริพร</small></p><button>ดูรายละเอียด</button></div><div><span>v0.9.0</span><p><b>Initial bank rules</b><small>28 ก.ค. 2569 · ระบบ</small></p><button>ดูรายละเอียด</button></div></div></div></section></>;
}

function PanelTitle({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) { return <div className="panel-title"><span><small>{kicker}</small><h2>{title}</h2></span>{action}</div>; }
function RunTable({ compact = false }: { compact?: boolean }) { const data = compact ? runRows.slice(0, 3) : runRows; return <div className="responsive-table"><table className="run-table"><thead><tr><th>รอบ</th><th>งานกระทบยอด</th><th>แหล่งข้อมูล</th><th>Matched</th><th>Exception</th><th>อัตรา</th><th>สถานะ</th><th /></tr></thead><tbody>{data.map((run) => <tr key={run.id}><td><span className="phase-badge">{run.phase}</span></td><td><b>{run.name}</b><small className="block mono">{run.id} · v1.0.0</small></td><td>{run.sources}</td><td><b>{run.matched}</b></td><td>{run.exception}</td><td><b>{run.rate}</b></td><td><Pill tone={run.tone}>{run.status}</Pill></td><td><button className="row-button">›</button></td></tr>)}</tbody></table></div>; }
function StatementCard({ suffix, opening, credit, debit, closing, matched, tone, onClick }: { suffix: string; opening: string; credit: string; debit: string; closing: string; matched: string; tone: Tone; onClick: () => void }) { return <article className="statement-card"><div className="statement-head"><span><small>KASIKORNBANK</small><h2>บัญชีลงท้าย •••{suffix}</h2></span><Pill tone={tone}>Control ผ่าน · ฿0.00</Pill></div><div className="statement-values"><span><small>ยอดยกมา</small><b>{opening}</b></span><span><small>ยอดฝาก</small><b>{credit}</b></span><span><small>ยอดถอน</small><b>{debit}</b></span><span><small>ยอดยกไป</small><b>{closing}</b></span></div><div className="statement-foot"><span><b>{matched}</b><small>รายการจับคู่แล้ว</small></span><div className="bar"><i style={{ width: suffix === "885" ? "98%" : "79%" }} /></div><button onClick={onClick}>เปิดรายการจับคู่ →</button></div></article>; }
function UploadModal({ busy, defaults, onClose, onSubmit }: { busy: boolean; defaults: { period: string; documentType: string }; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><form className="upload-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose}>×</button><span className="upload-symbol">↑</span><h2>นำเข้าเอกสารประจำเดือน</h2><p>ไฟล์จะถูกจัดเก็บแยกตามเดือนและประเภทเอกสาร ตรวจ SHA-256 ป้องกันไฟล์ซ้ำ และส่งเข้าคิวประมวลผลโดยไม่เขียนทับต้นฉบับ</p><div className="selected-month"><small>ชุดเอกสารที่กำลังอัปโหลด</small><b>{monthLabel(defaults.period)}</b></div><label><span>ประเภทเอกสาร</span><select name="documentType" defaultValue={defaults.documentType}>{Object.entries(documentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>เดือนเอกสาร</span><select name="period" defaultValue={defaults.period}>{monthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}</select></label><label className="drop-zone"><input name="file" type="file" required accept=".xlsx,.xls,.pdf,.csv" /><span>＋</span><b>วางไฟล์ที่นี่ หรือคลิกเพื่อเลือก</b><small>XLSX, XLS, PDF, CSV · ไม่เกิน 25 MB</small></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "กำลังอัปโหลด…" : "อัปโหลดเข้าเดือนนี้"}</button></div></form></div>; }
