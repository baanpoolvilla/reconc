import assert from "node:assert/strict";
import test from "node:test";

import { assembleDataset } from "../lib/dataset-builder.mjs";
import { DEFAULT_SETTINGS, applySettings } from "../lib/settings-core.mjs";
import {
  DEFAULT_SETTLEMENT,
  looksLikeSettlement,
  normalizeSettlement,
  providerFor,
  proposeSettlements,
} from "../lib/settlements.mjs";

// รอบโอนของ OTA แต่ละเจ้า
//
// สามอย่างที่ไฟล์นี้คุมไว้ และเป็นสามอย่างที่ระบบรุ่นก่อนทำผิด:
//
//   1. ก้อนของเจ้าหนึ่งดูดคำจองของอีกเจ้าเข้ามาไม่ได้
//   2. ก้อนโอนต้องเข้าบัญชีหลังวันตั้งต้นของคำจองเสมอ — Trip.com กับ Booking.com
//      นับจากวันเช็คเอาท์ ส่วน Airbnb นับจากวันเช็คอิน
//   3. ชุดที่ยอดตรงพอดีต้องชนะการเดาว่าส่วนต่างคือค่าคอมเสมอ และก้อนที่หาชุด
//      ตรงพอดีไม่ได้ ต้องไม่คว้าใบที่ก้อนอื่นตรงพอดีไปใช้
//
// ข้อสามคือหัวใจ: รายงานการรับเงินบันทึกยอดสุทธิที่ OTA จะโอนจริงไว้แล้ว ก้อนส่วน
// ใหญ่จึงตรงพอดีถึงสตางค์ การเรียกทุกก้อนว่า "หักคอมแล้ว" ทำให้ก้อนที่ต่างกันจริง
// กลืนหายไปกับก้อนที่ปกติ

const settlement = normalizeSettlement(DEFAULT_SETTLEMENT);

const booking = (reservationNo, createdDate) => ({
  reservationNo,
  channelReservationNo: "",
  createdAt: `${createdDate}T10:00:00`,
  createdDate,
  completedAt: "",
  creator: "test",
  guest: `ผู้จอง ${reservationNo}`,
  mobile: "",
  channel: "OTA",
  status: "Confirmed",
  roomType: "Villa",
  roomNumber: "1",
  nights: 1,
  totalSatang: 0,
  payments: [],
  paidSatang: 0,
  arSatang: 0,
  balanceDueSatang: 0,
});

const receipt = (id, { date, satang, method, checkIn, checkOut }) => ({
  id,
  sourceRow: 1,
  date,
  kind: "RECEIVE",
  method,
  amountSatang: satang,
  reservationNo: id.replace("RCP-", "7000000"),
  channelReservationNo: "",
  channel: "OTA",
  guest: `ผู้จอง ${id}`,
  group: "Baanpool",
  roomType: "Villa",
  roomNumber: "1",
  checkIn,
  checkOut,
  note: "",
});

const OTA_DETAIL = {
  TRIP: "จาก SMART SCBT X9633 MCP Operating a",
  BOOKING: "จาก SMART SCBT X4311 (NRBA)(1)BOOKING.C",
  AIRBNB: "Trade Ref no. IR26073000031148",
};

const credit = (id, date, satang, providerId) => ({
  id,
  date,
  time: "02:26",
  description: providerId === "AIRBNB" ? "รับเงินธุรกรรม ตปท." : "รับโอนเงินอัตโนมัติ",
  channel: providerId === "AIRBNB" ? "ธุรกรรมต่างประเทศ" : "โอนเข้า/หักบัญชีอัตโนมัติ",
  detail: OTA_DETAIL[providerId],
  direction: "credit",
  amountSatang: satang,
  balanceSatang: satang,
  page: 1,
  row: 1,
});

function build(receipts, lines) {
  const statement = {
    code: "987",
    period: "2026-07",
    method: "KbankGL987",
    source: "987.pdf",
    accountNo: "025-3-66398-7",
    accountName: "บริษัททดสอบ จำกัด",
    branch: "สาขาทดสอบ",
    reference: "REF",
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
  };
  const dataset = assembleDataset({
    bookings: receipts.map((row) => booking(row.reservationNo, row.date)),
    receipts,
    statements: [statement],
    sources: [{ kind: "collection_report", label: "รายงานการรับเงิน", name: "c.xlsx", rows: receipts.length, period: "2026-07" }],
  });
  return applySettings(dataset, DEFAULT_SETTINGS, []).settlements;
}

const proposalFor = (proposals, lineId) => proposals.find((item) => item.lineId === lineId);

// ── ก้อนนี้เป็นของเจ้าไหน ────────────────────────────────────────────────────

test("อ่านจาก statement ได้ว่าก้อนโอนเป็นของ OTA เจ้าไหน", () => {
  const of = (line) => providerFor(line, settlement)?.id ?? "";

  assert.equal(of({ channel: "โอนเข้า/หักบัญชีอัตโนมัติ", description: "", detail: OTA_DETAIL.TRIP }), "TRIP");
  assert.equal(of({ channel: "โอนเข้า/หักบัญชีอัตโนมัติ", description: "", detail: OTA_DETAIL.BOOKING }), "BOOKING");
  assert.equal(of({ channel: "ธุรกรรมต่างประเทศ", description: "รับเงินธุรกรรม ตปท.", detail: OTA_DETAIL.AIRBNB }), "AIRBNB");
  // เงินโอนของลูกค้าทั่วไปต้องไม่ถูกอ่านเป็นก้อนโอนของใคร
  assert.equal(of({ channel: "Internet/Mobile GSB", description: "รับโอนเงิน", detail: "จาก GSB X5438" }), "");
});

test("ชื่อ Booking.com อยู่ในท่อนที่ statement ห่อลงบรรทัดใหม่ ตัวอ่านจึงต้องต่อกลับมา", () => {
  // K BIZ ห่อคอลัมน์รายละเอียดลงบรรทัดใหม่ ท่อนแรกคือ "...(NRBA)(1)" ซึ่งไม่มีคำ
  // ว่า Booking อยู่เลย ชื่อเจ้าของก้อนอยู่ในท่อนที่สองล้วน ๆ
  const truncated = { channel: "โอนเข้า/หักบัญชีอัตโนมัติ", description: "", detail: "จาก SMART SCBT X4311 (NRBA)(1)" };
  const full = { ...truncated, detail: OTA_DETAIL.BOOKING };

  assert.equal(providerFor(full, settlement)?.id, "BOOKING", "ต่อท่อนกลับมาแล้วต้องรู้ว่าเป็นของ Booking.com");

  // ทิ้งท่อนที่ห่อลงมา = ก้อนนี้กลายเป็นก้อนไม่ระบุเจ้า ซึ่งยังถูกเสนอ แต่มองเห็น
  // คำจองของทุกเจ้าและไม่มีรอบโอนให้อ้าง — เสียความแม่นไปทั้งก้อน นี่คือเหตุผล
  // ที่ตัวอ่าน statement ต้องต่อบรรทัดที่ห่อลงมากลับเข้าไป
  assert.equal(providerFor(truncated, settlement), null);
  assert.equal(looksLikeSettlement(truncated, settlement), true, "อย่างน้อยต้องยังรู้ว่าเป็นก้อนโอนของ OTA");
});

test("ก้อนของเจ้าหนึ่งมองไม่เห็นคำจองของอีกเจ้า", () => {
  const proposals = build(
    [
      receipt("RCP-1", { date: "2026-07-05", satang: 500000, method: "BOOKINGCOM COLLECT", checkIn: "2026-07-08", checkOut: "2026-07-10" }),
      receipt("RCP-2", { date: "2026-07-05", satang: 500000, method: "AIRBNB COLLECT", checkIn: "2026-07-19", checkOut: "2026-07-21" }),
    ],
    [credit("L-BOOKING", "2026-07-20", 500000, "BOOKING")],
  );

  const proposal = proposalFor(proposals, "L-BOOKING");
  assert.equal(proposal.providerId, "BOOKING");
  assert.deepEqual(proposal.candidates.map((row) => row.id), ["RCP-1"], "คำจอง Airbnb ต้องไม่อยู่ในกองให้เลือกเลย");
  assert.deepEqual(proposal.selectedIds, ["RCP-1"]);
  assert.equal(proposal.status, "EXACT");
});

// ── วันตั้งต้นของแต่ละเจ้า ──────────────────────────────────────────────────

test("Trip.com และ Booking.com นับรอบโอนจากวันเช็คเอาท์ ส่วน Airbnb นับจากวันเช็คอิน", () => {
  const stay = { checkIn: "2026-07-10", checkOut: "2026-07-14" };

  const trip = build(
    [receipt("RCP-1", { date: "2026-07-01", satang: 500000, method: "TRIPCOM COLLECT", ...stay })],
    [credit("L-TRIP", "2026-07-22", 500000, "TRIP")],
  );
  const tripRow = proposalFor(trip, "L-TRIP").candidates[0];
  assert.equal(tripRow.anchorDate, "2026-07-14", "Trip.com ต้องนับจากวันเช็คเอาท์");
  assert.equal(tripRow.lagDays, 8);
  assert.equal(tripRow.inPayoutWindow, true, "8 วันหลังเช็คเอาท์คือรอบปกติของ Trip.com");

  const airbnb = build(
    [receipt("RCP-1", { date: "2026-07-01", satang: 500000, method: "AIRBNB COLLECT", ...stay })],
    [credit("L-AIRBNB", "2026-07-11", 500000, "AIRBNB")],
  );
  const airbnbRow = proposalFor(airbnb, "L-AIRBNB").candidates[0];
  assert.equal(airbnbRow.anchorDate, "2026-07-10", "Airbnb ต้องนับจากวันเช็คอิน");
  assert.equal(airbnbRow.lagDays, 1);
  assert.equal(airbnbRow.inPayoutWindow, true, "วันรุ่งขึ้นของวันเช็คอินคือรอบปกติของ Airbnb");
});

test("ก้อนโอนคว้าคำจองที่ยังไม่ถึงวันตั้งต้นไม่ได้ ต่อให้ยอดตรงพอดี", () => {
  // อาการจริงของรุ่นก่อน: ขอบเขตวัดจากวันที่บันทึกรับเงินอย่างเดียว ก้อนต้นเดือน
  // จึงประกอบชุดที่ "ยอดตรงพอดี" จากคำจองที่แขกยังไม่ได้เข้าพักด้วยซ้ำ
  const proposals = build(
    [receipt("RCP-FUTURE", { date: "2026-07-02", satang: 500000, method: "TRIPCOM COLLECT", checkIn: "2026-07-25", checkOut: "2026-07-27" })],
    [credit("L-TRIP", "2026-07-05", 500000, "TRIP")],
  );

  const proposal = proposalFor(proposals, "L-TRIP");
  assert.equal(proposal.candidates.length, 0, "คำจองที่เช็คเอาท์หลังวันเงินเข้า ต้องไม่อยู่ในกอง");
  assert.equal(proposal.status, "EMPTY");
});

test("ใบที่อยู่นอกรอบโอนปกติยังเสนอได้ แต่ต้องถูกติดป้ายไว้", () => {
  // รอบโอนเป็นธรรมเนียม ไม่ใช่ข้อเท็จจริง การตัดทิ้งเงียบ ๆ ด้วยธรรมเนียมคือการ
  // ซ่อนคำตอบที่อาจจะถูก — ติดป้ายแล้วให้คนตัดสินดีกว่า
  const proposals = build(
    [receipt("RCP-LATE", { date: "2026-07-01", satang: 500000, method: "BOOKINGCOM COLLECT", checkIn: "2026-07-01", checkOut: "2026-07-02" })],
    [credit("L-BOOKING", "2026-07-30", 500000, "BOOKING")],
  );

  const proposal = proposalFor(proposals, "L-BOOKING");
  const row = proposal.candidates[0];
  assert.equal(row.lagDays, 28);
  assert.equal(row.inPayoutWindow, false, "28 วันหลังเช็คเอาท์อยู่นอกรอบปกติ");
  assert.deepEqual(proposal.selectedIds, ["RCP-LATE"], "ยังต้องถูกเสนอ");
  assert.equal(proposal.outOfWindowCount, 1, "และต้องบอกว่ามีใบที่อยู่นอกรอบ");
});

// ── ยอดตรงพอดีมาก่อนการเดาว่าเป็นค่าคอม ──────────────────────────────────────

test("ชุดที่ยอดตรงพอดีชนะชุดที่ต้องอ้างค่าคอม", () => {
  // ทั้งสองชุดเป็นไปได้ตามวัน: 3,000+2,000 ตรงพอดี ส่วน 6,000 ใบเดียวต้องอ้างว่า
  // ส่วนต่าง 1,000 คือค่าคอม ตัวเลขที่ลงตัวพอดีคือหลักฐาน ส่วนอีกอันคือการเดา
  const proposals = build(
    [
      receipt("RCP-A", { date: "2026-07-01", satang: 300000, method: "TRIPCOM COLLECT", checkIn: "2026-07-09", checkOut: "2026-07-10" }),
      receipt("RCP-B", { date: "2026-07-02", satang: 200000, method: "TRIPCOM COLLECT", checkIn: "2026-07-10", checkOut: "2026-07-11" }),
      receipt("RCP-C", { date: "2026-07-03", satang: 600000, method: "TRIPCOM COLLECT", checkIn: "2026-07-11", checkOut: "2026-07-12" }),
    ],
    [credit("L-TRIP", "2026-07-19", 500000, "TRIP")],
  );

  const proposal = proposalFor(proposals, "L-TRIP");
  assert.deepEqual([...proposal.selectedIds].sort(), ["RCP-A", "RCP-B"]);
  assert.equal(proposal.matchKind, "EXACT");
  assert.equal(proposal.status, "EXACT");
  assert.equal(proposal.feeSatang, 0);
  assert.equal(proposal.exactCount, 1);
  assert.equal(proposal.ambiguous, false);
});

test("ชุดที่ยอดตรงพอดีมีหลายชุด ระบบต้องบอกว่าตัดสินให้ไม่ได้", () => {
  const proposals = build(
    [
      receipt("RCP-A", { date: "2026-07-01", satang: 500000, method: "TRIPCOM COLLECT", checkIn: "2026-07-09", checkOut: "2026-07-10" }),
      receipt("RCP-B", { date: "2026-07-02", satang: 500000, method: "TRIPCOM COLLECT", checkIn: "2026-07-10", checkOut: "2026-07-11" }),
    ],
    [credit("L-TRIP", "2026-07-19", 500000, "TRIP")],
  );

  const proposal = proposalFor(proposals, "L-TRIP");
  assert.equal(proposal.matchKind, "EXACT");
  assert.equal(proposal.exactCount, 2);
  assert.equal(proposal.ambiguous, true, "ยอดเท่ากันสองใบ ตัวเลขเลือกให้ไม่ได้");
  assert.equal(proposal.selectedIds.length, 1);
});

test("ต่างกันระดับสตางค์ถูกเรียกว่าปัดเศษ ไม่ใช่ค่าคอม", () => {
  const proposals = build(
    [receipt("RCP-A", { date: "2026-07-01", satang: 852316, method: "BOOKINGCOM COLLECT", checkIn: "2026-07-09", checkOut: "2026-07-10" })],
    [credit("L-BOOKING", "2026-07-19", 852315, "BOOKING")],
  );

  const proposal = proposalFor(proposals, "L-BOOKING");
  assert.equal(proposal.feeSatang, 1);
  assert.equal(proposal.matchKind, "ROUNDING");
  assert.equal(proposal.status, "READY");
});

test("ส่วนต่างที่ใหญ่จริงยังถูกเสนอเป็นค่าคอมเหมือนเดิม", () => {
  const proposals = build(
    [receipt("RCP-A", { date: "2026-07-01", satang: 1000000, method: "TRIPCOM COLLECT", checkIn: "2026-07-09", checkOut: "2026-07-10" })],
    [credit("L-TRIP", "2026-07-19", 900000, "TRIP")],
  );

  const proposal = proposalFor(proposals, "L-TRIP");
  assert.equal(proposal.matchKind, "FEE");
  assert.equal(proposal.status, "READY");
  assert.equal(proposal.feeSatang, 100000);
  assert.equal(proposal.feeRate, 10);
});

test("รวมคำจองที่หาได้ทั้งหมดแล้วยังไม่ถึงยอด ต้องบอกว่ายังขาด ไม่ใช่เงียบ", () => {
  const proposals = build(
    [receipt("RCP-A", { date: "2026-07-01", satang: 300000, method: "TRIPCOM COLLECT", checkIn: "2026-07-09", checkOut: "2026-07-10" })],
    [credit("L-TRIP", "2026-07-19", 900000, "TRIP")],
  );

  const proposal = proposalFor(proposals, "L-TRIP");
  assert.equal(proposal.status, "SHORT");
  assert.equal(proposal.matchKind, "SHORT");
  assert.equal(proposal.feeSatang, -600000);
});

// ── ลำดับการจองสิทธิ์ ────────────────────────────────────────────────────────

test("ก้อนที่ยอดตรงพอดีได้จองใบของตัวเองก่อนก้อนที่ต้องเดา", () => {
  // ก้อนวันที่ 12 หาชุดตรงพอดีไม่ได้ (คำจองของมันอยู่ในเดือนที่ยังไม่ได้อัปโหลด)
  // ถ้าไล่ตามวันอย่างเดียว มันจะคว้า RCP-EXACT ไปเป็นชุด "ท่วมก้อนน้อยที่สุด"
  // แล้วก้อนวันที่ 20 ที่ตรงพอดีกับใบนั้นเป๊ะ ก็พังตามไปด้วยทั้งคู่
  const proposals = build(
    [
      receipt("RCP-EXACT", { date: "2026-07-02", satang: 1260082, method: "BOOKINGCOM COLLECT", checkIn: "2026-07-10", checkOut: "2026-07-11" }),
      receipt("RCP-OTHER", { date: "2026-07-01", satang: 1882223, method: "BOOKINGCOM COLLECT", checkIn: "2026-07-04", checkOut: "2026-07-05" }),
    ],
    [
      credit("L-EARLY", "2026-07-12", 3004709, "BOOKING"),
      credit("L-LATE", "2026-07-21", 1260082, "BOOKING"),
    ],
  );

  const late = proposalFor(proposals, "L-LATE");
  assert.deepEqual(late.selectedIds, ["RCP-EXACT"], "ก้อนที่ตรงพอดีต้องได้ใบของตัวเอง");
  assert.equal(late.status, "EXACT");

  const early = proposalFor(proposals, "L-EARLY");
  assert.ok(!early.selectedIds.includes("RCP-EXACT"), "ก้อนที่ต้องเดาต้องไม่คว้าใบที่ก้อนอื่นตรงพอดี");
  assert.equal(early.status, "SHORT");
});

test("รายการรับเงินหนึ่งใบยังถูกเสนอให้ก้อนเดียวเท่านั้น", () => {
  const proposals = build(
    [
      receipt("RCP-A", { date: "2026-07-01", satang: 500000, method: "TRIPCOM COLLECT", checkIn: "2026-07-08", checkOut: "2026-07-09" }),
      receipt("RCP-B", { date: "2026-07-02", satang: 500000, method: "TRIPCOM COLLECT", checkIn: "2026-07-09", checkOut: "2026-07-10" }),
    ],
    [
      credit("L-1", "2026-07-17", 500000, "TRIP"),
      credit("L-2", "2026-07-18", 500000, "TRIP"),
    ],
  );

  const seen = new Set();
  for (const proposal of proposals) {
    for (const id of proposal.selectedIds) {
      assert.ok(!seen.has(id), `${id} ถูกเสนอซ้ำสองก้อน`);
      seen.add(id);
    }
  }
  assert.equal(seen.size, 2, "ทั้งสองก้อนต้องได้ใบคนละใบ");
});

// ── การตั้งค่า ───────────────────────────────────────────────────────────────

test("การตั้งค่าที่บันทึกไว้ก่อนมีรอบโอนรายเจ้า ได้ค่าตั้งต้นไป ไม่ใช่รายการว่าง", () => {
  const old = normalizeSettlement({ enabled: true, windowDays: 45, maxFeeRate: 30, patterns: ["SMART SCBT"], otaMethods: ["TRIPCOM COLLECT"] });

  assert.equal(old.providers.length, 3, "ของเดิมต้องไม่กลายเป็นไม่รู้จัก OTA เจ้าไหนเลย");
  assert.deepEqual(old.providers.map((item) => item.id).sort(), ["AIRBNB", "BOOKING", "TRIP"]);
  assert.equal(old.roundingSatang, DEFAULT_SETTLEMENT.roundingSatang);
});

test("ค่ารอบโอนที่ใช้ไม่ได้ถูกซ่อม ไม่ปล่อยให้พัง", () => {
  const fixed = normalizeSettlement({
    providers: [{ id: "trip", patterns: ["MCP"], methods: ["TRIPCOM COLLECT"], anchor: "ไม่มีจริง", minLagDays: 10, maxLagDays: 2, typicalLagDays: [99, -5] }],
  });

  const [provider] = fixed.providers;
  assert.equal(provider.id, "TRIP");
  assert.equal(provider.anchor, "checkOut", "วันตั้งต้นที่ไม่มีจริงถอยไปใช้ค่าตั้งต้น");
  assert.ok(provider.maxLagDays >= provider.minLagDays, "ช่วงวันต้องไม่กลับหัว");
  assert.ok(provider.typicalLagDays[0] <= provider.typicalLagDays[1]);
  assert.ok(provider.typicalLagDays[0] >= provider.minLagDays);
  assert.ok(provider.typicalLagDays[1] <= provider.maxLagDays);
});

test("เจ้าที่ไม่มีข้อความให้จับหรือไม่มีช่องทางรับเงิน ถูกทิ้ง ไม่ใช่เก็บไว้แบบใช้ไม่ได้", () => {
  const fixed = normalizeSettlement({
    providers: [
      { id: "GHOST", patterns: [], methods: ["X COLLECT"] },
      { id: "NOMETHOD", patterns: ["X"], methods: [] },
      { id: "TRIP", patterns: ["MCP Operating"], methods: ["TRIPCOM COLLECT"] },
    ],
  });
  assert.deepEqual(fixed.providers.map((item) => item.id), ["TRIP"]);
});

test("ปิดการแตกยอดแล้วไม่มีข้อเสนอเลย แม้ก้อนจะเข้าข่ายทุกอย่าง", () => {
  const dataset = assembleDataset({
    bookings: [],
    receipts: [receipt("RCP-A", { date: "2026-07-01", satang: 500000, method: "TRIPCOM COLLECT", checkIn: "2026-07-09", checkOut: "2026-07-10" })],
    statements: [],
    sources: [],
  });
  assert.deepEqual(
    proposeSettlements(dataset, dataset.reconciliation, { ...settlement, enabled: false }),
    [],
  );
});
