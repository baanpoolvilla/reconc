import { dayGap, normalizePaymentMethod } from "./reconciliation.mjs";
import { crossesPeriod, periodOf } from "./periods.mjs";

// การแตกยอดก้อนโอนของ OTA
//
// Airbnb, Trip.com และ Booking.com ไม่ได้โอนทีละคำจอง แต่รวบหลายคำจองมาเป็นก้อน
// เดียวตามรอบของตัวเอง กฎ R02 (ยอดตรงพอดี) จึงจับไม่ได้ตามธรรมชาติ เพราะกฎนั้น
// เทียบทีละใบ ไม่ใช่ทีละก้อน — ไม่ใช่เพราะข้อมูลผิด
//
// ไฟล์นี้ไม่ตัดสินใจแทนใคร มันแค่ "เสนอ" ว่าก้อนนี้น่าจะประกอบด้วยรายการไหนบ้าง
// ผู้ตรวจเป็นคนกดยืนยันเสมอ
//
// นี่คือทางเดียวในระบบที่เงินข้ามเดือนได้ และเป็นทางที่ถูกต้อง: OTA รับเงินจาก
// ลูกค้าเดือนหนึ่งแล้วรอบโอนตกไปอีกเดือนหนึ่งเป็นเรื่องปกติของมัน ช่วงวันที่ตั้งต้น
// จึงกว้างพอจะคร่อมเดือน ส่วนกฎอัตโนมัติ (R01 วันเดียวกันเป๊ะ) ไม่ถูกผ่อนให้เลย
//
// v2 · แยกตามเจ้าของก้อน และหาชุดที่ยอด "ตรงพอดี" ก่อน
//
// ของเดิมเหมารวมทุก OTA เป็นกองเดียว: ก้อนของ Booking ดูดคำจอง Airbnb เข้ามาได้
// และวันที่ที่ใช้เทียบคือวันที่บันทึกรับเงิน ซึ่งไม่ใช่วันที่ OTA ใช้ตั้งรอบโอนเลย
// สองอย่างนี้ถูกแก้ตรงนี้
//
//   - ก้อนหนึ่งก้อนถูกอ่านว่าเป็นของเจ้าไหนจากข้อความบน statement แล้วมองเห็นเฉพาะ
//     คำจองที่รับเงินผ่านช่องทางของเจ้านั้น
//   - แต่ละเจ้ามี "วันตั้งต้น" ของตัวเอง — Trip.com กับ Booking.com นับจากวัน
//     Check-out ส่วน Airbnb นับจากวัน Check-in — และมีรอบโอนปกติของตัวเอง
//   - ชุดที่ยอดรวม "ตรงพอดี" ถูกหาก่อนเสมอ เพราะรายงานการรับเงินบันทึกยอดสุทธิ
//     ที่ OTA จะโอนจริงไว้แล้ว ก้อนส่วนใหญ่จึงตรงพอดีโดยไม่มีส่วนต่าง หาไม่เจอ
//     ค่อยถอยไปใช้แบบเดิม (ยอดเต็มท่วมก้อน แล้วส่วนต่างเป็นค่าคอม)
//
// ช่วงวันของแต่ละเจ้าไม่ได้ถูกใช้ "ตัด" คำจองทิ้ง มันถูกใช้จัดลำดับและติดป้ายว่า
// ใบไหนอยู่นอกรอบโอนปกติ ขอบนอกสุดยังเป็น windowDays เหมือนเดิม การตัดทิ้งเงียบ ๆ
// ด้วยกฎที่ผู้ตรวจมองไม่เห็นคือสิ่งที่ทำให้ไม่มีใครเชื่อข้อเสนอ

/**
 * รอบโอนของแต่ละ OTA ตามที่สังเกตได้จากเอกสารจริง
 *
 * `anchor` คือวันที่ OTA ใช้ตั้งรอบโอน ไม่ใช่วันที่เราบันทึกรับเงิน
 * `minLagDays`/`maxLagDays` คือรอบโอนที่ยอมรับได้ ส่วน `typicalLagDays` คือรอบ
 * ปกติที่ใช้จัดลำดับ — กว้างกว่าปกติไว้ก่อน เพราะก้อนที่มาเร็วกว่ารอบ (ลูกค้า
 * เช็คเอาท์แล้วโอนตามมาเลย) เกิดขึ้นจริงและต้องยังหาเจอ
 */
export const DEFAULT_PROVIDERS = [
  {
    id: "TRIP",
    label: "Trip.com",
    // ชื่อบัญชีต้นทางที่ Trip.com ใช้โอนเข้ามา — เห็นบน statement เป็น
    // "จาก SMART SCBT X9633 MCP Operating a++"
    patterns: ["MCP Operating"],
    methods: ["TRIPCOM COLLECT"],
    anchor: "checkOut",
    minLagDays: 0,
    maxLagDays: 14,
    typicalLagDays: [7, 10],
    note: "โอนหลังวันเช็คเอาท์ 7–10 วัน แต่เช็คเอาท์แล้วโอนตามมาเลยก็มี",
    // ชื่อที่พิมพ์ลงใบเสร็จรับเงิน — ว่างไว้แปลว่าใช้ label ระบบไม่รู้จักชื่อ
    // นิติบุคคลของ OTA เจ้าไหนล่วงหน้า และการเดาลงบนเอกสารที่ส่งออกไปคือความผิดพลาด
    payerName: "",
    taxId: "",
  },
  {
    id: "BOOKING",
    label: "Booking.com",
    // ท่อนหลังของรายละเอียดถูกห่อลงบรรทัดใหม่บน statement ("...(NRBA)(1)BOOKING.C")
    // ตัวอ่าน statement ต่อท่อนนั้นกลับมาแล้ว คำว่า BOOKING จึงจับได้ตรง ๆ
    patterns: ["BOOKING.C", "BOOKING"],
    methods: ["BOOKINGCOM COLLECT"],
    anchor: "checkOut",
    minLagDays: 0,
    maxLagDays: 14,
    typicalLagDays: [7, 10],
    note: "รอบเดียวกับ Trip.com คือนับจากวันเช็คเอาท์",
    payerName: "",
    taxId: "",
  },
  {
    id: "AIRBNB",
    label: "Airbnb",
    // Airbnb โอนเข้ามาเป็นธุรกรรมต่างประเทศ ไม่ใช่โอนในประเทศ จึงไม่มีชื่อผู้โอน
    // ให้จับ มีแต่เลข Trade Ref ของธนาคาร
    patterns: ["ธุรกรรมต่างประเทศ", "Trade Ref"],
    methods: ["AIRBNB COLLECT"],
    anchor: "checkIn",
    minLagDays: 0,
    maxLagDays: 3,
    typicalLagDays: [0, 1],
    note: "โอนวันรุ่งขึ้นของวันเช็คอิน หรือวันเดียวกันเลย",
    payerName: "",
    taxId: "",
  },
];

export const DEFAULT_SETTLEMENT = {
  enabled: true,
  // 45 วันคร่อมรอบโอนของ OTA ที่ตกเดือนถัดไปได้ทั้งรอบ โดยไม่กว้างจนคำจองของ
  // เดือนก่อนหน้าอีกชั้นถูกดูดเข้ามาด้วย — นี่คือขอบนอกสุด รอบของแต่ละเจ้าอยู่ข้างใน
  windowDays: 45,
  maxFeeRate: 30,
  // ต่างกันไม่เกินหนึ่งบาทคือการปัดเศษของฝั่งธนาคาร ไม่ใช่ค่าคอม
  roundingSatang: 100,
  providers: DEFAULT_PROVIDERS,
  // ข้อความที่บอกว่าเงินเข้าก้อนนี้มาจาก OTA แต่ไม่ได้บอกว่าเจ้าไหน — ก้อนแบบนี้
  // ยังถูกเสนอ เพียงแต่มองเห็นคำจองของทุกเจ้าและไม่มีรอบโอนให้อ้าง
  patterns: ["ธุรกรรมต่างประเทศ", "SMART SCBT", "NRBA", "MCP Operating"],
  // ช่องทางรับเงินฝั่งสมุดบัญชีที่ถือว่าเป็นเงินที่ OTA เก็บแทนเรา
  otaMethods: ["TRIPCOM COLLECT", "AIRBNB COLLECT", "BOOKINGCOM COLLECT"],
};

const ANCHORS = new Set(["checkIn", "checkOut", "date"]);

const uniqueStrings = (value, fallback) =>
  Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : fallback;

const clampInt = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/** เติมช่องที่ขาดของรอบโอนหนึ่งเจ้า — เจ้าที่ไม่มี id หรือไม่มีข้อความให้จับ ถูกทิ้ง */
function normalizeProvider(raw, fallback) {
  const source = raw ?? {};
  const base = fallback ?? {};
  const id = String(source.id ?? base.id ?? "").trim().toUpperCase();
  const patterns = uniqueStrings(source.patterns, base.patterns ?? []);
  const methods = uniqueStrings(source.methods, base.methods ?? []);
  if (!id || !patterns.length || !methods.length) return null;

  const minLagDays = clampInt(source.minLagDays, -30, 120, base.minLagDays ?? 0);
  const maxLagDays = Math.max(minLagDays, clampInt(source.maxLagDays, -30, 120, base.maxLagDays ?? 14));
  const typical = Array.isArray(source.typicalLagDays) ? source.typicalLagDays : base.typicalLagDays;
  const typicalLow = clampInt(typical?.[0], minLagDays, maxLagDays, minLagDays);
  const typicalHigh = Math.max(typicalLow, clampInt(typical?.[1], minLagDays, maxLagDays, maxLagDays));

  return {
    id,
    label: String(source.label ?? base.label ?? id),
    patterns,
    methods,
    anchor: ANCHORS.has(source.anchor) ? source.anchor : (base.anchor ?? "checkOut"),
    minLagDays,
    maxLagDays,
    typicalLagDays: [typicalLow, typicalHigh],
    note: String(source.note ?? base.note ?? ""),
    // ใช้ตอนออกใบเสร็จรับเงินเท่านั้น ไม่มีผลกับการจับคู่
    payerName: String(source.payerName ?? base.payerName ?? "").trim(),
    taxId: String(source.taxId ?? base.taxId ?? "").replace(/\D/g, "").slice(0, 13),
  };
}

export function normalizeSettlement(raw) {
  const source = raw ?? {};
  const byId = new Map(DEFAULT_PROVIDERS.map((item) => [item.id, item]));

  // การตั้งค่าที่บันทึกไว้ก่อนมีรอบโอนรายเจ้า ไม่มีคีย์นี้เลย จึงได้ค่าตั้งต้นไป
  // ไม่ใช่รายการว่าง — ของเดิมในฐานข้อมูลจึงไม่กลายเป็น "ไม่รู้จัก OTA เจ้าไหน" เงียบ ๆ
  const providers = Array.isArray(source.providers)
    ? source.providers.map((item) => normalizeProvider(item, byId.get(String(item?.id ?? "").toUpperCase()))).filter(Boolean)
    : DEFAULT_PROVIDERS.map((item) => normalizeProvider(item, item)).filter(Boolean);

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SETTLEMENT.enabled,
    // ถึง 120 วัน เพราะบาง OTA ปิดรอบรายเดือนแล้วโอนอีกสองสามสัปดาห์ให้หลัง
    windowDays: clampInt(source.windowDays, 0, 120, DEFAULT_SETTLEMENT.windowDays),
    maxFeeRate: clampInt(source.maxFeeRate, 0, 90, DEFAULT_SETTLEMENT.maxFeeRate),
    roundingSatang: clampInt(source.roundingSatang, 0, 10000, DEFAULT_SETTLEMENT.roundingSatang),
    providers,
    patterns: uniqueStrings(source.patterns, DEFAULT_SETTLEMENT.patterns),
    otaMethods: uniqueStrings(source.otaMethods, DEFAULT_SETTLEMENT.otaMethods),
  };
}

const haystackOf = (line) =>
  `${line.channel ?? ""} ${line.description ?? ""} ${line.detail ?? ""}`.toLowerCase();

const matchesAny = (haystack, patterns) =>
  patterns.some((pattern) => haystack.includes(pattern.toLowerCase()));

/** ก้อนโอนนี้เป็นของ OTA เจ้าไหน — null คือรู้ว่าเป็น OTA แต่ไม่รู้ว่าเจ้าไหน */
export function providerFor(line, settlement) {
  const haystack = haystackOf(line);
  return (settlement.providers ?? []).find((provider) => matchesAny(haystack, provider.patterns)) ?? null;
}

/** เงินเข้าก้อนนี้หน้าตาเหมือนก้อนโอนของ OTA หรือเปล่า */
export function looksLikeSettlement(line, settlement) {
  const haystack = haystackOf(line);
  return matchesAny(haystack, settlement.patterns ?? [])
    || (settlement.providers ?? []).some((provider) => matchesAny(haystack, provider.patterns));
}

/** ช่องทางรับเงินทั้งหมดที่ถือว่าเป็นเงินที่ OTA เก็บแทนเรา */
function otaMethodKeys(settlement) {
  return new Set([
    ...(settlement.otaMethods ?? []),
    ...(settlement.providers ?? []).flatMap((provider) => provider.methods),
  ].map(normalizePaymentMethod));
}

export function isOtaMethod(method, settlement) {
  return otaMethodKeys(settlement).has(normalizePaymentMethod(method));
}

/** ช่องทางรับเงินใบนี้เป็นของเจ้านี้หรือเปล่า */
export function isProviderMethod(method, provider) {
  const key = normalizePaymentMethod(method);
  return provider.methods.some((item) => normalizePaymentMethod(item) === key);
}

/** วันที่เจ้านี้ใช้ตั้งรอบโอน — ไม่มีวันนั้นในเอกสารก็ถอยไปใช้วันที่บันทึกรับเงิน */
export function anchorDateOf(receipt, provider) {
  const field = provider?.anchor ?? "date";
  return (field !== "date" && receipt[field]) || receipt.date;
}

/** ห่างจากรอบโอนปกติกี่วัน — 0 คือตรงรอบ ใช้จัดลำดับเท่านั้น ไม่ได้ใช้ตัดทิ้ง */
function typicalDrift(lag, provider) {
  if (!provider) return 0;
  const [low, high] = provider.typicalLagDays;
  if (lag < low) return low - lag;
  if (lag > high) return lag - high;
  return 0;
}

/**
 * ช่วงวันที่คำจองของก้อนนี้น่าจะเช็คอิน/เช็คเอาท์
 *
 * ก้อนโอนต้นเดือนของ Trip.com หรือ Booking.com เป็นของคำจองที่เช็คเอาท์ปลายเดือน
 * ก่อน เพราะรอบโอนห่าง 7–10 วัน รายงานการรับเงินของเดือนที่เงินเข้าจึงไม่มีวันมี
 * คำจองนั้น และผู้ตรวจไม่มีทางรู้ว่าต้องไปอัปโหลดรายงานของเดือนไหนมาเพิ่ม
 *
 * ย้อนรอบโอนกลับจากวันที่เงินเข้า ได้ช่วงวันที่ควรไปหา — และงวดของช่วงนั้น
 */
export function expectedStayWindow(line, provider) {
  if (!provider || !line?.date) return null;
  const [low, high] = provider.typicalLagDays;
  const shift = (days) => {
    const time = Date.parse(`${line.date}T00:00:00Z`) - days * 86400000;
    return new Date(time).toISOString().slice(0, 10);
  };
  // ยิ่งรอบยาว วันเข้าพักยิ่งย้อนไปไกล ขอบซ้ายจึงมาจาก lag ที่มากที่สุด
  const from = shift(Math.max(low, high));
  const to = shift(Math.min(low, high));
  return {
    anchor: provider.anchor,
    from,
    to,
    periods: [...new Set([periodOf(from), periodOf(to)].filter(Boolean))].sort(),
  };
}

const MAX_ROWS_PER_SETTLEMENT = 12;
const SEARCH_POOL = 24;
const SEARCH_BUDGET = 300000;
const MAX_EXACT_SOLUTIONS = 8;

/** ชุดที่น่าเชื่อกว่ามาก่อน: อยู่ในรอบโอนครบทุกใบ → ใบน้อยกว่า → ใกล้รอบปกติกว่า */
function rankSubset(subset, provider) {
  return [
    subset.filter((item) => !item.inPayoutWindow).length,
    subset.length,
    subset.reduce((sum, item) => sum + typicalDrift(item.lag, provider), 0),
  ];
}

function betterThan(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

/**
 * ชุดที่ยอดรวม "ตรงพอดี" กับก้อนที่เข้าบัญชี
 *
 * รายงานการรับเงินบันทึกยอดสุทธิที่ OTA จะโอนจริงไว้แล้ว (ค่าคอมถูกหักไปตั้งแต่
 * ฝั่ง OTA ก่อนจะมาถึงรายงาน) ก้อนส่วนใหญ่จึงตรงพอดีโดยไม่มีส่วนต่างเลย การหา
 * แบบนี้ก่อนคือความต่างระหว่าง "รู้ว่าใช่" กับ "เดาว่าน่าจะใช่แล้วเรียกส่วนต่างว่าค่าคอม"
 *
 * คืนชุดที่ดีที่สุดพร้อมจำนวนชุดที่เป็นไปได้ — มีมากกว่าหนึ่งชุดแปลว่าตัวเลข
 * ตัดสินให้ไม่ได้ ต้องให้คนดู ไม่ใช่ให้เครื่องเลือกเงียบ ๆ
 */
export function exactSubsets(candidates, target, provider) {
  const pool = candidates
    .filter((item) => item.receipt.amountSatang > 0 && item.receipt.amountSatang <= target)
    .slice(0, SEARCH_POOL)
    .sort((a, b) => b.receipt.amountSatang - a.receipt.amountSatang);

  const suffix = new Array(pool.length + 1).fill(0);
  for (let index = pool.length - 1; index >= 0; index -= 1) {
    suffix[index] = suffix[index + 1] + pool[index].receipt.amountSatang;
  }

  let best = null;
  let bestRank = null;
  let count = 0;
  let nodes = 0;

  const walk = (start, picked, sum) => {
    if (nodes > SEARCH_BUDGET || count >= MAX_EXACT_SOLUTIONS) return;
    nodes += 1;

    if (sum === target && picked.length) {
      count += 1;
      const rank = rankSubset(picked, provider);
      if (!best || betterThan(rank, bestRank)) {
        best = [...picked];
        bestRank = rank;
      }
      return; // เติมอีกใบมีแต่จะเกิน ทุกใบในกองเป็นบวก
    }
    if (picked.length >= MAX_ROWS_PER_SETTLEMENT || start >= pool.length) return;
    if (sum + suffix[start] < target) return; // ต่อให้เอาที่เหลือทั้งหมดก็ยังไม่ถึง

    for (let index = start; index < pool.length; index += 1) {
      if (sum + pool[index].receipt.amountSatang > target) continue;
      picked.push(pool[index]);
      walk(index + 1, picked, sum + pool[index].receipt.amountSatang);
      picked.pop();
      if (nodes > SEARCH_BUDGET || count >= MAX_EXACT_SOLUTIONS) return;
    }
  };

  walk(0, [], 0);
  return { best, count, exhausted: nodes > SEARCH_BUDGET };
}

/**
 * ชุดที่ยอดรวม "ท่วมก้อนโอนน้อยที่สุด" — ทางถอยเมื่อไม่มีชุดที่ตรงพอดี
 *
 * ใช้เมื่อ OTA หักอะไรบางอย่างก่อนโอนจริง ๆ หรือเมื่อคำจองบางใบของก้อนนี้อยู่ใน
 * เอกสารเดือนที่ยังไม่ได้อัปโหลด ในบรรดาชุดที่ท่วมก้อน ชุดที่เกินน้อยที่สุดคือชุด
 * ที่ส่วนต่างสมเหตุสมผลที่สุด
 */
export function bestSubset(candidates, target, provider) {
  const pool = candidates
    .filter((item) => item.receipt.amountSatang > 0)
    .slice(0, SEARCH_POOL)
    .sort((a, b) => b.receipt.amountSatang - a.receipt.amountSatang);

  const suffix = new Array(pool.length + 1).fill(0);
  for (let index = pool.length - 1; index >= 0; index -= 1) {
    suffix[index] = suffix[index + 1] + pool[index].receipt.amountSatang;
  }

  let best = null;
  let bestOver = Infinity;
  let bestRank = null;
  let nodes = 0;

  const walk = (start, picked, sum) => {
    if (nodes > SEARCH_BUDGET) return;
    nodes += 1;

    if (sum >= target) {
      const over = sum - target;
      const rank = rankSubset(picked, provider);
      if (over < bestOver || (over === bestOver && betterThan(rank, bestRank))) {
        bestOver = over;
        bestRank = rank;
        best = [...picked];
      }
      return; // เพิ่มอีกมีแต่จะเกินมากขึ้น
    }
    if (picked.length >= MAX_ROWS_PER_SETTLEMENT || start >= pool.length) return;
    if (sum + suffix[start] < target) return;

    for (let index = start; index < pool.length; index += 1) {
      picked.push(pool[index]);
      walk(index + 1, picked, sum + pool[index].receipt.amountSatang);
      picked.pop();
      if (nodes > SEARCH_BUDGET) return;
    }
  };

  walk(0, [], 0);
  return best;
}

/**
 * คำจองที่ก้อนนี้มองเห็น
 *
 * ก้อนที่รู้ว่าเป็นของเจ้าไหน เห็นเฉพาะคำจองที่รับเงินผ่านช่องทางของเจ้านั้น —
 * ก้อนของ Booking จะไม่ดูดคำจอง Airbnb เข้ามาอีกต่อไป ส่วนก้อนที่อ่านไม่ออกว่า
 * เป็นของใคร ยังเห็นทุกเจ้าเหมือนเดิม ดีกว่าไม่เสนออะไรเลย
 */
export function candidatesFor(line, receipts, provider, settlement) {
  return receipts
    .filter((receipt) => (provider ? isProviderMethod(receipt.method, provider) : isOtaMethod(receipt.method, settlement)))
    .map((receipt) => {
      const anchorDate = anchorDateOf(receipt, provider);
      const lag = dayGap(line.date, anchorDate);
      return {
        receipt,
        anchorDate,
        // ห่างจากวันที่บันทึกรับเงินกี่วัน — ขอบนอกสุดยังวัดด้วยตัวนี้เหมือนเดิม
        gap: dayGap(receipt.date, line.date),
        // ห่างจากวันตั้งต้นของเจ้านี้กี่วัน คือรอบโอนจริงที่ผู้ตรวจอยากเห็น
        lag,
        inPayoutWindow: provider ? lag >= provider.minLagDays && lag <= provider.maxLagDays : true,
      };
    })
    // ทิศทางของเวลาเป็นข้อเท็จจริง ไม่ใช่ธรรมเนียม: OTA โอนเงินหลังแขกเช็คอิน
    // หรือเช็คเอาท์แล้วเสมอ ไม่มีทางโอนล่วงหน้าให้คำจองที่ยังไม่เกิด ก่อนหน้านี้
    // ขอบเขตวัดจากวันที่บันทึกรับเงินอย่างเดียว ก้อนต้นเดือนจึงกวาดคำจองของ
    // เดือนถัดไปมาประกอบเป็นชุดที่ "ยอดตรงพอดี" ได้ ทั้งที่เป็นไปไม่ได้เลย
    //
    // ส่วนความยาวของรอบโอนเป็นธรรมเนียมของแต่ละเจ้า ไม่ใช่ข้อเท็จจริง มันจึงได้
    // แค่จัดลำดับและติดป้าย (inPayoutWindow) ไม่ได้ตัดใครทิ้ง — ขอบบนที่ตัดจริง
    // ยังเป็น windowDays ซึ่งกว้างพอให้รอบที่ปิดช้าข้ามเดือนได้
    .filter(({ gap, lag }) =>
      Math.abs(gap) <= settlement.windowDays
      && lag >= (provider?.minLagDays ?? 0)
      && lag <= settlement.windowDays)
    .sort((a, b) =>
      Number(b.inPayoutWindow) - Number(a.inPayoutWindow)
      || typicalDrift(a.lag, provider) - typicalDrift(b.lag, provider)
      || Math.abs(a.gap) - Math.abs(b.gap)
      || b.receipt.amountSatang - a.receipt.amountSatang);
}

/**
 * ประกอบข้อเสนอสำหรับก้อนโอนหนึ่งก้อน
 *
 * หาชุดที่ยอดตรงพอดีก่อน ไม่เจอค่อยถอยไปหาชุดที่ท่วมก้อนน้อยที่สุด ไม่เจอทั้งสอง
 * แบบ (เงินเข้ามากกว่ายอดที่บันทึกไว้ทั้งหมด) ก็เสนอทุกรายการไปก่อนแล้วให้สถานะ
 * เป็น "หาคำจองไม่พอ" ให้ผู้ตรวจดู แทนที่จะเงียบ
 */
export function proposeForLine(line, account, receipts, settlement) {
  const provider = providerFor(line, settlement);
  const inWindow = candidatesFor(line, receipts, provider, settlement);

  // คำจองที่เข้าเงื่อนไขของก้อนนี้ทุกอย่าง แต่ถูกการตั้งค่าตัดออกไปก่อนถึงมือ
  // เครื่องมือจับคู่
  //
  // จากข้างนอก ใบที่ถูกตัดด้วยการตั้งค่ากับใบที่ไม่มีอยู่จริง หน้าตาเหมือนกันเป๊ะ —
  // ก้อนขึ้นว่า "ไม่พบคำจอง" ทั้งคู่ ต่างกันตรงที่อันหนึ่งแก้ได้ในสามวินาทีถ้ารู้
  // อีกอันต้องไปตามเอกสาร การไม่บอกความต่างนี้คือการให้คนไล่หาผิดทางทั้งวัน
  const excludedNearby = candidatesFor(line, settlement.excludedReceipts ?? [], provider, settlement);

  const exact = exactSubsets(inWindow, line.amountSatang, provider);
  const chosen = exact.best ?? bestSubset(inWindow, line.amountSatang, provider);
  const picked = chosen ? chosen.map((item) => item.receipt.id) : inWindow.map((item) => item.receipt.id);

  return buildProposal(line, account, inWindow, picked, settlement, {
    provider,
    exactCount: exact.count,
    searchExhausted: exact.exhausted,
    knownPeriods: settlement.knownPeriods ?? [],
    excludedNearby,
  });
}

/** สรุปตัวเลขของข้อเสนอตามรายการที่เลือกไว้ — ใช้ซ้ำได้ทุกครั้งที่ผู้ใช้ติ๊กเพิ่ม/ออก */
export function buildProposal(line, account, candidates, selectedIds, settlement, context = {}) {
  const provider = context.provider ?? null;
  const selected = new Set(selectedIds);
  const rows = candidates.map(({ receipt, gap, lag, anchorDate, inPayoutWindow }) => ({
    id: receipt.id,
    reservationNo: receipt.reservationNo,
    guest: receipt.guest,
    method: receipt.method,
    channel: receipt.channel,
    date: receipt.date,
    checkIn: receipt.checkIn,
    checkOut: receipt.checkOut,
    roomType: receipt.roomType,
    group: receipt.group,
    amountSatang: receipt.amountSatang,
    dayGap: gap,
    // วันที่เจ้านี้ใช้ตั้งรอบโอน และห่างจากวันนั้นกี่วัน
    anchorDate: anchorDate ?? receipt.date,
    lagDays: lag ?? gap,
    inPayoutWindow: inPayoutWindow !== false,
    period: periodOf(receipt.date),
    // รับเงินไว้คนละเดือนกับที่ก้อนโอนเข้าบัญชี — ปกติของ OTA แต่ต้องเห็นชัด
    crossPeriod: crossesPeriod(receipt.date, line.date),
    selected: selected.has(receipt.id),
  }));

  const picked = rows.filter((row) => row.selected);
  const grossSatang = picked.reduce((sum, row) => sum + row.amountSatang, 0);
  const netSatang = line.amountSatang;
  const feeSatang = grossSatang - netSatang;
  const feeRate = grossSatang > 0 ? (feeSatang / grossSatang) * 100 : 0;
  const rounding = settlement.roundingSatang ?? 0;

  // ส่วนต่างบอกว่าข้อเสนอนี้เป็นชนิดไหน ซึ่งเป็นคนละคำถามกับว่ามันพร้อมยืนยันไหม
  const matchKind = !picked.length ? "NONE"
    : feeSatang === 0 ? "EXACT"
    : feeSatang < 0 ? "SHORT"
    : feeSatang <= rounding ? "ROUNDING"
    : "FEE";

  // สถานะบอกว่าข้อเสนอนี้ "พร้อมยืนยัน" หรือ "ต้องดูก่อน" — ไม่ใช่ผ่าน/ไม่ผ่าน
  const status = matchKind === "NONE" ? "EMPTY"
    : matchKind === "SHORT" ? "SHORT"
    : matchKind === "EXACT" ? "EXACT"
    : feeRate > settlement.maxFeeRate ? "FEE_HIGH"
    : "READY";

  const outOfWindow = picked.filter((row) => !row.inPayoutWindow);

  // ก้อนที่หาคำจองไม่พบ/ไม่พอ และช่วงวันเข้าพักของมันตกอยู่ในงวดที่ยังไม่มีข้อมูล
  // ในระบบ — นั่นไม่ใช่ข้อผิดพลาด แต่คือ "เอกสารยังมาไม่ครบ" ซึ่งพักไว้ได้
  // สรุปว่าใบที่เข้าเงื่อนไขแต่ถูกตัดออก ถูกตัดด้วยกฎข้อไหนบ้าง
  const excludedBuckets = new Map();
  for (const { receipt } of context.excludedNearby ?? []) {
    const hit = receipt.excludedBy;
    if (!hit) continue;
    const key = `${hit.scope}:${hit.value}`;
    const bucket = excludedBuckets.get(key) ?? { ...hit, count: 0, amountSatang: 0 };
    bucket.count += 1;
    bucket.amountSatang += receipt.amountSatang;
    excludedBuckets.set(key, bucket);
  }
  const excludedCandidates = [...excludedBuckets.values()].sort((a, b) => b.amountSatang - a.amountSatang);

  const stay = expectedStayWindow(line, provider);
  const known = new Set(context.knownPeriods ?? []);
  const missingPeriods = (stay?.periods ?? []).filter((item) => !known.has(item));
  const suggestHold = (status === "EMPTY" || status === "SHORT") && missingPeriods.length > 0;

  return {
    id: `SET-${line.id}`,
    lineId: line.id,
    account,
    date: line.date,
    period: periodOf(line.date),
    // OTA เจ้าของก้อนนี้ — ว่างคือ statement ไม่ได้บอกว่าเป็นของเจ้าไหน
    providerId: provider?.id ?? "",
    providerLabel: provider?.label ?? "",
    anchorField: provider?.anchor ?? "",
    // งวดที่รายการในก้อนนี้ถูกบันทึกรับเงินไว้ — มีมากกว่าหนึ่งคือก้อนที่เหลื่อมเดือน
    sourcePeriods: [...new Set(picked.map((row) => row.period).filter(Boolean))].sort(),
    crossPeriod: picked.some((row) => row.crossPeriod),
    time: line.time,
    description: line.description,
    channel: line.channel,
    detail: line.detail,
    netSatang,
    grossSatang,
    feeSatang,
    feeRate: Number(feeRate.toFixed(2)),
    matchKind,
    status,
    // มีชุดที่ยอดตรงพอดีมากกว่าหนึ่งชุด — ตัวเลขตัดสินให้ไม่ได้ ต้องให้คนเลือก
    exactCount: context.exactCount ?? 0,
    ambiguous: (context.exactCount ?? 0) > 1,
    // ใบที่ถูกเลือกแต่วันโอนไม่เข้ารอบปกติของเจ้านี้ — เสนอได้ แต่ต้องบอก
    outOfWindowCount: outOfWindow.length,
    lagDays: picked.map((row) => row.lagDays),
    // ช่วงวันเข้าพักที่คำจองของก้อนนี้น่าจะอยู่ และงวดที่ยังไม่มีข้อมูลในระบบ
    expectedStay: stay,
    missingPeriods,
    suggestHold,
    // ใบที่เข้าเงื่อนไขของก้อนนี้ แต่การตั้งค่าตัดออกไปก่อน — คนละเรื่องกับหาไม่เจอ
    excludedCandidates,
    excludedCount: excludedCandidates.reduce((sum, item) => sum + item.count, 0),
    excludedSatang: excludedCandidates.reduce((sum, item) => sum + item.amountSatang, 0),
    candidates: rows,
    selectedIds: picked.map((row) => row.id),
  };
}

/**
 * ก้อนโอน OTA ทุกก้อนที่ยังไม่มีใครจับ พร้อมข้อเสนอของแต่ละก้อน
 *
 * รายการรับเงินหนึ่งใบถูกเสนอให้ก้อนเดียวเท่านั้น และลำดับการจองสิทธิ์สำคัญมาก:
 * ถ้าไล่ตามวันอย่างเดียว ก้อนต้นเดือนที่หาชุดตรงพอดีไม่ได้ (เพราะคำจองของมันอยู่
 * ในเอกสารเดือนก่อนที่ยังไม่ได้อัปโหลด) จะคว้าใบที่ก้อนปลายเดือนตรงพอดีไปใช้
 * เป็นส่วนหนึ่งของชุดที่ "ท่วมก้อนน้อยที่สุด" แล้วทั้งสองก้อนก็ผิดพร้อมกัน
 *
 * จึงแบ่งเป็นสองรอบ: รอบแรกให้เฉพาะก้อนที่มีชุดยอดตรงพอดีอยู่ชุดเดียว —
 * หลักฐานแน่นที่สุดที่มี — จองใบของตัวเองก่อน รอบสองที่เหลือค่อยเลือกจากใบที่ยังว่าง
 */
export function proposeSettlements(dataset, reconciliation, settlement) {
  if (!settlement.enabled) return [];

  const usedReceipts = new Set(reconciliation.groups.flatMap((group) => group.receipts.map((row) => row.id)));
  const usedLines = new Set(reconciliation.groups.flatMap((group) => group.lines.map((row) => row.id)));
  // ก้อนที่พักไว้ออกจากคิวแล้ว จึงไม่ถูกเสนอซ้ำ และไม่จองคำจองของก้อนอื่นไปด้วย
  const held = new Set(settlement.heldLineIds ?? []);

  const openOta = dataset.receipts.filter(
    (receipt) => isOtaMethod(receipt.method, settlement) && !usedReceipts.has(receipt.id) && receipt.amountSatang > 0,
  );

  const lines = [];
  for (const statement of dataset.statements) {
    for (const line of statement.lines) {
      if (line.direction !== "credit" || usedLines.has(line.id) || held.has(line.id)) continue;
      if (!looksLikeSettlement(line, settlement)) continue;
      lines.push({ line, account: statement.code });
    }
  }
  lines.sort((a, b) => a.line.date.localeCompare(b.line.date) || b.line.amountSatang - a.line.amountSatang);

  const claimed = new Set();
  const settled = new Map();

  const propose = ({ line, account }) => {
    const available = openOta.filter((receipt) => !claimed.has(receipt.id));
    const proposal = proposeForLine(line, account, available, settlement);
    for (const id of proposal.selectedIds) claimed.add(id);
    settled.set(line.id, proposal);
    return proposal;
  };

  for (const entry of lines) {
    const proposal = proposeForLine(
      entry.line,
      entry.account,
      openOta.filter((receipt) => !claimed.has(receipt.id)),
      settlement,
    );
    if (isConfident(proposal)) {
      for (const id of proposal.selectedIds) claimed.add(id);
      settled.set(entry.line.id, proposal);
    }
  }
  for (const entry of lines) {
    if (!settled.has(entry.line.id)) propose(entry);
  }

  return lines.map((entry) => settled.get(entry.line.id));
}

/** ก้อนที่พร้อมยืนยันโดยไม่ต้องคิดต่อ — ยอดตรงพอดี ชุดเดียว และอยู่ในรอบโอน */
export function isConfident(proposal) {
  return proposal.status === "EXACT" && !proposal.ambiguous && proposal.outOfWindowCount === 0;
}

/** ยอดรวมของงาน OTA ที่ยังค้าง ใช้โชว์บนหน้าแรก */
export function settlementTotals(proposals) {
  return {
    count: proposals.length,
    netSatang: proposals.reduce((sum, item) => sum + item.netSatang, 0),
    exactCount: proposals.filter((item) => item.status === "EXACT").length,
    confidentCount: proposals.filter(isConfident).length,
    readyCount: proposals.filter((item) => item.status === "EXACT" || item.status === "READY").length,
    needsReviewCount: proposals.filter((item) => item.status !== "EXACT" && item.status !== "READY").length,
    ambiguousCount: proposals.filter((item) => item.ambiguous).length,
    crossPeriodCount: proposals.filter((item) => item.crossPeriod).length,
  };
}
