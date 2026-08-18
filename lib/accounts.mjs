// บัญชีธนาคารที่ระบบรู้จัก
//
// เอกสารบอกได้แค่ "นี่คือบัญชีเลขที่ 199-1-33588-5" ส่วนที่ว่าบัญชีนั้นตรงกับ
// ช่องทางรับเงินชื่ออะไรในรายงานของ PMS เป็นความรู้ที่ไม่มีอยู่ในเอกสารทั้งสองฝั่ง
// เดาไม่ได้ และไม่ควรเดา — รหัส "885" ไม่ได้อยู่ในเลขที่บัญชี 199-1-33588-5 เลย
// มันเป็นชื่อที่คนที่นี่ใช้เรียกกันเอง
//
// การผูกนี้จึงเป็นการตั้งค่า ไม่ใช่โค้ด เพิ่มบัญชีหรือเปลี่ยนธนาคารทำได้จากหน้าตั้งค่า
// และเมื่อเปลี่ยน ระบบกระทบยอดใหม่ทันทีโดยไม่ต้องอัปโหลดเอกสารซ้ำ

/** เทียบเลขที่บัญชีโดยไม่สนขีดหรือช่องว่าง — ธนาคารพิมพ์ไม่เหมือนกันทุกที่ */
export const accountDigits = (value) => String(value ?? "").replace(/\D/g, "");

export function normalizeAccount(raw) {
  const source = raw ?? {};
  const text = (value) => String(value ?? "").trim();
  return {
    accountNo: text(source.accountNo),
    code: text(source.code),
    method: text(source.method),
    label: text(source.label),
  };
}

/** รายการบัญชีที่ใช้ได้ — ต้องมีเลขที่บัญชี ไม่งั้นไม่มีอะไรให้จับคู่กับเอกสาร */
export function normalizeAccounts(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw.map(normalizeAccount)) {
    const key = accountDigits(item.accountNo);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** บัญชีที่ตรงกับ statement ฉบับนี้ — เทียบด้วยเลขที่บัญชีเท่านั้น */
export function accountFor(accounts, statement) {
  const wanted = accountDigits(statement?.accountNo);
  if (!wanted) return null;
  return (accounts ?? []).find((item) => accountDigits(item.accountNo) === wanted) ?? null;
}

/**
 * ช่องทางรับเงินที่ statement ฉบับนี้ควรใช้จับคู่
 *
 * ถ้ายังไม่ได้ผูกไว้ ให้ใช้ค่าที่ติดมากับเอกสารตอนอัปโหลด — เอกสารที่เข้าระบบไว้
 * ก่อนมีหน้าตั้งค่านี้จึงทำงานต่อได้เหมือนเดิม การตั้งค่าเป็นการ "ทับ" ไม่ใช่
 * เงื่อนไขบังคับที่ทำให้ของเดิมพัง
 */
export function methodFor(accounts, statement) {
  return accountFor(accounts, statement)?.method || statement?.method || "";
}

/** ผูกช่องทางรับเงินตามการตั้งค่าให้ statement ทุกฉบับ ก่อนส่งเข้าเครื่องมือจับคู่ */
export function applyAccounts(statements, accounts) {
  if (!accounts?.length) return statements;
  return statements.map((statement) => {
    const method = methodFor(accounts, statement);
    return method === statement.method ? statement : { ...statement, method };
  });
}

/**
 * บัญชีที่โผล่ในเอกสารแล้ว แต่ยังไม่มีใครผูกช่องทางรับเงินให้
 *
 * บัญชีที่ยังไม่ผูกจะจับคู่กับรายการรับเงินไม่ได้เลย หน้าจอต้องบอกให้รู้ ไม่ใช่
 * ปล่อยให้เห็นแค่ว่า "ไม่มี Statement" ทั้งที่อัปโหลดไปแล้ว
 */
export function unmappedAccounts(statements, accounts) {
  const known = new Set((accounts ?? []).filter((item) => item.method).map((item) => accountDigits(item.accountNo)));
  const seen = new Map();

  for (const statement of statements ?? []) {
    const key = accountDigits(statement.accountNo);
    if (!key || known.has(key) || seen.has(key)) continue;
    // ค่าที่ติดมากับเอกสารยังใช้ได้อยู่ ถือว่าผูกแล้วโดยปริยาย
    if (statement.method) continue;
    seen.set(key, {
      accountNo: statement.accountNo,
      code: statement.suffix ?? "",
      bankLabel: statement.bankLabel ?? "",
      accountName: statement.accountName ?? "",
    });
  }
  return [...seen.values()];
}
