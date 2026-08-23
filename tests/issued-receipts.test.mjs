import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/db/client.mjs";
import {
  findIssuedReceipt,
  issueReceipt,
  listIssuedReceipts,
  replaceBookings,
  replaceReceipts,
  replaceStatement,
  runReconciliation,
  saveDecision,
  recordDocument,
  voidReceipt,
} from "../lib/db/repository.mjs";
import { DEFAULT_SETTINGS, applySettings } from "../lib/settings-core.mjs";
import {
  DEFAULT_ORGANIZATION,
  blockersFor,
  buildReceiptDocument,
  formatReceiptNumber,
  missingOrganizationFields,
  normalizeOrganization,
  organizationReady,
  pendingReceipts,
  receiptSeries,
  settledOtaGroups,
} from "../lib/issued-receipts.mjs";

// ใบเสร็จรับเงินของก้อนโอน OTA
//
// เอกสารที่ออกให้คนนอกมีข้อบังคับที่รายงานภายในไม่มี ไฟล์นี้คุมสามข้อ:
//
//   1. ออกใบให้ก้อนที่ยังไม่ได้กระทบยอดไม่ได้ — รับรองเงินที่ยังไม่รู้ว่าเป็นของ
//      คำจองไหน คือการรับรองสิ่งที่ยังไม่รู้
//   2. เลขที่เดินต่อกันโดยไม่ข้าม และไม่ถูกใช้ซ้ำแม้ใบนั้นจะถูกยกเลิก
//   3. ใบที่ออกไปแล้วไม่เปลี่ยนตัวเองเมื่อข้อมูลต้นทางเปลี่ยน

const ORGANIZATION = normalizeOrganization({
  name: "บริษัททดสอบ จำกัด",
  taxId: "0105536000315",
  branch: "สำนักงานใหญ่",
  address: "1 ถนนทดสอบ",
  phone: "021234567",
});

async function freshDb() {
  const pg = new PGlite();
  const db = { query: async (sql, params = []) => (await pg.query(sql, params)).rows };
  await migrate(db);
  return db;
}

const booking = (reservationNo, createdDate, totalSatang) => ({
  reservationNo,
  channelReservationNo: "",
  createdAt: `${createdDate}T10:00:00`,
  createdDate,
  completedAt: "",
  creator: "test",
  guest: `ผู้จอง ${reservationNo}`,
  mobile: "",
  channel: "Trip.com",
  status: "Confirmed",
  roomType: "Villa",
  roomNumber: "1",
  nights: 1,
  totalSatang,
  payments: [],
  paidSatang: totalSatang,
  arSatang: 0,
  balanceDueSatang: 0,
});

const receipt = (id, reservationNo, date, amountSatang) => ({
  id,
  sourceRow: 1,
  date,
  kind: "RECEIVE",
  method: "TRIPCOM COLLECT",
  amountSatang,
  reservationNo,
  channelReservationNo: "",
  channel: "Trip.com",
  guest: `ผู้จอง ${reservationNo}`,
  group: "Baanpool",
  roomType: "Villa",
  roomNumber: "1",
  checkIn: date,
  checkOut: date,
  note: "",
});

const statement = (period, lines) => ({
  code: "987",
  period,
  method: "KbankGL987",
  source: `987-${period}.pdf`,
  accountNo: "025-3-66398-7",
  accountName: "บริษัททดสอบ จำกัด",
  branch: "สาขาทดสอบ",
  reference: "REF",
  cycle: "",
  suffix: "987",
  openingSatang: 0,
  closingSatang: lines.reduce((sum, line) => sum + line.amountSatang, 0),
  creditSatang: lines.reduce((sum, line) => sum + line.amountSatang, 0),
  debitSatang: 0,
  creditCount: lines.length,
  debitCount: 0,
  controlDeltaSatang: 0,
  lines,
});

const line = (id, date, amountSatang) => ({
  id,
  date,
  time: "02:25",
  description: "รับโอนเงินอัตโนมัติ",
  channel: "โอนเข้า/หักบัญชีอัตโนมัติ",
  detail: "จาก SMART SCBT X9633 MCP Operating a",
  direction: "credit",
  amountSatang,
  balanceSatang: amountSatang,
  page: 1,
  row: 1,
});

/** ฐานข้อมูลที่มีก้อนโอนหนึ่งก้อน กระทบยอดแล้วด้วยการยืนยันของผู้ตรวจ */
async function withSettledBatch({ deduction = 0 } = {}) {
  const db = await freshDb();
  const gross = 1000000;
  const net = gross - deduction;

  await replaceBookings(db, [booking("R1", "2026-07-05", 600000), booking("R2", "2026-07-06", 400000)]);
  await replaceReceipts(db, [
    receipt("RCP-1", "R1", "2026-07-05", 600000),
    receipt("RCP-2", "R2", "2026-07-06", 400000),
  ]);
  await replaceStatement(db, statement("2026-07", [line("L-OTA", "2026-07-14", net)]));
  await recordDocument(db, {
    id: "DOC-collection", kind: "collection", periods: ["2026-07"], name: "c.xlsx",
    sha256: "a".repeat(64), sizeBytes: 1, rowCount: 2, uploadedBy: "test",
  });

  const decision = await saveDecision(db, {
    kind: "SETTLEMENT",
    receiptIds: ["RCP-1", "RCP-2"],
    bankLineIds: ["L-OTA"],
    receiptSatang: gross,
    bankSatang: net,
    differenceSatang: deduction,
    reason: deduction ? "COMMISSION" : "ROUNDING",
    note: deduction ? "คอม Trip.com" : "",
  });

  return { db, decision, gross, net };
}

async function settledGroup(db, decisions) {
  const { dataset } = await runReconciliation(db);
  const effective = applySettings(dataset, { ...DEFAULT_SETTINGS, organization: ORGANIZATION }, decisions);
  const [group] = settledOtaGroups(effective.dataset);
  return { group, effective };
}

const documentFor = (group) => buildReceiptDocument({
  group,
  settlement: DEFAULT_SETTINGS.settlement,
  organization: ORGANIZATION,
  number: "",
  issuedAt: "",
});

// ── ข้อมูลผู้ออกเอกสาร ───────────────────────────────────────────────────────

test("ค่าตั้งต้นของผู้ออกใบเสร็จว่างเปล่า ระบบไม่เดาชื่อกิจการให้", () => {
  assert.equal(DEFAULT_ORGANIZATION.name, "");
  assert.equal(DEFAULT_ORGANIZATION.taxId, "");
  assert.equal(organizationReady(DEFAULT_ORGANIZATION), false);
  assert.ok(missingOrganizationFields(DEFAULT_ORGANIZATION).length >= 2);
});

test("เลขประจำตัวผู้เสียภาษีเก็บเฉพาะตัวเลข และต้องครบ 13 หลัก", () => {
  const spaced = normalizeOrganization({ name: "ทดสอบ", taxId: "0-1055-36000-31-5" });
  assert.equal(spaced.taxId, "0105536000315");
  assert.equal(organizationReady(spaced), true);

  const short = normalizeOrganization({ name: "ทดสอบ", taxId: "01055" });
  assert.equal(organizationReady(short), false);
  assert.ok(missingOrganizationFields(short).some((item) => item.includes("13 หลัก")));
});

// ── ก้อนที่ออกใบได้ ──────────────────────────────────────────────────────────

test("ก้อนที่ยังไม่ได้กระทบยอด ออกใบเสร็จไม่ได้", async () => {
  const db = await freshDb();
  await replaceBookings(db, [booking("R1", "2026-07-05", 1000000)]);
  await replaceReceipts(db, [receipt("RCP-1", "R1", "2026-07-05", 1000000)]);
  await replaceStatement(db, statement("2026-07", [line("L-OTA", "2026-07-14", 900000)]));
  await recordDocument(db, {
    id: "DOC-c", kind: "collection", periods: ["2026-07"], name: "c.xlsx",
    sha256: "b".repeat(64), sizeBytes: 1, rowCount: 1, uploadedBy: "test",
  });

  const { dataset } = await runReconciliation(db);
  const effective = applySettings(dataset, { ...DEFAULT_SETTINGS, organization: ORGANIZATION }, []);

  // ก้อนนี้ถูก "เสนอ" ให้แตกยอด แต่ยังไม่มีใครยืนยัน
  assert.ok(effective.settlements.length > 0, "ต้องมีข้อเสนออยู่");
  assert.equal(settledOtaGroups(effective.dataset).length, 0, "ข้อเสนอไม่ใช่ก้อนที่กระทบยอดแล้ว");
  assert.equal(pendingReceipts(effective.dataset, []).length, 0, "จึงต้องไม่มีอะไรให้ออกใบ");
});

test("ข้อมูลผู้ออกไม่ครบ = ออกใบไม่ได้ และบอกว่าขาดอะไร", async () => {
  const { db, decision } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);

  const blockers = blockersFor(group, DEFAULT_ORGANIZATION);
  assert.ok(blockers.length > 0);
  assert.deepEqual(blockersFor(group, ORGANIZATION), []);
});

// ── ตัวเอกสาร ────────────────────────────────────────────────────────────────

test("ยอดบนใบเสร็จคือเงินที่รับมาจริง ส่วนต่างถูกแสดงเป็นบรรทัดหัก ไม่ใช่ซ่อน", async () => {
  const { db, decision, gross, net } = await withSettledBatch({ deduction: 100000 });
  const { group } = await settledGroup(db, [decision]);
  const document = documentFor(group);

  assert.equal(document.grossSatang, gross);
  assert.equal(document.deductionSatang, 100000);
  assert.equal(document.netSatang, net, "ใบเสร็จรับรองเงินที่เข้าบัญชีจริง");
  assert.equal(document.grossSatang - document.deductionSatang, document.netSatang);
  assert.equal(document.deductionLabel, "ค่าคอมมิชชั่น OTA", "ต้องบอกว่าหักอะไร");
  assert.equal(document.lines.length, 2);
  assert.equal(document.lines.reduce((sum, row) => sum + row.amountSatang, 0), gross);
});

test("ก้อนที่ยอดตรงพอดี ใบเสร็จไม่มีบรรทัดหักเลย", async () => {
  const { db, decision, gross } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);
  const document = documentFor(group);

  assert.equal(document.deductionSatang, 0);
  assert.equal(document.netSatang, gross);
});

test("ใบเสร็จลงวันที่ที่เงินเข้าบัญชี ไม่ใช่วันที่กดออกเอกสาร", async () => {
  const { db, decision } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);
  assert.equal(documentFor(group).date, "2026-07-14");
});

test("ผู้จ่ายบนใบเสร็จอ่านจาก OTA เจ้าของก้อน", async () => {
  const { db, decision } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);

  assert.equal(documentFor(group).payer.providerId, "TRIP");
  assert.equal(documentFor(group).payer.name, "Trip.com", "ไม่ได้ตั้งชื่อนิติบุคคลไว้ ใช้ชื่อที่แสดง");

  const named = buildReceiptDocument({
    group,
    settlement: {
      ...DEFAULT_SETTINGS.settlement,
      providers: DEFAULT_SETTINGS.settlement.providers.map((provider) =>
        (provider.id === "TRIP" ? { ...provider, payerName: "Trip.com Travel Singapore Pte. Ltd." } : provider)),
    },
    organization: ORGANIZATION,
    number: "",
    issuedAt: "",
  });
  assert.equal(named.payer.name, "Trip.com Travel Singapore Pte. Ltd.");
});

// ── เลขที่เอกสาร ─────────────────────────────────────────────────────────────

test("ชุดเลขแยกตามเดือนที่รับเงิน และรูปแบบเลขคงที่", () => {
  assert.equal(receiptSeries("2026-07-14"), "RC-202607");
  assert.equal(receiptSeries("2026-12-01"), "RC-202612");
  assert.equal(formatReceiptNumber("RC-202607", 1), "RC-202607-0001");
  assert.equal(formatReceiptNumber("RC-202607", 42), "RC-202607-0042");
});

test("เลขเดินต่อกันภายในชุด และใบที่ออกแล้วอ่านกลับมาได้เหมือนเดิม", async () => {
  const { db, decision } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);

  const first = await issueReceipt(db, {
    document: documentFor(group), series: receiptSeries(group.date), decisionId: decision.id,
  });
  assert.equal(first.number, "RC-202607-0001");
  assert.equal(first.sequence, 1);
  assert.equal(first.document.number, first.number, "เลขที่ต้องถูกประทับลงในตัวเอกสารด้วย");
  assert.ok(first.issuedAt, "ต้องบันทึกเวลาที่ออก");

  const reread = await findIssuedReceipt(db, first.number);
  assert.deepEqual(reread.document, first.document);
});

test("ก้อนเดียวออกใบซ้ำไม่ได้ ตราบใดที่ใบเดิมยังใช้ได้", async () => {
  const { db, decision } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);
  const input = { document: documentFor(group), series: receiptSeries(group.date), decisionId: decision.id };

  await issueReceipt(db, input);
  await assert.rejects(() => issueReceipt(db, input), /ออกใบเสร็จไปแล้ว/);
});

test("ยกเลิกแล้วออกใบใหม่ได้ แต่เลขเดิมไม่ถูกนำกลับมาใช้ซ้ำ", async () => {
  const { db, decision } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);
  const input = { document: documentFor(group), series: receiptSeries(group.date), decisionId: decision.id };

  const first = await issueReceipt(db, input);
  const voided = await voidReceipt(db, first.number, "ออกผิดก้อน");

  assert.equal(voided.number, first.number, "ใบที่ยกเลิกยังอยู่ ไม่ถูกลบ");
  assert.ok(voided.voidedAt);
  assert.equal(voided.voidReason, "ออกผิดก้อน");

  const second = await issueReceipt(db, input);
  assert.equal(second.number, "RC-202607-0002", "เลขเดินต่อ ไม่ย้อนกลับไปใช้เลขที่ยกเลิก");

  const all = await listIssuedReceipts(db);
  assert.equal(all.length, 2, "ทั้งสองใบยังอยู่ในสมุดเลข");
  assert.equal(all.filter((item) => !item.voidedAt).length, 1);
});

test("ก้อนที่ออกใบแล้วหลุดจากรายการที่รอออกใบ ส่วนก้อนที่ยกเลิกใบกลับเข้ามา", async () => {
  const { db, decision } = await withSettledBatch();
  const { group, effective } = await settledGroup(db, [decision]);

  assert.equal(pendingReceipts(effective.dataset, []).length, 1);

  const issued = await issueReceipt(db, {
    document: documentFor(group), series: receiptSeries(group.date), decisionId: decision.id,
  });
  assert.equal(pendingReceipts(effective.dataset, await listIssuedReceipts(db)).length, 0);

  await voidReceipt(db, issued.number, "ชื่อผู้จ่ายผิด");
  assert.equal(pendingReceipts(effective.dataset, await listIssuedReceipts(db)).length, 1, "ยกเลิกแล้วต้องกลับมาให้ออกใหม่");
});

// ── สำเนาที่แช่แข็ง ──────────────────────────────────────────────────────────

test("อัปโหลดเอกสารทับใหม่ ไม่ทำให้ใบที่ออกไปแล้วเปลี่ยนตัวเลข", async () => {
  const { db, decision, gross } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);

  const issued = await issueReceipt(db, {
    document: documentFor(group), series: receiptSeries(group.date), decisionId: decision.id,
  });

  // เดือนเดิมถูกอัปโหลดใหม่ด้วยตัวเลขที่ต่างออกไป — เกิดขึ้นจริงเมื่อ PMS แก้ย้อนหลัง
  await replaceReceipts(db, [
    receipt("RCP-1", "R1", "2026-07-05", 111111),
    receipt("RCP-2", "R2", "2026-07-06", 222222),
  ]);
  await runReconciliation(db);

  const reread = await findIssuedReceipt(db, issued.number);
  assert.equal(reread.grossSatang, gross, "ใบที่ส่งไปแล้วต้องไม่ขยับตามข้อมูลใหม่");
  assert.equal(reread.document.lines[0].amountSatang, 600000);
  assert.equal(reread.document.lines.reduce((sum, row) => sum + row.amountSatang, 0), gross);
});

test("การยกเลิกถูกบันทึกไว้ในสมุดตรวจ", async () => {
  const { db, decision } = await withSettledBatch();
  const { group } = await settledGroup(db, [decision]);

  const issued = await issueReceipt(db, {
    document: documentFor(group), series: receiptSeries(group.date), decisionId: decision.id,
  });
  await voidReceipt(db, issued.number, "ทดสอบ");

  const events = await db.query(
    "SELECT action, entity_id, detail FROM clearclose.audit_events WHERE entity_type = 'issued_receipt' ORDER BY id ASC",
  );
  assert.deepEqual(events.map((row) => row.action), ["RECEIPT_ISSUED", "RECEIPT_VOIDED"]);
  assert.equal(events[1].entity_id, issued.number);
  assert.equal(JSON.parse(events[1].detail).reason, "ทดสอบ");
});

test("ยกเลิกใบที่ไม่มีอยู่ คืน null แทนที่จะพัง", async () => {
  const db = await freshDb();
  assert.equal(await voidReceipt(db, "RC-202607-9999", "ไม่มีจริง"), null);
});
