import { periodOf, statementPeriod } from "./periods.mjs";

// Reconciliation engine — ruleset v3.2.0
//
// Automatic matching obeys two hard rules, without exception:
//   1. วันที่สร้างคำจอง (booking creation date, from the ledger) must be the SAME
//      calendar day as the bank statement credit date.
//   2. The amount must be exactly equal. Tolerance is zero.
//
// A reviewer may override the outcome for specific rows by recording a decision
// (R00). A decision does not relax the rules for anything else: it applies to
// exactly the rows it names, carries the reviewer's reason, and reports the
// difference it accepted instead of hiding it. The engine still never edits a
// source document, and never invents a match on its own.
//
// v3.1.0 · หลายงวดในฐานข้อมูลเดียว
// ข้อมูลไม่ได้มีเดือนเดียวอีกต่อไป กฎสองข้อข้างบนไม่เปลี่ยน — วันเดียวกันก็ยังต้อง
// เป็นวันเดียวกัน — แต่แต่ละรายการรับเงินถูกผูกกับ statement ของ "บัญชี + งวด"
// เดียวเท่านั้น ไม่งั้นเดือนที่โหลดพร้อมกันจะนับข้อยกเว้นซ้ำกันเอง
// ส่วนเงินที่ข้ามเดือนจริง ๆ (OTA โอนหลังหักคอมในเดือนถัดไป) ยังเดินผ่านทาง
// settlement + การยืนยันของคน เหมือนเดิม ไม่มีกฎอัตโนมัติข้อไหนข้ามเดือนให้

// v3.2.0 · ค่าประกันวัน Check-in (R06)
// ลูกค้าโอนค่าห้องพร้อมค่าประกันมาเป็นก้อนเดียวตอนเข้าพัก กฎใหม่จับคู่ก้อนนั้นเมื่อ
// ส่วนต่างเท่ากับค่าประกันที่ผู้ใช้ตั้งไว้พอดี และทุกวันเกี่ยวข้องตรงกับวัน Check-in
// จำนวนค่าประกันมาจากการตั้งค่าเสมอ ไม่มีตัวเลขไหนเขียนไว้ในไฟล์นี้ และค่าประกัน
// ไม่เคยถูกบวกเข้ายอดของเอกสารฝั่งไหน มันถูกเก็บเป็นคำอธิบายของผลการกระทบยอด

export const RULESET_VERSION = "3.2.0";

export const RULES = [
  { id: "R00", label: "การตัดสินใจของผู้ตรวจมาก่อน", detail: "คู่ที่คนกดยืนยันเองถูกล็อกไว้ พร้อมเหตุผลและผลต่างที่ยอมรับ", score: 100 },
  { id: "R01", label: "วันที่สร้างคำจอง = วันที่เงินเข้า Statement", detail: "เทียบเป็นวันปฏิทินเดียวกันเท่านั้น ไม่มี date window", blocking: true },
  { id: "R02", label: "ยอดต้องตรงกันพอดี", detail: "ผลต่างต้องเป็น ฿0.00 ไม่มี tolerance", blocking: true },
  { id: "R03", label: "จับคู่ 1:1", detail: "หนึ่งรายการรับเงิน = หนึ่งยอดเงินเข้า", score: 100 },
  { id: "R04", label: "จับคู่ N:1", detail: "ผลรวมหลายรายการรับเงินในวันเดียวกัน = หนึ่งยอดเงินเข้า", score: 95 },
  { id: "R05", label: "จับคู่ 1:N", detail: "หนึ่งรายการรับเงิน = ผลรวมหลายยอดเงินเข้าในวันเดียวกัน", score: 92 },
  { id: "R06", label: "ค่าประกันวัน Check-in", detail: "เงินเข้า = ค่าห้อง + ค่าประกัน เมื่อรับเงินและเงินเข้าตรงกับวัน Check-in", score: 90 },
  { id: "R07", label: "ที่เหลือเป็นข้อยกเว้น", detail: "ระบบไม่จับคู่ให้อัตโนมัติและไม่แก้ไขข้อมูลต้นฉบับ", blocking: true },
];

export const EXCEPTION_REASONS = {
  MISSING_BOOKING: { label: "ไม่พบคำจองในบัญชีแยกประเภท", severity: "high" },
  DATE_RULE_UNMET: { label: "ไม่มีเงินเข้า Statement ในวันที่สร้างคำจอง", severity: "high" },
  AMOUNT_MISMATCH: { label: "มีเงินเข้าวันเดียวกันแต่ยอดไม่ตรง", severity: "high" },
  UNMATCHED_BANK_CREDIT: { label: "เงินเข้า Statement ที่ยังไม่มีรายการรับเงินรองรับ", severity: "medium" },
  REFUND_LINE: { label: "รายการคืนเงิน ต้องกระทบกับยอดถอน", severity: "medium" },
};

/** เหตุผลที่ผู้ตรวจเลือกได้เมื่อยืนยันคู่ที่ยอดไม่เท่ากันพอดี */
export const DECISION_REASONS = {
  COMMISSION: { label: "ค่าคอมมิชชั่น OTA", detail: "OTA โอนมาหลังหักค่าคอมแล้ว" },
  BANK_FEE: { label: "ค่าธรรมเนียมธนาคาร", detail: "ค่าโอน ค่าธรรมเนียมต่างประเทศ" },
  ROUNDING: { label: "ปัดเศษ", detail: "ต่างกันไม่กี่สตางค์" },
  DISCOUNT: { label: "ส่วนลดที่ให้ลูกค้า", detail: "รับจริงน้อยกว่ายอดที่บันทึกไว้" },
  EXTRA_CHARGE: { label: "เก็บเพิ่มหน้างาน", detail: "รับจริงมากกว่ายอดที่บันทึกไว้" },
  OTHER: { label: "อื่น ๆ", detail: "ต้องเขียนหมายเหตุกำกับ" },
};

const MAX_GROUP_SIZE = 4;

// The two hard rules are never configurable. What a reviewer may turn off is only
// which *shapes* of match the engine looks for, and how many rows one group spans.
export const DEFAULT_MATCH_OPTIONS = {
  maxGroupSize: MAX_GROUP_SIZE,
  allowManyToOne: true,
  allowOneToMany: true,
  // จำนวนค่าประกันไม่มีค่าตั้งต้นในเครื่องมือจับคู่ มันเป็นตัวเลขทางธุรกิจที่ผู้ใช้
  // ตั้งเอง จึงอยู่ใน DEFAULT_SETTINGS ที่เดียว ถ้าไม่มีใครส่งมา กฎ R06 ก็ไม่ทำงาน
  // แทนที่จะเดาจำนวนเงินขึ้นมาเอง
  securityDepositSatang: 0,
  decisions: [],
};

function matchOptions(options) {
  const merged = { ...DEFAULT_MATCH_OPTIONS, ...(options ?? {}) };
  return {
    maxGroupSize: Math.min(6, Math.max(2, Number(merged.maxGroupSize) || MAX_GROUP_SIZE)),
    allowManyToOne: merged.allowManyToOne !== false,
    allowOneToMany: merged.allowOneToMany !== false,
    // สตางค์เสมอ และต้องเป็นจำนวนเต็มบวก ค่าที่ใช้ไม่ได้ = ปิดกฎ ไม่ใช่เดาตัวเลขแทน
    securityDepositSatang: Math.max(0, Math.round(Number(merged.securityDepositSatang) || 0)),
    decisions: Array.isArray(merged.decisions) ? merged.decisions : [],
  };
}

const methodAliases = new Map([
  ["BOOKINGCOMCOLLECT", "BOOKING_COLLECT"],
  ["BOOKINGCOLLECT", "BOOKING_COLLECT"],
  ["TRIPCOMCOLLECT", "TRIP_COLLECT"],
  ["TRIPCOLLECT", "TRIP_COLLECT"],
  ["AIRBNBCOLLECT", "AIRBNB_COLLECT"],
  ["AIRBNBCOMCOLLECT", "AIRBNB_COLLECT"],
]);

export function normalizePaymentMethod(value) {
  const compact = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.COM/g, "COM")
    .replace(/[^A-Z0-9ก-๙]/g, "");
  return methodAliases.get(compact) ?? compact;
}

export function fromSatang(value) {
  return (value / 100).toFixed(2);
}

export function formatBaht(value) {
  return `฿${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Finds a subset of `items` whose satang sum is exactly `target`. Returns null when none exists. */
export function findExactSubset(items, target, maxSize = MAX_GROUP_SIZE) {
  const pool = items.filter((item) => item.amountSatang > 0 && item.amountSatang <= target);

  const search = (start, picked, sum) => {
    if (sum === target && picked.length > 0) return picked;
    if (picked.length >= maxSize || sum > target) return null;
    for (let index = start; index < pool.length; index += 1) {
      const found = search(index + 1, [...picked, pool[index]], sum + pool[index].amountSatang);
      if (found) return found;
    }
    return null;
  };

  return search(0, [], 0);
}

function groupByDate(items) {
  const buckets = new Map();
  for (const item of items) {
    const list = buckets.get(item.matchDate);
    if (list) list.push(item);
    else buckets.set(item.matchDate, [item]);
  }
  return buckets;
}

/** จำนวนวันห่างกันแบบวันปฏิทิน ใช้อธิบายว่าคู่ที่คนยืนยันห่างกันกี่วัน */
export function dayGap(left, right) {
  if (!left || !right) return 0;
  const toTime = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Math.round((toTime(left) - toTime(right)) / 86400000);
}

// ── R00 · การตัดสินใจของผู้ตรวจ ───────────────────────────────────────────────

/**
 * Locks in the pairs a reviewer confirmed, before any automatic rule runs.
 * A decision that no longer resolves — because a re-upload replaced the rows it
 * named, or another decision already took them — is reported as stale rather
 * than silently dropped.
 */
function applyDecisions(decisions, { receiptById, lineIndex, bookings, usedReceipts, usedLines }) {
  const groups = [];
  const stale = [];

  for (const decision of decisions) {
    const receiptIds = [...new Set(decision.receiptIds ?? [])];
    const bankLineIds = [...new Set(decision.bankLineIds ?? [])];
    const receipts = receiptIds.map((id) => receiptById.get(id)).filter(Boolean);
    const entries = bankLineIds.map((id) => lineIndex.get(id)).filter(Boolean);

    const missing = receipts.length !== receiptIds.length || entries.length !== bankLineIds.length;
    const taken = receipts.some((receipt) => usedReceipts.has(receipt.id))
      || entries.some((entry) => usedLines.has(entry.line.id));

    if (!receipts.length || !entries.length || missing || taken) {
      stale.push({
        ...decision,
        staleReason: missing ? "ROWS_GONE" : taken ? "ALREADY_USED" : "EMPTY",
      });
      continue;
    }

    for (const receipt of receipts) usedReceipts.add(receipt.id);
    for (const entry of entries) usedLines.add(entry.line.id);

    const statement = entries[0].statement;
    const lines = entries.map((entry) => entry.line);
    const enriched = receipts.map((receipt) => ({ ...receipt, booking: bookings.get(receipt.reservationNo) ?? null }));

    groups.push(makeGroup(
      decision.kind === "SETTLEMENT" ? "OTA" : "MANUAL",
      100,
      lines[0].date,
      statement,
      enriched,
      lines,
      decision,
    ));
  }

  return { groups, stale };
}

// ── การจับคู่อัตโนมัติของหนึ่งบัญชี ──────────────────────────────────────────

/**
 * Reconciles one bank account.
 * @param {object} statement canonical statement produced by lib/parsers/statement.mjs
 * @param {Array}  receipts  collection-report rows already filtered to this account
 * @param {Map}    bookings  reservationNo -> ledger booking
 * @param {object} [options] match shapes the reviewer left enabled
 */
export function reconcileAccount(statement, receipts, bookings, options) {
  const { maxGroupSize, allowManyToOne, allowOneToMany, securityDepositSatang } = matchOptions(options);
  const skipLines = options?.excludeLineIds ?? new Set();
  const groups = [];
  const exceptions = [];

  // Enrich every receipt with the ledger booking; the booking creation date is
  // the only date the matcher is allowed to look at.
  const candidates = [];
  for (const receipt of receipts) {
    const booking = bookings.get(receipt.reservationNo);
    if (receipt.amountSatang < 0) {
      exceptions.push(makeException("REFUND_LINE", { statement, receipt, booking }));
      continue;
    }
    if (!booking || !booking.createdDate) {
      exceptions.push(makeException("MISSING_BOOKING", { statement, receipt, booking }));
      continue;
    }
    candidates.push({ ...receipt, booking, matchDate: booking.createdDate });
  }

  const openReceipts = candidates;
  const openLines = statement.lines
    .filter((line) => line.direction === "credit" && !skipLines.has(line.id))
    .map((line) => ({ ...line, matchDate: line.date }));

  const receiptsByDate = groupByDate(openReceipts);
  const linesByDate = groupByDate(openLines);
  const usedReceipts = new Set();
  const usedLines = new Set();

  const takeReceipts = (list) => list.forEach((item) => usedReceipts.add(item.id));
  const takeLines = (list) => list.forEach((item) => usedLines.add(item.id));
  const availableReceipts = (date) => (receiptsByDate.get(date) ?? []).filter((item) => !usedReceipts.has(item.id));
  const availableLines = (date) => (linesByDate.get(date) ?? []).filter((item) => !usedLines.has(item.id));

  const dates = [...new Set([...receiptsByDate.keys()])].sort();

  // R03 · 1:1 on the same day, exact amount.
  for (const date of dates) {
    for (const receipt of availableReceipts(date)) {
      const line = availableLines(date).find((candidate) => candidate.amountSatang === receipt.amountSatang);
      if (!line) continue;
      takeReceipts([receipt]);
      takeLines([line]);
      groups.push(makeGroup("1:1", 100, date, statement, [receipt], [line]));
    }
  }

  // R04 · N receipts on the same day summing to one credit.
  if (allowManyToOne) {
    for (const date of dates) {
      for (const line of availableLines(date)) {
        const subset = findExactSubset(availableReceipts(date), line.amountSatang, maxGroupSize);
        if (!subset || subset.length < 2) continue;
        takeReceipts(subset);
        takeLines([line]);
        groups.push(makeGroup("N:1", 95, date, statement, subset, [line]));
      }
    }
  }

  // R05 · one receipt equal to the sum of several credits on the same day.
  if (allowOneToMany) {
    for (const date of dates) {
      for (const receipt of availableReceipts(date)) {
        const subset = findExactSubset(availableLines(date), receipt.amountSatang, maxGroupSize);
        if (!subset || subset.length < 2) continue;
        takeReceipts([receipt]);
        takeLines(subset);
        groups.push(makeGroup("1:N", 92, date, statement, [receipt], subset));
      }
    }
  }

  // R06 · ค่าประกันวัน Check-in
  //
  // ลูกค้าจ่ายค่าประกันเพิ่มจากค่าห้องตอนเข้าพัก เงินจึงเข้าบัญชีเป็นก้อนเดียวที่มาก
  // กว่ายอดในรายงานรับเงินอยู่พอดีหนึ่งค่าประกัน กฎ R03 จับไม่ได้เพราะยอดไม่เท่ากัน
  // ไม่ใช่เพราะข้อมูลผิด
  //
  // กฎนี้ยึด **วัน Check-in** ไม่ใช่วันที่สร้างคำจอง เพราะค่าประกันเก็บตอนเข้าพัก
  // วันจองไม่มีการจ่ายค่าประกัน (เว้นแต่จองและเข้าพักวันเดียวกัน ซึ่งผ่านเงื่อนไข
  // receipt.date === receipt.checkIn ตามธรรมชาติอยู่แล้ว)
  //
  // จำนวนค่าประกันมาจากการตั้งค่าเสมอ ไม่มีตัวเลขไหนเขียนไว้ในไฟล์นี้ ตั้งเป็น 0
  // หรือค่าที่ใช้ไม่ได้ = กฎนี้ไม่ทำงาน และไม่มีอะไรถูกจับคู่ผิดไปกว่าเดิม
  if (securityDepositSatang > 0) {
    // วันที่ใช้จับคือวัน Check-in ของแถวนั้นเอง จึงต้องมีดัชนีของตัวเอง แยกจาก
    // receiptsByDate ที่เรียงตามวันที่สร้างคำจอง
    const onCheckIn = new Map();
    for (const receipt of openReceipts) {
      if (!receipt.checkIn || receipt.date !== receipt.checkIn) continue;
      const list = onCheckIn.get(receipt.checkIn) ?? [];
      list.push(receipt);
      onCheckIn.set(receipt.checkIn, list);
    }

    for (const checkIn of [...onCheckIn.keys()].sort()) {
      for (const receipt of onCheckIn.get(checkIn)) {
        if (usedReceipts.has(receipt.id)) continue;
        const target = receipt.amountSatang + securityDepositSatang;
        const line = availableLines(checkIn).find((candidate) => candidate.amountSatang === target);
        if (!line) continue;
        takeReceipts([receipt]);
        takeLines([line]);
        groups.push(makeGroup("1:1+DEPOSIT", 90, checkIn, statement, [receipt], [line], null, {
          depositSatang: securityDepositSatang,
        }));
      }
    }
  }

  // R07 · everything left over is an exception, with the reason spelled out.
  for (const receipt of openReceipts.filter((item) => !usedReceipts.has(item.id))) {
    const sameDayLines = linesByDate.get(receipt.matchDate) ?? [];
    if (!sameDayLines.length) {
      exceptions.push(makeException("DATE_RULE_UNMET", { statement, receipt, booking: receipt.booking }));
      continue;
    }
    // The date rule passed, so report the delta against the closest credit on
    // that day rather than against nothing — that is the number a reviewer chases.
    const candidates = [...sameDayLines]
      .filter((line) => !usedLines.has(line.id))
      .sort((a, b) => Math.abs(a.amountSatang - receipt.amountSatang) - Math.abs(b.amountSatang - receipt.amountSatang));
    exceptions.push(makeException("AMOUNT_MISMATCH", {
      statement,
      receipt,
      booking: receipt.booking,
      line: candidates[0] ?? null,
      candidates: candidates.slice(0, 3),
    }));
  }

  for (const line of openLines.filter((item) => !usedLines.has(item.id))) {
    exceptions.push(makeException("UNMATCHED_BANK_CREDIT", { statement, line }));
  }

  return { groups, exceptions };
}

/**
 * @param {object} [extra]
 * @param {number} [extra.depositSatang] ค่าประกันที่อธิบายส่วนต่างของกลุ่มนี้ (R06)
 */
function makeGroup(type, score, date, statement, receipts, lines, decision = null, extra = {}) {
  const receiptSatang = receipts.reduce((sum, item) => sum + item.amountSatang, 0);
  const bankSatang = lines.reduce((sum, item) => sum + item.amountSatang, 0);
  const suffix = decision ? decision.id.slice(-6) : lines[0].id.slice(-3);

  // ค่าประกันไม่ใช่รายได้ค่าห้อง มันจึงไม่เคยถูกบวกเข้ายอดของแถวไหนเลย — ยอดใน
  // รายงานรับเงินและยอดใน statement ยังเป็นตัวเลขที่เอกสารบอกทุกประการ ที่เก็บไว้
  // ตรงนี้คือ "คำอธิบายว่าทำไมสองยอดนั้นต่างกัน" ซึ่งเป็นผลการกระทบยอด ไม่ใช่ข้อมูลต้นทาง
  const depositSatang = Math.max(0, Math.round(Number(extra.depositSatang) || 0));
  // ยอดเงินเข้าที่เทียบกับค่าห้องได้ตรง ๆ คือยอดจริงหักค่าประกันออก
  const comparableBankSatang = bankSatang - depositSatang;

  // งวดของกลุ่มคือเดือนที่เงินเข้าบัญชีจริง ไม่ใช่เดือนที่บันทึกรับเงิน — รายงาน
  // ของเดือนไหนต้องนับเงินที่เข้าบัญชีในเดือนนั้น
  const period = periodOf(lines[0].date);
  const sourcePeriods = [...new Set(receipts.map((receipt) => periodOf(receipt.date)).filter(Boolean))];

  return {
    id: `GRP-${statement.code}-${date.replace(/-/g, "")}-${suffix}`,
    account: statement.code,
    accountNo: statement.accountNo,
    accountName: statement.accountName ?? "",
    accountPeriod: statement.period ?? period,
    statementSource: statement.source ?? "",
    type,
    score,
    date,
    period,
    // จริงเมื่อเงินเข้าคนละเดือนกับที่บันทึกรับเงินไว้ — เคสปกติของก้อนโอน OTA
    crossPeriod: sourcePeriods.some((item) => item !== period),
    sourcePeriods,
    // A decision is recorded honestly: the rule checks show what the values
    // actually were, and the human reason sits beside them.
    // กลุ่มค่าประกันผ่านกฎคนละข้อกับกลุ่มปกติ จึงต้องรายงานตามข้อที่มันผ่านจริง
    // ไม่ใช่แสดงข้อเดิมแล้วขึ้นว่าไม่ผ่าน
    rulesPassed: depositSatang > 0
      ? [
        {
          id: "R06",
          label: "วัน Check-in = วันที่รับเงิน = วันที่เงินเข้า Statement",
          left: receipts[0]?.checkIn ?? date,
          right: lines[0].date,
          passed: receipts.every((receipt) => receipt.checkIn === receipt.date && receipt.checkIn === lines[0].date),
        },
        {
          id: "R02",
          label: "ยอดตรงกันพอดีเมื่อรวมค่าประกัน",
          left: receiptSatang + depositSatang,
          right: bankSatang,
          passed: receiptSatang + depositSatang === bankSatang,
        },
      ]
      : [
        {
          id: "R01",
          label: "วันที่สร้างคำจอง = วันที่เงินเข้า Statement",
          left: receipts[0]?.booking?.createdDate ?? date,
          right: lines[0].date,
          passed: receipts.every((receipt) => (receipt.booking?.createdDate ?? date) === lines[0].date),
        },
        { id: "R02", label: "ยอดตรงกันพอดี", left: receiptSatang, right: bankSatang, passed: receiptSatang === bankSatang },
      ],
    decision: decision && {
      id: decision.id,
      kind: decision.kind,
      reason: decision.reason,
      reasonLabel: DECISION_REASONS[decision.reason]?.label ?? decision.reason,
      note: decision.note ?? "",
      decidedBy: decision.decidedBy ?? "",
      decidedAt: decision.decidedAt ?? "",
      differenceSatang: receiptSatang - bankSatang,
    },
    receiptSatang,
    bankSatang,
    depositSatang,
    comparableBankSatang,
    // ผลต่างที่ยังอธิบายไม่ได้ — กลุ่มค่าประกันที่ลงตัวจะเป็นศูนย์ เพราะค่าประกัน
    // อธิบายส่วนต่างไปหมดแล้ว
    deltaSatang: receiptSatang - comparableBankSatang,
    // ส่วนต่างดิบระหว่างเอกสารสองฝั่ง ก่อนหักคำอธิบายใด ๆ ออก
    rawDeltaSatang: receiptSatang - bankSatang,
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      reservationNo: receipt.reservationNo,
      guest: receipt.guest || receipt.booking?.guest || "",
      roomType: receipt.roomType,
      roomNumber: receipt.roomNumber,
      channel: receipt.channel,
      method: receipt.method,
      receiptDate: receipt.date,
      checkIn: receipt.checkIn,
      checkOut: receipt.checkOut,
      bookingCreatedAt: receipt.booking?.createdAt ?? "",
      bookingCreatedDate: receipt.booking?.createdDate ?? "",
      bookingStatus: receipt.booking?.status ?? "",
      bookingTotalSatang: receipt.booking?.totalSatang ?? 0,
      bookingPaidSatang: receipt.booking?.paidSatang ?? 0,
      bookingBalanceDueSatang: receipt.booking?.balanceDueSatang ?? 0,
      bookingNights: receipt.booking?.nights ?? 0,
      amountSatang: receipt.amountSatang,
      // Automatic groups are exact subset sums, so a row always contributes its
      // whole amount. A decision may accept a difference, which is reported on
      // the group rather than smeared across the rows.
      allocatedSatang: receipt.amountSatang,
      dayGapToBank: dayGap(receipt.booking?.createdDate ?? receipt.date, lines[0].date),
      sourceRow: receipt.sourceRow,
    })),
    lines: lines.map((line) => ({
      id: line.id,
      date: line.date,
      time: line.time,
      description: line.description,
      channel: line.channel,
      detail: line.detail,
      amountSatang: line.amountSatang,
      allocatedSatang: line.amountSatang,
      balanceSatang: line.balanceSatang,
      balanceBeforeSatang: line.balanceSatang - line.amountSatang,
      page: line.page,
      row: line.row,
    })),
  };
}

let exceptionSequence = 0;

function makeException(reason, { statement, receipt, booking, line, candidates = [] }) {
  exceptionSequence += 1;
  const receiptSatang = receipt ? Math.abs(receipt.amountSatang) : 0;
  const bankSatang = line ? line.amountSatang : 0;
  return {
    id: `EX-${statement.code}-${String(exceptionSequence).padStart(4, "0")}`,
    reason,
    label: EXCEPTION_REASONS[reason].label,
    severity: EXCEPTION_REASONS[reason].severity,
    account: statement.code,
    accountNo: statement.accountNo,
    // งวดของงานค้าง: ฝั่งรับเงินใช้เดือนที่บันทึก ฝั่งธนาคารใช้เดือนที่เงินเข้า
    period: periodOf(receipt?.date || line?.date || statement.period || ""),
    accountPeriod: statement.period ?? "",
    reservationNo: receipt?.reservationNo ?? "",
    guest: receipt?.guest ?? booking?.guest ?? line?.detail ?? "",
    receiptId: receipt?.id ?? "",
    receiptDate: receipt?.date ?? "",
    receiptMethod: receipt?.method ?? "",
    receiptSatang,
    bookingCreatedAt: booking?.createdAt ?? "",
    bookingCreatedDate: booking?.createdDate ?? "",
    bookingStatus: booking?.status ?? "",
    bankLineId: line?.id ?? "",
    bankDate: line?.date ?? "",
    bankTime: line?.time ?? "",
    bankDetail: line?.detail ?? "",
    bankChannel: line?.channel ?? "",
    bankSatang,
    deltaSatang: receiptSatang - bankSatang,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      time: candidate.time,
      amountSatang: candidate.amountSatang,
      detail: candidate.detail,
      deltaSatang: receiptSatang - candidate.amountSatang,
    })),
    status: "open",
  };
}

/**
 * ผูกแต่ละรายการรับเงินเข้ากับ statement เดียว — บัญชีเดียวกัน งวดเดียวกัน
 *
 * เมื่อฐานข้อมูลเก็บหลายเดือนพร้อมกัน บัญชีหนึ่งใบมี statement ได้หลายฉบับ ถ้า
 * ปล่อยให้ทุกฉบับมองเห็นรายการรับเงินทั้งหมดตามช่องทางอย่างเดียว เดือนกรกฎาคม
 * กับสิงหาคมจะรายงานข้อยกเว้นของกันและกันซ้ำสองรอบ
 *
 * งวดที่ใช้ผูกคือเดือนของวันที่กฎจะไปมองหาเงินเข้า:
 *   - ปกติคือ "วันที่สร้างคำจอง" เพราะนั่นคือวันเดียวที่กฎ R01 มองหาในฝั่ง statement
 *   - แต่ถ้ารับเงินในวันเข้าพัก (เคสของกฎ R06 ค่าประกัน) เงินย่อมเข้าบัญชีในเดือน
 *     ของวันเข้าพัก ไม่ใช่เดือนที่จอง จึงผูกตามวันเข้าพักก่อน แล้วค่อยถอยไปใช้เดือน
 *     ที่จองถ้าเดือนนั้นยังไม่มี statement
 * รายการที่ไม่มีคำจองรองรับใช้เดือนของวันที่รับเงินแทน
 *
 * รายการที่ยังไม่มี statement ของงวดนั้น (เช่นอัปโหลดรายงานการรับเงินของเดือนใหม่
 * มาก่อน statement) ไม่ถูกยัดเข้าเดือนอื่นให้กลายเป็นข้อยกเว้นลวง แต่ถูกรายงานว่า
 * "ยังไม่มี Statement ของงวดนี้" ตรง ๆ
 */
function assignToStatements(receipts, statements, bookings) {
  const byKey = new Map();
  for (const statement of statements) {
    byKey.set(`${normalizePaymentMethod(statement.method)}|${statement.period ?? ""}`, statement);
  }

  const assigned = new Map(statements.map((statement) => [statement, []]));
  const uncovered = [];

  for (const receipt of receipts) {
    const method = normalizePaymentMethod(receipt.method);
    const booked = periodOf(bookings.get(receipt.reservationNo)?.createdDate || receipt.date);
    const paidOnCheckIn = Boolean(receipt.checkIn) && receipt.date === receipt.checkIn;
    const period = paidOnCheckIn ? periodOf(receipt.checkIn) : booked;

    const statement = byKey.get(`${method}|${period}`) ?? byKey.get(`${method}|${booked}`);
    if (statement) assigned.get(statement).push(receipt);
    else uncovered.push({ receipt, period });
  }

  return { assigned, uncovered };
}

/** Runs the engine across every account in the dataset. */
export function reconcile(dataset, options) {
  exceptionSequence = 0;
  const opts = matchOptions(options);
  const bookings = new Map(dataset.bookings.map((booking) => [booking.reservationNo, booking]));
  const receiptById = new Map(dataset.receipts.map((receipt) => [receipt.id, receipt]));

  // งวดของ statement อ่านจากรอบที่พิมพ์บนเอกสารเอง เมื่อผู้เรียกไม่ได้ใส่มาให้
  // เครื่องมือจับคู่จึงทำงานได้กับ statement ที่มาจากไฟล์โดยตรงเหมือนกับที่มาจาก
  // ฐานข้อมูล โดยไม่ต้องให้ใครเตรียมข้อมูลก่อน
  const statements = dataset.statements.map(
    (statement) => (statement.period ? statement : { ...statement, period: statementPeriod(statement) }),
  );

  const lineIndex = new Map();
  for (const statement of statements) {
    for (const line of statement.lines) lineIndex.set(line.id, { line, statement });
  }

  // R00 first: a confirmed pair is removed from play before any rule looks at it.
  const usedReceipts = new Set();
  const usedLines = new Set();
  const decided = applyDecisions(opts.decisions, { receiptById, lineIndex, bookings, usedReceipts, usedLines });

  const accounts = [];
  const allGroups = [...decided.groups];
  const allExceptions = [];

  const { assigned, uncovered } = assignToStatements(dataset.receipts, statements, bookings);

  for (const statement of statements) {
    const scoped = assigned.get(statement) ?? [];
    const open = scoped.filter((receipt) => !usedReceipts.has(receipt.id));
    const { groups, exceptions } = reconcileAccount(statement, open, bookings, { ...opts, excludeLineIds: usedLines });

    const accountGroups = [...decided.groups.filter((group) => group.account === statement.code), ...groups];
    const scopedIds = new Set(scoped.map((receipt) => receipt.id));
    // A decision may pull in a receipt whose payment method belongs to no
    // statement at all — an OTA settlement is exactly that. It counts against
    // the account whose credit line it was allocated to.
    for (const group of accountGroups) for (const row of group.receipts) scopedIds.add(row.id);

    const matchedReceipts = accountGroups.reduce((sum, group) => sum + group.receipts.length, 0);

    accounts.push({
      code: statement.code,
      period: statement.period ?? "",
      cycle: statement.cycle ?? "",
      accountNo: statement.accountNo,
      method: statement.method,
      branch: statement.branch,
      source: statement.source,
      openingSatang: statement.openingSatang,
      closingSatang: statement.closingSatang,
      creditSatang: statement.creditSatang,
      debitSatang: statement.debitSatang,
      creditCount: statement.creditCount,
      debitCount: statement.debitCount,
      controlDeltaSatang: statement.controlDeltaSatang,
      receiptCount: scopedIds.size,
      receiptSatang: [...scopedIds].reduce((sum, id) => sum + (receiptById.get(id)?.amountSatang ?? 0), 0),
      matchedReceipts,
      matchedSatang: accountGroups.reduce((sum, group) => sum + group.bankSatang, 0),
      groupCount: accountGroups.length,
      exceptionCount: exceptions.length,
      matchRate: scopedIds.size ? Number(((matchedReceipts / scopedIds.size) * 100).toFixed(1)) : 0,
    });

    allGroups.push(...groups);
    allExceptions.push(...exceptions);
  }

  // Receipts with no statement to reconcile against are reported as coverage
  // rather than silently counted as matched or failed. The two ways that happens
  // are kept apart, because only one of them is somebody's to fix:
  //   NO_BANK_ACCOUNT  — ช่องทางนี้ไม่มีบัญชีธนาคารในระบบเลย เช่นเงินที่ OTA
  //                      เก็บแทนเรา ปกติของมันเป็นแบบนี้ รอแตกยอดก้อนโอน
  //   MISSING_STATEMENT — มีบัญชีอยู่แล้ว แต่ยังไม่ได้อัปโหลด statement ของงวดนี้
  // Rows a reviewer has already allocated to a settlement are no longer waiting.
  const bankMethods = new Set(statements.map((statement) => normalizePaymentMethod(statement.method)));
  const coverage = new Map();
  for (const { receipt, period } of uncovered) {
    if (usedReceipts.has(receipt.id)) continue;
    const method = normalizePaymentMethod(receipt.method);
    const key = `${method}|${period}`;
    const bucket = coverage.get(key) ?? {
      method: receipt.method,
      period,
      reason: bankMethods.has(method) ? "MISSING_STATEMENT" : "NO_BANK_ACCOUNT",
      count: 0,
      amountSatang: 0,
    };
    bucket.count += 1;
    bucket.amountSatang += receipt.amountSatang;
    coverage.set(key, bucket);
  }

  const inScopeReceipts = accounts.reduce((sum, account) => sum + account.receiptCount, 0);
  const matchedReceipts = accounts.reduce((sum, account) => sum + account.matchedReceipts, 0);
  const decidedGroups = allGroups.filter((group) => group.decision);

  return {
    rulesetVersion: RULESET_VERSION,
    accounts,
    groups: allGroups.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    exceptions: allExceptions.sort((a, b) => (b.receiptDate || b.bankDate).localeCompare(a.receiptDate || a.bankDate)),
    outOfScope: [...coverage.values()].sort((a, b) => b.amountSatang - a.amountSatang),
    staleDecisions: decided.stale,
    summary: {
      inScopeReceipts,
      matchedReceipts,
      matchedGroups: allGroups.length,
      exceptionCount: allExceptions.length,
      matchRate: inScopeReceipts ? Number(((matchedReceipts / inScopeReceipts) * 100).toFixed(1)) : 0,
      matchedSatang: allGroups.reduce((sum, group) => sum + group.bankSatang, 0),
      // Receipt-side and bank-side gaps are kept apart so the same money is
      // never counted twice in the headline "unexplained" figure.
      unexplainedReceiptSatang: allExceptions
        .filter((exception) => exception.receiptId)
        .reduce((sum, exception) => sum + Math.abs(exception.deltaSatang), 0),
      unexplainedBankSatang: allExceptions
        .filter((exception) => exception.reason === "UNMATCHED_BANK_CREDIT")
        .reduce((sum, exception) => sum + exception.bankSatang, 0),
      // What a human decided, kept separate from what the rules produced.
      decidedGroups: decidedGroups.length,
      decidedReceipts: decidedGroups.reduce((sum, group) => sum + group.receipts.length, 0),
      acceptedDifferenceSatang: decidedGroups.reduce((sum, group) => sum + group.deltaSatang, 0),
      staleDecisions: decided.stale.length,
      controlBalanced: statements.every((statement) => statement.controlDeltaSatang === 0),
      // เงินที่รับไว้เดือนหนึ่งแต่เข้าบัญชีอีกเดือนหนึ่ง — ทุกก้อนผ่านการยืนยันของคน
      crossPeriodGroups: allGroups.filter((group) => group.crossPeriod).length,
      crossPeriodSatang: allGroups.filter((group) => group.crossPeriod).reduce((sum, group) => sum + group.bankSatang, 0),
      // งวดที่มีรายการรับเงินรออยู่ แต่ยังไม่ได้อัปโหลด statement ของบัญชีนั้น
      missingStatements: [...coverage.values()].filter((item) => item.reason === "MISSING_STATEMENT").length,
    },
  };
}
