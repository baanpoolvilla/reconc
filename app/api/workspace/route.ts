import { getDb, ensureSchema } from "../../../lib/db/client.mjs";
import {
  deleteDecision,
  listDecisions,
  loadStoredSettings,
  saveDecision,
  saveStoredSettings,
} from "../../../lib/db/repository.mjs";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../../lib/settings-core.mjs";

// การตั้งค่าและการตัดสินใจของผู้ตรวจ — เก็บบนเซิร์ฟเวอร์ ทุกเครื่องจึงเห็นตรงกัน
//
// ไม่มีฐานข้อมูล = ใช้งานได้อยู่ แต่ค่าจะอยู่แค่ในเบราว์เซอร์เครื่องนั้น
// ทุก endpoint ตอบ 503 พร้อมข้อความบอกวิธีเปิดโหมดออนไลน์ ไม่ล้มเงียบ

export const dynamic = "force-dynamic";

const OFFLINE = {
  error: "ยังไม่ได้ตั้งค่า DATABASE_URL — การตั้งค่าและการจับคู่เองจะถูกเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น",
  online: false,
};

type Body = {
  action?: string;
  settings?: unknown;
  decision?: {
    id?: string;
    kind?: string;
    receiptIds?: string[];
    bankLineIds?: string[];
    receiptSatang?: number;
    bankSatang?: number;
    differenceSatang?: number;
    reason?: string;
    note?: string;
  };
  id?: string;
};

async function connect() {
  const db = await getDb();
  await ensureSchema(db);
  return db;
}

const failed = (error: unknown) =>
  Response.json(
    { online: true, error: error instanceof Error ? error.message : "ต่อฐานข้อมูลไม่สำเร็จ" },
    { status: 500 },
  );

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return Response.json({ online: false, settings: null, decisions: [] });
  }
  try {
    const db = await connect();
    const [stored, decisions] = await Promise.all([loadStoredSettings(db), listDecisions(db)]);
    return Response.json({
      online: true,
      settings: stored ? normalizeSettings(stored) : null,
      decisions,
    });
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) return Response.json(OFFLINE, { status: 503 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ online: true, error: "อ่านคำขอไม่สำเร็จ" }, { status: 400 });
  }

  try {
    const db = await connect();

    if (body.action === "saveSettings") {
      const settings = normalizeSettings(body.settings ?? DEFAULT_SETTINGS);
      await saveStoredSettings(db, settings);
      return Response.json({ online: true, settings });
    }

    if (body.action === "saveDecision") {
      const decision = body.decision;
      if (!decision?.receiptIds?.length || !decision?.bankLineIds?.length) {
        return Response.json(
          { online: true, error: "ต้องเลือกทั้งรายการรับเงินและเงินเข้าอย่างน้อยอย่างละหนึ่งรายการ" },
          { status: 400 },
        );
      }
      // ยอมให้ต่างได้ แต่ต้องบอกเหตุผลเสมอ — ผลต่างที่ไม่มีคำอธิบายคือหนี้ที่ซ่อนไว้
      if (decision.differenceSatang !== 0 && !decision.reason) {
        return Response.json({ online: true, error: "ยอดไม่เท่ากัน ต้องเลือกเหตุผลก่อนยืนยัน" }, { status: 400 });
      }
      const saved = await saveDecision(db, decision);
      return Response.json({ online: true, decision: saved, decisions: await listDecisions(db) });
    }

    if (body.action === "removeDecision") {
      if (!body.id) return Response.json({ online: true, error: "ไม่ได้ระบุรายการที่จะยกเลิก" }, { status: 400 });
      const removed = await deleteDecision(db, body.id);
      if (!removed) return Response.json({ online: true, error: "ไม่พบรายการนี้แล้ว" }, { status: 404 });
      return Response.json({ online: true, removed, decisions: await listDecisions(db) });
    }

    return Response.json({ online: true, error: "ไม่รู้จักคำสั่งนี้" }, { status: 400 });
  } catch (error) {
    return failed(error);
  }
}
