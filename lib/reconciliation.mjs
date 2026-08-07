// Reconciliation engine — ruleset v2.0.0
//
// Hard rule, applied without exception:
//   1. วันที่สร้างคำจอง (booking creation date, from the ledger) must be the SAME
//      calendar day as the bank statement credit date.
//   2. The amount must be exactly equal. Tolerance is zero.
// Anything that cannot satisfy both is an exception. The engine never adjusts,
// rounds or nudges an amount, and never widens the date window.

export const RULESET_VERSION = "2.0.0";

export const RULES = [
  { id: "R01", label: "วันที่สร้างคำจอง = วันที่เงินเข้า Statement", detail: "เทียบเป็นวันปฏิทินเดียวกันเท่านั้น ไม่มี date window", blocking: true },
  { id: "R02", label: "ยอดต้องตรงกันพอดี", detail: "ผลต่างต้องเป็น ฿0.00 ไม่มี tolerance", blocking: true },
  { id: "R03", label: "จับคู่ 1:1", detail: "หนึ่งรายการรับเงิน = หนึ่งยอดเงินเข้า", score: 100 },
  { id: "R04", label: "จับคู่ N:1", detail: "ผลรวมหลายรายการรับเงินในวันเดียวกัน = หนึ่งยอดเงินเข้า", score: 95 },
  { id: "R05", label: "จับคู่ 1:N", detail: "หนึ่งรายการรับเงิน = ผลรวมหลายยอดเงินเข้าในวันเดียวกัน", score: 92 },
  { id: "R06", label: "ที่เหลือเป็นข้อยกเว้น", detail: "ระบบไม่จับคู่ให้อัตโนมัติและไม่แก้ไขข้อมูลต้นฉบับ", blocking: true },
];

export const EXCEPTION_REASONS = {
  MISSING_BOOKING: { label: "ไม่พบคำจองในบัญชีแยกประเภท", severity: "high" },
  DATE_RULE_UNMET: { label: "ไม่มีเงินเข้า Statement ในวันที่สร้างคำจอง", severity: "high" },
  AMOUNT_MISMATCH: { label: "มีเงินเข้าวันเดียวกันแต่ยอดไม่ตรง", severity: "high" },
  UNMATCHED_BANK_CREDIT: { label: "เงินเข้า Statement ที่ยังไม่มีรายการรับเงินรองรับ", severity: "medium" },
  REFUND_LINE: { label: "รายการคืนเงิน ต้องกระทบกับยอดถอน", severity: "medium" },
};

const MAX_GROUP_SIZE = 4;

// The two hard rules (R01 วันที่ and R02 ยอด) are never configurable. What a user
// may turn off is only which *shapes* of match the engine is allowed to look for
// and how many rows one group may span.
export const DEFAULT_MATCH_OPTIONS = {
  maxGroupSize: MAX_GROUP_SIZE,
  allowManyToOne: true,
  allowOneToMany: true,
};

function matchOptions(options) {
  const merged = { ...DEFAULT_MATCH_OPTIONS, ...(options ?? {}) };
  return {
    maxGroupSize: Math.min(6, Math.max(2, Number(merged.maxGroupSize) || MAX_GROUP_SIZE)),
    allowManyToOne: merged.allowManyToOne !== false,
    allowOneToMany: merged.allowOneToMany !== false,
  };
}

const methodAliases = new Map([
  ["BOOKINGCOMCOLLECT", "BOOKING_COLLECT"],
  ["BOOKINGCOLLECT", "BOOKING_COLLECT"],
  ["TRIPCOMCOLLECT", "TRIP_COLLECT"],
  ["TRIPCOLLECT", "TRIP_COLLECT"],
  ["AIRBNBCOLLECT", "AIRBNB_COLLECT"],
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

/**
 * Reconciles one bank account.
 * @param {object} statement canonical statement produced by scripts/lib/statement.mjs
 * @param {Array}  receipts  collection-report rows already filtered to this account
 * @param {Map}    bookings  reservationNo -> ledger booking
 * @param {object} [options]  match shapes the user left enabled
 */
export function reconcileAccount(statement, receipts, bookings, options) {
  const { maxGroupSize, allowManyToOne, allowOneToMany } = matchOptions(options);
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

  let openReceipts = candidates;
  let openLines = statement.lines
    .filter((line) => line.direction === "credit")
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

  // R06 · everything left over is an exception, with the reason spelled out.
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

  openReceipts = null;
  openLines = null;

  return { groups, exceptions };
}

function makeGroup(type, score, date, statement, receipts, lines) {
  const receiptSatang = receipts.reduce((sum, item) => sum + item.amountSatang, 0);
  const bankSatang = lines.reduce((sum, item) => sum + item.amountSatang, 0);
  return {
    id: `GRP-${statement.code}-${date.replace(/-/g, "")}-${lines[0].id.slice(-3)}`,
    account: statement.code,
    accountNo: statement.accountNo,
    accountName: statement.accountName ?? "",
    statementSource: statement.source ?? "",
    type,
    score,
    date,
    rulesPassed: [
      { id: "R01", label: "วันที่สร้างคำจอง = วันที่เงินเข้า Statement", left: date, right: lines[0].date, passed: true },
      { id: "R02", label: "ยอดตรงกันพอดี", left: receiptSatang, right: bankSatang, passed: receiptSatang === bankSatang },
    ],
    receiptSatang,
    bankSatang,
    deltaSatang: receiptSatang - bankSatang,
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
      bookingCreatedAt: receipt.booking.createdAt,
      bookingCreatedDate: receipt.booking.createdDate,
      bookingStatus: receipt.booking.status,
      bookingTotalSatang: receipt.booking.totalSatang,
      bookingPaidSatang: receipt.booking.paidSatang,
      bookingBalanceDueSatang: receipt.booking.balanceDueSatang,
      bookingNights: receipt.booking.nights,
      amountSatang: receipt.amountSatang,
      // Every group is an exact subset sum, so a row always contributes its
      // whole amount — there is no partial allocation to explain.
      allocatedSatang: receipt.amountSatang,
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
    reservationNo: receipt?.reservationNo ?? "",
    guest: receipt?.guest ?? booking?.guest ?? line?.detail ?? "",
    receiptId: receipt?.id ?? "",
    receiptDate: receipt?.date ?? "",
    receiptSatang,
    bookingCreatedAt: booking?.createdAt ?? "",
    bookingCreatedDate: booking?.createdDate ?? "",
    bookingStatus: booking?.status ?? "",
    bankLineId: line?.id ?? "",
    bankDate: line?.date ?? "",
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

/** Runs the engine across every account in the dataset. */
export function reconcile(dataset, options) {
  exceptionSequence = 0;
  const bookings = new Map(dataset.bookings.map((booking) => [booking.reservationNo, booking]));
  const accounts = [];
  const allGroups = [];
  const allExceptions = [];

  for (const statement of dataset.statements) {
    const receipts = dataset.receipts.filter(
      (receipt) => normalizePaymentMethod(receipt.method) === normalizePaymentMethod(statement.method),
    );
    const { groups, exceptions } = reconcileAccount(statement, receipts, bookings, options);

    const matchedReceipts = groups.reduce((sum, group) => sum + group.receipts.length, 0);
    const matchedSatang = groups.reduce((sum, group) => sum + group.bankSatang, 0);

    accounts.push({
      code: statement.code,
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
      receiptCount: receipts.length,
      receiptSatang: receipts.reduce((sum, receipt) => sum + receipt.amountSatang, 0),
      matchedReceipts,
      matchedSatang,
      groupCount: groups.length,
      exceptionCount: exceptions.length,
      matchRate: receipts.length ? Number(((matchedReceipts / receipts.length) * 100).toFixed(1)) : 0,
    });

    allGroups.push(...groups);
    allExceptions.push(...exceptions);
  }

  // Payment methods that have no bank statement in data/ are reported as
  // out-of-scope coverage rather than silently counted as matched or failed.
  const bankMethods = new Set(dataset.statements.map((statement) => normalizePaymentMethod(statement.method)));
  const coverage = new Map();
  for (const receipt of dataset.receipts) {
    const key = normalizePaymentMethod(receipt.method);
    if (bankMethods.has(key)) continue;
    const bucket = coverage.get(key) ?? { method: receipt.method, count: 0, amountSatang: 0 };
    bucket.count += 1;
    bucket.amountSatang += receipt.amountSatang;
    coverage.set(key, bucket);
  }

  const inScopeReceipts = accounts.reduce((sum, account) => sum + account.receiptCount, 0);
  const matchedReceipts = accounts.reduce((sum, account) => sum + account.matchedReceipts, 0);

  return {
    rulesetVersion: RULESET_VERSION,
    accounts,
    groups: allGroups.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    exceptions: allExceptions.sort((a, b) => (b.receiptDate || b.bankDate).localeCompare(a.receiptDate || a.bankDate)),
    outOfScope: [...coverage.values()].sort((a, b) => b.amountSatang - a.amountSatang),
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
      controlBalanced: dataset.statements.every((statement) => statement.controlDeltaSatang === 0),
    },
  };
}
