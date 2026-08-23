import { getDb, ensureSchema } from "../../../lib/db/client.mjs";
import { auditCounts, listAuditEvents } from "../../../lib/db/repository.mjs";

// สมุดตรวจ — ใครทำอะไรเมื่อไหร่
//
// อ่านอย่างเดียว ไม่มีทางเขียนหรือลบผ่านทางนี้ สมุดที่แก้ได้จากหน้าจอไม่ใช่สมุดตรวจ

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ online: false, events: [], counts: [] });
  }

  try {
    const url = new URL(request.url);
    const db = await getDb();
    await ensureSchema(db);

    const [events, counts] = await Promise.all([
      listAuditEvents(db, {
        limit: Number(url.searchParams.get("limit") ?? 300),
        action: url.searchParams.get("action") ?? "",
      }),
      auditCounts(db),
    ]);

    return Response.json({ online: true, events, counts });
  } catch (error) {
    return Response.json(
      { online: true, events: [], counts: [], error: error instanceof Error ? error.message : "อ่านสมุดตรวจไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
