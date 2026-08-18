import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { ensureSchema, migrate, resetSchemaCache, schemaSql } from "../lib/db/client.mjs";
import { MIGRATIONS } from "../lib/db/schema.mjs";
import {
  deleteDecision,
  latestDataset,
  listDecisions,
  loadStoredSettings,
  recordDocument,
  replaceBookings,
  replaceReceipts,
  replaceStatement,
  runReconciliation,
  saveDecision,
  saveStoredSettings,
  storedDocuments,
} from "../lib/db/repository.mjs";
import { DEFAULT_SETTINGS } from "../lib/settings-core.mjs";
import { makeDataset } from "./fixtures.mjs";

// PGlite is real Postgres compiled to WASM, so these exercise the exact SQL
// that runs against Neon in production.
async function freshDb() {
  const pg = new PGlite();
  const db = { query: async (sql, params = []) => (await pg.query(sql, params)).rows };
  await migrate(db);
  return db;
}

// เทสต์ชุดนี้เคยอ่านเอกสารบัญชีจริงจาก data/ ตอนนี้ระบบไม่มีเส้นทางนั้นแล้ว —
// ข้อมูลจริงเข้าทางเดียวคืออัปโหลดเข้า Postgres — จึงใช้ชุดข้อมูลสังเคราะห์แทน
// สิ่งที่พิสูจน์ยังเหมือนเดิม: แถวที่เขียนลงฐานข้อมูลอ่านกลับมาแล้วกระทบยอดได้ผลเท่าเดิม
const fixture = makeDataset();

/** เขียนทุกแถวของชุดข้อมูลลงฐานข้อมูล เหมือนที่ endpoint อัปโหลดทำ */
async function loadFixture(db) {
  await replaceBookings(db, fixture.bookings);
  await replaceReceipts(db, fixture.receipts);
  for (const statement of fixture.statements) await replaceStatement(db, statement);
  for (const source of fixture.meta.sources) {
    await recordDocument(db, {
      id: `DOC-${source.kind}`,
      kind: source.kind,
      periods: [source.period],
      name: source.name,
      sha256: "x".repeat(64),
      sizeBytes: 1024,
      rowCount: source.rows,
      uploadedBy: "test",
    });
  }
}

test("the schema applies cleanly to an empty Postgres database", async () => {
  const db = await freshDb();
  const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'clearclose' ORDER BY table_name");

  assert.deepEqual(tables.map((row) => row.table_name), [
    "app_settings", "audit_events", "bank_statements", "bank_transactions", "bookings",
    "document_files", "documents", "match_decisions", "receipts", "reconciliation_runs",
    "schema_migrations",
  ]);
});

test("ทุก migration ถูกบันทึกไว้ และรันซ้ำก็ไม่ทำอะไรเพิ่ม", async () => {
  const db = await freshDb();
  const applied = await db.query("SELECT id FROM clearclose.schema_migrations ORDER BY id");
  assert.deepEqual(applied.map((row) => row.id), MIGRATIONS.map((migration) => migration.id));

  await migrate(db);
  const again = await db.query("SELECT count(*)::int AS total FROM clearclose.schema_migrations");
  assert.equal(again[0].total, MIGRATIONS.length, "รันซ้ำต้องไม่บันทึกซ้ำ");
});

test("ฐานข้อมูลที่สร้างไว้ก่อนมีคอลัมน์งวด ถูกอัปเกรดโดยไม่ต้องอัปโหลดใหม่", async () => {
  // นี่คือเส้นทางของฐานข้อมูลจริงที่ใช้งานอยู่แล้ว: ตารางรุ่นแรกมีข้อมูลอยู่ แต่ยัง
  // ไม่มีคอลัมน์งวด migration ต้องเติมงวดจากวันที่ในแถวเอง ไม่ใช่ล้างแล้วเริ่มใหม่
  const pg = new PGlite();
  const db = { query: async (sql, params = []) => (await pg.query(sql, params)).rows };

  for (const statement of MIGRATIONS[0].sql.split(/;\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    await db.query(`${statement};`);
  }
  await db.query(
    "INSERT INTO clearclose.receipts (id, date, method, amount_satang) VALUES ('RCP-1', '2026-07-04', 'KbankGL987', 1000)",
  );
  await db.query(
    "INSERT INTO clearclose.bank_statements (code, method, cycle) VALUES ('987', 'KbankGL987', '01/07/2026 - 31/07/2026')",
  );
  await db.query(
    "INSERT INTO clearclose.bank_transactions (id, statement_code, date, direction) VALUES ('T-1', '987', '2026-07-04', 'credit')",
  );

  await migrate(db);

  const [receipt] = await db.query("SELECT period FROM clearclose.receipts WHERE id = 'RCP-1'");
  const [statement] = await db.query("SELECT period FROM clearclose.bank_statements WHERE code = '987'");
  const [line] = await db.query("SELECT period, statement_period FROM clearclose.bank_transactions WHERE id = 'T-1'");

  assert.equal(receipt.period, "2026-07", "งวดของรายการรับเงินมาจากวันที่ของตัวเอง");
  assert.equal(statement.period, "2026-07", "งวดของ statement มาจากรอบที่พิมพ์บนเอกสาร");
  assert.equal(line.period, "2026-07");
  assert.equal(line.statement_period, "2026-07", "บรรทัดยังชี้กลับไปที่ statement ฉบับเดิม");
});

test("carries its schema in the bundle instead of reading a file at runtime", async () => {
  // A serverless bundle cannot rely on a sibling .sql file being traced into it,
  // and the bundler's URL polyfill breaks fileURLToPath. Both cost a production
  // outage once already.
  const client = await readFile(new URL("../lib/db/client.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(client, /node:fs|readFileSync|fileURLToPath|import\.meta\.url/);
  assert.match(schemaSql(), /CREATE SCHEMA IF NOT EXISTS clearclose/);
  assert.equal(schemaSql().match(/CREATE TABLE/g).length, 10);
});

test("shares a database safely with tables of the same name", async () => {
  // Pointing DATABASE_URL at an existing Neon database must not touch, read or
  // be confused by another application's tables.
  const pg = new PGlite();
  const db = { query: async (sql, params = []) => (await pg.query(sql, params)).rows };
  await db.query("CREATE TABLE documents (id text primary key, unrelated text)");
  await db.query("INSERT INTO documents (id, unrelated) VALUES ('other-app', 'keep me')");

  await migrate(db);
  await recordDocument(db, { id: "DOC-1", kind: "collection", name: "x.xlsx", sha256: "d".repeat(64), sizeBytes: 1, rowCount: 0, uploadedBy: "test" });

  const [ours] = await db.query("SELECT count(*)::int AS total FROM clearclose.documents");
  const theirs = await db.query("SELECT id, unrelated FROM public.documents");
  assert.equal(ours.total, 1);
  assert.deepEqual(theirs, [{ id: "other-app", unrelated: "keep me" }]);
});

test("migrate is idempotent", async () => {
  const db = await freshDb();
  await migrate(db);
  const [row] = await db.query("SELECT count(*)::int AS total FROM clearclose.documents");
  assert.equal(row.total, 0);
});

test("ensureSchema applies the schema once, and retries after a failure", async () => {
  resetSchemaCache();
  const pg = new PGlite();
  let statements = 0;
  const db = {
    query: async (sql, params = []) => {
      statements += 1;
      return (await pg.query(sql, params)).rows;
    },
  };

  await ensureSchema(db);
  const afterFirst = statements;
  await ensureSchema(db);
  await ensureSchema(db);
  assert.equal(statements, afterFirst, "a warm process must not re-run the schema");

  // A failed attempt must not be cached, or the function stays broken until redeploy.
  resetSchemaCache();
  const broken = { query: async () => { throw new Error("connection reset"); } };
  await assert.rejects(ensureSchema(broken), /connection reset/);
  await ensureSchema(db);
  assert.ok(statements > afterFirst, "the next request retries");
});

test("an upload round-trips through Postgres and reproduces the same reconciliation", async () => {
  const db = await freshDb();
  await loadFixture(db);

  const { dataset } = await runReconciliation(db);

  assert.equal(dataset.bookings.length, fixture.bookings.length);
  assert.equal(dataset.receipts.length, fixture.receipts.length);
  assert.equal(dataset.statements.length, fixture.statements.length);
  // แถวที่เดินทางผ่าน Postgres ต้องกระทบยอดได้ผลเท่ากับที่คำนวณจากแถวในหน่วยความจำ
  assert.equal(dataset.reconciliation.summary.matchedGroups, fixture.reconciliation.summary.matchedGroups);
  assert.equal(dataset.reconciliation.summary.matchedReceipts, fixture.reconciliation.summary.matchedReceipts);
  assert.equal(dataset.reconciliation.summary.exceptionCount, fixture.reconciliation.summary.exceptionCount);
  assert.equal(dataset.reconciliation.summary.matchedSatang, fixture.reconciliation.summary.matchedSatang);
  for (const statement of dataset.statements) assert.equal(statement.controlDeltaSatang, 0);

  const stored = await latestDataset(db);
  assert.equal(stored.reconciliation.summary.matchedGroups, dataset.reconciliation.summary.matchedGroups);
  assert.equal((await storedDocuments(db)).length, 4);
});

test("re-uploading a document replaces its rows instead of doubling them", async () => {
  const db = await freshDb();
  const { receipts } = fixture;

  await replaceReceipts(db, receipts);
  await recordDocument(db, { id: "DOC-1", kind: "collection", periods: ["2026-07"], name: "collection.xlsx", sha256: "a".repeat(64), sizeBytes: 1, rowCount: receipts.length, uploadedBy: "test" });
  await replaceReceipts(db, receipts);
  await recordDocument(db, { id: "DOC-2", kind: "collection", periods: ["2026-07"], name: "collection.xlsx", sha256: "b".repeat(64), sizeBytes: 1, rowCount: receipts.length, uploadedBy: "test" });

  const [stored] = await db.query("SELECT count(*)::int AS total FROM clearclose.receipts");
  const [documents] = await db.query("SELECT count(*)::int AS total FROM clearclose.documents");
  assert.equal(stored.total, receipts.length);
  assert.equal(documents.total, 1, "one row per document kind per period");
});

test("a partial upload still reconciles what it can", async () => {
  const db = await freshDb();
  const parsed = { receipts: fixture.receipts };

  await replaceReceipts(db, parsed.receipts);
  await recordDocument(db, { id: "DOC-1", kind: "collection", periods: ["2026-07"], name: "collection.xlsx", sha256: "c".repeat(64), sizeBytes: 1, rowCount: parsed.receipts.length, uploadedBy: "test" });
  const { dataset } = await runReconciliation(db);

  // No ledger and no statements yet, so nothing can satisfy the date rule.
  assert.equal(dataset.receipts.length, parsed.receipts.length);
  assert.equal(dataset.statements.length, 0);
  assert.equal(dataset.reconciliation.summary.matchedGroups, 0);
  assert.equal(dataset.reconciliation.summary.inScopeReceipts, 0);
});

// ── การตั้งค่าและการตัดสินใจที่เก็บบนเซิร์ฟเวอร์ ────────────────────────────

test("การตั้งค่าเก็บได้หนึ่งชุด อ่านกลับมาได้เหมือนเดิม และเก็บของเก่าไว้ใน audit", async () => {
  const db = await freshDb();
  assert.equal(await loadStoredSettings(db), null, "ยังไม่เคยตั้งค่า ต้องได้ null ไม่ใช่ค่ามั่ว");

  await saveStoredSettings(db, DEFAULT_SETTINGS);
  assert.deepEqual(await loadStoredSettings(db), DEFAULT_SETTINGS);

  const changed = { ...DEFAULT_SETTINGS, settlement: { ...DEFAULT_SETTINGS.settlement, windowDays: 14 } };
  await saveStoredSettings(db, changed);
  assert.equal((await loadStoredSettings(db)).settlement.windowDays, 14);

  const [rows] = await db.query("SELECT count(*)::int AS total FROM clearclose.app_settings");
  assert.equal(rows.total, 1, "ต้องมีแถวเดียวเสมอ");
  const audit = await db.query("SELECT detail FROM clearclose.audit_events WHERE action = 'SETTINGS_SAVED' ORDER BY id");
  assert.equal(audit.length, 2);
  assert.equal(JSON.parse(audit[1].detail).previous.settlement.windowDays, DEFAULT_SETTINGS.settlement.windowDays);
});

test("การตัดสินใจของผู้ตรวจอยู่รอดการอัปโหลดเอกสารทับ", async () => {
  const db = await freshDb();
  const parsed = { receipts: fixture.receipts };

  await replaceReceipts(db, parsed.receipts);
  await recordDocument(db, { id: "DOC-1", kind: "collection", periods: ["2026-07"], name: "collection.xlsx", sha256: "e".repeat(64), sizeBytes: 1, rowCount: parsed.receipts.length, uploadedBy: "test" });

  const saved = await saveDecision(db, {
    kind: "MANUAL",
    receiptIds: [parsed.receipts[0].id],
    bankLineIds: ["TXN-987-0001"],
    receiptSatang: parsed.receipts[0].amountSatang,
    bankSatang: parsed.receipts[0].amountSatang - 500,
    differenceSatang: 500,
    reason: "BANK_FEE",
    note: "ค่าธรรมเนียมโอน",
  });
  assert.ok(saved.id, "ต้องได้รหัสกลับมาเสมอ");

  // อัปโหลดรายงานการรับเงินทับของเดิม — replaceReceipts ลบแถวเก่าทิ้งทั้งหมด
  await replaceReceipts(db, parsed.receipts);

  const decisions = await listDecisions(db);
  assert.equal(decisions.length, 1, "อัปโหลดทับต้องไม่ลบสิ่งที่คนตัดสินใจไว้");
  assert.deepEqual(decisions[0].receiptIds, [parsed.receipts[0].id]);
  assert.equal(decisions[0].differenceSatang, 500);
  assert.equal(decisions[0].reason, "BANK_FEE");
  assert.equal(decisions[0].note, "ค่าธรรมเนียมโอน");

  // ยกเลิกแล้วต้องหายจริง และมีร่องรอยว่าใครลบ
  const removed = await deleteDecision(db, saved.id);
  assert.equal(removed.id, saved.id);
  assert.equal((await listDecisions(db)).length, 0);
  assert.equal(await deleteDecision(db, saved.id), null, "ลบซ้ำต้องไม่ระเบิด");

  const audit = await db.query("SELECT action FROM clearclose.audit_events WHERE entity_type = 'decision' ORDER BY id");
  assert.deepEqual(audit.map((row) => row.action), ["DECISION_SAVED", "DECISION_REMOVED"]);
});

test("ไฟล์ที่อ่านไม่ได้ต้องไม่ทิ้งแถวของไฟล์ที่อ่านได้ค้างไว้", async () => {
  // บั๊กที่เคยมี: endpoint อ่านและเขียนสลับกันทีละไฟล์ ไฟล์ที่สองอ่านไม่ผ่านจึงตอบ
  // 400 ทิ้งแถวของไฟล์แรกไว้ในฐานข้อมูลโดยไม่มีการกระทบยอดตามหลัง ฐานข้อมูลจึงอยู่
  // ในสถานะที่หน้าจอไม่เคยบอก การอ่านทุกไฟล์ให้จบก่อนเขียนทำให้กรณีนี้เป็นไปไม่ได้
  const route = await readFile(new URL("../app/api/upload/route.ts", import.meta.url), "utf8");

  const parseAt = route.indexOf("parseDocument(kind");
  const writeAt = route.indexOf("replaceBookings(db");
  assert.ok(parseAt > 0 && writeAt > 0);
  assert.ok(parseAt < writeAt, "ต้องอ่านให้ครบก่อนจึงเริ่มเขียน");

  // และการเขียนต้องไม่มี early return คั่นกลาง ที่จะทิ้งงานค้างไว้ครึ่งทาง
  const writePhase = route.slice(writeAt, route.indexOf("runReconciliation(db)"));
  assert.doesNotMatch(writePhase, /return Response\.json/, "เริ่มเขียนแล้วต้องเดินจนจบและกระทบยอดเสมอ");
});
