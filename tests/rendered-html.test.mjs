import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the page is a server component that resolves its own data source", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /loadDataset/);
  assert.match(page, /<Workspace/);
  // Rendered per request so an upload — or a decision made on another device —
  // is visible immediately.
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /serverSettings/);
  assert.match(page, /serverDecisions/);
  await access(new URL("../.next/BUILD_ID", import.meta.url));
});

test("the home screen is a list of jobs, not a wall of numbers", async () => {
  const home = await read("../app/views-home.tsx");

  // Every open job has its own card with a count and a way in.
  assert.match(home, /TaskCard/);
  assert.match(home, /ยอดที่ยังไม่ตรง|หาเงินเข้าไม่เจอ/);
  assert.match(home, /ก้อนโอนจาก OTA/);
  assert.match(home, /go\("fix"\)/);
  assert.match(home, /go\("ota"\)/);
  // Progress is the one number the screen leads with.
  assert.match(home, /<Progress/);
  // What a human decided is shown apart from what the rules produced, and undoable.
  assert.match(home, /undoMatch/);
  assert.match(home, /staleDecisions/);
});

test("the workbench shows both sides, the difference, and refuses a silent fudge", async () => {
  const match = await read("../app/views-match.tsx");

  // Both sides of the pairing, each with a running total.
  assert.match(match, /เงินที่รับมา/);
  assert.match(match, /เงินเข้าธนาคาร/);
  assert.match(match, /receiptSatang - bankSatang/);
  // Suggestions are ranked by what that side is still missing — the two sides
  // want opposite targets, so passing one number to both would sort one of them
  // upside down and bury the row the reviewer is looking for.
  assert.match(match, /const rank = [\s\S]{0,400}target/);
  assert.match(match, /\}\), -difference\)/);
  assert.match(match, /\}\), difference\)/);
  // Each suggestion says how far off the date is, in words.
  assert.match(match, /gapLabel/);
  // A difference can be accepted, but never without a reason on the record.
  assert.match(match, /needsReason/);
  assert.match(match, /canConfirm/);
  assert.match(match, /reason !== "" && \(reason !== "OTHER" \|\| note\.trim\(\)\.length > 0\)/);
  // Confirming is one button, and it says what it will record.
  assert.match(match, /confirm-button/);
  assert.match(match, /confirmMatch/);
});

test("the OTA screen says which OTA a payout came from and how the amounts tie out", async () => {
  const match = await read("../app/views-match.tsx");

  // The collection report already carries the net figure each OTA will send, so
  // most payouts tie out to the satang. The screen must say so — describing every
  // batch as "commission was deducted" is what hid the ones that genuinely differ.
  assert.match(match, /ยอดตรงพอดี/);
  assert.match(match, /matchKind/);
  assert.match(match, /feeRate/);
  assert.match(match, /SETTLEMENT/);
  // Each payout names its OTA and the payout cycle it was read against.
  assert.match(match, /providerLabel/);
  assert.match(match, /anchorField/);
  assert.match(match, /เช็คอิน/);
  assert.match(match, /เช็คเอาท์/);
  // An exact total is not proof on its own: several exact combinations, or rows
  // outside the OTA's normal cycle, have to reach the reviewer before they confirm.
  assert.match(match, /ambiguous/);
  assert.match(match, /outOfWindowCount/);
  // The proposal is inert until a human confirms it.
  assert.match(match, /ยังไม่เปลี่ยนจนกว่าจะกดยืนยัน|จนกว่าจะกดยืนยัน/);
});

test("the search screen can find any receipt and export what it shows", async () => {
  const data = await read("../app/views-data.tsx");

  for (const column of ["ผู้จอง", "ช่องทางรับเงิน", "ยอดที่รับมา", "สถานะ"]) {
    assert.ok(data.includes(column), `browse view is missing the ${column} column`);
  }
  assert.match(data, /statusLabel/);
  assert.match(data, /exportCsv/);
  // A BOM, so Excel opens Thai text as UTF-8 rather than mangling it.
  assert.match(data, /\\uFEFF|﻿\$\{/u);
});

test("carries no hand-written demo rows in the UI", async () => {
  const files = await Promise.all([
    read("../app/workspace.tsx"), read("../app/views-home.tsx"),
    read("../app/views-match.tsx"), read("../app/views-data.tsx"), read("../app/ui.tsx"),
  ]);

  for (const source of files) {
    assert.doesNotMatch(source, /The Palm Pool Villa|Daniel Wong|Trip\.com Travel Singapore/);
    assert.doesNotMatch(source, /RC-2569-|GRP-885-0725|REC-07\d\d-\d+|EX-000\d\d/);
    // "฿0.00" appears in rule copy; any literal amount with thousands would be a
    // hard-coded figure that did not come from a document.
    assert.doesNotMatch(source, /฿\d{1,3},\d{3}/);
    assert.doesNotMatch(source, /initialExceptions|initialDocuments|statementMatches|runRows/);
  }
});

test("deploys and runs before any document has been uploaded", async () => {
  const [home, source, workspace] = await Promise.all([
    read("../app/views-home.tsx"), read("../lib/data-source.ts"), read("../app/workspace.tsx"),
  ]);

  // An empty database must render an empty dataset, not a crash …
  assert.match(source, /const emptyDataset: Dataset/);
  assert.match(source, /source: stored \? "database" : "empty"/);
  // … and the UI must show a way forward instead of a wall of zeros.
  assert.match(workspace, /const hasData = dataset\.meta\.sources\.length > 0/);
  assert.match(home, /if \(!hasData\)/);
  assert.match(home, /go\("upload"\)/);
});

test("uploaded documents are the only way data enters the system", async () => {
  const [source, dataset, packageJson] = await Promise.all([
    read("../lib/data-source.ts"), read("../lib/dataset.ts"), read("../package.json"),
  ]);

  // เอกสารบัญชีจริงมีชื่อผู้เข้าพัก เบอร์โทร และรายการเดินบัญชีอยู่ข้างใน มันต้อง
  // ไม่มีทางถูก build เข้าไปอยู่ใน bundle ที่ deploy ขึ้นเซิร์ฟเวอร์
  assert.doesNotMatch(source, /dataset\.generated|buildTimeDataset/);
  assert.doesNotMatch(dataset, /dataset\.generated/);
  assert.doesNotMatch(JSON.parse(packageJson).scripts.build ?? "", /data:build/);
  assert.equal(JSON.parse(packageJson).scripts["data:build"], undefined, "the build-time data path must stay gone");

  // และ data/ ต้องถูก ignore ไว้ ไม่ใช่แค่บังเอิญยังไม่มีใคร commit
  const ignored = await read("../.gitignore");
  assert.match(ignored, /^\/data\/$/m);
  assert.match(ignored, /^\/lib\/dataset\.generated\.json$/m);
});

test("settings and decisions are stored server-side when a database exists", async () => {
  const [route, source, settings] = await Promise.all([
    read("../app/api/workspace/route.ts"), read("../lib/data-source.ts"), read("../lib/settings.ts"),
  ]);

  assert.match(route, /if \(!process\.env\.DATABASE_URL\)/);
  assert.match(route, /status: 503/);
  assert.match(route, /saveSettings|saveDecision|removeDecision/);
  // A difference may never be recorded without a reason, on the server as well
  // as in the browser.
  assert.match(route, /differenceSatang !== 0 && !decision\.reason/);
  // The page carries the stored state so the first render already agrees with it.
  assert.match(source, /loadStoredSettings/);
  assert.match(source, /listDecisions/);
  // With no database the workspace still works, on this device only.
  assert.match(settings, /localStorage/);
  assert.match(settings, /subscribeWorkspace/);
  // The store is seeded once per page load. Re-seeding on every render would
  // erase a decision the moment the component re-rendered after saving it.
  assert.match(settings, /export function primeWorkspace[\s\S]{0,300}state !== null\) return;/);
  // Nothing the server renders may come from module state, or one visitor's
  // settings would leak into another request on a warm serverless instance.
  assert.match(settings, /typeof window === "undefined" \|\| state !== null/);
  assert.match(settings, /getServerWorkspaceState\(\): WorkspaceState \| null \{\s*return null;/);
});

test("uploading requires a database and says so when there is none", async () => {
  const [route, data] = await Promise.all([read("../app/api/upload/route.ts"), read("../app/views-data.tsx")]);

  assert.match(route, /if \(!process\.env\.DATABASE_URL\)/);
  assert.match(route, /status: 503/);
  assert.match(route, /detectDocumentKind/);
  assert.match(route, /runReconciliation/);
  assert.match(data, /DATABASE_URL/);
});

test("builds as a plain Next.js app that Vercel can deploy", async () => {
  const packageJson = JSON.parse(await read("../package.json"));

  assert.equal(packageJson.scripts.build, "next build");
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
  const [workspace, layout, packageJson] = await Promise.all([
    read("../app/workspace.tsx"), read("../app/layout.tsx"), read("../package.json"),
  ]);

  assert.match(workspace, /ClearClose/);
  assert.match(layout, /og\.png/);
  assert.match(layout, /VERCEL_PROJECT_PRODUCTION_URL/);
  assert.match(packageJson, /clearclose-reconciliation/);
  await access(new URL("../public/og.png", import.meta.url));
});

test("the receipt screen prints the frozen copy, not today's numbers", async () => {
  const view = await read("../app/views-receipts.tsx");

  // ทุกตัวเลขบนใบมาจากสำเนาที่แช่แข็งไว้ตอนออกใบ ไม่ใช่คำนวณใหม่จากข้อมูลปัจจุบัน
  assert.match(view, /receipt\.document/);
  assert.match(view, /document\.netSatang/);
  assert.match(view, /document\.grossSatang/);
  // ไฟล์ PDF ออกทางหน้าพิมพ์ของเบราว์เซอร์ ซึ่งฝังฟอนต์ไทยให้ถูกต้อง
  assert.match(view, /window\.print\(\)/);
  assert.match(view, /no-print/);
  // ยกเลิกได้ แต่ต้องมีเหตุผลกำกับเสมอ
  assert.match(view, /เหตุผลที่ยกเลิก/);
  // เลขที่เอกสารต้องเดินจากที่เดียว หน้าจอจึงต้องปฏิเสธโหมดเก็บในเครื่อง
  assert.match(view, /if \(!online\)/);
});

test("the receipt sheet keeps its own print rules", async () => {
  const css = await read("../app/globals.css");

  assert.match(css, /@media print/);
  // เมนู ปุ่ม และแถบบนไม่ใช่ส่วนหนึ่งของเอกสารที่ส่งให้คนนอก
  assert.match(css, /\.no-print[^{]*\{[^}]*display: none/);
  assert.match(css, /\.receipt-sheet/);
  assert.match(css, /@page \{ size: A4/);
});
