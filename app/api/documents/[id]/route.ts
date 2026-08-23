import { getDb, ensureSchema } from "../../../../lib/db/client.mjs";
import { deleteDocument, loadDocumentFile, runReconciliation } from "../../../../lib/db/repository.mjs";

// ดาวน์โหลดเอกสารต้นฉบับที่อัปโหลดไว้
//
// ตัวเลขของงวดหนึ่งจะตรวจย้อนกลับได้จริงก็ต่อเมื่อเปิดไฟล์ที่มันถูกอ่านมาได้ด้วย
// ไฟล์ถูกเก็บเป็น base64 ในฐานข้อมูลเดียวกับข้อมูล จึงไม่ต้องพึ่ง object storage
// อีกที่หนึ่ง และสำเนาไฟล์กับแถวที่มันสร้างไว้ถูกลบพร้อมกันเสมอ

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "ยังไม่ได้ตั้งค่า DATABASE_URL" }, { status: 503 });
  }

  try {
    const db = await getDb();
    await ensureSchema(db);
    const file = await loadDocumentFile(db, id);
    if (!file) return Response.json({ error: "ไม่พบไฟล์ต้นฉบับของเอกสารนี้" }, { status: 404 });

    const bytes = Buffer.from(file.contentBase64, "base64");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(bytes.length),
        // ชื่อไฟล์เป็นภาษาไทยได้ จึงต้องส่งเป็น filename* ตาม RFC 5987 ไม่ใช่ filename
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "อ่านไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}

/**
 * ลบเอกสารที่นำเข้ามาผิด พร้อมแถวที่มันสร้างไว้
 *
 * อัปโหลดทับแก้ได้เฉพาะไฟล์ที่ถูกเป็นชนิดและงวดเดียวกับไฟล์ที่ผิด ไฟล์ที่ถูกอ่าน
 * เป็นเดือนที่ไม่มีอยู่จริง หรือถูกอ่านเป็นบัญชีอื่น จะไม่มีวันถูกทับ ต้องลบทิ้ง
 *
 * ลบแล้วกระทบยอดใหม่ทันทีในคำขอเดียวกัน หน้าจอจึงไม่มีจังหวะที่แสดงตัวเลขซึ่ง
 * คำนวณจากเอกสารที่ไม่มีอยู่แล้ว
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "ยังไม่ได้ตั้งค่า DATABASE_URL" }, { status: 503 });
  }

  try {
    const db = await getDb();
    await ensureSchema(db);

    const removed = await deleteDocument(db, id);
    if (!removed) return Response.json({ error: "ไม่พบเอกสารฉบับนี้แล้ว" }, { status: 404 });

    // ไม่มีแถวเหลือเลยก็ไม่มีอะไรให้กระทบยอด และ runReconciliation จะไม่มีงวดให้เขียน
    const [{ total }] = await db.query("SELECT count(*)::int AS total FROM clearclose.receipts");
    if (Number(total)) await runReconciliation(db);

    return Response.json({ removed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "ลบเอกสารไม่สำเร็จ" }, { status: 500 });
  }
}
