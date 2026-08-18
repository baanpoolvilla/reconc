import { detectDocumentKind, documentPatterns, isAmbiguousDocumentName, parseDocument, statementKind } from "../../../lib/parsers/documents.mjs";
import { getDb, ensureSchema } from "../../../lib/db/client.mjs";
import {
  loadStoredSettings,
  recordAudit,
  recordDocument,
  resolveAccount,
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
type Rejected = { name: string; kind: string; reason: string };
type ParsedDocument = ReturnType<typeof parseDocument>;

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

  // ชื่อที่เข้าได้สองชนิดพร้อมกันต้องบอกให้ชัดว่าคลุมเครือ ไม่ใช่บอกว่า "ไม่รู้จัก"
  // ซึ่งจะทำให้คนไปแก้ผิดจุด
  const ambiguous = files.filter((file) => isAmbiguousDocumentName(file.name));
  if (ambiguous.length) {
    return Response.json(
      { error: `ชื่อไฟล์กำกวม: ${ambiguous.map((file) => file.name).join(", ")} — ชื่อเดียวเข้าได้หลายชนิด กรุณาตั้งชื่อให้เหลือเลขบัญชีเดียว` },
      { status: 400 },
    );
  }

  const unknown = files.filter((file) => !detectDocumentKind(file.name));
  if (unknown.length) {
    return Response.json(
      { error: `ไม่รู้จักไฟล์: ${unknown.map((file) => file.name).join(", ")} — ระบบดูชนิดเอกสารจากชื่อไฟล์ ต้องเข้ารูปแบบใดรูปแบบหนึ่งนี้: ${documentPatterns()}` },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    await ensureSchema(db);

    // ── รอบที่หนึ่ง · อ่านทุกไฟล์ ยังไม่เขียนอะไรลงฐานข้อมูล ──────────────
    //
    // ตัวอ่านเป็นฟังก์ชันบริสุทธิ์ (ไบต์เข้า แถวออก) การอ่านให้ครบก่อนจึงทำได้
    // และต้องทำ เพราะเดิมการอ่านกับการเขียนสลับกันไปทีละไฟล์ ไฟล์ที่สองอ่านไม่ผ่าน
    // จะทิ้งแถวของไฟล์แรกไว้ในฐานข้อมูลโดยไม่มีการกระทบยอดตามหลัง — ข้อมูลค้าง
    // อยู่ในสถานะที่หน้าจอไม่เคยบอก
    const parsedFiles: { file: File; kind: string; bytes: ArrayBuffer; parsed: ParsedDocument }[] = [];
    const rejected: Rejected[] = [];

    for (const file of files) {
      const kind = detectDocumentKind(file.name) as string;
      const bytes = await file.arrayBuffer();
      try {
        parsedFiles.push({ file, kind, bytes, parsed: parseDocument(kind, Buffer.from(bytes), file.name) });
      } catch (error) {
        rejected.push({
          name: file.name,
          kind,
          reason: error instanceof Error ? error.message : "อ่านไฟล์ไม่สำเร็จ",
        });
      }
    }

    // อ่านไม่ได้สักไฟล์ = ไม่มีอะไรให้เขียน บอกเหตุผลรายไฟล์แล้วจบ
    if (!parsedFiles.length) {
      return Response.json(
        {
          error: rejected.map((item) => `${item.name} · ${item.reason}`).join(" | "),
          rejected,
        },
        { status: 400 },
      );
    }

    // ── รอบที่สอง · เขียนเฉพาะไฟล์ที่อ่านผ่าน ────────────────────────────
    //
    // ไฟล์ที่อ่านไม่ได้ไม่ควรกันไฟล์ที่อ่านได้ออกไปด้วย ระบบรองรับชุดเอกสารที่ยัง
    // ไม่ครบอยู่แล้ว และรายงานตรง ๆ ว่าขาดอะไร ดีกว่าบังคับให้เริ่มใหม่ทั้งชุด
    const accepted: Accepted[] = [];
    const stored = (await loadStoredSettings(db)) as { accounts?: unknown[] } | null;
    const accounts = (stored?.accounts ?? []) as { accountNo: string; code: string; method: string }[];

    for (const { file, kind: detected, bytes, parsed } of parsedFiles) {
      const buffer = Buffer.from(bytes);
      let kind = detected;

      // statement รู้ว่าเป็นบัญชีไหนก็ต่อเมื่ออ่านเอกสารแล้ว ชนิดที่เก็บลงฐานข้อมูล
      // จึงตัดสินตรงนี้ ไม่ใช่ตอนดูชื่อไฟล์
      if (parsed.statement) {
        const account = await resolveAccount(db, parsed.statement, accounts);
        parsed.statement.code = account.code;
        parsed.statement.method = account.method;
        kind = statementKind(account.code);
      }

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

    if (rejected.length) {
      await recordAudit(db, "DOCUMENT_REJECTED", "document", "", { rejected });
    }

    const { id, dataset } = await runReconciliation(db);
    return Response.json({
      runId: id,
      accepted,
      periods: dataset.meta.periods,
      rejected,
      summary: dataset.reconciliation.summary,
      sources: dataset.meta.sources,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "ประมวลผลไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
