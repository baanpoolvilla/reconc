import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { RULES, reconcile } from "../lib/reconciliation.mjs";
import { DEFAULT_SETTINGS, applySettings, normalizeSettings } from "../lib/settings-core.mjs";

// R06 · ค่าประกันวัน Check-in
//
// ลูกค้าโอนค่าห้องพร้อมค่าประกันมาเป็นก้อนเดียวในวันเข้าพัก ยอดที่เข้าบัญชีจึงมาก
// กว่ายอดในรายงานรับเงินอยู่พอดีหนึ่งค่าประกัน กฎ R03 จับไม่ได้เพราะยอดไม่เท่ากัน
// ไม่ใช่เพราะข้อมูลผิด
//
// สิ่งที่ไฟล์นี้คุมไว้เป็นหลักคือ **จำนวนค่าประกันมาจากการตั้งค่าเท่านั้น** เปลี่ยน
// ค่าในหน้าตั้งค่าแล้วเครื่องมือจับคู่ต้องใช้จำนวนใหม่ทันทีโดยไม่ต้องแก้โค้ด

const DEPOSIT = 300000;

const booking = (reservationNo, createdDate) => ({
  reservationNo,
  channelReservationNo: "",
  createdAt: `${createdDate}T09:00:00`,
  createdDate,
  completedAt: "",
  creator: "test",
  guest: `ผู้เข้าพัก ${reservationNo}`,
  mobile: "",
  channel: "Direct",
  status: "Confirmed",
  roomType: "Pool Villa",
  roomNumber: "01",
  nights: 1,
  totalSatang: 0,
  payments: [],
  paidSatang: 0,
  arSatang: 0,
  balanceDueSatang: 0,
});

const receipt = (id, reservationNo, date, amountSatang, checkIn) => ({
  id,
  sourceRow: 1,
  date,
  kind: "RECEIVE",
  method: "KbankGL987",
  amountSatang,
  reservationNo,
  channelReservationNo: "",
  channel: "Direct",
  guest: `ผู้เข้าพัก ${reservationNo}`,
  group: "Baanpool-บางแสน",
  roomType: "Pool Villa",
  roomNumber: "01",
  checkIn,
  checkOut: checkIn,
  note: "",
});

const credit = (id, date, amountSatang) => ({
  id,
  date,
  time: "11:00",
  description: "รับโอนเงิน",
  channel: "Internet/Mobile KBank",
  detail: "จาก KBANK X1234",
  direction: "credit",
  amountSatang,
  balanceSatang: amountSatang,
  page: 1,
  row: 1,
});

const statement = (lines) => ({
  code: "987",
  period: "2026-07",
  method: "KbankGL987",
  source: "987.pdf",
  accountNo: "123-4-56789-0",
  accountName: "บริษัททดสอบ จำกัด",
  branch: "สาขาทดสอบ",
  reference: "",
  cycle: "01/07/2026 - 31/07/2026",
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

const run = (dataset, securityDepositSatang = DEPOSIT) => reconcile(dataset, { securityDepositSatang });

// ── การตั้งค่า ───────────────────────────────────────────────────────────────

test("ค่าประกันตั้งต้นคือ 300000 สตางค์ และเป็นจำนวนเต็ม", () => {
  assert.equal(DEFAULT_SETTINGS.matching.securityDepositSatang, 300000);
  assert.ok(
    Number.isInteger(DEFAULT_SETTINGS.matching.securityDepositSatang),
    "เงินต้องเป็นจำนวนเต็มสตางค์ ไม่ใช่ float",
  );
});

test("การตั้งค่าเก่าที่ยังไม่มีช่องนี้ ถูกเติมค่าตั้งต้นให้", () => {
  // รูปร่างของค่าที่บันทึกไว้ก่อนมีกฎค่าประกัน ทั้งใน localStorage และในฐานข้อมูล
  const legacy = { version: 1, matching: { allowManyToOne: true, allowOneToMany: false, maxGroupSize: 3 } };
  const normalized = normalizeSettings(legacy);

  assert.equal(normalized.matching.securityDepositSatang, 300000, "ของเก่าต้องไม่กลายเป็นศูนย์");
  assert.equal(normalized.matching.allowOneToMany, false, "ค่าที่เคยตั้งไว้ต้องไม่ถูกกลบ");
  assert.equal(normalized.matching.maxGroupSize, 3);
});

test("ค่าประกันที่ใช้ไม่ได้ถูกซ่อมเป็นค่าที่ใช้ได้ ไม่ปล่อยผ่าน", () => {
  const of = (value) => normalizeSettings({ matching: { securityDepositSatang: value } }).matching.securityDepositSatang;

  assert.equal(of(500000), 500000);
  assert.equal(of(0), 100, "ไม่มีสวิตช์ปิด ขั้นต่ำจึงเป็นหนึ่งบาท");
  assert.equal(of(-1), 100);
  assert.equal(of("ห้าพัน"), 300000, "อ่านไม่ออกให้กลับไปใช้ค่าตั้งต้น");
  assert.equal(of(300000.7), 300001, "ปัดเป็นจำนวนเต็มสตางค์เสมอ");
});

test("จำนวนค่าประกันไม่ถูกเขียนไว้ในเครื่องมือจับคู่", async () => {
  const engine = await readFile(new URL("../lib/reconciliation.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(engine, /300000/, "จำนวนค่าประกันต้องมาจากการตั้งค่าเท่านั้น");
  assert.match(RULES.find((rule) => rule.id === "R06").label, /ค่าประกัน/);
});

// ── การจับคู่ ────────────────────────────────────────────────────────────────

test("รายงาน 5,000 กับเงินเข้า 8,000 ในวัน Check-in จับคู่ได้เมื่อค่าประกันเป็น 3,000", () => {
  const result = run({
    bookings: [booking("R1", "2026-07-01")],
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10")],
    statements: [statement([credit("L1", "2026-07-10", 800000)])],
  });

  assert.equal(result.groups.length, 1);
  const [group] = result.groups;
  assert.equal(group.type, "1:1+DEPOSIT");
  assert.equal(group.receiptSatang, 500000);
  assert.equal(group.bankSatang, 800000);
  assert.equal(group.depositSatang, 300000);
  assert.equal(group.comparableBankSatang, 500000);
  assert.equal(group.deltaSatang, 0);
  assert.equal(group.rawDeltaSatang, -300000);
  assert.equal(group.date, "2026-07-10", "กลุ่มยึดวัน Check-in");
  assert.ok(group.rulesPassed.every((rule) => rule.passed), "ต้องรายงานกฎที่มันผ่านจริง");
  assert.equal(result.exceptions.length, 0);
});

test("เปลี่ยนค่าประกันเป็น 5,000 แล้วเครื่องมือจับคู่ใช้จำนวนใหม่ทันที", () => {
  const dataset = {
    bookings: [booking("R1", "2026-07-01")],
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10")],
    statements: [statement([credit("L1", "2026-07-10", 1000000)])],
  };

  // 10,000 = 5,000 + 5,000 · จับได้ก็ต่อเมื่อค่าประกันถูกตั้งเป็น 5,000
  assert.equal(run(dataset, 300000).groups.length, 0, "ค่าประกัน 3,000 ต้องจับก้อนนี้ไม่ได้");

  const [group] = run(dataset, 500000).groups;
  assert.ok(group, "ค่าประกัน 5,000 ต้องจับได้");
  assert.equal(group.depositSatang, 500000);
  assert.equal(group.comparableBankSatang, 500000);
  assert.equal(group.deltaSatang, 0);
  assert.equal(group.rawDeltaSatang, -500000);
});

test("เงินเข้า 8,000 ต้องไม่ถูกจับ เมื่อค่าประกันถูกตั้งเป็น 5,000", () => {
  const result = run({
    bookings: [booking("R1", "2026-07-01")],
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10")],
    statements: [statement([credit("L1", "2026-07-10", 800000)])],
  }, 500000);

  assert.equal(result.groups.length, 0, "ส่วนต่าง 3,000 ไม่ใช่ค่าประกันที่ตั้งไว้แล้ว");
  assert.ok(result.exceptions.some((item) => item.receiptId === "RCP-1"));
});

test("ยอดต่างถูกต้องแต่ไม่ใช่วัน Check-in ต้องไม่ถูกจับ", () => {
  const result = run({
    bookings: [booking("R1", "2026-07-01")],
    // รับเงินวันที่ 10 แต่เข้าพักวันที่ 20 — ส่วนต่างเท่าค่าประกันพอดีก็ไม่ใช่ค่าประกัน
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-20")],
    statements: [statement([credit("L1", "2026-07-10", 800000)])],
  });

  assert.equal(result.groups.length, 0);
});

test("จ่ายวันจองก่อนวัน Check-in ไม่ถูกตีความเป็นค่าประกัน", () => {
  // จองและจ่ายวันที่ 1 เข้าพักวันที่ 20 · ค่าประกันเก็บตอนเข้าพัก ไม่ใช่ตอนจอง
  const result = run({
    bookings: [booking("R1", "2026-07-01")],
    receipts: [receipt("RCP-1", "R1", "2026-07-01", 500000, "2026-07-20")],
    statements: [statement([credit("L1", "2026-07-01", 800000)])],
  });

  assert.equal(result.groups.length, 0, "เงินเข้าวันจองที่เกินมา ต้องไปเข้าคิวให้คนดู ไม่ใช่จับให้เอง");
  assert.equal(result.exceptions.filter((item) => item.receiptId === "RCP-1").length, 1);
});

test("จองและ Check-in วันเดียวกัน จับคู่ได้ตามธรรมชาติของกฎ", () => {
  const result = run({
    bookings: [booking("R1", "2026-07-10")],
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10")],
    statements: [statement([credit("L1", "2026-07-10", 800000)])],
  });

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].type, "1:1+DEPOSIT");
});

test("กฎค่าประกันไม่ใช้วันที่สร้างคำจองเป็นเงื่อนไข", () => {
  // วันที่สร้างคำจองอยู่คนละเดือนกับวันเข้าพัก และไม่มีเงินเข้าวันนั้นเลย
  const result = run({
    bookings: [booking("R1", "2026-05-02")],
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10")],
    statements: [statement([credit("L1", "2026-07-10", 800000)])],
  });

  assert.equal(result.groups.length, 1, "วันจองไม่เกี่ยวกับกฎนี้");
  assert.equal(result.groups[0].date, "2026-07-10");
});

// ── อยู่ร่วมกับกฎเดิม ────────────────────────────────────────────────────────

test("ยอดที่ตรงตามรายงานพอดี ยังถูกจับด้วยกฎเดิม ไม่ใช่กฎค่าประกัน", () => {
  const result = run({
    bookings: [booking("R1", "2026-07-10")],
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10")],
    statements: [statement([credit("L1", "2026-07-10", 500000)])],
  });

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].type, "1:1", "R03 ต้องได้จับก่อนเสมอ");
  assert.equal(result.groups[0].depositSatang, 0);
  assert.equal(result.groups[0].rawDeltaSatang, 0);
});

test("รายการรับเงินและเงินเข้าถูกใช้ได้ครั้งเดียว ไม่ถูกจับซ้ำ", () => {
  const result = run({
    bookings: [booking("R1", "2026-07-10"), booking("R2", "2026-07-10")],
    receipts: [
      receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10"),
      receipt("RCP-2", "R2", "2026-07-10", 500000, "2026-07-10"),
    ],
    // เงินเข้าก้อนเดียวที่เข้าได้กับทั้งสองใบ
    statements: [statement([credit("L1", "2026-07-10", 800000)])],
  });

  assert.equal(result.groups.length, 1, "เงินเข้าก้อนเดียวจับได้ครั้งเดียว");

  const usedReceipts = result.groups.flatMap((group) => group.receipts.map((row) => row.id));
  const usedLines = result.groups.flatMap((group) => group.lines.map((row) => row.id));
  assert.equal(new Set(usedReceipts).size, usedReceipts.length);
  assert.equal(new Set(usedLines).size, usedLines.length);

  // ใบที่เหลือต้องไปอยู่ในคิวงาน ไม่ใช่หายไปเฉย ๆ
  const leftover = usedReceipts.includes("RCP-1") ? "RCP-2" : "RCP-1";
  assert.ok(result.exceptions.some((item) => item.receiptId === leftover));
});

test("กลุ่มค่าประกันไม่แก้ยอดของเอกสารต้นทางแม้แต่แถวเดียว", () => {
  const dataset = {
    bookings: [booking("R1", "2026-07-10")],
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10")],
    statements: [statement([credit("L1", "2026-07-10", 800000)])],
  };
  const before = JSON.stringify(dataset);
  const result = run(dataset);

  assert.equal(JSON.stringify(dataset), before, "เอกสารต้นทางต้องไม่ถูกแตะ");

  const [group] = result.groups;
  assert.equal(group.receipts[0].amountSatang, 500000, "ยอดในรายงานรับเงินต้องไม่ถูกบวกค่าประกัน");
  assert.equal(group.receipts[0].allocatedSatang, 500000);
  assert.equal(group.lines[0].amountSatang, 800000, "ยอดใน statement ต้องไม่ถูกแก้");
  assert.equal(group.receiptSatang, 500000, "ค่าประกันไม่ถูกนับเป็นรายได้ค่าห้อง");
});

test("การเปลี่ยนค่าประกันไม่แตะข้อมูลต้นทาง และกระทบยอดใหม่ทั้งชุด", () => {
  const dataset = {
    meta: {
      generatedAt: "", period: "2026-07", periods: ["2026-07"], rulesetVersion: "x",
      sources: [{ kind: "collection_report", name: "c.xlsx", rows: 1 }],
    },
    bookings: [booking("R1", "2026-07-10")],
    receipts: [receipt("RCP-1", "R1", "2026-07-10", 500000, "2026-07-10")],
    statements: [statement([credit("L1", "2026-07-10", 1000000)])],
    reconciliation: {
      rulesetVersion: "x", accounts: [], groups: [], exceptions: [],
      outOfScope: [], staleDecisions: [], summary: {},
    },
  };
  const before = JSON.stringify(dataset);

  const at3000 = applySettings(dataset, DEFAULT_SETTINGS, []);
  assert.equal(at3000.dataset.reconciliation.groups.length, 0, "ส่วนต่าง 5,000 ไม่ใช่ค่าประกัน 3,000");

  const at5000 = applySettings(dataset, {
    ...DEFAULT_SETTINGS,
    matching: { ...DEFAULT_SETTINGS.matching, securityDepositSatang: 500000 },
  }, []);
  const [group] = at5000.dataset.reconciliation.groups;
  assert.ok(group, "ตั้งค่าประกันเป็น 5,000 แล้วต้องจับได้ทันทีโดยไม่ต้องแก้โค้ด");
  assert.equal(group.depositSatang, 500000);
  assert.equal(group.deltaSatang, 0);

  assert.equal(JSON.stringify(dataset), before, "การเปลี่ยนการตั้งค่าต้องไม่แก้ข้อมูลต้นฉบับ");
});
