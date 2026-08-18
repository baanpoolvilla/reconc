import type { Booking, Dataset, Receipt } from "./dataset";
import * as core from "./settings-core.mjs";
import * as engine from "./reconciliation.mjs";

// หน้ากากที่ใส่ type ให้ตรรกะใน settings-core.mjs / settlements.mjs
// เหมือนที่ dataset.ts ทำกับ reconciliation.mjs

export const SETTINGS_STORAGE_KEY = "clearclose.settings.v1";
export const DECISIONS_STORAGE_KEY = "clearclose.decisions.v1";
export const SETTINGS_VERSION: number = core.SETTINGS_VERSION;

export type MatchOptions = {
  maxGroupSize: number;
  allowManyToOne: boolean;
  allowOneToMany: boolean;
  /** ค่าประกันวัน Check-in เป็นสตางค์ — กฎ R06 อ่านจำนวนจากที่นี่ ไม่มีค่าใดฝังในเครื่องมือจับคู่ */
  securityDepositSatang: number;
};

export type SettlementSettings = {
  enabled: boolean;
  windowDays: number;
  maxFeeRate: number;
  patterns: string[];
  otaMethods: string[];
};

export type ExclusionScope =
  | "property" | "group" | "method" | "channel" | "bookingStatus" | "keyword" | "refund" | "amount";

export type BankAccount = {
  /** เลขที่บัญชีตามที่พิมพ์บนเอกสาร — คือกุญแจที่ใช้จับคู่กับ statement */
  accountNo: string;
  /** ชื่อสั้นที่คนที่นี่ใช้เรียกบัญชีนี้ เช่น 885 */
  code: string;
  /** ช่องทางรับเงินในรายงานของ PMS เช่น KbankGL885 — ไม่มีอยู่ในเอกสารธนาคาร */
  method: string;
  label: string;
};

export type UnmappedAccount = {
  accountNo: string;
  code: string;
  bankLabel: string;
  accountName: string;
};

export type AppSettings = {
  version: number;
  exclusions: {
    enabled: boolean;
    properties: string[];
    groups: string[];
    methods: string[];
    channels: string[];
    bookingStatuses: string[];
    keywords: string[];
    excludeRefunds: boolean;
    minAmountSatang: number | null;
    maxAmountSatang: number | null;
  };
  matching: MatchOptions;
  settlement: SettlementSettings;
  accounts: BankAccount[];
  display: { ledgerRowLimit: number; showExcludedRows: boolean };
};

export type DecisionKind = "MANUAL" | "SETTLEMENT";
export type DecisionReason = "COMMISSION" | "BANK_FEE" | "ROUNDING" | "DISCOUNT" | "EXTRA_CHARGE" | "OTHER";

export type MatchDecision = {
  id: string;
  kind: DecisionKind;
  receiptIds: string[];
  bankLineIds: string[];
  receiptSatang: number;
  bankSatang: number;
  differenceSatang: number;
  reason: DecisionReason;
  note: string;
  decidedBy: string;
  decidedAt: string;
  staleReason?: "ROWS_GONE" | "ALREADY_USED" | "EMPTY";
};

export type SettlementCandidate = {
  id: string;
  reservationNo: string;
  guest: string;
  method: string;
  channel: string;
  date: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  group: string;
  amountSatang: number;
  dayGap: number;
  period: string;
  /** รับเงินไว้คนละเดือนกับที่ก้อนโอนเข้าบัญชี */
  crossPeriod: boolean;
  selected: boolean;
};

export type SettlementProposal = {
  id: string;
  lineId: string;
  account: string;
  date: string;
  /** งวดที่ก้อนโอนเข้าบัญชี */
  period: string;
  /** งวดที่รายการในก้อนถูกบันทึกรับเงินไว้ — มากกว่าหนึ่งคือก้อนที่เหลื่อมเดือน */
  sourcePeriods: string[];
  crossPeriod: boolean;
  time: string;
  description: string;
  channel: string;
  detail: string;
  netSatang: number;
  grossSatang: number;
  feeSatang: number;
  feeRate: number;
  status: "READY" | "FEE_HIGH" | "SHORT" | "EMPTY";
  candidates: SettlementCandidate[];
  selectedIds: string[];
};

export type ExclusionHit = { scope: ExclusionScope; value: string };
export type ExcludedReceipt = Receipt & { excludedBy: ExclusionHit };
export type ExclusionBucket = ExclusionHit & { count: number; amountSatang: number };

export type Facet = { value: string; count: number; amountSatang: number; note?: string };
export type Facets = {
  properties: Facet[]; groups: Facet[]; methods: Facet[]; channels: Facet[]; bookingStatuses: Facet[];
};

export type EffectiveDataset = {
  /** ชุดข้อมูลที่ทุกหน้าจอใช้ — ตัดรายการที่ไม่เอาออก และกระทบยอดใหม่เรียบร้อย */
  dataset: Dataset;
  excluded: ExcludedReceipt[];
  excludedSatang: number;
  buckets: ExclusionBucket[];
  sourceReceiptCount: number;
  sourceReceiptSatang: number;
  activeRuleCount: number;
  settlements: SettlementProposal[];
  /** บัญชีที่อัปโหลดแล้วแต่ยังไม่ได้ผูกช่องทางรับเงิน — จับคู่ไม่ได้จนกว่าจะผูก */
  unmappedAccounts: UnmappedAccount[];
};

export const DEFAULT_SETTINGS = core.DEFAULT_SETTINGS as AppSettings;
export const EXCLUSION_SCOPE_LABEL = core.EXCLUSION_SCOPE_LABEL as Record<ExclusionScope, string>;
export const DECISION_REASONS = engine.DECISION_REASONS as Record<DecisionReason, { label: string; detail: string }>;

export const propertyOf = core.propertyOf as (group: string) => string;
export const normalizeSettings = core.normalizeSettings as (raw: unknown) => AppSettings;
export const countActiveRules = core.countActiveRules as (settings: AppSettings) => number;
export const describeFacets = core.describeFacets as (dataset: Dataset) => Facets;
export const receiptExclusion = core.receiptExclusion as (
  receipt: Receipt, settings: AppSettings, booking?: Booking,
) => ExclusionHit | null;
export const applySettings = core.applySettings as (
  dataset: Dataset, settings: AppSettings, decisions?: MatchDecision[],
) => EffectiveDataset;

export const dayGap = engine.dayGap as (left: string, right: string) => number;

export const ALL_PERIODS: string = core.ALL_PERIODS;

/** ตัดชุดข้อมูลที่กระทบยอดเสร็จแล้วให้เหลืองวดเดียวเพื่อแสดงผล — ไม่คำนวณอะไรใหม่ */
export const scopeToPeriod = core.scopeToPeriod as (
  effective: EffectiveDataset,
  period: string,
) => EffectiveDataset;

// ── ที่เก็บค่า ───────────────────────────────────────────────────────────────
//
// มีฐานข้อมูล → เซิร์ฟเวอร์เป็นเจ้าของค่า ทุกเครื่องเห็นตรงกัน
// ไม่มี        → เก็บลง localStorage ของเครื่องนั้น เพื่อให้ยังใช้งานได้
//
// ทั้งสองทางอ่านผ่าน external store ตัวเดียวกัน หน้าจอจึงไม่ต้องรู้ว่าอยู่โหมดไหน
// และ SSR กับการ hydrate ครั้งแรกได้ค่าเดียวกันเสมอ

export type WorkspaceState = { settings: AppSettings; decisions: MatchDecision[]; online: boolean };

const readLocal = <T,>(key: string, fallback: T, revive: (raw: unknown) => T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? revive(JSON.parse(stored)) : fallback;
  } catch {
    return fallback;
  }
};

const writeLocal = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // โหมดส่วนตัวของเบราว์เซอร์เขียนไม่ได้ — ใช้ค่าที่อยู่บนหน้าจอต่อไปเงียบ ๆ
  }
};

const asDecisions = (raw: unknown): MatchDecision[] => (Array.isArray(raw) ? (raw as MatchDecision[]) : []);

// สถานะฝั่งเบราว์เซอร์เท่านั้น ฝั่งเซิร์ฟเวอร์ไม่มี window จึงไม่เคยถูกเขียน
// และไม่มีทางรั่วข้ามคำขอของคนละคน — ค่าที่ SSR ใช้มาจาก props ล้วน ๆ
let state: WorkspaceState | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());

/**
 * วางค่าตั้งต้นจากเซิร์ฟเวอร์ **ครั้งเดียวต่อการโหลดหน้า**
 *
 * เรียกซ้ำได้ทุก render โดยไม่ทับของที่ผู้ใช้เพิ่งบันทึก ถ้าไม่มีการ์ดนี้ การกด
 * ยืนยันจะถูกลบทิ้งทันทีที่ component render รอบถัดไป
 */
export function primeWorkspace(seed: WorkspaceState) {
  if (typeof window === "undefined" || state !== null) return;
  state = seed.online ? seed : {
    settings: readLocal(SETTINGS_STORAGE_KEY, seed.settings, normalizeSettings),
    decisions: readLocal(DECISIONS_STORAGE_KEY, seed.decisions, asDecisions),
    online: false,
  };
}

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** ต้องคืนออบเจ็กต์ตัวเดิมจนกว่าค่าจะเปลี่ยนจริง มิฉะนั้น React จะ render วน */
export function getWorkspaceState(): WorkspaceState | null {
  return state;
}

/** ตอน SSR และตอน hydrate ยังไม่มีสถานะฝั่งเครื่อง หน้าจอจึงใช้ค่าจาก props */
export function getServerWorkspaceState(): WorkspaceState | null {
  return null;
}

function commit(next: WorkspaceState) {
  state = next;
  publish();
}

/** ค่าที่ใช้อยู่จริงตอนนี้ — เรียกจากตัวบันทึกซึ่งทำงานหลัง hydrate เสมอ */
function current(): WorkspaceState {
  return state ?? { settings: DEFAULT_SETTINGS, decisions: [], online: false };
}

type SaveResult = { ok: boolean; error?: string };

async function post(body: unknown): Promise<{ ok: boolean; error?: string; decisions?: MatchDecision[] }> {
  const response = await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, error: payload?.error, decisions: payload?.decisions };
}

export async function saveSettings(settings: AppSettings): Promise<SaveResult> {
  const currentState = current();
  commit({ ...currentState, settings });

  if (!currentState.online) {
    writeLocal(SETTINGS_STORAGE_KEY, settings);
    return { ok: true };
  }
  const result = await post({ action: "saveSettings", settings });
  if (!result.ok) commit(currentState); // เซิร์ฟเวอร์ไม่รับ ก็ต้องไม่หลอกว่าบันทึกแล้ว
  return result;
}

export async function resetSettings(): Promise<SaveResult> {
  return saveSettings(DEFAULT_SETTINGS);
}

export async function saveDecision(decision: Omit<MatchDecision, "id" | "decidedBy" | "decidedAt"> & { id?: string }): Promise<SaveResult> {
  const currentState = current();
  const local: MatchDecision = {
    ...decision,
    id: decision.id ?? `DEC-${Date.now().toString(36).toUpperCase()}`,
    decidedBy: "web",
    decidedAt: new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace("Z", ""),
  };
  const decisions = [...currentState.decisions.filter((item) => item.id !== local.id), local];
  commit({ ...currentState, decisions });

  if (!currentState.online) {
    writeLocal(DECISIONS_STORAGE_KEY, decisions);
    return { ok: true };
  }
  const result = await post({ action: "saveDecision", decision: local });
  if (!result.ok) commit(currentState);
  else if (result.decisions) commit({ ...currentState, decisions: result.decisions });
  return result;
}

export async function removeDecision(id: string): Promise<SaveResult> {
  const currentState = current();
  const decisions = currentState.decisions.filter((item) => item.id !== id);
  commit({ ...currentState, decisions });

  if (!currentState.online) {
    writeLocal(DECISIONS_STORAGE_KEY, decisions);
    return { ok: true };
  }
  const result = await post({ action: "removeDecision", id });
  if (!result.ok) commit(currentState);
  else if (result.decisions) commit({ ...currentState, decisions: result.decisions });
  return result;
}

if (typeof window !== "undefined") {
  // แก้ค่าที่แท็บหนึ่ง ให้แท็บอื่นที่เปิดค้างไว้เห็นตรงกัน (เฉพาะโหมดออฟไลน์)
  window.addEventListener("storage", (event) => {
    const currentState = current();
    if (currentState.online) return;
    if (event.key !== SETTINGS_STORAGE_KEY && event.key !== DECISIONS_STORAGE_KEY && event.key !== null) return;
    commit({
      online: false,
      settings: readLocal(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS, normalizeSettings),
      decisions: readLocal(DECISIONS_STORAGE_KEY, [], asDecisions),
    });
  });
}
