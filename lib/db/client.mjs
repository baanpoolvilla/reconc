import { SCHEMA_SQL } from "./schema.mjs";

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

export async function migrate(db) {
  // PGlite runs one statement per call; Neon accepts the whole script but
  // splitting keeps both paths identical and the failure messages precise.
  for (const statement of schemaSql().split(/;\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    await db.query(`${statement};`);
  }
}
