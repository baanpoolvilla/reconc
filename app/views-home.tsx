"use client";

import { useState } from "react";
import { Banner, EmptyState, PageHeading, PanelTitle, Pill, Progress, Stat, TaskCard, useWorkspace } from "./ui";
import { baht, thaiDate, thaiDateTime, thaiMonthLabel } from "../lib/dataset";
import { DECISION_REASONS, type DecisionReason } from "../lib/settings";

// หน้าแรก — กล่องงาน
//
// คำถามเดียวที่หน้านี้ต้องตอบคือ "วันนี้ต้องทำอะไรบ้าง แล้วเหลืออีกเท่าไหร่"
// ตัวเลขอื่นทั้งหมดไปอยู่หน้ารายงาน

export function Home() {
  const { dataset, effective, hasData, online, go } = useWorkspace();
  const { summary, exceptions } = dataset.reconciliation;

  const receiptSide = exceptions.filter((item) => item.receiptId).length;
  const bankSide = exceptions.filter((item) => item.reason === "UNMATCHED_BANK_CREDIT").length;
  const settlements = effective.settlements.length;
  const settlementSatang = effective.settlements.reduce((sum, item) => sum + item.netSatang, 0);
  const done = summary.matchedReceipts;
  const total = summary.inScopeReceipts;
  const staleCount = summary.staleDecisions ?? 0;

  if (!hasData) {
    return (
      <>
        <PageHeading title="ยินดีต้อนรับ" description="ระบบพร้อมใช้งานแล้ว เหลือแค่ใส่เอกสารเข้าไป" />
        <EmptyState
          icon="↑"
          title="ยังไม่มีเอกสารในระบบ"
          detail="ต้องใช้สี่ไฟล์: บัญชีแยกประเภท รายงานการรับเงิน และ Statement ธนาคารสองบัญชี"
          action={<button className="primary-button" onClick={() => go("upload")}>ไปหน้านำเข้าเอกสาร</button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeading
        title={`รอบ${thaiMonthLabel(dataset.meta.period)}`}
        description="ทำงานที่ค้างให้หมด แล้วรอบนี้ก็ปิดได้"
        action={<Pill tone={online ? "green" : "amber"}>{online ? "ออนไลน์ · ทุกเครื่องเห็นตรงกัน" : "เก็บในเครื่องนี้เท่านั้น"}</Pill>}
      />

      <Progress done={done} total={total} label="รายการที่กระทบยอดแล้ว" />

      {staleCount > 0 && (
        <Banner tone="amber" title={`มีการจับคู่ที่เคยยืนยันไว้ ${staleCount} รายการใช้ไม่ได้แล้ว`}>
          เอกสารที่อัปโหลดใหม่ไม่มีแถวที่การจับคู่นั้นอ้างถึง ระบบจึงไม่นำมาคิด — ดูและลบทิ้งได้ที่ด้านล่างของหน้านี้
        </Banner>
      )}

      <section className="task-grid">
        <TaskCard
          tone="red"
          icon="≠"
          title="รับเงินแล้ว แต่หาเงินเข้าไม่เจอ"
          detail="เปิดดูทีละรายการ ระบบเสนอก้อนที่น่าจะใช่ให้"
          count={receiptSide}
          unit="รายการ"
          amount={baht(summary.unexplainedReceiptSatang)}
          action="เริ่มเคลียร์"
          onClick={() => go("fix")}
          disabled={receiptSide === 0}
        />
        <TaskCard
          tone="amber"
          icon="⊞"
          title="ก้อนโอนจาก OTA รอแตกยอด"
          detail="Airbnb Trip.com Booking.com โอนรวมก้อนหลังหักค่าคอม"
          count={settlements}
          unit="ก้อน"
          amount={baht(settlementSatang)}
          action="แตกยอด"
          onClick={() => go("ota")}
          disabled={settlements === 0}
        />
        <TaskCard
          tone="blue"
          icon="?"
          title="เงินเข้าแต่ไม่รู้ว่าของใคร"
          detail="เงินเข้าบัญชีที่ยังไม่มีรายการรับเงินรองรับ"
          count={bankSide}
          unit="รายการ"
          amount={baht(summary.unexplainedBankSatang)}
          action="ตรวจสอบ"
          onClick={() => go("fix")}
          disabled={bankSide === 0}
        />
        <TaskCard
          tone="green"
          icon="✓"
          title="กระทบยอดเรียบร้อยแล้ว"
          detail={`ระบบจับให้เอง ${summary.matchedGroups - (summary.decidedGroups ?? 0)} กลุ่ม · คนยืนยันเอง ${summary.decidedGroups ?? 0} กลุ่ม`}
          count={done}
          unit="รายการ"
          amount={baht(summary.matchedSatang)}
          action="ดูรายงาน"
          onClick={() => go("report")}
        />
      </section>

      <ConfirmedList />

      {effective.excluded.length > 0 && (
        <Banner
          tone="slate"
          title={`ไม่นับ ${effective.excluded.length} รายการตามที่ตั้งค่าไว้ (${baht(effective.excludedSatang)})`}
          action={<button className="ghost-button" onClick={() => go("settings")}>แก้ไข</button>}
        >
          {effective.buckets.map((bucket) => bucket.value).join(" · ")}
        </Banner>
      )}
    </>
  );
}

/** สิ่งที่คนกดยืนยันเอง แยกให้เห็นชัดว่าอันไหนระบบจับ อันไหนคนตัดสิน */
function ConfirmedList() {
  const { dataset, decisions, undoMatch, busy } = useWorkspace();
  const [open, setOpen] = useState(false);
  const groups = dataset.reconciliation.groups.filter((group) => group.decision);
  const stale = dataset.reconciliation.staleDecisions ?? [];

  if (!groups.length && !stale.length) return null;
  const shown = open ? groups : groups.slice(0, 4);

  return (
    <section className="panel">
      <PanelTitle
        title="ที่ยืนยันเอง"
        action={<span className="panel-note">{groups.length} รายการ · ผลต่างที่รับไว้รวม {baht(dataset.reconciliation.summary.acceptedDifferenceSatang ?? 0)}</span>}
      />
      <div className="confirmed-list">
        {shown.map((group) => (
          <div key={group.id} className="confirmed-row">
            <span className="confirmed-mark">{group.type === "OTA" ? "⊞" : "✓"}</span>
            <span className="confirmed-body">
              <b>{group.receipts.map((row) => row.guest || row.reservationNo).slice(0, 2).join(", ")}
                {group.receipts.length > 2 && ` และอีก ${group.receipts.length - 2}`}</b>
              <small>
                {thaiDate(group.date)} · {group.receipts.length} รายการรับเงิน ↔ {group.lines.length} เงินเข้า
                {group.decision?.decidedAt && ` · ยืนยันเมื่อ ${thaiDateTime(group.decision.decidedAt)}`}
              </small>
            </span>
            <span className="confirmed-figures">
              <b>{baht(group.bankSatang)}</b>
              {group.deltaSatang !== 0 && (
                <em>{DECISION_REASONS[group.decision?.reason as DecisionReason]?.label ?? group.decision?.reason} {baht(Math.abs(group.deltaSatang))}</em>
              )}
            </span>
            <button className="ghost-button" disabled={busy} onClick={() => void undoMatch(group.decision!.id)}>ยกเลิก</button>
          </div>
        ))}
        {stale.map((item) => (
          <div key={item.id} className="confirmed-row stale">
            <span className="confirmed-mark">!</span>
            <span className="confirmed-body">
              <b>ใช้ไม่ได้แล้ว</b>
              <small>อ้างถึงแถวที่ไม่มีอยู่ในเอกสารชุดปัจจุบัน ({item.receiptIds.length} รายการรับเงิน / {item.bankLineIds.length} เงินเข้า)</small>
            </span>
            <span className="confirmed-figures"><b>{baht(item.bankSatang)}</b></span>
            <button className="ghost-button" disabled={busy} onClick={() => void undoMatch(item.id)}>ลบทิ้ง</button>
          </div>
        ))}
      </div>
      {groups.length > 4 && (
        <p className="table-note">
          <button className="text-button" onClick={() => setOpen(!open)}>
            {open ? "ย่อกลับ" : `ดูทั้งหมด ${groups.length} รายการ`}
          </button>
        </p>
      )}
      {decisions.length > 0 && (
        <p className="table-note">ยกเลิกแล้วรายการนั้นจะกลับไปอยู่ในคิวงานตามเดิม เอกสารต้นทางไม่ถูกแตะต้อง</p>
      )}
    </section>
  );
}

// ── รายงาน ────────────────────────────────────────────────────────────────────

export function Report() {
  const { dataset, effective } = useWorkspace();
  const { accounts, summary, groups, outOfScope } = dataset.reconciliation;
  const [account, setAccount] = useState("all");

  const byType = (["1:1", "N:1", "1:N", "MANUAL", "OTA"] as const).map((type) => ({
    type,
    label: { "1:1": "ระบบจับ 1 ต่อ 1", "N:1": "ระบบจับ หลายต่อ 1", "1:N": "ระบบจับ 1 ต่อหลาย", MANUAL: "คนยืนยันเอง", OTA: "แตกยอด OTA" }[type],
    groups: groups.filter((group) => group.type === type),
  })).filter((row) => row.groups.length);

  const visible = account === "all" ? groups : groups.filter((group) => group.account === account);

  const exportCsv = () => {
    const header = [
      "กลุ่ม", "รูปแบบ", "วันที่", "บัญชี", "เลขที่จอง", "ผู้จอง", "ช่องทางรับเงิน",
      "ยอดที่รับมา", "ยอดเงินเข้า", "ผลต่าง", "เหตุผลของผลต่าง", "หมายเหตุ", "ยืนยันเมื่อ",
    ];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const money = (satang: number) => (satang / 100).toFixed(2);
    const rows = visible.flatMap((group) => group.receipts.map((receipt) => [
      group.id, group.type, group.date, group.account,
      receipt.reservationNo, receipt.guest, receipt.method,
      money(receipt.amountSatang), money(group.bankSatang), money(group.deltaSatang),
      group.decision?.reasonLabel ?? "", group.decision?.note ?? "", group.decision?.decidedAt ?? "",
    ].map(escape).join(",")));

    const blob = new Blob([`﻿${[header.map(escape).join(","), ...rows].join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
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
        title="รายงาน"
        description="สรุปผลของรอบนี้ ส่งออกเป็นไฟล์ Excel ได้"
        action={<button className="primary-button" onClick={exportCsv}>⇩ ส่งออกไฟล์ CSV</button>}
      />

      <section className="stat-row">
        <Stat label="กระทบยอดแล้ว" value={`${summary.matchRate}%`} detail={`${summary.matchedReceipts} จาก ${summary.inScopeReceipts} รายการ`} tone="green" />
        <Stat label="ยอดที่ยืนยันแล้ว" value={baht(summary.matchedSatang)} detail={`${summary.matchedGroups} กลุ่ม`} tone="blue" />
        <Stat label="ยังค้างอยู่" value={`${summary.exceptionCount} รายการ`} detail={`ฝั่งรับเงิน ${baht(summary.unexplainedReceiptSatang)}`} tone="red" />
        <Stat
          label="ผลต่างที่รับไว้"
          value={baht(summary.acceptedDifferenceSatang ?? 0)}
          detail={`จากการยืนยันเอง ${summary.decidedGroups ?? 0} กลุ่ม`}
          tone={(summary.acceptedDifferenceSatang ?? 0) === 0 ? "slate" : "amber"}
        />
      </section>

      <div className="two-column">
        <section className="panel">
          <PanelTitle title="จับคู่ได้ด้วยวิธีไหนบ้าง" />
          <div className="breakdown">
            {byType.map((row) => (
              <div key={row.type}>
                <span className={`breakdown-dot ${row.type === "MANUAL" || row.type === "OTA" ? "amber" : "green"}`} />
                <p><b>{row.label}</b><small>{row.groups.reduce((sum, group) => sum + group.receipts.length, 0)} รายการรับเงิน</small></p>
                <span><b>{row.groups.length}</b><small>{baht(row.groups.reduce((sum, group) => sum + group.bankSatang, 0))}</small></span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelTitle title="ช่องทางที่ยังไม่มี Statement" />
          <div className="breakdown">
            {!outOfScope.length && <p className="table-note">ทุกช่องทางมี Statement รองรับแล้ว</p>}
            {outOfScope.map((item) => (
              <div key={item.method}>
                <span className="breakdown-dot slate" />
                <p><b>{item.method}</b><small>{item.count} รายการ</small></p>
                <span><b>{baht(item.amountSatang)}</b></span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelTitle
          title="ยอดคุมของแต่ละบัญชี"
          action={<Pill tone={summary.controlBalanced ? "green" : "red"}>{summary.controlBalanced ? "ตรงทุกบัญชี" : "มีบัญชีไม่ตรง"}</Pill>}
        />
        <div className="responsive-table">
          <table>
            <thead>
              <tr><th>บัญชี</th><th>ยอดยกมา</th><th>เงินเข้า</th><th>เงินออก</th><th>ยอดยกไป</th><th>ผลต่าง</th><th>กระทบยอดแล้ว</th></tr>
            </thead>
            <tbody>
              {accounts.map((row) => (
                <tr key={row.code}>
                  <td><b>•••{row.code}</b><small className="block">{row.branch}</small></td>
                  <td>{baht(row.openingSatang)}</td>
                  <td>{baht(row.creditSatang)}</td>
                  <td>{baht(row.debitSatang)}</td>
                  <td><strong>{baht(row.closingSatang)}</strong></td>
                  <td><Pill tone={row.controlDeltaSatang === 0 ? "green" : "red"}>{baht(row.controlDeltaSatang)}</Pill></td>
                  <td>{row.matchedReceipts}/{row.receiptCount} · {row.matchRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <PanelTitle
          title="ทุกกลุ่มที่กระทบยอดแล้ว"
          action={
            <div className="tabs compact">
              {[{ value: "all", label: "ทุกบัญชี" }, ...accounts.map((row) => ({ value: row.code, label: `•••${row.code}` }))].map((option) => (
                <button key={option.value} className={account === option.value ? "active" : ""} onClick={() => setAccount(option.value)}>{option.label}</button>
              ))}
            </div>
          }
        />
        <div className="responsive-table scroll-table">
          <table>
            <thead>
              <tr><th>วันที่</th><th>รายการรับเงิน</th><th>ยอดที่รับมา</th><th>ยอดเงินเข้า</th><th>ผลต่าง</th><th>วิธีจับคู่</th></tr>
            </thead>
            <tbody>
              {visible.slice(0, 300).map((group) => (
                <tr key={group.id}>
                  <td><b>{thaiDate(group.date)}</b><small className="block mono">{group.id}</small></td>
                  <td>
                    <b>{group.receipts.map((row) => row.guest || row.reservationNo).slice(0, 2).join(", ")}</b>
                    {group.receipts.length > 2 && <small className="block">และอีก {group.receipts.length - 2} รายการ</small>}
                  </td>
                  <td>{baht(group.receiptSatang)}</td>
                  <td><strong>{baht(group.bankSatang)}</strong></td>
                  <td className={group.deltaSatang === 0 ? "zero-delta" : "negative"}>{baht(group.deltaSatang)}</td>
                  <td>
                    <Pill tone={group.decision ? "amber" : "green"}>{group.decision ? (group.type === "OTA" ? "แตกยอด OTA" : "คนยืนยัน") : group.type}</Pill>
                    {group.decision?.reasonLabel && <small className="block">{group.decision.reasonLabel}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length > 300 && <p className="table-note">แสดง 300 จาก {visible.length} กลุ่ม · ส่งออก CSV เพื่อดูทั้งหมด</p>}
      </section>

      <p className="table-note">
        ข้อมูลจาก {dataset.meta.sources.map((item) => item.name).join(" · ")}
        {effective.excluded.length > 0 && ` · ไม่รวม ${effective.excluded.length} รายการที่ตั้งค่าไม่ให้นับ`}
      </p>
    </>
  );
}
