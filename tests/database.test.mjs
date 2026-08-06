import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../lib/db/client.mjs";
import {
  latestDataset,
  recordDocument,
  replaceBookings,
  replaceReceipts,
  replaceStatement,
  runReconciliation,
  storedDocuments,
} from "../lib/db/repository.mjs";
import { DOCUMENT_KINDS, parseDocument } from "../lib/parsers/documents.mjs";

// PGlite is real Postgres compiled to WASM, so these exercise the exact SQL
// that runs against Neon in production.
async function freshDb() {
  const pg = new PGlite();
  const db = { query: async (sql, params = []) => (await pg.query(sql, params)).rows };
  await migrate(db);
  return db;
}

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const files = readdirSync(dataDir);

function loadSource(kind) {
  const name = files.find(DOCUMENT_KINDS[kind].matches);
  return { name, buffer: readFileSync(`${dataDir}${name}`) };
}

test("the schema applies cleanly to an empty Postgres database", async () => {
  const db = await freshDb();
  const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");

  assert.deepEqual(tables.map((row) => row.table_name), [
    "audit_events", "bank_statements", "bank_transactions", "bookings", "documents", "receipts", "reconciliation_runs",
  ]);
});

test("migrate is idempotent", async () => {
  const db = await freshDb();
  await migrate(db);
  const [row] = await db.query("SELECT count(*)::int AS total FROM documents");
  assert.equal(row.total, 0);
});

test("an upload round-trips through Postgres and reproduces the same reconciliation", async () => {
  const db = await freshDb();

  for (const kind of Object.keys(DOCUMENT_KINDS)) {
    const { name, buffer } = loadSource(kind);
    const parsed = parseDocument(kind, buffer, name);
    if (parsed.bookings) await replaceBookings(db, parsed.bookings);
    if (parsed.receipts) await replaceReceipts(db, parsed.receipts);
    if (parsed.statement) await replaceStatement(db, parsed.statement);
    await recordDocument(db, {
      id: `DOC-${kind}`, kind, name, sha256: "x".repeat(64), sizeBytes: buffer.length,
      rowCount: parsed.bookings?.length ?? parsed.receipts?.length ?? parsed.statement.lines.length,
      uploadedBy: "test",
    });
  }

  const { dataset } = await runReconciliation(db);
  const fromFiles = JSON.parse(readFileSync(new URL("../lib/dataset.generated.json", import.meta.url), "utf8"));

  assert.equal(dataset.bookings.length, fromFiles.bookings.length);
  assert.equal(dataset.receipts.length, fromFiles.receipts.length);
  assert.equal(dataset.statements.length, fromFiles.statements.length);
  // The stored rows must reconcile to exactly what the build-time pipeline found.
  assert.equal(dataset.reconciliation.summary.matchedGroups, fromFiles.reconciliation.summary.matchedGroups);
  assert.equal(dataset.reconciliation.summary.matchedReceipts, fromFiles.reconciliation.summary.matchedReceipts);
  assert.equal(dataset.reconciliation.summary.exceptionCount, fromFiles.reconciliation.summary.exceptionCount);
  for (const statement of dataset.statements) assert.equal(statement.controlDeltaSatang, 0);

  const stored = await latestDataset(db);
  assert.equal(stored.reconciliation.summary.matchedGroups, dataset.reconciliation.summary.matchedGroups);
  assert.equal((await storedDocuments(db)).length, 4);
});

test("re-uploading a document replaces its rows instead of doubling them", async () => {
  const db = await freshDb();
  const { name, buffer } = loadSource("collection");
  const parsed = parseDocument("collection", buffer, name);

  await replaceReceipts(db, parsed.receipts);
  await recordDocument(db, { id: "DOC-1", kind: "collection", name, sha256: "a".repeat(64), sizeBytes: 1, rowCount: parsed.receipts.length, uploadedBy: "test" });
  await replaceReceipts(db, parsed.receipts);
  await recordDocument(db, { id: "DOC-2", kind: "collection", name, sha256: "b".repeat(64), sizeBytes: 1, rowCount: parsed.receipts.length, uploadedBy: "test" });

  const [receipts] = await db.query("SELECT count(*)::int AS total FROM receipts");
  const [documents] = await db.query("SELECT count(*)::int AS total FROM documents");
  assert.equal(receipts.total, parsed.receipts.length);
  assert.equal(documents.total, 1, "one row per document kind");
});

test("a partial upload still reconciles what it can", async () => {
  const db = await freshDb();
  const { name, buffer } = loadSource("collection");
  const parsed = parseDocument("collection", buffer, name);

  await replaceReceipts(db, parsed.receipts);
  await recordDocument(db, { id: "DOC-1", kind: "collection", name, sha256: "c".repeat(64), sizeBytes: 1, rowCount: parsed.receipts.length, uploadedBy: "test" });
  const { dataset } = await runReconciliation(db);

  // No ledger and no statements yet, so nothing can satisfy the date rule.
  assert.equal(dataset.receipts.length, parsed.receipts.length);
  assert.equal(dataset.statements.length, 0);
  assert.equal(dataset.reconciliation.summary.matchedGroups, 0);
  assert.equal(dataset.reconciliation.summary.inScopeReceipts, 0);
});
