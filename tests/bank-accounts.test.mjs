import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/db/client.mjs";
import { replaceStatement, resolveAccount } from "../lib/db/repository.mjs";
import { accountFor, applyAccounts, methodFor, normalizeAccounts, unmappedAccounts } from "../lib/accounts.mjs";
import { BANKS, detectBank } from "../lib/parsers/banks/index.mjs";
import { DEFAULT_SETTINGS, applySettings, normalizeSettings } from "../lib/settings-core.mjs";

// ธนาคารและบัญชี — สองอย่างที่เคยเขียนตายไว้ในโค้ด
//
// เดิมระบบรู้จักธนาคารเดียวและบัญชีสองใบ (885/987) โดยดูจากชื่อไฟล์ การเพิ่ม
// ธนาคารหรือบัญชีจึงต้องแก้โค้ด ตอนนี้รูปแบบเอกสารเป็น adapter รายธนาคาร และ
// การผูกบัญชีกับช่องทางรับเงินเป็นการตั้งค่า
//
// สิ่งที่ห้ามหลุดคือ: ข้อมูลที่อยู่ในระบบอยู่แล้วต้องไม่เปลี่ยนความหมาย

const statement = (overrides = {}) => ({
  code: "",
  method: "",
  accountNo: "199-1-33588-5",
  suffix: "885",
  accountName: "บริษัททดสอบ จำกัด",
  bankLabel: "ธนาคารกสิกรไทย (K BIZ)",
  period: "2026-07",
  source: "x.pdf",
  branch: "",
  reference: "",
  cycle: "01/07/2026 - 31/07/2026",
  openingSatang: 0,
  closingSatang: 0,
  creditSatang: 0,
  debitSatang: 0,
  creditCount: 0,
  debitCount: 0,
  controlDeltaSatang: 0,
  lines: [],
  ...overrides,
});

async function freshDb() {
  const pg = new PGlite();
  const db = { query: async (sql, params = []) => (await pg.query(sql, params)).rows };
  await migrate(db);
  return db;
}

// ── ทะเบียนธนาคาร ───────────────────────────────────────────────────────────

test("ทุกธนาคารในทะเบียนบอกได้ว่าตัวเองคือใครและอ่านยังไง", () => {
  assert.ok(BANKS.length > 0);
  for (const bank of BANKS) {
    assert.ok(bank.id, "ต้องมี id");
    assert.ok(bank.label, "ต้องมีชื่อที่เอาไปบอกผู้ใช้ได้");
    assert.equal(typeof bank.detect, "function");
    assert.equal(typeof bank.parse, "function");
  }
  assert.equal(new Set(BANKS.map((bank) => bank.id)).size, BANKS.length, "id ต้องไม่ซ้ำ");
});

test("เอกสารที่ไม่มีธนาคารไหนอ่านออก ต้องไม่ถูกเดา", () => {
  const nothing = [[{ y: 700, runs: [{ x: 10, y: 700, text: "ใบเสร็จร้านกาแฟ" }] }]];

  assert.equal(detectBank(nothing), null, "ไม่รู้จักต้องคืน null ไม่ใช่หยิบตัวแรกมาใช้");
  assert.equal(detectBank([]), null);
});

// ── การผูกบัญชีกับช่องทางรับเงิน ────────────────────────────────────────────

test("เลขที่บัญชีเทียบกันได้ไม่ว่าจะพิมพ์ขีดยังไง", () => {
  const accounts = [{ accountNo: "199-1-33588-5", code: "885", method: "KbankGL885", label: "" }];

  assert.equal(accountFor(accounts, statement({ accountNo: "19913358 85" }))?.code, "885");
  assert.equal(accountFor(accounts, statement({ accountNo: "199133588-5" }))?.code, "885");
  assert.equal(accountFor(accounts, statement({ accountNo: "025-3-66398-7" })), null);
});

test("การตั้งค่าทับช่องทางที่ติดมากับเอกสาร และมีผลทันทีโดยไม่ต้องอัปโหลดซ้ำ", () => {
  const stored = statement({ method: "KbankGL885" });
  const accounts = [{ accountNo: "199-1-33588-5", code: "885", method: "Kbank-Main", label: "" }];

  assert.equal(methodFor(accounts, stored), "Kbank-Main");
  assert.equal(applyAccounts([stored], accounts)[0].method, "Kbank-Main");
  assert.equal(stored.method, "KbankGL885", "ต้องไม่แก้ของเดิมในที่");
});

test("บัญชีที่ยังไม่ผูก ใช้ช่องทางที่ติดมากับเอกสารต่อไป", () => {
  // เอกสารที่เข้าระบบไว้ก่อนมีหน้าตั้งค่านี้ ต้องทำงานเหมือนเดิมทุกประการ
  const stored = statement({ method: "KbankGL885" });

  assert.equal(methodFor([], stored), "KbankGL885");
  assert.deepEqual(applyAccounts([stored], []), [stored]);
});

test("บัญชีที่ไม่มีช่องทางเลย ถูกรายงานว่ายังไม่ได้ผูก", () => {
  const fresh = statement({ method: "", accountNo: "111-2-33333-4", suffix: "334" });
  const bound = statement({ method: "KbankGL885" });

  const pending = unmappedAccounts([fresh, bound], []);
  assert.equal(pending.length, 1, "เฉพาะใบที่ไม่มีช่องทางจริง ๆ");
  assert.equal(pending[0].accountNo, "111-2-33333-4");
  assert.equal(pending[0].code, "334");

  const after = unmappedAccounts([fresh, bound], [{ accountNo: "111-2-33333-4", code: "334", method: "SCB-Main", label: "" }]);
  assert.equal(after.length, 0, "ผูกแล้วต้องหายไปจากรายการ");
});

test("การตั้งค่าเก่าที่ยังไม่มีช่องบัญชี ไม่พัง", () => {
  const legacy = normalizeSettings({ version: 2, matching: { maxGroupSize: 3 } });

  assert.deepEqual(legacy.accounts, [], "ไม่มีบัญชีผูกไว้ ไม่ใช่ค่ามั่ว");
  assert.deepEqual(DEFAULT_SETTINGS.accounts, [], "ระบบไม่รู้จักบัญชีของใครล่วงหน้า");
});

test("บัญชีที่ไม่มีเลขที่บัญชีถูกทิ้ง และเลขซ้ำเก็บใบเดียว", () => {
  const cleaned = normalizeAccounts([
    { accountNo: "199-1-33588-5", code: "885", method: "A" },
    { accountNo: "1991335885", code: "ซ้ำ", method: "B" },
    { accountNo: "", code: "ไม่มีเลข", method: "C" },
  ]);

  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].method, "A", "ใบแรกชนะ");
});

// ── ความเข้ากันได้กับข้อมูลที่มีอยู่แล้ว ────────────────────────────────────

test("อัปโหลดบัญชีเดิมซ้ำ ต้องได้รหัสเดิม ไม่กลายเป็นบัญชีใบใหม่", async () => {
  // ประวัติมีไว้รองรับบัญชีที่เคยถูกเก็บด้วยรหัสหรือช่องทางที่ไม่ตรงกับที่คำนวณได้
  // เช่นเมื่อผู้ใช้เคยตั้งชื่อไว้เอง อัปโหลดรอบใหม่ต้องไม่กลายเป็นบัญชีคนละใบ
  const db = await freshDb();
  await replaceStatement(db, statement({ code: "885", method: "KbankGL885" }));

  const again = await resolveAccount(db, statement(), []);
  assert.equal(again.code, "885", "รหัสที่เคยเก็บไว้ต้องชนะ ไม่งั้นเดือนเก่าจะแยกเป็นคนละบัญชี");
  assert.equal(again.method, "KbankGL885");
  assert.equal(again.source, "history");
});

test("บัญชีใหม่ที่ยังไม่เคยเห็น ใช้เลขท้ายเป็นรหัส และเว้นช่องทางไว้", async () => {
  const db = await freshDb();
  const found = await resolveAccount(db, statement({ accountNo: "111-2-33333-4", suffix: "334" }), []);

  assert.equal(found.code, "334");
  assert.equal(found.method, "", "เดาช่องทางไม่ได้ ต้องให้คนผูก");
  assert.equal(found.source, "unknown");
});

test("การตั้งค่าชนะทั้งประวัติและค่าเริ่มต้น", async () => {
  const db = await freshDb();
  await replaceStatement(db, statement({ code: "885", method: "KbankGL885" }));

  const chosen = await resolveAccount(db, statement(), [
    { accountNo: "199-1-33588-5", code: "KB1", method: "Kbank-ใหม่", label: "" },
  ]);
  assert.equal(chosen.code, "KB1");
  assert.equal(chosen.method, "Kbank-ใหม่");
  assert.equal(chosen.source, "settings");
});

test("ผูกบัญชีแล้วรายการที่เคยไร้ที่อยู่ กระทบยอดได้ทันที", () => {
  const dataset = {
    meta: { generatedAt: "", period: "2026-07", periods: ["2026-07"], rulesetVersion: "x", sources: [{ kind: "collection_report", name: "c.xlsx", rows: 1 }] },
    bookings: [{
      reservationNo: "R1", channelReservationNo: "", createdAt: "2026-07-10T09:00:00", createdDate: "2026-07-10",
      completedAt: "", creator: "", guest: "ผู้เข้าพัก", mobile: "", channel: "", status: "Confirmed",
      roomType: "", roomNumber: "", nights: 1, totalSatang: 100000, payments: [], paidSatang: 100000, arSatang: 0, balanceDueSatang: 0,
    }],
    receipts: [{
      id: "RCP-1", sourceRow: 1, date: "2026-07-10", kind: "RECEIVE", method: "SCB-Main", amountSatang: 100000,
      reservationNo: "R1", channelReservationNo: "", channel: "", guest: "ผู้เข้าพัก", group: "Baanpool",
      roomType: "", roomNumber: "", checkIn: "2026-07-10", checkOut: "2026-07-10", note: "",
    }],
    statements: [statement({
      accountNo: "111-2-33333-4", suffix: "334", code: "334", method: "",
      lines: [{ id: "L1", date: "2026-07-10", time: "09:30", description: "", channel: "", detail: "", direction: "credit", amountSatang: 100000, balanceSatang: 100000, page: 1, row: 1 }],
      creditSatang: 100000, creditCount: 1, closingSatang: 100000,
    })],
    reconciliation: { rulesetVersion: "x", accounts: [], groups: [], exceptions: [], outOfScope: [], staleDecisions: [], summary: {} },
  };

  const unbound = applySettings(dataset, DEFAULT_SETTINGS, []);
  assert.equal(unbound.dataset.reconciliation.groups.length, 0, "ยังไม่ผูก = จับคู่ไม่ได้");
  assert.equal(unbound.unmappedAccounts.length, 1, "และต้องบอกว่าทำไม");

  const bound = applySettings(dataset, {
    ...DEFAULT_SETTINGS,
    accounts: [{ accountNo: "111-2-33333-4", code: "334", method: "SCB-Main", label: "" }],
  }, []);
  assert.equal(bound.dataset.reconciliation.groups.length, 1, "ผูกแล้วจับคู่ได้ทันที ไม่ต้องอัปโหลดซ้ำ");
  assert.equal(bound.unmappedAccounts.length, 0);
});
