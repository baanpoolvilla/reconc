import { getDb, ensureSchema } from "../../../../lib/db/client.mjs";
import { loadDocumentFile } from "../../../../lib/db/repository.mjs";

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
