import { and, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { auditEvents, documents } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET() {
  try {
    const rows = await getDb().select().from(documents).orderBy(desc(documents.createdAt)).limit(50);
    return Response.json({ documents: rows });
  } catch (error) {
    return Response.json({ documents: [], error: error instanceof Error ? error.message : "Database unavailable" });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const documentType = String(form.get("documentType") ?? "collection_report");
    const period = String(form.get("period") ?? "2026-07");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ error: "กรุณาเลือกไฟล์" }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return Response.json({ error: "ไฟล์ต้องมีขนาดไม่เกิน 25 MB" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const bytes = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const db = getDb();
    const duplicate = await db.select().from(documents).where(and(
      eq(documents.sha256, sha256),
      eq(documents.documentType, documentType),
      eq(documents.period, period),
    )).limit(1);
    if (duplicate[0]) {
      return Response.json({ error: `ไฟล์นี้ถูกนำเข้าเป็น ${documentType} ของรอบ ${period} แล้ว`, document: duplicate[0] }, { status: 409 });
    }

    const storageKey = `source/demo-org/${period}/${documentType}/${id}/${file.name}`;
    const files = (env as unknown as { FILES: R2Bucket }).FILES;
    await files.put(storageKey, bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" } });

    const user = await getChatGPTUser();
    const actor = user?.email ?? "demo-user";
    await db.batch([
      db.insert(documents).values({ id, name: file.name, documentType, period, storageKey, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, sha256, status: "queued", uploadedBy: actor }),
      db.insert(auditEvents).values({ actor, action: "DOCUMENT_UPLOADED", entityType: "document", entityId: id, detail: JSON.stringify({ name: file.name, documentType, period, sha256 }) }),
    ]);
    return Response.json({ document: { id, name: file.name, documentType, period, sizeBytes: file.size, status: "queued", sha256 } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 500 });
  }
}
