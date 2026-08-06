import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  RULESET_VERSION,
  findExactSubset,
  normalizePaymentMethod,
  reconcile,
  reconcileAccount,
} from "../lib/reconciliation.mjs";

const statement = {
  code: "885",
  accountNo: "000-0-00000-0",
  method: "KbankGL885",
  lines: [
    { id: "L1", date: "2026-07-10", time: "10:00", description: "รับโอนเงิน", channel: "GSB", detail: "", direction: "credit", amountSatang: 600000 },
    { id: "L2", date: "2026-07-11", time: "11:00", description: "รับโอนเงิน", channel: "GSB", detail: "", direction: "credit", amountSatang: 250000 },
    { id: "L3", date: "2026-07-11", time: "11:05", description: "รับโอนเงิน", channel: "GSB", detail: "", direction: "credit", amountSatang: 150000 },
    { id: "L4", date: "2026-07-12", time: "09:00", description: "โอนเงิน", channel: "K BIZ", detail: "", direction: "debit", amountSatang: 900000 },
  ],
};

const makeBooking = (reservationNo, createdDate) => ({
  reservationNo,
  createdDate,
  createdAt: `${createdDate}T09:00:00`,
  status: "Completed",
  guest: "ผู้จอง",
  totalSatang: 1000000,
});

const bookingMap = (...entries) => new Map(entries.map((booking) => [booking.reservationNo, booking]));

const makeReceipt = (id, reservationNo, date, amountSatang) => ({
  id, reservationNo, date, amountSatang, method: "KbankGL885", guest: "ผู้จอง", roomType: "A1", sourceRow: 1,
});

test("normalizePaymentMethod folds OTA spellings onto one key", () => {
  assert.equal(normalizePaymentMethod("BOOKINGCOM COLLECT"), "BOOKING_COLLECT");
  assert.equal(normalizePaymentMethod("Booking.com Collect"), "BOOKING_COLLECT");
  assert.equal(normalizePaymentMethod("TRIPCOM COLLECT"), "TRIP_COLLECT");
  assert.equal(normalizePaymentMethod("KbankGL885"), "KBANKGL885");
});

test("findExactSubset only returns exact sums", () => {
  const items = [{ amountSatang: 50000 }, { amountSatang: 595000 }, { amountSatang: 120000 }];
  assert.equal(findExactSubset(items, 645000).length, 2);
  assert.equal(findExactSubset(items, 645001), null);
});

test("R03 matches 1:1 when the booking was created on the statement date", () => {
  const { groups, exceptions } = reconcileAccount(
    statement,
    [makeReceipt("A", "R1", "2026-07-30", 600000)],
    bookingMap(makeBooking("R1", "2026-07-10")),
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "1:1");
  assert.equal(groups[0].deltaSatang, 0);
  assert.equal(groups[0].date, "2026-07-10");
  // The receipt's own date is irrelevant — only the booking creation date counts.
  assert.equal(groups[0].receipts[0].receiptDate, "2026-07-30");
  assert.equal(exceptions.filter((item) => item.reason !== "UNMATCHED_BANK_CREDIT").length, 0);
});

test("a matching amount on the wrong day is never matched", () => {
  const { groups, exceptions } = reconcileAccount(
    statement,
    [makeReceipt("A", "R1", "2026-07-09", 600000)],
    bookingMap(makeBooking("R1", "2026-07-09")),
  );

  assert.equal(groups.length, 0);
  assert.equal(exceptions.find((item) => item.receiptId === "A").reason, "DATE_RULE_UNMET");
});

test("a same-day amount that differs by one satang is never matched", () => {
  const { groups, exceptions } = reconcileAccount(
    statement,
    [makeReceipt("A", "R1", "2026-07-10", 600001)],
    bookingMap(makeBooking("R1", "2026-07-10")),
  );

  assert.equal(groups.length, 0);
  const exception = exceptions.find((item) => item.receiptId === "A");
  assert.equal(exception.reason, "AMOUNT_MISMATCH");
  assert.equal(exception.deltaSatang, 1);
  assert.ok(exception.candidates.length > 0);
});

test("R04 groups several same-day receipts into one credit", () => {
  const { groups } = reconcileAccount(
    statement,
    [makeReceipt("A", "R1", "2026-07-10", 250000), makeReceipt("B", "R2", "2026-07-10", 350000)],
    bookingMap(makeBooking("R1", "2026-07-10"), makeBooking("R2", "2026-07-10")),
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "N:1");
  assert.equal(groups[0].receipts.length, 2);
  assert.equal(groups[0].bankSatang, 600000);
});

test("R04 refuses to group receipts whose bookings were created on different days", () => {
  const { groups, exceptions } = reconcileAccount(
    statement,
    [makeReceipt("A", "R1", "2026-07-10", 250000), makeReceipt("B", "R2", "2026-07-10", 350000)],
    bookingMap(makeBooking("R1", "2026-07-10"), makeBooking("R2", "2026-07-11")),
  );

  assert.equal(groups.length, 0);
  assert.equal(exceptions.filter((item) => item.receiptId).length, 2);
});

test("R05 splits one receipt across several same-day credits", () => {
  const { groups } = reconcileAccount(
    statement,
    [makeReceipt("A", "R1", "2026-07-11", 400000)],
    bookingMap(makeBooking("R1", "2026-07-11")),
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "1:N");
  assert.deepEqual(groups[0].lines.map((line) => line.id).sort(), ["L2", "L3"]);
});

test("receipts without a ledger booking cannot satisfy the date rule", () => {
  const { groups, exceptions } = reconcileAccount(statement, [makeReceipt("A", "UNKNOWN", "2026-07-10", 600000)], new Map());

  assert.equal(groups.length, 0);
  assert.equal(exceptions.find((item) => item.receiptId === "A").reason, "MISSING_BOOKING");
});

test("debit lines are never offered as match candidates", () => {
  const { groups, exceptions } = reconcileAccount(
    statement,
    [makeReceipt("A", "R1", "2026-07-12", 900000)],
    bookingMap(makeBooking("R1", "2026-07-12")),
  );

  assert.equal(groups.length, 0);
  assert.equal(exceptions.find((item) => item.receiptId === "A").reason, "DATE_RULE_UNMET");
});

test("refunds are routed to their own exception reason", () => {
  const { groups, exceptions } = reconcileAccount(
    statement,
    [makeReceipt("A", "R1", "2026-07-10", -600000)],
    bookingMap(makeBooking("R1", "2026-07-10")),
  );

  assert.equal(groups.length, 0);
  assert.equal(exceptions.find((item) => item.receiptId === "A").reason, "REFUND_LINE");
});

test("reconcile reports out-of-scope payment methods separately", () => {
  const result = reconcile({
    bookings: [makeBooking("R1", "2026-07-10")],
    receipts: [
      makeReceipt("A", "R1", "2026-07-10", 600000),
      { ...makeReceipt("B", "R1", "2026-07-10", 100000), method: "Kbank-Posh" },
    ],
    statements: [statement],
  });

  assert.equal(result.rulesetVersion, RULESET_VERSION);
  assert.equal(result.summary.inScopeReceipts, 1);
  assert.equal(result.summary.matchedReceipts, 1);
  assert.equal(result.summary.matchRate, 100);
  assert.deepEqual(result.outOfScope.map((item) => item.method), ["Kbank-Posh"]);
});

test("reconciles an empty dataset without throwing", () => {
  // This is the shape the build emits when data/ holds no source documents,
  // so the app can deploy and run before any statement has been loaded.
  const result = reconcile({ bookings: [], receipts: [], statements: [] });

  assert.deepEqual(result.accounts, []);
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.exceptions, []);
  assert.deepEqual(result.outOfScope, []);
  assert.equal(result.summary.matchRate, 0);
  assert.equal(result.summary.inScopeReceipts, 0);
  assert.equal(result.summary.controlBalanced, true);
});

test("the generated dataset satisfies both hard rules on every match", async () => {
  const dataset = JSON.parse(await readFile(new URL("../lib/dataset.generated.json", import.meta.url), "utf8"));

  assert.ok(dataset.reconciliation.groups.length > 0);
  for (const group of dataset.reconciliation.groups) {
    assert.equal(group.deltaSatang, 0, `${group.id} has a non-zero delta`);
    for (const line of group.lines) assert.equal(line.date, group.date, `${group.id} spans more than one day`);
    for (const item of group.receipts) assert.equal(item.bookingCreatedDate, group.date, `${group.id} used a booking from another day`);
  }
  for (const record of dataset.statements) {
    assert.equal(record.controlDeltaSatang, 0, `statement ${record.code} control total does not balance`);
  }
});
