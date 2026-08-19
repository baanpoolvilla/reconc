import { normalizePaymentMethod, reconcile } from "./reconciliation.mjs";
import { DEFAULT_SETTLEMENT, normalizeSettlement, proposeSettlements } from "./settlements.mjs";
import { periodOf } from "./periods.mjs";
import { applyAccounts, normalizeAccounts, unmappedAccounts } from "./accounts.mjs";

// การตั้งค่าของผู้ใช้ — ชั้นเดียวที่อยู่เหนือเอกสารต้นทาง
//
// เอกสารต้นทางไม่เคยถูกแก้ไข การตั้งค่าทำได้อย่างเดียวคือ "ไม่นำบางรายการเข้า
// กระทบยอด" แล้วสั่งให้เครื่องมือจับคู่คำนวณใหม่จากรายการที่เหลือ ทุกรายการที่ถูก
// ตัดออกยังเก็บไว้ครบพร้อมเหตุผลว่าถูกตัดด้วยกฎข้อไหน จึงตรวจย้อนกลับได้เสมอ
//
// ตรรกะทั้งหมดอยู่ในไฟล์นี้เหมือน reconciliation.mjs ส่วน settings.ts เป็นเพียง
// หน้ากากที่ใส่ type ให้ฝั่ง React

export const SETTINGS_VERSION = 2;

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
  matching: {
    allowManyToOne: true,
    allowOneToMany: true,
    maxGroupSize: 4,
    // ค่าประกันวัน Check-in — 3,000 บาท เก็บเป็นสตางค์เหมือนเงินทุกจำนวนในระบบ
    // นี่คือที่เดียวที่จำนวนนี้ถูกเขียนไว้ เครื่องมือจับคู่รับมันมาเป็น option เสมอ
    securityDepositSatang: 300000,
    // สวิตช์ปิดกฎ R06 — แยกจากจำนวนเงิน เพราะการปิดกฎกับการตั้งจำนวนเป็นคนละเรื่อง
    // ปิดแล้วจำนวนที่ตั้งไว้ยังอยู่ครบ เปิดกลับมาก็ได้ค่าเดิม ไม่ต้องพิมพ์ใหม่
    securityDepositEnabled: true,
  },
  settlement: DEFAULT_SETTLEMENT,
  // บัญชีธนาคารที่ผูกกับช่องทางรับเงิน — ว่างไว้โดยตั้งใจ ระบบไม่รู้จักบัญชีของใคร
  // ล่วงหน้า และเอกสารที่อัปโหลดไว้แล้วพกช่องทางของตัวเองมาอยู่แล้ว การตั้งค่านี้
  // จึงเป็นการ "ทับ" สำหรับบัญชีใหม่ ไม่ใช่เงื่อนไขที่ทำให้ของเดิมพัง
  accounts: [],
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
      // ค่าที่บันทึกไว้ก่อนมีช่องนี้ไม่มีคีย์นี้เลย จึงได้ค่าตั้งต้นไป ไม่ใช่ศูนย์ —
      // การตั้งค่าเก่าใน localStorage หรือในฐานข้อมูลจึงไม่พังและไม่เปลี่ยนพฤติกรรมเงียบ ๆ
      // ขั้นต่ำหนึ่งบาท เพราะการปิดกฎมีสวิตช์ของตัวเองแล้ว จำนวนเงินจึงไม่ต้องรับหน้าที่นั้น
      securityDepositSatang: clamp(matching.securityDepositSatang, 100, 100000000, DEFAULT_SETTINGS.matching.securityDepositSatang),
      // ของเก่าที่ไม่มีคีย์นี้ = เปิดอยู่ เพราะกฎนี้ทำงานมาตั้งแต่ก่อนมีสวิตช์
      securityDepositEnabled: asBool(matching.securityDepositEnabled, DEFAULT_SETTINGS.matching.securityDepositEnabled),
    },
    settlement: normalizeSettlement(source.settlement),
    accounts: normalizeAccounts(source.accounts),
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
 * จำนวนค่าประกันที่เครื่องมือจับคู่ควรได้รับจริง — สวิตช์ปิดแปลเป็น 0 ตรงนี้ที่เดียว
 *
 * เครื่องมือจับคู่รู้จักแค่ "0 = กฎ R06 ไม่ทำงาน" อยู่แล้ว การตั้งค่าจึงไม่ต้องส่ง
 * ธงเพิ่มเข้าไป และจำนวนที่ผู้ใช้ตั้งไว้ยังถูกเก็บไว้ครบระหว่างที่กฎถูกปิด
 */
export function effectiveDepositSatang(settings) {
  const matching = settings?.matching ?? {};
  return matching.securityDepositEnabled === false ? 0 : matching.securityDepositSatang ?? 0;
}

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

  // ผูกช่องทางรับเงินตามที่ตั้งค่าไว้ก่อนกระทบยอด เปลี่ยนการผูกแล้วตัวเลขขยับทันที
  // โดยไม่ต้องอัปโหลดเอกสารซ้ำ
  const statements = applyAccounts(dataset.statements, settings.accounts);
  const core = { meta: dataset.meta, bookings: dataset.bookings, receipts: kept, statements };
  // ไม่มีเอกสารต้นทาง = ไม่มีอะไรให้กระทบยอด เก็บผลเดิม (ที่ว่างอยู่แล้ว) ไว้
  const reconciliation = dataset.meta.sources.length
    ? reconcile(core, { ...settings.matching, securityDepositSatang: effectiveDepositSatang(settings), decisions })
    : dataset.reconciliation;

  const buckets = new Map();
  for (const receipt of excluded) {
    const key = `${receipt.excludedBy.scope}:${receipt.excludedBy.value}`;
    const bucket = buckets.get(key) ?? { ...receipt.excludedBy, count: 0, amountSatang: 0 };
    bucket.count += 1;
    bucket.amountSatang += receipt.amountSatang;
    buckets.set(key, bucket);
  }

  const effective = { ...dataset, receipts: kept, statements, reconciliation };

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
    // บัญชีที่อัปโหลดเข้ามาแล้วแต่ยังไม่มีช่องทางรับเงินผูกไว้ — จับคู่ไม่ได้เลย
    // จนกว่าจะผูก หน้าจอต้องบอก ไม่ใช่ให้เห็นแค่ว่า "ไม่มี Statement"
    unmappedAccounts: unmappedAccounts(statements, settings.accounts),
  };
}

// ── การมองทีละงวด ────────────────────────────────────────────────────────────

export const ALL_PERIODS = "all";

/**
 * กลุ่มนี้ควรโผล่ในงวดที่กำลังดูอยู่หรือเปล่า
 *
 * กลุ่มหนึ่งแตะได้สองเดือน: เงินเข้าบัญชีเดือนหนึ่ง แต่รับเงินไว้อีกเดือนหนึ่ง
 * มันจึงต้องเห็นได้จากทั้งสองฝั่ง — เปิดกรกฎาคมแล้วต้องรู้ว่ารายการของกรกฎาคมใบนี้
 * เคลียร์ไปแล้วด้วยเงินที่เข้าเดือนสิงหาคม ไม่ใช่หายไปเฉย ๆ
 */
const touchesPeriod = (item, period) =>
  item.period === period || (item.sourcePeriods ?? []).includes(period);

/**
 * ตัดชุดข้อมูลที่คำนวณเสร็จแล้วให้เหลือเฉพาะงวดเดียว เพื่อแสดงผล
 *
 * การกระทบยอดทำครบทุกงวดพร้อมกันไปแล้วก่อนหน้านี้ — ต้องเป็นแบบนั้น ไม่งั้นเงินที่
 * ข้ามเดือนจะหาคู่ไม่เจอ ฟังก์ชันนี้ไม่คำนวณอะไรใหม่ แค่เลือกว่าจะโชว์อะไร แล้ว
 * รวมยอดของสิ่งที่โชว์
 *
 * ยอดเงินถูกนับใน "เดือนที่เงินเคลื่อนจริง" ส่วนจำนวนรายการนับใน "เดือนที่บันทึก
 * รับเงินไว้" สองอย่างนี้ตอบคนละคำถาม และการยุบให้เหลืออย่างเดียวคือที่มาของ
 * ตัวเลขที่กระทบยอดไม่ลง
 */
export function scopeToPeriod(effective, period) {
  if (!period || period === ALL_PERIODS) return effective;

  const { dataset } = effective;
  const { reconciliation } = dataset;

  const groups = reconciliation.groups.filter((group) => touchesPeriod(group, period));
  const exceptions = reconciliation.exceptions.filter((item) => item.period === period);
  const accounts = reconciliation.accounts.filter((item) => item.period === period);
  const outOfScope = reconciliation.outOfScope.filter((item) => item.period === period);
  const statements = dataset.statements.filter((item) => item.period === period);
  const receipts = dataset.receipts.filter((item) => periodOf(item.date) === period);
  const excluded = effective.excluded.filter((item) => periodOf(item.date) === period);
  const settlements = effective.settlements.filter((item) => touchesPeriod(item, period));

  const inPeriod = (rows) => rows.filter((row) => periodOf(row.receiptDate || row.bookingCreatedDate) === period);
  const matchedReceipts = groups.reduce((sum, group) => sum + inPeriod(group.receipts).length, 0);
  // เงินเข้าบัญชีในงวดนี้เท่านั้นที่นับเป็นยอดที่เคลียร์ในงวดนี้
  const landedHere = groups.filter((group) => group.period === period);
  const decided = groups.filter((group) => group.decision);
  const inScopeReceipts = accounts.reduce((sum, account) => sum + account.receiptCount, 0);

  // ยอดของเอกสารต้องเป็นยอดของงวดเดียวกับที่เหลือบนหน้าจอ ไม่งั้นการ์ดสามใบใน
  // หน้าตั้งค่าจะบวกกันไม่ลง — "ในเอกสาร" นับทุกงวด ส่วน "ไม่นับ" กับ "เข้าสู่การ
  // กระทบยอด" นับงวดเดียว ตัวเลขที่ขัดกันเองบนจอเดียวคือสิ่งที่ทำให้คนเลิกเชื่อทั้งหน้า
  const sourceReceipts = [...receipts, ...excluded];

  return {
    ...effective,
    excluded,
    excludedSatang: excluded.reduce((sum, item) => sum + item.amountSatang, 0),
    sourceReceiptCount: sourceReceipts.length,
    sourceReceiptSatang: sourceReceipts.reduce((sum, item) => sum + item.amountSatang, 0),
    settlements,
    dataset: {
      ...dataset,
      meta: { ...dataset.meta, period },
      receipts,
      statements,
      reconciliation: {
        ...reconciliation,
        accounts,
        groups,
        exceptions,
        outOfScope,
        summary: {
          ...reconciliation.summary,
          inScopeReceipts,
          matchedReceipts,
          matchedGroups: groups.length,
          exceptionCount: exceptions.length,
          matchRate: inScopeReceipts ? Number(((matchedReceipts / inScopeReceipts) * 100).toFixed(1)) : 0,
          matchedSatang: landedHere.reduce((sum, group) => sum + group.bankSatang, 0),
          unexplainedReceiptSatang: exceptions
            .filter((item) => item.receiptId)
            .reduce((sum, item) => sum + Math.abs(item.deltaSatang), 0),
          unexplainedBankSatang: exceptions
            .filter((item) => item.reason === "UNMATCHED_BANK_CREDIT")
            .reduce((sum, item) => sum + item.bankSatang, 0),
          decidedGroups: decided.length,
          decidedReceipts: decided.reduce((sum, group) => sum + inPeriod(group.receipts).length, 0),
          acceptedDifferenceSatang: decided
            .filter((group) => group.period === period)
            .reduce((sum, group) => sum + group.deltaSatang, 0),
          controlBalanced: statements.every((item) => item.controlDeltaSatang === 0),
          crossPeriodGroups: groups.filter((group) => group.crossPeriod).length,
          crossPeriodSatang: landedHere
            .filter((group) => group.crossPeriod)
            .reduce((sum, group) => sum + group.bankSatang, 0),
          missingStatements: outOfScope.filter((item) => item.reason === "MISSING_STATEMENT").length,
        },
      },
    },
  };
}
