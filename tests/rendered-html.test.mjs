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

test("the home screen is the closing sequence, not a wall of numbers", async () => {
  const home = await read("../app/views-home.tsx");

  // ปิดรอบเป็นลำดับ ไม่ใช่แดชบอร์ด — หน้าแรกต้องตอบว่า "ตอนนี้ทำอะไรต่อ"
  // แดชบอร์ดที่วางทุกอย่างเป็นการ์ดเท่ากันหมด บังคับให้คนใหม่เดาเองว่าเริ่มตรงไหน
  assert.ok(home.includes("<StepList"), "หน้าแรกต้องเป็นลำดับขั้น");
  assert.match(home, /ลำดับการปิดรอบ/);

  // หกขั้น เรียงตามลำดับที่คนทำงานจริง
  for (const step of [1, 2, 3, 4, 5, 6]) {
    assert.ok(home.includes(`index={${step}}`), `ขาดขั้นที่ ${step}`);
  }
  for (const title of ["ผูกบัญชีธนาคาร", "นำเข้าเอกสาร", "เคลียร์ยอดที่ยังไม่ตรง", "แตกยอดก้อนโอน", "ออกใบเสร็จ", "ตรวจรายงาน"]) {
    assert.ok(home.includes(title), `ขาดขั้น "${title}"`);
  }
  for (const view of ["settings", "upload", "fix", "ota", "receipts", "report"]) {
    assert.ok(home.includes(`go("${view}")`), `ขั้นตอนต้องพาไปหน้า ${view} ได้`);
  }

  // "ทำต่อตรงนี้" ต้องมีได้ขั้นเดียว ไม่งั้นก็ยังเป็นแดชบอร์ดอยู่ดี
  assert.match(home, /const steps = /);
  // Progress ยังเป็นตัวเลขตัวเดียวที่นำหน้า
  assert.ok(home.includes("<Progress"));
  // สิ่งที่คนตัดสินเองยังแยกจากสิ่งที่กฎจับ และยกเลิกได้
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

test("six receipts fit one A4 sheet, and only the sheet reaches the paper", async () => {
  const view = await read("../app/views-receipts.tsx");
  const css = await read("../app/globals.css");

  // แผ่นถูกแบ่งด้วยการสั่งขึ้นหน้าใหม่ที่ช่องที่หก ไม่ใช่การหั่นอาเรย์เป็นชุด ๆ เอง
  assert.match(view, /index % 6 === 5/);
  assert.match(view, /sheet-break/);
  assert.match(css, /\.sheet-break \{ break-after: page/);
  assert.match(css, /\.receipt-grid \{[^}]*repeat\(2, 1fr\)/);

  // สามแถวสูง 87mm บวกช่องไฟ 5mm สองช่อง = 271mm พอดีใน A4 ที่หักขอบ 10mm แล้ว 277mm
  assert.match(css, /\.receipt-mini \{[^}]*min-height: 86mm/);
  assert.match(css, /@page \{ size: A4; margin: 10mm/);

  // ที่เหลือบนหน้าจอ — ตารางรายการ แบนเนอร์ หัวข้อ — ไม่ใช่ส่วนหนึ่งของเอกสาร
  // ระบุแบบ "ทุกอย่างที่ไม่ใช่แผ่นเอกสาร" ไม่ใช่ไล่ซ่อนทีละคลาส
  assert.match(css, /\.content > \*:not\(\.receipt-shell\) \{ display: none/);

  // ใบที่ยกเลิกแล้วไม่ใช่เอกสารที่ส่งให้ใครได้ จึงเลือกพิมพ์ไม่ได้
  assert.match(view, /disabled=\{Boolean\(row\.voidedAt\)\}/);
});

test("a document imported by mistake can be deleted, and says what goes with it", async () => {
  const view = await read("../app/views-data.tsx");
  const route = await read("../app/api/documents/[id]/route.ts");

  assert.match(route, /export async function DELETE/);
  assert.match(route, /deleteDocument/);
  // ลบแล้วกระทบยอดใหม่ในคำขอเดียวกัน หน้าจอจึงไม่มีจังหวะที่โชว์ตัวเลขของเอกสารที่ไม่มีแล้ว
  assert.match(route, /runReconciliation/);

  // การลบต้องผ่านการยืนยันที่บอกผลกระทบก่อน ไม่ใช่ปุ่มเดียวจบ
  assert.match(view, /ConfirmRemoval/);
  assert.match(view, /pendingRemoval/);
  assert.match(view, /ย้อนกลับไม่ได้/);
  // สองอย่างที่ไม่หายไปกับเอกสาร และผู้ใช้ต้องรู้ก่อนกด
  assert.match(view, /การจับคู่ที่คุณยืนยันเองไม่ถูกลบ/);
  assert.match(view, /ใบเสร็จรับเงินที่ออกไปแล้วไม่หาย/);
});

test("the home screen cannot claim a period is clear while rows never entered it", async () => {
  const home = await read("../app/views-home.tsx");
  const ui = await read("../app/ui.tsx");

  // อาการจริงที่เจอบนระบบที่ deploy แล้ว: statement อยู่ในระบบ เอกสารขึ้นครบ แต่
  // ไม่มีใครบอกว่าบัญชีตรงกับช่องทางรับเงินไหน รายการทั้งเดือนจึงไม่เคยถูกนำมา
  // เทียบเลย ตัวหารเหลือใบเดียว แล้วหน้าแรกประกาศว่า "100% ของรอบนี้เคลียร์แล้ว"
  assert.match(home, /unmappedAccounts/);
  assert.ok(home.includes("ผูกบัญชีธนาคารกับช่องทางรับเงิน"), "ต้องเป็นขั้นแรกของการปิดรอบ");
  assert.ok(home.includes("ไปผูกบัญชี"));
  assert.ok(home.includes("จะไม่ถูกนำมากระทบยอดเลย"), "ต้องบอกด้วยว่าไม่ผูกแล้วเสียอะไร");

  // แถบความคืบหน้าต้องบอกจำนวนที่อยู่นอกตัวหารด้วย ไม่ใช่รายงานแค่เปอร์เซ็นต์
  assert.ok(home.includes("outside={outsideCount}"));
  assert.match(ui, /outside\?: number/);
  assert.match(ui, /ยังไม่เข้าสู่การกระทบยอด/);
  // และห้ามพูดว่า "เคลียร์แล้ว" ลอย ๆ โดยไม่บอกว่าเทียบกับอะไร
  assert.doesNotMatch(ui, /% ของรอบนี้เคลียร์แล้ว/);
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

test("six receipts fit one A4 sheet, and only the sheet reaches the paper", async () => {
  const view = await read("../app/views-receipts.tsx");
  const css = await read("../app/globals.css");

  // แผ่นถูกแบ่งด้วยการสั่งขึ้นหน้าใหม่ที่ช่องที่หก ไม่ใช่การหั่นอาเรย์เป็นชุด ๆ เอง
  assert.match(view, /index % 6 === 5/);
  assert.match(view, /sheet-break/);
  assert.match(css, /\.sheet-break \{ break-after: page/);
  assert.match(css, /\.receipt-grid \{[^}]*repeat\(2, 1fr\)/);

  // สามแถวสูง 87mm บวกช่องไฟ 5mm สองช่อง = 271mm พอดีใน A4 ที่หักขอบ 10mm แล้ว 277mm
  assert.match(css, /\.receipt-mini \{[^}]*min-height: 86mm/);
  assert.match(css, /@page \{ size: A4; margin: 10mm/);

  // ที่เหลือบนหน้าจอ — ตารางรายการ แบนเนอร์ หัวข้อ — ไม่ใช่ส่วนหนึ่งของเอกสาร
  // ระบุแบบ "ทุกอย่างที่ไม่ใช่แผ่นเอกสาร" ไม่ใช่ไล่ซ่อนทีละคลาส
  assert.match(css, /\.content > \*:not\(\.receipt-shell\) \{ display: none/);

  // ใบที่ยกเลิกแล้วไม่ใช่เอกสารที่ส่งให้ใครได้ จึงเลือกพิมพ์ไม่ได้
  assert.match(view, /disabled=\{Boolean\(row\.voidedAt\)\}/);
});

test("a document imported by mistake can be deleted, and says what goes with it", async () => {
  const view = await read("../app/views-data.tsx");
  const route = await read("../app/api/documents/[id]/route.ts");

  assert.match(route, /export async function DELETE/);
  assert.match(route, /deleteDocument/);
  // ลบแล้วกระทบยอดใหม่ในคำขอเดียวกัน หน้าจอจึงไม่มีจังหวะที่โชว์ตัวเลขของเอกสารที่ไม่มีแล้ว
  assert.match(route, /runReconciliation/);

  // การลบต้องผ่านการยืนยันที่บอกผลกระทบก่อน ไม่ใช่ปุ่มเดียวจบ
  assert.match(view, /ConfirmRemoval/);
  assert.match(view, /pendingRemoval/);
  assert.match(view, /ย้อนกลับไม่ได้/);
  // สองอย่างที่ไม่หายไปกับเอกสาร และผู้ใช้ต้องรู้ก่อนกด
  assert.match(view, /การจับคู่ที่คุณยืนยันเองไม่ถูกลบ/);
  assert.match(view, /ใบเสร็จรับเงินที่ออกไปแล้วไม่หาย/);
});


test("the fix queue shows every instalment of the same reservation", async () => {
  const match = await read("../app/views-match.tsx");
  const css = await read("../app/globals.css");

  // ยอดลอย ๆ ใบเดียวอธิบายตัวเองไม่ได้ — "มัดจำวันจอง + ที่เหลือวัน Check-in =
  // ยอดคำจองพอดี" คือหลักฐานที่ผู้ตรวจกดยืนยันได้ทันที และมันผูกกันด้วยเลขที่การจอง
  assert.match(match, /BookingInstalments/);
  assert.match(match, /reservationNo === reservationNo|item\.reservationNo === reservationNo/);
  assert.match(match, /ยอดคำจอง/);
  assert.match(match, /วัน Check-in/);
  assert.match(match, /วันที่จอง/);
  assert.match(css, /\.instalments/);
});

test("the manual lives in the app and reads the real rules", async () => {
  const help = await read("../app/views-help.tsx");
  const workspace = await read("../app/workspace.tsx");

  // คู่มือที่ต้องไปเปิดจากที่อื่นคือคู่มือที่ไม่มีใครเปิด — มันต้องอยู่ในเมนู
  assert.match(workspace, /views-help/);
  assert.match(workspace, /คู่มือการใช้งาน/);

  // หัวข้อที่คนถามจริง ๆ ตอนใช้งาน
  for (const topic of ["เริ่มใช้ครั้งแรก", "งานประจำเดือน", "ก้อนโอน OTA", "ใบเสร็จรับเงิน", "แก้เมื่อทำผิด"]) {
    assert.ok(help.includes(topic), `คู่มือขาดหัวข้อ ${topic}`);
  }

  // ตารางกฎอ่านจาก RULES ตัวจริง ไม่ใช่พิมพ์ซ้ำไว้ในคู่มือ ซึ่งจะเก่าโดยไม่มีใครรู้
  assert.match(help, /RULES\.map/);
  assert.match(help, /from "\.\.\/lib\/settings"/);

  // สองข้อที่บังคับเสมอ ต้องอยู่ในคู่มือด้วยคำเดียวกับที่ระบบใช้
  assert.match(help, /ยอดต้องตรงพอดี/);
  assert.match(help, /กฎที่แก้ไม่ได้/);
});

test("the sidebar groups menus by the question a person is asking", async () => {
  const workspace = await read("../app/workspace.tsx");

  // แปดเมนูเรียงกันเป็นแถวเดียวไม่ได้บอกว่าอันไหนคืองานวันนี้ อันไหนเปิดเมื่อไหร่ก็ได้
  assert.match(workspace, /งานของรอบนี้/);
  assert.match(workspace, /ตรวจสอบ/);
  assert.match(workspace, /side-group/);
  // งานประจำรอบมีเลขขั้นตรงกับลำดับบนหน้าแรก
  assert.match(workspace, /step: 2/);
  assert.match(workspace, /step: 5/);
});

test("the audit log is readable in the app, and read-only", async () => {
  const view = await read("../app/views-audit.tsx");
  const route = await read("../app/api/audit/route.ts");
  const workspace = await read("../app/workspace.tsx");

  // สมุดที่อ่านได้เฉพาะจาก SQL คือสมุดที่แผนกบัญชีตรวจไม่ได้ ซึ่งเท่ากับไม่มี
  assert.match(workspace, /views-audit/);
  assert.match(workspace, /สมุดตรวจ/);

  // อ่านอย่างเดียว — ไม่มี POST/DELETE ให้แก้สมุดผ่านหน้าจอ
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|DELETE|PUT|PATCH)/);
  assert.match(view, /อ่านอย่างเดียว/);

  // กรองตามชนิด ค้นหา และเอาออกไปเป็นไฟล์ได้
  assert.match(view, /setAction/);
  assert.match(view, /SearchBox/);
  assert.match(view, /exportCsv/);
});

test("the report exports what is still open, not only what closed", async () => {
  const home = await read("../app/views-home.tsx");

  // รายการค้างคือกระดาษทำการที่แนบท้ายงบพิสูจน์ยอด เดิมอ่านได้แต่บนหน้าจอ
  assert.match(home, /exportOpen/);
  assert.match(home, /รายการค้าง/);
  assert.match(home, /ยังไม่เข้าสู่การกระทบยอด/);
  // ทั้งสองฝั่งของคิวงาน บวกของที่ไม่เคยเข้าสู่การกระทบยอด
  assert.match(home, /หาเงินเข้าไม่เจอ/);
  assert.match(home, /ไม่รู้ว่าของใคร/);
  assert.match(home, /outOfScope\.map/);
});
