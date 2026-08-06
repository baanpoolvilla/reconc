import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENT_KINDS, parseDocument } from "../lib/parsers/documents.mjs";
import { buildDataset } from "../lib/dataset-builder.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const outputPath = join(root, "lib", "dataset.generated.json");

function dataDirEntries() {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir).filter((file) => !file.startsWith("."));
}

/**
 * An empty data/ folder is a valid state: the app deploys without any source
 * documents and shows its empty state. A *partly* filled folder is not — that
 * is a mistake worth failing on, so the operator notices the missing file.
 */
const entries = dataDirEntries();
const found = Object.entries(DOCUMENT_KINDS).map(([kind, spec]) => [kind, entries.find((file) => spec.matches(file))]);
const missing = found.filter(([, file]) => !file).map(([kind]) => DOCUMENT_KINDS[kind].label);

let dataset;

if (missing.length === found.length) {
  dataset = buildDataset([]);
  console.log("data/ ว่าง — สร้างชุดข้อมูลเปล่า ระบบจะขึ้นหน้าจอสถานะ 'ยังไม่มีเอกสาร'");
} else if (missing.length > 0) {
  throw new Error(`โฟลเดอร์ data/ มีเอกสารไม่ครบ ขาด: ${missing.join(", ")} — ใส่ให้ครบทั้งสี่ไฟล์ หรือเอาออกให้หมดเพื่อ build แบบไม่มีข้อมูล`);
} else {
  const documents = found.map(([kind, file]) => ({
    kind,
    name: file,
    ...parseDocument(kind, readFileSync(join(dataDir, file)), file),
  }));
  dataset = buildDataset(documents);

  console.log(`bookings        ${dataset.bookings.length}`);
  console.log(`receipts        ${dataset.receipts.length}`);
  for (const statement of dataset.statements) {
    console.log(`statement ${statement.code}    ${statement.lines.length} lines · control delta ${statement.controlDeltaSatang}`);
  }
  const { summary } = dataset.reconciliation;
  console.log(`matched groups  ${summary.matchedGroups} (${summary.matchRate}%)`);
  console.log(`exceptions      ${summary.exceptionCount}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(dataset)}\n`, "utf8");
console.log(`written         ${outputPath}`);
