"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { type Dataset, baht, thaiDate } from "../lib/dataset";
import type { AppSettings, EffectiveDataset, MatchDecision } from "../lib/settings";

// Primitives and the shared workspace context.
//
// The screens are written so a hotel bookkeeper — not an accountant who reads
// reconciliation software for a living — can work through them: one clear job
// per screen, one primary button, plain Thai, and no jargon that only makes
// sense if you already know the ruleset.

export type Tone = "green" | "blue" | "amber" | "red" | "slate";

export type ViewId = "home" | "fix" | "ota" | "receipts" | "browse" | "report" | "upload" | "settings" | "help" | "audit";

export type WorkspaceValue = {
  /** เอกสารต้นทางดิบ ก่อนใช้ตัวกรองใด ๆ */
  raw: Dataset;
  /** ชุดข้อมูลที่ทุกหน้าจอใช้ — ตัดเหลือเฉพาะงวดที่เลือกอยู่แล้ว */
  dataset: Dataset;
  effective: EffectiveDataset;
  /** ผลกระทบยอดของทุกงวดรวมกัน ก่อนตัดตามงวดที่เลือก */
  all: EffectiveDataset;
  /** งวดที่กำลังดูอยู่ รูป YYYY-MM หรือ "all" */
  period: string;
  /** ทุกงวดที่มีข้อมูลอยู่ เรียงจากเก่าไปใหม่ */
  periods: string[];
  setPeriod: (next: string) => void;
  settings: AppSettings;
  decisions: MatchDecision[];
  online: boolean;
  source: string;
  hasData: boolean;
  busy: boolean;
  go: (view: ViewId) => void;
  notify: (message: string, tone?: Tone) => void;
  saveSettings: (next: AppSettings) => Promise<void>;
  confirmMatch: (input: {
    kind: "MANUAL" | "SETTLEMENT";
    receiptIds: string[];
    bankLineIds: string[];
    receiptSatang: number;
    bankSatang: number;
    reason: string;
    note: string;
  }) => Promise<boolean>;
  undoMatch: (id: string) => Promise<void>;
};

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);
export const useWorkspace = () => useContext(WorkspaceContext) as WorkspaceValue;

// ── พื้นฐาน ───────────────────────────────────────────────────────────────────

export function Pill({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function PanelTitle({ kicker, title, action }: { kicker?: string; title: string; action?: ReactNode }) {
  return <div className="panel-title"><span>{kicker && <small>{kicker}</small>}<h2>{title}</h2></span>{action}</div>;
}

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {action}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

/** แถบความคืบหน้าของรอบบัญชี — ตัวเลขเดียวที่บอกว่าเหลืออีกเท่าไหร่ */
/**
 * ความคืบหน้าของรอบ
 *
 * `outside` คือรายการที่ยังไม่เข้าสู่การกระทบยอดเลย ซึ่งไม่ได้อยู่ในตัวหาร —
 * ไม่บอกไว้ตรงนี้ หน้าจอจะประกาศว่า "100% เคลียร์แล้ว" ได้ทั้งที่รายการเกือบ
 * ทั้งเดือนยังไม่ถูกแตะ เพราะตัวหารเหลืออยู่ใบเดียว
 */
export function Progress({ done, total, label, outside = 0 }: {
  done: number; total: number; label: string; outside?: number;
}) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress-block">
      <div className="progress-head"><b>{label}</b><span>{done.toLocaleString("en-US")} / {total.toLocaleString("en-US")}</span></div>
      <div className="progress-track"><i style={{ width: `${Math.max(percent, total ? 2 : 0)}%` }} /></div>
      <small>
        {total === 0
          ? "ยังไม่มีรายการไหนเข้าสู่การกระทบยอด"
          : `${percent}% ของรายการที่เข้าสู่การกระทบยอดแล้ว`}
        {outside > 0 && (
          <b className="progress-outside"> · อีก {outside.toLocaleString("en-US")} รายการยังไม่เข้าสู่การกระทบยอด</b>
        )}
      </small>
    </div>
  );
}

/**
 * งวดการจ่ายทั้งหมดของคำจองใบเดียวกัน
 *
 * คำจองหนึ่งใบจ่ายได้หลายงวด และงวดที่ผู้ตรวจกำลังดูอยู่จะอธิบายตัวเองไม่ได้เลย
 * ถ้าไม่เห็นงวดอื่น ๆ ของคำจองเดียวกัน — ยอด 3,000 บาทลอย ๆ ไม่บอกอะไร แต่
 * "มัดจำ 3,900 วันจอง + ที่เหลือ 3,000 วัน Check-in = 6,900 เท่ายอดคำจองพอดี"
 * คือหลักฐานที่กดยืนยันได้ทันที
 *
 * ผูกกันด้วยเลขที่การจอง ซึ่งเป็นกุญแจเดียวที่รายงานการรับเงินกับบัญชีแยกประเภท
 * ใช้ตรงกัน
 */
export function BookingInstalments({ reservationNo, highlightId }: { reservationNo: string; highlightId?: string }) {
  const { all } = useWorkspace();
  const dataset = all.dataset;

  const rows = useMemo(() => {
    if (!reservationNo) return null;
    const booking = dataset.bookings.find((item) => item.reservationNo === reservationNo);
    const receipts = dataset.receipts
      .filter((item) => item.reservationNo === reservationNo)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (receipts.length < 2 && !booking) return null;

    const matched = new Set(dataset.reconciliation.groups.flatMap((group) => group.receipts.map((row) => row.id)));
    return { booking, receipts, matched };
  }, [dataset, reservationNo]);

  if (!rows || rows.receipts.length < 2) return null;

  const paid = rows.receipts.reduce((sum, item) => sum + item.amountSatang, 0);
  const total = rows.booking?.totalSatang ?? 0;

  return (
    <div className="instalments">
      <b>คำจองนี้จ่าย {rows.receipts.length} งวด</b>
      <ol>
        {rows.receipts.map((item, index) => (
          <li key={item.id} className={item.id === highlightId ? "current" : ""}>
            <span className="instalment-no">{index + 1}</span>
            <span>
              <b>{baht(item.amountSatang)}</b>
              <small>
                {thaiDate(item.date)} · {item.method}
                {item.date === item.checkIn && " · วัน Check-in"}
                {item.date === rows.booking?.createdDate && " · วันที่จอง"}
              </small>
            </span>
            <span className="instalment-state">
              {item.id === highlightId ? "กำลังดูอยู่" : rows.matched.has(item.id) ? "✓ กระทบยอดแล้ว" : "ยังค้าง"}
            </span>
          </li>
        ))}
      </ol>
      {total > 0 && (
        <p className={paid === total ? "instalment-sum ok" : "instalment-sum"}>
          รวมทุกงวด {baht(paid)} · ยอดคำจอง {baht(total)}
          {paid === total ? " · ครบพอดี" : ` · ต่างอยู่ ${baht(total - paid)}`}
        </p>
      )}
    </div>
  );
}

/**
 * ลำดับขั้นของการปิดรอบ
 *
 * งานกระทบยอดเป็นลำดับ ไม่ใช่แดชบอร์ด: ผูกบัญชี → ใส่เอกสาร → เคลียร์ที่ไม่ตรง →
 * แตกยอดก้อนโอน → ออกใบเสร็จ → ปิดรอบ หน้าจอที่วางทุกอย่างเป็นการ์ดเท่ากันหมด
 * บังคับให้คนใหม่ต้องเดาเองว่าเริ่มตรงไหน และเดาผิดได้ทั้งเดือนโดยไม่มีใครทัก
 *
 * แต่ละขั้นบอกสามอย่างเสมอ: ทำอะไร ทำไปทำไม และตอนนี้อยู่สถานะไหน
 */
export type StepState = "done" | "now" | "later" | "blocked" | "optional";

const STEP_MARK: Record<StepState, string> = {
  done: "✓", now: "▸", later: "·", blocked: "!", optional: "○",
};

const STEP_WORD: Record<StepState, string> = {
  done: "เรียบร้อย", now: "ทำต่อตรงนี้", later: "ยังไม่ถึงคิว", blocked: "ติดอยู่", optional: "ทำหรือไม่ก็ได้",
};

export function StepList({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="steps">
      <header>
        <b>{title}</b>
        {note && <span>{note}</span>}
      </header>
      <ol>{children}</ol>
    </section>
  );
}

export function Step({ index, state, title, why, figure, action, onAction }: {
  index: number;
  state: StepState;
  title: string;
  why: string;
  figure?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <li className={`step step-${state}`}>
      <span className="step-mark" aria-hidden>{state === "done" ? STEP_MARK.done : index}</span>
      <span className="step-body">
        <b>{title}</b>
        <small>{why}</small>
      </span>
      <span className="step-side">
        {figure && <em>{figure}</em>}
        <span className="step-state">{STEP_WORD[state]}</span>
      </span>
      {action && onAction && (
        <button className={state === "now" || state === "blocked" ? "primary-button" : "secondary-button"} onClick={onAction}>
          {action}
        </button>
      )}
    </li>
  );
}

export function Stat({ label, value, detail, tone = "slate" }: { label: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <article className={`stat ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail && <p>{detail}</p>}
    </article>
  );
}

export function EmptyState({ icon = "✓", title, detail, action }: {
  icon?: string; title: string; detail?: string; action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}

export function Banner({ tone = "blue", title, children, action }: {
  tone?: Tone; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={`banner ${tone}`}>
      <span className="banner-mark">{tone === "red" ? "!" : tone === "amber" ? "!" : tone === "green" ? "✓" : "i"}</span>
      <p><b>{title}</b>{children && <small>{children}</small>}</p>
      {action}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (next: string) => void; placeholder: string }) {
  return (
    <label className="search-box">
      <span aria-hidden>⌕</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value && <button type="button" aria-label="ล้างคำค้น" onClick={() => onChange("")}>×</button>}
    </label>
  );
}

export function Tabs({ value, onChange, options }: {
  value: string; onChange: (next: string) => void; options: { value: string; label: string; count?: number }[];
}) {
  return (
    <div className="tabs">
      {options.map((option) => (
        <button key={option.value} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
          {option.label}
          {option.count !== undefined && <span>{option.count.toLocaleString("en-US")}</span>}
        </button>
      ))}
    </div>
  );
}
