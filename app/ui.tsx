"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { Dataset } from "../lib/dataset";
import type { AppSettings, EffectiveDataset, MatchDecision } from "../lib/settings";

// Primitives and the shared workspace context.
//
// The screens are written so a hotel bookkeeper — not an accountant who reads
// reconciliation software for a living — can work through them: one clear job
// per screen, one primary button, plain Thai, and no jargon that only makes
// sense if you already know the ruleset.

export type Tone = "green" | "blue" | "amber" | "red" | "slate";

export type ViewId = "home" | "fix" | "ota" | "browse" | "report" | "upload" | "settings";

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
export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress-block">
      <div className="progress-head"><b>{label}</b><span>{done.toLocaleString("en-US")} / {total.toLocaleString("en-US")}</span></div>
      <div className="progress-track"><i style={{ width: `${Math.max(percent, total ? 2 : 0)}%` }} /></div>
      <small>{percent}% ของรอบนี้เคลียร์แล้ว</small>
    </div>
  );
}

/** การ์ดงานบนหน้าแรก — กดแล้วไปทำงานนั้นเลย */
export function TaskCard({ tone, icon, title, detail, count, unit, amount, action, onClick, disabled }: {
  tone: Tone; icon: string; title: string; detail: string;
  count: number; unit: string; amount?: string; action: string;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" className={`task-card ${tone} ${disabled ? "done" : ""}`} onClick={onClick} disabled={disabled}>
      <span className="task-card-icon">{icon}</span>
      <span className="task-card-body">
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      <span className="task-card-figures">
        <strong>{count.toLocaleString("en-US")}</strong>
        <small>{unit}</small>
        {amount && <em>{amount}</em>}
      </span>
      <span className="task-card-go">{disabled ? "เรียบร้อย" : action} {!disabled && "›"}</span>
    </button>
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
