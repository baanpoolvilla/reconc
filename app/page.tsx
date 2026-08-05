"use client";

import { useMemo, useState } from "react";

type ExceptionItem = {
  id: string;
  reason: string;
  title: string;
  reservation: string;
  source: string;
  target: string;
  delta: string;
  age: string;
  severity: "สูง" | "กลาง" | "ต่ำ";
  status: "ต้องตรวจสอบ" | "รอเอกสาร" | "มอบหมายแล้ว";
  owner: string;
};

const exceptions: ExceptionItem[] = [
  {
    id: "EX-00042",
    reason: "AMOUNT_MISMATCH",
    title: "ยอดรับเงินไม่ตรงกับยอดฝากธนาคาร",
    reservation: "10862708254763192824",
    source: "฿4,000.00",
    target: "฿380.00",
    delta: "฿3,620.00",
    age: "2 ชม.",
    severity: "สูง",
    status: "ต้องตรวจสอบ",
    owner: "ยังไม่มอบหมาย",
  },
  {
    id: "EX-00041",
    reason: "METHOD_MISMATCH",
    title: "ช่องทางรับเงินต่างกัน แต่ยอดรวมตรงกัน",
    reservation: "10578393061567240019",
    source: "฿12,600.00",
    target: "฿12,600.00",
    delta: "฿0.00",
    age: "4 ชม.",
    severity: "กลาง",
    status: "มอบหมายแล้ว",
    owner: "ศิริพร",
  },
  {
    id: "EX-00039",
    reason: "MISSING_RESERVATION",
    title: "ไม่พบเลขที่จองในบัญชีแยกประเภท",
    reservation: "10900237654890017264",
    source: "฿5,500.00",
    target: "—",
    delta: "฿5,500.00",
    age: "1 วัน",
    severity: "กลาง",
    status: "รอเอกสาร",
    owner: "กิตติยา",
  },
  {
    id: "EX-00038",
    reason: "INVALID_ROW",
    title: "ข้อมูลแถวต้นทางไม่สมบูรณ์",
    reservation: "ไม่ระบุ",
    source: "—",
    target: "—",
    delta: "—",
    age: "1 วัน",
    severity: "ต่ำ",
    status: "ต้องตรวจสอบ",
    owner: "ยังไม่มอบหมาย",
  },
];

const navigation = [
  ["overview", "ภาพรวม", "⌂"],
  ["uploads", "ศูนย์นำเข้า", "↑"],
  ["runs", "รอบกระทบยอด", "↔"],
  ["review", "คิวตรวจสอบ", "!"],
  ["reservations", "รายการจอง", "#"],
  ["statements", "รายการเดินบัญชี", "▤"],
  ["invoices", "เอกสารภาษี", "□"],
  ["audit", "ประวัติการทำงาน", "◷"],
];

const runs = [
  { source: "รายงานรับเงิน ↔ บัญชีแยกประเภท", meta: "526 กลุ่ม • ruleset v1.0.0", matched: "477", rate: "90.7%", status: "เสร็จแล้ว", tone: "green" },
  { source: "KBank •••885 ↔ รายงานรับเงิน", meta: "52 receipts • 51 bank credits", matched: "51", rate: "98.1%", status: "มีข้อยกเว้น", tone: "amber" },
  { source: "KBank •••987 ↔ รายงานรับเงิน", meta: "97 receipts • classified bank lines", matched: "77", rate: "79.4%", status: "กำลังตรวจสอบ", tone: "blue" },
];

function formatNow() {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(2026, 6, 31));
}

export default function Home() {
  const [active, setActive] = useState("overview");
  const [filter, setFilter] = useState("ทั้งหมด");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ExceptionItem | null>(exceptions[0]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => {
    return exceptions.filter((item) => {
      const statusMatch = filter === "ทั้งหมด" || item.status === filter;
      const text = `${item.id} ${item.reason} ${item.reservation} ${item.title}`.toLowerCase();
      return statusMatch && text.includes(query.trim().toLowerCase());
    });
  }, [filter, query]);

  const handleNavigation = (id: string) => {
    setActive(id);
    if (id !== "overview" && id !== "review" && id !== "runs") {
      setNotice("ส่วนนี้อยู่ในลำดับถัดไปของ Phase 1");
      window.setTimeout(() => setNotice(""), 2200);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="เมนูหลัก">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div><strong>ClearClose</strong><small>ACCOUNT OPS</small></div>
        </div>

        <div className="org-switcher">
          <span className="org-avatar">SA</span>
          <div><b>Smart Order</b><small>บริษัท สบายดี จำกัด</small></div>
          <span className="chevron">⌄</span>
        </div>

        <nav>
          <p className="nav-label">พื้นที่ทำงาน</p>
          {navigation.slice(0, 4).map(([id, label, icon]) => (
            <button key={id} className={active === id ? "active" : ""} onClick={() => handleNavigation(id)}>
              <span className="nav-icon">{icon}</span>{label}
              {id === "review" && <em>49</em>}
            </button>
          ))}
          <p className="nav-label second">ข้อมูลและเอกสาร</p>
          {navigation.slice(4).map(([id, label, icon]) => (
            <button key={id} className={active === id ? "active" : ""} onClick={() => handleNavigation(id)}>
              <span className="nav-icon">{icon}</span>{label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sync-state"><span />ข้อมูลล่าสุด 14:28 น.</div>
          <button className="profile-button"><span>สว</span><div><b>สุวรรณา ว.</b><small>ผู้ดูแลระบบ</small></div><i>•••</i></button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><i /><i /><i /></span><strong>ClearClose</strong></div>
          <div className="period-control">
            <span>รอบบัญชี</span>
            <button>1–31 ก.ค. 2569 <b>⌄</b></button>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="ค้นหา">⌕</button>
            <button className="icon-button notification" aria-label="การแจ้งเตือน">○<span /></button>
            <button className="primary-button" onClick={() => setUploadOpen(true)}><b>＋</b> นำเข้าเอกสาร</button>
          </div>
        </header>

        <div className="content">
          <section className="hero" id="overview">
            <div>
              <div className="eyebrow"><span /> รอบบัญชีปัจจุบัน</div>
              <h1>เห็นทุกยอดต่าง<br />ก่อนปิดบัญชี</h1>
              <p>กรกฎาคม 2569 • อัปเดตจากข้อมูล 3 แหล่ง • {formatNow()}</p>
            </div>
            <div className="close-readiness">
              <div className="ring" aria-label="ความพร้อมปิดบัญชี 87 เปอร์เซ็นต์"><span>87<small>%</small></span></div>
              <div><small>ความพร้อมปิดบัญชี</small><b>ใกล้พร้อมตรวจทาน</b><p><span /> เหลือ 49 รายการที่ต้องจัดการ</p></div>
            </div>
          </section>

          <section className="kpi-grid" aria-label="ตัวชี้วัดสำคัญ">
            <article className="kpi-card main-kpi">
              <div className="kpi-head"><span>ยอดรับสุทธิ</span><i className="trend up">↗ 12.4%</i></div>
              <strong>฿2,274,426<small>.29</small></strong>
              <p>จากรายงานรับเงิน 387 รายการ</p>
              <div className="sparkline" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
            </article>
            <article className="kpi-card">
              <div className="kpi-head"><span>จับคู่สำเร็จ</span><i className="kpi-symbol success">✓</i></div>
              <strong>90.7<small>%</small></strong>
              <p>477 จาก 526 กลุ่มรายการ</p>
              <div className="progress"><span style={{ width: "90.7%" }} /></div>
            </article>
            <article className="kpi-card alert-card">
              <div className="kpi-head"><span>รอตรวจสอบ</span><i className="kpi-symbol warning">!</i></div>
              <strong>49<small> กลุ่ม</small></strong>
              <p>ยอดผลต่างรวม <b>฿9,120.00</b></p>
              <div className="micro-tags"><span>สูง 1</span><span>กลาง 34</span><span>ต่ำ 14</span></div>
            </article>
            <article className="kpi-card">
              <div className="kpi-head"><span>Control checks</span><i className="kpi-symbol success">✓</i></div>
              <strong>3<small>/3 ผ่าน</small></strong>
              <p>Ledger • Statement 885 • 987</p>
              <div className="checks"><span /><span /><span /></div>
            </article>
          </section>

          <section className="workspace-grid">
            <article className="panel runs-panel" id="runs">
              <div className="panel-header">
                <div><span className="section-kicker">รอบกระทบยอด</span><h2>สถานะการจับคู่</h2></div>
                <button className="text-button" onClick={() => handleNavigation("runs")}>ดูทั้งหมด <span>→</span></button>
              </div>
              <div className="runs-list">
                {runs.map((run) => (
                  <button className="run-row" key={run.source} onClick={() => setNotice(`เปิดรายละเอียด: ${run.source}`)}>
                    <span className={`source-icon ${run.tone}`}>{run.tone === "green" ? "↔" : run.tone === "amber" ? "฿" : "▤"}</span>
                    <span className="run-copy"><b>{run.source}</b><small>{run.meta}</small></span>
                    <span className="run-result"><b>{run.matched}</b><small>จับคู่แล้ว</small></span>
                    <span className="rate"><b>{run.rate}</b><span className={`status-dot ${run.tone}`} />{run.status}</span>
                    <span className="row-arrow">›</span>
                  </button>
                ))}
              </div>
              <div className="match-note"><span>✓</span><p><b>Grouped match ที่ตรวจพบ</b><small>฿500 + ฿5,950 จับคู่กับยอดฝาก ฿6,450 สำเร็จด้วยกฎ N:1</small></p><em>score 92</em></div>
            </article>

            <article className="panel source-panel">
              <div className="panel-header">
                <div><span className="section-kicker">แหล่งข้อมูล</span><h2>ความครบถ้วนของเอกสาร</h2></div>
                <button className="more-button" aria-label="เมนูเพิ่มเติม">•••</button>
              </div>
              <div className="source-list">
                <div><span className="file-chip sheet">X</span><p><b>รายงานรับเงิน</b><small>387 แถว • ฿2.27M</small></p><em className="complete">พร้อม</em></div>
                <div><span className="file-chip sheet">X</span><p><b>บัญชีแยกประเภท</b><small>665 รายการจอง</small></p><em className="complete">พร้อม</em></div>
                <div><span className="file-chip pdf">P</span><p><b>Statement •••885</b><small>Control delta ฿0.00</small></p><em className="complete">ผ่าน</em></div>
                <div><span className="file-chip pdf">P</span><p><b>Statement •••987</b><small>122 รายการเคลื่อนไหว</small></p><em className="complete">ผ่าน</em></div>
                <div className="missing-source"><span className="file-chip missing">＋</span><p><b>Statement Kbank-Posh</b><small>ยังไม่ได้รับเอกสาร</small></p><button onClick={() => setUploadOpen(true)}>นำเข้า</button></div>
              </div>
            </article>
          </section>

          <section className="panel review-panel" id="review">
            <div className="panel-header review-header">
              <div><span className="section-kicker">ต้องดำเนินการ</span><h2>คิวตรวจสอบข้อยกเว้น</h2></div>
              <div className="review-actions"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาเลขที่จองหรือรหัส" aria-label="ค้นหาข้อยกเว้น" /></label><button className="filter-button">☷ ตัวกรอง</button></div>
            </div>
            <div className="tabs" role="tablist">
              {["ทั้งหมด", "ต้องตรวจสอบ", "รอเอกสาร", "มอบหมายแล้ว"].map((name) => (
                <button key={name} role="tab" aria-selected={filter === name} className={filter === name ? "selected" : ""} onClick={() => setFilter(name)}>{name}{name === "ทั้งหมด" && <span>49</span>}</button>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>รายการ / เหตุผล</th><th>เลขที่จอง</th><th>ยอดต้นทาง</th><th>ยอดที่เทียบ</th><th>ผลต่าง</th><th>อายุ</th><th>ผู้รับผิดชอบ</th><th /></tr></thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id} className={selected?.id === item.id ? "selected-row" : ""}>
                      <td><div className="reason-cell"><span className={`severity ${item.severity}`}>{item.severity === "สูง" ? "!" : item.severity === "กลาง" ? "•" : "i"}</span><p><b>{item.title}</b><small>{item.id} · {item.reason}</small></p></div></td>
                      <td className="mono">{item.reservation}</td>
                      <td>{item.source}</td><td>{item.target}</td><td className={item.delta !== "฿0.00" && item.delta !== "—" ? "negative" : ""}>{item.delta}</td><td>{item.age}</td>
                      <td><span className="owner"><i>{item.owner === "ยังไม่มอบหมาย" ? "+" : item.owner.slice(0, 1)}</i>{item.owner}</span></td>
                      <td><button className="inspect-button" onClick={() => setSelected(selected?.id === item.id ? null : item)} aria-label={`ตรวจสอบ ${item.id}`}>›</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="empty-state">ไม่พบรายการที่ตรงกับการค้นหา</div>}
            </div>

            {selected && (
              <div className="evidence-panel">
                <div className="evidence-head"><div><span>หลักฐานการจับคู่</span><b>{selected.id} · {selected.reason}</b></div><button onClick={() => setSelected(null)}>×</button></div>
                <div className="evidence-body">
                  <div className="evidence-card receipt"><small>รายงานรับเงิน</small><b>{selected.source}</b><p>26 ก.ค. 2569 · KbankGL885</p></div>
                  <div className="evidence-link"><span>≠</span><small>ผลต่าง<br /><b>{selected.delta}</b></small></div>
                  <div className="evidence-card bank"><small>รายการธนาคาร</small><b>{selected.target}</b><p>26 ก.ค. 2569 · Transfer</p></div>
                  <div className="rule-result"><small>กฎที่ทำงาน</small><b>ยอดต่างต้องเป็น 0.00</b><p>ระบบจะไม่ปรับยอดอัตโนมัติ</p></div>
                  <div className="evidence-actions"><button className="secondary-button">ขอเอกสาร</button><button className="primary-button" onClick={() => { setNotice("มอบหมายรายการแล้ว"); setSelected(null); }}>มอบหมายผู้ตรวจ</button></div>
                </div>
              </div>
            )}
          </section>

          <footer><span>ruleset v1.0.0</span><p>ข้อมูลทั้งหมดอยู่ในรอบบัญชี กรกฎาคม 2569</p><button>ศูนย์ช่วยเหลือ ↗</button></footer>
        </div>
      </main>

      {uploadOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setUploadOpen(false)}>
          <section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setUploadOpen(false)} aria-label="ปิด">×</button>
            <span className="upload-symbol">↑</span>
            <h2 id="upload-title">นำเข้าเอกสารบัญชี</h2>
            <p>เลือกชนิดเอกสารและรอบบัญชีก่อนอัปโหลด ระบบจะตรวจไฟล์ซ้ำและ Control total ให้โดยอัตโนมัติ</p>
            <label className="field"><span>ประเภทเอกสาร</span><select defaultValue="collection"><option value="collection">รายงานรับเงิน</option><option value="ledger">บัญชีแยกประเภท</option><option value="statement">Bank Statement</option></select></label>
            <label className="field"><span>รอบบัญชี</span><select defaultValue="jul"><option value="jul">กรกฎาคม 2569</option><option value="jun">มิถุนายน 2569</option></select></label>
            <label className="drop-zone"><input type="file" accept=".xlsx,.xls,.pdf,.csv" /><b>วางไฟล์ที่นี่ หรือเลือกจากเครื่อง</b><small>รองรับ XLSX, XLS, PDF และ CSV • ไม่เกิน 25 MB</small></label>
            <div className="modal-actions"><button className="secondary-button" onClick={() => setUploadOpen(false)}>ยกเลิก</button><button className="primary-button" onClick={() => { setUploadOpen(false); setNotice("พร้อมรับไฟล์ — การเชื่อม Storage จะทำในขั้นถัดไป"); }}>ดำเนินการต่อ</button></div>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
    </div>
  );
}
