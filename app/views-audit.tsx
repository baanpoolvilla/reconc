"use client";

import { useEffect, useMemo, useState } from "react";
import { Banner, EmptyState, PageHeading, PanelTitle, Pill, SearchBox, type Tone, useWorkspace } from "./ui";
import { thaiDateTime } from "../lib/dataset";
import { AUDIT_ACTIONS } from "../lib/settings";

// สมุดตรวจ — ใครทำอะไรเมื่อไหร่
//
// ระบบบันทึกทุกการกระทำที่เปลี่ยนผลลัพธ์ไว้ตั้งแต่แรก แต่ไม่เคยมีหน้าจอไหนแสดงมัน
// สมุดที่อ่านได้เฉพาะจาก SQL คือสมุดที่แผนกบัญชีตรวจไม่ได้ ซึ่งเท่ากับไม่มี
//
// หน้านี้อ่านอย่างเดียว ไม่มีปุ่มแก้และไม่มีปุ่มลบ — สมุดตรวจที่แก้ได้จากหน้าจอ
// ไม่ใช่สมุดตรวจ

type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

const meta = (action: string) =>
  (AUDIT_ACTIONS as Record<string, { label: string; tone: string }>)[action]
  ?? { label: action, tone: "slate" };

/**
 * รายละเอียดของเหตุการณ์ ในรูปที่คนอ่านได้
 *
 * เหตุการณ์แต่ละชนิดเก็บ detail คนละหน้าตา การบีบให้เป็นรูปเดียวจะทำให้เสีย
 * รายละเอียดที่ตอนตรวจจริงอาจเป็นสิ่งเดียวที่ตอบคำถามได้ จึงแปลเฉพาะคีย์ที่รู้จัก
 * แล้วปล่อยที่เหลือแสดงตามเดิม
 */
const FIELD_LABEL: Record<string, string> = {
  kind: "ชนิดเอกสาร", rows: "จำนวนแถว", period: "งวด", periods: "งวด",
  fileStored: "เก็บไฟล์ต้นฉบับ", reason: "เหตุผล", note: "หมายเหตุ",
  receipts: "รายการรับเงิน", lines: "เงินเข้า", differenceSatang: "ผลต่าง",
  netSatang: "รับสุทธิ", payer: "ผู้จ่าย", decisionId: "รหัสการจับคู่",
  rulesetVersion: "กฎเวอร์ชัน", previousRulesetVersion: "กฎเวอร์ชันเดิม",
};

function describe(event: AuditEvent) {
  const detail = event.detail ?? {};
  const parts: string[] = [];

  for (const [key, value] of Object.entries(detail)) {
    if (value === null || value === undefined || value === "") continue;
    if (key === "previous" || key === "rejected") continue;
    const label = FIELD_LABEL[key] ?? key;
    const shown = key.endsWith("Satang") && typeof value === "number"
      ? `฿${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
      : Array.isArray(value) ? value.join(", ")
      : typeof value === "boolean" ? (value ? "ใช่" : "ไม่")
      : String(value);
    parts.push(`${label} ${shown}`);
  }

  if (Array.isArray(detail.rejected)) parts.push(`ปฏิเสธ ${detail.rejected.length} ไฟล์`);
  if (detail.previous) parts.push("บันทึกค่าเดิมไว้แล้ว");
  return parts.join(" · ");
}

export function Audit() {
  const { go, online } = useWorkspace();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [counts, setCounts] = useState<{ action: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState("");
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ limit: "500" });
    if (action) params.set("action", action);

    fetch(`/api/audit?${params}`)
      .then((response) => response.json())
      .then((body) => {
        if (!alive) return;
        setEvents(body.events ?? []);
        setCounts(body.counts ?? []);
        setFailed(body.error ?? "");
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed("ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ");
        setLoading(false);
      });
    return () => { alive = false; };
  }, [action]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return events;
    return events.filter((event) =>
      `${event.entityId} ${event.actor} ${meta(event.action).label} ${describe(event)}`.toLowerCase().includes(needle));
  }, [events, query]);

  const exportCsv = () => {
    const header = ["เวลา", "การกระทำ", "สิ่งที่ถูกกระทำ", "รายละเอียด", "โดย"];
    const escape = (value: string) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = visible.map((event) => [
      event.createdAt, meta(event.action).label, event.entityId || event.entityType, describe(event), event.actor,
    ].map(escape).join(","));

    const blob = new Blob([`﻿${[header.map(escape).join(","), ...rows].join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "clearclose-audit.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!online) {
    return (
      <>
        <PageHeading title="สมุดตรวจ" action={<button className="ghost-button" onClick={() => go("home")}>← กลับหน้าแรก</button>} />
        <Banner tone="amber" title="สมุดตรวจต้องมีฐานข้อมูล">
          ในโหมดเก็บในเครื่อง ไม่มีที่บันทึกกลางให้ตรวจย้อนหลัง — ตั้งค่า <code>DATABASE_URL</code> ก่อน
        </Banner>
      </>
    );
  }

  return (
    <>
      <PageHeading
        title="สมุดตรวจ"
        description="ทุกการกระทำที่เปลี่ยนผลลัพธ์ถูกบันทึกไว้ที่นี่ · อ่านอย่างเดียว แก้ไม่ได้และลบไม่ได้"
        action={<button className="primary-button" onClick={exportCsv} disabled={!visible.length}>⇩ ส่งออก CSV</button>}
      />

      {failed && <Banner tone="red" title="อ่านสมุดตรวจไม่สำเร็จ">{failed}</Banner>}

      <div className="queue-toolbar">
        <nav className="settings-nav">
          <button className={action === "" ? "active" : ""} onClick={() => setAction("")}>
            ทั้งหมด
          </button>
          {counts.map((item) => (
            <button key={item.action} className={action === item.action ? "active" : ""} onClick={() => setAction(item.action)}>
              {meta(item.action).label} <em className="nav-count">{item.total}</em>
            </button>
          ))}
        </nav>
        <SearchBox value={query} onChange={setQuery} placeholder="ค้นหาชื่อไฟล์ เลขที่ใบเสร็จ หรือเหตุผล" />
      </div>

      {loading && <p className="table-note">กำลังอ่านสมุดตรวจ…</p>}

      {!loading && !visible.length && (
        <EmptyState
          icon="▤"
          title="ยังไม่มีเหตุการณ์ในหมวดนี้"
          detail="สมุดตรวจจะเริ่มบันทึกตั้งแต่การอัปโหลดเอกสารครั้งแรก"
          action={<button className="primary-button" onClick={() => go("upload")}>ไปหน้านำเข้าเอกสาร</button>}
        />
      )}

      {!loading && visible.length > 0 && (
        <section className="panel">
          <PanelTitle
            title="เหตุการณ์ล่าสุดก่อน"
            action={<span className="panel-note">{visible.length.toLocaleString("en-US")} เหตุการณ์</span>}
          />
          <div className="responsive-table">
            <table>
              <thead>
                <tr><th>เวลา</th><th>การกระทำ</th><th>สิ่งที่ถูกกระทำ</th><th>รายละเอียด</th><th>โดย</th></tr>
              </thead>
              <tbody>
                {visible.map((event) => (
                  <tr key={event.id}>
                    <td className="mono">{thaiDateTime(event.createdAt)}</td>
                    <td><Pill tone={meta(event.action).tone as Tone}>{meta(event.action).label}</Pill></td>
                    <td className="wrap"><b>{event.entityId || "—"}</b><small className="block">{event.entityType}</small></td>
                    <td className="wrap">{describe(event) || "—"}</td>
                    <td>{event.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
