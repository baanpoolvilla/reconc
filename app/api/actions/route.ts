import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditEvents, exceptions, invoices } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { action?: string; id?: string; value?: string };
    if (!payload.action || !payload.id) return Response.json({ error: "action and id are required" }, { status: 400 });
    const actor = (await getChatGPTUser())?.email ?? "demo-user";
    const db = getDb();

    if (payload.action === "resolve_exception") {
      await db.batch([
        db.update(exceptions).set({ status: "resolved", resolution: payload.value ?? "approved", updatedAt: new Date().toISOString() }).where(eq(exceptions.id, payload.id)),
        db.insert(auditEvents).values({ actor, action: "EXCEPTION_RESOLVED", entityType: "exception", entityId: payload.id, detail: JSON.stringify({ resolution: payload.value ?? "approved" }) }),
      ]);
    } else if (payload.action === "issue_invoice") {
      await db.batch([
        db.update(invoices).set({ status: "issued", issuedAt: new Date().toISOString() }).where(eq(invoices.id, payload.id)),
        db.insert(auditEvents).values({ actor, action: "INVOICE_ISSUED", entityType: "invoice", entityId: payload.id }),
      ]);
    } else {
      return Response.json({ error: "Unsupported action" }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Action failed" }, { status: 500 });
  }
}
