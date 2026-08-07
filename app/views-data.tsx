"use client";

import { useMemo, useRef, useState } from "react";
import { Banner, EmptyState, PageHeading, PanelTitle, Pill, SearchBox, Stat, Switch, Tabs, useWorkspace } from "./ui";
import { type Booking, type MatchGroup, baht, thaiDate, thaiDateTime, thaiMonthLabel } from "../lib/dataset";
import {
  type AppSettings,
  type Facet,
  DEFAULT_SETTINGS,
  EXCLUSION_SCOPE_LABEL,
  describeFacets,
  normalizeSettings,
  propertyOf,
} from "../lib/settings";

// ── ค้นหา ─────────────────────────────────────────────────────────────────────
//
// หน้าเดียวที่ยังเป็นตาราง เพราะบางครั้งคำถามคือ "รายการนี้ไปอยู่ไหนแล้ว"
// ไม่ใช่ "ต้องทำอะไรต่อ" — เลยเก็บไว้แยกจากกล่องงาน

export function Browse() {
  const { dataset, effective, settings } = useWorkspace();
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const bookings = new Map<string, Booking>(dataset.bookings.map((booking) => [booking.reservationNo, booking]));
    const groupByReceipt = new Map<string, MatchGroup>();
    for (const group of dataset.reconciliation.groups) for (const row of group.receipts) groupByReceipt.set(row.id, group);
    const exceptionByReceipt = new Map(dataset.reconciliation.exceptions.filter((row) => row.receiptId).map((row) => [row.receiptId, row]));
    const excluded = new Map(effective.excluded.map((row) => [row.id, row.excludedBy]));

    const all = [...dataset.receipts, ...effective.excluded];
    return all
      .map((receipt) => {
        const group = groupByReceipt.get(receipt.id);
        const exception = exceptionByReceipt.get(receipt.id);
        const excludedBy = excluded.get(receipt.id);
        return {
          receipt,
          booking: bookings.get(receipt.reservationNo),
          group,
          exception,
          excludedBy,
          status: excludedBy ? "excluded" : group ? "matched" : exception ? "open" : "outofscope",
        };
      })
      .sort((a, b) => b.receipt.date.localeCompare(a.receipt.date) || a.receipt.reservationNo.localeCompare(b.receipt.reservationNo));
  }, [dataset, effective]);

  const visible = rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (!query.trim()) return true;
    const haystack = `${row.receipt.reservationNo} ${row.receipt.guest} ${row.receipt.method} ${row.receipt.group} ${row.receipt.roomNumber} ${row.booking?.mobile ?? ""}`;
    return haystack.toLowerCase().includes(query.trim().toLowerCase());
  });

  const exportCsv = () => {
    const header = [
      "วันที่รับเงิน", "เลขที่จอง", "ผู้จอง", "เบอร์โทร", "ช่องทางรับเงิน", "กลุ่ม", "ห้อง",
      "เข้าพัก", "ออก", "ยอดที่รับมา", "วันที่สร้างคำจอง", "สถานะ", "วันที่เงินเข้า", "ยอดเงินเข้า", "อ้างอิง",
    ];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const money = (satang: number) => (satang / 100).toFixed(2);
    const lines = visible.map((row) => [
      row.receipt.date, row.receipt.reservationNo, row.booking?.guest || row.receipt.guest,
      row.booking?.mobile ?? "", row.receipt.method, row.receipt.group, row.receipt.roomNumber,
      row.receipt.checkIn, row.receipt.checkOut, money(row.receipt.amountSatang),
      row.booking?.createdDate ?? "", statusLabel(row.status),
      row.group?.lines[0]?.date ?? "", row.group ? money(row.group.bankSatang) : "",
      row.group?.id ?? row.exception?.id ?? (row.excludedBy ? `${EXCLUSION_SCOPE_LABEL[row.excludedBy.scope]}: ${row.excludedBy.value}` : ""),
    ].map(escape).join(","));

    const blob = new Blob([`﻿${[header.map(escape).join(","), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clearclose-รายการรับเงิน-${dataset.meta.period || "export"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeading
        title="ค้นหารายการ"
        description="ดูว่ารายการรับเงินแต่ละใบตอนนี้อยู่สถานะไหน"
        action={<button className="secondary-button" onClick={exportCsv}>⇩ ส่งออก CSV</button>}
      />

      <div className="queue-toolbar">
        <Tabs
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "ทั้งหมด", count: rows.length },
            { value: "matched", label: "เรียบร้อยแล้ว", count: rows.filter((row) => row.status === "matched").length },
            { value: "open", label: "ยังค้าง", count: rows.filter((row) => row.status === "open").length },
            { value: "outofscope", label: "ไม่มี Statement", count: rows.filter((row) => row.status === "outofscope").length },
            { value: "excluded", label: "ไม่นับ", count: rows.filter((row) => row.status === "excluded").length },
          ]}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="ชื่อผู้จอง เลขที่จอง เบอร์โทร หรือห้อง" />
      </div>

      <section className="panel">
        <div className="responsive-table scroll-table">
          <table className="browse-table">
            <thead>
              <tr><th>วันที่</th><th>ผู้จอง</th><th>ห้อง / กลุ่ม</th><th>ช่องทางรับเงิน</th><th className="num">ยอดที่รับมา</th><th>สถานะ</th></tr>
            </thead>
            <tbody>
              {visible.slice(0, settings.display.ledgerRowLimit).map((row) => (
                <tr key={row.receipt.id} className={row.status}>
                  <td>
                    <b>{thaiDate(row.receipt.date)}</b>
                    <small className="block">เข้าพัก {thaiDate(row.receipt.checkIn)}</small>
                  </td>
                  <td>
                    <b>{row.booking?.guest || row.receipt.guest || "—"}</b>
                    <small className="block mono">{row.receipt.reservationNo}</small>
                  </td>
                  <td>{row.receipt.roomNumber || "—"}<small className="block">{row.receipt.group}</small></td>
                  <td>{row.receipt.method}<small className="block">{row.receipt.channel}</small></td>
                  <td className="num"><strong>{baht(row.receipt.amountSatang)}</strong></td>
                  <td>
                    <Pill tone={row.status === "matched" ? "green" : row.status === "open" ? "red" : "slate"}>{statusLabel(row.status)}</Pill>
                    {row.group && <small className="block">{thaiDate(row.group.lines[0].date)} · {baht(row.group.bankSatang)}</small>}
                    {row.excludedBy && <small className="block">{row.excludedBy.value}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && <EmptyState icon="⌕" title="ไม่พบรายการที่ค้นหา" detail="ลองเปลี่ยนคำค้นหรือเลือกสถานะอื่น" />}
        {visible.length > settings.display.ledgerRowLimit && (
          <p className="table-note">แสดง {settings.display.ledgerRowLimit} จาก {visible.length.toLocaleString("en-US")} รายการ · ส่งออก CSV เพื่อดูทั้งหมด</p>
        )}
      </section>
    </>
  );
}

const statusLabel = (status: string) => ({
  matched: "เรียบร้อยแล้ว", open: "ยังค้าง", outofscope: "ไม่มี Statement", excluded: "ไม่นับ",
}[status] ?? status);

// ── นำเข้าเอกสาร ──────────────────────────────────────────────────────────────

const requiredDocuments = [
  { kind: "ledger", label: "บัญชีแยกประเภท", detail: "ไฟล์ Excel ที่มีคอลัมน์ Reservation Creation Time", pattern: "*บัญชีแยกประเภท*.xlsx" },
  { kind: "collection", label: "รายงานการรับเงิน", detail: "ไฟล์ Excel ที่มีคอลัมน์ Date, Payment Method, Amount", pattern: "*รายงานการรับเงิน*.xlsx" },
  { kind: "statement885", label: "Statement บัญชี 885", detail: "PDF จาก K BIZ", pattern: "885*.pdf" },
  { kind: "statement987", label: "Statement บัญชี 987", detail: "PDF จาก K BIZ", pattern: "987*.pdf" },
];

const sourceKindToDocument: Record<string, string> = {
  ledger: "ledger", collection_report: "collection",
  bank_statement_885: "statement885", bank_statement_987: "statement987",
};

type UploadResult = { runId?: string; accepted?: { kind: string; name: string; rows: number }[]; error?: string };

export function Upload() {
  const { dataset, online } = useWorkspace();
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
      <PageHeading title="นำเข้าเอกสาร" description="ใส่ไฟล์ของเดือนนี้ ระบบจะอ่านและกระทบยอดใหม่ให้ทันที" />

      {!online && (
        <Banner tone="amber" title="อัปโหลดผ่านเว็บต้องเปิดโหมดออนไลน์ก่อน">
          ตั้งค่า <code>DATABASE_URL</code> ของ Neon Postgres ใน Vercel แล้ว redeploy · ระหว่างนี้ยังวางไฟล์ในโฟลเดอร์ <code>data/</code>
          แล้วสั่ง <code>npm run data:build</code> ได้ตามเดิม
        </Banner>
      )}

      <section className="panel">
        <PanelTitle title="เอกสารที่ต้องใช้ทั้งสี่ไฟล์" />
        <div className="doc-grid">
          {requiredDocuments.map((file) => {
            const ready = loaded.has(file.kind);
            const stored = dataset.meta.sources.find((item) => (sourceKindToDocument[item.kind] ?? item.kind) === file.kind);
            return (
              <article key={file.kind} className={ready ? "ready" : ""}>
                <span className={`doc-check ${ready ? "ready" : ""}`}>{ready ? "✓" : "+"}</span>
                <p><b>{file.label}</b><small>{ready ? `${stored?.name} · ${stored?.rows.toLocaleString("en-US")} แถว` : file.detail}</small></p>
                <code>{file.pattern}</code>
              </article>
            );
          })}
        </div>

        <form className="upload-form" onSubmit={submit}>
          <label className="drop-zone">
            <input name="files" type="file" multiple accept=".xlsx,.pdf" disabled={!online || busy} />
            <span>＋</span>
            <b>เลือกไฟล์ หรือลากไฟล์มาวางตรงนี้</b>
            <small>เลือกพร้อมกันได้ทั้งสี่ไฟล์ · ระบบดูจากชื่อไฟล์ว่าเป็นเอกสารชนิดใด · ไม่เกิน 25 MB ต่อไฟล์</small>
          </label>
          <div className="upload-actions">
            <p>อัปโหลดไฟล์ชนิดเดิมซ้ำจะแทนที่ของเดิม ไม่สะสมซ้ำ · การจับคู่ที่เคยยืนยันไว้ไม่หาย</p>
            <button className="primary-button" type="submit" disabled={!online || busy}>
              {busy ? "กำลังประมวลผล…" : "อัปโหลดและกระทบยอดใหม่"}
            </button>
          </div>
        </form>

        {result?.error && <Banner tone="red" title="ไม่สำเร็จ">{result.error}</Banner>}
        {result?.accepted && (
          <Banner tone="green" title={`นำเข้าสำเร็จ ${result.accepted.length} ไฟล์ · กำลังโหลดหน้าใหม่`}>
            {result.accepted.map((item) => `${item.name} (${item.rows.toLocaleString("en-US")} แถว)`).join(" · ")}
          </Banner>
        )}
      </section>
    </>
  );
}

// ── ตั้งค่า ───────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "exclusions", label: "รายการที่ไม่นับ" },
  { id: "ota", label: "ก้อนโอน OTA" },
  { id: "matching", label: "วิธีจับคู่" },
  { id: "system", label: "ข้อมูลและระบบ" },
];

export function Settings() {
  const { raw, effective, settings, saveSettings, online, busy } = useWorkspace();
  const facets = useMemo(() => describeFacets(raw), [raw]);
  const [section, setSection] = useState("exclusions");

  const patch = (partial: Partial<AppSettings>) => void saveSettings({ ...settings, ...partial });
  const patchExclusions = (partial: Partial<AppSettings["exclusions"]>) => patch({ exclusions: { ...settings.exclusions, ...partial } });
  const patchMatching = (partial: Partial<AppSettings["matching"]>) => patch({ matching: { ...settings.matching, ...partial } });
  const patchSettlement = (partial: Partial<AppSettings["settlement"]>) => patch({ settlement: { ...settings.settlement, ...partial } });
  const patchDisplay = (partial: Partial<AppSettings["display"]>) => patch({ display: { ...settings.display, ...partial } });

  const toggleIn = (key: "properties" | "groups" | "methods" | "channels" | "bookingStatuses", value: string) => {
    const current = settings.exclusions[key];
    patchExclusions({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  };

  return (
    <>
      <PageHeading
        title="ตั้งค่า"
        description="กำหนดว่าอะไรนับ อะไรไม่นับ และระบบจะช่วยจับคู่แบบไหน — เอกสารต้นทางไม่ถูกแก้ไขในทุกกรณี"
        action={<Pill tone={online ? "green" : "amber"}>{online ? "ออนไลน์" : "เก็บในเครื่องนี้"}</Pill>}
      />

      <Banner
        tone={online ? "green" : "amber"}
        title={online ? "การตั้งค่าถูกเก็บบนเซิร์ฟเวอร์" : "ยังไม่ได้เปิดโหมดออนไลน์"}
      >
        {online
          ? "ทุกเครื่องที่เปิดระบบนี้เห็นค่าเดียวกัน และการจับคู่ที่ยืนยันไว้ก็ถูกเก็บไว้ด้วยกัน"
          : <>ตอนนี้ค่าถูกเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น · เปิดโหมดออนไลน์โดยตั้ง <code>DATABASE_URL</code> ของ Neon Postgres ใน Vercel → Settings → Environment Variables แล้ว redeploy ระบบจะสร้างตารางให้เอง</>}
      </Banner>

      <section className="stat-row">
        <Stat label="รายการในเอกสาร" value={`${effective.sourceReceiptCount}`} detail={baht(effective.sourceReceiptSatang)} />
        <Stat label="ไม่นับตามที่ตั้งไว้" value={`${effective.excluded.length}`} detail={baht(effective.excludedSatang)} tone="red" />
        <Stat label="เข้าสู่การกระทบยอด" value={`${effective.dataset.receipts.length}`} detail={baht(effective.sourceReceiptSatang - effective.excludedSatang)} tone="green" />
        <Stat label="ก้อนโอน OTA ที่พบ" value={`${effective.settlements.length}`} detail={settings.settlement.enabled ? "เปิดใช้งานอยู่" : "ปิดอยู่"} tone="blue" />
      </section>

      <nav className="settings-nav">
        {SECTIONS.map((item) => (
          <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>{item.label}</button>
        ))}
      </nav>

      {section === "exclusions" && (
        <>
          <section className="panel">
            <PanelTitle
              title="ตัดรายการที่ไม่ต้องกระทบยอด"
              action={<Switch checked={settings.exclusions.enabled} onChange={(next) => patchExclusions({ enabled: next })} label="เปิดปิดตัวกรอง" disabled={busy} />}
            />
            <p className="settings-lead">
              รายการที่ตัดออกจะหายไปจากทุกหน้าจอและไฟล์ที่ส่งออก แต่ยังดูได้ที่หน้าค้นหาโดยเลือกสถานะ “ไม่นับ”
            </p>
            {effective.buckets.length > 0 && (
              <div className="rule-chips">
                {effective.buckets.map((bucket) => (
                  <span key={`${bucket.scope}:${bucket.value}`}>
                    <em>{EXCLUSION_SCOPE_LABEL[bucket.scope]}</em>
                    <b>{bucket.value}</b>
                    <i>{bucket.count} รายการ · {baht(bucket.amountSatang)}</i>
                  </span>
                ))}
              </div>
            )}
          </section>

          <div className="settings-grid">
            <FacetPanel title="กลุ่มทรัพย์สิน" hint="ตัดทั้งกลุ่ม ครอบคลุมทุกโครงการที่ขึ้นต้นด้วยชื่อนี้"
              facets={facets.properties} selected={settings.exclusions.properties}
              onToggle={(value) => toggleIn("properties", value)} onClear={() => patchExclusions({ properties: [] })}
              disabled={!settings.exclusions.enabled || busy} />
            <FacetPanel title="ช่องทางรับเงิน" hint="ตัดรายการที่รับเงินเข้าช่องทางนี้ทั้งหมด"
              facets={facets.methods} selected={settings.exclusions.methods}
              onToggle={(value) => toggleIn("methods", value)} onClear={() => patchExclusions({ methods: [] })}
              disabled={!settings.exclusions.enabled || busy} />
            <FacetPanel title="กลุ่มย่อยรายโครงการ" hint="ใช้เมื่อต้องการตัดเฉพาะบางโครงการ"
              facets={facets.groups} selected={settings.exclusions.groups}
              onToggle={(value) => toggleIn("groups", value)} onClear={() => patchExclusions({ groups: [] })}
              disabled={!settings.exclusions.enabled || busy} shadowed={settings.exclusions.properties} />
            <FacetPanel title="สถานะคำจอง" hint="เช่น ไม่นับคำจองที่ยกเลิกแล้ว"
              facets={facets.bookingStatuses} selected={settings.exclusions.bookingStatuses}
              onToggle={(value) => toggleIn("bookingStatuses", value)} onClear={() => patchExclusions({ bookingStatuses: [] })}
              disabled={!settings.exclusions.enabled || busy} />
          </div>
        </>
      )}

      {section === "ota" && (
        <section className="panel">
          <PanelTitle title="การแตกยอดก้อนโอน OTA" action={<Switch checked={settings.settlement.enabled} onChange={(next) => patchSettlement({ enabled: next })} label="เปิดปิดการแตกยอด" disabled={busy} />} />
          <p className="settings-lead">
            ระบบจะมองหาเงินเข้าที่หน้าตาเหมือนก้อนโอนของ OTA แล้วเสนอว่าก้อนนั้นน่าจะเป็นของคำจองไหนบ้าง
            ข้อเสนอไม่มีผลกับตัวเลขใดจนกว่าจะกดยืนยัน
          </p>
          <div className="settings-field">
            <span><b>ช่วงวันที่ยอมให้ห่างจากก้อนโอน</b><small>คำจองที่รับเงินภายในกี่วันรอบก้อนโอนถึงจะถูกเสนอ · ยิ่งกว้างยิ่งเสนอเยอะแต่มั่วง่ายขึ้น</small></span>
            <div className="segmented">
              {[3, 5, 7, 14, 30].map((days) => (
                <button key={days} className={settings.settlement.windowDays === days ? "active" : ""} disabled={busy} onClick={() => patchSettlement({ windowDays: days })}>{days} วัน</button>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <span><b>ค่าคอมสูงสุดที่ถือว่าปกติ</b><small>เกินกว่านี้ระบบจะขึ้นเตือนว่าให้ดูก่อนยืนยัน ไม่ได้ห้าม</small></span>
            <div className="segmented">
              {[10, 15, 20, 30, 50].map((rate) => (
                <button key={rate} className={settings.settlement.maxFeeRate === rate ? "active" : ""} disabled={busy} onClick={() => patchSettlement({ maxFeeRate: rate })}>{rate}%</button>
              ))}
            </div>
          </div>
          <TagEditor
            title="ข้อความที่บอกว่าเป็นก้อนโอนของ OTA"
            hint="ระบบเทียบกับช่องทาง คำอธิบาย และรายละเอียดของเงินเข้าแต่ละบรรทัด"
            values={settings.settlement.patterns}
            onChange={(patterns) => patchSettlement({ patterns })}
            disabled={busy}
          />
          <TagEditor
            title="ช่องทางรับเงินที่ถือว่าเป็นเงินที่ OTA เก็บแทนเรา"
            hint="เฉพาะรายการที่รับเงินผ่านช่องทางเหล่านี้เท่านั้นที่จะถูกเสนอเข้าก้อน"
            values={settings.settlement.otaMethods}
            onChange={(otaMethods) => patchSettlement({ otaMethods })}
            disabled={busy}
          />
        </section>
      )}

      {section === "matching" && (
        <>
          <section className="panel">
            <PanelTitle title="กฎที่แก้ไขไม่ได้" action={<Pill tone="green">ล็อกไว้เสมอ</Pill>} />
            <p className="settings-lead">
              ระบบจะจับคู่ให้เองก็ต่อเมื่อ <b>วันที่สร้างคำจองตรงกับวันที่เงินเข้า</b> และ <b>ยอดเท่ากันพอดี</b> เท่านั้น
              สองข้อนี้ปรับไม่ได้ ถ้าต้องการยอมรับคู่ที่ไม่เข้าเงื่อนไข ให้คนกดยืนยันเองพร้อมเหตุผท ซึ่งจะถูกบันทึกไว้ทุกครั้ง
            </p>
          </section>
          <section className="panel">
            <PanelTitle title="รูปแบบที่ให้ระบบลองจับให้" />
            <div className="settings-field">
              <span><b>รวมหลายรายการรับเงิน = เงินเข้าก้อนเดียว</b><small>เช่น ลูกค้าสามรายจ่ายวันเดียวกัน แล้วเข้าบัญชีเป็นก้อนเดียว</small></span>
              <Switch checked={settings.matching.allowManyToOne} onChange={(next) => patchMatching({ allowManyToOne: next })} label="อนุญาต N:1" disabled={busy} />
            </div>
            <div className="settings-field">
              <span><b>หนึ่งรายการรับเงิน = เงินเข้าหลายก้อน</b><small>เช่น ลูกค้าโอนแบ่งจ่ายสองครั้งในวันเดียวกัน</small></span>
              <Switch checked={settings.matching.allowOneToMany} onChange={(next) => patchMatching({ allowOneToMany: next })} label="อนุญาต 1:N" disabled={busy} />
            </div>
            <div className="settings-field">
              <span><b>รวมได้สูงสุดกี่รายการต่อหนึ่งกลุ่ม</b><small>ยิ่งมากยิ่งจับได้กว้าง แต่โอกาสที่ยอดจะบังเอิญตรงกันก็สูงขึ้น · แนะนำ 4</small></span>
              <div className="segmented">
                {[2, 3, 4, 5, 6].map((size) => (
                  <button key={size} className={settings.matching.maxGroupSize === size ? "active" : ""} disabled={busy} onClick={() => patchMatching({ maxGroupSize: size })}>{size}</button>
                ))}
              </div>
            </div>
            <div className="settings-field">
              <span><b>จำนวนแถวสูงสุดในหน้าค้นหา</b><small>ตารางยาวเกินไปทำให้หน้าจอหน่วง · ไฟล์ CSV ที่ส่งออกได้ครบทุกแถวเสมอ</small></span>
              <div className="segmented">
                {[100, 300, 600, 1000].map((limit) => (
                  <button key={limit} className={settings.display.ledgerRowLimit === limit ? "active" : ""} disabled={busy} onClick={() => patchDisplay({ ledgerRowLimit: limit })}>{limit}</button>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {section === "system" && <SystemSection onImport={(next) => void saveSettings(next)} />}
    </>
  );
}

function FacetPanel({ title, hint, facets, selected, onToggle, onClear, disabled, shadowed = [] }: {
  title: string; hint: string; facets: Facet[]; selected: string[];
  onToggle: (value: string) => void; onClear: () => void; disabled: boolean; shadowed?: string[];
}) {
  const total = facets.reduce((sum, facet) => sum + Math.abs(facet.amountSatang), 0) || 1;
  return (
    <section className={`panel ${disabled ? "is-disabled" : ""}`}>
      <PanelTitle title={title} action={selected.length ? <button className="text-button" onClick={onClear}>ล้าง {selected.length}</button> : <Pill>ไม่ได้ตัดออก</Pill>} />
      <p className="settings-lead">{hint}</p>
      <div className="facet-list">
        {!facets.length && <p className="table-note">ไม่มีค่านี้ในเอกสาร</p>}
        {facets.map((facet) => {
          const checked = selected.includes(facet.value);
          const covered = !checked && shadowed.some((item) => item.toLowerCase() === propertyOf(facet.value).toLowerCase());
          return (
            <button key={facet.value} type="button" className={`facet-row ${checked ? "checked" : ""}`} onClick={() => onToggle(facet.value)} disabled={disabled} aria-pressed={checked}>
              <span className="facet-box">{checked ? "✓" : ""}</span>
              <span className="facet-name">
                <b>{facet.value}</b>
                <small>{facet.count} รายการ{facet.note ? ` · ${facet.note}` : ""}{covered ? " · ถูกตัดอยู่แล้วโดยกฎกลุ่ม" : ""}</small>
              </span>
              <span className="facet-bar"><i style={{ width: `${Math.round((Math.abs(facet.amountSatang) / total) * 100)}%` }} /></span>
              <span className="facet-amount">{baht(facet.amountSatang)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function TagEditor({ title, hint, values, onChange, disabled }: {
  title: string; hint: string; values: string[]; onChange: (next: string[]) => void; disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (value && !values.some((item) => item.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="tag-editor">
      <b>{title}</b>
      <small>{hint}</small>
      <div className="tag-input">
        <input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
          placeholder="พิมพ์แล้วกด Enter"
        />
        <button className="small-primary" type="button" onClick={add} disabled={disabled}>เพิ่ม</button>
      </div>
      <div className="tag-chips">
        {!values.length && <span className="table-note">ยังไม่มี</span>}
        {values.map((value) => (
          <span key={value} className="tag-chip">
            {value}
            <button type="button" aria-label={`ลบ ${value}`} disabled={disabled} onClick={() => onChange(values.filter((item) => item !== value))}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function SystemSection({ onImport }: { onImport: (next: AppSettings) => void }) {
  const { raw, dataset, settings, online, source } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const json = JSON.stringify(settings, null, 2);

  const exportFile = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "clearclose-settings.json";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("ส่งออกไฟล์การตั้งค่าแล้ว");
  };

  return (
    <>
      <section className="panel">
        <PanelTitle title="ข้อมูลที่ระบบกำลังใช้" />
        <div className="settings-readonly">
          <span><small>ที่เก็บข้อมูล</small><b>{online ? "Neon Postgres" : source === "build" ? "ไฟล์ในโฟลเดอร์ data/" : "ยังไม่มีข้อมูล"}</b></span>
          <span><small>รอบบัญชี</small><b>{raw.meta.period ? thaiMonthLabel(raw.meta.period) : "—"}</b></span>
          <span><small>ประมวลผลล่าสุด</small><b>{raw.meta.generatedAt ? thaiDateTime(raw.meta.generatedAt) : "—"}</b></span>
          <span><small>กฎที่ใช้</small><b className="mono">v{dataset.reconciliation.rulesetVersion}</b></span>
          <span><small>คำจองในระบบ</small><b>{raw.bookings.length.toLocaleString("en-US")}</b></span>
          <span><small>เขตเวลา</small><b>Asia/Bangkok</b></span>
        </div>
        <div className="doc-list">
          {raw.meta.sources.map((item) => (
            <div key={item.name}>
              <span className={`file-icon ${item.name.endsWith(".pdf") ? "pdf" : "sheet"}`}>{item.name.endsWith(".pdf") ? "P" : "X"}</span>
              <p><b>{item.name}</b><small>{item.label ?? item.kind}</small></p>
              <em>{item.rows.toLocaleString("en-US")} แถว</em>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle title="จัดการค่าที่ตั้งไว้" />
        <div className="settings-field">
          <span><b>คืนค่าตั้งต้น</b><small>กลับไปเป็นค่าเริ่มต้น คือไม่นับกลุ่ม Medina และช่องทาง Kbank-Posh พร้อมเปิดการแตกยอด OTA</small></span>
          <button className="secondary-button" onClick={() => { onImport(DEFAULT_SETTINGS); setMessage("คืนค่าตั้งต้นเรียบร้อย"); }}>คืนค่าตั้งต้น</button>
        </div>
        <div className="settings-field">
          <span><b>ส่งออกไฟล์การตั้งค่า</b><small>แนบไว้กับกระดาษทำการเพื่อบอกว่ารอบนี้กรองอะไรออกไปบ้าง</small></span>
          <button className="secondary-button" onClick={exportFile}>⇩ ส่งออก JSON</button>
        </div>
        <div className="settings-field">
          <span><b>นำเข้าไฟล์การตั้งค่า</b><small>ค่าที่ไม่ถูกต้องจะถูกแทนที่ด้วยค่าตั้งต้นให้อัตโนมัติ</small></span>
          <span>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              try {
                onImport(normalizeSettings(JSON.parse(await file.text())));
                setMessage(`นำเข้าการตั้งค่าจาก ${file.name} แล้ว`);
              } catch {
                setMessage("ไฟล์นี้อ่านไม่ได้ ต้องเป็น JSON ที่ส่งออกจากหน้านี้");
              }
            }} />
            <button className="secondary-button" onClick={() => fileRef.current?.click()}>↑ เลือกไฟล์</button>
          </span>
        </div>
        {message && <Banner tone="green" title={message} />}
      </section>
    </>
  );
}
