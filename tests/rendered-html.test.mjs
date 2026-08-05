import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the complete ClearClose workspace", async () => {
  const [page, serverBundle] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../dist/server/index.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /เห็นทุกยอดต่าง/);
  assert.match(page, /2,274,426/);
  assert.match(page, /AMOUNT_MISMATCH/);
  assert.match(page, /นำเข้าเอกสาร/);
  assert.match(page, /OTA Settlement/);
  assert.match(page, /Phase 4/);
  assert.match(page, /ชุดเอกสารประจำเดือน/);
  assert.match(page, /ยอดใน Statement/);
  assert.match(page, /หลักฐานการจับคู่แบบตรวจสอบย้อนกลับได้/);
  assert.match(page, /Reservation/);
  assert.doesNotMatch(page, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
  assert.ok(serverBundle.length > 1000);
});

test("removes starter assets and includes product metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /ClearClose/);
  assert.match(page, /reconciliation-app|AMOUNT_MISMATCH|คิวตรวจสอบ/);
  assert.match(layout, /og\.png/);
  assert.match(packageJson, /clearclose-reconciliation/);
  assert.match(packageJson, /noto-sans-thai/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../.openai/hosting.json", import.meta.url));
});
