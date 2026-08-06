import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const dataset = JSON.parse(await read("../lib/dataset.generated.json"));

test("prerenders the dashboard with figures taken from data/", async () => {
  // `/` is statically generated, so the shipped HTML must already hold the
  // numbers the pipeline derived — no client fetch, no placeholder state.
  // React marks expression boundaries with <!-- --> in server HTML; drop them
  // so assertions can match the text a reader actually sees.
  const html = (await read("../.next/server/app/index.html")).replaceAll("<!-- -->", "");
  const { summary } = dataset.reconciliation;

  assert.match(html, /ภาพรวมการกระทบยอด/);
  assert.match(html, /วันที่สร้างคำจอง/);
  assert.ok(html.includes(`${summary.matchedReceipts} จาก ${summary.inScopeReceipts} รายการรับเงิน`));
  assert.ok(html.includes(`${summary.matchRate}%`));
  for (const statement of dataset.statements) assert.ok(html.includes(statement.accountNo), `${statement.accountNo} missing from the page`);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("carries no hand-written demo rows in the UI", async () => {
  const page = await read("../app/page.tsx");

  // Every figure the UI shows must come from lib/dataset.generated.json.
  assert.match(page, /from "\.\.\/lib\/dataset"/);
  assert.doesNotMatch(page, /The Palm Pool Villa|Daniel Wong|สุวรรณา|Trip\.com Travel Singapore/);
  assert.doesNotMatch(page, /RC-2569-|GRP-885-0725|REC-07\d\d-\d+|EX-000\d\d/);
  // "฿0.00" appears in rule copy; any literal amount with thousands would be a hard-coded figure.
  assert.doesNotMatch(page, /฿\d{1,3},\d{3}/);
  assert.doesNotMatch(page, /initialExceptions|initialDocuments|initialInvoices|statementMatches|bookingReconciliations|runRows|audits/);
});

test("deploys and runs before any source document is loaded", async () => {
  const [page, builder] = await Promise.all([read("../app/page.tsx"), read("../scripts/build-dataset.mjs")]);

  // An empty data/ must produce an empty dataset, not a failed build …
  assert.match(builder, /state === "empty"/);
  assert.match(builder, /sources: \[\]/);
  // … a partly filled one must still fail loudly.
  assert.match(builder, /state === "partial"/);
  // … and the UI must swap in a status screen instead of a wall of zeros.
  assert.match(page, /const hasData = meta\.sources\.length > 0/);
  assert.match(page, /!hasData && active !== "rules" && <NoSourceDocuments/);
});

test("builds as a plain Next.js app that Vercel can deploy", async () => {
  const packageJson = JSON.parse(await read("../package.json"));

  assert.equal(packageJson.scripts.build, "npm run data:build && next build");
  assert.equal(packageJson.scripts.start, "next start");
  assert.equal(packageJson.scripts["data:build"], "node scripts/build-dataset.mjs");
  assert.ok(packageJson.dependencies.next, "next must be a runtime dependency");

  // The Cloudflare Workers toolchain would make the build unrunnable on Vercel.
  const everyDependency = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const name of ["vinext", "wrangler", "@cloudflare/vite-plugin", "drizzle-orm", "drizzle-kit"]) {
    assert.equal(everyDependency[name], undefined, `${name} must not be a dependency any more`);
  }
  await assert.rejects(access(new URL("../vite.config.ts", import.meta.url)));
  await assert.rejects(access(new URL("../worker/index.ts", import.meta.url)));
  await access(new URL("../.next/BUILD_ID", import.meta.url));
});

test("keeps product metadata and starter cleanup intact", async () => {
  const [page, layout, packageJson] = await Promise.all([read("../app/page.tsx"), read("../app/layout.tsx"), read("../package.json")]);

  assert.match(page, /ClearClose/);
  assert.match(layout, /og\.png/);
  assert.match(layout, /VERCEL_PROJECT_PRODUCTION_URL/);
  assert.match(packageJson, /clearclose-reconciliation/);
  assert.match(packageJson, /noto-sans-thai/);
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
