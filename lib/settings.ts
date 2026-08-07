import type { Booking, Dataset, Receipt } from "./dataset";
import * as core from "./settings-core.mjs";

// หน้ากากที่ใส่ type ให้ตรรกะใน settings-core.mjs พร้อมส่วนที่ทำงานได้เฉพาะบน
// เบราว์เซอร์ (การจำค่าที่ผู้ใช้ตั้งไว้) — เหมือนที่ dataset.ts ทำกับ reconciliation.mjs

export const SETTINGS_STORAGE_KEY = "clearclose.settings.v1";
export const SETTINGS_VERSION: number = core.SETTINGS_VERSION;

export type MatchOptions = { maxGroupSize: number; allowManyToOne: boolean; allowOneToMany: boolean };

export type ExclusionScope =
  | "property"
  | "group"
  | "method"
  | "channel"
  | "bookingStatus"
  | "keyword"
  | "refund"
  | "amount";

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
  display: {
    ledgerRowLimit: number;
    showExcludedRows: boolean;
  };
};

export type ExclusionHit = { scope: ExclusionScope; value: string };
export type ExcludedReceipt = Receipt & { excludedBy: ExclusionHit };
export type ExclusionBucket = ExclusionHit & { count: number; amountSatang: number };

export type Facet = { value: string; count: number; amountSatang: number; note?: string };
export type Facets = {
  properties: Facet[];
  groups: Facet[];
  methods: Facet[];
  channels: Facet[];
  bookingStatuses: Facet[];
};

export type EffectiveDataset = {
  /** ชุดข้อมูลที่ทุกหน้าจอใช้ — รายการที่ถูกตัดออกแล้ว และกระทบยอดใหม่เรียบร้อย */
  dataset: Dataset;
  excluded: ExcludedReceipt[];
  excludedSatang: number;
  buckets: ExclusionBucket[];
  sourceReceiptCount: number;
  sourceReceiptSatang: number;
  activeRuleCount: number;
};

export const DEFAULT_SETTINGS = core.DEFAULT_SETTINGS as AppSettings;
export const EXCLUSION_SCOPE_LABEL = core.EXCLUSION_SCOPE_LABEL as Record<ExclusionScope, string>;

export const propertyOf = core.propertyOf as (group: string) => string;
export const normalizeSettings = core.normalizeSettings as (raw: unknown) => AppSettings;
export const countActiveRules = core.countActiveRules as (settings: AppSettings) => number;
export const describeFacets = core.describeFacets as (dataset: Dataset) => Facets;
export const applySettings = core.applySettings as (dataset: Dataset, settings: AppSettings) => EffectiveDataset;
export const receiptExclusion = core.receiptExclusion as (
  receipt: Receipt,
  settings: AppSettings,
  booking?: Booking,
) => ExclusionHit | null;

// ── การจำค่าที่ผู้ใช้ตั้งไว้ ─────────────────────────────────────────────────
//
// localStorage เป็นแหล่งข้อมูลนอก React จึงใช้เป็น external store แล้วให้หน้าจอ
// อ่านผ่าน useSyncExternalStore ฝั่งเซิร์ฟเวอร์และตอน hydrate จะได้ค่าตั้งต้นเสมอ
// จึงไม่มีทางเกิด hydration mismatch และแท็บอื่นที่แก้ค่าก็อัปเดตตามให้ด้วย

function readStorage(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return stored ? normalizeSettings(JSON.parse(stored)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeStorage(settings: AppSettings | null): void {
  if (typeof window === "undefined") return;
  try {
    if (settings) window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    else window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // โหมดส่วนตัวของเบราว์เซอร์อาจเขียนไม่ได้ — ให้ใช้ค่าที่อยู่ในหน้าจอต่อไปเงียบ ๆ
  }
}

let snapshot: AppSettings | null = null;
const listeners = new Set<() => void>();

const publish = () => listeners.forEach((listener) => listener());

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** ต้องคืนออบเจ็กต์ตัวเดิมทุกครั้งจนกว่าค่าจะเปลี่ยนจริง มิฉะนั้น React จะ render วน */
export function getSettings(): AppSettings {
  if (snapshot === null) snapshot = readStorage();
  return snapshot;
}

export function getDefaultSettings(): AppSettings {
  return DEFAULT_SETTINGS;
}

export function setSettings(next: AppSettings): void {
  snapshot = next;
  writeStorage(next);
  publish();
}

/** ลืมค่าที่ผู้ใช้เคยตั้งไว้ กลับไปใช้ค่าตั้งต้นของระบบ */
export function resetSettings(): void {
  snapshot = DEFAULT_SETTINGS;
  writeStorage(null);
  publish();
}

if (typeof window !== "undefined") {
  // แก้ค่าที่แท็บหนึ่ง ให้แท็บอื่นที่เปิดค้างไว้เห็นตรงกัน
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY) return;
    snapshot = readStorage();
    publish();
  });
}
