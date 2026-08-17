import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../lib/db/client.mjs";
import {
  listPeriods,
  loadDocumentFile,
  recordDocument,
  replaceBookings,
  replaceReceipts,
  replaceStatement,
  runReconciliation,
  saveDecision,
  saveDocumentFile,
  storedDocuments,
} from "../lib/db/repository.mjs";
import { periodOf, periodRange, periodsOf, shiftPeriod, statementPeriod } from "../lib/periods.mjs";
import { ALL_PERIODS, applySettings, DEFAULT_SETTINGS, scopeToPeriod } from "../lib/settings-core.mjs";

// หลายงวดในฐานข้อมูลเดียว
//
// สองอย่างที่ไฟล์นี้คุมไว้ และเป็นสองอย่างที่ระบบรุ่นก่อนทำไม่ได้:
//   1. อัปโหลดเดือนใหม่แล้วเดือนเก่าต้องยังอยู่ครบ
//   2. เงินที่รับไว้เดือนหนึ่งแล้วเข้าบัญชีอีกเดือนหนึ่ง ต้องกระทบยอดกันได้

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

const receipt = (id, reservationNo, date, amountSatang, method) => ({
  id,
  sourceRow: 1,
  date,
  kind: "RECEIVE",
  method,
  amountSatang,
  reservationNo,
  channelReservationNo: "",
  channel: "Direct",
  guest: `ผู้จอง ${reservationNo}`,
  group: "Baanpool",
  roomType: "Villa",
  roomNumber: "1",
  checkIn: date,
  checkOut: date,
  note: "",
});

// applySettings เสนอก้อนโอนก็ต่อเมื่อชุดข้อมูลมีเอกสารต้นทางอยู่จริง
const noteDocument = (db, kind, period) => recordDocument(db, {
  id: `DOC-${kind}-${period}`, kind, periods: [period], name: `${kind}-${period}`,
  sha256: "a".repeat(64), sizeBytes: 1, rowCount: 1, uploadedBy: "test",
});

const line = (id, date, amountSatang, extra = {}) => ({
  id,
  date,
  time: "09:00",
  description: "รับโอนเงิน",
  channel: "",
  detail: "",
  direction: "credit",
  amountSatang,
  balanceSatang: amountSatang,
  page: 1,
  row: 1,
  ...extra,
});

const statement = (code, period, lines, method = "KbankGL987") => {
  const [year, month] = period.split("-");
  const credits = lines.filter((item) => item.direction === "credit");
  return {
    code,
    method,
    source: `${code}-${period}.pdf`,
    accountNo: `xxx-x-x${code}-x`,
    accountName: "บ้านพูลวิลล่า",
    branch: "บางแสน",
    reference: "",
    cycle: `01/${month}/${year} - 28/${month}/${year}`,
    suffix: code,
    openingSatang: 0,
    closingSatang: credits.reduce((sum, item) => sum + item.amountSatang, 0),
    creditSatang: credits.reduce((sum, item) => sum + item.amountSatang, 0),
    debitSatang: 0,
    creditCount: credits.length,
    debitCount: 0,
    controlDeltaSatang: 0,
    lines,
  };
};

// ── ตัวช่วยเรื่องงวด ─────────────────────────────────────────────────────────

test("งวดอ่านจากข้อความ ISO ตรง ๆ ไม่ผ่าน Date object ที่ timezone เลื่อนวันได้", () => {
  assert.equal(periodOf("2026-07-31"), "2026-07");
  assert.equal(periodOf("2026-07-31T23:30:00"), "2026-07");
  assert.equal(periodOf(""), "");
  assert.equal(periodOf("ไม่ใช่วันที่"), "");
  assert.deepEqual(periodsOf(["2026-08-01", "2026-07-05", "", "2026-07-20"]), ["2026-07", "2026-08"]);
});

test("เลื่อนงวดข้ามปีได้ถูกต้อง", () => {
  assert.equal(shiftPeriod("2026-01", -1), "2025-12");
  assert.equal(shiftPeriod("2026-12", 1), "2027-01");
  assert.deepEqual(periodRange("2026-11", "2027-01"), ["2026-11", "2026-12", "2027-01"]);
});

test("งวดของ statement มาจากรอบที่พิมพ์บนเอกสาร ไม่ใช่วันที่อัปโหลด", () => {
  assert.equal(statementPeriod({ cycle: "01/07/2026 - 31/07/2026", lines: [] }), "2026-07");
  // ไม่มีรอบพิมพ์ไว้ ค่อยถอยไปดูวันที่ของบรรทัดแรก
  assert.equal(statementPeriod({ cycle: "", lines: [line("L1", "2026-09-02", 100)] }), "2026-09");
});

// ── การสะสมข้อมูลหลายเดือน ──────────────────────────────────────────────────

test("อัปโหลดเดือนใหม่ไม่ลบเดือนเก่า และอัปโหลดเดือนเดิมซ้ำทับเฉพาะเดือนนั้น", async () => {
  const db = await freshDb();

  await replaceBookings(db, [booking("R1", "2026-07-10", 100000)]);
  await replaceReceipts(db, [receipt("RCP-JUL", "R1", "2026-07-10", 100000, "KbankGL987")]);
  await replaceStatement(db, statement("987", "2026-07", [line("L-JUL", "2026-07-10", 100000)]));

  await replaceBookings(db, [booking("R2", "2026-08-12", 200000)]);
  await replaceReceipts(db, [receipt("RCP-AUG", "R2", "2026-08-12", 200000, "KbankGL987")]);
  await replaceStatement(db, statement("987", "2026-08", [line("L-AUG", "2026-08-12", 200000)]));

  const periods = await listPeriods(db);
  assert.deepEqual(periods.map((item) => item.period), ["2026-08", "2026-07"], "ต้องเห็นทั้งสองงวด");
  assert.equal(periods.find((item) => item.period === "2026-07").receipts, 1, "กรกฎาคมต้องไม่หายไป");

  // อัปโหลดกรกฎาคมซ้ำ คราวนี้มีสองรายการ — สิงหาคมต้องไม่ถูกแตะ
  await replaceReceipts(db, [
    receipt("RCP-JUL", "R1", "2026-07-10", 100000, "KbankGL987"),
    receipt("RCP-JUL-2", "R1", "2026-07-11", 300000, "KbankGL987"),
  ]);

  const after = await listPeriods(db);
  assert.equal(after.find((item) => item.period === "2026-07").receipts, 2);
  assert.equal(after.find((item) => item.period === "2026-08").receipts, 1, "อัปโหลดกรกฎาคมต้องไม่แตะสิงหาคม");

  const { dataset } = await runReconciliation(db);
  assert.deepEqual(dataset.meta.periods, ["2026-07", "2026-08"]);
  assert.equal(dataset.meta.period, "2026-08", "งวดตั้งต้นบนหน้าจอคืองวดล่าสุด");
  assert.equal(dataset.statements.length, 2, "บัญชีเดียวกันมี statement ได้เดือนละฉบับ");
});

test("statement คนละงวดของบัญชีเดียวกันไม่รายงานข้อยกเว้นซ้ำกันเอง", async () => {
  const db = await freshDb();

  // รายการที่จับคู่ไม่ได้ในเดือนกรกฎาคม: ยอดไม่ตรงกับเงินเข้าวันเดียวกัน
  await replaceBookings(db, [booking("R1", "2026-07-10", 100000), booking("R2", "2026-08-12", 200000)]);
  await replaceReceipts(db, [
    receipt("RCP-JUL", "R1", "2026-07-10", 100000, "KbankGL987"),
    receipt("RCP-AUG", "R2", "2026-08-12", 200000, "KbankGL987"),
  ]);
  await replaceStatement(db, statement("987", "2026-07", [line("L-JUL", "2026-07-10", 999999)]));
  await replaceStatement(db, statement("987", "2026-08", [line("L-AUG", "2026-08-12", 200000)]));

  const { dataset } = await runReconciliation(db);
  const { exceptions, accounts, summary } = dataset.reconciliation;

  // รายการของกรกฎาคมต้องขึ้นเป็นข้อยกเว้นครั้งเดียว ไม่ใช่ครั้งหนึ่งต่อ statement
  assert.equal(exceptions.filter((item) => item.receiptId === "RCP-JUL").length, 1);
  assert.equal(exceptions.filter((item) => item.receiptId === "RCP-AUG").length, 0, "สิงหาคมจับคู่ได้");
  assert.equal(summary.inScopeReceipts, 2, "รายการหนึ่งใบนับเข้าบัญชีเดียวเท่านั้น");

  const july = accounts.find((item) => item.period === "2026-07");
  const august = accounts.find((item) => item.period === "2026-08");
  assert.equal(july.receiptCount, 1);
  assert.equal(august.receiptCount, 1);
  assert.equal(august.matchedReceipts, 1);
});

test("รายงานการรับเงินที่มาก่อน statement ของงวดนั้น ไม่กลายเป็นข้อยกเว้นลวง", async () => {
  const db = await freshDb();

  await replaceBookings(db, [booking("R1", "2026-07-10", 100000), booking("R2", "2026-08-12", 200000)]);
  await replaceReceipts(db, [
    receipt("RCP-JUL", "R1", "2026-07-10", 100000, "KbankGL987"),
    receipt("RCP-AUG", "R2", "2026-08-12", 200000, "KbankGL987"),
  ]);
  // อัปโหลดเฉพาะ statement ของกรกฎาคม ยังไม่มีของสิงหาคม
  await replaceStatement(db, statement("987", "2026-07", [line("L-JUL", "2026-07-10", 100000)]));

  const { dataset } = await runReconciliation(db);
  const { exceptions, outOfScope, summary } = dataset.reconciliation;

  assert.equal(exceptions.length, 0, "ไม่มีข้อยกเว้น เพราะยังไม่มีอะไรให้กระทบ");
  const gap = outOfScope.find((item) => item.period === "2026-08");
  assert.ok(gap, "ต้องรายงานว่างวดสิงหาคมยังไม่มี Statement");
  assert.equal(gap.reason, "MISSING_STATEMENT");
  assert.equal(gap.count, 1);
  assert.equal(summary.missingStatements, 1);
});

// ── การกระทบยอดที่เหลื่อมเดือน ──────────────────────────────────────────────

test("เงินที่ OTA โอนเดือนถัดไป จับกับคำจองของเดือนก่อนได้", async () => {
  const db = await freshDb();

  // รับเงินผ่าน Trip.com ในเดือนกรกฎาคม
  await replaceBookings(db, [booking("R1", "2026-07-20", 1000000), booking("R2", "2026-07-25", 500000)]);
  await replaceReceipts(db, [
    receipt("RCP-1", "R1", "2026-07-20", 1000000, "TRIPCOM COLLECT"),
    receipt("RCP-2", "R2", "2026-07-25", 500000, "TRIPCOM COLLECT"),
  ]);
  await replaceStatement(db, statement("987", "2026-07", [line("L-JUL", "2026-07-02", 50000)]));

  // ก้อนโอนเข้าบัญชีจริงวันที่ 5 สิงหาคม หลังหักคอม 10%
  await replaceStatement(db, statement("987", "2026-08", [
    line("L-OTA", "2026-08-05", 1350000, { channel: "ธุรกรรมต่างประเทศ", detail: "จาก SMART SCBT MCP Operating" }),
  ]));
  await noteDocument(db, "collection", "2026-07");
  await noteDocument(db, "statement987", "2026-08");

  const { dataset } = await runReconciliation(db);
  const effective = applySettings(dataset, DEFAULT_SETTINGS, []);

  const proposal = effective.settlements.find((item) => item.lineId === "L-OTA");
  assert.ok(proposal, "ก้อนโอนที่ข้ามเดือนต้องถูกเสนอ ไม่ใช่เงียบหาย");
  assert.deepEqual([...proposal.selectedIds].sort(), ["RCP-1", "RCP-2"]);
  assert.equal(proposal.crossPeriod, true, "ต้องติดธงว่าเหลื่อมเดือน");
  assert.equal(proposal.period, "2026-08", "งวดของก้อนคือเดือนที่เงินเข้าบัญชี");
  assert.deepEqual(proposal.sourcePeriods, ["2026-07"], "รายการในก้อนมาจากกรกฎาคม");
  assert.equal(proposal.grossSatang, 1500000);
  assert.equal(proposal.feeSatang, 150000);
  assert.equal(proposal.feeRate, 10);
  assert.equal(proposal.status, "READY");

  // ผู้ตรวจกดยืนยัน — จากนั้นมันต้องกลายเป็นกลุ่มที่กระทบยอดแล้ว
  await saveDecision(db, {
    kind: "SETTLEMENT",
    receiptIds: proposal.selectedIds,
    bankLineIds: [proposal.lineId],
    receiptSatang: proposal.grossSatang,
    bankSatang: proposal.netSatang,
    differenceSatang: proposal.feeSatang,
    reason: "COMMISSION",
    note: "คอม Trip.com 10%",
  });

  const { dataset: after } = await runReconciliation(db);
  const decisions = [{
    id: "DEC-TEST",
    kind: "SETTLEMENT",
    receiptIds: proposal.selectedIds,
    bankLineIds: [proposal.lineId],
    reason: "COMMISSION",
    note: "คอม Trip.com 10%",
    decidedBy: "test",
    decidedAt: "2026-08-06T09:00:00",
  }];
  const settled = applySettings(after, DEFAULT_SETTINGS, decisions);

  const group = settled.dataset.reconciliation.groups.find((item) => item.decision?.kind === "SETTLEMENT");
  assert.ok(group, "การยืนยันต้องกลายเป็นกลุ่มจริง");
  assert.equal(group.crossPeriod, true);
  assert.equal(group.period, "2026-08", "กลุ่มนับเข้างวดที่เงินเข้าบัญชี");
  assert.deepEqual(group.sourcePeriods, ["2026-07"]);
  assert.equal(group.deltaSatang, 150000, "ค่าคอมถูกรายงานเป็นผลต่างที่ยอมรับ ไม่ถูกกลบ");
  assert.equal(settled.dataset.reconciliation.summary.crossPeriodGroups, 1);
  assert.ok(!settled.settlements.some((item) => item.lineId === "L-OTA"), "ยืนยันแล้วต้องออกจากคิว");
});

test("กลุ่มที่เหลื่อมเดือนเห็นได้จากทั้งสองงวด และนับยอดในเดือนที่เงินเคลื่อนจริง", async () => {
  const db = await freshDb();

  await replaceBookings(db, [booking("R1", "2026-07-20", 1000000)]);
  await replaceReceipts(db, [receipt("RCP-1", "R1", "2026-07-20", 1000000, "TRIPCOM COLLECT")]);
  await replaceStatement(db, statement("987", "2026-07", [line("L-JUL", "2026-07-02", 50000)]));
  await replaceStatement(db, statement("987", "2026-08", [
    line("L-OTA", "2026-08-05", 900000, { channel: "ธุรกรรมต่างประเทศ" }),
  ]));
  await noteDocument(db, "collection", "2026-07");

  const { dataset } = await runReconciliation(db);
  const decisions = [{
    id: "DEC-X", kind: "SETTLEMENT", receiptIds: ["RCP-1"], bankLineIds: ["L-OTA"],
    reason: "COMMISSION", note: "", decidedBy: "test", decidedAt: "2026-08-06T09:00:00",
  }];
  const all = applySettings(dataset, DEFAULT_SETTINGS, decisions);

  const july = scopeToPeriod(all, "2026-07");
  const august = scopeToPeriod(all, "2026-08");

  // เปิดกรกฎาคมต้องรู้ว่ารายการใบนี้เคลียร์แล้ว ไม่ใช่หายไปเฉย ๆ
  assert.equal(july.dataset.reconciliation.groups.length, 1, "กรกฎาคมต้องเห็นกลุ่มที่เคลียร์รายการของตัวเอง");
  assert.equal(july.dataset.reconciliation.summary.matchedReceipts, 1);
  assert.equal(july.dataset.reconciliation.summary.matchedSatang, 0, "เงินไม่ได้เข้าบัญชีในกรกฎาคม");

  assert.equal(august.dataset.reconciliation.groups.length, 1, "สิงหาคมก็ต้องเห็นกลุ่มเดียวกัน");
  assert.equal(august.dataset.reconciliation.summary.matchedSatang, 900000, "ยอดนับในเดือนที่เงินเข้าจริง");
  assert.equal(august.dataset.reconciliation.summary.matchedReceipts, 0, "ไม่มีรายการของสิงหาคมอยู่ในกลุ่มนี้");

  // ยอดของสองงวดรวมกันต้องไม่นับเงินก้อนเดียวกันซ้ำ
  assert.equal(
    july.dataset.reconciliation.summary.matchedSatang + august.dataset.reconciliation.summary.matchedSatang,
    all.dataset.reconciliation.summary.matchedSatang,
  );

  assert.equal(july.dataset.receipts.length, 1, "รายการรับเงินอยู่ในงวดที่บันทึกไว้");
  assert.equal(august.dataset.receipts.length, 0);
  assert.equal(scopeToPeriod(all, ALL_PERIODS), all, "เลือกทุกงวดคือไม่กรองอะไรเลย");
});

test("ช่วงวันตั้งต้นกว้างพอจะคร่อมเดือน แต่ตัดของที่ห่างเกินไปออก", async () => {
  assert.ok(DEFAULT_SETTINGS.settlement.windowDays >= 31, "แคบกว่าหนึ่งเดือนคือจับข้ามเดือนไม่ได้เลย");

  const db = await freshDb();
  await replaceBookings(db, [booking("R1", "2026-01-05", 1000000)]);
  await replaceReceipts(db, [receipt("RCP-OLD", "R1", "2026-01-05", 1000000, "TRIPCOM COLLECT")]);
  await replaceStatement(db, statement("987", "2026-08", [
    line("L-OTA", "2026-08-05", 900000, { channel: "ธุรกรรมต่างประเทศ" }),
  ]));
  await noteDocument(db, "collection", "2026-01");
  await noteDocument(db, "statement987", "2026-08");

  const { dataset } = await runReconciliation(db);
  const effective = applySettings(dataset, DEFAULT_SETTINGS, []);
  const proposal = effective.settlements.find((item) => item.lineId === "L-OTA");

  assert.equal(proposal.selectedIds.length, 0, "คำจองเมื่อเจ็ดเดือนก่อนต้องไม่ถูกดูดเข้าก้อน");
  assert.equal(proposal.status, "EMPTY");
});

// ── ไฟล์ต้นฉบับ ─────────────────────────────────────────────────────────────

test("ไฟล์ต้นฉบับถูกเก็บไว้รายงวด และดาวน์โหลดกลับมาได้ไบต์ต่อไบต์", async () => {
  const db = await freshDb();
  const bytes = Buffer.from("%PDF-1.4 ตัวอย่าง statement", "utf8");

  for (const period of ["2026-07", "2026-08"]) {
    await recordDocument(db, {
      id: `DOC-${period}`,
      kind: "statement987",
      periods: [period],
      name: `987-${period}.pdf`,
      sha256: "f".repeat(64),
      sizeBytes: bytes.length,
      rowCount: 10,
      uploadedBy: "test",
    });
    await saveDocumentFile(db, `DOC-${period}`, {
      name: `987-${period}.pdf`,
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      contentBase64: bytes.toString("base64"),
    });
  }

  const documents = await storedDocuments(db);
  assert.equal(documents.length, 2, "เอกสารชนิดเดียวกันคนละงวดต้องอยู่ด้วยกันได้");
  assert.ok(documents.every((row) => row.has_file));

  const stored = await loadDocumentFile(db, "DOC-2026-08");
  assert.equal(stored.contentType, "application/pdf");
  assert.deepEqual(Buffer.from(stored.contentBase64, "base64"), bytes);

  // อัปโหลดงวดเดิมซ้ำแทนที่ทั้งแถวและไฟล์ ไม่สะสมซ้ำ
  await recordDocument(db, {
    id: "DOC-2026-08-v2",
    kind: "statement987",
    periods: ["2026-08"],
    name: "987-2026-08 (แก้ไข).pdf",
    sha256: "0".repeat(64),
    sizeBytes: 4,
    rowCount: 11,
    uploadedBy: "test",
  });

  const replaced = await storedDocuments(db);
  assert.equal(replaced.length, 2);
  assert.equal(replaced.find((row) => row.period === "2026-08").name, "987-2026-08 (แก้ไข).pdf");
  assert.equal(await loadDocumentFile(db, "DOC-2026-08"), null, "ไฟล์ของแถวที่ถูกแทนที่ต้องถูกลบตามไปด้วย");
});
