import { DOCUMENT_KINDS, detectDocumentKind, parseDocument } from "../../../lib/parsers/documents.mjs";
import { getDb, ensureSchema } from "../../../lib/db/client.mjs";
import {
  recordAudit,
  recordDocument,
  replaceBookings,
  replaceReceipts,
  replaceStatement,
  runReconciliation,
  saveDocumentFile,
  storedDocuments,
} from "../../../lib/db/repository.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

// ไฟล์ต้นฉบับถูกเก็บไว้ในฐานข้อมูลเพื่อให้ย้อนกลับไปเปิดเอกสารที่ตัวเลขงวดนั้นมา
// จากได้จริง เอกสารสี่ฉบับต่อเดือนของจริงรวมกันไม่ถึงหนึ่งเมกะไบต์ เพดานนี้จึงไว้
// กันไฟล์ผิดปกติไม่ให้ยัด payload ก้อนโตข้าม HTTP ไปหา Neon — ตัวข้อมูลยังเข้าครบ
// ไม่ว่าไฟล์จะใหญ่แค่ไหน หายไปแค่สำเนาไฟล์ให้กดดาวน์โหลด
const MAX_STORED_BYTES = 8 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type Accepted = { kind: string; name: string; rows: number; periods: string[]; fileStored: boolean };

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

      // งวดที่ไฟล์นี้ครอบคลุมมาจากวันที่ในแถวของมันเอง ไม่ได้ให้ใครเลือกตอนอัปโหลด
      // และการเขียนลงตารางแทนที่เฉพาะงวดเหล่านี้ เดือนอื่นไม่ถูกแตะ
      let periods: string[] = [];
      if (parsed.bookings) periods = await replaceBookings(db, parsed.bookings);
      if (parsed.receipts) periods = await replaceReceipts(db, parsed.receipts);
      if (parsed.statement) periods = await replaceStatement(db, parsed.statement);

      const rows = parsed.bookings?.length ?? parsed.receipts?.length ?? parsed.statement?.lines.length ?? 0;
      const id = crypto.randomUUID();
      await recordDocument(db, {
        id,
        kind,
        periods,
        name: file.name,
        sha256: await sha256(bytes),
        sizeBytes: file.size,
        rowCount: rows,
        uploadedBy: "web",
      });

      const fileStored = file.size <= MAX_STORED_BYTES;
      if (fileStored) {
        await saveDocumentFile(db, id, {
          name: file.name,
          contentType: CONTENT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream",
          sizeBytes: file.size,
          contentBase64: buffer.toString("base64"),
        });
      }

      await recordAudit(db, "DOCUMENT_UPLOADED", "document", file.name, { kind, rows, periods, fileStored });
      accepted.push({ kind, name: file.name, rows, periods, fileStored });
    }

    const { id, dataset } = await runReconciliation(db);
    return Response.json({
      runId: id,
      accepted,
      periods: dataset.meta.periods,
      summary: dataset.reconciliation.summary,
      sources: dataset.meta.sources,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "ประมวลผลไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
