"use client";

import type { ReactNode } from "react";

// Primitives shared by every view. They live outside workspace.tsx so the
// settings screen can use them without importing the shell it is rendered by.

export type Tone = "green" | "blue" | "amber" | "red" | "slate";

export function Pill({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function PanelTitle({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
  return <div className="panel-title"><span><small>{kicker}</small><h2>{title}</h2></span>{action}</div>;
}

export function Metric({ label, value, detail, tone = "slate", badge }: {
  label: string; value: string; detail: string; tone?: Tone; badge?: string;
}) {
  return (
    <article className="metric-card">
      <div><span>{label}</span>{badge && <Pill tone={tone}>{badge}</Pill>}</div>
      <strong>{value}</strong>
      <p>{detail}</p>
      <i className={`metric-line ${tone}`} />
    </article>
  );
}

export function PageHeading({ eyebrow, title, description, action }: {
  eyebrow: string; title: string; description: string; action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div><span className="page-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  );
}

/** On/off control that reads as a sentence: label, explanation, state. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}
