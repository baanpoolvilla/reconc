import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("builds the ClearClose workspace from the generated dataset", async () => {
  const [page, serverBundle] = await Promise.all([read("../app/page.tsx"), read("../dist/server/index.js")]);

  assert.match(page, /from "\.\.\/lib\/dataset"/);
  assert.match(page, /วันที่สร้างคำจอง/);
  assert.match(page, /ผลการจับคู่/);
  assert.match(page, /ข้อยกเว้น/);
  assert.match(page, /AMOUNT_MISMATCH/);
  assert.match(page, /หลักฐานการจับคู่แบบตรวจสอบย้อนกลับได้/);
  assert.doesNotMatch(page, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
  assert.ok(serverBundle.length > 1000);
});

test("carries no hand-written demo rows in the UI", async () => {
  const page = await read("../app/page.tsx");

  // Every figure the UI shows must come from lib/dataset.generated.json.
  assert.doesNotMatch(page, /The Palm Pool Villa|Daniel Wong|สุวรรณา|Trip\.com Travel Singapore/);
  assert.doesNotMatch(page, /RC-2569-|GRP-885-0725|REC-07\d\d-\d+|EX-000\d\d/);
  // "฿0.00" appears in rule copy; any literal amount with thousands would be a hard-coded figure.
  assert.doesNotMatch(page, /฿\d{1,3},\d{3}/);
  assert.doesNotMatch(page, /initialExceptions|initialDocuments|initialInvoices|statementMatches|bookingReconciliations|runRows|audits/);
});

test("keeps product metadata and starter cleanup intact", async () => {
  const [page, layout, packageJson] = await Promise.all([read("../app/page.tsx"), read("../app/layout.tsx"), read("../package.json")]);

  assert.match(page, /ClearClose/);
  assert.match(layout, /og\.png/);
  assert.match(packageJson, /clearclose-reconciliation/);
  assert.match(packageJson, /noto-sans-thai/);
  assert.match(packageJson, /"data:build": "node scripts\/build-dataset\.mjs"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../.openai/hosting.json", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
