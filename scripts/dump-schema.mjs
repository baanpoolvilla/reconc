import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MIGRATIONS } from "../lib/db/schema.mjs";

// เขียน schema ออกมาเป็นไฟล์ .sql
//
//   node scripts/dump-schema.mjs
//
// ตัวระบบไม่เคยอ่านไฟล์เหล่านี้ และต้องไม่อ่าน — schema ตัวจริงอยู่ใน
// lib/db/schema.mjs เพราะมันถูก bundle เข้า serverless function ที่อ่านไฟล์
// ข้าง ๆ ตอน runtime ไม่ได้ (เคยทำให้ production ล่มมาแล้ว)
//
// ไฟล์ชุดนี้มีไว้ให้คนอ่านและให้คนเอาไปวางใน SQL editor เอง เช่นตอนอยากรัน
// migration ล่วงหน้าก่อนเปิดเว็บ หรือตอนตรวจว่าตารางบนฐานข้อมูลจริงหน้าตาตรงกับ
// ที่โค้ดคาดไว้ไหม มันถูกสร้างจาก MIGRATIONS ชุดเดียวกับที่ระบบรันจริงเสมอ จึง
// ไม่มีทางเป็นคนละอย่างกัน — และมีเทสต์คอยจับว่าลืม generate ใหม่หรือเปล่า

const outDir = fileURLToPath(new URL("../schema/", import.meta.url));

/** หัวไฟล์ที่บอกว่าไฟล์นี้ถูกสร้างขึ้น ไม่ใช่ไฟล์ที่แก้แล้วมีผล */
export function sqlFileFor(migration) {
  return [
    "-- ไฟล์นี้ถูกสร้างจาก lib/db/schema.mjs — อย่าแก้ตรงนี้",
    "-- แก้ที่ schema.mjs แล้วสั่ง: npm run schema",
    "--",
    `-- migration: ${migration.id}`,
    "--",
    "-- ระบบรัน migration ให้เองตอนมีคำขอแรกเข้ามา ไฟล์นี้มีไว้ให้รันเองล่วงหน้า",
    "-- หรือเอาไปตรวจเทียบกับฐานข้อมูลจริง รันซ้ำได้ไม่เสียหาย ทุกคำสั่งเป็น IF NOT EXISTS",
    "",
    migration.sql.trim(),
    "",
    "-- บันทึกว่า migration นี้ถูกรันแล้ว ตัวรันในระบบทำบรรทัดนี้ให้เองเสมอ",
    "-- ถ้ารันไฟล์นี้เองต้องรันบรรทัดนี้ด้วย ไม่งั้นระบบจะรันซ้ำ (ซึ่งไม่เสียหาย แต่ไม่จำเป็น)",
    "INSERT INTO clearclose.schema_migrations (id, applied_at)",
    `VALUES ('${migration.id}', to_char(now() + interval '7 hours', 'YYYY-MM-DD\"T\"HH24:MI:SS'))`,
    "ON CONFLICT (id) DO NOTHING;",
    "",
  ].join("\n");
}

/** ไฟล์รวมสำหรับฐานข้อมูลเปล่า — ลำดับเดียวกับที่ตัวรันไล่ */
export function fullSqlFile(migrations) {
  return [
    "-- ไฟล์นี้ถูกสร้างจาก lib/db/schema.mjs — อย่าแก้ตรงนี้",
    "-- แก้ที่ schema.mjs แล้วสั่ง: npm run schema",
    "--",
    "-- schema ทั้งหมดเรียงตามลำดับที่ตัวรันไล่ ใช้กับฐานข้อมูลเปล่าได้ทันที",
    "-- ฐานข้อมูลที่มีข้อมูลอยู่แล้วก็รันได้ ทุกคำสั่งเป็น IF NOT EXISTS",
    "",
    "CREATE SCHEMA IF NOT EXISTS clearclose;",
    "",
    "CREATE TABLE IF NOT EXISTS clearclose.schema_migrations (",
    "  id          text PRIMARY KEY,",
    "  applied_at  text NOT NULL",
    ");",
    "",
    ...migrations.flatMap((migration) => [
      `-- ── ${migration.id} ${"─".repeat(Math.max(0, 60 - migration.id.length))}`,
      "",
      migration.sql.trim(),
      "",
      "INSERT INTO clearclose.schema_migrations (id, applied_at)",
      `VALUES ('${migration.id}', to_char(now() + interval '7 hours', 'YYYY-MM-DD\"T\"HH24:MI:SS'))`,
      "ON CONFLICT (id) DO NOTHING;",
      "",
    ]),
  ].join("\n");
}

export function schemaFiles(migrations = MIGRATIONS) {
  return [
    ...migrations.map((migration) => ({ name: `${migration.id}.sql`, body: sqlFileFor(migration) })),
    { name: "full.sql", body: fullSqlFile(migrations) },
  ];
}

const isMain = process.argv[1]?.endsWith("dump-schema.mjs");
if (isMain) {
  mkdirSync(outDir, { recursive: true });
  for (const file of schemaFiles()) {
    writeFileSync(`${outDir}${file.name}`, file.body, "utf8");
    console.log(`เขียน schema/${file.name}`);
  }
  console.log(`\n${MIGRATIONS.length} migration · ตรวจว่าตรงกับโค้ดด้วย: node --test tests/schema-files.test.mjs`);
}
