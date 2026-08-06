"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type AccountResult,
  type Booking,
  type MatchGroup,
  type Receipt,
  type ReconciliationException,
  type Statement,
  type StatementLine,
  baht,
  dataset,
  thaiDate,
  thaiDateTime,
  thaiMonthLabel,
} from "../lib/dataset";

type ViewId = "overview" | "matching" | "exceptions" | "bookings" | "statements" | "receipts" | "rules";
type Tone = "green" | "blue" | "amber" | "red" | "slate";

const { meta, bookings, receipts, statements, reconciliation } = dataset;
const { accounts, groups, exceptions, outOfScope, summary } = reconciliation;

// The build emits an empty dataset when data/ holds no source documents, so the
// app deploys and runs before any statement has been loaded.
const hasData = meta.sources.length > 0;
const orgName = statements[0]?.accountName?.trim() || "ยังไม่ได้ระบุกิจการ";
const orgInitials = hasData ? orgName.replace(/^บจก\.\s*|^บริษัท\s*/, "").slice(0, 2) : "—";
const periodLabel = meta.period ? thaiMonthLabel(meta.period) : "ยังไม่มีรอบบัญชี";

const reasonTone: Record<string, Tone> = {
  MISSING_BOOKING: "red",
  DATE_RULE_UNMET: "amber",
  AMOUNT_MISMATCH: "red",
  UNMATCHED_BANK_CREDIT: "blue",
  REFUND_LINE: "slate",
};

const matchTypeTone: Record<string, Tone> = { "1:1": "green", "N:1": "blue", "1:N": "blue" };

const sourceLabels: Record<string, string> = {
  ledger: "บัญชีแยกประเภท (Ledger)",
  collection_report: "รายงานการรับเงิน (Collection)",
  bank_statement_885: "Statement KBank •••885",
  bank_statement_987: "Statement KBank •••987",
};

const navGroups: { label: string; items: { id: ViewId; label: string; icon: string; badge?: string }[] }[] = [
  {
    label: "การกระทบยอด",
    items: [
      { id: "overview", label: "ภาพรวม", icon: "⌂" },
      { id: "matching", label: "ผลการจับคู่", icon: "↔", badge: String(groups.length) },
      { id: "exceptions", label: "ข้อยกเว้น", icon: "!", badge: String(exceptions.length) },
    ],
  },
  {
    label: "ข้อมูลต้นทาง",
    items: [
      { id: "bookings", label: "รายการจอง", icon: "#", badge: String(bookings.length) },
      { id: "receipts", label: "รายการรับเงิน", icon: "▤", badge: String(receipts.length) },
      { id: "statements", label: "รายการเดินบัญชี", icon: "▦" },
    ],
  },
  { label: "ควบคุมระบบ", items: [{ id: "rules", label: "กฎและแหล่งข้อมูล", icon: "⚙" }] },
];

const titles: Record<ViewId, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: `รอบบัญชี ${thaiMonthLabel(meta.period)}`, title: "ภาพรวมการกระทบยอด", description: "ทุกตัวเลขมาจากเอกสารจริงในโฟลเดอร์ data/ ไม่มีข้อมูลตัวอย่างในระบบ" },
  matching: { eyebrow: `Ruleset v${reconciliation.rulesetVersion}`, title: "ผลการจับคู่", description: "จับคู่ได้เมื่อวันที่สร้างคำจองตรงกับวันที่เงินเข้า Statement และยอดตรงกันพอดีเท่านั้น" },
  exceptions: { eyebrow: "Exception queue", title: "รายการที่จับคู่ไม่ได้", description: "ระบบไม่ปรับยอดและไม่ขยายช่วงวันที่ให้อัตโนมัติ ทุกกรณีต้องตัดสินใจโดยผู้ตรวจ" },
  bookings: { eyebrow: "Ledger records", title: "รายการจอง", description: "ข้อมูลจากบัญชีแยกประเภท พร้อมวันที่สร้างคำจองที่ใช้เป็นกุญแจการจับคู่" },
  receipts: { eyebrow: "Collection report", title: "รายการรับเงิน", description: "ทุกแถวจากรายงานการรับเงิน พร้อมสถานะการกระทบยอดของแต่ละรายการ" },
  statements: { eyebrow: "Bank statements", title: "รายการเดินบัญชี", description: "รายการจาก Statement PDF ของ KBank ทั้งสองบัญชี พร้อมผลการตรวจ control total" },
  rules: { eyebrow: `Ruleset v${reconciliation.rulesetVersion}`, title: "กฎและแหล่งข้อมูล", description: "กฎที่ใช้จับคู่ และรายการไฟล์ต้นฉบับที่ระบบอ่านเข้ามา" },
};

function Pill({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function PanelTitle({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
  return <div className="panel-title"><span><small>{kicker}</small><h2>{title}</h2></span>{action}</div>;
}

function PageHeading({ view, action }: { view: ViewId; action?: ReactNode }) {
  const copy = titles[view];
  return <div className="page-heading"><div><span className="page-eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>{action}</div>;
}

function Metric({ label, value, detail, tone = "slate", badge }: { label: string; value: string; detail: string; tone?: Tone; badge?: string }) {
  return <article className="metric-card"><div><span>{label}</span>{badge && <Pill tone={tone}>{badge}</Pill>}</div><strong>{value}</strong><p>{detail}</p><i className={`metric-line ${tone}`} /></article>;
}

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

const viewIds = navGroups.flatMap((group) => group.items.map((item) => item.id));
const isViewId = (value: string): value is ViewId => (viewIds as string[]).includes(value);

export default function Home() {
  const [active, setActive] = useState<ViewId>("overview");

  // Each view is addressable as #matching, #exceptions, … so a reviewer can
  // link straight to the screen they are talking about.
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      if (isViewId(hash)) setActive(hash);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const receiptIndex = useMemo(() => {
    const map = new Map<string, { group: MatchGroup; type: string }>();
    for (const group of groups) for (const receipt of group.receipts) map.set(receipt.id, { group, type: group.type });
    return map;
  }, []);

  const lineIndex = useMemo(() => {
    const map = new Map<string, MatchGroup>();
    for (const group of groups) for (const line of group.lines) map.set(line.id, group);
    return map;
  }, []);

  const exceptionByReceipt = useMemo(() => {
    const map = new Map<string, ReconciliationException>();
    for (const exception of exceptions) if (exception.receiptId) map.set(exception.receiptId, exception);
    return map;
  }, []);

  const receiptsByReservation = useMemo(() => {
    const map = new Map<string, Receipt[]>();
    for (const receipt of receipts) {
      const list = map.get(receipt.reservationNo);
      if (list) list.push(receipt);
      else map.set(receipt.reservationNo, [receipt]);
    }
    return map;
  }, []);

  const go = (view: ViewId) => {
    setActive(view);
    if (window.location.hash.slice(1) !== view) window.history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => go("overview")}>
          <span className="brand-mark"><i /><i /><i /></span>
          <span><b>ClearClose</b><small>ACCOUNT RECONCILIATION</small></span>
        </button>
        <div className="org-switcher static">
          <span>{orgInitials}</span>
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
            <span className={hasData && summary.controlBalanced ? "" : "warn"} />
            {!hasData ? "ยังไม่มีเอกสารต้นทาง" : summary.controlBalanced ? "Control total ตรงทุกบัญชี" : "Control total ไม่ตรง"}
          </p>
          <small className="sidebar-note">อ่านจาก data/ · {meta.sources.length} ไฟล์</small>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="topbar-brand"><span className="brand-mark"><i /><i /><i /></span><b>ClearClose</b></div>
          <div className="period"><small>รอบบัญชี</small><b>{periodLabel}</b></div>
          <div className="top-actions">
            <span className="live-state"><i /> DATA/ SOURCE FILES</span>
            <span className="ruleset-chip">ruleset v{reconciliation.rulesetVersion}</span>
          </div>
        </header>

        <div className="content">
          {/* Without source documents every data view would be a wall of zeros,
              so show one honest status screen instead. The ruleset page still
              works — it documents the engine, not the data. */}
          {!hasData && active !== "rules" && <NoSourceDocuments view={active} onGo={go} />}
          {hasData && active === "overview" && <Overview onGo={go} />}
          {hasData && active === "matching" && <Matching />}
          {hasData && active === "exceptions" && <Exceptions />}
          {hasData && active === "bookings" && <Bookings receiptsByReservation={receiptsByReservation} receiptIndex={receiptIndex} exceptionByReceipt={exceptionByReceipt} />}
          {hasData && active === "receipts" && <Receipts receiptIndex={receiptIndex} exceptionByReceipt={exceptionByReceipt} />}
          {hasData && active === "statements" && <Statements lineIndex={lineIndex} />}
          {active === "rules" && <Rules />}
          <footer>
            <span>ClearClose · ruleset v{reconciliation.rulesetVersion}</span>
            <p>Asia/Bangkok · สร้างชุดข้อมูลเมื่อ {thaiDateTime(meta.generatedAt)}</p>
            <span className="mono">{meta.sources.map((source) => source.name).join(" · ")}</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function NoSourceDocuments({ view, onGo }: { view: ViewId; onGo: (view: ViewId) => void }) {
  const required = [
    { label: "บัญชีแยกประเภท", detail: "ไฟล์ .xlsx ที่มีคอลัมน์ Reservation Creation Time", pattern: "*บัญชีแยกประเภท*.xlsx" },
    { label: "รายงานการรับเงิน", detail: "ไฟล์ .xlsx ที่มีคอลัมน์ Date, Payment Method, Amount", pattern: "*รายงานการรับเงิน*.xlsx" },
    { label: "Statement บัญชี 885", detail: "PDF จาก K BIZ ของช่องทาง KbankGL885", pattern: "885*.pdf" },
    { label: "Statement บัญชี 987", detail: "PDF จาก K BIZ ของช่องทาง KbankGL987", pattern: "987*.pdf" },
  ];

  return (
    <>
      <PageHeading view={view} action={<Pill tone="amber">ยังไม่มีเอกสาร</Pill>} />
      <section className="panel empty-workspace">
        <span className="empty-workspace-mark">↑</span>
        <h2>ระบบพร้อมใช้งาน แต่ยังไม่มีเอกสารต้นทาง</h2>
        <p>
          ระบบอ่านข้อมูลจากโฟลเดอร์ <code>data/</code> ตอน build เท่านั้น ยังไม่มีไฟล์ใดถูกโหลดเข้ามา
          ทุกหน้าที่แสดงตัวเลขจึงยังว่างอยู่
        </p>

        <div className="required-files">
          {required.map((file) => (
            <article key={file.pattern}>
              <span className="check-icon missing">+</span>
              <p><b>{file.label}</b><small>{file.detail}</small></p>
              <code>{file.pattern}</code>
            </article>
          ))}
        </div>

        <div className="empty-workspace-steps">
          <h3>วิธีโหลดข้อมูลเข้าระบบ</h3>
          <ol>
            <li>วางไฟล์ทั้งสี่ไว้ในโฟลเดอร์ <code>data/</code></li>
            <li>รัน <code>npm run data:build</code> เพื่อแปลงเป็นชุดข้อมูล</li>
            <li>deploy ใหม่อีกครั้ง — ทุกหน้าจะมีข้อมูลทันที</li>
          </ol>
          <p className="empty-workspace-note">
            ต้องมีครบทั้งสี่ไฟล์ ถ้าใส่ไม่ครบ build จะหยุดพร้อมบอกว่าขาดไฟล์ใด เพื่อไม่ให้ได้ตัวเลขที่กระทบยอดไม่ครบ
          </p>
        </div>

        <button className="primary-button" onClick={() => onGo("rules")}>ดูกฎการกระทบยอดที่ระบบใช้ →</button>
      </section>
    </>
  );
}

function Overview({ onGo }: { onGo: (view: ViewId) => void }) {
  const receiptTotal = receipts.reduce((sum, receipt) => sum + receipt.amountSatang, 0);
  const inScopeSatang = accounts.reduce((sum, account) => sum + account.receiptSatang, 0);
  const outOfScopeSatang = outOfScope.reduce((sum, item) => sum + item.amountSatang, 0);

  return (
    <>
      <PageHeading
        view="overview"
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

      <section className="metrics-grid">
        <Metric label="ยอดรับเงินทั้งรอบ" value={baht(receiptTotal)} detail={`${receipts.length} รายการจากรายงานการรับเงิน`} tone="blue" />
        <Metric label="อยู่ในขอบเขตกระทบยอด" value={baht(inScopeSatang)} detail={`${summary.inScopeReceipts} รายการ · ช่องทาง KbankGL885 และ KbankGL987`} tone="green" />
        <Metric label="จับคู่สำเร็จ" value={`${summary.matchRate}%`} detail={`${summary.matchedGroups} กลุ่ม · ${baht(summary.matchedSatang)}`} tone={summary.matchRate >= 85 ? "green" : "amber"} badge={`${summary.matchedReceipts} รายการ`} />
        <Metric label="ต้องตรวจสอบ" value={`${summary.exceptionCount} รายการ`} detail={`ฝั่งรับเงิน ${baht(summary.unexplainedReceiptSatang)} · ฝั่งธนาคาร ${baht(summary.unexplainedBankSatang)}`} tone="red" />
      </section>

      <section className="statement-grid">
        {accounts.map((account) => <AccountCard key={account.code} account={account} onOpen={() => onGo("matching")} />)}
      </section>

      <section className="two-column">
        <div className="panel">
          <PanelTitle kicker="Exception breakdown" title="สาเหตุที่จับคู่ไม่ได้" action={<button className="text-button" onClick={() => onGo("exceptions")}>เปิดคิวตรวจสอบ →</button>} />
          <div className="reason-list">
            {Object.entries(exceptions.reduce<Record<string, { count: number; label: string; delta: number }>>((acc, item) => {
              const bucket = acc[item.reason] ?? { count: 0, label: item.label, delta: 0 };
              bucket.count += 1;
              bucket.delta += Math.abs(item.deltaSatang);
              acc[item.reason] = bucket;
              return acc;
            }, {})).sort((a, b) => b[1].count - a[1].count).map(([reason, value]) => (
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
          <div className="coverage-note"><span>i</span><p><b>ช่องทางเหล่านี้อยู่นอกขอบเขตการกระทบยอด</b><small>โฟลเดอร์ data/ มี Statement เฉพาะบัญชี 885 และ 987 ระบบจึงไม่นับช่องทางอื่นเป็นทั้งจับคู่สำเร็จและข้อยกเว้น</small></p></div>
          <div className="coverage-list">
            {outOfScope.map((item) => (
              <div key={item.method}>
                <b>{item.method}</b>
                <span className="coverage-bar"><i style={{ width: `${Math.round((item.amountSatang / (outOfScope[0]?.amountSatang || 1)) * 100)}%` }} /></span>
                <span className="coverage-figures"><b>{baht(item.amountSatang)}</b><small>{item.count} รายการ</small></span>
              </div>
            ))}
          </div>
          <div className="coverage-total"><span><small>รวมนอกขอบเขต</small><b>{baht(outOfScopeSatang)}</b></span><span><small>คิดเป็น</small><b>{receiptTotal ? Math.round((outOfScopeSatang / receiptTotal) * 100) : 0}% ของยอดรับทั้งรอบ</b></span></div>
        </div>
      </section>

      <section className="panel">
        <PanelTitle kicker="Recent matches" title="ตัวอย่างการจับคู่ล่าสุด" action={<button className="text-button" onClick={() => onGo("matching")}>ดูทั้งหมด →</button>} />
        <div className="case-grid">
          {(["1:1", "N:1", "1:N"] as const).map((type) => {
            const group = groups.find((candidate) => candidate.type === type);
            if (!group) return <article className="case-card muted" key={type}><Pill>{type}</Pill><h3>ไม่พบการจับคู่แบบนี้ในรอบนี้</h3></article>;
            return (
              <article className="case-card" key={type}>
                <Pill tone={matchTypeTone[type]}>{type} · MATCHED</Pill>
                <h3>{type === "1:1" ? "หนึ่งรับเงิน = หนึ่งเงินเข้า" : type === "N:1" ? "หลายรับเงิน = หนึ่งเงินเข้า" : "หนึ่งรับเงิน = หลายเงินเข้า"}</h3>
                <div className="equation">
                  {group.receipts.flatMap((receipt, index) => [
                    ...(index > 0 ? [<i key={`${receipt.id}-op`}>＋</i>] : []),
                    <span key={receipt.id}>{baht(receipt.amountSatang)}</span>,
                  ])}
                  <b>=</b>
                  {group.lines.flatMap((line, index) => [
                    ...(index > 0 ? [<i key={`${line.id}-op`}>＋</i>] : []),
                    <span className="bank-value" key={line.id}>{baht(line.amountSatang)}</span>,
                  ])}
                </div>
                <p>สร้างคำจอง {thaiDate(group.date)} · เงินเข้า {thaiDate(group.lines[0].date)} · บัญชี •••{group.account}</p>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function AccountCard({ account, onOpen }: { account: AccountResult; onOpen: () => void }) {
  return (
    <article className="statement-card">
      <div className="statement-head">
        <span><small>KASIKORNBANK · {account.branch}</small><h2>บัญชี •••{account.code}</h2><small className="mono">{account.accountNo} · {account.method}</small></span>
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

function Matching() {
  const [accountFilter, setAccountFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MatchGroup | null>(groups[0] ?? null);

  const visible = groups.filter((group) => {
    if (accountFilter !== "all" && group.account !== accountFilter) return false;
    if (typeFilter !== "all" && group.type !== typeFilter) return false;
    if (!query.trim()) return true;
    const haystack = `${group.id} ${group.date} ${group.receipts.map((receipt) => `${receipt.reservationNo} ${receipt.guest}`).join(" ")} ${group.lines.map((line) => `${line.id} ${line.detail}`).join(" ")}`;
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <>
      <PageHeading view="matching" action={<div className="heading-stats"><span><b>{groups.length}</b><small>กลุ่มที่จับคู่ได้</small></span><span><b>{baht(summary.matchedSatang)}</b><small>ยอดที่ยืนยันแล้ว</small></span></div>} />
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
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขที่จอง ชื่อผู้จอง หรือรหัสกลุ่ม" /></label>
        </div>

        {selected && <MatchEvidence group={selected} onClose={() => setSelected(null)} />}

        <div className="responsive-table scroll-table">
          <table className="statement-match-table">
            <thead>
              <tr><th>วันที่สร้างคำจอง</th><th>รายการรับเงิน</th><th>ยอดรับเงิน</th><th>เงินเข้า Statement</th><th>ยอด Statement</th><th>รูปแบบ</th><th>ผลต่าง</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((group) => (
                <tr key={group.id} className={selected?.id === group.id ? "selected" : ""} onClick={() => setSelected(group)}>
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

function MatchEvidence({ group, onClose }: { group: MatchGroup; onClose: () => void }) {
  return (
    <div className="statement-match-detail">
      <div className="match-detail-head">
        <span><small>หลักฐานการจับคู่แบบตรวจสอบย้อนกลับได้</small><h3>{group.id}</h3></span>
        <span><Pill tone={matchTypeTone[group.type]}>{group.type} · score {group.score}</Pill><button onClick={onClose}>×</button></span>
      </div>

      <div className="date-proof">
        <div><small>วันที่สร้างคำจอง (Ledger)</small><b>{thaiDate(group.date)}</b></div>
        <span className="date-proof-op">=</span>
        <div><small>วันที่เงินเข้า (Statement)</small><b>{thaiDate(group.lines[0].date)}</b></div>
        <Pill tone="green">✓ วันเดียวกัน</Pill>
      </div>

      <div className="match-evidence-grid">
        <div className="booking-allocations">
          <span className="evidence-label">รายการรับเงิน · บัญชีแยกประเภท</span>
          {group.receipts.map((receipt) => (
            <article className="allocation-row" key={receipt.id}>
              <div>
                <b>{receipt.guest || "ไม่ระบุชื่อ"}</b>
                <span className="mono reservation-code">{receipt.reservationNo}</span>
                <small>{receipt.roomType || "—"} · {receipt.method}</small>
              </div>
              <dl>
                <div><dt>สร้างคำจอง</dt><dd><strong>{thaiDateTime(receipt.bookingCreatedAt)}</strong></dd></div>
                <div><dt>สถานะคำจอง</dt><dd>{receipt.bookingStatus || "—"}</dd></div>
                <div><dt>วันที่บันทึกรับเงิน</dt><dd>{thaiDate(receipt.receiptDate)}</dd></div>
                <div><dt>ยอดรับเงิน</dt><dd><strong>{baht(receipt.amountSatang)}</strong></dd></div>
                <div><dt>ยอดจองรวม</dt><dd>{baht(receipt.bookingTotalSatang)}</dd></div>
                <div><dt>แถวต้นทาง</dt><dd className="mono">Collection row {receipt.sourceRow}</dd></div>
              </dl>
            </article>
          ))}
        </div>

        <div className="match-connector"><span>{group.type}</span><b>{group.score}</b><small>match score</small><i>→</i><p>ผลต่าง {baht(group.deltaSatang)}</p></div>

        <div className="booking-allocations">
          <span className="evidence-label">เงินเข้า · Bank statement •••{group.account}</span>
          {group.lines.map((line) => (
            <article className="allocation-row bank" key={line.id}>
              <div>
                <b>{baht(line.amountSatang)}</b>
                <span className="mono reservation-code">{line.id}</span>
                <small>{line.description} · {line.channel}</small>
              </div>
              <dl>
                <div><dt>วันที่ / เวลา</dt><dd><strong>{thaiDate(line.date)} · {line.time}</strong></dd></div>
                <div><dt>รายละเอียด</dt><dd>{line.detail || "—"}</dd></div>
                <div><dt>บัญชี</dt><dd className="mono">{group.accountNo}</dd></div>
                <div><dt>ตำแหน่งต้นฉบับ</dt><dd>Statement หน้า {line.page} · บรรทัด {line.row}</dd></div>
              </dl>
            </article>
          ))}
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

function Exceptions() {
  const [reasonFilter, setReasonFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReconciliationException | null>(exceptions[0] ?? null);

  const reasons = [...new Set(exceptions.map((exception) => exception.reason))];
  const visible = exceptions.filter((exception) => {
    if (reasonFilter !== "all" && exception.reason !== reasonFilter) return false;
    if (accountFilter !== "all" && exception.account !== accountFilter) return false;
    if (!query.trim()) return true;
    return `${exception.id} ${exception.reason} ${exception.reservationNo} ${exception.guest} ${exception.bankLineId}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <>
      <PageHeading view="exceptions" action={<div className="heading-stats"><span><b>{exceptions.length}</b><small>รายการเปิดอยู่</small></span><span><b>{baht(summary.unexplainedReceiptSatang)}</b><small>ยอดรับเงินที่ยังจับคู่ไม่ได้</small></span><span><b>{baht(summary.unexplainedBankSatang)}</b><small>เงินเข้าที่ยังไม่มีรายการรองรับ</small></span></div>} />

      <section className="panel data-panel">
        <div className="statement-toolbar">
          <div className="tabs wrap">
            <button className={reasonFilter === "all" ? "active" : ""} onClick={() => setReasonFilter("all")}>ทั้งหมด <span>{exceptions.length}</span></button>
            {reasons.map((reason) => {
              const count = exceptions.filter((exception) => exception.reason === reason).length;
              return <button key={reason} className={reasonFilter === reason ? "active" : ""} onClick={() => setReasonFilter(reason)}>{exceptions.find((exception) => exception.reason === reason)?.label} <span>{count}</span></button>;
            })}
          </div>
          <div className="tabs compact">
            {[["all", "ทุกบัญชี"], ...accounts.map((account) => [account.code, `•••${account.code}`])].map(([value, label]) => (
              <button key={value} className={accountFilter === value ? "active" : ""} onClick={() => setAccountFilter(value)}>{label}</button>
            ))}
          </div>
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขที่จอง ชื่อ หรือรหัสรายการ" /></label>
        </div>

        {selected && <ExceptionEvidence exception={selected} onClose={() => setSelected(null)} />}

        <div className="responsive-table scroll-table">
          <table>
            <thead>
              <tr><th>รายการ / เหตุผล</th><th>เลขที่จอง</th><th>สร้างคำจอง</th><th>ยอดรับเงิน</th><th>เงินเข้าที่เทียบ</th><th>ผลต่าง</th><th>บัญชี</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((exception) => (
                <tr key={exception.id} className={selected?.id === exception.id ? "selected" : ""} onClick={() => setSelected(exception)}>
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

function ExceptionEvidence({ exception, onClose }: { exception: ReconciliationException; onClose: () => void }) {
  const explanation: Record<string, string> = {
    MISSING_BOOKING: "รายการรับเงินอ้างถึงเลขที่จองที่ไม่มีอยู่ในบัญชีแยกประเภท จึงไม่มีวันที่สร้างคำจองให้เทียบ",
    DATE_RULE_UNMET: "ไม่มีเงินเข้าบัญชีนี้เลยในวันที่สร้างคำจอง กฎข้อ 1 จึงไม่ผ่าน",
    AMOUNT_MISMATCH: "มีเงินเข้าในวันเดียวกัน แต่ไม่มียอดหรือชุดยอดใดรวมแล้วเท่ากับยอดรับเงินพอดี กฎข้อ 2 จึงไม่ผ่าน",
    UNMATCHED_BANK_CREDIT: "เงินเข้ารายการนี้ไม่มีรายการรับเงินที่ผ่านกฎทั้งสองข้อมารองรับ",
    REFUND_LINE: "รายการคืนเงินต้องกระทบกับยอดถอนใน Statement ไม่ใช่ยอดฝาก",
  };

  return (
    <div className="statement-match-detail">
      <div className="match-detail-head">
        <span><small>หลักฐานและเหตุผล</small><h3>{exception.id} · {exception.reason}</h3></span>
        <span><Pill tone={reasonTone[exception.reason] ?? "slate"}>{exception.label}</Pill><button onClick={onClose}>×</button></span>
      </div>

      {exception.receiptId ? (
        <div className={`date-proof ${exception.reason === "AMOUNT_MISMATCH" ? "warned" : "failed"}`}>
          <div><small>วันที่สร้างคำจอง (Ledger)</small><b>{exception.bookingCreatedDate ? thaiDate(exception.bookingCreatedDate) : "ไม่มีข้อมูล"}</b></div>
          <span className="date-proof-op">{exception.reason === "AMOUNT_MISMATCH" ? "=" : "≠"}</span>
          <div><small>วันที่เงินเข้า (Statement)</small><b>{exception.bankDate ? thaiDate(exception.bankDate) : "ไม่พบเงินเข้าในวันนั้น"}</b></div>
          <Pill tone={exception.reason === "AMOUNT_MISMATCH" ? "amber" : "red"}>
            {exception.reason === "AMOUNT_MISMATCH" ? "ผ่านกฎวันที่ · ไม่ผ่านกฎยอด" : "ไม่ผ่านกฎวันที่"}
          </Pill>
        </div>
      ) : (
        <div className="date-proof failed">
          <div><small>เงินเข้า Statement •••{exception.account}</small><b>{thaiDate(exception.bankDate)} · {baht(exception.bankSatang)}</b></div>
          <span className="date-proof-op">≠</span>
          <div><small>รายการรับเงินที่ผ่านกฎทั้งสองข้อ</small><b>ไม่พบ</b></div>
          <Pill tone="blue">ยังไม่มีรายการรองรับ</Pill>
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
          <small>เหตุผลจาก ruleset v{reconciliation.rulesetVersion}</small>
          <b>{explanation[exception.reason]}</b>
          <p>ระบบไม่ปรับยอดและไม่ขยายช่วงวันที่ให้อัตโนมัติ</p>
        </div>
      </div>

      {exception.candidates.length > 0 && (
        <div className="candidate-block">
          <span className="evidence-label">เงินเข้าในวันเดียวกันที่ยังว่างอยู่</span>
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

function Bookings({ receiptsByReservation, receiptIndex, exceptionByReceipt }: {
  receiptsByReservation: Map<string, Receipt[]>;
  receiptIndex: Map<string, { group: MatchGroup; type: string }>;
  exceptionByReceipt: Map<string, ReconciliationException>;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const rows = useMemo(() => bookings.map((booking) => {
    const bookingReceipts = receiptsByReservation.get(booking.reservationNo) ?? [];
    const matched = bookingReceipts.filter((receipt) => receiptIndex.has(receipt.id)).length;
    const inScope = bookingReceipts.filter((receipt) => receiptIndex.has(receipt.id) || exceptionByReceipt.has(receipt.id)).length;
    return { booking, receipts: bookingReceipts, matched, inScope };
  }), [receiptsByReservation, receiptIndex, exceptionByReceipt]);

  const visible = rows.filter((row) => {
    if (statusFilter === "matched" && !(row.inScope > 0 && row.matched === row.inScope)) return false;
    if (statusFilter === "open" && !(row.inScope > 0 && row.matched < row.inScope)) return false;
    if (statusFilter === "outofscope" && row.inScope !== 0) return false;
    if (!query.trim()) return true;
    return `${row.booking.reservationNo} ${row.booking.guest} ${row.booking.roomType} ${row.booking.channel}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  // Open on a booking that actually has receipts, so the detail panel is useful on load.
  const [selected, setSelected] = useState<Booking | null>(
    () => rows.find((row) => row.inScope > 0)?.booking ?? bookings[0] ?? null,
  );
  const selectedRow = visible.find((row) => row.booking.reservationNo === selected?.reservationNo) ?? visible[0];

  return (
    <>
      <PageHeading view="bookings" action={<div className="heading-stats"><span><b>{bookings.length}</b><small>คำจองในบัญชีแยกประเภท</small></span><span><b>{baht(bookings.reduce((sum, booking) => sum + booking.totalSatang, 0))}</b><small>ยอดจองรวม</small></span></div>} />

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
              <tr><th>วันที่สร้างคำจอง</th><th>เลขที่จอง / ผู้จอง</th><th>ห้อง</th><th>สถานะคำจอง</th><th>ยอดจอง</th><th>ชำระแล้ว</th><th>คงค้าง</th><th>กระทบยอด</th><th /></tr>
            </thead>
            <tbody>
              {visible.slice(0, 120).map((row) => (
                <tr key={row.booking.reservationNo} className={selectedRow?.booking.reservationNo === row.booking.reservationNo ? "selected" : ""} onClick={() => setSelected(row.booking)}>
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
  receiptIndex: Map<string, { group: MatchGroup; type: string }>;
  exceptionByReceipt: Map<string, ReconciliationException>;
}) {
  const { booking } = row;
  return (
    <div className="statement-match-detail">
      <div className="match-detail-head">
        <span><small>รายละเอียดคำจอง</small><h3>{booking.guest || "ไม่ระบุชื่อ"}</h3><p className="mono">{booking.reservationNo}</p></span>
        <span><Pill tone={booking.status === "Completed" ? "green" : booking.status === "Cancelled" ? "slate" : "blue"}>{booking.status || "—"}</Pill></span>
      </div>
      <div className="booking-meta-grid">
        <span><small>วันที่สร้างคำจอง</small><b>{thaiDateTime(booking.createdAt)}</b></span>
        <span><small>วันที่ปิดคำจอง</small><b>{thaiDateTime(booking.completedAt)}</b></span>
        <span><small>ห้อง / ประเภท</small><b>{booking.roomNumber} · {booking.roomType}</b></span>
        <span><small>ช่องทาง</small><b>{booking.channel || "—"}</b></span>
        <span><small>จำนวนคืน</small><b>{booking.nights}</b></span>
        <span><small>ผู้บันทึก</small><b>{booking.creator || "—"}</b></span>
      </div>

      <div className="receipt-trace">
        <span className="evidence-label">รายการรับเงินของคำจองนี้ ({row.receipts.length})</span>
        {row.receipts.length === 0 && <p className="table-note">ไม่พบรายการรับเงินในรายงานการรับเงินสำหรับเลขที่จองนี้</p>}
        {row.receipts.map((receipt) => {
          const match = receiptIndex.get(receipt.id);
          const exception = exceptionByReceipt.get(receipt.id);
          const dateRule = match
            ? "ผ่าน · เงินเข้าวันเดียวกัน"
            : exception?.reason === "AMOUNT_MISMATCH"
              ? "ผ่าน · แต่ยอดไม่ตรง"
              : exception
                ? "ไม่ผ่าน"
                : "ไม่ได้ตรวจ (ไม่มี Statement)";
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
  );
}

function Receipts({ receiptIndex, exceptionByReceipt }: {
  receiptIndex: Map<string, { group: MatchGroup; type: string }>;
  exceptionByReceipt: Map<string, ReconciliationException>;
}) {
  const [methodFilter, setMethodFilter] = useState("all");
  const [query, setQuery] = useState("");

  const methods = useMemo(() => {
    const totals = new Map<string, number>();
    for (const receipt of receipts) totals.set(receipt.method, (totals.get(receipt.method) ?? 0) + 1);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const visible = receipts.filter((receipt) => {
    if (methodFilter !== "all" && receipt.method !== methodFilter) return false;
    if (!query.trim()) return true;
    return `${receipt.reservationNo} ${receipt.guest} ${receipt.roomType} ${receipt.group}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <>
      <PageHeading view="receipts" action={<div className="heading-stats"><span><b>{receipts.length}</b><small>แถวจากรายงานการรับเงิน</small></span><span><b>{baht(receipts.reduce((sum, receipt) => sum + receipt.amountSatang, 0))}</b><small>ยอดรวม</small></span></div>} />

      <section className="panel data-panel">
        <div className="statement-toolbar">
          <div className="tabs wrap">
            <button className={methodFilter === "all" ? "active" : ""} onClick={() => setMethodFilter("all")}>ทุกช่องทาง <span>{receipts.length}</span></button>
            {methods.map(([method, count]) => (
              <button key={method} className={methodFilter === method ? "active" : ""} onClick={() => setMethodFilter(method)}>{method || "ไม่ระบุ"} <span>{count}</span></button>
            ))}
          </div>
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขที่จอง ชื่อ หรือกลุ่มบ้านพัก" /></label>
        </div>

        <div className="responsive-table">
          <table>
            <thead>
              <tr><th>วันที่รับเงิน</th><th>เลขที่จอง / ผู้จอง</th><th>ช่องทาง</th><th>บ้านพัก</th><th>ยอด</th><th>เข้าพัก</th><th>สถานะกระทบยอด</th></tr>
            </thead>
            <tbody>
              {visible.slice(0, 150).map((receipt) => {
                const match = receiptIndex.get(receipt.id);
                const exception = exceptionByReceipt.get(receipt.id);
                return (
                  <tr key={receipt.id}>
                    <td><b>{thaiDate(receipt.date)}</b><small className="block mono">{receipt.id}</small></td>
                    <td><b>{receipt.guest || "—"}</b><small className="block mono">{receipt.reservationNo}</small></td>
                    <td>{receipt.method}<small className="block">{receipt.channel}</small></td>
                    <td>{receipt.group}<small className="block">{receipt.roomType}</small></td>
                    <td className={receipt.kind === "REFUND" ? "negative" : ""}><strong>{baht(receipt.amountSatang)}</strong></td>
                    <td>{thaiDate(receipt.checkIn)}<small className="block">ถึง {thaiDate(receipt.checkOut)}</small></td>
                    <td>
                      {match
                        ? <><Pill tone="green">{match.group.type}</Pill><small className="block mono">{match.group.id}</small></>
                        : exception
                          ? <><Pill tone={reasonTone[exception.reason] ?? "red"}>{exception.reason}</Pill><small className="block mono">{exception.id}</small></>
                          : <Pill>นอกขอบเขต</Pill>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visible.length > 150 && <p className="table-note">แสดง 150 จาก {visible.length} รายการ · ใช้ตัวกรองหรือช่องค้นหาเพื่อจำกัดผลลัพธ์</p>}
      </section>
    </>
  );
}

function Statements({ lineIndex }: { lineIndex: Map<string, MatchGroup> }) {
  const [accountCode, setAccountCode] = useState(statements[0]?.code ?? "");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [query, setQuery] = useState("");

  const statement = statements.find((item) => item.code === accountCode) as Statement;
  const matchedCredits = statement.lines.filter((line) => line.direction === "credit" && lineIndex.has(line.id)).length;
  const unmatchedCredits = statement.creditCount - matchedCredits;

  const visible = statement.lines.filter((line: StatementLine) => {
    if (directionFilter === "credit" && line.direction !== "credit") return false;
    if (directionFilter === "debit" && line.direction !== "debit") return false;
    if (directionFilter === "unmatched" && (line.direction !== "credit" || lineIndex.has(line.id))) return false;
    if (!query.trim()) return true;
    return `${line.id} ${line.detail} ${line.description} ${line.channel}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <>
      <PageHeading view="statements" action={<Pill tone={statement.controlDeltaSatang === 0 ? "green" : "red"}>Control total {statement.controlDeltaSatang === 0 ? "ผ่าน" : baht(statement.controlDeltaSatang)}</Pill>} />

      <section className="statement-grid">
        {accounts.map((item) => <AccountCard key={item.code} account={item} onOpen={() => setAccountCode(item.code)} />)}
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
              ["unmatched", `ยังไม่จับคู่ (${unmatchedCredits})`],
            ].map(([value, label]) => (
              <button key={value} className={directionFilter === value ? "active" : ""} onClick={() => setDirectionFilter(value)}>{label}</button>
            ))}
          </div>
          <label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหารายละเอียดหรือช่องทาง" /></label>
        </div>

        <div className="responsive-table">
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
                      {line.direction === "debit"
                        ? <Pill>เงินออก</Pill>
                        : group
                          ? <><Pill tone="green">{group.type}</Pill><small className="block mono">{group.id}</small></>
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

function Rules() {
  return (
    <>
      <PageHeading view="rules" action={<Pill tone="green">Active · v{reconciliation.rulesetVersion}</Pill>} />
      <RuleBanner />

      <section className="rules-grid">
        <div className="panel">
          <PanelTitle kicker="Rule sequence" title="ลำดับกฎที่ระบบใช้" />
          <div className="rule-sequence">
            {[
              ["R01", "วันที่สร้างคำจอง = วันที่เงินเข้า Statement", "เทียบเป็นวันปฏิทินเดียวกัน ไม่มี date window", "BLOCK"],
              ["R02", "ยอดต้องตรงกันพอดี", "ผลต่างต้องเป็น ฿0.00 ไม่มี tolerance", "BLOCK"],
              ["R03", "จับคู่ 1:1", "หนึ่งรายการรับเงิน = หนึ่งยอดเงินเข้า", "100"],
              ["R04", "จับคู่ N:1", "ผลรวมหลายรายการรับเงินวันเดียวกัน = หนึ่งยอดเงินเข้า", "95"],
              ["R05", "จับคู่ 1:N", "หนึ่งรายการรับเงิน = ผลรวมหลายยอดเงินเข้าวันเดียวกัน", "92"],
              ["R06", "ที่เหลือเป็นข้อยกเว้น", "ไม่ปรับยอด ไม่ขยายวัน ไม่แก้ข้อมูลต้นฉบับ", "BLOCK"],
            ].map((rule) => (
              <div key={rule[0]}>
                <span>{rule[0]}</span>
                <p><b>{rule[1]}</b><small>{rule[2]}</small></p>
                <em className={rule[3] === "BLOCK" ? "block" : ""}>{rule[3]}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <PanelTitle kicker="Source files" title="ไฟล์ต้นฉบับในโฟลเดอร์ data/" />
          <div className="source-list">
            {meta.sources.map((source) => (
              <div key={source.name}>
                <span className={`file-icon ${source.name.endsWith(".pdf") ? "pdf" : "sheet"}`}>{source.name.endsWith(".pdf") ? "P" : "X"}</span>
                <p><b>{source.name}</b><small>{sourceLabels[source.kind] ?? source.kind}</small></p>
                <em>{source.rows.toLocaleString("en-US")} แถว</em>
              </div>
            ))}
          </div>
          <div className="coverage-note"><span>i</span><p><b>สร้างชุดข้อมูลด้วยคำสั่ง npm run data:build</b><small>สคริปต์อ่านไฟล์ทั้งหมดใน data/ แล้วสร้าง lib/dataset.generated.json ระบบไม่มีข้อมูลตัวอย่างหรือข้อมูลที่พิมพ์ไว้ล่วงหน้า</small></p></div>
        </div>
      </section>

      <section className="panel data-panel">
        <PanelTitle kicker="Control totals" title="การตรวจยอดคุมของแต่ละบัญชี" />
        <div className="responsive-table">
          <table>
            <thead>
              <tr><th>บัญชี</th><th>เลขที่บัญชี</th><th>ช่องทางรับเงิน</th><th>ยอดยกมา</th><th>ยอดฝาก</th><th>ยอดถอน</th><th>ยอดยกไป</th><th>ผลต่าง</th></tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.code}>
                  <td><b>•••{account.code}</b><small className="block">{account.branch}</small></td>
                  <td className="mono">{account.accountNo}</td>
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
    </>
  );
}
