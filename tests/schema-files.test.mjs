import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import { MIGRATIONS } from "../lib/db/schema.mjs";
import { schemaFiles } from "../scripts/dump-schema.mjs";

// ไฟล์ .sql ที่เอาไปวางใน SQL editor ได้เอง
//
// ระบบไม่เคยอ่านไฟล์เหล่านี้ ตัว schema จริงอยู่ใน lib/db/schema.mjs เพราะมันถูก
// bundle เข้า serverless function ที่อ่านไฟล์ข้าง ๆ ตอน runtime ไม่ได้
//
// สิ่งที่อันตรายของไฟล์ที่ถูก generate คือมันเก่าได้โดยไม่มีใครรู้ แล้วคนก็เอาไป
// รันบนฐานข้อมูลจริง เทสต์ชุดนี้จึงมีหน้าที่เดียว: ไฟล์ในโฟลเดอร์ schema/ ต้อง
// ตรงกับ MIGRATIONS ที่ระบบรันจริง ณ วินาทีนี้เสมอ

const dir = fileURLToPath(new URL("../schema/", import.meta.url));
const read = (name) => readFile(`${dir}${name}`, "utf8");

test("ไฟล์ใน schema/ ตรงกับ MIGRATIONS ที่ระบบรันจริง", async () => {
  for (const file of schemaFiles()) {
    const onDisk = await read(file.name).catch(() => null);
    assert.ok(onDisk !== null, `ไม่มี schema/${file.name} — สั่ง npm run schema`);
    assert.equal(onDisk, file.body, `schema/${file.name} เก่าแล้ว — สั่ง npm run schema`);
  }
});

test("ไม่มีไฟล์ .sql ที่ค้างอยู่จาก migration ที่ถูกลบไปแล้ว", async () => {
  const expected = new Set(schemaFiles().map((file) => file.name));
  const actual = (await readdir(dir)).filter((name) => name.endsWith(".sql"));

  for (const name of actual) {
    assert.ok(expected.has(name), `schema/${name} ไม่ตรงกับ migration ไหนเลย — ลบทิ้งหรือสั่ง npm run schema`);
  }
  assert.equal(actual.length, expected.size);
});

test("ทุก migration มีไฟล์ของตัวเอง และมีไฟล์รวมหนึ่งไฟล์", () => {
  const names = schemaFiles().map((file) => file.name);
  for (const migration of MIGRATIONS) assert.ok(names.includes(`${migration.id}.sql`));
  assert.ok(names.includes("full.sql"));
});

test("full.sql รันบนฐานข้อมูลเปล่าแล้วได้ตารางครบเหมือนที่ตัวรันสร้าง", async () => {
  // ถ้าไฟล์ที่แจกให้คนเอาไปรันเอง สร้างฐานข้อมูลคนละหน้าตากับที่ระบบสร้าง คนที่
  // รันมันจะเจอ error ตอนใช้งานจริง ไม่ใช่ตอนรัน — เทสต์นี้พิสูจน์ว่าไม่เป็นแบบนั้น
  const pg = new PGlite();
  const sql = await read("full.sql");

  for (const statement of sql.split(/;\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    await pg.query(`${statement.replace(/;$/, "")};`);
  }

  const tables = await pg.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'clearclose' ORDER BY table_name",
  );
  assert.deepEqual(tables.rows.map((row) => row.table_name), [
    "app_settings", "audit_events", "bank_statements", "bank_transactions", "bookings",
    "document_files", "documents", "issued_receipts", "match_decisions", "receipts",
    "reconciliation_runs", "schema_migrations",
  ]);

  // และต้องบันทึกไว้ว่ารัน migration ไหนไปแล้วบ้าง ไม่งั้นตัวรันในระบบจะรันซ้ำทั้งชุด
  const applied = await pg.query("SELECT id FROM clearclose.schema_migrations ORDER BY id");
  assert.deepEqual(applied.rows.map((row) => row.id), MIGRATIONS.map((migration) => migration.id));
});
