import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWorkbook } from "../scripts/lib/xlsx.mjs";
import { parseStatementPdf } from "../scripts/lib/statement.mjs";

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const files = readdirSync(dataDir);
const find = (predicate) => `${dataDir}${files.find(predicate)}`;

test("data/ holds the four source documents the pipeline expects", () => {
  assert.ok(files.some((file) => file.startsWith("885") && file.endsWith(".pdf")), "missing statement 885 PDF");
  assert.ok(files.some((file) => file.startsWith("987") && file.endsWith(".pdf")), "missing statement 987 PDF");
  assert.ok(files.some((file) => file.includes("บัญชีแยกประเภท") && file.endsWith(".xlsx")), "missing ledger workbook");
  assert.ok(files.some((file) => file.includes("รายงานการรับเงิน") && file.endsWith(".xlsx")), "missing collection report");
});

test("the ledger workbook exposes the booking creation time column", () => {
  const [sheet] = readWorkbook(find((file) => file.includes("บัญชีแยกประเภท") && file.endsWith(".xlsx")));
  const header = sheet.rows.find((row) => row.includes("Reservation Creation Time"));

  assert.ok(header, "ledger header row not found");
  assert.equal(header[1], "Reservation Creation Time");
  assert.equal(header[3], "PMS Reservation No.");
  assert.ok(sheet.rows.length > 100);
});

test("the collection report exposes date, method, amount and reservation columns", () => {
  const [sheet] = readWorkbook(find((file) => file.includes("รายงานการรับเงิน") && file.endsWith(".xlsx")));
  const header = sheet.rows.find((row) => row[0] === "Date");

  assert.deepEqual(header.slice(0, 5), ["Date", "Item", "Payment Method", "Amount", "Reservation Number"]);
  assert.ok(sheet.rows.length > 100);
});

// Expected counts come from the summary KBank prints on page 1 of each statement.
// The account numbers themselves are deliberately not asserted here — they are
// customer data and this file is committed; the format check below is enough.
for (const [prefix, credits, debits] of [["885", 51, 1], ["987", 110, 12]]) {
  test(`statement ${prefix} parses and its control total balances`, () => {
    const statement = parseStatementPdf(find((file) => file.startsWith(prefix) && file.endsWith(".pdf")));

    assert.match(statement.accountNo, /^\d{3}-\d-\d{5}-\d$/, "account number was not parsed");
    assert.equal(statement.creditCount, credits, "credit count disagrees with the PDF summary");
    assert.equal(statement.debitCount, debits, "debit count disagrees with the PDF summary");
    // opening + credits − debits must land exactly on the printed closing balance.
    assert.equal(statement.controlDeltaSatang, 0);
    assert.ok(statement.lines.every((line) => /^\d{4}-\d{2}-\d{2}$/.test(line.date)));
    assert.ok(statement.lines.every((line) => Number.isInteger(line.amountSatang)));
  });
}

test("the generated dataset is in sync with data/", () => {
  const dataset = JSON.parse(readFileSync(new URL("../lib/dataset.generated.json", import.meta.url), "utf8"));
  const names = new Set(dataset.meta.sources.map((source) => source.name));

  for (const name of names) assert.ok(files.includes(name), `${name} is referenced by the dataset but missing from data/`);
  assert.equal(dataset.meta.sources.length, 4);
  assert.ok(dataset.bookings.length > 0 && dataset.receipts.length > 0);
});
