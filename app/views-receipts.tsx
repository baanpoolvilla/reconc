"use client";

import { useEffect, useState } from "react";
import { Banner, EmptyState, PageHeading, PanelTitle, Pill, useWorkspace } from "./ui";
import { baht, thaiDate } from "../lib/dataset";
import { RECEIPT_DOCUMENT_LABEL, missingOrganizationFields } from "../lib/issued-receipts.mjs";

// ใบเสร็จรับเงินของก้อนโอน OTA
//
// หนึ่งก้อนที่กระทบยอดแล้ว = ใบเสร็จหนึ่งใบ ระบบไม่ออกใบให้ก้อนที่ยังไม่ได้กระทบ
// ยอด เพราะนั่นคือการรับรองเงินที่ยังไม่รู้ว่าเป็นของคำจองไหน
//
// ไฟล์ PDF ออกทางหน้าพิมพ์ของเบราว์เซอร์ ไม่ใช่ตัวเขียน PDF ในระบบ — เอกสารที่
// ส่งให้คนนอกต้องมีฟอนต์ไทยฝังมาจริงและตัดบรรทัดถูก ซึ่งเบราว์เซอร์ทำได้ถูกต้อง
// อยู่แล้ว ส่วนตัวเขียน PDF ที่มีอยู่ในระบบสร้างไฟล์ที่ตัวอ่านของเราเองอ่านออก
// แต่โปรแกรมอ่าน PDF ทั่วไปเปิดแล้วไม่เห็นตัวอักษร ใช้ออกเอกสารจริงไม่ได้
//
// สิ่งที่เป็นทางการคือแถวในฐานข้อมูล ไม่ใช่ไฟล์: เลขที่ ตัวเลข และสำเนาแช่แข็งของ
// เอกสารถูกเก็บไว้ตอนกดออกใบ พิมพ์ใหม่กี่ครั้งก็ได้ใบเดิมเสมอ

type IssuedReceipt = {
  number: string;
  decisionId: string;
  payerName: string;
  date: string;
  period: string;
  grossSatang: number;
  deductionSatang: number;
  netSatang: number;
  issuedBy: string;
  issuedAt: string;
  voidedAt: string;
  voidReason: string;
  document: ReceiptDocument;
};

type ReceiptDocument = {
  documentLabel: string;
  number: string;
  date: string;
  issuedAt: string;
  issuer: { name: string; taxId: string; branch: string; address: string; phone: string };
  payer: { name: string; taxId: string; providerId: string };
  payment: { method: string; accountNo: string; accountName: string; accountCode: string; detail: string };
  lines: {
    reservationNo: string; guest: string; roomType: string; roomNumber: string;
    checkIn: string; checkOut: string; receiptDate: string; amountSatang: number;
  }[];
  grossSatang: number;
  deductionSatang: number;
  deductionLabel: string;
  netSatang: number;
  note: string;
};

type Pending = {
  decisionId: string;
  date: string;
  account: string;
  payerHint: string;
  bookingCount: number;
  grossSatang: number;
  netSatang: number;
  deductionSatang: number;
  blockers: string[];
};

const taxIdDisplay = (value: string) =>
  value?.length === 13 ? `${value[0]}-${value.slice(1, 5)}-${value.slice(5, 10)}-${value.slice(10, 12)}-${value[12]}` : value;

export function Receipts() {
  const { go, notify, online, settings } = useWorkspace();
  const [issued, setIssued] = useState<IssuedReceipt[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [openNumber, setOpenNumber] = useState<string | null>(null);

  // `loading` คือ "ยังไม่เคยอ่านสำเร็จสักครั้ง" ส่วนสถานะระหว่างกดปุ่มคือ `working`
  // การอ่านซ้ำหลังออกใบหรือยกเลิกใบ ทำด้วยการขยับ `reloadToken` ไม่ใช่เรียก
  // ฟังก์ชันโหลดตรง ๆ — effect จึงเป็นที่เดียวที่ยิงคำขอ และยกเลิกได้เมื่อออกจากหน้า
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/receipts")
      .then((response) => response.json())
      .then((body) => {
        if (!alive) return;
        setIssued(body.issued ?? []);
        setPending(body.pending ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
        notify("อ่านรายการใบเสร็จไม่สำเร็จ", "red");
      });
    return () => { alive = false; };
  }, [notify, reloadToken]);

  const post = async (payload: Record<string, unknown>, success: string) => {
    setWorking(true);
    try {
      const response = await fetch("/api/receipts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        notify(body.error ?? "ทำรายการไม่สำเร็จ", "red");
        return null;
      }
      notify(success);
      setReloadToken((token) => token + 1);
      return body.receipt as IssuedReceipt;
    } catch {
      notify("ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ", "red");
      return null;
    } finally {
      setWorking(false);
    }
  };

  const missing = missingOrganizationFields(settings.organization);
  const open = issued.find((item) => item.number === openNumber) ?? null;

  if (!online) {
    return (
      <>
        <PageHeading title={RECEIPT_DOCUMENT_LABEL} action={<button className="ghost-button" onClick={() => go("home")}>← กลับหน้าแรก</button>} />
        <Banner tone="amber" title="ออกใบเสร็จในโหมดเก็บในเครื่องไม่ได้">
          เลขที่เอกสารต้องเดินต่อกันจากที่เดียว ถ้าแต่ละเครื่องรันเลขของตัวเอง สมุดเลขจะซ้ำกันโดยไม่มีใครรู้
          ตั้งค่า <code>DATABASE_URL</code> ก่อนแล้วกลับมาหน้านี้อีกครั้ง
        </Banner>
      </>
    );
  }

  return (
    <>
      <PageHeading
        title={RECEIPT_DOCUMENT_LABEL}
        description="ก้อนโอนที่กระทบยอดแล้วหนึ่งก้อน ออกใบเสร็จรับเงินให้ OTA เจ้าของก้อนนั้นได้หนึ่งใบ"
        action={<button className="ghost-button" onClick={() => go("home")}>← กลับหน้าแรก</button>}
      />

      {missing.length > 0 && (
        <Banner tone="amber" title="ยังออกใบเสร็จไม่ได้ — ข้อมูลผู้ออกยังไม่ครบ" action={
          <button className="small-primary" onClick={() => go("settings")}>ไปกรอกในหน้าตั้งค่า</button>
        }>
          ขาด {missing.join(" · ")} — เอกสารที่ส่งให้คนนอกต้องบอกได้ว่าใครเป็นคนออก
        </Banner>
      )}

      <Banner tone="blue" title="ใบที่ออกไปแล้วเปลี่ยนไม่ได้">
        ตัวเลขบนใบถูกเก็บเป็นสำเนาตั้งแต่วินาทีที่กดออก อัปโหลดเอกสารเดือนนั้นใหม่หรือแก้การตั้งค่าทีหลัง ก็ไม่ทำให้ใบที่ส่งไปแล้วเปลี่ยนตาม
        ใบที่ผิดต้องกด <b>ยกเลิก</b> พร้อมเหตุผล แล้วออกใบใหม่ — เลขที่ถูกยกเลิกไม่ถูกนำกลับมาใช้ซ้ำ
      </Banner>

      {loading && <p className="table-note">กำลังอ่านรายการ…</p>}

      {!loading && (
        <section className="panel">
          <PanelTitle title={`ก้อนที่กระทบยอดแล้วและยังไม่ได้ออกใบ · ${pending.length} ก้อน`} />
          {!pending.length && (
            <EmptyState
              title="ไม่มีก้อนที่รอออกใบเสร็จ"
              detail="ก้อนโอนที่กระทบยอดแล้วทุกก้อนมีใบเสร็จครบ หรือยังไม่มีก้อนไหนถูกยืนยัน"
              action={<button className="primary-button" onClick={() => go("ota")}>ไปหน้าก้อนโอน OTA</button>}
            />
          )}
          {pending.length > 0 && (
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>วันที่รับเงิน</th><th>ผู้จ่าย</th><th className="num">คำจอง</th>
                    <th className="num">ยอดตามรายการ</th><th className="num">ส่วนต่าง</th><th className="num">รับสุทธิ</th><th />
                  </tr>
                </thead>
                <tbody>
                  {pending.map((row) => (
                    <tr key={row.decisionId}>
                      <td>{thaiDate(row.date)}<small className="mono"> ·••{row.account}</small></td>
                      <td className="wrap">{row.payerHint || "—"}</td>
                      <td className="num">{row.bookingCount}</td>
                      <td className="num">{baht(row.grossSatang)}</td>
                      <td className="num">{row.deductionSatang ? baht(row.deductionSatang) : "—"}</td>
                      <td className="num"><b>{baht(row.netSatang)}</b></td>
                      <td className="num">
                        <button
                          className="small-primary"
                          disabled={working || row.blockers.length > 0}
                          title={row.blockers.join(" · ")}
                          onClick={async () => {
                            const receipt = await post({ action: "issue", decisionId: row.decisionId }, "ออกใบเสร็จเรียบร้อย");
                            if (receipt) setOpenNumber(receipt.number);
                          }}
                        >ออกใบเสร็จ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && issued.length > 0 && (
        <section className="panel">
          <PanelTitle title={`ใบที่ออกไปแล้ว · ${issued.length} ใบ`} />
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>เลขที่</th><th>วันที่รับเงิน</th><th>ผู้จ่าย</th>
                  <th className="num">รับสุทธิ</th><th>สถานะ</th><th />
                </tr>
              </thead>
              <tbody>
                {issued.map((row) => (
                  <tr key={row.number} className={row.voidedAt ? "muted-row" : ""}>
                    <td className="mono">{row.number}</td>
                    <td>{thaiDate(row.date)}</td>
                    <td className="wrap">{row.payerName}</td>
                    <td className="num">{baht(row.netSatang)}</td>
                    <td>
                      {row.voidedAt
                        ? <Pill tone="red">ยกเลิกแล้ว</Pill>
                        : <Pill tone="green">ใช้ได้</Pill>}
                    </td>
                    <td className="num">
                      <button className="ghost-button" onClick={() => setOpenNumber(row.number)}>เปิดดู</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {open && (
        <ReceiptSheet
          receipt={open}
          working={working}
          onClose={() => setOpenNumber(null)}
          onVoid={async (reason) => { await post({ action: "void", number: open.number, reason }, "ยกเลิกใบเสร็จแล้ว"); }}
        />
      )}
    </>
  );
}

/**
 * ตัวเอกสาร — หน้าจอเดียวกับที่พิมพ์ออกไป
 *
 * ทุกตัวเลขบนใบนี้อ่านจาก `receipt.document` ซึ่งเป็นสำเนาที่แช่แข็งไว้ตอนออกใบ
 * ไม่ใช่คำนวณใหม่จากข้อมูลปัจจุบัน นั่นคือเหตุผลที่พิมพ์ใบเดิมอีกปีให้หลังก็ยัง
 * ได้ตัวเลขชุดเดิม
 */
function ReceiptSheet({ receipt, working, onClose, onVoid }: {
  receipt: IssuedReceipt;
  working: boolean;
  onClose: () => void;
  onVoid: (reason: string) => Promise<void>;
}) {
  const document = receipt.document;
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <section className="receipt-shell">
      <div className="receipt-toolbar no-print">
        <button className="ghost-button" onClick={onClose}>← กลับไปรายการ</button>
        <div>
          {!receipt.voidedAt && (
            <button className="ghost-button" onClick={() => setVoiding((value) => !value)} disabled={working}>ยกเลิกใบนี้</button>
          )}
          <button className="primary-button" onClick={() => window.print()}>พิมพ์ / บันทึกเป็น PDF</button>
        </div>
      </div>

      {voiding && !receipt.voidedAt && (
        <div className="receipt-void no-print">
          <p>เขียนเหตุผลที่ยกเลิก — เลขที่ {receipt.number} จะยังถูกใช้ไปแล้ว และไม่ถูกนำกลับมาใช้ซ้ำ</p>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เช่น ออกผิดก้อน / ชื่อผู้จ่ายผิด" />
          <button
            className="small-primary"
            disabled={working || !reason.trim()}
            onClick={async () => { await onVoid(reason.trim()); setVoiding(false); setReason(""); }}
          >ยืนยันยกเลิก</button>
        </div>
      )}

      <article className={`receipt-sheet ${receipt.voidedAt ? "voided" : ""}`}>
        {receipt.voidedAt && <div className="receipt-stamp">ยกเลิก</div>}

        <header className="receipt-top">
          <div>
            <b>{document.issuer.name}</b>
            {document.issuer.address && <p className="receipt-address">{document.issuer.address}</p>}
            <p>
              เลขประจำตัวผู้เสียภาษี {taxIdDisplay(document.issuer.taxId)}
              {document.issuer.branch && <> · {document.issuer.branch}</>}
            </p>
            {document.issuer.phone && <p>โทร. {document.issuer.phone}</p>}
          </div>
          <div className="receipt-title">
            <h2>{document.documentLabel}</h2>
            <p>เลขที่ <b className="mono">{document.number}</b></p>
            <p>วันที่ {thaiDate(document.date)}</p>
          </div>
        </header>

        <div className="receipt-payer">
          <span><small>ได้รับเงินจาก</small><b>{document.payer.name}</b></span>
          {document.payer.taxId && <span><small>เลขประจำตัวผู้เสียภาษี</small><b>{taxIdDisplay(document.payer.taxId)}</b></span>}
          <span>
            <small>ชำระโดย</small>
            <b>{document.payment.method} •••{document.payment.accountCode}</b>
          </span>
        </div>

        <table className="receipt-table">
          <thead>
            <tr>
              <th>#</th><th>เลขที่การจอง</th><th>ผู้เข้าพัก</th><th>เข้าพัก</th><th className="num">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {document.lines.map((line, index) => (
              <tr key={line.reservationNo}>
                <td>{index + 1}</td>
                <td className="mono">{line.reservationNo}</td>
                <td className="wrap">{line.guest || "—"}{line.roomType && <small> · {line.roomType}</small>}</td>
                <td>{line.checkIn ? `${thaiDate(line.checkIn)} – ${thaiDate(line.checkOut)}` : "—"}</td>
                <td className="num">{baht(line.amountSatang)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>ยอดตามรายการ</td>
              <td className="num">{baht(document.grossSatang)}</td>
            </tr>
            {document.deductionSatang !== 0 && (
              <tr>
                <td colSpan={4}>หัก {document.deductionLabel || "ส่วนต่าง"}</td>
                <td className="num">{baht(-document.deductionSatang)}</td>
              </tr>
            )}
            <tr className="receipt-total">
              <td colSpan={4}>รับเงินสุทธิ</td>
              <td className="num">{baht(document.netSatang)}</td>
            </tr>
          </tfoot>
        </table>

        {document.note && <p className="receipt-note">หมายเหตุ: {document.note}</p>}

        <footer className="receipt-foot">
          <div>
            <small>อ้างอิงรายการเดินบัญชี</small>
            <p className="wrap">{document.payment.detail || "—"}</p>
            <p>บัญชี {document.payment.accountNo} · {document.payment.accountName}</p>
          </div>
          <div className="receipt-sign">
            <span />
            <small>ผู้รับเงิน</small>
          </div>
        </footer>

        {receipt.voidedAt && <p className="receipt-note">ยกเลิกเมื่อ {receipt.voidedAt} · เหตุผล: {receipt.voidReason}</p>}
      </article>
    </section>
  );
}
