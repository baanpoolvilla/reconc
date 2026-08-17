import assert from "node:assert/strict";
import test from "node:test";

import { makeDataset } from "./fixtures.mjs";

import { DEFAULT_SETTINGS, applySettings } from "../lib/settings-core.mjs";
import { reconcile } from "../lib/reconciliation.mjs";
import { isOtaMethod, looksLikeSettlement, proposeSettlements } from "../lib/settlements.mjs";

const dataset = makeDataset();
const settlement = DEFAULT_SETTINGS.settlement;

const base = applySettings(dataset, DEFAULT_SETTINGS, []);
const openReceipt = () => {
  const used = new Set(base.dataset.reconciliation.groups.flatMap((group) => group.receipts.map((row) => row.id)));
  return base.dataset.receipts.find((receipt) => !used.has(receipt.id) && receipt.amountSatang > 0);
};
const openLine = () => {
  const used = new Set(base.dataset.reconciliation.groups.flatMap((group) => group.lines.map((row) => row.id)));
  for (const statement of dataset.statements) {
    for (const line of statement.lines) {
      if (line.direction === "credit" && !used.has(line.id)) return line;
    }
  }
  return null;
};

const decisionFor = (receipt, line, extra = {}) => ({
  id: "DEC-TEST-1",
  kind: "MANUAL",
  receiptIds: [receipt.id],
  bankLineIds: [line.id],
  receiptSatang: receipt.amountSatang,
  bankSatang: line.amountSatang,
  differenceSatang: receipt.amountSatang - line.amountSatang,
  reason: "ROUNDING",
  note: "",
  decidedBy: "test",
  decidedAt: "2026-08-01T10:00:00",
  ...extra,
});

// ── R00 · การตัดสินใจของผู้ตรวจ ───────────────────────────────────────────────

test("คู่ที่คนยืนยันถูกล็อกก่อนกฎอัตโนมัติทุกข้อ แม้วันและยอดจะไม่ตรง", () => {
  const receipt = openReceipt();
  const line = openLine();
  assert.ok(receipt && line, "ชุดข้อมูลต้องมีแถวที่ยังไม่จับคู่ให้ทดสอบ");

  const after = applySettings(dataset, DEFAULT_SETTINGS, [decisionFor(receipt, line)]);
  const group = after.dataset.reconciliation.groups.find((item) => item.decision?.id === "DEC-TEST-1");

  assert.ok(group, "ต้องมีกลุ่มที่มาจากการตัดสินใจ");
  assert.equal(group.type, "MANUAL");
  assert.deepEqual(group.receipts.map((row) => row.id), [receipt.id]);
  assert.deepEqual(group.lines.map((row) => row.id), [line.id]);
  // แถวที่ถูกล็อกต้องไม่ไปโผล่ในกลุ่มอื่นหรือในข้อยกเว้นอีก
  const elsewhere = after.dataset.reconciliation.groups.filter((item) => item.id !== group.id);
  assert.ok(!elsewhere.some((item) => item.receipts.some((row) => row.id === receipt.id)));
  assert.ok(!after.dataset.reconciliation.exceptions.some((item) => item.receiptId === receipt.id));
  assert.ok(!after.dataset.reconciliation.exceptions.some((item) => item.bankLineId === line.id));
});

test("ผลต่างที่ยอมรับถูกรายงานตรง ๆ ไม่ถูกกลบให้เป็นศูนย์", () => {
  const receipt = openReceipt();
  const line = openLine();
  const after = applySettings(dataset, DEFAULT_SETTINGS, [decisionFor(receipt, line)]);
  const group = after.dataset.reconciliation.groups.find((item) => item.decision?.id === "DEC-TEST-1");

  assert.equal(group.deltaSatang, receipt.amountSatang - line.amountSatang);
  assert.equal(group.decision.differenceSatang, group.deltaSatang);
  assert.equal(group.decision.reason, "ROUNDING");
  assert.equal(group.decision.decidedBy, "test");
  // กฎสองข้อยังถูกรายงานตามความจริง ไม่ใช่ทำเป็นว่าผ่าน
  const amountRule = group.rulesPassed.find((rule) => rule.id === "R02");
  assert.equal(amountRule.passed, receipt.amountSatang === line.amountSatang);
  assert.equal(after.dataset.reconciliation.summary.acceptedDifferenceSatang, group.deltaSatang);
  assert.equal(after.dataset.reconciliation.summary.decidedGroups, 1);
});

test("ยกเลิกการตัดสินใจแล้วทุกอย่างกลับไปเหมือนเดิมเป๊ะ", () => {
  const receipt = openReceipt();
  const line = openLine();
  const after = applySettings(dataset, DEFAULT_SETTINGS, [decisionFor(receipt, line)]);
  const undone = applySettings(dataset, DEFAULT_SETTINGS, []);

  assert.notEqual(after.dataset.reconciliation.summary.matchedGroups, undone.dataset.reconciliation.summary.matchedGroups);
  assert.deepEqual(undone.dataset.reconciliation.summary, base.dataset.reconciliation.summary);
});

test("การตัดสินใจที่อ้างถึงแถวซึ่งหายไปแล้ว ถูกรายงานว่าใช้ไม่ได้ ไม่ใช่เงียบหาย", () => {
  const line = openLine();
  const ghost = decisionFor({ id: "RCP-ไม่มีอยู่จริง", amountSatang: 100 }, line, { id: "DEC-GHOST" });
  const after = applySettings(dataset, DEFAULT_SETTINGS, [ghost]);

  assert.equal(after.dataset.reconciliation.staleDecisions.length, 1);
  assert.equal(after.dataset.reconciliation.staleDecisions[0].id, "DEC-GHOST");
  assert.equal(after.dataset.reconciliation.staleDecisions[0].staleReason, "ROWS_GONE");
  assert.equal(after.dataset.reconciliation.summary.staleDecisions, 1);
  assert.equal(after.dataset.reconciliation.summary.decidedGroups, 0);
});

test("แถวเดียวถูกใช้ได้ครั้งเดียว การตัดสินใจที่ทับกันถูกปฏิเสธ", () => {
  const receipt = openReceipt();
  const line = openLine();
  const first = decisionFor(receipt, line, { id: "DEC-A" });
  const second = decisionFor(receipt, line, { id: "DEC-B" });
  const after = applySettings(dataset, DEFAULT_SETTINGS, [first, second]);

  assert.equal(after.dataset.reconciliation.groups.filter((item) => item.decision).length, 1);
  assert.equal(after.dataset.reconciliation.staleDecisions.length, 1);
  assert.equal(after.dataset.reconciliation.staleDecisions[0].id, "DEC-B");
  assert.equal(after.dataset.reconciliation.staleDecisions[0].staleReason, "ALREADY_USED");
});

test("การตัดสินใจไม่ทำให้กฎอัตโนมัติหย่อนลงกับแถวอื่น", () => {
  const receipt = openReceipt();
  const line = openLine();
  const after = applySettings(dataset, DEFAULT_SETTINGS, [decisionFor(receipt, line)]);

  for (const group of after.dataset.reconciliation.groups) {
    if (group.decision) continue;
    assert.equal(group.deltaSatang, 0, `${group.id} ยอดไม่ตรงพอดีทั้งที่ไม่มีคนยืนยัน`);
    assert.ok(group.lines.every((item) => item.date === group.date), `${group.id} วันไม่ตรงกัน`);
    assert.ok(group.receipts.every((item) => item.bookingCreatedDate === group.date), `${group.id} วันสร้างคำจองไม่ตรง`);
  }
});

test("เอกสารต้นทางไม่ถูกแก้ไขไม่ว่าจะยืนยันอะไรไป", () => {
  const before = JSON.stringify(dataset);
  const receipt = openReceipt();
  const line = openLine();
  applySettings(dataset, DEFAULT_SETTINGS, [decisionFor(receipt, line)]);
  assert.equal(JSON.stringify(dataset), before);
});

// ── การแตกยอดก้อนโอน OTA ─────────────────────────────────────────────────────

test("รู้จักก้อนโอน OTA จากข้อความบนบรรทัดเงินเข้า", () => {
  assert.ok(looksLikeSettlement({ channel: "ธุรกรรมต่างประเทศ", description: "", detail: "" }, settlement));
  assert.ok(looksLikeSettlement({ channel: "", description: "", detail: "จาก SMART SCBT X9633 MCP Operating a" }, settlement));
  assert.ok(!looksLikeSettlement({ channel: "Internet/Mobile GSB", description: "รับโอนเงิน", detail: "จาก GSB X5438" }, settlement));
  assert.ok(isOtaMethod("AIRBNB COLLECT", settlement));
  assert.ok(isOtaMethod("airbnb.com collect", settlement));
  assert.ok(!isOtaMethod("KbankGL987", settlement));
});

test("ข้อเสนอทุกก้อนมียอดเต็มไม่น้อยกว่าเงินที่เข้าบัญชี เพราะคอมถูกหักก่อนโอน", () => {
  assert.ok(base.settlements.length > 0, "ชุดข้อมูลต้องมีก้อนโอน OTA ให้ทดสอบ");

  for (const proposal of base.settlements) {
    if (proposal.status === "SHORT" || proposal.status === "EMPTY") continue;
    assert.ok(proposal.grossSatang >= proposal.netSatang, `${proposal.id} ยอดเต็มน้อยกว่าเงินที่เข้าจริง`);
    assert.equal(proposal.feeSatang, proposal.grossSatang - proposal.netSatang);
    assert.ok(proposal.feeRate >= 0 && proposal.feeRate <= 100);
  }
});

test("ค่าคอมที่สูงผิดปกติถูกตั้งธงไว้ ไม่ได้ถูกห้าม", () => {
  const tight = proposeSettlements(base.dataset, base.dataset.reconciliation, { ...settlement, maxFeeRate: 1 });
  assert.ok(tight.some((item) => item.status === "FEE_HIGH"), "ตั้งเพดานคอมต่ำแล้วต้องมีก้อนที่ถูกตั้งธง");
  // ตั้งธงเท่านั้น ไม่ได้เอาข้อเสนอออก
  assert.equal(tight.length, base.settlements.length);
});

test("รายการรับเงินหนึ่งใบถูกเสนอให้ก้อนเดียวเท่านั้น", () => {
  const seen = new Set();
  for (const proposal of base.settlements) {
    for (const id of proposal.selectedIds) {
      assert.ok(!seen.has(id), `${id} ถูกเสนอซ้ำสองก้อน`);
      seen.add(id);
    }
  }
});

test("เสนอเฉพาะคำจองที่วันอยู่ในช่วงที่ตั้งไว้", () => {
  const narrow = proposeSettlements(base.dataset, base.dataset.reconciliation, { ...settlement, windowDays: 0 });
  for (const proposal of narrow) {
    for (const row of proposal.candidates) assert.equal(row.dayGap, 0);
  }
  const wide = proposeSettlements(base.dataset, base.dataset.reconciliation, { ...settlement, windowDays: 30 });
  assert.ok(
    wide.reduce((sum, item) => sum + item.candidates.length, 0)
    >= narrow.reduce((sum, item) => sum + item.candidates.length, 0),
  );
});

test("ปิดการแตกยอดแล้วไม่มีข้อเสนอเลย", () => {
  const off = applySettings(dataset, { ...DEFAULT_SETTINGS, settlement: { ...settlement, enabled: false } }, []);
  assert.equal(off.settlements.length, 0);
});

test("ข้อเสนอยังไม่มีผลกับตัวเลขใดจนกว่าจะยืนยัน", () => {
  assert.deepEqual(base.dataset.reconciliation.summary, applySettings(dataset, DEFAULT_SETTINGS, []).dataset.reconciliation.summary);
  assert.equal(base.dataset.reconciliation.summary.decidedGroups, 0);
});

test("ยืนยันก้อน OTA แล้วทั้งเงินเข้าและคำจองหลุดจากคิวงานพร้อมกัน", () => {
  const proposal = base.settlements.find((item) => item.status === "READY" && item.selectedIds.length > 1);
  assert.ok(proposal, "ต้องมีก้อนที่เสนอมากกว่าหนึ่งคำจองให้ทดสอบ");

  const after = applySettings(dataset, DEFAULT_SETTINGS, [{
    id: "DEC-OTA-1",
    kind: "SETTLEMENT",
    receiptIds: proposal.selectedIds,
    bankLineIds: [proposal.lineId],
    receiptSatang: proposal.grossSatang,
    bankSatang: proposal.netSatang,
    differenceSatang: proposal.feeSatang,
    reason: "COMMISSION",
    note: "",
    decidedBy: "test",
    decidedAt: "2026-08-01T10:00:00",
  }]);

  const group = after.dataset.reconciliation.groups.find((item) => item.decision?.id === "DEC-OTA-1");
  assert.ok(group);
  assert.equal(group.type, "OTA");
  assert.equal(group.receipts.length, proposal.selectedIds.length);
  assert.equal(group.deltaSatang, proposal.feeSatang);
  // ก้อนนี้หายไปจากข้อเสนอรอบถัดไป และคำจองไม่ถูกนับเป็น "นอกขอบเขต" อีก
  assert.ok(!after.settlements.some((item) => item.lineId === proposal.lineId));
  const outOfScopeCount = after.dataset.reconciliation.outOfScope.reduce((sum, item) => sum + item.count, 0);
  const beforeCount = base.dataset.reconciliation.outOfScope.reduce((sum, item) => sum + item.count, 0);
  assert.equal(outOfScopeCount, beforeCount - proposal.selectedIds.length);
});

test("reconcile รับ decisions ที่ว่างหรือไม่ส่งมาเลยก็ได้", () => {
  const plain = reconcile({ ...dataset, receipts: dataset.receipts });
  assert.equal(plain.staleDecisions.length, 0);
  assert.equal(plain.summary.decidedGroups, 0);
  assert.equal(plain.summary.acceptedDifferenceSatang, 0);
});
