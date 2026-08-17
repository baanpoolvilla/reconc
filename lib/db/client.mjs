import { MIGRATIONS, SCHEMA_SQL } from "./schema.mjs";

// One tiny query interface, two backends: Neon over HTTP in production and
// PGlite in tests. Everything above this file writes plain parameterised SQL,
// so the tests exercise the same statements that run against Neon.

let cached = null;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

/** @returns {Promise<{query: (sql: string, params?: unknown[]) => Promise<any[]>}>} */
export async function getDb() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  cached = { query: (text, params = []) => sql.query(text, params) };
  return cached;
}

/** Test seam: swap in PGlite or any other { query } implementation. */
export function setDb(client) {
  cached = client;
}

export function resetDb() {
  cached = null;
}

export function schemaSql() {
  return SCHEMA_SQL;
}

/** PGlite runs one statement per call, so every path splits the same way. */
const statementsIn = (sql) => sql.split(/;\s*\n/).map((part) => part.trim()).filter(Boolean);

async function ensureLedger(db) {
  await db.query("CREATE SCHEMA IF NOT EXISTS clearclose;");
  await db.query(
    "CREATE TABLE IF NOT EXISTS clearclose.schema_migrations (id text PRIMARY KEY, applied_at text NOT NULL);",
  );
}

/**
 * Applies every migration the database has not seen yet, in order.
 *
 * A database created before the ledger existed simply gets 001 applied to it:
 * every statement in it is IF NOT EXISTS, so it is a no-op that records the
 * truth. Later migrations then upgrade the tables in place — a month already
 * loaded is never asked to be uploaded again.
 */
export async function migrate(db) {
  await ensureLedger(db);
  const applied = new Set(
    (await db.query("SELECT id FROM clearclose.schema_migrations")).map((row) => row.id),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // Splitting keeps the Neon and PGlite paths identical and, when something
    // is wrong, points at the one statement that failed instead of the script.
    for (const statement of statementsIn(migration.sql)) await db.query(`${statement};`);
    await db.query(
      "INSERT INTO clearclose.schema_migrations (id, applied_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [migration.id, new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace("Z", "")],
    );
  }
}

let migrated = null;

/**
 * Applies the schema at most once per process. Every page render used to pay
 * for fourteen round trips to a database on the other side of the network;
 * a warm function now pays for them once.
 */
export async function ensureSchema(db) {
  if (!migrated) {
    migrated = migrate(db).catch((error) => {
      migrated = null; // let the next request retry rather than cache the failure
      throw error;
    });
  }
  return migrated;
}

/** Test seam: forget that the schema was applied. */
export function resetSchemaCache() {
  migrated = null;
}
