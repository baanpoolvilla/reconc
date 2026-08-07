import { normalizePaymentMethod, reconcile } from "./reconciliation.mjs";
import { DEFAULT_SETTLEMENT, normalizeSettlement, proposeSettlements } from "./settlements.mjs";

// การตั้งค่าของผู้ใช้ — ชั้นเดียวที่อยู่เหนือเอกสารต้นทาง
//
// เอกสารต้นทางไม่เคยถูกแก้ไข การตั้งค่าทำได้อย่างเดียวคือ "ไม่นำบางรายการเข้า
// กระทบยอด" แล้วสั่งให้เครื่องมือจับคู่คำนวณใหม่จากรายการที่เหลือ ทุกรายการที่ถูก
// ตัดออกยังเก็บไว้ครบพร้อมเหตุผลว่าถูกตัดด้วยกฎข้อไหน จึงตรวจย้อนกลับได้เสมอ
//
// ตรรกะทั้งหมดอยู่ในไฟล์นี้เหมือน reconciliation.mjs ส่วน settings.ts เป็นเพียง
// หน้ากากที่ใส่ type ให้ฝั่ง React

export const SETTINGS_VERSION = 1;

/** ค่าตั้งต้น: ตัดรายการของ Medina ทั้งหมด และรายการที่รับเงินเข้าช่องทาง Kbank-Posh */
export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  exclusions: {
    enabled: true,
    properties: ["Medina"],
    groups: [],
    methods: ["Kbank-Posh"],
    channels: [],
    bookingStatuses: [],
    keywords: [],
    excludeRefunds: false,
    minAmountSatang: null,
    maxAmountSatang: null,
  },
  matching: { allowManyToOne: true, allowOneToMany: true, maxGroupSize: 4 },
  settlement: DEFAULT_SETTLEMENT,
  display: { ledgerRowLimit: 300, showExcludedRows: false },
};

export const EXCLUSION_SCOPE_LABEL = {
  property: "กลุ่มทรัพย์สิน",
  group: "กลุ่มย่อย",
  method: "ช่องทางรับเงิน",
  channel: "ช่องทางการจอง",
  bookingStatus: "สถานะคำจอง",
  keyword: "คำค้น",
  refund: "รายการคืนเงิน",
  amount: "ช่วงยอดเงิน",
};

/** "Medina-บางแสน" → "Medina" — ชื่อกลุ่มทรัพย์สินคือส่วนหน้าเครื่องหมายขีด */
export function propertyOf(group) {
  return String(group ?? "").split(/[-–—]/)[0].trim();
}

// ── การอ่านค่าที่บันทึกไว้ ───────────────────────────────────────────────────

const asStringList = (value) =>
  Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : [];

const asBool = (value, fallback) => (typeof value === "boolean" ? value : fallback);

const asSatang = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/** เติมช่องที่ขาดด้วยค่าตั้งต้น — ไม่มีทางคืนค่าที่ใช้ไม่ได้ แม้ไฟล์นำเข้าจะเพี้ยน */
export function normalizeSettings(raw) {
  const source = raw ?? {};
  const exclusions = source.exclusions ?? {};
  const matching = source.matching ?? {};
  const display = source.display ?? {};

  return {
    version: SETTINGS_VERSION,
    exclusions: {
      enabled: asBool(exclusions.enabled, DEFAULT_SETTINGS.exclusions.enabled),
      properties: asStringList(exclusions.properties),
      groups: asStringList(exclusions.groups),
      methods: asStringList(exclusions.methods),
      channels: asStringList(exclusions.channels),
      bookingStatuses: asStringList(exclusions.bookingStatuses),
      keywords: asStringList(exclusions.keywords),
      excludeRefunds: asBool(exclusions.excludeRefunds, DEFAULT_SETTINGS.exclusions.excludeRefunds),
      minAmountSatang: asSatang(exclusions.minAmountSatang),
      maxAmountSatang: asSatang(exclusions.maxAmountSatang),
    },
    matching: {
      allowManyToOne: asBool(matching.allowManyToOne, DEFAULT_SETTINGS.matching.allowManyToOne),
      allowOneToMany: asBool(matching.allowOneToMany, DEFAULT_SETTINGS.matching.allowOneToMany),
      maxGroupSize: clamp(matching.maxGroupSize, 2, 6, DEFAULT_SETTINGS.matching.maxGroupSize),
    },
    settlement: normalizeSettlement(source.settlement),
    display: {
      ledgerRowLimit: clamp(display.ledgerRowLimit, 50, 5000, DEFAULT_SETTINGS.display.ledgerRowLimit),
      showExcludedRows: asBool(display.showExcludedRows, DEFAULT_SETTINGS.display.showExcludedRows),
    },
  };
}

// ── การตัดรายการ ─────────────────────────────────────────────────────────────

/**
 * กฎข้อแรกที่รายการนี้เข้าข่าย — คืน null เมื่อรายการนี้ต้องเข้ากระทบยอดตามปกติ
 * @returns {{scope: string, value: string} | null}
 */
export function receiptExclusion(receipt, settings, booking) {
  const rules = settings.exclusions;
  if (!rules.enabled) return null;

  const property = propertyOf(receipt.group);
  if (property && rules.properties.some((item) => item.toLowerCase() === property.toLowerCase())) {
    return { scope: "property", value: property };
  }
  if (receipt.group && rules.groups.includes(receipt.group)) {
    return { scope: "group", value: receipt.group };
  }
  const method = normalizePaymentMethod(receipt.method);
  const methodHit = rules.methods.find((item) => normalizePaymentMethod(item) === method);
  if (methodHit) return { scope: "method", value: methodHit };

  if (receipt.channel && rules.channels.includes(receipt.channel)) {
    return { scope: "channel", value: receipt.channel };
  }
  const status = booking?.status ?? "";
  if (status && rules.bookingStatuses.includes(status)) {
    return { scope: "bookingStatus", value: status };
  }
  if (rules.excludeRefunds && receipt.amountSatang < 0) {
    return { scope: "refund", value: "ยอดติดลบ" };
  }

  const amount = Math.abs(receipt.amountSatang);
  if (rules.minAmountSatang !== null && amount < rules.minAmountSatang) {
    return { scope: "amount", value: `ต่ำกว่า ${(rules.minAmountSatang / 100).toLocaleString("en-US")} บาท` };
  }
  if (rules.maxAmountSatang !== null && amount > rules.maxAmountSatang) {
    return { scope: "amount", value: `สูงกว่า ${(rules.maxAmountSatang / 100).toLocaleString("en-US")} บาท` };
  }

  if (rules.keywords.length) {
    const haystack = [
      receipt.guest, receipt.note, receipt.roomType, receipt.roomNumber,
      receipt.group, receipt.method, receipt.channel, receipt.reservationNo,
      booking?.guest, booking?.mobile,
    ].join(" ").toLowerCase();
    const keyword = rules.keywords.find((item) => haystack.includes(item.toLowerCase()));
    if (keyword) return { scope: "keyword", value: keyword };
  }

  return null;
}

/** จำนวนกฎที่เปิดใช้อยู่ ใช้บอกผู้ใช้ว่าตัวเลขบนหน้าจอถูกกรองอยู่กี่ชั้น */
export function countActiveRules(settings) {
  const rules = settings.exclusions;
  if (!rules.enabled) return 0;
  return (
    rules.properties.length + rules.groups.length + rules.methods.length +
    rules.channels.length + rules.bookingStatuses.length + rules.keywords.length +
    (rules.excludeRefunds ? 1 : 0) +
    (rules.minAmountSatang !== null ? 1 : 0) +
    (rules.maxAmountSatang !== null ? 1 : 0)
  );
}

// ── หน้าตั้งค่า: ตัวเลือกที่มีอยู่จริงในข้อมูล ──────────────────────────────

function tally(rows) {
  const buckets = new Map();
  for (const row of rows) {
    if (!row.key) continue;
    const bucket = buckets.get(row.key) ?? { value: row.key, count: 0, amountSatang: 0, note: row.note };
    bucket.count += 1;
    bucket.amountSatang += row.amountSatang;
    buckets.set(row.key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.amountSatang - a.amountSatang);
}

/** ตัวเลือกทั้งหมดที่ปรากฏในเอกสารต้นทาง พร้อมจำนวนรายการและยอดเงิน */
export function describeFacets(dataset) {
  const bookingIndex = new Map(dataset.bookings.map((booking) => [booking.reservationNo, booking]));
  const bankMethods = new Set(dataset.statements.map((statement) => normalizePaymentMethod(statement.method)));

  return {
    properties: tally(dataset.receipts.map((receipt) => ({ key: propertyOf(receipt.group), amountSatang: receipt.amountSatang }))),
    groups: tally(dataset.receipts.map((receipt) => ({ key: receipt.group, amountSatang: receipt.amountSatang }))),
    methods: tally(dataset.receipts.map((receipt) => ({
      key: receipt.method,
      amountSatang: receipt.amountSatang,
      note: bankMethods.has(normalizePaymentMethod(receipt.method)) ? "มี Statement" : "ไม่มี Statement",
    }))),
    channels: tally(dataset.receipts.map((receipt) => ({ key: receipt.channel, amountSatang: receipt.amountSatang }))),
    bookingStatuses: tally(dataset.receipts.map((receipt) => ({
      key: bookingIndex.get(receipt.reservationNo)?.status ?? "",
      amountSatang: receipt.amountSatang,
    }))),
  };
}

// ── ผลลัพธ์หลังใช้การตั้งค่า ─────────────────────────────────────────────────

/**
 * ใช้การตั้งค่ากับชุดข้อมูลดิบ แล้วกระทบยอดใหม่ทั้งรอบ
 * เอกสารต้นทางไม่ถูกแตะต้อง — ฟังก์ชันนี้คืนชุดข้อมูลใหม่เสมอ
 *
 * @param {Array} [decisions] คู่ที่ผู้ตรวจกดยืนยันเอง ถูกล็อกก่อนกฎอัตโนมัติทุกข้อ
 */
export function applySettings(dataset, settings, decisions = []) {
  const bookingIndex = new Map(dataset.bookings.map((booking) => [booking.reservationNo, booking]));
  const kept = [];
  const excluded = [];

  for (const receipt of dataset.receipts) {
    const hit = receiptExclusion(receipt, settings, bookingIndex.get(receipt.reservationNo));
    if (hit) excluded.push({ ...receipt, excludedBy: hit });
    else kept.push(receipt);
  }

  const core = { meta: dataset.meta, bookings: dataset.bookings, receipts: kept, statements: dataset.statements };
  // ไม่มีเอกสารต้นทาง = ไม่มีอะไรให้กระทบยอด เก็บผลเดิม (ที่ว่างอยู่แล้ว) ไว้
  const reconciliation = dataset.meta.sources.length
    ? reconcile(core, { ...settings.matching, decisions })
    : dataset.reconciliation;

  const buckets = new Map();
  for (const receipt of excluded) {
    const key = `${receipt.excludedBy.scope}:${receipt.excludedBy.value}`;
    const bucket = buckets.get(key) ?? { ...receipt.excludedBy, count: 0, amountSatang: 0 };
    bucket.count += 1;
    bucket.amountSatang += receipt.amountSatang;
    buckets.set(key, bucket);
  }

  const effective = { ...dataset, receipts: kept, reconciliation };

  return {
    dataset: effective,
    excluded,
    excludedSatang: excluded.reduce((sum, receipt) => sum + receipt.amountSatang, 0),
    buckets: [...buckets.values()].sort((a, b) => b.amountSatang - a.amountSatang),
    sourceReceiptCount: dataset.receipts.length,
    sourceReceiptSatang: dataset.receipts.reduce((sum, receipt) => sum + receipt.amountSatang, 0),
    activeRuleCount: countActiveRules(settings),
    // ก้อนโอน OTA ที่ยังไม่มีใครแตกยอด พร้อมชุดที่ระบบเสนอ — เป็นแค่ข้อเสนอ
    // ยังไม่มีผลกับตัวเลขใด จนกว่าผู้ตรวจจะกดยืนยัน
    settlements: dataset.meta.sources.length ? proposeSettlements(effective, reconciliation, settings.settlement) : [],
  };
}
