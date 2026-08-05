import assert from "node:assert/strict";
import test from "node:test";
import { findAmountCombination, invoiceTotals, normalizePaymentMethod, reconcileBank, reconcileOtaSettlement, toSatang } from "../lib/reconciliation.mjs";

test("normalizes OTA payment method aliases", () => {
  assert.equal(normalizePaymentMethod("BOOKINGCOM COLLECT"), "BOOKING_COLLECT");
  assert.equal(normalizePaymentMethod("Booking Collect"), "BOOKING_COLLECT");
  assert.equal(normalizePaymentMethod("TRIPCOM COLLECT"), "TRIP_COLLECT");
  assert.equal(normalizePaymentMethod("AIRBNB COLLECT"), "AIRBNB_COLLECT");
});

test("keeps money deterministic in satang", () => {
  assert.equal(toSatang("2,274,426.29"), 227442629);
  assert.equal(toSatang("-380.00"), -38000);
});

test("finds grouped N:1 cases from the real acceptance set", () => {
  const pair6450 = findAmountCombination([{ id: "a", amount: "500" }, { id: "b", amount: "5950" }], "6450");
  const pair11000 = findAmountCombination([{ id: "a", amount: "5500" }, { id: "b", amount: "5500" }], "11000");
  const four50400 = findAmountCombination(Array.from({ length: 4 }, (_, index) => ({ id: String(index), amount: "12600" })), "50400");
  assert.deepEqual(pair6450?.map((item) => item.id), ["a", "b"]);
  assert.equal(pair11000?.length, 2);
  assert.equal(four50400?.length, 4);
});

test("matches one receipt to multiple bank credits", () => {
  const result = reconcileBank([{ id: "r1", amount: "8900" }], [{ id: "b1", amount: "5900" }, { id: "b2", amount: "3000" }]);
  assert.equal(result.groups[0].type, "1:N");
  assert.deepEqual(result.groups[0].bankIds.sort(), ["b1", "b2"]);
});

test("keeps 4,000 versus 380 as AMOUNT_MISMATCH with 3,620 delta", () => {
  const result = reconcileBank([{ id: "r1", amount: "4000" }], [{ id: "b1", amount: "380" }]);
  assert.equal(result.exceptions[0].reason, "AMOUNT_MISMATCH");
  assert.equal(result.exceptions[0].deltaSatang, 362000);
});

test("performs OTA three-way reconciliation", () => {
  const result = reconcileOtaSettlement(
    [{ id: "b1", gross: "12600" }, { id: "b2", gross: "12600" }],
    [{ id: "s1", gross: "12600", fee: "1260", net: "11340" }, { id: "s2", gross: "12600", fee: "1260", net: "11340" }],
    { amount: "22680" },
  );
  assert.equal(result.bookingToSettlementMatched, true);
  assert.equal(result.settlementToBankMatched, true);
  assert.equal(result.deltaSatang, 0);
});

test("calculates VAT-inclusive invoice totals without floating point drift", () => {
  const totals = invoiceTotals([{ amount: "1070.00" }]);
  assert.deepEqual(totals, { subtotalSatang: 100000, vatSatang: 7000, totalSatang: 107000 });
});
