"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, EmptyState, PageHeading, PanelTitle, Pill, SearchBox, Stat, Switch, Tabs, useWorkspace } from "./ui";
import { type Booking, type MatchGroup, baht, thaiDate, thaiDateTime, thaiMonthLabel } from "../lib/dataset";
import { DOCUMENT_KINDS, inspectPickedFiles } from "../lib/document-names.mjs";
import {
  type AppSettings,
  type BankAccount,
  type Facet,
  type SettlementProvider,
  type UnmappedAccount,
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
                    {row.group?.crossPeriod && (
                      <small className="block"><span className="cross-period">↷ เงินเข้า{thaiMonthLabel(row.group.period)}</span></small>
                    )}
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

// การ์ดเอกสารที่ต้องใช้ — สอง Excel คงที่ ส่วน Statement มีกี่ใบขึ้นกับบัญชีที่
// ระบบรู้จัก ไม่ใช่จำนวนที่เขียนตายไว้ในโค้ด
const FIXED_DOCUMENTS = [
  { kind: "ledger", label: DOCUMENT_KINDS.ledger.label, detail: DOCUMENT_KINDS.ledger.detail, pattern: DOCUMENT_KINDS.ledger.pattern },
  { kind: "collection", label: DOCUMENT_KINDS.collection.label, detail: DOCUMENT_KINDS.collection.detail, pattern: DOCUMENT_KINDS.collection.pattern },
];

const sourceKindToDocument: Record<string, string> = {
  ledger: "ledger", collection_report: "collection",
  bank_statement_885: "statement885", bank_statement_987: "statement987",
};

type AcceptedFile = { kind: string; name: string; rows: number; periods?: string[]; fileStored?: boolean };
type RejectedFile = { name: string; kind: string; reason: string };
type UploadResult = {
  runId?: string;
  accepted?: AcceptedFile[];
  rejected?: RejectedFile[];
  periods?: string[];
  error?: string;
};
type StoredDocument = {
  id: string; kind: string; period: string; name: string;
  size_bytes: number; row_count: number; uploaded_at: string; has_file: boolean;
};

type PickedFile = { file: File; kind: string | null; problem: string | null };

export function Upload() {
  const { raw, online, period, periods, setPeriod, settings } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[] | null>(null);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // อ่านชื่อไฟล์ที่เพิ่งเลือกทันทีในเบราว์เซอร์ ด้วยกฎชุดเดียวกับที่เซิร์ฟเวอร์ใช้
  // ผู้ใช้จึงเห็นตั้งแต่ก่อนกดอัปโหลดว่าไฟล์เข้าจริงไหม และจะไปเป็นเอกสารชนิดไหน
  const inspect = (files: File[]) => inspectPickedFiles(files) as PickedFile[];

  const clearPicked = () => {
    setPicked([]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const blocked = picked.some((item) => item.problem);
  // ชนิดที่กำลังจะอัปโหลด ใช้ทำให้การ์ดสี่ใบด้านบนขยับตามสิ่งที่เพิ่งเลือก
  const pending = new Set(picked.filter((item) => item.kind && !item.problem).map((item) => item.kind as string));
  const pendingStatements = picked.filter((item) => item.kind === "statement" && !item.problem);

  // เอกสารครบหรือยัง เป็นคำถามรายงวด ไม่ใช่คำถามของทั้งระบบ
  const inPeriod = raw.meta.sources.filter((item) => !item.period || item.period === period);
  const loaded = new Set(inPeriod.map((item) => sourceKindToDocument[item.kind] ?? item.kind));

  // บัญชีที่ระบบรู้จัก = ที่ผูกไว้ในการตั้งค่า + ที่เคยอัปโหลด statement เข้ามาแล้ว
  const knownAccounts = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const statement of raw.statements) byCode.set(statement.code, statement.accountName || `บัญชี ${statement.code}`);
    for (const account of settings.accounts) byCode.set(account.code, account.label || `บัญชี ${account.code}`);
    return [...byCode.entries()].map(([code, label]) => ({ code, label }));
  }, [raw.statements, settings.accounts]);

  const requiredDocuments = [
    ...FIXED_DOCUMENTS,
    ...(knownAccounts.length
      ? knownAccounts.map((account) => ({
        kind: `statement${account.code}`,
        label: `Statement บัญชี ${account.code}`,
        detail: account.label,
        pattern: "*.pdf",
      }))
      : [{ kind: "statement", label: DOCUMENT_KINDS.statement.label, detail: DOCUMENT_KINDS.statement.detail, pattern: "*.pdf" }]),
  ];

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void fetch("/api/upload")
      .then((response) => response.json())
      .then((payload: { documents?: StoredDocument[] }) => {
        if (!cancelled) setDocuments(payload.documents ?? []);
      })
      .catch(() => { if (!cancelled) setDocuments([]); });
    return () => { cancelled = true; };
  }, [online, result]);

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
        clearPicked();
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
        title="นำเข้าเอกสาร"
        description="ใส่ไฟล์ของเดือนไหนก็ได้ ระบบดูงวดจากวันที่ในไฟล์เอง แล้วกระทบยอดใหม่ทั้งระบบ"
        action={periods.length > 1 ? <Pill tone="blue">{periods.length} งวดในระบบ</Pill> : undefined}
      />

      {!online && (
        <Banner tone="amber" title="อัปโหลดผ่านเว็บต้องเปิดโหมดออนไลน์ก่อน">
          ตั้งค่า <code>DATABASE_URL</code> ของ Neon Postgres ใน Vercel แล้ว redeploy · ฐานข้อมูลคือที่เก็บข้อมูลที่เดียวของระบบ ไม่มีทางอื่นให้ใส่ข้อมูลเข้าไป
        </Banner>
      )}

      <section className="panel">
        <PanelTitle
          title={`เอกสารของงวด${period === "all" ? "ที่เลือก" : thaiMonthLabel(period)}`}
          action={<Pill tone={loaded.size === requiredDocuments.length ? "green" : "amber"}>{loaded.size}/{requiredDocuments.length} ไฟล์</Pill>}
        />
        <div className="doc-grid">
          {requiredDocuments.map((file) => {
            const ready = loaded.has(file.kind);
            // ไฟล์ statement ที่เพิ่งเลือกยังไม่รู้ว่าเป็นบัญชีไหน จนกว่าจะอ่านเอกสาร
            const waiting = pending.has(file.kind)
              || (file.kind.startsWith("statement") && pendingStatements.length > 0 && !loaded.has(file.kind));
            const stored = inPeriod.find((item) => (sourceKindToDocument[item.kind] ?? item.kind) === file.kind);
            const chosen = picked.find((item) => item.kind === file.kind && !item.problem);
            return (
              <article key={file.kind} className={waiting ? "waiting" : ready ? "ready" : ""}>
                <span className={`doc-check ${waiting ? "waiting" : ready ? "ready" : ""}`}>
                  {waiting ? "↑" : ready ? "✓" : "+"}
                </span>
                <p>
                  <b>{file.label}</b>
                  <small>
                    {waiting ? (chosen
                      ? `พร้อมอัปโหลด · ${chosen.file.name}`
                      : `${pendingStatements.length} ไฟล์รออัปโหลด · ระบบจะอ่านว่าเป็นบัญชีไหนเอง`)
                      : ready ? `${stored?.name} · ${stored?.rows.toLocaleString("en-US")} แถว`
                      : file.detail}
                  </small>
                </p>
                <code>{file.pattern}</code>
              </article>
            );
          })}
        </div>

        <form className="upload-form" onSubmit={submit}>
          <label className="drop-zone">
            <input
              ref={fileInput}
              name="files"
              type="file"
              multiple
              accept=".xlsx,.pdf"
              disabled={!online || busy}
              onChange={(event) => setPicked(inspect(Array.from(event.target.files ?? [])))}
            />
            <span>＋</span>
            <b>เลือกไฟล์ หรือลากไฟล์มาวางตรงนี้</b>
            <small>เลือกพร้อมกันได้ทั้งสี่ไฟล์ · ระบบดูจากชื่อไฟล์ว่าเป็นเอกสารชนิดใด · ไม่เกิน 25 MB ต่อไฟล์</small>
          </label>

          {/* ไฟล์ที่เลือกไว้ ต้องเห็นก่อนกดอัปโหลดว่ามันเข้ามาจริงและระบบอ่านมันเป็นอะไร */}
          {picked.length > 0 && (
            <div className="picked-files">
              <header>
                <b>เลือกไว้ {picked.length} ไฟล์</b>
                <button type="button" className="text-button" onClick={clearPicked} disabled={busy}>ล้างทั้งหมด</button>
              </header>
              {picked.map((item) => (
                <div key={`${item.file.name}-${item.file.size}`} className={item.problem ? "picked-row bad" : "picked-row"}>
                  <span className={`file-icon ${item.file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "sheet"}`}>
                    {item.file.name.toLowerCase().endsWith(".pdf") ? "P" : "X"}
                  </span>
                  <p>
                    <b>{item.file.name}</b>
                    <small>{(item.file.size / 1024).toFixed(0)} KB</small>
                  </p>
                  {item.problem
                    ? <Pill tone="red">{item.problem}</Pill>
                    : <Pill tone="green">{DOCUMENT_KINDS[item.kind as keyof typeof DOCUMENT_KINDS].label}</Pill>}
                </div>
              ))}
              {blocked && (
                <p className="table-note">แก้ชื่อไฟล์ที่ติดปัญหาก่อน แล้วเลือกใหม่อีกครั้ง</p>
              )}
            </div>
          )}
          <div className="upload-actions">
            <p>
              อัปโหลดงวดใหม่ไม่ลบงวดเก่า · อัปโหลดไฟล์ชนิดเดิมของงวดเดิมซ้ำจะแทนที่เฉพาะงวดนั้น ·
              การจับคู่ที่เคยยืนยันไว้ไม่หาย
            </p>
            <button className="primary-button" type="submit" disabled={!online || busy || blocked || !picked.length}>
              {busy ? "กำลังประมวลผล…"
                : blocked ? "มีไฟล์ที่ยังใช้ไม่ได้"
                : picked.length ? `อัปโหลด ${picked.length} ไฟล์และกระทบยอดใหม่`
                : "เลือกไฟล์ก่อน"}
            </button>
          </div>
        </form>

        {result?.error && !result.accepted && (
          <Banner tone="red" title="ไม่มีไฟล์ไหนนำเข้าได้เลย">
            {result.rejected?.length
              ? <span className="upload-reasons">
                {result.rejected.map((item) => <span key={item.name}><b>{item.name}</b>{item.reason}</span>)}
              </span>
              : result.error}
          </Banner>
        )}

        {result?.accepted && (
          <Banner tone="green" title={`นำเข้าสำเร็จ ${result.accepted.length} ไฟล์ · กำลังโหลดหน้าใหม่`}>
            {result.accepted.map((item) => (
              `${item.name} (${item.rows.toLocaleString("en-US")} แถว${item.periods?.length ? ` · งวด ${item.periods.map(thaiMonthLabel).join(", ")}` : ""})`
            )).join(" · ")}
          </Banner>
        )}

        {/* ไฟล์ที่อ่านไม่ได้ไม่ได้กันไฟล์ที่อ่านได้ออกไป แต่ต้องบอกให้ชัดว่าอะไรไม่เข้า
            และเพราะอะไร ไม่ใช่ปล่อยให้คนเข้าใจว่านำเข้าครบแล้ว */}
        {result?.rejected?.length && result.accepted ? (
          <Banner tone="amber" title={`${result.rejected.length} ไฟล์ไม่ได้ถูกนำเข้า`}>
            <span className="upload-reasons">
              {result.rejected.map((item) => <span key={item.name}><b>{item.name}</b>{item.reason}</span>)}
            </span>
          </Banner>
        ) : null}
      </section>

      <ArchiveSection documents={documents} period={period} onPick={setPeriod} />
    </>
  );
}

// ── คลังเอกสารที่เก็บไว้ ─────────────────────────────────────────────────────
//
// ตัวเลขของงวดหนึ่งจะตรวจย้อนกลับได้จริงก็ต่อเมื่อเปิดไฟล์ที่มันถูกอ่านมาได้ด้วย
// รายการนี้จึงเรียงตามงวด และให้กดดาวน์โหลดไฟล์ต้นฉบับได้ทุกฉบับที่ยังเก็บไว้

function ArchiveSection({ documents, period, onPick }: {
  documents: StoredDocument[] | null;
  period: string;
  onPick: (next: string) => void;
}) {
  const byPeriod = useMemo(() => {
    const buckets = new Map<string, StoredDocument[]>();
    for (const document of documents ?? []) {
      const list = buckets.get(document.period) ?? [];
      list.push(document);
      buckets.set(document.period, list);
    }
    return [...buckets.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [documents]);

  if (documents === null) return null;

  return (
    <section className="panel">
      <PanelTitle title="เอกสารที่เก็บไว้ในระบบ" action={<Pill>{documents.length} ฉบับ</Pill>} />
      {!documents.length && (
        <EmptyState icon="↑" title="ยังไม่มีเอกสารในฐานข้อมูล" detail="อัปโหลดไฟล์ของงวดแรกเพื่อเริ่มเก็บประวัติ" />
      )}
      {byPeriod.map(([bucket, rows]) => (
        <div key={bucket} className="archive-period">
          <header>
            <b>{bucket ? thaiMonthLabel(bucket) : "ไม่ระบุงวด"}</b>
            <span>{rows.length} ฉบับ · {rows.reduce((sum, row) => sum + Number(row.row_count), 0).toLocaleString("en-US")} แถว</span>
            {bucket && bucket !== period && (
              <button className="text-button" onClick={() => onPick(bucket)}>ดูงวดนี้</button>
            )}
          </header>
          <div className="doc-list">
            {rows.map((row) => (
              <div key={row.id}>
                <span className={`file-icon ${row.name.endsWith(".pdf") ? "pdf" : "sheet"}`}>{row.name.endsWith(".pdf") ? "P" : "X"}</span>
                <p>
                  <b>{row.name}</b>
                  <small>
                    {DOCUMENT_LABELS[row.kind] ?? row.kind} · {Number(row.row_count).toLocaleString("en-US")} แถว ·
                    {" "}{(Number(row.size_bytes) / 1024).toFixed(0)} KB · {thaiDateTime(row.uploaded_at)}
                  </small>
                </p>
                {row.has_file
                  ? <a className="secondary-button" href={`/api/documents/${row.id}`}>⇩ ต้นฉบับ</a>
                  : <em>ไม่ได้เก็บไฟล์</em>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

const DOCUMENT_LABELS: Record<string, string> = {
  ledger: "บัญชีแยกประเภท",
  collection: "รายงานการรับเงิน",
  statement885: "Statement บัญชี 885",
  statement987: "Statement บัญชี 987",
};

// ── ตั้งค่า ───────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "exclusions", label: "รายการที่ไม่นับ" },
  { id: "accounts", label: "บัญชีธนาคาร" },
  { id: "ota", label: "ก้อนโอน OTA" },
  { id: "organization", label: "ผู้ออกใบเสร็จ" },
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

  // ค่าที่บันทึกไว้ก่อนมีสวิตช์นี้ไม่มีคีย์ จึงนับว่าเปิด — เหมือนที่ normalizeSettings ทำ
  const depositOn = settings.matching.securityDepositEnabled !== false;

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
        <Stat
          label="ก้อนโอน OTA ที่พบ"
          value={`${effective.settlements.length}`}
          detail={!settings.settlement.enabled ? "ปิดอยู่"
            : `ยอดตรงพอดี ${effective.settlements.filter((item) => item.status === "EXACT").length} ก้อน`}
          tone="blue"
        />
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

      {section === "accounts" && (
        <AccountsSection
          accounts={settings.accounts}
          unmapped={effective.unmappedAccounts}
          disabled={busy}
          onChange={(accounts) => patch({ accounts })}
        />
      )}

      {section === "ota" && (
        <section className="panel">
          <PanelTitle title="การแตกยอดก้อนโอน OTA" action={<Switch checked={settings.settlement.enabled} onChange={(next) => patchSettlement({ enabled: next })} label="เปิดปิดการแตกยอด" disabled={busy} />} />
          <p className="settings-lead">
            ระบบจะมองหาเงินเข้าที่หน้าตาเหมือนก้อนโอนของ OTA แล้วเสนอว่าก้อนนั้นน่าจะเป็นของคำจองไหนบ้าง
            ข้อเสนอไม่มีผลกับตัวเลขใดจนกว่าจะกดยืนยัน
          </p>
          <div className="settings-field">
            <span>
              <b>ช่วงวันที่ยอมให้ห่างจากก้อนโอน</b>
              <small>
                คำจองที่รับเงินภายในกี่วันรอบก้อนโอนถึงจะถูกเสนอ · ยิ่งกว้างยิ่งเสนอเยอะแต่มั่วง่ายขึ้น ·
                ต่ำกว่า 31 วันจะจับก้อนที่ OTA โอนข้ามเดือนไม่ได้เลย
              </small>
            </span>
            <div className="segmented">
              {[7, 14, 30, 45, 60, 90].map((days) => (
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
          <div className="settings-field">
            <span><b>ส่วนต่างที่ถือว่าเป็นการปัดเศษ</b><small>ต่างกันไม่เกินนี้ ระบบเรียกว่าปัดเศษ ไม่ใช่ค่าคอม</small></span>
            <div className="segmented">
              {[0, 1, 5, 20, 100].map((baht) => (
                <button key={baht} className={settings.settlement.roundingSatang === baht * 100 ? "active" : ""} disabled={busy} onClick={() => patchSettlement({ roundingSatang: baht * 100 })}>
                  {baht === 0 ? "ไม่ยอมเลย" : `${baht} บาท`}
                </button>
              ))}
            </div>
          </div>

          <ProviderEditor
            providers={settings.settlement.providers}
            onChange={(providers) => patchSettlement({ providers })}
            disabled={busy}
          />

          <TagEditor
            title="ข้อความที่บอกว่าเป็นก้อนโอนของ OTA แต่ไม่บอกว่าเจ้าไหน"
            hint="ก้อนที่เข้าข่ายแต่ระบุเจ้าไม่ได้ ยังถูกเสนอ เพียงแต่มองเห็นคำจองของทุกเจ้าและไม่มีรอบโอนให้อ้าง"
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

      {section === "organization" && (
        <section className="panel">
          <PanelTitle title="ผู้ออกใบเสร็จรับเงิน" />
          <p className="settings-lead">
            ข้อมูลชุดนี้ไม่มีอยู่ในเอกสารบัญชีฉบับไหนเลย ระบบจึงไม่รู้จักกิจการของใครล่วงหน้า
            และไม่เดาให้ — กรอกให้ครบก่อนถึงจะออกใบเสร็จได้ ใบที่ออกไปแล้วเก็บข้อมูลชุดนี้ไว้เป็นสำเนา
            แก้ตรงนี้ทีหลังจึงมีผลกับใบที่ออกใหม่เท่านั้น
          </p>
          <TextField
            label="ชื่อผู้ออกใบเสร็จ"
            hint="ชื่อนิติบุคคลตามที่จดทะเบียน"
            value={settings.organization.name}
            onChange={(name) => patch({ organization: { ...settings.organization, name } })}
            disabled={busy}
          />
          <TextField
            label="เลขประจำตัวผู้เสียภาษี"
            hint="13 หลัก ใส่แต่ตัวเลขก็ได้"
            value={settings.organization.taxId}
            onChange={(taxId) => patch({ organization: { ...settings.organization, taxId } })}
            disabled={busy}
          />
          <TextField
            label="สำนักงาน"
            hint="เช่น สำนักงานใหญ่ หรือชื่อสาขา"
            value={settings.organization.branch}
            onChange={(branch) => patch({ organization: { ...settings.organization, branch } })}
            disabled={busy}
          />
          <TextField
            label="ที่อยู่"
            hint="ที่อยู่ที่จะพิมพ์บนหัวใบเสร็จ"
            value={settings.organization.address}
            onChange={(address) => patch({ organization: { ...settings.organization, address } })}
            disabled={busy}
          />
          <TextField
            label="โทรศัพท์"
            hint="ไม่บังคับ"
            value={settings.organization.phone}
            onChange={(phone) => patch({ organization: { ...settings.organization, phone } })}
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
              <span>
                <b>ค่าประกันวัน Check-in</b>
                <small>
                  จำนวนเงินที่ลูกค้าโอนเพิ่มจากค่าห้องในวัน Check-in ·
                  ระบบจับคู่ให้เมื่อเงินเข้าเท่ากับค่าห้องบวกจำนวนนี้พอดี และวันที่รับเงินกับวันที่เงินเข้าตรงกับวัน Check-in
                  {!depositOn && <em> · ปิดอยู่ — เงินเข้าที่มากกว่าค่าห้องพอดีหนึ่งค่าประกันจะกลายเป็นรายการค้าง</em>}
                </small>
              </span>
              {/* ช่องจำนวนเงินยังอ่านได้ตอนกฎถูกปิด เพื่อให้เห็นว่าเปิดกลับมาแล้วจะได้เท่าไหร่ */}
              <span className="field-controls">
                <BahtField
                  label="ค่าประกันวัน Check-in"
                  satang={settings.matching.securityDepositSatang}
                  disabled={busy || !depositOn}
                  onCommit={(next) => patchMatching({ securityDepositSatang: next })}
                />
                <Switch
                  checked={depositOn}
                  onChange={(next) => patchMatching({ securityDepositEnabled: next })}
                  label="เปิดใช้กฎค่าประกันวัน Check-in"
                  disabled={busy}
                />
              </span>
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

/**
 * ผูกบัญชีธนาคารกับช่องทางรับเงิน
 *
 * เอกสารธนาคารบอกได้แค่เลขที่บัญชี ส่วนชื่อช่องทางรับเงินที่ PMS ใช้ ("KbankGL885")
 * ไม่มีอยู่ในเอกสารของฝั่งไหนเลย ระบบเดาไม่ได้และไม่ควรเดา — บัญชีที่ผูกผิดคือ
 * รายการทั้งเดือนไปกระทบยอดกับบัญชีผิดใบ
 *
 * เพราะการผูกอยู่ตรงนี้ การเพิ่มธนาคารหรือบัญชีใหม่จึงไม่ต้องแก้โค้ด
 */
function AccountsSection({ accounts, unmapped, disabled, onChange }: {
  accounts: BankAccount[];
  unmapped: UnmappedAccount[];
  disabled: boolean;
  onChange: (next: BankAccount[]) => void;
}) {
  const [draft, setDraft] = useState<BankAccount | null>(null);

  const save = (next: BankAccount) => {
    const digits = (value: string) => value.replace(/\D/g, "");
    const rest = accounts.filter((item) => digits(item.accountNo) !== digits(next.accountNo));
    onChange([...rest, next].filter((item) => item.accountNo.trim() && item.method.trim()));
    setDraft(null);
  };

  return (
    <>
      {unmapped.length > 0 && (
        <Banner tone="amber" title={`มีบัญชี ${unmapped.length} ใบที่ยังไม่ได้ผูกช่องทางรับเงิน`}>
          Statement ของบัญชีเหล่านี้อยู่ในระบบแล้ว แต่ยังจับคู่กับรายการรับเงินไม่ได้
          จนกว่าจะบอกระบบว่าบัญชีนี้ตรงกับช่องทางรับเงินชื่ออะไรในรายงานของคุณ
        </Banner>
      )}

      <section className="panel">
        <PanelTitle
          title="บัญชีธนาคารที่ผูกไว้"
          action={<Pill tone={accounts.length ? "green" : "slate"}>{accounts.length} บัญชี</Pill>}
        />
        <p className="settings-lead">
          ระบบอ่านเลขที่บัญชีจากในเอกสารเอง แต่ไม่มีทางรู้ว่าบัญชีนั้นคือช่องทางรับเงินชื่ออะไรในรายงานของ PMS
          — ตรงนี้คือที่ที่บอกมัน · ธนาคารไหนก็เพิ่มได้ ตราบใดที่ระบบอ่านรูปแบบ Statement ของธนาคารนั้นออก
        </p>

        <div className="account-list">
          {!accounts.length && !unmapped.length && (
            <p className="table-note">ยังไม่มีบัญชีที่ผูกไว้ · อัปโหลด Statement แล้วบัญชีจะมาโผล่ที่นี่ให้ผูก</p>
          )}

          {accounts.map((account) => (
            <div key={account.accountNo} className="account-row">
              <p>
                <b>{account.label || account.code || account.accountNo}</b>
                <small className="mono">{account.accountNo}</small>
              </p>
              <span className="account-method">{account.method}</span>
              <button
                className="ghost-button"
                disabled={disabled}
                onClick={() => onChange(accounts.filter((item) => item.accountNo !== account.accountNo))}
              >
                เอาออก
              </button>
            </div>
          ))}

          {unmapped.map((account) => (
            <div key={account.accountNo} className="account-row pending">
              <p>
                <b>{account.accountName || `บัญชี ${account.code}`}</b>
                <small className="mono">{account.accountNo} · {account.bankLabel}</small>
              </p>
              <span className="account-method missing">ยังไม่ได้ผูก</span>
              <button
                className="small-primary"
                disabled={disabled}
                onClick={() => setDraft({ accountNo: account.accountNo, code: account.code, method: "", label: account.accountName })}
              >
                ผูกช่องทาง
              </button>
            </div>
          ))}
        </div>

        {draft && (
          <div className="account-editor">
            <b>ผูกบัญชี {draft.accountNo}</b>
            <label>
              <span>ช่องทางรับเงินในรายงาน</span>
              <input
                value={draft.method}
                disabled={disabled}
                placeholder="เช่น KbankGL885"
                onChange={(event) => setDraft({ ...draft, method: event.target.value })}
              />
            </label>
            <label>
              <span>ชื่อเรียกสั้น</span>
              <input
                value={draft.code}
                disabled={disabled}
                placeholder="เช่น 885"
                onChange={(event) => setDraft({ ...draft, code: event.target.value })}
              />
            </label>
            <div className="account-editor-actions">
              <button className="ghost-button" onClick={() => setDraft(null)} disabled={disabled}>ยกเลิก</button>
              <button className="primary-button" disabled={disabled || !draft.method.trim()} onClick={() => save(draft)}>
                บันทึกการผูก
              </button>
            </div>
            <small>
              ชื่อช่องทางต้องตรงกับที่พิมพ์อยู่ในคอลัมน์ Payment Method ของรายงานการรับเงิน
              เปลี่ยนแล้วระบบกระทบยอดใหม่ทันที ไม่ต้องอัปโหลดเอกสารซ้ำ
            </small>
          </div>
        )}
      </section>
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

/**
 * ช่องกรอกเงินเป็นบาท ที่เก็บค่าเป็นสตางค์
 *
 * บันทึกตอนออกจากช่องหรือกด Enter ไม่ใช่ทุกตัวอักษรที่พิมพ์ — การบันทึกหนึ่งครั้ง
 * คือการเขียนลงเซิร์ฟเวอร์แล้วกระทบยอดใหม่ทั้งระบบ พิมพ์ "5000" จึงต้องไม่กลายเป็น
 * ห้ารอบที่ค่าประกันเป็น 5, 50, 500, 5000 ตามลำดับ
 *
 * รับเฉพาะจำนวนเต็มตั้งแต่ 1 บาทขึ้นไป ค่าที่ใช้ไม่ได้จะเด้งกลับเป็นค่าที่บันทึกไว้
 * แทนที่จะบันทึกของเสีย — การปิดกฎเป็นหน้าที่ของสวิตช์ข้าง ๆ ไม่ใช่การพิมพ์ศูนย์
 */
function BahtField({ label, satang, disabled, onCommit }: {
  label: string;
  satang: number;
  disabled: boolean;
  onCommit: (satang: number) => void;
}) {
  const asBaht = (value: number) => String(Math.round(value / 100));
  const [draft, setDraft] = useState(asBaht(satang));
  const [touched, setTouched] = useState(false);

  // ค่าที่เซิร์ฟเวอร์ตอบกลับมาเป็นความจริง เมื่อผู้ใช้ไม่ได้กำลังพิมพ์อยู่
  const shown = touched ? draft : asBaht(satang);

  const commit = () => {
    setTouched(false);
    const baht = Number(draft);
    if (!Number.isFinite(baht) || !Number.isInteger(baht) || baht < 1) {
      setDraft(asBaht(satang));
      return;
    }
    const next = baht * 100;
    setDraft(String(baht));
    if (next !== satang) onCommit(next);
  };

  return (
    <span className="baht-field">
      <input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        aria-label={label}
        value={shown}
        disabled={disabled}
        onChange={(event) => { setTouched(true); setDraft(event.target.value); }}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
      />
      <em>บาท</em>
    </span>
  );
}

/**
 * รอบโอนของ OTA แต่ละเจ้า
 *
 * สามอย่างที่ต่างกันจริงระหว่างเจ้า และเป็นสามอย่างที่ตัดสินว่าข้อเสนอถูกหรือผิด:
 * ข้อความบน statement ที่บอกว่าก้อนเป็นของใคร, ช่องทางรับเงินฝั่งสมุดบัญชีของเจ้านั้น,
 * และวันที่เจ้านั้นใช้ตั้งรอบโอน ที่เหลือเป็นแค่ตัวเลขช่วงวัน
 */
function TextField({ label, hint, value, onChange, disabled }: {
  label: string; hint: string; value: string; onChange: (next: string) => void; disabled: boolean;
}) {
  return (
    <label className="settings-field text-field">
      <span><b>{label}</b><small>{hint}</small></span>
      <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ProviderEditor({ providers, onChange, disabled }: {
  providers: SettlementProvider[]; onChange: (next: SettlementProvider[]) => void; disabled: boolean;
}) {
  const patchAt = (index: number, partial: Partial<SettlementProvider>) =>
    onChange(providers.map((item, at) => (at === index ? { ...item, ...partial } : item)));

  return (
    <div className="provider-editor">
      <b>รอบโอนของแต่ละ OTA</b>
      <small>
        ก้อนหนึ่งก้อนจะมองเห็นเฉพาะคำจองที่รับเงินผ่านช่องทางของเจ้าที่ตรงกับข้อความบน statement
        ส่วนช่วงวันใช้จัดลำดับและติดป้ายว่าใบไหนอยู่นอกรอบ ไม่ได้ตัดคำจองทิ้ง — ที่ตัดจริงคือ
        ก้อนโอนต้องเข้าบัญชี <em>หลัง</em> วันตั้งต้นเสมอ
      </small>

      {!providers.length && <span className="table-note">ยังไม่ได้ตั้งเจ้าไหนไว้เลย</span>}

      {providers.map((provider, index) => (
        <div key={provider.id} className="provider-card">
          <div className="provider-head">
            <b>{provider.label}</b>
            <span className="table-note">{provider.note}</span>
          </div>

          <div className="settings-field">
            <span><b>วันตั้งต้นของรอบโอน</b><small>วันที่เจ้านี้ใช้นับ ไม่ใช่วันที่เราบันทึกรับเงิน</small></span>
            <div className="segmented">
              {([["checkOut", "วันเช็คเอาท์"], ["checkIn", "วันเช็คอิน"], ["date", "วันที่รับเงิน"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={provider.anchor === value ? "active" : ""}
                  disabled={disabled}
                  onClick={() => patchAt(index, { anchor: value })}
                >{label}</button>
              ))}
            </div>
          </div>

          <div className="settings-field">
            <span>
              <b>รอบโอนปกติ</b>
              <small>
                โอนหลังวันตั้งต้นกี่วัน · ตอนนี้ {provider.typicalLagDays[0]}–{provider.typicalLagDays[1]} วัน
                และยอมรับได้ถึง {provider.maxLagDays} วัน
              </small>
            </span>
            <div className="segmented">
              {([[0, 1], [1, 3], [7, 10], [10, 14]] as const).map(([low, high]) => (
                <button
                  key={`${low}-${high}`}
                  className={provider.typicalLagDays[0] === low && provider.typicalLagDays[1] === high ? "active" : ""}
                  disabled={disabled}
                  onClick={() => patchAt(index, {
                    typicalLagDays: [low, high],
                    maxLagDays: Math.max(provider.maxLagDays, high),
                  })}
                >{low}–{high} วัน</button>
              ))}
            </div>
          </div>

          <TagEditor
            title={`ข้อความบน statement ที่บอกว่าเป็นก้อนของ ${provider.label}`}
            hint="เทียบกับช่องทาง คำอธิบาย และรายละเอียดของเงินเข้าแต่ละบรรทัด"
            values={provider.patterns}
            onChange={(patterns) => patchAt(index, { patterns })}
            disabled={disabled}
          />
          <TagEditor
            title={`ช่องทางรับเงินของ ${provider.label}`}
            hint="เฉพาะรายการที่รับเงินผ่านช่องทางเหล่านี้เท่านั้นที่จะถูกเสนอเข้าก้อนของเจ้านี้"
            values={provider.methods}
            onChange={(methods) => patchAt(index, { methods })}
            disabled={disabled}
          />
          <TextField
            label="ชื่อผู้จ่ายบนใบเสร็จ"
            hint={`ชื่อนิติบุคคลที่จะพิมพ์ลงใบเสร็จ · เว้นว่างคือใช้ "${provider.label}" · ไม่มีผลกับการจับคู่`}
            value={provider.payerName}
            onChange={(payerName) => patchAt(index, { payerName })}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
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
  const { raw, dataset, settings, online } = useWorkspace();
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
          <span><small>ที่เก็บข้อมูล</small><b>{online ? "Neon Postgres" : "ยังไม่ได้ต่อฐานข้อมูล"}</b></span>
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
