import { reconcile } from "./reconciliation.mjs";
import { DOCUMENT_KINDS } from "./parsers/documents.mjs";

// Assembles parsed documents into the single shape the UI reads, whether the
// documents came from data/ at build time or from an upload at runtime.

/** Asia/Bangkok local time, so it reads like every timestamp in the sources. */
export function bangkokNow() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace("Z", "");
}

const sourceKindNames = {
  ledger: "ledger",
  collection: "collection_report",
  statement885: "bank_statement_885",
  statement987: "bank_statement_987",
};

/**
 * @param {Array<{kind: string, name: string, bookings?: Array, receipts?: Array, statement?: object}>} documents
 */
export function buildDataset(documents) {
  const bookings = documents.flatMap((document) => document.bookings ?? []);
  const receipts = documents.flatMap((document) => document.receipts ?? []);
  const statements = documents.filter((document) => document.statement).map((document) => document.statement);

  const core = {
    meta: {
      generatedAt: bangkokNow(),
      period: receipts.map((receipt) => receipt.date).sort()[0]?.slice(0, 7) ?? "",
      rulesetVersion: "2.0.0",
      sources: documents.map((document) => ({
        kind: sourceKindNames[document.kind] ?? document.kind,
        label: DOCUMENT_KINDS[document.kind]?.label ?? document.kind,
        name: document.name,
        rows: document.bookings?.length ?? document.receipts?.length ?? document.statement?.lines.length ?? 0,
      })),
    },
    bookings,
    receipts,
    statements: statements.sort((a, b) => a.code.localeCompare(b.code)),
  };

  return { ...core, reconciliation: reconcile(core) };
}
