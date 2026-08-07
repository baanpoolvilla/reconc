"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Metric, PageHeading, PanelTitle, Pill, type Tone } from "./ui";
import SettingsView from "./settings-view";
import {
  type AccountResult,
  type Booking,
  type Dataset,
  type MatchGroup,
  type Receipt,
  type ReconciliationException,
  type Statement,
  baht,
  thaiDate,
  thaiDateTime,
  thaiMonthLabel,
} from "../lib/dataset";
import {
  type AppSettings,
  type EffectiveDataset,
  type ExcludedReceipt,
  EXCLUSION_SCOPE_LABEL,
  applySettings,
  getDefaultSettings,
  getSettings,
  resetSettings,
  setSettings,
  subscribeSettings,
} from "../lib/settings";

type ViewId = "overview" | "ledger" | "matching" | "exceptions" | "bookings" | "statements" | "upload" | "rules" | "settings";

const reasonTone: Record<string, Tone> = {
  MISSING_BOOKING: "red",
  DATE_RULE_UNMET: "amber",
  AMOUNT_MISMATCH: "red",
  UNMATCHED_BANK_CREDIT: "blue",
  REFUND_LINE: "slate",
};

const matchTypeTone: Record<string, Tone> = { "1:1": "green", "N:1": "blue", "1:N": "blue" };

const matchTypeMeaning: Record<string, string> = {
  "1:1": "รายการรับเงินหนึ่งรายการ ตรงกับเงินเข้าธนาคารหนึ่งรายการ",
  "N:1": "รายการรับเงินหลายรายการในวันเดียวกัน รวมแล้วเท่ากับเงินเข้าธนาคารหนึ่งรายการ",
  "1:N": "รายการรับเงินหนึ่งรายการ เท่ากับผลรวมของเงินเข้าธนาคารหลายรายการในวันเดียวกัน",
};

const requiredDocuments = [
  { kind: "ledger", label: "บัญชีแยกประเภท", detail: "ไฟล์ .xlsx ที่มีคอลัมน์ Reservation Creation Time", pattern: "*บัญชีแยกประเภท*.xlsx" },
  { kind: "collection", label: "รายงานการรับเงิน", detail: "ไฟล์ .xlsx ที่มีคอลัมน์ Date, Payment Method, Amount", pattern: "*รายงานการรับเงิน*.xlsx" },
  { kind: "statement885", label: "Statement บัญชี 885", detail: "PDF จาก K BIZ ของช่องทาง KbankGL885", pattern: "885*.pdf" },
  { kind: "statement987", label: "Statement บัญชี 987", detail: "PDF จาก K BIZ ของช่องทาง KbankGL987", pattern: "987*.pdf" },
];

const sourceKindToDocument: Record<string, string> = {
  ledger: "ledger",
  collection_report: "collection",
  bank_statement_885: "statement885",
  bank_statement_987: "statement987",
};

// ── shared context ────────────────────────────────────────────────────────────

type WorkspaceValue = {
  /** ชุดข้อมูลหลังใช้การตั้งค่าแล้ว — ทุกหน้าจออ่านจากตัวนี้ */
  dataset: Dataset;
  effective: EffectiveDataset;
  settings: AppSettings;
  hasData: boolean;
  go: (view: ViewId) => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);
const useWorkspace = () => useContext(WorkspaceContext) as WorkspaceValue;

// ── primitives ────────────────────────────────────────────────────────────────

function RuleBanner() {
  return (
    <div className="rule-banner">
      <span className="rule-banner-mark">=</span>
      <div>
        <b>เงื่อนไขการจับคู่มีสองข้อ และต้องเป็นจริงพร้อมกันทั้งคู่</b>
        <p>
          <em>1.</em> วันที่สร้างคำจองในบัญชีแยกประเภท ต้องเป็น<strong>วันเดียวกัน</strong>กับวันที่เงินเข้าใน Statement
          <span>·</span>
          <em>2.</em> ยอดเงินต้อง<strong>ตรงกันพอดี</strong> ผลต่างเป็น ฿0.00
        </p>
      </div>
      <Pill tone="green">tolerance ฿0.00 · date window 0 วัน</Pill>
    </div>
  );
}

// ── shell ─────────────────────────────────────────────────────────────────────

export default function Workspace({ dataset: rawDataset, source, databaseConfigured, loadError }: {
  dataset: Dataset;
  source: string;
  databaseConfigured: boolean;
  loadError?: string;
}) {
  const [active, setActive] = useState<ViewId>("overview");

  // ค่าที่ผู้ใช้ตั้งไว้อยู่ใน localStorage ซึ่งเป็นแหล่งข้อมูลนอก React
  // ฝั่งเซิร์ฟเวอร์และตอน hydrate ใช้ค่าตั้งต้น จึงไม่มี hydration mismatch
  const settings: AppSettings = useSyncExternalStore(subscribeSettings, getSettings, getDefaultSettings);

  // การตั้งค่าไม่แก้เอกสารต้นทาง แต่คัดรายการออกแล้วกระทบยอดใหม่ทั้งรอบ
  const effective = useMemo(() => applySettings(rawDataset, settings), [rawDataset, settings]);
  const dataset = effective.dataset;

  const { meta, statements, reconciliation } = dataset;
  const { groups, exceptions, summary } = reconciliation;
  const hasData = meta.sources.length > 0;

  const navGroups: { label: string; items: { id: ViewId; label: string; icon: string; badge?: string }[] }[] = [
    { label: "การกระทบยอด", items: [
      { id: "overview", label: "ภาพรวม", icon: "⌂" },
      { id: "ledger", label: "ตารางรับเงิน", icon: "▤", badge: hasData ? String(dataset.receipts.length) : undefined },
      { id: "matching", label: "รายละเอียดการจับคู่", icon: "↔", badge: hasData ? String(groups.length) : undefined },
      { id: "exceptions", label: "ข้อยกเว้น", icon: "!", badge: hasData ? String(exceptions.length) : undefined },
    ] },
    { label: "ข้อมูลต้นทาง", items: [
      { id: "bookings", label: "รายการจอง", icon: "#", badge: hasData ? String(dataset.bookings.length) : undefined },
      { id: "statements", label: "รายการเดินบัญชี", icon: "▦" },
    ] },
    { label: "ระบบ", items: [
      { id: "upload", label: "นำเข้าเอกสาร", icon: "↑" },
      { id: "rules", label: "กฎการจับคู่", icon: "≡" },
      { id: "settings", label: "การตั้งค่า", icon: "⚙", badge: effective.excluded.length ? String(effective.excluded.length) : undefined },
    ] },
  ];

  const viewIds = navGroups.flatMap((group) => group.items.map((item) => item.id));

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      if ((viewIds as string[]).includes(hash)) setActive(hash as ViewId);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (view: ViewId) => {
    setActive(view);
    if (window.location.hash.slice(1) !== view) window.history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const orgName = statements[0]?.accountName?.trim() || "ยังไม่ได้ระบุกิจการ";
  const periodLabel = meta.period ? thaiMonthLabel(meta.period) : "ยังไม่มีรอบบัญชี";
  const storageLabel = databaseConfigured ? "NEON POSTGRES" : "BUILD-TIME DATA/";

  return (
    <WorkspaceContext.Provider value={{ dataset, effective, settings, hasData, go }}>
      <div className="app-shell">
        <aside className="sidebar">
          <button className="brand" onClick={() => go("overview")}>
            <span className="brand-mark"><i /><i /><i /></span>
            <span><b>ClearClose</b><small>ACCOUNT RECONCILIATION</small></span>
          </button>
          <div className="org-switcher static">
            <span>{hasData ? orgName.replace(/^บจก\.\s*|^บริษัท\s*/, "").slice(0, 2) : "—"}</span>
            <span><b>{orgName}</b><small>{periodLabel}</small></span>
          </div>
          <nav aria-label="เมนูหลัก">
            {navGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                {group.items.map((item) => (
                  <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => go(item.id)}>
                    <span className="nav-icon">{item.icon}</span><b>{item.label}</b>{item.badge && <em>{item.badge}</em>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-status">
            <p>
              <span className={hasData && summary.controlBalanced && !loadError ? "" : "warn"} />
              {loadError ? "ต่อฐานข้อมูลไม่สำเร็จ" : !hasData ? "ยังไม่มีเอกสารต้นทาง" : summary.controlBalanced ? "Control total ตรงทุกบัญชี" : "Control total ไม่ตรง"}
            </p>
            <small className="sidebar-note">{databaseConfigured ? "Neon Postgres" : "data/ ตอน build"} · {meta.sources.length} เอกสาร</small>
          </div>
        </aside>

        <main>
          <header className="topbar">
            <div className="topbar-brand"><span className="brand-mark"><i /><i /><i /></span><b>ClearClose</b></div>
            <div className="period"><small>รอบบัญชี</small><b>{periodLabel}</b></div>
            <div className="top-actions">
              <span className="live-state"><i /> {storageLabel}</span>
              <span className="ruleset-chip">ruleset v{reconciliation.rulesetVersion}</span>
              <button className="primary-button" onClick={() => go("upload")}>＋ นำเข้าเอกสาร</button>
            </div>
          </header>

          <div className="content">
            {loadError && <div className="load-error"><span>!</span><p><b>อ่านข้อมูลจากฐานข้อมูลไม่สำเร็จ</b><small className="mono">{loadError}</small></p></div>}
            {active === "upload" && <Upload databaseConfigured={databaseConfigured} />}
            {active === "rules" && <Rules />}
            {active === "settings" && (
              <SettingsView
                rawDataset={rawDataset}
                effective={effective}
                settings={settings}
                onChange={setSettings}
                onReset={resetSettings}
                source={source}
                databaseConfigured={databaseConfigured}
              />
            )}
            {!hasData && active !== "upload" && active !== "rules" && active !== "settings" && <NoSourceDocuments />}
            {hasData && active === "overview" && <Overview />}
            {hasData && active === "ledger" && <Ledger />}
            {hasData && active === "matching" && <Matching />}
            {hasData && active === "exceptions" && <Exceptions />}
            {hasData && active === "bookings" && <Bookings />}
            {hasData && active === "statements" && <Statements />}
            <footer>
              <span>ClearClose · ruleset v{reconciliation.rulesetVersion}</span>
              <p>Asia/Bangkok · {source === "database" ? "ข้อมูลจากฐานข้อมูล" : "ข้อมูลจาก data/ ตอน build"} · {meta.generatedAt ? thaiDateTime(meta.generatedAt) : "—"}</p>
              <span className="mono">{meta.sources.map((item) => item.name).join(" · ")}</span>
            </footer>
          </div>
        </main>
      </div>
    </WorkspaceContext.Provider>
  );
}

// ── empty state ───────────────────────────────────────────────────────────────

function NoSourceDocuments() {
  const { go } = useWorkspace();
  return (
    <>
      <PageHeading eyebrow="ยังไม่มีข้อมูล" title="ระบบพร้อมใช้งาน แต่ยังไม่มีเอกสาร" description="นำเข้าเอกสารทั้งสี่ฉบับเพื่อเริ่มกระทบยอด" action={<Pill tone="amber">ยังไม่มีเอกสาร</Pill>} />
      <section className="panel empty-workspace">
        <span className="empty-workspace-mark">↑</span>
        <h2>ยังไม่มีเอกสารต้นทางในระบบ</h2>
        <p>ทุกหน้าที่แสดงตัวเลขต้องใช้เอกสารสี่ฉบับนี้ครบก่อน จึงจะกระทบยอดได้</p>
        <div className="required-files">
          {requiredDocuments.map((file) => (
            <article key={file.kind}>
              <span className="check-icon missing">+</span>
              <p><b>{file.label}</b><small>{file.detail}</small></p>
              <code>{file.pattern}</code>
            </article>
          ))}
        </div>
        <button className="primary-button" onClick={() => go("upload")}>ไปหน้านำเข้าเอกสาร →</button>
      </section>
    </>
  );
}

// ── overview ──────────────────────────────────────────────────────────────────

/** บอกให้เห็นตั้งแต่หน้าแรกว่าตัวเลขที่กำลังอ่านอยู่ถูกกรองอะไรออกไปบ้าง */
function ExclusionBanner() {
  const { effective, go } = useWorkspace();
  if (!effective.excluded.length) return null;

  return (
    <div className="exclusion-banner">
      <span className="exclusion-banner-mark">⊘</span>
      <div>
        <b>ตัวเลขทุกหน้าไม่รวมรายการที่ถูกตัดออกตามการตั้งค่า</b>
        <p>
          ตัดออก <strong>{effective.excluded.length}</strong> รายการ รวม <strong>{baht(effective.excludedSatang)}</strong>
          <span>·</span>
          {effective.buckets.map((bucket) => `${EXCLUSION_SCOPE_LABEL[bucket.scope]} ${bucket.value}`).join(" · ")}
        </p>
      </div>
      <button className="text-button" onClick={() => go("settings")}>แก้ไขการตั้งค่า →</button>
    </div>
  );
}

function Overview() {
  const { dataset, go } = useWorkspace();
  const { receipts, reconciliation } = dataset;
  const { accounts, groups, exceptions, outOfScope, summary } = reconciliation;

  const receiptTotal = receipts.reduce((sum, receipt) => sum + receipt.amountSatang, 0);
  const inScopeSatang = accounts.reduce((sum, account) => sum + account.receiptSatang, 0);
  const outOfScopeSatang = outOfScope.reduce((sum, item) => sum + item.amountSatang, 0);

  const reasons = Object.entries(exceptions.reduce<Record<string, { count: number; label: string; delta: number }>>((acc, item) => {
    const bucket = acc[item.reason] ?? { count: 0, label: item.label, delta: 0 };
    bucket.count += 1;
    bucket.delta += Math.abs(item.deltaSatang);
    acc[item.reason] = bucket;
    return acc;
  }, {})).sort((a, b) => b[1].count - a[1].count);

  const byType = (["1:1", "N:1", "1:N"] as const).map((type) => ({ type, count: groups.filter((group) => group.type === type).length }));

  return (
    <>
      <PageHeading
        eyebrow={`รอบบัญชี ${thaiMonthLabel(dataset.meta.period)}`}
        title="ภาพรวมการกระทบยอด"
        description="ทุกตัวเลขมาจากเอกสารต้นทางจริง ไม่มีข้อมูลตัวอย่างในระบบ"
        action={
          <div className="readiness">
            <span className="readiness-ring" style={{ "--ring": `${summary.matchRate}%` } as React.CSSProperties}><b>{Math.round(summary.matchRate)}</b><small>%</small></span>
            <span>
              <small>อัตราการจับคู่ในขอบเขต</small>
              <b>{summary.matchedReceipts} จาก {summary.inScopeReceipts} รายการรับเงิน</b>
              <p>เหลือ {summary.exceptionCount} รายการที่ต้องตรวจ</p>
            </span>
          </div>
        }
      />
      <RuleBanner />
      <ExclusionBanner />

      <section className="metrics-grid">
        <Metric label="ยอดรับเงินทั้งรอบ" value={baht(receiptTotal)} detail={`${receipts.length} รายการจากรายงานการรับเงิน`} tone="blue" />
        <Metric label="อยู่ในขอบเขตกระทบยอด" value={baht(inScopeSatang)} detail={`${summary.inScopeReceipts} รายการ · ช่องทาง KbankGL885 และ KbankGL987`} tone="green" />
        <Metric label="จับคู่สำเร็จ" value={`${summary.matchRate}%`} detail={byType.map((item) => `${item.type} ${item.count}`).join(" · ")} tone={summary.matchRate >= 85 ? "green" : "amber"} badge={`${groups.length} กลุ่ม`} />
        <Metric label="ต้องตรวจสอบ" value={`${summary.exceptionCount} รายการ`} detail={`ฝั่งรับเงิน ${baht(summary.unexplainedReceiptSatang)} · ฝั่งธนาคาร ${baht(summary.unexplainedBankSatang)}`} tone="red" />
      </section>

      <section className="statement-grid">
        {accounts.map((account) => <AccountCard key={account.code} account={account} onOpen={() => go("matching")} />)}
      </section>

      <section className="two-column">
        <div className="panel">
          <PanelTitle kicker="Exception breakdown" title="สาเหตุที่จับคู่ไม่ได้" action={<button className="text-button" onClick={() => go("exceptions")}>เปิดคิวตรวจสอบ →</button>} />
          <div className="reason-list">
            {reasons.map(([reason, value]) => (
              <div key={reason}>
                <span className={`reason-dot ${reasonTone[reason] ?? "slate"}`} />
                <p><b>{value.label}</b><small className="mono">{reason}</small></p>
                <span className="reason-figures"><b>{value.count}</b><small>{baht(value.delta)}</small></span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <PanelTitle kicker="Coverage" title="ช่องทางที่ยังไม่มี Statement" />
          <div className="coverage-note"><span>i</span><p><b>ช่องทางเหล่านี้อยู่นอกขอบเขต</b><small>ระบบมี Statement เฉพาะบัญชี 885 และ 987 จึงไม่นับช่องทางอื่นเป็นทั้งจับคู่สำเร็จและข้อยกเว้น</small></p></div>
          <div className="coverage-list">
            {outOfScope.map((item) => (
              <div key={item.method}>
                <b>{item.method}</b>
                <span className="coverage-bar"><i style={{ width: `${Math.round((item.amountSatang / (outOfScope[0]?.amountSatang || 1)) * 100)}%` }} /></span>
                <span className="coverage-figures"><b>{baht(item.amountSatang)}</b><small>{item.count} รายการ</small></span>
              </div>
            ))}
          </div>
          <div className="coverage-total">
            <span><small>รวมนอกขอบเขต</small><b>{baht(outOfScopeSatang)}</b></span>
            <span><small>คิดเป็น</small><b>{receiptTotal ? Math.round((outOfScopeSatang / receiptTotal) * 100) : 0}% ของยอดรับทั้งรอบ</b></span>
          </div>
        </div>
      </section>
    </>
  );
}

function AccountCard({ account, onOpen }: { account: AccountResult; onOpen: () => void }) {
  return (
    <article className="statement-card">
      <div className="statement-head">
        <span><small>KASIKORNBANK · {account.branch}</small><h2>บัญชี •••{account.code}</h2><small className="mono">{account.method}</small></span>
        <Pill tone={account.controlDeltaSatang === 0 ? "green" : "red"}>Control {account.controlDeltaSatang === 0 ? "ผ่าน · ฿0.00" : baht(account.controlDeltaSatang)}</Pill>
      </div>
      <div className="statement-values">
        <span><small>ยอดยกมา</small><b>{baht(account.openingSatang)}</b></span>
        <span><small>ยอดฝาก ({account.creditCount})</small><b>{baht(account.creditSatang)}</b></span>
        <span><small>ยอดถอน ({account.debitCount})</small><b>{baht(account.debitSatang)}</b></span>
        <span><small>ยอดยกไป</small><b>{baht(account.closingSatang)}</b></span>
      </div>
      <div className="statement-foot">
        <span><b>{account.matchedReceipts}/{account.receiptCount}</b><small>รายการรับเงินที่จับคู่ได้</small></span>
        <div className="bar"><i className={account.matchRate >= 85 ? "green" : account.matchRate >= 50 ? "amber" : "red"} style={{ width: `${Math.max(account.matchRate, 2)}%` }} /></div>
        <button onClick={onOpen}>เปิดรายการจับคู่ →</button>
      </div>
    </article>
  );
}

// ── ledger (the spreadsheet view) ─────────────────────────────────────────────

type LedgerRow = {
  receipt: Receipt;
  booking?: Booking;
  status: "matched" | "exception" | "outofscope" | "excluded";
  group?: MatchGroup;
  exception?: ReconciliationException;
  excludedBy?: ExcludedReceipt["excludedBy"];
  firstOfBooking: boolean;
  rowsInBooking: number;
};

function Ledger() {
  const { dataset, effective, settings, go } = useWorkspace();
  const { bookings, receipts, reconciliation } = dataset;
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const showExcluded = settings.display.showExcludedRows && effective.excluded.length > 0;

  const rows = useMemo<LedgerRow[]>(() => {
    const bookingIndex = new Map(bookings.map((booking) => [booking.reservationNo, booking]));
    const groupByReceipt = new Map<string, MatchGroup>();
    for (const group of reconciliation.groups) for (const item of group.receipts) groupByReceipt.set(item.id, group);
    const exceptionByReceipt = new Map<string, ReconciliationException>();
    for (const exception of reconciliation.exceptions) if (exception.receiptId) exceptionByReceipt.set(exception.receiptId, exception);
    const excludedById = new Map(effective.excluded.map((item) => [item.id, item.excludedBy]));

    // Sort so every payment of a booking sits together, newest booking first —
    // the order an accountant reads a ledger in.
    const source = showExcluded ? [...receipts, ...effective.excluded] : receipts;
    const sorted = [...source].sort((a, b) => {
      const left = bookingIndex.get(a.reservationNo)?.createdAt ?? a.date;
      const right = bookingIndex.get(b.reservationNo)?.createdAt ?? b.date;
      return right.localeCompare(left) || a.reservationNo.localeCompare(b.reservationNo) || a.date.localeCompare(b.date);
    });

    const counts = new Map<string, number>();
    for (const receipt of sorted) counts.set(receipt.reservationNo, (counts.get(receipt.reservationNo) ?? 0) + 1);

    return sorted.map((receipt, index) => {
      const excludedBy = excludedById.get(receipt.id);
      const group = excludedBy ? undefined : groupByReceipt.get(receipt.id);
      const exception = excludedBy ? undefined : exceptionByReceipt.get(receipt.id);
      const firstOfBooking = index === 0 || sorted[index - 1].reservationNo !== receipt.reservationNo;
      return {
        receipt,
        booking: bookingIndex.get(receipt.reservationNo),
        status: excludedBy ? "excluded" : group ? "matched" : exception ? "exception" : "outofscope",
        group,
        exception,
        excludedBy,
        firstOfBooking,
        rowsInBooking: counts.get(receipt.reservationNo) ?? 1,
      };
    });
  }, [bookings, receipts, reconciliation, effective.excluded, showExcluded]);

  const channels = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.receipt.channel || "ไม่ระบุ", (totals.get(row.receipt.channel || "ไม่ระบุ") ?? 0) + 1);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visible = rows.filter((row) => {
    if (channelFilter !== "all" && (row.receipt.channel || "ไม่ระบุ") !== channelFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (!query.trim()) return true;
    const haystack = `${row.receipt.reservationNo} ${row.receipt.guest} ${row.receipt.roomType} ${row.receipt.roomNumber} ${row.receipt.group} ${row.receipt.method}`;
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
  });

  // แถวที่ถูกตัดออกแสดงเพื่อการตรวจสอบเท่านั้น จึงไม่ถูกนับรวมในยอดใด ๆ
  const totals = visible.reduce((acc, row) => ({
    receipt: acc.receipt + (row.status === "excluded" ? 0 : row.receipt.amountSatang),
    matched: acc.matched + (row.status === "matched" ? row.receipt.amountSatang : 0),
    unmatched: acc.unmatched + (row.status === "exception" ? row.receipt.amountSatang : 0),
    excluded: acc.excluded + (row.status === "excluded" ? row.receipt.amountSatang : 0),
  }), { receipt: 0, matched: 0, unmatched: 0, excluded: 0 });

  const exportCsv = () => {
    // Same columns as the screen, in the same order, grouped by source document.
    const header = [
      "Reservation Creation Time", "PMS Reservation No.", "Contact", "Mobile", "Channel", "Room Type", "Total Amount", "Payment", "Payment Method", "ยอดคงค้าง",
      "Date", "Check-in Date", "Check-out Date", "Amount", "ช่องทางรับเงิน",
      "Statement Date", "Statement Time", "Statement Amount",
      "สถานะกระทบยอด", "อ้างอิง",
    ];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const money = (satang: number) => (satang / 100).toFixed(2);
    const lines = visible.map((row) => {
      const line = row.group?.lines[0];
      return [
        row.booking?.createdAt.replace("T", " ") ?? "", row.receipt.reservationNo,
        row.booking?.guest || row.receipt.guest, row.booking?.mobile ?? "", row.receipt.channel,
        row.booking?.roomType || row.receipt.roomType, money(row.booking?.totalSatang ?? 0),
        money(row.booking?.paidSatang ?? 0), row.booking?.payments.map((payment) => payment.method).join(" / ") ?? "",
        money(row.booking?.balanceDueSatang ?? 0),
        row.receipt.date, row.receipt.checkIn, row.receipt.checkOut, money(row.receipt.amountSatang), row.receipt.method,
        line?.date ?? "", line?.time ?? "", line ? money(line.amountSatang) : "",
        row.status === "matched" ? "ตรง" : row.status === "exception" ? "ไม่ตรง" : row.status === "excluded" ? "ถูกตัดออกตามการตั้งค่า" : "นอกขอบเขต",
        row.group?.id ?? row.exception?.id ?? (row.excludedBy ? `${EXCLUSION_SCOPE_LABEL[row.excludedBy.scope]}: ${row.excludedBy.value}` : ""),
      ].map(escape).join(",");
    });

    // BOM so Excel opens Thai text in UTF-8 rather than mangling it.
    const blob = new Blob([`﻿${[header.map(escape).join(","), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clearclose-${dataset.meta.period || "export"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeading
        eyebrow="Receipts ledger"
        title="ตารางรับเงิน"
        description="ทุกรายการรับเงินเรียงตามคำจอง ยอดที่กระทบตรงจะขึ้นกรอบเขียว ยอดที่ไม่ตรงขึ้นกรอบแดง"
        action={
          <div className="heading-stats">
            <span><b>{visible.length}</b><small>รายการที่แสดง</small></span>
            <span><b>{baht(totals.receipt)}</b><small>ยอดรับเงินรวม</small></span>
          </div>
        }
      />

      <section className="panel data-panel">
        <div className="statement-toolbar">
          <div className="tabs wrap">
            {[["all", "ทุกสถานะ"], ["matched", "กระทบตรง"], ["exception", "ไม่ตรง"], ["outofscope", "นอกขอบเขต"], ...(showExcluded ? [["excluded", "ถูกตัดออก"]] : [])].map(([value, label]) => (
              <button key={value} className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>
                {label} <span>{value === "all" ? rows.length : rows.filter((row) => row.status === value).length}</span>
              </button>
            ))}
          </div>
          <div className="tabs wrap">
            <button className={channelFilter === "all" ? "active" : ""} onClick={() => setChannelFilter("all")}>ทุกช่องทาง</button>
            {channels.map(([channel, count]) => (
              <button key={channel} className={channelFilter === channel ? "active" : ""} onClick={() => setChannelFilter(channel)}>{channel} <span>{count}</span></button>
            ))}
          </div>
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขที่จอง ชื่อผู้จอง หรือรหัสบ้าน" /></label>
        </div>

        <div className="ledger-legend">
          <span><i className="ring-green" /> กระทบยอดตรง — วันเดียวกันและยอดตรงพอดี</span>
          <span><i className="ring-red" /> ไม่ตรง — ดูเหตุผลได้ที่หน้าข้อยกเว้น</span>
          <span><i className="ring-grey" /> นอกขอบเขต — ช่องทางที่ยังไม่มี Statement</span>
          {showExcluded && <span><i className="ring-grey" /> ถูกตัดออก — ไม่ถูกนับในยอดใด ๆ</span>}
          <button className="secondary-button" onClick={exportCsv}>⇩ ส่งออก CSV</button>
        </div>

        {effective.excluded.length > 0 && !showExcluded && (
          <p className="table-note ledger-exclusion-note">
            ตารางนี้ไม่รวม {effective.excluded.length} รายการที่ถูกตัดออกตามการตั้งค่า ({baht(effective.excludedSatang)})
            <button className="text-button" onClick={() => go("settings")}>ดูหรือแก้ไขการตั้งค่า →</button>
          </p>
        )}

        <div className="responsive-table scroll-table">
          <table className="ledger-table">
            {/* Two header rows: which document a column comes from, then the
                field name as that document spells it. */}
            <thead>
              <tr className="source-header">
                <th colSpan={8} className="src-ledger">บันทึกบัญชีแยกประเภท</th>
                <th colSpan={4} className="src-collection">รายงานการรับเงิน</th>
                <th colSpan={1} className="src-statement">สเตจเม้น</th>
                <th colSpan={1} className="src-result">ผลกระทบยอด</th>
              </tr>
              <tr className="field-header">
                <th>Reservation<br />Creation Time</th>
                <th>PMS<br />Reservation No.</th>
                <th>Contact</th>
                <th>Channel</th>
                <th>Room Type</th>
                <th className="num">Total Amount</th>
                <th className="num">Payment</th>
                <th className="num">ยอดคงค้าง</th>
                <th>Date</th>
                <th>Check-in<br />Date</th>
                <th>Check-out<br />Date</th>
                <th className="num">Amount</th>
                <th>วันที่ / เวลา</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, settings.display.ledgerRowLimit).map((row) => {
                const line = row.group?.lines[0];
                // Booking columns print once per booking, like a merged cell.
                const own = row.firstOfBooking;
                return (
                  <tr key={row.receipt.id} className={`${own ? "group-start" : "group-cont"} ${row.status}`}>
                    <td className="col-ledger">{own && (row.booking
                      ? <><b>{thaiDate(row.booking.createdDate)}</b><small className="block">{row.booking.createdAt.slice(11, 16)} น.</small></>
                      : <span className="missing-cell">ไม่พบคำจอง</span>)}</td>
                    <td className="col-ledger mono">{own && row.receipt.reservationNo}</td>
                    <td className="col-ledger">{own && <><b>{row.booking?.guest || row.receipt.guest || "—"}</b>{row.booking?.mobile && <small className="block">{row.booking.mobile}</small>}</>}</td>
                    <td className="col-ledger">{own && <span className={`channel-chip ${channelClass(row.receipt.channel)}`}>{row.receipt.channel || "ไม่ระบุ"}</span>}</td>
                    <td className="col-ledger">{own && <><b>{row.booking?.roomType || row.receipt.roomType || "—"}</b><small className="block">{row.receipt.group}</small></>}</td>
                    <td className="col-ledger num">{own && <strong>{baht(row.booking?.totalSatang ?? 0)}</strong>}</td>
                    <td className="col-ledger num">{own && <>{baht(row.booking?.paidSatang ?? 0)}{row.booking?.payments.length ? <small className="block">{row.booking.payments.map((payment) => payment.method).join(" · ")}</small> : null}</>}</td>
                    <td className="col-ledger num">{own && <span className={row.booking?.balanceDueSatang ? "due" : ""}>{baht(row.booking?.balanceDueSatang ?? 0)}</span>}</td>

                    <td className="col-collection">{thaiDate(row.receipt.date)}<small className="block">{row.receipt.method}</small></td>
                    <td className="col-collection">{thaiDate(row.receipt.checkIn)}</td>
                    <td className="col-collection">{thaiDate(row.receipt.checkOut)}</td>
                    <td className="col-collection num"><span className={`amount-ring ${row.status}`}>{baht(row.receipt.amountSatang)}</span></td>

                    <td className="col-statement">{line
                      ? <><b>{thaiDate(line.date)}</b><small className="block">{line.time} น. · {baht(line.amountSatang)}</small>{row.group && row.group.lines.length > 1 && <small className="block">+ อีก {row.group.lines.length - 1} รายการ</small>}</>
                      : <span className="missing-cell">{row.status === "exception" ? "ไม่มีที่ตรง" : "—"}</span>}</td>

                    <td className="col-result">
                      {row.status === "matched" && <><Pill tone="green">{row.group?.type}</Pill><small className="block mono">{row.group?.id}</small></>}
                      {row.status === "exception" && <><Pill tone="red">ไม่ตรง</Pill><small className="block mono">{row.exception?.reason}</small></>}
                      {row.status === "outofscope" && <Pill>นอกขอบเขต</Pill>}
                      {row.status === "excluded" && row.excludedBy && <><Pill>ถูกตัดออก</Pill><small className="block">{EXCLUSION_SCOPE_LABEL[row.excludedBy.scope]} · {row.excludedBy.value}</small></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={11}>รวม {visible.length.toLocaleString("en-US")} รายการที่แสดง</td>
                <td className="num"><strong>{baht(totals.receipt)}</strong></td>
                <td colSpan={2}>
                  <span className="foot-split"><i className="ring-green" />ตรง {baht(totals.matched)}</span>
                  <span className="foot-split"><i className="ring-red" />ไม่ตรง {baht(totals.unmatched)}</span>
                  {totals.excluded > 0 && <span className="foot-split"><i className="ring-grey" />ตัดออก {baht(totals.excluded)}</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {visible.length > settings.display.ledgerRowLimit && <p className="table-note">แสดง {settings.display.ledgerRowLimit.toLocaleString("en-US")} จาก {visible.length.toLocaleString("en-US")} รายการ · เพิ่มจำนวนแถวได้ที่หน้าการตั้งค่า หรือส่งออก CSV เพื่อดูทั้งหมด</p>}
        {!visible.length && <div className="empty-state"><span>⌕</span><h3>ไม่พบรายการที่ตรงกับตัวกรอง</h3><p>ลองล้างคำค้นหาหรือเลือกทุกช่องทาง</p></div>}
      </section>
    </>
  );
}

function channelClass(channel: string) {
  const key = channel.toLowerCase();
  if (key.includes("line")) return "line";
  if (key.includes("trip")) return "trip";
  if (key.includes("booking.com")) return "booking";
  if (key.includes("airbnb")) return "airbnb";
  if (key.includes("agent")) return "agent";
  if (key.includes("facebook")) return "facebook";
  return "other";
}

// ── matching ──────────────────────────────────────────────────────────────────

function Matching() {
  const { dataset } = useWorkspace();
  const { accounts, groups, summary } = dataset.reconciliation;
  const [accountFilter, setAccountFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(groups[0]?.id ?? "");

  const visible = groups.filter((group) => {
    if (accountFilter !== "all" && group.account !== accountFilter) return false;
    if (typeFilter !== "all" && group.type !== typeFilter) return false;
    if (!query.trim()) return true;
    const haystack = `${group.id} ${group.date} ${group.receipts.map((r) => `${r.reservationNo} ${r.guest} ${r.roomType}`).join(" ")} ${group.lines.map((l) => `${l.id} ${l.detail}`).join(" ")}`;
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
  });

  const selected = groups.find((group) => group.id === selectedId) ?? visible[0] ?? null;

  return (
    <>
      <PageHeading
        eyebrow={`Ruleset v${dataset.reconciliation.rulesetVersion}`}
        title="รายละเอียดการจับคู่"
        description="ยอดไหนตรงกับยอดไหน มาจากเอกสารบรรทัดใด และผ่านกฎข้อไหนบ้าง"
        action={<div className="heading-stats"><span><b>{groups.length}</b><small>กลุ่มที่จับคู่ได้</small></span><span><b>{baht(summary.matchedSatang)}</b><small>ยอดที่ยืนยันแล้ว</small></span></div>}
      />
      <RuleBanner />

      <section className="panel data-panel">
        <div className="statement-toolbar">
          <div className="tabs">
            {[["all", "ทุกบัญชี"], ...accounts.map((account) => [account.code, `•••${account.code}`])].map(([value, label]) => (
              <button key={value} className={accountFilter === value ? "active" : ""} onClick={() => setAccountFilter(value)}>{label}</button>
            ))}
          </div>
          <div className="tabs compact">
            {[["all", "ทั้งหมด"], ["1:1", "1:1"], ["N:1", "N:1"], ["1:N", "1:N"]].map(([value, label]) => (
              <button key={value} className={typeFilter === value ? "active" : ""} onClick={() => setTypeFilter(value)}>{label}</button>
            ))}
          </div>
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขที่จอง ชื่อผู้จอง ห้อง หรือรหัสกลุ่ม" /></label>
        </div>

        {selected && <MatchEvidence group={selected} />}

        <div className="responsive-table scroll-table">
          <table className="statement-match-table">
            <thead>
              <tr><th>วันที่สร้างคำจอง</th><th>รายการรับเงิน</th><th>ยอดรับเงิน</th><th>เงินเข้า Statement</th><th>ยอด Statement</th><th>รูปแบบ</th><th>ผลต่าง</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((group) => (
                <tr key={group.id} className={selected?.id === group.id ? "selected" : ""} onClick={() => setSelectedId(group.id)}>
                  <td><b>{thaiDate(group.date)}</b><small className="block mono">{group.id}</small></td>
                  <td>
                    <div className="booking-preview">
                      <b>{group.receipts.length} รายการ</b>
                      {group.receipts.slice(0, 2).map((receipt) => <small key={receipt.id}><span className="mono">{receipt.reservationNo}</span> · {receipt.guest || "—"}</small>)}
                      {group.receipts.length > 2 && <small>+ อีก {group.receipts.length - 2} รายการ</small>}
                    </div>
                  </td>
                  <td><strong>{baht(group.receiptSatang)}</strong></td>
                  <td>
                    <div className="booking-preview">
                      <b>{group.lines.length} รายการ · •••{group.account}</b>
                      {group.lines.map((line) => <small key={line.id}>{line.time} · {baht(line.amountSatang)}</small>)}
                    </div>
                  </td>
                  <td><strong>{baht(group.bankSatang)}</strong></td>
                  <td><Pill tone={matchTypeTone[group.type]}>{group.type}</Pill><small className="block">score {group.score}</small></td>
                  <td className={group.deltaSatang === 0 ? "zero-delta" : "negative"}>{baht(group.deltaSatang)}</td>
                  <td><button className="row-button" aria-label={`เปิดหลักฐาน ${group.id}`}>›</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && <div className="empty-state"><span>⌕</span><h3>ไม่พบกลุ่มที่ตรงกับตัวกรอง</h3><p>ลองเลือกทุกบัญชีหรือล้างคำค้นหา</p></div>}
      </section>
    </>
  );
}

function MatchEvidence({ group }: { group: MatchGroup }) {
  const { dataset } = useWorkspace();
  const ledgerSource = dataset.meta.sources.find((item) => item.kind === "ledger")?.name ?? "—";
  const collectionSource = dataset.meta.sources.find((item) => item.kind === "collection_report")?.name ?? "—";
  const reservations = [...new Set(group.receipts.map((receipt) => receipt.reservationNo))];

  return (
    <div className="evidence">
      <header className="evidence-top">
        <div>
          <small>หลักฐานการจับคู่ · ตรวจสอบย้อนกลับได้ทุกบรรทัด</small>
          <h3 className="mono">{group.id}</h3>
          <p>{matchTypeMeaning[group.type]}</p>
        </div>
        <div className="evidence-top-figures">
          <span><small>รูปแบบ</small><Pill tone={matchTypeTone[group.type]}>{group.type}</Pill></span>
          <span><small>คะแนน</small><b>{group.score}</b></span>
          <span><small>บัญชี</small><b>•••{group.account}</b></span>
        </div>
      </header>

      {/* 1. the two rules, with the values that were actually compared */}
      <div className="rule-checks">
        {group.rulesPassed.map((rule) => (
          <div key={rule.id} className={rule.passed ? "pass" : "fail"}>
            <span className="rule-check-mark">{rule.passed ? "✓" : "✕"}</span>
            <div>
              <small>{rule.id}</small>
              <b>{rule.label}</b>
              <p>
                {rule.id === "R01"
                  ? <>{thaiDate(String(rule.left))} <i>=</i> {thaiDate(String(rule.right))}</>
                  : <>{baht(Number(rule.left))} <i>=</i> {baht(Number(rule.right))} <em>ผลต่าง {baht(Number(rule.left) - Number(rule.right))}</em></>}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* 2. the arithmetic, spelled out */}
      <div className="equation-block">
        <span className="equation-side">
          {group.receipts.map((receipt, index) => (
            <span key={receipt.id}>{index > 0 && <i>＋</i>}<b>{baht(receipt.amountSatang)}</b></span>
          ))}
          <small>รายการรับเงิน {group.receipts.length} รายการ</small>
        </span>
        <span className="equation-equals">=</span>
        <span className="equation-side bank">
          {group.lines.map((line, index) => (
            <span key={line.id}>{index > 0 && <i>＋</i>}<b>{baht(line.amountSatang)}</b></span>
          ))}
          <small>เงินเข้าธนาคาร {group.lines.length} รายการ</small>
        </span>
      </div>

      {/* 3. receipt side, line by line */}
      <div className="evidence-section">
        <div className="evidence-section-head">
          <span className="evidence-label">ฝั่งรายการรับเงิน</span>
          <small className="mono">{collectionSource} · {ledgerSource}</small>
        </div>
        <div className="responsive-table">
          <table className="evidence-table">
            <thead>
              <tr><th>เลขที่จอง / ผู้จอง</th><th>ห้อง</th><th>วันที่สร้างคำจอง</th><th>วันที่บันทึกรับเงิน</th><th>ช่องทาง</th><th>ยอด</th><th>แถวต้นทาง</th></tr>
            </thead>
            <tbody>
              {group.receipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td><b>{receipt.guest || "ไม่ระบุชื่อ"}</b><small className="block mono">{receipt.reservationNo}</small></td>
                  <td>{receipt.roomType}<small className="block">{receipt.roomNumber}</small></td>
                  <td><b>{thaiDate(receipt.bookingCreatedDate)}</b><small className="block">{receipt.bookingCreatedAt.slice(11, 16)} น.</small></td>
                  <td>{thaiDate(receipt.receiptDate)}</td>
                  <td>{receipt.method}<small className="block">{receipt.channel}</small></td>
                  <td><strong>{baht(receipt.amountSatang)}</strong></td>
                  <td className="mono">row {receipt.sourceRow}<small className="block">{receipt.id}</small></td>
                </tr>
              ))}
              <tr className="evidence-total">
                <td colSpan={5}>รวมฝั่งรายการรับเงิน</td>
                <td><strong>{baht(group.receiptSatang)}</strong></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. bank side, line by line */}
      <div className="evidence-section">
        <div className="evidence-section-head">
          <span className="evidence-label">ฝั่งเงินเข้าธนาคาร · •••{group.account}</span>
          <small className="mono">{group.statementSource} · {group.accountNo}</small>
        </div>
        <div className="responsive-table">
          <table className="evidence-table">
            <thead>
              <tr><th>วันที่ / เวลา</th><th>รายการ</th><th>ช่องทาง</th><th>ผู้โอน</th><th>ยอดเข้า</th><th>ยอดคงเหลือ</th><th>ตำแหน่งในไฟล์</th></tr>
            </thead>
            <tbody>
              {group.lines.map((line) => (
                <tr key={line.id}>
                  <td><b>{thaiDate(line.date)}</b><small className="block">{line.time} น.</small></td>
                  <td>{line.description}<small className="block mono">{line.id}</small></td>
                  <td>{line.channel}</td>
                  <td className="detail-cell">{line.detail || "—"}</td>
                  <td><strong>{baht(line.amountSatang)}</strong></td>
                  <td><small className="block">{baht(line.balanceBeforeSatang)}</small><b>→ {baht(line.balanceSatang)}</b></td>
                  <td className="mono">หน้า {line.page} · บรรทัด {line.row}</td>
                </tr>
              ))}
              <tr className="evidence-total">
                <td colSpan={4}>รวมฝั่งเงินเข้าธนาคาร</td>
                <td><strong>{baht(group.bankSatang)}</strong></td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. what this payment means for each booking */}
      <div className="evidence-section">
        <span className="evidence-label">ผลต่อคำจอง</span>
        <div className="booking-impact">
          {reservations.map((reservationNo) => {
            const rows = group.receipts.filter((receipt) => receipt.reservationNo === reservationNo);
            const first = rows[0];
            const paidHere = rows.reduce((sum, row) => sum + row.amountSatang, 0);
            const share = first.bookingTotalSatang ? Math.round((paidHere / first.bookingTotalSatang) * 100) : 0;
            return (
              <article key={reservationNo}>
                <div className="booking-impact-head">
                  <b>{first.guest || "ไม่ระบุชื่อ"}</b>
                  <span className="mono">{reservationNo}</span>
                  <Pill tone={first.bookingStatus === "Completed" ? "green" : first.bookingStatus === "Cancelled" ? "slate" : "blue"}>{first.bookingStatus || "—"}</Pill>
                </div>
                <dl>
                  <div><dt>ยอดจองรวม</dt><dd>{baht(first.bookingTotalSatang)}</dd></div>
                  <div><dt>จ่ายในกลุ่มนี้</dt><dd><strong>{baht(paidHere)}</strong></dd></div>
                  <div><dt>ชำระแล้วทั้งหมด</dt><dd>{baht(first.bookingPaidSatang)}</dd></div>
                  <div><dt>คงค้าง</dt><dd className={first.bookingBalanceDueSatang ? "negative" : ""}>{baht(first.bookingBalanceDueSatang)}</dd></div>
                  <div><dt>เข้าพัก</dt><dd>{thaiDate(first.checkIn)} – {thaiDate(first.checkOut)}</dd></div>
                  <div><dt>จำนวนคืน</dt><dd>{first.bookingNights}</dd></div>
                </dl>
                <div className="booking-impact-bar"><i style={{ width: `${Math.min(share, 100)}%` }} /><small>{share}% ของยอดจอง</small></div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="allocation-summary">
        <span><small>ยอดรับเงินรวม</small><b>{baht(group.receiptSatang)}</b></span>
        <i>=</i>
        <span><small>ยอดเงินเข้ารวม</small><b>{baht(group.bankSatang)}</b></span>
        <span className="control-result green"><b>✓ ผลต่าง {baht(group.deltaSatang)}</b><small>ผ่านทั้งกฎวันที่และกฎยอดเงิน</small></span>
      </div>
    </div>
  );
}

// ── exceptions ────────────────────────────────────────────────────────────────

function Exceptions() {
  const { dataset } = useWorkspace();
  const { accounts, exceptions, summary } = dataset.reconciliation;
  const [reasonFilter, setReasonFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(exceptions[0]?.id ?? "");

  const reasons = [...new Set(exceptions.map((exception) => exception.reason))];
  const visible = exceptions.filter((exception) => {
    if (reasonFilter !== "all" && exception.reason !== reasonFilter) return false;
    if (accountFilter !== "all" && exception.account !== accountFilter) return false;
    if (!query.trim()) return true;
    return `${exception.id} ${exception.reason} ${exception.reservationNo} ${exception.guest} ${exception.bankLineId}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const selected = exceptions.find((exception) => exception.id === selectedId) ?? visible[0] ?? null;

  return (
    <>
      <PageHeading
        eyebrow="Exception queue"
        title="รายการที่จับคู่ไม่ได้"
        description="ระบบไม่ปรับยอดและไม่ขยายช่วงวันที่ให้อัตโนมัติ ทุกกรณีต้องตัดสินใจโดยผู้ตรวจ"
        action={<div className="heading-stats"><span><b>{exceptions.length}</b><small>รายการเปิดอยู่</small></span><span><b>{baht(summary.unexplainedReceiptSatang)}</b><small>ฝั่งรับเงิน</small></span><span><b>{baht(summary.unexplainedBankSatang)}</b><small>ฝั่งธนาคาร</small></span></div>}
      />

      <section className="panel data-panel">
        <div className="statement-toolbar">
          <div className="tabs wrap">
            <button className={reasonFilter === "all" ? "active" : ""} onClick={() => setReasonFilter("all")}>ทั้งหมด <span>{exceptions.length}</span></button>
            {reasons.map((reason) => (
              <button key={reason} className={reasonFilter === reason ? "active" : ""} onClick={() => setReasonFilter(reason)}>
                {exceptions.find((exception) => exception.reason === reason)?.label} <span>{exceptions.filter((exception) => exception.reason === reason).length}</span>
              </button>
            ))}
          </div>
          <div className="tabs compact">
            {[["all", "ทุกบัญชี"], ...accounts.map((account) => [account.code, `•••${account.code}`])].map(([value, label]) => (
              <button key={value} className={accountFilter === value ? "active" : ""} onClick={() => setAccountFilter(value)}>{label}</button>
            ))}
          </div>
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขที่จอง ชื่อ หรือรหัสรายการ" /></label>
        </div>

        {selected && <ExceptionEvidence exception={selected} />}

        <div className="responsive-table scroll-table">
          <table>
            <thead>
              <tr><th>รายการ / เหตุผล</th><th>เลขที่จอง</th><th>สร้างคำจอง</th><th>ยอดรับเงิน</th><th>เงินเข้าที่เทียบ</th><th>ผลต่าง</th><th>บัญชี</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((exception) => (
                <tr key={exception.id} className={selected?.id === exception.id ? "selected" : ""} onClick={() => setSelectedId(exception.id)}>
                  <td>
                    <div className="reason">
                      <span className={`severity ${exception.severity}`}>{exception.severity === "high" ? "!" : exception.severity === "medium" ? "•" : "i"}</span>
                      <span><b>{exception.label}</b><small>{exception.id} · {exception.reason}</small></span>
                    </div>
                  </td>
                  <td className="mono">{exception.reservationNo || "—"}</td>
                  <td>{exception.bookingCreatedDate ? thaiDate(exception.bookingCreatedDate) : "—"}</td>
                  <td>{exception.receiptSatang ? baht(exception.receiptSatang) : "—"}</td>
                  <td>{exception.bankSatang ? baht(exception.bankSatang) : "—"}</td>
                  <td className={exception.deltaSatang === 0 ? "" : "negative"}>{baht(exception.deltaSatang)}</td>
                  <td>•••{exception.account}</td>
                  <td><button className="row-button" aria-label={`เปิด ${exception.id}`}>›</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && <div className="empty-state"><span>✓</span><h3>ไม่มีรายการในตัวกรองนี้</h3><p>ลองเปลี่ยนเหตุผลหรือบัญชี</p></div>}
      </section>
    </>
  );
}

function ExceptionEvidence({ exception }: { exception: ReconciliationException }) {
  const explanation: Record<string, string> = {
    MISSING_BOOKING: "รายการรับเงินอ้างถึงเลขที่จองที่ไม่มีอยู่ในบัญชีแยกประเภท จึงไม่มีวันที่สร้างคำจองให้เทียบ",
    DATE_RULE_UNMET: "ไม่มีเงินเข้าบัญชีนี้เลยในวันที่สร้างคำจอง กฎข้อ 1 จึงไม่ผ่าน",
    AMOUNT_MISMATCH: "มีเงินเข้าในวันเดียวกัน แต่ไม่มียอดหรือชุดยอดใดรวมแล้วเท่ากับยอดรับเงินพอดี กฎข้อ 2 จึงไม่ผ่าน",
    UNMATCHED_BANK_CREDIT: "เงินเข้ารายการนี้ไม่มีรายการรับเงินที่ผ่านกฎทั้งสองข้อมารองรับ",
    REFUND_LINE: "รายการคืนเงินต้องกระทบกับยอดถอนใน Statement ไม่ใช่ยอดฝาก",
  };
  const dateRulePassed = exception.reason === "AMOUNT_MISMATCH";

  return (
    <div className="evidence">
      <header className="evidence-top">
        <div>
          <small>หลักฐานและเหตุผล</small>
          <h3 className="mono">{exception.id}</h3>
          <p>{explanation[exception.reason]}</p>
        </div>
        <div className="evidence-top-figures">
          <span><small>เหตุผล</small><Pill tone={reasonTone[exception.reason] ?? "slate"}>{exception.reason}</Pill></span>
          <span><small>บัญชี</small><b>•••{exception.account}</b></span>
        </div>
      </header>

      {exception.receiptId ? (
        <div className="rule-checks">
          <div className={dateRulePassed ? "pass" : "fail"}>
            <span className="rule-check-mark">{dateRulePassed ? "✓" : "✕"}</span>
            <div>
              <small>R01</small><b>วันที่สร้างคำจอง = วันที่เงินเข้า Statement</b>
              <p>
                {exception.bookingCreatedDate ? thaiDate(exception.bookingCreatedDate) : "ไม่มีข้อมูล"}
                <i>{dateRulePassed ? "=" : "≠"}</i>
                {exception.bankDate ? thaiDate(exception.bankDate) : "ไม่พบเงินเข้าในวันนั้น"}
              </p>
            </div>
          </div>
          <div className="fail">
            <span className="rule-check-mark">✕</span>
            <div>
              <small>R02</small><b>ยอดตรงกันพอดี</b>
              <p>
                {baht(exception.receiptSatang)}<i>≠</i>{exception.bankSatang ? baht(exception.bankSatang) : "—"}
                <em>ผลต่าง {baht(exception.deltaSatang)}</em>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rule-checks">
          <div className="fail">
            <span className="rule-check-mark">✕</span>
            <div>
              <small>R06</small><b>เงินเข้าที่ยังไม่มีรายการรับเงินรองรับ</b>
              <p>{thaiDate(exception.bankDate)}<i>·</i>{baht(exception.bankSatang)}<em>ไม่พบรายการรับเงินที่ผ่านกฎทั้งสองข้อ</em></p>
            </div>
          </div>
        </div>
      )}

      <div className="evidence-grid">
        <article>
          <small>รายงานการรับเงิน</small>
          <b>{exception.receiptSatang ? baht(exception.receiptSatang) : "—"}</b>
          <p>{exception.receiptDate ? thaiDate(exception.receiptDate) : "—"} · {exception.receiptId || "ไม่มีรายการรับเงิน"}</p>
          <p className="mono">{exception.reservationNo || "—"}</p>
        </article>
        <span className="not-equal">≠<small>ผลต่าง<br /><b>{baht(exception.deltaSatang)}</b></small></span>
        <article>
          <small>รายการเดินบัญชี •••{exception.account}</small>
          <b>{exception.bankSatang ? baht(exception.bankSatang) : "—"}</b>
          <p>{exception.bankDate ? thaiDate(exception.bankDate) : "ไม่มีรายการที่เทียบได้"}</p>
          <p className="mono">{exception.bankLineId || "—"}</p>
        </article>
        <div className="rule-box">
          <small>สิ่งที่ระบบจะไม่ทำ</small>
          <b>ไม่ปรับยอด ไม่ขยายช่วงวันที่ ไม่แก้ไขข้อมูลต้นฉบับ</b>
          <p>ต้องให้ผู้ตรวจตัดสินใจและบันทึกเหตุผล</p>
        </div>
      </div>

      {exception.candidates.length > 0 && (
        <div className="evidence-section">
          <span className="evidence-label">เงินเข้าในวันเดียวกันที่ยังว่างอยู่ ({exception.candidates.length})</span>
          <div className="candidate-list">
            {exception.candidates.map((candidate) => (
              <div key={candidate.id}>
                <b>{baht(candidate.amountSatang)}</b>
                <small>{candidate.time} · <span className="mono">{candidate.id}</span></small>
                <small>{candidate.detail}</small>
                <Pill tone="red">ต่าง {baht(candidate.deltaSatang)}</Pill>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── bookings ──────────────────────────────────────────────────────────────────

function Bookings() {
  const { dataset } = useWorkspace();
  const { bookings, receipts, reconciliation } = dataset;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const receiptIndex = useMemo(() => {
    const map = new Map<string, { group: MatchGroup }>();
    for (const group of reconciliation.groups) for (const receipt of group.receipts) map.set(receipt.id, { group });
    return map;
  }, [reconciliation.groups]);

  const exceptionByReceipt = useMemo(() => {
    const map = new Map<string, ReconciliationException>();
    for (const exception of reconciliation.exceptions) if (exception.receiptId) map.set(exception.receiptId, exception);
    return map;
  }, [reconciliation.exceptions]);

  const receiptsByReservation = useMemo(() => {
    const map = new Map<string, Receipt[]>();
    for (const receipt of receipts) {
      const list = map.get(receipt.reservationNo);
      if (list) list.push(receipt);
      else map.set(receipt.reservationNo, [receipt]);
    }
    return map;
  }, [receipts]);

  const rows = useMemo(() => bookings.map((booking) => {
    const own = receiptsByReservation.get(booking.reservationNo) ?? [];
    const matched = own.filter((receipt) => receiptIndex.has(receipt.id)).length;
    const inScope = own.filter((receipt) => receiptIndex.has(receipt.id) || exceptionByReceipt.has(receipt.id)).length;
    return { booking, receipts: own, matched, inScope };
  }), [bookings, receiptsByReservation, receiptIndex, exceptionByReceipt]);

  const visible = rows.filter((row) => {
    if (statusFilter === "matched" && !(row.inScope > 0 && row.matched === row.inScope)) return false;
    if (statusFilter === "open" && !(row.inScope > 0 && row.matched < row.inScope)) return false;
    if (statusFilter === "outofscope" && row.inScope !== 0) return false;
    if (!query.trim()) return true;
    return `${row.booking.reservationNo} ${row.booking.guest} ${row.booking.roomType} ${row.booking.channel}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  const [selectedNo, setSelectedNo] = useState(() => rows.find((row) => row.inScope > 0)?.booking.reservationNo ?? bookings[0]?.reservationNo ?? "");
  const selectedRow = visible.find((row) => row.booking.reservationNo === selectedNo) ?? visible[0];

  return (
    <>
      <PageHeading
        eyebrow="Ledger records"
        title="รายการจอง"
        description="วันที่สร้างคำจองคือกุญแจที่ใช้จับคู่ หน้านี้แสดงว่าแต่ละคำจองกระทบยอดไปถึงไหนแล้ว"
        action={<div className="heading-stats"><span><b>{bookings.length}</b><small>คำจอง</small></span><span><b>{baht(bookings.reduce((sum, booking) => sum + booking.totalSatang, 0))}</b><small>ยอดจองรวม</small></span></div>}
      />

      <section className="panel data-panel">
        <div className="statement-toolbar">
          <div className="tabs">
            {[["all", "ทั้งหมด"], ["matched", "กระทบยอดครบ"], ["open", "ยังมีรายการค้าง"], ["outofscope", "นอกขอบเขต"]].map(([value, label]) => (
              <button key={value} className={statusFilter === value ? "active" : ""} onClick={() => setStatusFilter(value)}>{label}</button>
            ))}
          </div>
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขที่จอง ชื่อผู้จอง หรือห้อง" /></label>
        </div>

        {selectedRow && <BookingDetail row={selectedRow} receiptIndex={receiptIndex} exceptionByReceipt={exceptionByReceipt} />}

        <div className="responsive-table scroll-table">
          <table>
            <thead>
              <tr><th>วันที่สร้างคำจอง</th><th>เลขที่จอง / ผู้จอง</th><th>ห้อง</th><th>สถานะ</th><th>ยอดจอง</th><th>ชำระแล้ว</th><th>คงค้าง</th><th>กระทบยอด</th><th /></tr>
            </thead>
            <tbody>
              {visible.slice(0, 120).map((row) => (
                <tr key={row.booking.reservationNo} className={selectedRow?.booking.reservationNo === row.booking.reservationNo ? "selected" : ""} onClick={() => setSelectedNo(row.booking.reservationNo)}>
                  <td><b>{thaiDate(row.booking.createdDate)}</b><small className="block">{row.booking.createdAt.slice(11, 16)} น.</small></td>
                  <td><b>{row.booking.guest || "—"}</b><small className="block mono">{row.booking.reservationNo}</small></td>
                  <td>{row.booking.roomType}<small className="block">{row.booking.channel}</small></td>
                  <td><Pill tone={row.booking.status === "Completed" ? "green" : row.booking.status === "Cancelled" ? "slate" : "blue"}>{row.booking.status || "—"}</Pill></td>
                  <td><strong>{baht(row.booking.totalSatang)}</strong></td>
                  <td>{baht(row.booking.paidSatang)}</td>
                  <td className={row.booking.balanceDueSatang !== 0 ? "negative" : ""}>{baht(row.booking.balanceDueSatang)}</td>
                  <td>{row.inScope === 0 ? <Pill>นอกขอบเขต</Pill> : <Pill tone={row.matched === row.inScope ? "green" : "amber"}>{row.matched}/{row.inScope}</Pill>}</td>
                  <td><button className="row-button" aria-label={`เปิด ${row.booking.reservationNo}`}>›</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length > 120 && <p className="table-note">แสดง 120 จาก {visible.length} รายการ · ใช้ช่องค้นหาเพื่อจำกัดผลลัพธ์</p>}
        {!visible.length && <div className="empty-state"><span>⌕</span><h3>ไม่พบคำจองที่ตรงกับตัวกรอง</h3><p>ลองล้างคำค้นหา</p></div>}
      </section>
    </>
  );
}

function BookingDetail({ row, receiptIndex, exceptionByReceipt }: {
  row: { booking: Booking; receipts: Receipt[] };
  receiptIndex: Map<string, { group: MatchGroup }>;
  exceptionByReceipt: Map<string, ReconciliationException>;
}) {
  const { booking } = row;
  return (
    <div className="evidence">
      <header className="evidence-top">
        <div>
          <small>รายละเอียดคำจอง</small>
          <h3>{booking.guest || "ไม่ระบุชื่อ"}</h3>
          <p className="mono">{booking.reservationNo}</p>
        </div>
        <div className="evidence-top-figures">
          <span><small>สถานะ</small><Pill tone={booking.status === "Completed" ? "green" : booking.status === "Cancelled" ? "slate" : "blue"}>{booking.status || "—"}</Pill></span>
          <span><small>ยอดจอง</small><b>{baht(booking.totalSatang)}</b></span>
        </div>
      </header>

      <div className="booking-meta-grid">
        <span><small>วันที่สร้างคำจอง</small><b>{thaiDateTime(booking.createdAt)}</b></span>
        <span><small>วันที่ปิดคำจอง</small><b>{thaiDateTime(booking.completedAt)}</b></span>
        <span><small>ห้อง / ประเภท</small><b>{booking.roomNumber} · {booking.roomType}</b></span>
        <span><small>ช่องทาง</small><b>{booking.channel || "—"}</b></span>
        <span><small>จำนวนคืน</small><b>{booking.nights}</b></span>
        <span><small>ผู้บันทึก</small><b>{booking.creator || "—"}</b></span>
      </div>

      <div className="evidence-section">
        <span className="evidence-label">รายการรับเงินของคำจองนี้ ({row.receipts.length})</span>
        {row.receipts.length === 0 && <p className="table-note">ไม่พบรายการรับเงินสำหรับเลขที่จองนี้</p>}
        <div className="receipt-trace">
          {row.receipts.map((receipt) => {
            const match = receiptIndex.get(receipt.id);
            const exception = exceptionByReceipt.get(receipt.id);
            const dateRule = match ? "ผ่าน · เงินเข้าวันเดียวกัน"
              : exception?.reason === "AMOUNT_MISMATCH" ? "ผ่าน · แต่ยอดไม่ตรง"
              : exception ? "ไม่ผ่าน" : "ไม่ได้ตรวจ (ไม่มี Statement)";
            return (
              <article key={receipt.id} className={`trace-row ${match ? "ok" : exception ? "bad" : "neutral"}`}>
                <div><small>รายการรับเงิน</small><b>{baht(receipt.amountSatang)}</b><span>{thaiDate(receipt.date)} · {receipt.method}</span></div>
                <i>→</i>
                <div><small>กฎวันที่สร้างคำจอง</small><b>{dateRule}</b><span>สร้างคำจอง {thaiDate(booking.createdDate)}</span></div>
                <i>→</i>
                <div>
                  <small>ผลการจับคู่</small>
                  <b>{match ? `${match.group.type} · ${baht(match.group.bankSatang)}` : exception ? exception.label : "นอกขอบเขตการกระทบยอด"}</b>
                  <span className="mono">{match ? match.group.id : exception ? exception.id : receipt.method}</span>
                </div>
                <Pill tone={match ? "green" : exception ? (reasonTone[exception.reason] ?? "red") : "slate"}>{match ? "จับคู่แล้ว" : exception ? "ข้อยกเว้น" : "นอกขอบเขต"}</Pill>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── statements ────────────────────────────────────────────────────────────────

function Statements() {
  const { dataset } = useWorkspace();
  const { statements, reconciliation } = dataset;
  const [accountCode, setAccountCode] = useState(statements[0]?.code ?? "");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [query, setQuery] = useState("");

  const lineIndex = useMemo(() => {
    const map = new Map<string, MatchGroup>();
    for (const group of reconciliation.groups) for (const line of group.lines) map.set(line.id, group);
    return map;
  }, [reconciliation.groups]);

  const statement = (statements.find((item) => item.code === accountCode) ?? statements[0]) as Statement | undefined;
  if (!statement) return <div className="empty-state"><span>▦</span><h3>ยังไม่มี Statement ในระบบ</h3></div>;

  const matchedCredits = statement.lines.filter((line) => line.direction === "credit" && lineIndex.has(line.id)).length;
  const visible = statement.lines.filter((line) => {
    if (directionFilter === "credit" && line.direction !== "credit") return false;
    if (directionFilter === "debit" && line.direction !== "debit") return false;
    if (directionFilter === "unmatched" && (line.direction !== "credit" || lineIndex.has(line.id))) return false;
    if (!query.trim()) return true;
    return `${line.id} ${line.detail} ${line.description} ${line.channel}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <>
      <PageHeading
        eyebrow="Bank statements"
        title="รายการเดินบัญชี"
        description="รายการจาก Statement PDF พร้อมผลตรวจ control total และสถานะการจับคู่รายบรรทัด"
        action={<Pill tone={statement.controlDeltaSatang === 0 ? "green" : "red"}>Control total {statement.controlDeltaSatang === 0 ? "ผ่าน" : baht(statement.controlDeltaSatang)}</Pill>}
      />

      <section className="statement-grid">
        {reconciliation.accounts.map((item) => <AccountCard key={item.code} account={item} onOpen={() => setAccountCode(item.code)} />)}
      </section>

      <section className="panel data-panel">
        <PanelTitle
          kicker={`${statement.source} · ${statement.cycle}`}
          title={`รายการเดินบัญชี •••${statement.code}`}
          action={<span className="control-equation"><b>{baht(statement.openingSatang)}</b><i>+</i><b>{baht(statement.creditSatang)}</b><i>−</i><b>{baht(statement.debitSatang)}</b><i>=</i><b>{baht(statement.closingSatang)}</b></span>}
        />
        <div className="statement-toolbar">
          <div className="tabs">
            {statements.map((item) => (
              <button key={item.code} className={accountCode === item.code ? "active" : ""} onClick={() => setAccountCode(item.code)}>•••{item.code}</button>
            ))}
          </div>
          <div className="tabs compact">
            {[
              ["all", `ทั้งหมด (${statement.lines.length})`],
              ["credit", `เงินเข้า (${statement.creditCount})`],
              ["debit", `เงินออก (${statement.debitCount})`],
              ["unmatched", `ยังไม่จับคู่ (${statement.creditCount - matchedCredits})`],
            ].map(([value, label]) => (
              <button key={value} className={directionFilter === value ? "active" : ""} onClick={() => setDirectionFilter(value)}>{label}</button>
            ))}
          </div>
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหารายละเอียดหรือช่องทาง" /></label>
        </div>

        <div className="responsive-table scroll-table">
          <table>
            <thead>
              <tr><th>วันที่ / เวลา</th><th>รายการ</th><th>ช่องทาง</th><th>รายละเอียด</th><th>เงินเข้า</th><th>เงินออก</th><th>ยอดคงเหลือ</th><th>สถานะ</th></tr>
            </thead>
            <tbody>
              {visible.map((line) => {
                const group = lineIndex.get(line.id);
                return (
                  <tr key={line.id}>
                    <td><b>{thaiDate(line.date)}</b><small className="block">{line.time} น. · หน้า {line.page}</small></td>
                    <td>{line.description}<small className="block mono">{line.id}</small></td>
                    <td>{line.channel}</td>
                    <td className="detail-cell">{line.detail}</td>
                    <td>{line.direction === "credit" ? <strong>{baht(line.amountSatang)}</strong> : "—"}</td>
                    <td className={line.direction === "debit" ? "negative" : ""}>{line.direction === "debit" ? baht(line.amountSatang) : "—"}</td>
                    <td>{baht(line.balanceSatang)}</td>
                    <td>
                      {line.direction === "debit" ? <Pill>เงินออก</Pill>
                        : group ? <><Pill tone="green">{group.type}</Pill><small className="block mono">{group.id}</small></>
                        : <Pill tone="blue">ยังไม่จับคู่</Pill>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ── upload ────────────────────────────────────────────────────────────────────

type UploadResult = { runId?: string; accepted?: { kind: string; name: string; rows: number }[]; summary?: Record<string, number>; error?: string };

function Upload({ databaseConfigured }: { databaseConfigured: boolean }) {
  const { dataset } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const loaded = new Set(dataset.meta.sources.map((item) => sourceKindToDocument[item.kind] ?? item.kind));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    if (!body.getAll("files").some((entry) => entry instanceof File && entry.size > 0)) {
      setResult({ error: "กรุณาเลือกไฟล์อย่างน้อยหนึ่งไฟล์" });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/upload", { method: "POST", body });
      const payload = (await response.json()) as UploadResult;
      setResult(payload);
      if (response.ok) {
        form.reset();
        window.setTimeout(() => window.location.reload(), 1200);
      }
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="Ingestion"
        title="นำเข้าเอกสาร"
        description="อัปโหลดเอกสารต้นทาง ระบบจะอ่าน ตรวจ control total และกระทบยอดใหม่ทั้งรอบทันที"
        action={<Pill tone={databaseConfigured ? "green" : "amber"}>{databaseConfigured ? "เชื่อมต่อฐานข้อมูลแล้ว" : "ยังไม่ได้ตั้งค่าฐานข้อมูล"}</Pill>}
      />

      {!databaseConfigured && (
        <div className="coverage-note standalone">
          <span>i</span>
          <p>
            <b>อัปโหลดผ่านเว็บต้องมีฐานข้อมูลก่อน</b>
            <small>
              ตั้งค่า <code>DATABASE_URL</code> ของ Neon Postgres ใน Vercel (Settings → Environment Variables) แล้ว redeploy
              ระบบจะสร้างตารางให้อัตโนมัติในการเรียกครั้งแรก · ระหว่างนี้ยังใช้วิธีวางไฟล์ใน <code>data/</code> แล้ว <code>npm run data:build</code> ได้ตามเดิม
            </small>
          </p>
        </div>
      )}

      <section className="panel upload-panel">
        <PanelTitle kicker="Source documents" title="เอกสารที่ระบบต้องใช้" />
        <div className="required-files inside">
          {requiredDocuments.map((file) => {
            const ready = loaded.has(file.kind);
            const stored = dataset.meta.sources.find((item) => (sourceKindToDocument[item.kind] ?? item.kind) === file.kind);
            return (
              <article key={file.kind} className={ready ? "ready" : ""}>
                <span className={`check-icon ${ready ? "ready" : "missing"}`}>{ready ? "✓" : "+"}</span>
                <p><b>{file.label}</b><small>{ready ? `${stored?.name} · ${stored?.rows.toLocaleString("en-US")} แถว` : file.detail}</small></p>
                <code>{file.pattern}</code>
              </article>
            );
          })}
        </div>

        <form className="upload-form" onSubmit={submit}>
          <label className="drop-zone">
            <input name="files" type="file" multiple accept=".xlsx,.pdf" disabled={!databaseConfigured || busy} />
            <span>＋</span>
            <b>เลือกไฟล์ หรือวางไฟล์ที่นี่</b>
            <small>เลือกพร้อมกันได้ทั้งสี่ไฟล์ · ระบบดูจากชื่อไฟล์ว่าเป็นเอกสารชนิดใด · ไม่เกิน 25 MB ต่อไฟล์</small>
          </label>
          <div className="upload-actions">
            <p className="table-note">อัปโหลดเอกสารชนิดเดิมซ้ำ จะแทนที่ของเดิมทั้งชุด ไม่สะสมซ้ำ</p>
            <button className="primary-button" type="submit" disabled={!databaseConfigured || busy}>{busy ? "กำลังประมวลผล…" : "อัปโหลดและกระทบยอดใหม่"}</button>
          </div>
        </form>

        {result?.error && <div className="load-error"><span>!</span><p><b>ไม่สำเร็จ</b><small>{result.error}</small></p></div>}
        {result?.accepted && (
          <div className="upload-result">
            <b>✓ นำเข้าสำเร็จ {result.accepted.length} ไฟล์ · กำลังโหลดหน้าใหม่</b>
            <ul>{result.accepted.map((item) => <li key={item.name}><span className="mono">{item.name}</span> · {item.rows.toLocaleString("en-US")} แถว</li>)}</ul>
          </div>
        )}
      </section>
    </>
  );
}

// ── rules ─────────────────────────────────────────────────────────────────────

function Rules() {
  const { dataset, hasData, settings, go } = useWorkspace();
  const { accounts } = dataset.reconciliation;
  const shapeOff = [
    !settings.matching.allowManyToOne ? "R04" : "",
    !settings.matching.allowOneToMany ? "R05" : "",
  ].filter(Boolean);

  return (
    <>
      <PageHeading
        eyebrow={`Ruleset v${dataset.reconciliation.rulesetVersion}`}
        title="กฎการจับคู่"
        description="กฎที่ระบบใช้ และเอกสารต้นทางที่อ่านเข้ามา"
        action={
          <div className="rule-actions">
            <Pill tone={shapeOff.length ? "amber" : "green"}>{shapeOff.length ? `ปิดอยู่ ${shapeOff.join(" · ")}` : "Active"}</Pill>
            <button className="text-button" onClick={() => go("settings")}>ปรับที่หน้าการตั้งค่า →</button>
          </div>
        }
      />
      <RuleBanner />
      <ExclusionBanner />

      <section className="rules-grid">
        <div className="panel">
          <PanelTitle kicker="Rule sequence" title="ลำดับกฎที่ระบบใช้" />
          <div className="rule-sequence">
            {[
              ["R01", "วันที่สร้างคำจอง = วันที่เงินเข้า Statement", "เทียบเป็นวันปฏิทินเดียวกัน ไม่มี date window", "BLOCK"],
              ["R02", "ยอดต้องตรงกันพอดี", "ผลต่างต้องเป็น ฿0.00 ไม่มี tolerance", "BLOCK"],
              ["R03", "จับคู่ 1:1", "หนึ่งรายการรับเงิน = หนึ่งยอดเงินเข้า", "100"],
              ["R04", "จับคู่ N:1", `ผลรวมสูงสุด ${settings.matching.maxGroupSize} รายการรับเงินวันเดียวกัน = หนึ่งยอดเงินเข้า`, "95"],
              ["R05", "จับคู่ 1:N", `หนึ่งรายการรับเงิน = ผลรวมสูงสุด ${settings.matching.maxGroupSize} ยอดเงินเข้าวันเดียวกัน`, "92"],
              ["R06", "ที่เหลือเป็นข้อยกเว้น", "ไม่ปรับยอด ไม่ขยายวัน ไม่แก้ข้อมูลต้นฉบับ", "BLOCK"],
            ].map((rule) => (
              <div key={rule[0]} className={shapeOff.includes(rule[0]) ? "rule-off" : ""}>
                <span>{rule[0]}</span>
                <p><b>{rule[1]}</b><small>{rule[2]}</small></p>
                <em className={rule[3] === "BLOCK" ? "block" : ""}>{shapeOff.includes(rule[0]) ? "ปิดอยู่" : rule[3]}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <PanelTitle kicker="Source documents" title="เอกสารที่อยู่ในระบบ" />
          <div className="source-list">
            {dataset.meta.sources.length === 0 && <p className="table-note">ยังไม่มีเอกสารในระบบ</p>}
            {dataset.meta.sources.map((item) => (
              <div key={item.name}>
                <span className={`file-icon ${item.name.endsWith(".pdf") ? "pdf" : "sheet"}`}>{item.name.endsWith(".pdf") ? "P" : "X"}</span>
                <p><b>{item.name}</b><small>{item.label ?? item.kind}</small></p>
                <em>{item.rows.toLocaleString("en-US")} แถว</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      {hasData && (
        <section className="panel data-panel">
          <PanelTitle kicker="Control totals" title="การตรวจยอดคุมของแต่ละบัญชี" />
          <div className="responsive-table">
            <table>
              <thead>
                <tr><th>บัญชี</th><th>ช่องทางรับเงิน</th><th>ยอดยกมา</th><th>ยอดฝาก</th><th>ยอดถอน</th><th>ยอดยกไป</th><th>ผลต่าง</th></tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.code}>
                    <td><b>•••{account.code}</b><small className="block">{account.branch}</small></td>
                    <td>{account.method}</td>
                    <td>{baht(account.openingSatang)}</td>
                    <td>{baht(account.creditSatang)}</td>
                    <td>{baht(account.debitSatang)}</td>
                    <td><strong>{baht(account.closingSatang)}</strong></td>
                    <td><Pill tone={account.controlDeltaSatang === 0 ? "green" : "red"}>{baht(account.controlDeltaSatang)}</Pill></td>
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
