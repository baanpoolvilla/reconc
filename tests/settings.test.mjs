import assert from "node:assert/strict";
import test from "node:test";

import { makeDataset } from "./fixtures.mjs";

import {
  DEFAULT_SETTINGS,
  applySettings,
  countActiveRules,
  describeFacets,
  normalizeSettings,
  propertyOf,
  receiptExclusion,
} from "../lib/settings-core.mjs";
import { normalizePaymentMethod } from "../lib/reconciliation.mjs";

const dataset = makeDataset();

const withExclusions = (exclusions) => ({
  ...DEFAULT_SETTINGS,
  exclusions: { ...DEFAULT_SETTINGS.exclusions, ...exclusions },
});

const noExclusions = withExclusions({ properties: [], methods: [] });
const sum = (receipts) => receipts.reduce((total, receipt) => total + receipt.amountSatang, 0);

test("ค่าตั้งต้นตัดทั้งกลุ่ม Medina และช่องทาง Kbank-Posh ออก", () => {
  const result = applySettings(dataset, DEFAULT_SETTINGS);

  assert.ok(result.excluded.length > 0, "ต้องมีรายการถูกตัดออกจริง");
  for (const receipt of result.dataset.receipts) {
    assert.notEqual(propertyOf(receipt.group).toLowerCase(), "medina");
    assert.notEqual(normalizePaymentMethod(receipt.method), normalizePaymentMethod("Kbank-Posh"));
  }
  // ทุกรายการที่ตัดออกต้องเข้าเงื่อนไขข้อใดข้อหนึ่งจริง ไม่ใช่ตัดเกิน
  for (const receipt of result.excluded) {
    const isMedina = propertyOf(receipt.group).toLowerCase() === "medina";
    const isPosh = normalizePaymentMethod(receipt.method) === normalizePaymentMethod("Kbank-Posh");
    assert.ok(isMedina || isPosh, `${receipt.id} ถูกตัดออกโดยไม่เข้าเงื่อนไขใดเลย`);
  }
});

test("รายการที่เหลือบวกรายการที่ตัดออก เท่ากับเอกสารต้นทางเสมอ", () => {
  const result = applySettings(dataset, DEFAULT_SETTINGS);

  assert.equal(result.dataset.receipts.length + result.excluded.length, dataset.receipts.length);
  assert.equal(sum(result.dataset.receipts) + result.excludedSatang, sum(dataset.receipts));
  assert.equal(result.sourceReceiptCount, dataset.receipts.length);
  assert.equal(result.sourceReceiptSatang, sum(dataset.receipts));
  // ยอดในถังสรุปต้องรวมได้เท่ายอดที่ตัดออกทั้งหมด
  assert.equal(result.buckets.reduce((total, bucket) => total + bucket.amountSatang, 0), result.excludedSatang);
  assert.equal(result.buckets.reduce((total, bucket) => total + bucket.count, 0), result.excluded.length);
});

test("การตั้งค่าไม่แก้ไขเอกสารต้นทาง", () => {
  const before = JSON.stringify(dataset);
  applySettings(dataset, DEFAULT_SETTINGS);
  assert.equal(JSON.stringify(dataset), before);
});

test("ปิดตัวกรองแล้วทุกรายการกลับเข้าสู่การกระทบยอด", () => {
  const off = applySettings(dataset, withExclusions({ enabled: false }));

  assert.equal(off.excluded.length, 0);
  assert.equal(off.dataset.receipts.length, dataset.receipts.length);
  assert.equal(off.activeRuleCount, 0);
  // ผลกระทบยอดต้องตรงกับที่ build ไว้ เพราะไม่มีอะไรถูกตัดออก
  assert.equal(off.dataset.reconciliation.summary.matchedGroups, dataset.reconciliation.summary.matchedGroups);
  assert.equal(off.dataset.reconciliation.summary.matchRate, dataset.reconciliation.summary.matchRate);
});

test("กฎกลุ่มทรัพย์สินครอบคลุมทุกโครงการที่ขึ้นต้นด้วยชื่อนั้น", () => {
  const facets = describeFacets(dataset);
  const medinaGroups = facets.groups.filter((facet) => propertyOf(facet.value).toLowerCase() === "medina");
  assert.ok(medinaGroups.length > 0, "ชุดข้อมูลต้องมีกลุ่ม Medina ให้ทดสอบ");

  const result = applySettings(dataset, withExclusions({ properties: ["Medina"], methods: [] }));
  const expected = medinaGroups.reduce((total, facet) => total + facet.count, 0);
  assert.equal(result.excluded.length, expected);
  assert.ok(result.excluded.every((receipt) => receipt.excludedBy.scope === "property"));
});

test("ชื่อกลุ่มทรัพย์สินและช่องทางรับเงินไม่สนตัวพิมพ์และเครื่องหมาย", () => {
  const exact = applySettings(dataset, DEFAULT_SETTINGS);
  const sloppy = applySettings(dataset, withExclusions({ properties: ["mEdInA"], methods: ["KBANK POSH"] }));
  assert.equal(sloppy.excluded.length, exact.excluded.length);
});

test("กฎถูกตรวจตามลำดับ และรายงานเหตุผลข้อแรกที่เข้าข่าย", () => {
  // รายการหนึ่งเข้าได้ทั้งกฎกลุ่มทรัพย์สินและกฎช่องทาง — ต้องรายงานกฎแรก
  const both = dataset.receipts.find(
    (receipt) => propertyOf(receipt.group).toLowerCase() === "medina"
      && normalizePaymentMethod(receipt.method) === normalizePaymentMethod("Kbank-Posh"),
  );
  assert.ok(both, "ชุดข้อมูลต้องมีรายการที่เข้าทั้งสองกฎ");
  assert.deepEqual(receiptExclusion(both, DEFAULT_SETTINGS), { scope: "property", value: "Medina" });
  assert.deepEqual(
    receiptExclusion(both, withExclusions({ properties: [] })),
    { scope: "method", value: "Kbank-Posh" },
  );
});

test("ตัดด้วยคำค้น ช่วงยอดเงิน และรายการคืนเงิน", () => {
  const sample = dataset.receipts.find((receipt) => receipt.guest);

  assert.equal(
    receiptExclusion(sample, withExclusions({ properties: [], methods: [], keywords: [sample.guest.slice(0, 3)] }))?.scope,
    "keyword",
  );
  assert.equal(receiptExclusion(sample, noExclusions), null);

  const floor = withExclusions({ properties: [], methods: [], minAmountSatang: sample.amountSatang + 1 });
  assert.equal(receiptExclusion(sample, floor)?.scope, "amount");
  const ceiling = withExclusions({ properties: [], methods: [], maxAmountSatang: sample.amountSatang - 1 });
  assert.equal(receiptExclusion(sample, ceiling)?.scope, "amount");

  const refund = { ...sample, amountSatang: -sample.amountSatang };
  assert.equal(receiptExclusion(refund, noExclusions), null);
  assert.equal(receiptExclusion(refund, withExclusions({ properties: [], methods: [], excludeRefunds: true }))?.scope, "refund");
});

test("ตัดตามสถานะคำจอง โดยอ่านสถานะจากบัญชีแยกประเภท", () => {
  const bookings = new Map(dataset.bookings.map((booking) => [booking.reservationNo, booking]));
  const cancelled = dataset.receipts.find((receipt) => bookings.get(receipt.reservationNo)?.status === "Cancelled");
  if (!cancelled) return;

  const settings = withExclusions({ properties: [], methods: [], bookingStatuses: ["Cancelled"] });
  assert.equal(receiptExclusion(cancelled, settings, bookings.get(cancelled.reservationNo))?.scope, "bookingStatus");
  // ไม่มีข้อมูลคำจองก็ต้องไม่พัง และต้องไม่ตัดออกเพราะเดาสถานะเอง
  assert.equal(receiptExclusion(cancelled, settings, undefined), null);
});

test("ปิดรูปแบบการจับคู่แล้ว กลุ่มชนิดนั้นต้องหายไปทั้งหมด", () => {
  const base = applySettings(dataset, noExclusions);
  assert.ok(base.dataset.reconciliation.groups.some((group) => group.type === "N:1"), "ชุดข้อมูลต้องมีกลุ่ม N:1 ให้ทดสอบ");

  const off = applySettings(dataset, {
    ...DEFAULT_SETTINGS,
    exclusions: noExclusions.exclusions,
    matching: { ...DEFAULT_SETTINGS.matching, allowManyToOne: false, allowOneToMany: false },
  });
  assert.equal(off.dataset.reconciliation.groups.filter((group) => group.type !== "1:1").length, 0);
  // รายการที่เคยจับคู่แบบกลุ่มต้องกลายเป็นข้อยกเว้น ไม่ใช่หายไปเฉย ๆ
  assert.ok(off.dataset.reconciliation.exceptions.length > base.dataset.reconciliation.exceptions.length);
});

test("ทุกกลุ่มยังผ่านกฎบังคับทั้งสองข้อ ไม่ว่าตั้งค่าอย่างไร", () => {
  for (const matching of [
    { allowManyToOne: true, allowOneToMany: true, maxGroupSize: 2 },
    { allowManyToOne: true, allowOneToMany: false, maxGroupSize: 6 },
    { allowManyToOne: false, allowOneToMany: true, maxGroupSize: 4 },
  ]) {
    const result = applySettings(dataset, { ...DEFAULT_SETTINGS, matching });
    for (const group of result.dataset.reconciliation.groups) {
      assert.equal(group.deltaSatang, 0, `${group.id} ยอดไม่ตรงพอดี`);
      assert.ok(group.lines.every((line) => line.date === group.date), `${group.id} วันที่ไม่ตรงกัน`);
      assert.ok(group.receipts.length <= matching.maxGroupSize && group.lines.length <= matching.maxGroupSize);
    }
  }
});

test("normalizeSettings ซ่อมค่าที่ใช้ไม่ได้แทนที่จะปล่อยให้พัง", () => {
  const repaired = normalizeSettings({
    exclusions: { properties: "Medina", methods: ["Kbank-Posh", "Kbank-Posh", " "], minAmountSatang: -5 },
    matching: { maxGroupSize: 99 },
    display: { ledgerRowLimit: 0, showExcludedRows: "yes" },
  });

  assert.deepEqual(repaired.exclusions.properties, []); // สตริงเดี่ยวไม่ใช่รายการ จึงถูกทิ้ง
  assert.deepEqual(repaired.exclusions.methods, ["Kbank-Posh"]); // ซ้ำและช่องว่างถูกตัด
  assert.equal(repaired.exclusions.minAmountSatang, null);
  assert.equal(repaired.matching.maxGroupSize, 6);
  assert.equal(repaired.display.ledgerRowLimit, 50);
  assert.equal(repaired.display.showExcludedRows, DEFAULT_SETTINGS.display.showExcludedRows);
  assert.deepEqual(normalizeSettings(undefined).matching, DEFAULT_SETTINGS.matching);
});

test("นับจำนวนกฎที่เปิดใช้อยู่ได้ถูกต้อง", () => {
  assert.equal(countActiveRules(DEFAULT_SETTINGS), 2);
  assert.equal(countActiveRules(withExclusions({ enabled: false })), 0);
  // Medina + Kbank-Posh ที่มาจากค่าตั้งต้น บวกอีกสี่กฎที่เพิ่มเข้าไป
  assert.equal(countActiveRules(withExclusions({ keywords: ["ก", "ข"], excludeRefunds: true, minAmountSatang: 100 })), 6);
});

test("ตัวเลือกในหน้าตั้งค่ามาจากข้อมูลจริง และบอกว่าช่องทางไหนมี Statement", () => {
  const facets = describeFacets(dataset);

  assert.equal(facets.properties.reduce((total, facet) => total + facet.count, 0), dataset.receipts.length);
  assert.ok(facets.properties.some((facet) => facet.value === "Medina"));

  const posh = facets.methods.find((facet) => facet.value === "Kbank-Posh");
  assert.equal(posh?.note, "ไม่มี Statement");
  for (const statement of dataset.statements) {
    assert.equal(facets.methods.find((facet) => facet.value === statement.method)?.note, "มี Statement");
  }
  // เรียงจากยอดมากไปน้อย เพื่อให้รายการที่ตัดออกแล้วกระทบมากที่สุดอยู่บนสุด
  for (let index = 1; index < facets.methods.length; index += 1) {
    assert.ok(facets.methods[index - 1].amountSatang >= facets.methods[index].amountSatang);
  }
});

test("ชุดข้อมูลว่างผ่านการตั้งค่าได้โดยไม่ throw", () => {
  const empty = {
    meta: { generatedAt: "", period: "", rulesetVersion: "2.0.0", sources: [] },
    bookings: [], receipts: [], statements: [],
    reconciliation: { rulesetVersion: "2.0.0", accounts: [], groups: [], exceptions: [], outOfScope: [], summary: {} },
  };
  const result = applySettings(empty, DEFAULT_SETTINGS);
  assert.equal(result.excluded.length, 0);
  assert.equal(result.dataset.receipts.length, 0);
});
