import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the page is a server component that resolves its own data source", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /loadDataset/);
  assert.match(page, /<Workspace/);
  // Rendered per request so a web upload is visible immediately.
  assert.match(page, /export const dynamic = "force-dynamic"/);
  await access(new URL("../.next/BUILD_ID", import.meta.url));
});

test("the matching view explains which amount matched which, and why", async () => {
  const workspace = await read("../app/workspace.tsx");

  // Both rules, with the values that were actually compared.
  assert.match(workspace, /group\.rulesPassed\.map/);
  assert.match(workspace, /rule-check-mark/);
  // The arithmetic, both sides itemised, and the provenance of each row.
  assert.match(workspace, /equation-block/);
  assert.match(workspace, /ฝั่งรายการรับเงิน/);
  assert.match(workspace, /ฝั่งเงินเข้าธนาคาร/);
  assert.match(workspace, /หน้า \{line\.page\} · บรรทัด \{line\.row\}/);
  assert.match(workspace, /row \{receipt\.sourceRow\}/);
  assert.match(workspace, /balanceBeforeSatang/);
  // What the payment means for the booking it belongs to.
  assert.match(workspace, /ผลต่อคำจอง/);
  assert.match(workspace, /bookingBalanceDueSatang/);
});

test("the ledger reads like a spreadsheet and rings each amount by outcome", async () => {
  const [workspace, css] = await Promise.all([read("../app/workspace.tsx"), read("../app/globals.css")]);

  // Every column the reviewer asked to see, keyed on the receipt line.
  for (const column of ["วันจอง", "เลขที่จอง", "บ้านพัก / รหัสบ้าน", "ผู้จอง", "ช่องทางติดต่อ", "รายการเงิน", "ยอดจองรวม", "จ่ายจริง", "ยังไม่จ่าย"]) {
    assert.ok(workspace.includes(`<th>${column}</th>`) || workspace.includes(`<th className="num">${column}</th>`), `ledger is missing the ${column} column`);
  }
  assert.match(workspace, /amount-ring \$\{row\.status\}/);
  assert.match(css, /\.amount-ring\.matched \{[^}]*border-color: var\(--green\)/);
  assert.match(css, /\.amount-ring\.exception \{[^}]*border-color: var\(--red\)/);
  // A border shorthand on the legend would out-specify the ring colours.
  assert.doesNotMatch(css, /\.ledger-legend i, \.foot-split i \{[^}]*border: /);
  // Payments of one booking read as a block, the way merged cells do.
  assert.match(workspace, /firstOfBooking/);
  assert.match(workspace, /exportCsv/);
});

test("carries no hand-written demo rows in the UI", async () => {
  const workspace = await read("../app/workspace.tsx");

  assert.doesNotMatch(workspace, /The Palm Pool Villa|Daniel Wong|สุวรรณา|Trip\.com Travel Singapore/);
  assert.doesNotMatch(workspace, /RC-2569-|GRP-885-0725|REC-07\d\d-\d+|EX-000\d\d/);
  // "฿0.00" appears in rule copy; any literal amount with thousands would be a hard-coded figure.
  assert.doesNotMatch(workspace, /฿\d{1,3},\d{3}/);
  assert.doesNotMatch(workspace, /initialExceptions|initialDocuments|initialInvoices|statementMatches|bookingReconciliations|runRows|audits/);
});

test("deploys and runs before any source document is loaded", async () => {
  const [workspace, builder] = await Promise.all([read("../app/workspace.tsx"), read("../scripts/build-dataset.mjs")]);

  // An empty data/ must produce an empty dataset, not a failed build …
  assert.match(builder, /missing\.length === found\.length/);
  assert.match(builder, /buildDataset\(\[\]\)/);
  // … a partly filled one must still fail loudly.
  assert.match(builder, /มีเอกสารไม่ครบ/);
  // … and the UI must swap in a status screen instead of a wall of zeros.
  assert.match(workspace, /const hasData = meta\.sources\.length > 0/);
  assert.match(workspace, /!hasData && active !== "upload" && active !== "rules" && <NoSourceDocuments/);
});

test("uploading requires a database and says so when there is none", async () => {
  const [route, workspace] = await Promise.all([read("../app/api/upload/route.ts"), read("../app/workspace.tsx")]);

  assert.match(route, /if \(!process\.env\.DATABASE_URL\)/);
  assert.match(route, /status: 503/);
  assert.match(route, /detectDocumentKind/);
  assert.match(route, /runReconciliation/);
  assert.match(workspace, /DATABASE_URL/);
});

test("builds as a plain Next.js app that Vercel can deploy", async () => {
  const packageJson = JSON.parse(await read("../package.json"));

  assert.equal(packageJson.scripts.build, "npm run data:build && next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.ok(packageJson.dependencies.next, "next must be a runtime dependency");
  assert.ok(packageJson.dependencies["@neondatabase/serverless"], "the Neon driver ships to production");

  const everyDependency = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const name of ["vinext", "wrangler", "@cloudflare/vite-plugin", "drizzle-orm", "drizzle-kit"]) {
    assert.equal(everyDependency[name], undefined, `${name} must not be a dependency any more`);
  }
  await assert.rejects(access(new URL("../vite.config.ts", import.meta.url)));
  await assert.rejects(access(new URL("../worker/index.ts", import.meta.url)));
});

test("keeps product metadata and starter cleanup intact", async () => {
  const [workspace, layout, packageJson] = await Promise.all([read("../app/workspace.tsx"), read("../app/layout.tsx"), read("../package.json")]);

  assert.match(workspace, /ClearClose/);
  assert.match(layout, /og\.png/);
  assert.match(layout, /VERCEL_PROJECT_PRODUCTION_URL/);
  assert.match(packageJson, /clearclose-reconciliation/);
  await access(new URL("../public/og.png", import.meta.url));
});
