import { RULESET_VERSION, reconcile } from "./reconciliation.mjs";
import { DOCUMENT_KINDS } from "./parsers/documents.mjs";
import { periodOf, periodsOf, statementPeriod } from "./periods.mjs";

// Assembles canonical rows into the single shape the UI reads, whether the rows
// came from data/ at build time or from the database at request time.

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

/** Every statement carries the period printed on it, not the month it was uploaded. */
const withPeriod = (statement) => ({ ...statement, period: statement.period || statementPeriod(statement) });

/**
 * The dataset, from rows that already carry no document structure.
 *
 * @param {object} input
 * @param {Array}  input.bookings
 * @param {Array}  input.receipts
 * @param {Array}  input.statements
 * @param {Array}  input.sources เอกสารที่ข้อมูลชุดนี้มาจาก ใช้แสดงผลอย่างเดียว
 */
export function assembleDataset({ bookings = [], receipts = [], statements = [], sources = [] }) {
  const dated = statements.map(withPeriod);

  // ทุกงวดที่ข้อมูลชุดนี้แตะ เรียงจากเก่าไปใหม่ — หน้าจอใช้ตัวนี้ทำตัวกรองงวด
  const periods = periodsOf([
    ...receipts.map((receipt) => receipt.date),
    ...bookings.map((booking) => booking.createdDate),
    ...dated.flatMap((statement) => statement.lines.map((line) => line.date)),
  ]);

  const core = {
    meta: {
      generatedAt: bangkokNow(),
      // งวดล่าสุดที่มีข้อมูล คือค่าที่หน้าจอเปิดมาแล้วเห็นก่อน
      period: periods.at(-1) ?? "",
      periods,
      rulesetVersion: RULESET_VERSION,
      sources,
    },
    bookings,
    receipts,
    statements: dated.sort((a, b) => a.code.localeCompare(b.code) || String(a.period).localeCompare(String(b.period))),
  };

  return { ...core, reconciliation: reconcile(core) };
}

/**
 * The dataset, from parsed documents — the shape `npm run data:build` produces.
 *
 * @param {Array<{kind: string, name: string, bookings?: Array, receipts?: Array, statement?: object}>} documents
 */
export function buildDataset(documents) {
  const statements = documents.filter((document) => document.statement).map((document) => withPeriod(document.statement));

  return assembleDataset({
    bookings: documents.flatMap((document) => document.bookings ?? []),
    receipts: documents.flatMap((document) => document.receipts ?? []),
    statements,
    sources: documents.map((document) => {
      const rows = document.bookings ?? document.receipts ?? document.statement?.lines ?? [];
      const periods = periodsOf(
        (document.bookings ?? []).map((booking) => booking.createdDate)
          .concat((document.receipts ?? []).map((receipt) => receipt.date))
          .concat((document.statement?.lines ?? []).map((line) => line.date)),
      );
      return {
        kind: sourceKindNames[document.kind] ?? document.kind,
        label: DOCUMENT_KINDS[document.kind]?.label ?? document.kind,
        name: document.name,
        rows: rows.length,
        period: document.statement ? statementPeriod(document.statement) : (periods[0] ?? ""),
        periodStart: periods[0] ?? "",
        periodEnd: periods.at(-1) ?? "",
      };
    }),
  });
}

/** งวดของแถวหนึ่งแถว ใช้ตอนเขียนลงฐานข้อมูล */
export { periodOf };
