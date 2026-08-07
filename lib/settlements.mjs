import { dayGap, normalizePaymentMethod } from "./reconciliation.mjs";

// การแตกยอดก้อนโอนของ OTA
//
// Airbnb, Trip.com และ Booking.com ไม่ได้โอนทีละคำจอง แต่รวบยอดหลายคำจองมาเป็น
// ก้อนเดียว **หลังหักค่าคอมแล้ว** ยอดในสมุดบัญชีจึงไม่มีทางเท่ากับก้อนที่เข้าบัญชี
// กฎ R02 (ยอดตรงพอดี) จึงจับไม่ได้ตามธรรมชาติ ไม่ใช่เพราะข้อมูลผิด
//
// ไฟล์นี้ไม่ตัดสินใจแทนใคร มันแค่ "เสนอ" ว่าก้อนนี้น่าจะประกอบด้วยรายการไหนบ้าง
// แล้วบอกว่าส่วนต่างคิดเป็นค่าคอมกี่เปอร์เซ็นต์ ผู้ตรวจเป็นคนกดยืนยันเสมอ

export const DEFAULT_SETTLEMENT = {
  enabled: true,
  windowDays: 7,
  maxFeeRate: 30,
  // ข้อความที่บอกว่าเงินเข้าก้อนนี้มาจาก OTA — เทียบแบบ "มีคำนี้อยู่ในบรรทัด"
  patterns: ["ธุรกรรมต่างประเทศ", "SMART SCBT", "NRBA", "MCP Operating"],
  // ช่องทางรับเงินฝั่งสมุดบัญชีที่ถือว่าเป็นเงินที่ OTA เก็บแทนเรา
  otaMethods: ["TRIPCOM COLLECT", "AIRBNB COLLECT", "BOOKINGCOM COLLECT"],
};

export function normalizeSettlement(raw) {
  const source = raw ?? {};
  const list = (value, fallback) =>
    Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : fallback;
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  };

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SETTLEMENT.enabled,
    windowDays: clamp(source.windowDays, 0, 60, DEFAULT_SETTLEMENT.windowDays),
    maxFeeRate: clamp(source.maxFeeRate, 0, 90, DEFAULT_SETTLEMENT.maxFeeRate),
    patterns: list(source.patterns, DEFAULT_SETTLEMENT.patterns),
    otaMethods: list(source.otaMethods, DEFAULT_SETTLEMENT.otaMethods),
  };
}

/** เงินเข้าก้อนนี้หน้าตาเหมือนก้อนโอนของ OTA หรือเปล่า */
export function looksLikeSettlement(line, settlement) {
  const haystack = `${line.channel ?? ""} ${line.description ?? ""} ${line.detail ?? ""}`.toLowerCase();
  return settlement.patterns.some((pattern) => haystack.includes(pattern.toLowerCase()));
}

export function isOtaMethod(method, settlement) {
  const key = normalizePaymentMethod(method);
  return settlement.otaMethods.some((item) => normalizePaymentMethod(item) === key);
}

const MAX_ROWS_PER_SETTLEMENT = 12;
const SEARCH_POOL = 24;
const SEARCH_BUDGET = 300000;

/**
 * ชุดที่ยอดรวม "ท่วมก้อนโอนน้อยที่สุด"
 *
 * ยอดเต็มต้องมากกว่าหรือเท่ากับเงินที่เข้าบัญชีเสมอ เพราะ OTA หักคอมก่อนโอน
 * ในบรรดาชุดที่เข้าเงื่อนไขนั้น ชุดที่เกินน้อยที่สุดคือชุดที่ค่าคอมสมเหตุสมผล
 * ที่สุด — ไล่เลือกตามวันอย่างเดียวจะได้ชุดที่เลยยอดไปไกลจนคอมดูสูงเกินจริง
 */
function bestSubset(candidates, target) {
  const pool = candidates.slice(0, SEARCH_POOL).sort((a, b) => b.receipt.amountSatang - a.receipt.amountSatang);
  const suffix = new Array(pool.length + 1).fill(0);
  for (let index = pool.length - 1; index >= 0; index -= 1) {
    suffix[index] = suffix[index + 1] + pool[index].receipt.amountSatang;
  }

  let best = null;
  let bestOver = Infinity;
  let bestGap = Infinity;
  let nodes = 0;

  const walk = (start, picked, sum, gapSum) => {
    if (nodes > SEARCH_BUDGET) return;
    nodes += 1;

    if (sum >= target) {
      const over = sum - target;
      // เท่ากันให้เอาชุดที่วันใกล้ก้อนกว่า แล้วจึงเอาชุดที่รายการน้อยกว่า
      if (over < bestOver
        || (over === bestOver && gapSum < bestGap)
        || (over === bestOver && gapSum === bestGap && best !== null && picked.length < best.length)) {
        bestOver = over;
        bestGap = gapSum;
        best = [...picked];
      }
      return; // เพิ่มอีกมีแต่จะเกินมากขึ้น
    }
    if (picked.length >= MAX_ROWS_PER_SETTLEMENT || start >= pool.length) return;
    if (sum + suffix[start] < target) return; // ต่อให้เอาที่เหลือทั้งหมดก็ยังไม่ถึง

    for (let index = start; index < pool.length; index += 1) {
      picked.push(pool[index]);
      walk(index + 1, picked, sum + pool[index].receipt.amountSatang, gapSum + Math.abs(pool[index].gap));
      picked.pop();
      if (nodes > SEARCH_BUDGET) return;
    }
  };

  walk(0, [], 0, 0);
  return best;
}

/**
 * ประกอบข้อเสนอสำหรับก้อนโอนหนึ่งก้อน
 *
 * ดูเฉพาะรายการที่วันอยู่ในช่วงรอบก้อนโอน แล้วหาชุดที่ยอดเต็มท่วมก้อนน้อยที่สุด
 * ถ้าหาไม่ได้เลย (เงินเข้ามากกว่ายอดที่บันทึกไว้ทั้งหมด) ก็เสนอทุกรายการไปก่อน
 * แล้วให้สถานะเป็น "หาคำจองไม่พอ" ให้ผู้ตรวจดู แทนที่จะเงียบ
 */
export function proposeForLine(line, account, receipts, settlement) {
  const inWindow = receipts
    .map((receipt) => ({ receipt, gap: dayGap(receipt.date, line.date) }))
    .filter(({ gap }) => Math.abs(gap) <= settlement.windowDays)
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap) || b.receipt.amountSatang - a.receipt.amountSatang);

  const chosen = bestSubset(inWindow, line.amountSatang);
  const picked = chosen
    ? chosen.map((item) => item.receipt.id)
    : inWindow.map((item) => item.receipt.id);

  return buildProposal(line, account, inWindow, picked, settlement);
}

/** สรุปตัวเลขของข้อเสนอตามรายการที่เลือกไว้ — ใช้ซ้ำได้ทุกครั้งที่ผู้ใช้ติ๊กเพิ่ม/ออก */
export function buildProposal(line, account, candidates, selectedIds, settlement) {
  const selected = new Set(selectedIds);
  const rows = candidates.map(({ receipt, gap }) => ({
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
    selected: selected.has(receipt.id),
  }));

  const grossSatang = rows.filter((row) => row.selected).reduce((sum, row) => sum + row.amountSatang, 0);
  const netSatang = line.amountSatang;
  const feeSatang = grossSatang - netSatang;
  const feeRate = grossSatang > 0 ? (feeSatang / grossSatang) * 100 : 0;

  // สถานะบอกว่าข้อเสนอนี้ "พร้อมยืนยัน" หรือ "ต้องดูก่อน" — ไม่ใช่ผ่าน/ไม่ผ่าน
  const status = !rows.some((row) => row.selected) ? "EMPTY"
    : feeSatang < 0 ? "SHORT"
    : feeRate > settlement.maxFeeRate ? "FEE_HIGH"
    : "READY";

  return {
    id: `SET-${line.id}`,
    lineId: line.id,
    account,
    date: line.date,
    time: line.time,
    description: line.description,
    channel: line.channel,
    detail: line.detail,
    netSatang,
    grossSatang,
    feeSatang,
    feeRate: Number(feeRate.toFixed(2)),
    status,
    candidates: rows,
    selectedIds: rows.filter((row) => row.selected).map((row) => row.id),
  };
}

/**
 * ก้อนโอน OTA ทุกก้อนที่ยังไม่มีใครจับ พร้อมข้อเสนอของแต่ละก้อน
 * รายการรับเงินหนึ่งใบถูกเสนอให้ก้อนเดียวเท่านั้น ก้อนที่วันใกล้ที่สุดได้ไปก่อน
 */
export function proposeSettlements(dataset, reconciliation, settlement) {
  if (!settlement.enabled) return [];

  const usedReceipts = new Set(reconciliation.groups.flatMap((group) => group.receipts.map((row) => row.id)));
  const usedLines = new Set(reconciliation.groups.flatMap((group) => group.lines.map((row) => row.id)));

  const openOta = dataset.receipts.filter(
    (receipt) => isOtaMethod(receipt.method, settlement) && !usedReceipts.has(receipt.id) && receipt.amountSatang > 0,
  );

  const lines = [];
  for (const statement of dataset.statements) {
    for (const line of statement.lines) {
      if (line.direction !== "credit" || usedLines.has(line.id)) continue;
      if (!looksLikeSettlement(line, settlement)) continue;
      lines.push({ line, account: statement.code });
    }
  }
  lines.sort((a, b) => a.line.date.localeCompare(b.line.date) || b.line.amountSatang - a.line.amountSatang);

  const claimed = new Set();
  const proposals = [];
  for (const { line, account } of lines) {
    const available = openOta.filter((receipt) => !claimed.has(receipt.id));
    const proposal = proposeForLine(line, account, available, settlement);
    for (const id of proposal.selectedIds) claimed.add(id);
    proposals.push(proposal);
  }

  return proposals;
}

/** ยอดรวมของงาน OTA ที่ยังค้าง ใช้โชว์บนหน้าแรก */
export function settlementTotals(proposals) {
  return {
    count: proposals.length,
    netSatang: proposals.reduce((sum, item) => sum + item.netSatang, 0),
    readyCount: proposals.filter((item) => item.status === "READY").length,
    needsReviewCount: proposals.filter((item) => item.status !== "READY").length,
  };
}
