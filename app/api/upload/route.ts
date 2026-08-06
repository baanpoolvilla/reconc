import { DOCUMENT_KINDS, detectDocumentKind, parseDocument } from "../../../lib/parsers/documents.mjs";
import { getDb, ensureSchema } from "../../../lib/db/client.mjs";
import {
  recordAudit,
  recordDocument,
  replaceBookings,
  replaceReceipts,
  replaceStatement,
  runReconciliation,
  storedDocuments,
} from "../../../lib/db/repository.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

type Accepted = { kind: string; name: string; rows: number };

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return Response.json({ databaseConfigured: false, documents: [] });
  }
  try {
    const db = await getDb();
    await ensureSchema(db);
    return Response.json({ databaseConfigured: true, documents: await storedDocuments(db) });
  } catch (error) {
    return Response.json({ databaseConfigured: true, documents: [], error: error instanceof Error ? error.message : "ต่อฐานข้อมูลไม่สำเร็จ" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "ยังไม่ได้ตั้งค่า DATABASE_URL — อัปโหลดผ่านเว็บต้องมีฐานข้อมูลก่อน" }, { status: 503 });
  }

  let files: File[];
  try {
    const form = await request.formData();
    files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  } catch {
    return Response.json({ error: "อ่านไฟล์ที่อัปโหลดไม่สำเร็จ" }, { status: 400 });
  }

  if (!files.length) return Response.json({ error: "กรุณาเลือกไฟล์อย่างน้อยหนึ่งไฟล์" }, { status: 400 });

  const oversized = files.find((file) => file.size > MAX_BYTES);
  if (oversized) return Response.json({ error: `${oversized.name} ใหญ่เกิน 25 MB` }, { status: 413 });

  const unknown = files.filter((file) => !detectDocumentKind(file.name));
  if (unknown.length) {
    const expected = Object.values(DOCUMENT_KINDS).map((spec) => spec.label).join(", ");
    return Response.json(
      { error: `ไม่รู้จักไฟล์: ${unknown.map((file) => file.name).join(", ")} — ระบบรับเฉพาะ ${expected} และชื่อไฟล์ต้องเป็นรูปแบบเดิมที่ระบบต้นทางออกให้` },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    await ensureSchema(db);
    const accepted: Accepted[] = [];

    for (const file of files) {
      const kind = detectDocumentKind(file.name) as string;
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const parsed = parseDocument(kind, buffer, file.name);

      if (parsed.bookings) await replaceBookings(db, parsed.bookings);
      if (parsed.receipts) await replaceReceipts(db, parsed.receipts);
      if (parsed.statement) await replaceStatement(db, parsed.statement);

      const rows = parsed.bookings?.length ?? parsed.receipts?.length ?? parsed.statement?.lines.length ?? 0;
      await recordDocument(db, {
        id: crypto.randomUUID(),
        kind,
        name: file.name,
        sha256: await sha256(bytes),
        sizeBytes: file.size,
        rowCount: rows,
        uploadedBy: "web",
      });
      await recordAudit(db, "DOCUMENT_UPLOADED", "document", file.name, { kind, rows });
      accepted.push({ kind, name: file.name, rows });
    }

    const { id, dataset } = await runReconciliation(db);
    return Response.json({ runId: id, accepted, summary: dataset.reconciliation.summary, sources: dataset.meta.sources });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "ประมวลผลไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
