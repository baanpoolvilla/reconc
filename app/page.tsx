"use client";

import { type ReactNode, useMemo, useState } from "react";

type ViewId = "overview" | "uploads" | "runs" | "review" | "reservations" | "statements" | "invoices" | "ota" | "audit" | "rules";
type Tone = "green" | "blue" | "amber" | "red" | "slate";
type ExceptionItem = {
  id: string; reason: string; title: string; reservation: string; source: string; target: string;
  delta: string; age: string; severity: "สูง" | "กลาง" | "ต่ำ"; status: "ต้องตรวจสอบ" | "รอเอกสาร" | "มอบหมายแล้ว"; owner: string;
};

const navGroups: { label: string; items: { id: ViewId; label: string; icon: string; badge?: string }[] }[] = [
  { label: "งานประจำวัน", items: [
    { id: "overview", label: "ภาพรวม", icon: "⌂" }, { id: "uploads", label: "ศูนย์นำเข้า", icon: "↑", badge: "P1" },
    { id: "runs", label: "รอบกระทบยอด", icon: "↔" }, { id: "review", label: "คิวตรวจสอบ", icon: "!", badge: "49" },
  ] },
  { label: "ข้อมูลบัญชี", items: [
    { id: "reservations", label: "รายการจอง", icon: "#" }, { id: "statements", label: "รายการเดินบัญชี", icon: "▤", badge: "P2" },
    { id: "invoices", label: "เอกสารภาษี", icon: "□", badge: "P3" }, { id: "ota", label: "OTA Settlement", icon: "◎", badge: "P4" },
  ] },
  { label: "ควบคุมระบบ", items: [
    { id: "audit", label: "ประวัติการทำงาน", icon: "◷" }, { id: "rules", label: "กฎและการตั้งค่า", icon: "⚙" },
  ] },
];

const titles: Record<ViewId, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: "ภาพรวมรอบบัญชี", title: "เห็นทุกยอดต่าง ก่อนปิดบัญชี", description: "กรกฎาคม 2569 · อัปเดตจากข้อมูล 4 แหล่ง · ruleset v1.0.0" },
  uploads: { eyebrow: "Phase 1 · Ingestion", title: "ศูนย์นำเข้าเอกสาร", description: "รับไฟล์ ตรวจซ้ำ ทำ Control checks และติดตามทุกขั้นตอนในที่เดียว" },
  runs: { eyebrow: "Reconciliation Engine", title: "รอบกระทบยอด", description: "ผลการจับคู่แบบ 1:1, N:1 และ 1:N พร้อมเหตุผลที่ตรวจสอบย้อนกลับได้" },
  review: { eyebrow: "Exception Workflow", title: "คิวตรวจสอบข้อยกเว้น", description: "ตัดสินใจจากหลักฐานสองฝั่ง โดยไม่แก้ไขข้อมูลต้นฉบับ" },
  reservations: { eyebrow: "Canonical Finance Data", title: "รายการจองและการรับเงิน", description: "มุมมองเดียวของ receipt, ledger, bank และ invoice ต่อเลขที่จอง" },
  statements: { eyebrow: "Phase 2 · Bank Reconciliation", title: "รายการเดินบัญชีธนาคาร", description: "Control total, classification และการจับคู่ยอดฝากสำหรับบัญชี 885 และ 987" },
  invoices: { eyebrow: "Phase 3 · Invoice", title: "ศูนย์เอกสารภาษี", description: "สร้าง อนุมัติ ออก ส่ง และควบคุมเวอร์ชันเอกสารจากยอดที่กระทบแล้ว" },
  ota: { eyebrow: "Phase 4 · OTA Settlement", title: "กระทบยอด OTA แบบสามทาง", description: "Booking ↔ Settlement line ↔ Bank payout พร้อมแยก commission และ refund" },
  audit: { eyebrow: "Governance", title: "ประวัติการทำงาน", description: "ทุกการอนุมัติ แก้ mapping ออกเอกสาร และนำเข้าไฟล์มีหลักฐานครบถ้วน" },
  rules: { eyebrow: "Ruleset v1.0.0", title: "กฎและการตั้งค่า", description: "กำหนด tolerance, date window, score และ payment mapping แบบ versioned" },
};

const initialExceptions: ExceptionItem[] = [
  { id: "EX-00042", reason: "AMOUNT_MISMATCH", title: "ยอดรับเงินไม่ตรงกับยอดฝากธนาคาร", reservation: "10862708254763192824", source: "฿4,000.00", target: "฿380.00", delta: "฿3,620.00", age: "2 ชม.", severity: "สูง", status: "ต้องตรวจสอบ", owner: "ยังไม่มอบหมาย" },
  { id: "EX-00041", reason: "METHOD_MISMATCH", title: "ช่องทางรับเงินต่างกัน แต่ยอดรวมตรงกัน", reservation: "10578393061567240019", source: "฿12,600.00", target: "฿12,600.00", delta: "฿0.00", age: "4 ชม.", severity: "กลาง", status: "มอบหมายแล้ว", owner: "ศิริพร" },
  { id: "EX-00039", reason: "MISSING_RESERVATION", title: "ไม่พบเลขที่จองในบัญชีแยกประเภท", reservation: "10900237654890017264", source: "฿5,500.00", target: "—", delta: "฿5,500.00", age: "1 วัน", severity: "กลาง", status: "รอเอกสาร", owner: "กิตติยา" },
  { id: "EX-00038", reason: "INVALID_ROW", title: "ข้อมูลแถวต้นทางไม่สมบูรณ์", reservation: "ไม่ระบุ", source: "—", target: "—", delta: "—", age: "1 วัน", severity: "ต่ำ", status: "ต้องตรวจสอบ", owner: "ยังไม่มอบหมาย" },
];

const initialDocuments = [
  { name: "Collection_Report_Jul_2026.xlsx", type: "รายงานรับเงิน", rows: "387 แถว", status: "เผยแพร่แล้ว", control: "ผ่าน", time: "วันนี้ 13:42" },
  { name: "Ledger_Jul_2026.xlsx", type: "บัญชีแยกประเภท", rows: "854 payment lines", status: "เผยแพร่แล้ว", control: "ผ่าน", time: "วันนี้ 13:38" },
  { name: "KBank_885_Jul_2026.pdf", type: "Bank Statement", rows: "52 รายการ", status: "กระทบยอดแล้ว", control: "฿0.00", time: "วันนี้ 13:31" },
  { name: "KBank_987_Jul_2026.pdf", type: "Bank Statement", rows: "122 รายการ", status: "กระทบยอดแล้ว", control: "฿0.00", time: "วันนี้ 13:25" },
  { name: "Booking_Settlement_0726.csv", type: "OTA Settlement", rows: "39 bookings", status: "ตรวจสอบแล้ว", control: "ผ่าน", time: "เมื่อวาน 17:06" },
];

const runRows = [
  { id: "RUN-0726-004", phase: "P1", name: "Receipt ↔ Ledger", sources: "526 กลุ่ม", matched: "477", exception: "49", rate: "90.7%", status: "เสร็จแล้ว", tone: "green" as Tone },
  { id: "RUN-0726-003", phase: "P2", name: "KBank •••885 ↔ Receipt", sources: "52 receipts", matched: "51", exception: "1", rate: "98.1%", status: "มีข้อยกเว้น", tone: "amber" as Tone },
  { id: "RUN-0726-002", phase: "P2", name: "KBank •••987 ↔ Receipt", sources: "97 receipts", matched: "77", exception: "20", rate: "79.4%", status: "กำลังตรวจ", tone: "blue" as Tone },
  { id: "RUN-0726-001", phase: "P4", name: "OTA three-way settlement", sources: "69 bookings", matched: "66", exception: "3", rate: "95.7%", status: "เสร็จแล้ว", tone: "green" as Tone },
];

const reservations = [
  { id: "10862708254763192824", guest: "คุณอรทัย ศรีสุข", stay: "26–28 ก.ค. 2569", method: "KbankGL885", receipt: "฿4,000.00", ledger: "฿4,000.00", bank: "฿380.00", status: "ยอดต่าง" },
  { id: "10578393061567240019", guest: "Mr. Daniel Wong", stay: "24–27 ก.ค. 2569", method: "Trip Collect", receipt: "฿12,600.00", ledger: "฿12,600.00", bank: "OTA batch", status: "จับคู่แล้ว" },
  { id: "10158230476834210083", guest: "คุณนภัสสร อินทร์แก้ว", stay: "25–26 ก.ค. 2569", method: "KbankGL885", receipt: "฿6,450.00", ledger: "฿6,450.00", bank: "฿6,450.00", status: "Grouped match" },
  { id: "10377124987002561170", guest: "Ms. Amelia Chen", stay: "18–21 ก.ค. 2569", method: "Booking Collect", receipt: "฿18,900.00", ledger: "฿18,900.00", bank: "OTA batch", status: "จับคู่แล้ว" },
];

const initialInvoices = [
  { id: "INV-0042", no: "RC-2569-00042", customer: "บริษัท ทราเวลเวิร์ค จำกัด", reservation: "10578393061567240019", total: "฿12,600.00", status: "รออนุมัติ", sent: "—" },
  { id: "INV-0041", no: "RC-2569-00041", customer: "Mr. Daniel Wong", reservation: "10377124987002561170", total: "฿18,900.00", status: "ส่งแล้ว", sent: "31 ก.ค. 14:02" },
  { id: "INV-0040", no: "RC-2569-00040", customer: "คุณนภัสสร อินทร์แก้ว", reservation: "10158230476834210083", total: "฿6,450.00", status: "ออกแล้ว", sent: "รอส่ง" },
  { id: "INV-0039", no: "RC-2569-00039", customer: "Trip.com Travel Singapore", reservation: "OTA-TRIP-0726", total: "฿72,800.00", status: "ร่าง", sent: "—" },
];

const audits = [
  { time: "14:28:12", actor: "สุวรรณา ว.", action: "อนุมัติ grouped match", entity: "GRP-00645", detail: "฿500 + ฿5,950 ↔ ฿6,450", tone: "green" as Tone },
  { time: "14:16:44", actor: "ศิริพร", action: "มอบหมายข้อยกเว้น", entity: "EX-00041", detail: "METHOD_MISMATCH → กิตติยา", tone: "blue" as Tone },
  { time: "14:02:09", actor: "ระบบ", action: "ส่งใบเสร็จสำเร็จ", entity: "RC-2569-00041", detail: "provider message: msg_71842", tone: "green" as Tone },
  { time: "13:42:31", actor: "สุวรรณา ว.", action: "นำเข้าเอกสาร", entity: "DOC-0087", detail: "Collection_Report_Jul_2026.xlsx", tone: "slate" as Tone },
  { time: "13:42:33", actor: "ระบบ", action: "Control check ผ่าน", entity: "BATCH-0031", detail: "636 valid · 1 invalid · duplicate 0", tone: "green" as Tone },
  { time: "13:31:18", actor: "ระบบ", action: "สร้าง exception", entity: "EX-00042", detail: "AMOUNT_MISMATCH · delta ฿3,620.00", tone: "red" as Tone },
];

function Pill({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) { return <span className={`pill ${tone}`}>{children}</span>; }
function PageHeading({ view, action }: { view: ViewId; action?: ReactNode }) {
  const copy = titles[view];
  return <div className="page-heading"><div><span className="page-eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>{action}</div>;
}
function Metric({ label, value, detail, tone = "slate", badge }: { label: string; value: string; detail: string; tone?: Tone; badge?: string }) {
  return <article className="metric-card"><div><span>{label}</span>{badge && <Pill tone={tone}>{badge}</Pill>}</div><strong>{value}</strong><p>{detail}</p><i className={`metric-line ${tone}`} /></article>;
}

export default function Home() {
  const [active, setActive] = useState<ViewId>("overview");
  const [exceptions, setExceptions] = useState(initialExceptions);
  const [selectedException, setSelectedException] = useState<ExceptionItem | null>(initialExceptions[0]);
  const [exceptionFilter, setExceptionFilter] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [documents, setDocuments] = useState(initialDocuments);
  const [invoices, setInvoices] = useState(initialInvoices);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState("");

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const go = (view: ViewId) => { setActive(view); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const filteredExceptions = useMemo(() => exceptions.filter((item) => {
    const statusMatch = exceptionFilter === "ทั้งหมด" || item.status === exceptionFilter;
    return statusMatch && `${item.id} ${item.reason} ${item.title} ${item.reservation}`.toLowerCase().includes(search.toLowerCase());
  }), [exceptions, exceptionFilter, search]);

  const resolveException = async (item: ExceptionItem) => {
    setExceptions((current) => current.filter((candidate) => candidate.id !== item.id));
    setSelectedException(null);
    notify(`${item.id} ถูกบันทึกว่าแก้ไขแล้ว`);
    fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resolve_exception", id: item.id, value: "approved_match" }) }).catch(() => undefined);
  };

  const issueInvoice = async (id: string) => {
    setInvoices((current) => current.map((invoice) => invoice.id === id ? { ...invoice, status: "ออกแล้ว", sent: "รอส่ง" } : invoice));
    notify("ออกเอกสารและสร้างเวอร์ชัน PDF แล้ว");
    fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "issue_invoice", id }) }).catch(() => undefined);
  };

  const uploadDocument = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || !file.name) { notify("กรุณาเลือกไฟล์ก่อนดำเนินการ"); return; }
    setUploading(true);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: data });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Upload failed");
      setDocuments((current) => [{ name: file.name, type: String(data.get("documentType")), rows: "กำลังประมวลผล", status: "เข้าคิวแล้ว", control: "รอตรวจ", time: "เมื่อสักครู่" }, ...current]);
      setUploadOpen(false); notify("อัปโหลดสำเร็จและส่งเข้าคิวประมวลผลแล้ว"); form.reset();
    } catch (error) { notify(error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ"); }
    finally { setUploading(false); }
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => go("overview")}><span className="brand-mark"><i /><i /><i /></span><span><b>ClearClose</b><small>ACCOUNT OPERATIONS</small></span></button>
      <button className="org-switcher"><span>SA</span><span><b>Smart Order</b><small>บริษัท สบายดี จำกัด</small></span><i>⌄</i></button>
      <nav aria-label="เมนูหลัก">{navGroups.map((group) => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => go(item.id)}><span className="nav-icon">{item.icon}</span><b>{item.label}</b>{item.badge && <em>{item.badge}</em>}</button>)}</div>)}</nav>
      <div className="sidebar-status"><p><span /> ระบบพร้อมใช้งาน</p><button><span>สว</span><span><b>สุวรรณา ว.</b><small>ผู้ดูแลระบบ</small></span><i>•••</i></button></div>
    </aside>
    <main>
      <header className="topbar"><div className="topbar-brand"><span className="brand-mark"><i /><i /><i /></span><b>ClearClose</b></div><div className="period"><small>รอบบัญชี</small><button>1–31 ก.ค. 2569 <b>⌄</b></button></div><div className="top-actions"><span className="live-state"><i /> LIVE STORAGE</span><button className="square-button" aria-label="ค้นหา">⌕</button><button className="square-button alert" aria-label="แจ้งเตือน">○<i /></button><button className="primary-button" onClick={() => setUploadOpen(true)}>＋ นำเข้าเอกสาร</button></div></header>
      <div className="content">
        {active === "overview" && <Overview onGo={go} onUpload={() => setUploadOpen(true)} />}
        {active === "uploads" && <Uploads documents={documents} onUpload={() => setUploadOpen(true)} />}
        {active === "runs" && <Runs />}
        {active === "review" && <Review exceptions={filteredExceptions} allCount={exceptions.length} filter={exceptionFilter} setFilter={setExceptionFilter} search={search} setSearch={setSearch} selected={selectedException} setSelected={setSelectedException} onResolve={resolveException} />}
        {active === "reservations" && <Reservations />}
        {active === "statements" && <Statements />}
        {active === "invoices" && <Invoices invoices={invoices} onIssue={issueInvoice} notify={notify} />}
        {active === "ota" && <Ota />}
        {active === "audit" && <Audit />}
        {active === "rules" && <Rules notify={notify} />}
        <footer><span>ClearClose · ruleset v1.0.0</span><p>Asia/Bangkok · ข้อมูลสาธิตจากรอบ กรกฎาคม 2569</p><button onClick={() => notify("เปิดศูนย์ช่วยเหลือแล้ว")}>ศูนย์ช่วยเหลือ ↗</button></footer>
      </div>
    </main>
    {uploadOpen && <UploadModal busy={uploading} onClose={() => setUploadOpen(false)} onSubmit={uploadDocument} />}
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </div>;
}

function Overview({ onGo, onUpload }: { onGo: (view: ViewId) => void; onUpload: () => void }) {
  return <>
    <PageHeading view="overview" action={<div className="readiness"><span className="readiness-ring"><b>87</b><small>%</small></span><span><small>ความพร้อมปิดบัญชี</small><b>ใกล้พร้อมตรวจทาน</b><p>เหลือ 49 รายการที่ต้องจัดการ</p></span></div>} />
    <section className="metrics-grid"><Metric label="ยอดรับสุทธิ" value="฿2,274,426.29" detail="จากรายงานรับเงิน 387 รายการ" tone="blue" badge="↗ 12.4%" /><Metric label="จับคู่สำเร็จ" value="90.7%" detail="477 จาก 526 กลุ่มรายการ" tone="green" badge="เป้าหมาย 95%" /><Metric label="รอตรวจสอบ" value="49 กลุ่ม" detail="ยอดผลต่างรวม ฿9,120.00" tone="amber" badge="สูง 1" /><Metric label="Control checks" value="3/3 ผ่าน" detail="Ledger · Statement 885 · 987" tone="green" badge="สมดุล" /></section>
    <section className="phase-strip">{[
      ["01", "Ingestion & Ledger", "รับไฟล์และจับคู่ Receipt ↔ Ledger", "เสร็จแล้ว", "green"], ["02", "Bank 885 / 987", "จับคู่ 1:1 และ grouped match", "98.1%", "blue"],
      ["03", "Invoice", "ออกและส่งเอกสารจากยอดที่ยืนยัน", "3 รอดำเนินการ", "amber"], ["04", "OTA Settlement", "กระทบยอด Booking / Trip / Airbnb", "95.7%", "green"],
    ].map((phase) => <button key={phase[0]} onClick={() => onGo(phase[0] === "01" ? "uploads" : phase[0] === "02" ? "statements" : phase[0] === "03" ? "invoices" : "ota")}><span>{phase[0]}</span><p><b>{phase[1]}</b><small>{phase[2]}</small></p><Pill tone={phase[4] as Tone}>{phase[3]}</Pill></button>)}</section>
    <section className="two-column"><div className="panel"><PanelTitle kicker="Reconciliation" title="สถานะการจับคู่ล่าสุด" action={<button className="text-button" onClick={() => onGo("runs")}>ดูทั้งหมด →</button>} /><RunTable compact /><div className="success-note"><span>✓</span><p><b>Grouped match ที่ตรวจพบ</b><small>฿500 + ฿5,950 จับคู่กับยอดฝาก ฿6,450 ด้วยกฎ N:1</small></p><Pill tone="green">score 92</Pill></div></div><div className="panel"><PanelTitle kicker="Next actions" title="งานที่ควรทำต่อ" /><div className="task-list"><button onClick={() => onGo("review")}><span className="task-icon red">!</span><p><b>ตรวจยอดต่าง ฿3,620.00</b><small>EX-00042 · SLA เหลือ 6 ชั่วโมง</small></p><strong>ตรวจสอบ →</strong></button><button onClick={() => onGo("invoices")}><span className="task-icon amber">□</span><p><b>อนุมัติเอกสารภาษี 3 ฉบับ</b><small>ยอดรวม ฿37,950.00</small></p><strong>เปิดคิว →</strong></button><button onClick={() => onGo("ota")}><span className="task-icon blue">◎</span><p><b>ตรวจ OTA settlement 3 รายการ</b><small>Booking.com และ Trip.com</small></p><strong>ตรวจสอบ →</strong></button><button onClick={onUpload}><span className="task-icon slate">↑</span><p><b>Statement Kbank-Posh ยังไม่ครบ</b><small>ต้องใช้เพื่อปิดทุก payment method</small></p><strong>นำเข้า →</strong></button></div></div></section>
  </>;
}

function Uploads({ documents, onUpload }: { documents: typeof initialDocuments; onUpload: () => void }) {
  return <><PageHeading view="uploads" action={<button className="primary-button large" onClick={onUpload}>＋ นำเข้าเอกสารใหม่</button>} /><section className="metrics-grid three"><Metric label="เอกสารในรอบนี้" value="5 ไฟล์" detail="นำเข้าสำเร็จทั้งหมด" tone="green" badge="ไม่ซ้ำ" /><Metric label="ข้อมูลที่เผยแพร่" value="1,652 แถว" detail="canonical records พร้อมใช้" tone="blue" badge="100% valid" /><Metric label="เวลาประมวลผลเฉลี่ย" value="18 วินาที" detail="Parse · Validate · Publish" tone="slate" badge="SLA < 2 นาที" /></section><section className="panel pipeline-panel"><PanelTitle kicker="Processing pipeline" title="สถานะงานนำเข้า" /><div className="pipeline">{["Uploaded", "Parsing", "Validating", "Published", "Reconciling", "Completed"].map((step, index) => <div key={step} className="done"><span>{index < 5 ? "✓" : "6"}</span><b>{step}</b><small>{index === 0 ? "SHA-256 + MIME" : index === 1 ? "parser v1.3.0" : index === 2 ? "control ฿0.00" : index === 3 ? "1,652 rows" : index === 4 ? "ruleset v1.0.0" : "13:42:51"}</small></div>)}</div></section><section className="panel data-panel"><PanelTitle kicker="Documents" title="เอกสารทั้งหมด" action={<div className="table-actions"><button>☷ ตัวกรอง</button><button>⇩ Export log</button></div>} /><div className="responsive-table"><table><thead><tr><th>ชื่อไฟล์</th><th>ประเภท</th><th>ข้อมูล</th><th>Control</th><th>สถานะ</th><th>เวลานำเข้า</th><th /></tr></thead><tbody>{documents.map((doc) => <tr key={`${doc.name}-${doc.time}`}><td><span className={`file-icon ${doc.name.endsWith(".pdf") ? "pdf" : doc.name.endsWith(".csv") ? "csv" : "sheet"}`}>{doc.name.endsWith(".pdf") ? "P" : doc.name.endsWith(".csv") ? "C" : "X"}</span><b>{doc.name}</b></td><td>{doc.type}</td><td>{doc.rows}</td><td><Pill tone={doc.control === "ผ่าน" || doc.control === "฿0.00" ? "green" : "amber"}>{doc.control}</Pill></td><td>{doc.status}</td><td>{doc.time}</td><td><button className="row-button">›</button></td></tr>)}</tbody></table></div></section></>;
}

function Runs() { return <><PageHeading view="runs" action={<button className="secondary-button">⟳ รันใหม่ด้วย ruleset ล่าสุด</button>} /><section className="metrics-grid"><Metric label="รอบทั้งหมด" value="4 รอบ" detail="ครอบคลุม Phase 1, 2 และ 4" tone="blue" /><Metric label="รายการที่จับคู่" value="671" detail="จาก candidate ทั้งหมด 741" tone="green" /><Metric label="Grouped matches" value="12 กลุ่ม" detail="N:1 จำนวน 8 · 1:N จำนวน 4" tone="green" /><Metric label="คะแนนเฉลี่ย" value="94.2" detail="Auto-match threshold ≥ 85" tone="amber" /></section><section className="panel data-panel"><PanelTitle kicker="Run history" title="ผลการกระทบยอด" action={<button className="text-button">เปรียบเทียบรอบ →</button>} /><RunTable /></section><section className="case-grid"><article className="case-card"><Pill tone="green">N:1 · MATCHED</Pill><h3>หลาย Receipt → Bank เดียว</h3><div className="equation"><span>฿500</span><i>＋</i><span>฿5,950</span><b>=</b><span className="bank-value">฿6,450</span></div><p>reservation เดียวกัน · วันที่ธนาคาร +1 วัน · score 92</p></article><article className="case-card"><Pill tone="green">1:N · MATCHED</Pill><h3>Receipt เดียว → หลาย Bank</h3><div className="equation"><span className="bank-value">฿8,900</span><b>=</b><span>฿5,900</span><i>＋</i><span>฿3,000</span></div><p>sender เดียวกัน · exact total · score 90</p></article><article className="case-card danger"><Pill tone="red">EXCEPTION</Pill><h3>ยอดต่าง ห้ามปรับอัตโนมัติ</h3><div className="equation"><span>฿4,000</span><b>≠</b><span>฿380</span><i>→</i><span className="delta-value">฿3,620</span></div><p>AMOUNT_MISMATCH · ส่งเข้าคิวตรวจสอบ</p></article></section></>;
}

function Review({ exceptions, allCount, filter, setFilter, search, setSearch, selected, setSelected, onResolve }: { exceptions: ExceptionItem[]; allCount: number; filter: string; setFilter: (value: string) => void; search: string; setSearch: (value: string) => void; selected: ExceptionItem | null; setSelected: (value: ExceptionItem | null) => void; onResolve: (value: ExceptionItem) => void }) {
  return <><PageHeading view="review" action={<div className="heading-stats"><span><b>{allCount}</b><small>รายการเปิด</small></span><span><b>฿9,120</b><small>ยอดผลต่าง</small></span></div>} /><section className="panel data-panel"><div className="review-toolbar"><div className="tabs">{["ทั้งหมด", "ต้องตรวจสอบ", "รอเอกสาร", "มอบหมายแล้ว"].map((name) => <button key={name} className={filter === name ? "active" : ""} onClick={() => setFilter(name)}>{name}{name === "ทั้งหมด" && <span>{allCount}</span>}</button>)}</div><label className="search-box">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาเลขที่จอง รหัส หรือเหตุผล" /></label></div><div className="responsive-table"><table><thead><tr><th>รายการ / เหตุผล</th><th>เลขที่จอง</th><th>ยอดต้นทาง</th><th>ยอดที่เทียบ</th><th>ผลต่าง</th><th>อายุ</th><th>ผู้รับผิดชอบ</th><th /></tr></thead><tbody>{exceptions.map((item) => <tr key={item.id} className={selected?.id === item.id ? "selected" : ""}><td><div className="reason"><span className={`severity ${item.severity === "สูง" ? "high" : item.severity === "กลาง" ? "medium" : "low"}`}>{item.severity === "สูง" ? "!" : item.severity === "กลาง" ? "•" : "i"}</span><span><b>{item.title}</b><small>{item.id} · {item.reason}</small></span></div></td><td className="mono">{item.reservation}</td><td>{item.source}</td><td>{item.target}</td><td className={item.delta !== "฿0.00" && item.delta !== "—" ? "negative" : ""}>{item.delta}</td><td>{item.age}</td><td>{item.owner}</td><td><button className="row-button" onClick={() => setSelected(item)}>›</button></td></tr>)}</tbody></table></div>{exceptions.length === 0 && <div className="empty-state"><span>✓</span><h3>ไม่มีรายการในตัวกรองนี้</h3><p>ลองเปลี่ยนสถานะหรือคำค้นหา</p></div>}{selected && <div className="evidence"><div className="evidence-header"><span><small>หลักฐานการจับคู่</small><b>{selected.id} · {selected.reason}</b></span><button onClick={() => setSelected(null)}>×</button></div><div className="evidence-grid"><article><small>รายงานรับเงิน</small><b>{selected.source}</b><p>26 ก.ค. 2569 · KbankGL885</p></article><span className="not-equal">≠<small>ผลต่าง<br /><b>{selected.delta}</b></small></span><article><small>รายการธนาคาร</small><b>{selected.target}</b><p>26 ก.ค. 2569 · Transfer</p></article><div className="rule-box"><small>กฎที่ทำงาน</small><b>ยอดต่างต้องเป็น 0.00</b><p>ระบบจะไม่ปรับยอดอัตโนมัติ</p></div><div className="evidence-actions"><button className="secondary-button">ขอเอกสาร</button><button className="primary-button" onClick={() => onResolve(selected)}>อนุมัติการแก้ไข</button></div></div></div>}</section></>;
}

function Reservations() { const [selected, setSelected] = useState(reservations[0]); return <><PageHeading view="reservations" action={<label className="search-box wide">⌕<input placeholder="ค้นหาเลขที่จอง ชื่อลูกค้า หรือยอดเงิน" /></label>} /><section className="master-detail"><div className="panel reservation-list"><div className="list-header"><b>665 รายการจอง</b><button>☷ ตัวกรอง</button></div>{reservations.map((item) => <button key={item.id} className={selected.id === item.id ? "active" : ""} onClick={() => setSelected(item)}><span><b>{item.guest}</b><small className="mono">{item.id}</small><small>{item.stay} · {item.method}</small></span><span><b>{item.receipt}</b><Pill tone={item.status === "ยอดต่าง" ? "red" : item.status === "Grouped match" ? "blue" : "green"}>{item.status}</Pill></span></button>)}</div><div className="panel reservation-detail"><PanelTitle kicker="Reservation detail" title={selected.guest} action={<Pill tone={selected.status === "ยอดต่าง" ? "red" : "green"}>{selected.status}</Pill>} /><div className="reservation-meta"><span><small>Reservation No.</small><b className="mono">{selected.id}</b></span><span><small>วันเข้าพัก</small><b>{selected.stay}</b></span><span><small>Payment method</small><b>{selected.method}</b></span></div><div className="money-flow"><article><small>Receipt</small><b>{selected.receipt}</b><span>รายงานรับเงิน</span></article><i>→</i><article><small>Ledger</small><b>{selected.ledger}</b><span>บัญชีแยกประเภท</span></article><i>→</i><article className={selected.status === "ยอดต่าง" ? "mismatch" : ""}><small>Bank / Settlement</small><b>{selected.bank}</b><span>{selected.status === "ยอดต่าง" ? "ผลต่าง ฿3,620.00" : "ยืนยันแล้ว"}</span></article></div><div className="timeline"><h3>ลำดับเหตุการณ์</h3>{["สร้างรายการจองใน Smart Order", "บันทึกรับเงินและนำเข้า Ledger", "กระทบยอดด้วย ruleset v1.0.0", selected.status === "ยอดต่าง" ? "สร้าง AMOUNT_MISMATCH" : "ยืนยันการจับคู่สำเร็จ"].map((event, index) => <div key={event}><span className={index === 3 && selected.status === "ยอดต่าง" ? "danger" : ""}>{index + 1}</span><p><b>{event}</b><small>{25 + index} ก.ค. 2569 · {10 + index}:24 น.</small></p></div>)}</div></div></section></>;
}

function Statements() { return <><PageHeading view="statements" action={<button className="primary-button large">＋ นำเข้า Statement</button>} /><section className="statement-grid"><StatementCard suffix="885" opening="฿4,887.33" credit="฿208,590.00" debit="฿6,000.00" closing="฿207,477.33" matched="50/51" tone="green" /><StatementCard suffix="987" opening="฿119,580.88" credit="฿931,565.54" debit="฿791,272.85" closing="฿259,873.57" matched="77/97" tone="blue" /></section><section className="two-column bank-layout"><div className="panel"><PanelTitle kicker="Classification · •••987" title="ประเภทธุรกรรมที่ตรวจพบ" /><div className="classification-list">{[["Direct / unclassified transfer", "89", "฿546,130.00", "blue"], ["SMART SCBT batch", "13", "฿215,589.13", "amber"], ["Foreign trade reference", "5", "฿64,846.41", "slate"], ["Internal company transfer", "3", "฿105,000.00", "green"]].map((row) => <div key={row[0]}><span className={`class-dot ${row[3]}`} /><p><b>{row[0]}</b><small>{row[1]} รายการ</small></p><strong>{row[2]}</strong></div>)}</div></div><div className="panel"><PanelTitle kicker="Control checks" title="สมการยอดคงเหลือ" /><div className="control-equation"><span><small>ยอดยกมา</small><b>฿119,580.88</b></span><i>＋</i><span><small>ฝาก</small><b>฿931,565.54</b></span><i>−</i><span><small>ถอน</small><b>฿791,272.85</b></span><i>−</i><span><small>ยอดยกไป</small><b>฿259,873.57</b></span></div><div className="control-pass"><span>✓</span><p><b>Control delta = ฿0.00</b><small>Statement ผ่านการตรวจและพร้อมกระทบยอด</small></p></div></div></section><section className="panel data-panel"><PanelTitle kicker="Unmatched bank transactions" title="รายการธนาคารที่ต้องตรวจต่อ" /><div className="responsive-table"><table><thead><tr><th>วันที่</th><th>บัญชี</th><th>รายละเอียด</th><th>ประเภท</th><th>เครดิต</th><th>Candidate</th><th>สถานะ</th></tr></thead><tbody><tr><td>26 ก.ค. 2569</td><td>•••885</td><td>TRANSFER FROM ORATHAI</td><td>Direct receipt</td><td>฿380.00</td><td>Receipt ฿4,000.00</td><td><Pill tone="red">ต่าง ฿3,620</Pill></td></tr><tr><td>29 ก.ค. 2569</td><td>•••987</td><td>SMART SCBT 50400</td><td>OTA batch</td><td>฿50,400.00</td><td>12,600 × 4</td><td><Pill tone="amber">รอ Settlement</Pill></td></tr></tbody></table></div></section></>;
}

function Invoices({ invoices, onIssue, notify }: { invoices: typeof initialInvoices; onIssue: (id: string) => void; notify: (value: string) => void }) { return <><PageHeading view="invoices" action={<button className="primary-button large" onClick={() => notify("สร้างร่างเอกสารใหม่แล้ว")}>＋ สร้างเอกสาร</button>} /><section className="metrics-grid"><Metric label="ร่าง" value="4 ฉบับ" detail="ยอดรวม ฿111,750.00" tone="slate" /><Metric label="รออนุมัติ" value="3 ฉบับ" detail="ต้องอนุมัติก่อนออกเลข" tone="amber" /><Metric label="ออกแล้ว" value="28 ฉบับ" detail="ยอดรวม ฿286,420.00" tone="blue" /><Metric label="ส่งสำเร็จ" value="27 ฉบับ" detail="Delivery rate 96.4%" tone="green" /></section><section className="panel data-panel"><PanelTitle kicker="Invoice workflow" title="เอกสารทั้งหมด" action={<div className="table-actions"><button>สถานะทั้งหมด⌄</button><button>⇩ Export</button></div>} /><div className="responsive-table"><table><thead><tr><th>เลขที่เอกสาร</th><th>ลูกค้า / Reservation</th><th>ยอดรวม</th><th>เวอร์ชัน</th><th>สถานะ</th><th>การส่ง</th><th /></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><b>{invoice.no}</b><small className="block mono">{invoice.id}</small></td><td><b>{invoice.customer}</b><small className="block mono">{invoice.reservation}</small></td><td><b>{invoice.total}</b></td><td>v1 · PDF</td><td><Pill tone={invoice.status === "ส่งแล้ว" ? "green" : invoice.status === "ออกแล้ว" ? "blue" : invoice.status === "รออนุมัติ" ? "amber" : "slate"}>{invoice.status}</Pill></td><td>{invoice.sent}</td><td>{invoice.status === "รออนุมัติ" ? <button className="small-primary" onClick={() => onIssue(invoice.id)}>อนุมัติและออก</button> : <button className="row-button" onClick={() => notify(`เปิดตัวอย่าง ${invoice.no}`)}>›</button>}</td></tr>)}</tbody></table></div></section><section className="invoice-flow">{["Draft", "Approved", "Issued", "PDF v1", "Delivered"].map((step, index) => <div key={step}><span>{index + 1}</span><b>{step}</b><small>{index === 0 ? "ข้อมูลผู้ซื้อ" : index === 1 ? "ผู้ตรวจอนุมัติ" : index === 2 ? "Running number" : index === 3 ? "SHA-256 + Storage" : "Email / signed link"}</small></div>)}</section></>;
}

function Ota() { return <><PageHeading view="ota" action={<button className="secondary-button">⟳ นำเข้า Settlement ล่าสุด</button>} /><section className="ota-providers">{[["Booking.com", "39 bookings", "฿205,165.09", "฿187,402.15", "green"], ["Trip.com", "39 bookings", "฿277,723.49", "฿254,811.90", "blue"], ["Airbnb", "11 bookings", "฿227,452.85", "฿211,190.22", "amber"]].map((row) => <article key={row[0]}><div><span className={`ota-logo ${row[4]}`}>{row[0].slice(0, 1)}</span><p><b>{row[0]}</b><small>{row[1]}</small></p><Pill tone={row[4] as Tone}>{row[4] === "amber" ? "รอตรวจ 1" : "Matched"}</Pill></div><span><small>ยอด Booking</small><b>{row[2]}</b></span><span><small>Net payout</small><b>{row[3]}</b></span></article>)}</section><section className="panel three-way"><PanelTitle kicker="Three-way reconciliation" title="เส้นทางกระทบยอด OTA" /><div className="three-way-flow"><article><span>01</span><div><small>Smart Order</small><b>Booking / Receipt</b><p>69 bookings · gross ฿710,341.43</p></div><Pill tone="green">66 matched</Pill></article><i>→</i><article><span>02</span><div><small>OTA Provider</small><b>Settlement lines</b><p>commission · refund · withholding</p></div><Pill tone="blue">net ฿653,404.27</Pill></article><i>→</i><article><span>03</span><div><small>Bank Account</small><b>Batch payout</b><p>SMART SCBT / foreign reference</p></div><Pill tone="green">3 payouts</Pill></article></div></section><section className="panel data-panel"><PanelTitle kicker="Settlement batches" title="ผลการตรวจสามทาง" /><div className="responsive-table"><table><thead><tr><th>Batch</th><th>Provider</th><th>Bookings</th><th>Gross</th><th>Fees / Refund</th><th>Net</th><th>Bank payout</th><th>ผล</th></tr></thead><tbody><tr><td className="mono">BKG-0726-A</td><td>Booking.com</td><td>19</td><td>฿205,165.09</td><td>−฿17,762.94</td><td>฿187,402.15</td><td>฿187,402.15</td><td><Pill tone="green">ตรงกัน</Pill></td></tr><tr><td className="mono">TRP-0726-C</td><td>Trip.com</td><td>39</td><td>฿277,723.49</td><td>−฿22,911.59</td><td>฿254,811.90</td><td>฿254,811.90</td><td><Pill tone="green">ตรงกัน</Pill></td></tr><tr><td className="mono">AIR-0726-B</td><td>Airbnb</td><td>11</td><td>฿227,452.85</td><td>−฿16,262.63</td><td>฿211,190.22</td><td>฿210,810.22</td><td><Pill tone="red">ต่าง ฿380</Pill></td></tr></tbody></table></div></section></>;
}

function Audit() { return <><PageHeading view="audit" action={<button className="secondary-button">⇩ ส่งออก Audit log</button>} /><section className="metrics-grid three"><Metric label="เหตุการณ์เดือนนี้" value="1,284" detail="ระบบ 72% · ผู้ใช้ 28%" tone="blue" /><Metric label="Manual actions" value="36" detail="มีเหตุผลและผู้อนุมัติครบ" tone="amber" /><Metric label="ความสมบูรณ์" value="100%" detail="ไม่พบ audit gap" tone="green" /></section><section className="panel audit-panel"><div className="audit-toolbar"><div><button className="active">ทั้งหมด</button><button>Manual</button><button>System</button><button>Security</button></div><label className="search-box">⌕<input placeholder="ค้นหา actor, action หรือ entity" /></label></div><div className="audit-list">{audits.map((event) => <div key={`${event.time}-${event.entity}`}><span className={`audit-dot ${event.tone}`} /><time>{event.time}</time><p><b>{event.action}</b><small>{event.detail}</small></p><span><b>{event.actor}</b><small>{event.entity}</small></span><button className="row-button">›</button></div>)}</div></section></>;
}

function Rules({ notify }: { notify: (value: string) => void }) { const [values, setValues] = useState({ date: "2", auto: "95", review: "85", tolerance: "0.00" }); return <><PageHeading view="rules" action={<div className="rule-actions"><Pill tone="green">Active · v1.0.0</Pill><button className="primary-button" onClick={() => notify("บันทึก ruleset v1.1.0 เป็น Draft แล้ว")}>บันทึกเป็นเวอร์ชันใหม่</button></div>} /><section className="rules-grid"><div className="panel rule-editor"><PanelTitle kicker="Matching thresholds" title="เกณฑ์การจับคู่" />{[["Date window", "จำนวนวันที่ธนาคารช้ากว่าวันรับเงิน", "date", "วัน"], ["Auto-match score", "คะแนนขั้นต่ำสำหรับอนุมัติอัตโนมัติ", "auto", "คะแนน"], ["Review score", "คะแนนขั้นต่ำสำหรับเสนอ Candidate", "review", "คะแนน"], ["Amount tolerance", "ผลต่างที่อนุญาต ค่าเริ่มต้นต้องเป็นศูนย์", "tolerance", "บาท"]].map((row) => <label className="rule-field" key={row[2]}><span><b>{row[0]}</b><small>{row[1]}</small></span><span><input value={values[row[2] as keyof typeof values]} onChange={(event) => setValues({ ...values, [row[2]]: event.target.value })} /><em>{row[3]}</em></span></label>)}</div><div className="panel"><PanelTitle kicker="Rule sequence" title="ลำดับกฎที่เปิดใช้" /><div className="rule-sequence">{[["R01", "Exact reference + amount", "100"], ["R02", "Exact date + amount + unique name", "95"], ["R03", "Date window + partial name", "85–94"], ["R04", "Grouped N:1 / 1:N", "85–94"], ["R05", "Amount delta ≠ 0 → Exception", "BLOCK"]].map((rule) => <div key={rule[0]}><span>{rule[0]}</span><p><b>{rule[1]}</b><small>เปิดใช้งาน</small></p><em>{rule[2]}</em><button className="toggle on"><i /></button></div>)}</div></div></section><section className="two-column"><div className="panel"><PanelTitle kicker="Payment mapping" title="การ normalize ช่องทางชำระ" /><div className="mapping-list">{[["BOOKINGCOM COLLECT", "BOOKING_COLLECT"], ["Booking Collect", "BOOKING_COLLECT"], ["TRIPCOM COLLECT", "TRIP_COLLECT"], ["AIRBNB COLLECT", "AIRBNB_COLLECT"]].map((map) => <div key={map[0]}><code>{map[0]}</code><span>→</span><b>{map[1]}</b><button>แก้ไข</button></div>)}</div></div><div className="panel"><PanelTitle kicker="Version history" title="ประวัติ Ruleset" /><div className="version-list"><div><span>v1.0.0</span><p><b>Production rules</b><small>5 ส.ค. 2569 · สุวรรณา ว.</small></p><Pill tone="green">ใช้งานอยู่</Pill></div><div><span>v0.9.2</span><p><b>เพิ่ม grouped matching</b><small>1 ส.ค. 2569 · ศิริพร</small></p><button>ดูรายละเอียด</button></div><div><span>v0.9.0</span><p><b>Initial bank rules</b><small>28 ก.ค. 2569 · ระบบ</small></p><button>ดูรายละเอียด</button></div></div></div></section></>;
}

function PanelTitle({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) { return <div className="panel-title"><span><small>{kicker}</small><h2>{title}</h2></span>{action}</div>; }
function RunTable({ compact = false }: { compact?: boolean }) { const data = compact ? runRows.slice(0, 3) : runRows; return <div className="responsive-table"><table className="run-table"><thead><tr><th>รอบ</th><th>งานกระทบยอด</th><th>แหล่งข้อมูล</th><th>Matched</th><th>Exception</th><th>อัตรา</th><th>สถานะ</th><th /></tr></thead><tbody>{data.map((run) => <tr key={run.id}><td><span className="phase-badge">{run.phase}</span></td><td><b>{run.name}</b><small className="block mono">{run.id} · v1.0.0</small></td><td>{run.sources}</td><td><b>{run.matched}</b></td><td>{run.exception}</td><td><b>{run.rate}</b></td><td><Pill tone={run.tone}>{run.status}</Pill></td><td><button className="row-button">›</button></td></tr>)}</tbody></table></div>; }
function StatementCard({ suffix, opening, credit, debit, closing, matched, tone }: { suffix: string; opening: string; credit: string; debit: string; closing: string; matched: string; tone: Tone }) { return <article className="statement-card"><div className="statement-head"><span><small>KASIKORNBANK</small><h2>บัญชีลงท้าย •••{suffix}</h2></span><Pill tone={tone}>Control ผ่าน · ฿0.00</Pill></div><div className="statement-values"><span><small>ยอดยกมา</small><b>{opening}</b></span><span><small>ยอดฝาก</small><b>{credit}</b></span><span><small>ยอดถอน</small><b>{debit}</b></span><span><small>ยอดยกไป</small><b>{closing}</b></span></div><div className="statement-foot"><span><b>{matched}</b><small>รายการจับคู่แล้ว</small></span><div className="bar"><i style={{ width: suffix === "885" ? "98%" : "79%" }} /></div><button>เปิดรายละเอียด →</button></div></article>; }
function UploadModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><form className="upload-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose}>×</button><span className="upload-symbol">↑</span><h2>นำเข้าเอกสารบัญชี</h2><p>ไฟล์จะถูกเก็บในพื้นที่ส่วนตัว ตรวจ SHA-256 เพื่อป้องกันไฟล์ซ้ำ และสร้างงานประมวลผลอัตโนมัติ</p><label><span>ประเภทเอกสาร</span><select name="documentType" defaultValue="collection_report"><option value="collection_report">รายงานรับเงิน</option><option value="ledger">บัญชีแยกประเภท</option><option value="bank_statement">Bank Statement</option><option value="ota_settlement">OTA Settlement</option></select></label><label><span>รอบบัญชี</span><select name="period" defaultValue="2026-07"><option value="2026-07">กรกฎาคม 2569</option><option value="2026-06">มิถุนายน 2569</option></select></label><label className="drop-zone"><input name="file" type="file" accept=".xlsx,.xls,.pdf,.csv" /><span>＋</span><b>วางไฟล์ที่นี่ หรือคลิกเพื่อเลือก</b><small>XLSX, XLS, PDF, CSV · ไม่เกิน 25 MB</small></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "กำลังอัปโหลด…" : "อัปโหลดและประมวลผล"}</button></div></form></div>; }
