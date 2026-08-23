import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/db/client.mjs";
import { holdLine, listAuditEvents, listHolds, releaseLine } from "../lib/db/repository.mjs";
import { assembleDataset } from "../lib/dataset-builder.mjs";
import { DEFAULT_SETTINGS, applySettings } from "../lib/settings-core.mjs";
import { DEFAULT_SETTLEMENT, expectedStayWindow, normalizeSettlement } from "../lib/settlements.mjs";

// เงินเข้าที่พักไว้
//
// ก้อนโอนต้นเดือนของ Trip.com หรือ Booking.com เป็นของคำจองที่เช็คเอาท์เดือนก่อน
// เพราะรอบโอนห่างจากวันเช็คเอาท์ 7–10 วัน รายงานการรับเงินของเดือนที่เงินเข้าจึง
// ไม่มีวันมีคำจองนั้นอยู่เลย และก้อนแบบนี้จะค้างเป็น "ไม่พบคำจอง" ตลอดไป
//
// สามอย่างที่ไฟล์นี้คุมไว้:
//   1. ระบบคำนวณเองได้ว่าคำจองของก้อนนี้อยู่ในงวดไหน — คือคำตอบว่าต้องอัปโหลดเดือนไหน
//   2. พักไว้แล้วออกจากคิวจริง แต่ยอดยังอยู่ในยอดคุมของ statement ครบ
//   3. พักไว้ไม่ใช่การซ่อน — ต้องมีเหตุผล บันทึกลงสมุดตรวจ และปลดกลับได้

const settlement = normalizeSettlement(DEFAULT_SETTLEMENT);

async function freshDb() {
  const pg = new PGlite();
  const db = { query: async (sql, params = []) => (await pg.query(sql, params)).rows };
  await migrate(db);
  return db;
}

const receipt = (id, date, amountSatang, { checkIn, checkOut, method = "TRIPCOM COLLECT" } = {}) => ({
  id, sourceRow: 1, date, kind: "RECEIVE", method, amountSatang,
  reservationNo: id.replace("RCP-", "70000"), channelReservationNo: "", channel: "Trip.com",
  guest: `ผู้จอง ${id}`, group: "Baanpool", roomType: "Villa", roomNumber: "1",
  checkIn: checkIn ?? date, checkOut: checkOut ?? date, note: "",
});

const otaCredit = (id, date, amountSatang) => ({
  id, date, time: "03:19",
  description: "รับโอนเงินอัตโนมัติ", channel: "โอนเข้า/หักบัญชีอัตโนมัติ",
  detail: "จาก SMART SCBT X9633 MCP Operating a",
  direction: "credit", amountSatang, balanceSatang: amountSatang, page: 1, row: 1,
});

function build(receipts, lines, period = "2026-07") {
  const statement = {
    code: "987", period, method: "KbankGL987", source: "987.pdf",
    accountNo: "025-3-66398-7", accountName: "บริษัททดสอบ จำกัด", branch: "สาขา",
    reference: "REF", cycle: "", suffix: "987",
    openingSatang: 0,
    closingSatang: lines.reduce((sum, line) => sum + line.amountSatang, 0),
    creditSatang: lines.reduce((sum, line) => sum + line.amountSatang, 0),
    debitSatang: 0, creditCount: lines.length, debitCount: 0, controlDeltaSatang: 0,
    lines,
  };
  return assembleDataset({
    bookings: [], receipts, statements: [statement],
    sources: [{ kind: "collection_report", label: "รายงาน", name: "c.xlsx", rows: receipts.length, period }],
  });
}

// ── ระบบบอกได้เองว่าต้องอัปโหลดเดือนไหน ─────────────────────────────────────

test("ย้อนรอบโอนกลับ ได้ช่วงวันเข้าพักและงวดที่ต้องไปหา", () => {
  const trip = settlement.providers.find((item) => item.id === "TRIP");
  const stay = expectedStayWindow({ date: "2026-07-01" }, trip);

  // Trip.com โอนหลังเช็คเอาท์ 7–10 วัน ก้อนวันที่ 1 ก.ค. จึงเป็นของคนที่เช็คเอาท์
  // ปลายมิถุนายน ซึ่งเป็นเดือนที่รายงานการรับเงินของเดือนกรกฎาคมไม่มีทางมี
  assert.equal(stay.anchor, "checkOut");
  assert.equal(stay.from, "2026-06-21");
  assert.equal(stay.to, "2026-06-24");
  assert.deepEqual(stay.periods, ["2026-06"]);
});

test("Airbnb ย้อนจากวันเช็คอิน และรอบสั้นกว่ามาก", () => {
  const airbnb = settlement.providers.find((item) => item.id === "AIRBNB");
  const stay = expectedStayWindow({ date: "2026-07-11" }, airbnb);

  assert.equal(stay.anchor, "checkIn");
  assert.equal(stay.from, "2026-07-10");
  assert.equal(stay.to, "2026-07-11");
  assert.deepEqual(stay.periods, ["2026-07"]);
});

test("ก้อนที่หาคำจองไม่เจอเพราะเอกสารยังมาไม่ครบ ถูกแนะนำให้พักไว้", () => {
  const dataset = build([], [otaCredit("L-JUL01", "2026-07-01", 5532240)]);
  const [proposal] = applySettings(dataset, DEFAULT_SETTINGS, [], []).settlements;

  assert.equal(proposal.status, "EMPTY");
  assert.equal(proposal.suggestHold, true, "ต้องบอกว่าพักไว้ได้ ไม่ใช่ปล่อยค้างเป็นข้อผิดพลาด");
  assert.deepEqual(proposal.missingPeriods, ["2026-06"], "และบอกด้วยว่าต้องอัปโหลดเดือนไหน");
});

test("ก้อนที่คำจองอยู่ในเดือนที่อัปโหลดแล้ว ไม่ถูกแนะนำให้พักไว้", () => {
  // เดือนนี้มีข้อมูลอยู่แล้ว การหาไม่เจอจึงเป็นเรื่องที่ต้องดู ไม่ใช่เรื่องรอเอกสาร
  const dataset = build(
    [receipt("RCP-1", "2026-07-05", 100000, { checkIn: "2026-07-20", checkOut: "2026-07-21" })],
    [otaCredit("L-1", "2026-07-28", 999999)],
  );
  const [proposal] = applySettings(dataset, DEFAULT_SETTINGS, [], []).settlements;

  assert.deepEqual(proposal.missingPeriods, []);
  assert.equal(proposal.suggestHold, false);
});

// ── พักไว้แล้วเกิดอะไรขึ้น ──────────────────────────────────────────────────

const heldFor = (proposal) => ([{
  bankLineId: proposal.lineId, account: proposal.account, period: proposal.period,
  date: proposal.date, amountSatang: proposal.netSatang, detail: proposal.detail,
  reason: "PRIOR_PERIOD", note: "", expectedPeriod: proposal.missingPeriods[0] ?? "",
  heldBy: "test", heldAt: "2026-08-01T09:00:00",
}]);

test("พักไว้แล้วออกจากคิว แต่ยอดยังอยู่ในยอดคุมครบ", () => {
  const dataset = build([], [otaCredit("L-JUL01", "2026-07-01", 5532240)]);
  const before = applySettings(dataset, DEFAULT_SETTINGS, [], []);
  const after = applySettings(dataset, DEFAULT_SETTINGS, [], heldFor(before.settlements[0]));

  assert.equal(before.settlements.length, 1);
  assert.equal(after.settlements.length, 0, "ก้อนที่พักไว้ต้องไม่ถูกเสนอซ้ำ");
  assert.equal(after.holds.length, 1);
  assert.equal(after.heldSatang, 5532240);
  assert.equal(after.dataset.reconciliation.summary.heldLines, 1);

  // ยอดคุมของ statement ต้องไม่ขยับ — พักไว้ไม่ใช่การลบเงินออกจากบัญชี
  assert.equal(after.dataset.statements[0].creditSatang, 5532240);
  assert.equal(after.dataset.statements[0].controlDeltaSatang, 0);
});

test("ก้อนที่พักไว้ไม่กลายเป็นข้อยกเว้น และไม่ถูกนับเป็นงานค้าง", () => {
  const dataset = build([], [otaCredit("L-1", "2026-07-01", 5532240)]);
  const before = applySettings(dataset, DEFAULT_SETTINGS, [], []);
  const openBefore = before.dataset.reconciliation.exceptions
    .filter((item) => item.reason === "UNMATCHED_BANK_CREDIT").length;

  const after = applySettings(dataset, DEFAULT_SETTINGS, [], heldFor(before.settlements[0]));
  const openAfter = after.dataset.reconciliation.exceptions
    .filter((item) => item.reason === "UNMATCHED_BANK_CREDIT").length;

  assert.equal(openBefore, 1);
  assert.equal(openAfter, 0, "พักไว้แล้วต้องหลุดจากคิวเงินเข้าที่ไม่รู้ว่าของใคร");
});

test("ก้อนที่พักไว้ไม่จองคำจองของก้อนอื่นไปด้วย", () => {
  const dataset = build(
    [receipt("RCP-1", "2026-07-05", 500000, { checkIn: "2026-07-08", checkOut: "2026-07-09" })],
    [otaCredit("L-A", "2026-07-16", 500000), otaCredit("L-B", "2026-07-17", 500000)],
  );
  const before = applySettings(dataset, DEFAULT_SETTINGS, [], []);
  const first = before.settlements[0];

  const after = applySettings(dataset, DEFAULT_SETTINGS, [], heldFor(first));
  const left = after.settlements;

  assert.equal(left.length, 1, "เหลือก้อนเดียวในคิว");
  assert.deepEqual(left[0].selectedIds, ["RCP-1"], "คำจองต้องว่างให้ก้อนที่เหลือใช้");
});

test("ปลดพักแล้วกลับเข้าคิวเหมือนเดิมทุกประการ", () => {
  const dataset = build([], [otaCredit("L-1", "2026-07-01", 5532240)]);
  const before = applySettings(dataset, DEFAULT_SETTINGS, [], []);
  const held = applySettings(dataset, DEFAULT_SETTINGS, [], heldFor(before.settlements[0]));
  const released = applySettings(dataset, DEFAULT_SETTINGS, [], []);

  assert.equal(held.settlements.length, 0);
  assert.equal(released.settlements.length, before.settlements.length);
  assert.equal(released.settlements[0].netSatang, before.settlements[0].netSatang);
});

// ── ฐานข้อมูล ────────────────────────────────────────────────────────────────

test("พักไว้และปลดพัก ถูกบันทึกลงสมุดตรวจทั้งคู่", async () => {
  const db = await freshDb();
  await holdLine(db, {
    bankLineId: "987-20260701-001", account: "987", period: "2026-07", date: "2026-07-01",
    amountSatang: 5532240, detail: "จาก SMART SCBT X9633 MCP Operating a",
    reason: "PRIOR_PERIOD", note: "รอรายงานมิถุนายน", expectedPeriod: "2026-06",
  });

  const [hold] = await listHolds(db);
  assert.equal(hold.bankLineId, "987-20260701-001");
  assert.equal(hold.reason, "PRIOR_PERIOD");
  assert.equal(hold.expectedPeriod, "2026-06");
  assert.ok(hold.heldAt, "ต้องรู้ว่าพักไว้เมื่อไหร่");

  await releaseLine(db, "987-20260701-001");
  assert.deepEqual(await listHolds(db), []);

  const actions = (await listAuditEvents(db)).map((item) => item.action);
  assert.ok(actions.includes("LINE_HELD"));
  assert.ok(actions.includes("LINE_RELEASED"));
});

test("พักก้อนเดิมซ้ำ เป็นการแก้เหตุผล ไม่ใช่เพิ่มแถวใหม่", async () => {
  const db = await freshDb();
  const base = {
    bankLineId: "L-1", account: "987", period: "2026-07", date: "2026-07-01",
    amountSatang: 100000, detail: "", expectedPeriod: "",
  };
  await holdLine(db, { ...base, reason: "OTHER", note: "ยังไม่แน่ใจ" });
  await holdLine(db, { ...base, reason: "PRIOR_PERIOD", note: "รอรายงานมิถุนายน", expectedPeriod: "2026-06" });

  const holds = await listHolds(db);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].reason, "PRIOR_PERIOD");
  assert.equal(holds[0].expectedPeriod, "2026-06");
});

test("ปลดพักรายการที่ไม่มีอยู่ คืน null แทนที่จะพัง", async () => {
  const db = await freshDb();
  assert.equal(await releaseLine(db, "ไม่มีจริง"), null);
});
