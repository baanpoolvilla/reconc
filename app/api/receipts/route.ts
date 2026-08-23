import { getDb, ensureSchema } from "../../../lib/db/client.mjs";
import {
  findIssuedReceipt,
  issueReceipt,
  latestDataset,
  listDecisions,
  listIssuedReceipts,
  loadStoredSettings,
  voidReceipt,
} from "../../../lib/db/repository.mjs";
import { DEFAULT_SETTINGS, applySettings, normalizeSettings } from "../../../lib/settings-core.mjs";
import { blockersFor, buildReceiptDocument, receiptSeries, settledOtaGroups } from "../../../lib/issued-receipts.mjs";

// การออกใบเสร็จรับเงินของก้อนโอน OTA
//
// ตัวเลขบนใบเสร็จถูกประกอบขึ้นที่นี่จากข้อมูลในฐานข้อมูลเสมอ ไม่ได้รับมาจากหน้าจอ
// หน้าจอบอกได้อย่างเดียวว่า "ออกใบให้ก้อนไหน" — เอกสารที่ส่งออกไปหาคนนอกโดยที่
// เบราว์เซอร์เป็นคนบอกจำนวนเงิน คือช่องที่ไม่ควรเปิดไว้ตั้งแต่แรก

export const dynamic = "force-dynamic";

const OFFLINE = {
  error: "ใบเสร็จรับเงินต้องมีฐานข้อมูล — ตั้งค่า DATABASE_URL ก่อน เพราะเลขที่เอกสารต้องเดินต่อกันจากที่เดียว",
  online: false,
};

type Body = { action?: string; decisionId?: string; number?: string; reason?: string };

// ตรรกะการกระทบยอดอยู่ใน .mjs ที่ไม่มี type ของตัวเอง สิ่งที่ route นี้ใช้จริงมี
// เท่านี้ จึงประกาศไว้ตรงนี้แทนการปล่อยให้เป็น any ทั้งก้อน
type SettledGroup = {
  date: string;
  period: string;
  account: string;
  receiptSatang: number;
  bankSatang: number;
  receipts: { id: string }[];
  lines: { id: string; detail?: string; description?: string }[];
  decision: { id: string };
};

type IssuedRow = { decisionId: string; voidedAt: string };

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

/** ชุดข้อมูลที่กระทบยอดแล้ว พร้อมการตั้งค่าที่ใช้จริง — แหล่งเดียวของตัวเลขบนใบเสร็จ */
async function currentState(db: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) {
  const [stored, settings, decisions] = await Promise.all([
    latestDataset(db),
    loadStoredSettings(db),
    listDecisions(db),
  ]);
  const resolved = settings ? normalizeSettings(settings) : DEFAULT_SETTINGS;
  if (!stored) return { settings: resolved, effective: null };
  return { settings: resolved, effective: applySettings(stored, resolved, decisions) };
}

export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ online: false, issued: [], pending: [] });

  try {
    const db = await connect();
    const [issued, state] = await Promise.all([listIssuedReceipts(db), currentState(db)]);
    const live = new Set((issued as IssuedRow[]).filter((item) => !item.voidedAt).map((item) => item.decisionId));

    // ก้อนที่กระทบยอดแล้วทุกก้อน พร้อมบอกว่าใบไหนออกไปแล้ว — หน้าจอจึงไม่ต้องเดา
    const settled: SettledGroup[] = state.effective ? settledOtaGroups(state.effective.dataset) : [];
    const pending = settled
      .filter((group) => !live.has(group.decision.id))
      .map((group) => ({
        decisionId: group.decision.id,
        date: group.date,
        period: group.period,
        account: group.account,
        payerHint: group.lines.map((line) => line.detail || line.description).filter(Boolean).join(" · "),
        bookingCount: group.receipts.length,
        grossSatang: group.receiptSatang,
        netSatang: group.bankSatang,
        deductionSatang: group.receiptSatang - group.bankSatang,
        blockers: blockersFor(group, state.settings.organization),
      }));

    return Response.json({ online: true, issued, pending, settledCount: settled.length });
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

    if (body.action === "issue") {
      if (!body.decisionId) {
        return Response.json({ online: true, error: "ไม่ได้ระบุก้อนโอนที่จะออกใบเสร็จ" }, { status: 400 });
      }

      const state = await currentState(db);
      if (!state.effective) {
        return Response.json({ online: true, error: "ยังไม่มีข้อมูลที่กระทบยอดแล้วในระบบ" }, { status: 400 });
      }

      const group = (settledOtaGroups(state.effective.dataset) as SettledGroup[])
        .find((item) => item.decision.id === body.decisionId);
      if (!group) {
        return Response.json(
          { online: true, error: "ไม่พบก้อนโอนที่กระทบยอดแล้วของรายการนี้ — อาจถูกยกเลิกการจับคู่ไปแล้ว" },
          { status: 404 },
        );
      }

      // ด่านเดียวกับที่หน้าจอใช้ขึ้นเตือน แต่ตรวจซ้ำที่นี่เสมอ หน้าจอที่เก่ากว่า
      // เซิร์ฟเวอร์หนึ่งรอบ ไม่ควรออกเอกสารที่ตกเงื่อนไขไปแล้วได้
      const blockers = blockersFor(group, state.settings.organization);
      if (blockers.length) {
        return Response.json({ online: true, error: `ออกใบเสร็จยังไม่ได้: ${blockers.join(" · ")}` }, { status: 400 });
      }

      const document = buildReceiptDocument({
        group,
        settlement: state.settings.settlement,
        organization: state.settings.organization,
        number: "",
        issuedAt: "",
      });

      const receipt = await issueReceipt(db, {
        document,
        // ชุดเลขผูกกับเดือนที่ได้รับเงินจริง ไม่ใช่เดือนที่กดออกเอกสาร ออกย้อนหลัง
        // จึงยังได้เลขในชุดของเดือนนั้น และสมุดเลขของแต่ละเดือนยังเดินต่อกัน
        series: receiptSeries(group.date),
        decisionId: group.decision.id,
      });

      return Response.json({ online: true, receipt, issued: await listIssuedReceipts(db) });
    }

    if (body.action === "void") {
      if (!body.number) return Response.json({ online: true, error: "ไม่ได้ระบุเลขที่ใบเสร็จ" }, { status: 400 });
      const reason = (body.reason ?? "").trim();
      // เอกสารที่ส่งออกไปแล้วถูกยกเลิกโดยไม่มีเหตุผลกำกับไม่ได้ นั่นคือรูโหว่ที่
      // ทำให้สมุดเลขอธิบายตัวเองไม่ได้ตอนถูกตรวจ
      if (!reason) return Response.json({ online: true, error: "ต้องเขียนเหตุผลที่ยกเลิก" }, { status: 400 });

      const existing = await findIssuedReceipt(db, body.number);
      if (!existing) return Response.json({ online: true, error: "ไม่พบใบเสร็จเลขที่นี้" }, { status: 404 });

      const voided = await voidReceipt(db, body.number, reason);
      return Response.json({ online: true, receipt: voided, issued: await listIssuedReceipts(db) });
    }

    return Response.json({ online: true, error: "ไม่รู้จักคำสั่งนี้" }, { status: 400 });
  } catch (error) {
    return failed(error);
  }
}
