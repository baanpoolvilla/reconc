// งวดบัญชี — เดือนปฏิทินในรูป YYYY-MM
//
// งวดเป็นคุณสมบัติของ "แถว" ไม่ใช่ของ "ไฟล์" แต่ละแถวถืองวดของวันที่ตัวเอง
// เอกสารที่คร่อมเดือนจึงลงตารางได้ถูกต้องโดยไม่ต้องให้ใครกรอกงวดตอนอัปโหลด
// และการอัปโหลดทับจะแทนที่เฉพาะงวดที่ไฟล์นั้นมีข้อมูลจริง ไม่ล้างทั้งตาราง
//
// วันที่ทุกตัวเป็น text รูป ISO อยู่แล้ว การตัดเจ็ดตัวแรกจึงเป็นการอ่านเดือน
// ตามที่พิมพ์อยู่บนเอกสาร ไม่ผ่าน Date object ที่ timezone เลื่อนวันได้

export const periodOf = (isoDate) => {
  const text = String(isoDate ?? "");
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : "";
};

/** งวดทั้งหมดที่ปรากฏในชุดวันที่ เรียงจากเก่าไปใหม่ ไม่ซ้ำ และไม่มีค่าว่าง */
export function periodsOf(dates) {
  return [...new Set((dates ?? []).map(periodOf).filter(Boolean))].sort();
}

/** เลื่อนงวดไปข้างหน้า (บวก) หรือถอยหลัง (ลบ) กี่เดือน */
export function shiftPeriod(period, months) {
  const [year, month] = String(period ?? "").split("-").map(Number);
  if (!year || !month) return "";
  const index = year * 12 + (month - 1) + Number(months || 0);
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** ทุกงวดตั้งแต่ from ถึง to รวมปลายทั้งสองข้าง */
export function periodRange(from, to) {
  if (!from || !to || from > to) return [from, to].filter(Boolean);
  const out = [];
  for (let period = from; period && period <= to; period = shiftPeriod(period, 1)) out.push(period);
  return out;
}

/**
 * งวดของ statement — อ่านจากรอบที่พิมพ์อยู่บนเอกสาร ไม่ใช่วันที่อัปโหลด
 * KBank พิมพ์ "01/07/2026 - 31/07/2026" ปีเป็น ค.ศ. เต็ม
 */
export function statementPeriod(statement) {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(statement?.cycle ?? "");
  if (match) return `${match[3]}-${match[2]}`;
  return periodsOf((statement?.lines ?? []).map((line) => line.date))[0] ?? "";
}

/** ช่วงงวดที่เอกสารหนึ่งฉบับครอบคลุม ใช้บอกผู้ใช้ว่าไฟล์นี้กินเดือนไหนบ้าง */
export function documentSpan(periods) {
  const sorted = [...new Set((periods ?? []).filter(Boolean))].sort();
  return { period: sorted[0] ?? "", periodStart: sorted[0] ?? "", periodEnd: sorted.at(-1) ?? "" };
}

const thaiMonths = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export function periodLabel(period) {
  const [year, month] = String(period ?? "").split("-").map(Number);
  if (!year || !month) return period || "—";
  return `${thaiMonths[month - 1]} ${year + 543}`;
}

/** งวดของ a อยู่คนละเดือนกับ b หรือเปล่า — ใช้ติดป้าย "ข้ามงวด" */
export const crossesPeriod = (left, right) => {
  const a = periodOf(left);
  const b = periodOf(right);
  return Boolean(a && b && a !== b);
};
