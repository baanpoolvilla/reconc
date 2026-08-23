import assert from "node:assert/strict";
import test from "node:test";

import { assembleDataset } from "../lib/dataset-builder.mjs";
import { DEFAULT_SETTINGS, applySettings } from "../lib/settings-core.mjs";
import { RULES, reconcile } from "../lib/reconciliation.mjs";

// งวดที่เหลือวัน Check-in (R08)
//
// คำจองหนึ่งใบจ่ายเป็นงวดได้ และสองงวดนั้นเข้าบัญชีคนละวันตามธรรมชาติ:
// มัดจำเข้าวันที่สร้างคำจอง ส่วนค่าห้องที่เหลือเข้าวันที่แขก Check-in
//
// R01 อธิบายงวดแรกได้ครบและไม่เคยอธิบายงวดที่สองได้เลย เพราะวันที่มันมองหาผ่านไป
// แล้วตั้งแต่ตอนจอง ใบงวดที่สองจึงตกเป็นข้อยกเว้นทั้งที่เงินเข้าตรงวันตรงยอด
//
// สิ่งที่ไฟล์นี้คุมไว้คือ R08 ต้องไม่กลายเป็น "จับคู่ด้วยยอด วันไหนก็ได้":
// เงื่อนไขวันรับเงิน = วัน Check-in = วันเงินเข้า ต้องครบทั้งสามขา

const booking = (reservationNo, createdDate, totalSatang) => ({
  reservationNo,
  channelReservationNo: "",
  createdAt: `${createdDate}T10:00:00`,
  createdDate,
  completedAt: "",
  creator: "test",
  guest: `ผู้จอง ${reservationNo}`,
  mobile: "",
  channel: "Direct",
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

const receipt = (id, reservationNo, date, amountSatang, { checkIn, checkOut } = {}) => ({
  id,
  sourceRow: 1,
  date,
  kind: "RECEIVE",
  method: "KbankGL987",
  amountSatang,
  reservationNo,
  channelReservationNo: "",
  channel: "Direct",
  guest: `ผู้จอง ${reservationNo}`,
  group: "Baanpool",
  roomType: "Villa",
  roomNumber: "1",
  checkIn: checkIn ?? date,
  checkOut: checkOut ?? date,
  note: "",
});

const credit = (id, date, amountSatang) => ({
  id,
  date,
  time: "10:15",
  description: "รับโอนเงิน",
  channel: "Internet/Mobile KBank",
  detail: "จาก KBANK X1234",
  direction: "credit",
  amountSatang,
  balanceSatang: amountSatang,
  page: 1,
  row: 1,
});

function build(bookings, receipts, lines, period = "2026-07") {
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
    bookings, receipts, statements: [statement],
    sources: [{ kind: "collection_report", label: "รายงาน", name: "c.xlsx", rows: receipts.length, period }],
  });
}

const typesOf = (dataset) => dataset.reconciliation.groups.map((group) => group.type).sort();
const groupFor = (dataset, receiptId) =>
  dataset.reconciliation.groups.find((group) => group.receipts.some((row) => row.id === receiptId));

// ── กฎถูกประกาศไว้ ───────────────────────────────────────────────────────────

test("R08 อยู่ในรายการกฎ และอยู่ก่อนข้อยกเว้น", () => {
  const ids = RULES.map((rule) => rule.id);
  assert.ok(ids.includes("R08"));
  assert.ok(ids.indexOf("R08") < ids.indexOf("R07"), "ต้องประกาศก่อนข้อที่บอกว่าที่เหลือเป็นข้อยกเว้น");
  const rule = RULES.find((item) => item.id === "R08");
  assert.match(rule.label, /Check-in/);
  assert.ok(!rule.blocking, "R08 เป็นรูปแบบการจับคู่ ไม่ใช่กฎบังคับ");
});

// ── เคสจริง: จ่ายสองงวด ──────────────────────────────────────────────────────

test("มัดจำเข้าวันจอง ค่าที่เหลือเข้าวัน Check-in — จับได้ทั้งสองงวด", () => {
  const dataset = build(
    [booking("R1", "2026-07-05", 690000)],
    [
      receipt("RCP-1", "R1", "2026-07-05", 390000, { checkIn: "2026-07-20", checkOut: "2026-07-21" }),
      receipt("RCP-2", "R1", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" }),
    ],
    [credit("L-1", "2026-07-05", 390000), credit("L-2", "2026-07-20", 300000)],
  );

  assert.deepEqual(typesOf(dataset), ["1:1", "1:1+CHECKIN"]);
  assert.equal(dataset.reconciliation.summary.matchedReceipts, 2);
  assert.equal(dataset.reconciliation.exceptions.length, 0);

  // งวดแรกยังผ่าน R01 เหมือนเดิม — กฎเดิมไม่ถูกผ่อนแม้แต่น้อย
  const first = groupFor(dataset, "RCP-1");
  assert.equal(first.type, "1:1");
  assert.deepEqual(first.rulesPassed.map((rule) => rule.id), ["R01", "R02"]);
  assert.ok(first.rulesPassed.every((rule) => rule.passed));

  // งวดที่สองรายงานตามกฎที่มันผ่านจริง ไม่ใช่แสดง R01 แล้วขึ้นว่าไม่ผ่าน
  const second = groupFor(dataset, "RCP-2");
  assert.equal(second.type, "1:1+CHECKIN");
  assert.deepEqual(second.rulesPassed.map((rule) => rule.id), ["R08", "R02"]);
  assert.ok(second.rulesPassed.every((rule) => rule.passed));
  assert.equal(second.deltaSatang, 0);
});

test("รวมสองงวดแล้วเท่ากับยอดคำจอง และอ้างเลขที่จองเดียวกัน", () => {
  const dataset = build(
    [booking("R1", "2026-07-05", 690000)],
    [
      receipt("RCP-1", "R1", "2026-07-05", 390000, { checkIn: "2026-07-20", checkOut: "2026-07-21" }),
      receipt("RCP-2", "R1", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" }),
    ],
    [credit("L-1", "2026-07-05", 390000), credit("L-2", "2026-07-20", 300000)],
  );

  const paid = dataset.reconciliation.groups.reduce((sum, group) => sum + group.bankSatang, 0);
  assert.equal(paid, 690000, "สองงวดรวมกันต้องเท่ากับยอดรวมของคำจอง");
  for (const group of dataset.reconciliation.groups) {
    assert.equal(group.receipts[0].reservationNo, "R1");
  }
});

// ── กฎต้องไม่กว้างเกินที่ตกลงไว้ ────────────────────────────────────────────

test("รับเงินคนละวันกับวัน Check-in ต้องไม่ถูกจับ แม้ยอดจะตรงเป๊ะ", () => {
  // นี่คือเส้นที่กัน R08 ไม่ให้กลายเป็น "จับคู่ด้วยยอด วันไหนก็ได้"
  const dataset = build(
    [booking("R1", "2026-07-05", 300000)],
    [receipt("RCP-1", "R1", "2026-07-18", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" })],
    [credit("L-1", "2026-07-18", 300000)],
  );

  assert.equal(dataset.reconciliation.groups.length, 0);
  assert.equal(dataset.reconciliation.exceptions.filter((item) => item.receiptId).length, 1);
});

test("เงินเข้าคนละวันกับวัน Check-in ต้องไม่ถูกจับ", () => {
  const dataset = build(
    [booking("R1", "2026-07-05", 300000)],
    [receipt("RCP-1", "R1", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" })],
    [credit("L-1", "2026-07-21", 300000)],
  );

  assert.equal(dataset.reconciliation.groups.length, 0);
});

test("ยอดต่างกันแม้แต่สตางค์เดียวก็ไม่ถูกจับ และชี้ไปที่เงินก้อนที่ใกล้ที่สุดในวัน Check-in", () => {
  const dataset = build(
    [booking("R1", "2026-07-05", 300000)],
    [receipt("RCP-1", "R1", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" })],
    [credit("L-1", "2026-07-20", 300001)],
  );

  assert.equal(dataset.reconciliation.groups.length, 0);

  // รายงานว่า "ยอดไม่ตรง" พร้อมชี้ก้อนที่ใกล้ที่สุด ไม่ใช่ "ไม่มีเงินเข้าในวันที่
  // สร้างคำจอง" ซึ่งจะส่งผู้ตรวจไปหาผิดวันทั้งวัน
  const [exception] = dataset.reconciliation.exceptions;
  assert.equal(exception.reason, "AMOUNT_MISMATCH");
  assert.equal(exception.bankLineId, "L-1");
  assert.equal(exception.deltaSatang, -1);
});

test("เงินเข้าหนึ่งก้อนถูกใช้ได้ครั้งเดียว แม้จะมีสองใบเข้าเงื่อนไขวันเดียวกัน", () => {
  const dataset = build(
    [booking("R1", "2026-07-05", 300000), booking("R2", "2026-07-06", 300000)],
    [
      receipt("RCP-1", "R1", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" }),
      receipt("RCP-2", "R2", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" }),
    ],
    [credit("L-1", "2026-07-20", 300000)],
  );

  assert.equal(dataset.reconciliation.groups.length, 1);
  assert.equal(dataset.reconciliation.exceptions.filter((item) => item.receiptId).length, 1);
  const used = dataset.reconciliation.groups.flatMap((group) => group.lines.map((line) => line.id));
  assert.equal(new Set(used).size, used.length);
});

// ── ลำดับความสำคัญของกฎ ────────────────────────────────────────────────────

test("จองและเข้าพักวันเดียวกัน ยังถูกจับด้วยกฎเดิม ไม่ใช่กฎใหม่", () => {
  const dataset = build(
    [booking("R1", "2026-07-20", 300000)],
    [receipt("RCP-1", "R1", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" })],
    [credit("L-1", "2026-07-20", 300000)],
  );

  assert.equal(groupFor(dataset, "RCP-1").type, "1:1", "R03 มีสิทธิ์ก่อนเสมอ");
});

test("ค่าประกันยังทำงาน เมื่อไม่มีเงินเข้าที่ตรงยอดค่าห้องพอดี", () => {
  const dataset = build(
    [booking("R1", "2026-07-05", 500000)],
    [receipt("RCP-1", "R1", "2026-07-20", 500000, { checkIn: "2026-07-20", checkOut: "2026-07-21" })],
    [credit("L-1", "2026-07-20", 800000)],
  );

  const effective = applySettings(dataset, DEFAULT_SETTINGS, []);
  const [group] = effective.dataset.reconciliation.groups;
  assert.equal(group.type, "1:1+DEPOSIT");
  assert.equal(group.depositSatang, 300000);
});

// ── งวดที่เหลือที่ข้ามเดือน ─────────────────────────────────────────────────

test("จองเดือนก่อน เข้าพักเดือนนี้ — งวดที่เหลือหา statement ของเดือนที่เงินเข้าเจอ", () => {
  // อาการเดิม: ใบนี้ถูกผูกกับ statement ของเดือนที่จอง ซึ่งไม่มีเงินก้อนนี้อยู่เลย
  // แล้วถูกรายงานว่า "ยังไม่มี Statement ของงวดนี้" ทั้งที่เงินเข้าเดือนนี้ตรงยอด
  const dataset = build(
    [booking("R1", "2026-06-20", 300000)],
    [receipt("RCP-1", "R1", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" })],
    [credit("L-1", "2026-07-20", 300000)],
  );

  assert.equal(dataset.reconciliation.groups.length, 1);
  assert.equal(groupFor(dataset, "RCP-1").type, "1:1+CHECKIN");
  assert.equal(dataset.reconciliation.outOfScope.length, 0, "ต้องไม่ถูกรายงานว่าไม่มี Statement");
});

// ── ข้อมูลต้นฉบับไม่ถูกแตะ ──────────────────────────────────────────────────

test("กฎใหม่ไม่แก้ยอดของเอกสารฝั่งไหนเลย", () => {
  const dataset = build(
    [booking("R1", "2026-07-05", 690000)],
    [
      receipt("RCP-1", "R1", "2026-07-05", 390000, { checkIn: "2026-07-20", checkOut: "2026-07-21" }),
      receipt("RCP-2", "R1", "2026-07-20", 300000, { checkIn: "2026-07-20", checkOut: "2026-07-21" }),
    ],
    [credit("L-1", "2026-07-05", 390000), credit("L-2", "2026-07-20", 300000)],
  );
  const before = JSON.stringify({ r: dataset.receipts, s: dataset.statements });
  reconcile(dataset);
  assert.equal(JSON.stringify({ r: dataset.receipts, s: dataset.statements }), before);
});
