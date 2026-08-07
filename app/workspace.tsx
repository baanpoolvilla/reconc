"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { WorkspaceContext, type Tone, type ViewId, type WorkspaceValue } from "./ui";
import { Home, Report } from "./views-home";
import { FixQueue, Settlements } from "./views-match";
import { Browse, Settings, Upload } from "./views-data";
import { type Dataset, thaiMonthLabel } from "../lib/dataset";
import {
  type AppSettings,
  type MatchDecision,
  type WorkspaceState,
  DEFAULT_SETTINGS,
  applySettings,
  getServerWorkspaceState,
  getWorkspaceState,
  normalizeSettings,
  primeWorkspace,
  removeDecision,
  saveDecision,
  saveSettings as persistSettings,
  subscribeWorkspace,
} from "../lib/settings";

// เปลือกของแอป
//
// เมนูมีหกอัน เรียงตามลำดับที่คนทำงานจริง ๆ ใช้: ดูว่าต้องทำอะไร → ทำ → ตรวจ →
// ใส่เอกสารรอบใหม่ ทุกหน้าจออ่านชุดข้อมูลเดียวกันที่คำนวณใหม่ทุกครั้งที่มีการ
// เปลี่ยนแปลง จึงไม่มีทางเห็นตัวเลขคนละชุดกันระหว่างหน้า

const NAV: { id: ViewId; label: string; icon: string }[] = [
  { id: "home", label: "หน้าแรก", icon: "⌂" },
  { id: "fix", label: "ยอดที่ไม่ตรง", icon: "≠" },
  { id: "ota", label: "ก้อนโอน OTA", icon: "⊞" },
  { id: "browse", label: "ค้นหารายการ", icon: "⌕" },
  { id: "report", label: "รายงาน", icon: "▤" },
  { id: "upload", label: "นำเข้าเอกสาร", icon: "↑" },
  { id: "settings", label: "ตั้งค่า", icon: "⚙" },
];

const VIEW_IDS = NAV.map((item) => item.id) as string[];

export default function Workspace({ dataset: raw, source, databaseConfigured, online, serverSettings, serverDecisions, loadError }: {
  dataset: Dataset;
  source: string;
  databaseConfigured: boolean;
  online: boolean;
  serverSettings: AppSettings | null;
  serverDecisions: MatchDecision[];
  loadError?: string;
}) {
  // ค่าจากเซิร์ฟเวอร์คือความจริงตอน SSR และตอน hydrate ส่วนสถานะฝั่งเบราว์เซอร์
  // จะทับก็ต่อเมื่อมีจริง (ผู้ใช้เพิ่งบันทึก หรืออ่านมาจากเครื่องในโหมดออฟไลน์)
  const serverState = useMemo<WorkspaceState>(() => ({
    settings: serverSettings ? normalizeSettings(serverSettings) : DEFAULT_SETTINGS,
    decisions: serverDecisions ?? [],
    online,
  }), [serverSettings, serverDecisions, online]);

  primeWorkspace(serverState);
  const clientState = useSyncExternalStore(subscribeWorkspace, getWorkspaceState, getServerWorkspaceState);
  const stored = clientState ?? serverState;
  const [active, setActive] = useState<ViewId>("home");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);

  const effective = useMemo(
    () => applySettings(raw, stored.settings, stored.decisions),
    [raw, stored.settings, stored.decisions],
  );

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      if (VIEW_IDS.includes(hash)) setActive(hash as ViewId);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const go = useCallback((view: ViewId) => {
    setActive(view);
    if (window.location.hash.slice(1) !== view) window.history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const notify = useCallback((message: string, tone: Tone = "green") => setToast({ message, tone }), []);

  const saveSettings = useCallback(async (next: AppSettings) => {
    setBusy(true);
    const result = await persistSettings(next);
    setBusy(false);
    if (!result.ok) notify(result.error ?? "บันทึกการตั้งค่าไม่สำเร็จ", "red");
  }, [notify]);

  const confirmMatch = useCallback<WorkspaceValue["confirmMatch"]>(async (input) => {
    setBusy(true);
    const result = await saveDecision({
      kind: input.kind,
      receiptIds: input.receiptIds,
      bankLineIds: input.bankLineIds,
      receiptSatang: input.receiptSatang,
      bankSatang: input.bankSatang,
      differenceSatang: input.receiptSatang - input.bankSatang,
      reason: (input.reason || "OTHER") as MatchDecision["reason"],
      note: input.note,
    });
    setBusy(false);
    if (!result.ok) {
      notify(result.error ?? "บันทึกไม่สำเร็จ", "red");
      return false;
    }
    notify(input.kind === "SETTLEMENT" ? "แตกยอดก้อนนี้เรียบร้อย" : "จับคู่เรียบร้อย");
    return true;
  }, [notify]);

  const undoMatch = useCallback(async (id: string) => {
    setBusy(true);
    const result = await removeDecision(id);
    setBusy(false);
    notify(result.ok ? "ยกเลิกแล้ว รายการกลับไปอยู่ในคิวงาน" : (result.error ?? "ยกเลิกไม่สำเร็จ"), result.ok ? "green" : "red");
  }, [notify]);

  const dataset = effective.dataset;
  const hasData = dataset.meta.sources.length > 0;
  const openWork = dataset.reconciliation.exceptions.length + effective.settlements.length;

  const value: WorkspaceValue = {
    raw,
    dataset,
    effective,
    settings: stored.settings,
    decisions: stored.decisions,
    online: stored.online,
    source,
    hasData,
    busy,
    go,
    notify,
    saveSettings,
    confirmMatch,
    undoMatch,
  };

  const orgName = raw.statements[0]?.accountName?.trim() || "ยังไม่ได้ระบุกิจการ";

  return (
    <WorkspaceContext.Provider value={value}>
      <div className="app">
        <aside className="side">
          <button className="brand" onClick={() => go("home")}>
            <span className="brand-mark"><i /><i /><i /></span>
            <span><b>ClearClose</b><small>กระทบยอดบัญชี</small></span>
          </button>

          <div className="side-org">
            <b>{orgName}</b>
            <small>{raw.meta.period ? thaiMonthLabel(raw.meta.period) : "ยังไม่มีรอบบัญชี"}</small>
          </div>

          <nav aria-label="เมนูหลัก">
            {NAV.map((item) => {
              const badge = item.id === "fix" ? dataset.reconciliation.exceptions.length
                : item.id === "ota" ? effective.settlements.length
                : 0;
              return (
                <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => go(item.id)}>
                  <span className="side-icon">{item.icon}</span>
                  <b>{item.label}</b>
                  {badge > 0 && <em>{badge}</em>}
                </button>
              );
            })}
          </nav>

          <div className="side-foot">
            <span className={`side-dot ${stored.online ? "on" : "off"}`} />
            <p>
              <b>{stored.online ? "ออนไลน์" : "เก็บในเครื่องนี้"}</b>
              <small>{stored.online ? "ทุกเครื่องเห็นตรงกัน" : "ยังไม่ได้ตั้ง DATABASE_URL"}</small>
            </p>
          </div>
        </aside>

        <main>
          <header className="topbar">
            <div className="topbar-brand"><span className="brand-mark"><i /><i /><i /></span><b>ClearClose</b></div>
            <div className="topbar-status">
              {hasData && (openWork > 0
                ? <span className="work-chip"><i className="dot amber" />เหลืองานค้าง {openWork.toLocaleString("en-US")} รายการ</span>
                : <span className="work-chip"><i className="dot green" />เคลียร์ครบแล้ว</span>)}
            </div>
            <button className="primary-button" onClick={() => go("upload")}>＋ นำเข้าเอกสาร</button>
          </header>

          <div className="content">
            {loadError && (
              <div className="banner red">
                <span className="banner-mark">!</span>
                <p><b>อ่านข้อมูลจากฐานข้อมูลไม่สำเร็จ</b><small className="mono">{loadError}</small></p>
              </div>
            )}

            {active === "home" && <Home />}
            {active === "fix" && (hasData ? <FixQueue /> : <Home />)}
            {active === "ota" && (hasData ? <Settlements /> : <Home />)}
            {active === "browse" && (hasData ? <Browse /> : <Home />)}
            {active === "report" && (hasData ? <Report /> : <Home />)}
            {active === "upload" && <Upload />}
            {active === "settings" && <Settings />}

            <footer>
              <span>ClearClose · กฎเวอร์ชัน {dataset.reconciliation.rulesetVersion}</span>
              <p>
                {source === "database" ? "ข้อมูลจากฐานข้อมูล" : source === "build" ? "ข้อมูลจากโฟลเดอร์ data/" : "ยังไม่มีข้อมูล"}
                {databaseConfigured && !stored.online ? " · ต่อฐานข้อมูลไม่ได้" : ""}
              </p>
            </footer>
          </div>
        </main>

        {toast && <div className={`toast ${toast.tone}`}><span>{toast.tone === "red" ? "!" : "✓"}</span>{toast.message}</div>}
      </div>
    </WorkspaceContext.Provider>
  );
}
