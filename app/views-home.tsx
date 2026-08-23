"use client";

import { Fragment, useState } from "react";
import { Banner, EmptyState, PageHeading, PanelTitle, Pill, Progress, Stat, Step, StepList, type StepState, useWorkspace } from "./ui";
import { type MatchGroup, baht, thaiDate, thaiDateTime, thaiMonthLabel } from "../lib/dataset";
import { ALL_PERIODS, DECISION_REASONS, type DecisionReason } from "../lib/settings";

// หน้าแรก — กล่องงาน
//
// คำถามเดียวที่หน้านี้ต้องตอบคือ "วันนี้ต้องทำอะไรบ้าง แล้วเหลืออีกเท่าไหร่"
// ตัวเลขอื่นทั้งหมดไปอยู่หน้ารายงาน

export function Home() {
  const { dataset, effective, hasData, online, go, period, periods } = useWorkspace();
  const { summary, exceptions, outOfScope } = dataset.reconciliation;

  // ช่องทางที่มีบัญชีธนาคารอยู่แล้ว แต่ยังไม่ได้อัปโหลด statement ของงวดนี้ —
  // ต่างจากเงินที่ OTA เก็บแทนเรา ซึ่งไม่มีบัญชีให้กระทบตั้งแต่ต้น
  const waitingForStatement = outOfScope.filter((item) => item.reason === "MISSING_STATEMENT");
  const waitingCount = waitingForStatement.reduce((sum, item) => sum + item.count, 0);

  const receiptSide = exceptions.filter((item) => item.receiptId).length;
  const bankSide = exceptions.filter((item) => item.reason === "UNMATCHED_BANK_CREDIT").length;
  const settlements = effective.settlements.length;
  const settlementSatang = effective.settlements.reduce((sum, item) => sum + item.netSatang, 0);
  // ก้อนที่ยอดตรงพอดี ชุดเดียว และอยู่ในรอบโอน — กดยืนยันได้โดยไม่ต้องคิดต่อ
  const exactSettlements = effective.settlements.filter((item) => item.status === "EXACT" && !item.ambiguous).length;
  const done = summary.matchedReceipts;
  const total = summary.inScopeReceipts;
  const staleCount = summary.staleDecisions ?? 0;

  // บัญชีที่มี statement อยู่ในระบบแล้ว แต่ยังไม่มีใครบอกว่าตรงกับช่องทางรับเงินไหน
  //
  // นี่คือความเงียบที่แพงที่สุดของระบบ: ทุกอย่างดูปกติ เอกสารขึ้นครบ แต่รายการที่
  // รับเงินผ่านช่องทางนั้นไม่เคยถูกนำมาเทียบกับ statement เลยสักใบ ตัวหารของ
  // แถบความคืบหน้าจึงเหลือไม่กี่ใบ แล้วหน้าจอก็ประกาศว่าเคลียร์ครบ 100%
  // ทั้งที่ยังไม่ได้เริ่มทำงาน
  const unmapped = effective.unmappedAccounts;

  // เอกสารที่รอบนี้มีแล้วและที่ยังขาด — ขั้นที่ 2 ตอบคำถามนี้คำถามเดียว
  const DOC_NEEDS = [
    { kind: "ledger", label: "บัญชีแยกประเภท" },
    { kind: "collection_report", label: "รายงานการรับเงิน" },
    { kind: "bank_statement", label: "Statement ธนาคาร" },
  ];
  const inPeriodSources = dataset.meta.sources.filter((item) => !item.period || period === ALL_PERIODS || item.period === period);
  const missingDocs = DOC_NEEDS
    .filter((need) => !inPeriodSources.some((item) => item.kind.startsWith(need.kind)))
    .map((need) => need.label);
  const loadedDocs = inPeriodSources.length;
  const settledOta = dataset.reconciliation.groups.filter((group) => group.type === "OTA" && group.decision).length;
  const openWork = receiptSide + bankSide;

  // สถานะของแต่ละขั้น — "ทำต่อตรงนี้" มีได้ขั้นเดียวเสมอ คือขั้นแรกที่ยังไม่เสร็จ
  const steps = (() => {
    const accounts: StepState = unmapped.length ? "blocked" : "done";
    const documents: StepState = missingDocs.length ? (accounts === "done" ? "now" : "later") : "done";
    const ready = accounts === "done" && documents === "done";
    const fix: StepState = !openWork ? "done" : ready ? "now" : "later";
    const settlementsState: StepState = !settlements ? "done" : ready ? (fix === "now" ? "later" : "now") : "later";
    const receipts: StepState = settledOta ? "now" : "optional";
    const report: StepState = fix === "done" && settlementsState === "done" ? "now" : "later";
    return { accounts, documents, fix, settlements: settlementsState, receipts, report };
  })();
  // รายการที่ไม่มีบัญชีธนาคารให้กระทบเลย — รวมทั้งเงินที่ OTA เก็บแทนเรา ซึ่งเป็น
  // เรื่องปกติ และช่องทางที่ยังไม่ได้ผูก ซึ่งไม่ปกติ
  const noAccount = outOfScope.filter((item) => item.reason === "NO_BANK_ACCOUNT");
  const outsideCount = noAccount.reduce((sum, item) => sum + item.count, 0) + waitingCount;

  // หน้าจอแรกที่คนใหม่เห็น — บอกลำดับเดียวกับตอนมีข้อมูลแล้ว ไม่ใช่กล่องว่างที่
  // บอกแค่ว่า "ยังไม่มีอะไร" ซึ่งไม่ได้ช่วยให้ใครรู้ว่าต้องเริ่มตรงไหน
  if (!hasData) {
    return (
      <>
        <PageHeading
          title="เริ่มใช้งาน"
          description="ทำสามขั้นนี้ครั้งเดียว จากนั้นทุกเดือนเหลือแค่ใส่เอกสารแล้วเคลียร์งานค้าง"
        />
        <StepList title="เริ่มต้นใช้งาน" note="อ่านคู่มือก่อนได้ ใช้เวลาไม่ถึงห้านาที">
          <Step
            index={1}
            state="now"
            title="อ่านคู่มือการใช้งาน"
            why="อธิบายว่าระบบจับคู่ยังไง ต้องเตรียมไฟล์อะไร และแก้ยังไงเมื่อทำผิด"
            action="เปิดคู่มือ"
            onAction={() => go("help")}
          />
          <Step
            index={2}
            state="later"
            title="ผูกบัญชีธนาคารกับช่องทางรับเงิน"
            why="ทำได้หลังอัปโหลด Statement ครั้งแรก — ระบบจะขึ้นเตือนให้เอง"
            action="ไปตั้งค่า"
            onAction={() => go("settings")}
          />
          <Step
            index={3}
            state="later"
            title="นำเข้าเอกสารของเดือนแรก"
            why="สี่ไฟล์: บัญชีแยกประเภท รายงานการรับเงิน และ Statement ธนาคารสองบัญชี"
            action="นำเข้าเอกสาร"
            onAction={() => go("upload")}
          />
        </StepList>
        <EmptyState
          icon="↑"
          title="ยังไม่มีเอกสารในระบบ"
          detail="ลากไฟล์ทั้งสี่เข้าไปพร้อมกันได้ ระบบดูจากชื่อไฟล์เองว่าเป็นเอกสารชนิดไหน"
          action={<button className="primary-button" onClick={() => go("upload")}>ไปหน้านำเข้าเอกสาร</button>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeading
        title={period === ALL_PERIODS ? `ทุกงวดรวมกัน · ${periods.length} เดือน` : `รอบ${thaiMonthLabel(period)}`}
        description={period === ALL_PERIODS
          ? "ภาพรวมทุกเดือนที่เก็บไว้ · เลือกงวดที่แถบบนเพื่อปิดทีละรอบ"
          : "ทำงานที่ค้างให้หมด แล้วรอบนี้ก็ปิดได้"}
        action={<Pill tone={online ? "green" : "amber"}>{online ? "ออนไลน์ · ทุกเครื่องเห็นตรงกัน" : "เก็บในเครื่องนี้เท่านั้น"}</Pill>}
      />

      <Progress done={done} total={total} label="รายการที่กระทบยอดแล้ว" outside={outsideCount} />

      {staleCount > 0 && (
        <Banner
          tone="amber"
          title={`มีการจับคู่ที่เคยยืนยันไว้ ${staleCount} รายการใช้ไม่ได้แล้ว`}
          action={<button className="ghost-button" onClick={() => go("report")}>ดูรายละเอียด</button>}
        >
          เอกสารที่อัปโหลดใหม่ไม่มีแถวที่การจับคู่นั้นอ้างถึง ระบบจึงไม่นำมาคิด — อัปโหลดไฟล์เดิมกลับมาแล้วมันใช้ได้เอง หรือลบทิ้งที่ด้านล่างของหน้านี้
        </Banner>
      )}

      <StepList
        title={`ลำดับการปิดรอบ${period === ALL_PERIODS ? "" : thaiMonthLabel(period)}`}
        note="ทำจากบนลงล่าง · ขั้นที่ยังไม่ถึงคิวข้ามไปก่อนได้"
      >
        <Step
          index={1}
          state={steps.accounts}
          title="ผูกบัญชีธนาคารกับช่องทางรับเงิน"
          why={unmapped.length
            ? `บัญชี ${unmapped.map((item) => item.code).join(" และ ")} ยังไม่ได้ผูก — รายการของช่องทางนั้นจะไม่ถูกนำมากระทบยอดเลย`
            : "ทำครั้งเดียวจบ ระบบจำไว้ให้ทุกงวดถัดไป"}
          figure={unmapped.length ? `${unmapped.length} บัญชี` : undefined}
          action={unmapped.length ? "ไปผูกบัญชี" : "ดูการตั้งค่า"}
          onAction={() => go("settings")}
        />
        <Step
          index={2}
          state={steps.documents}
          title="นำเข้าเอกสารของรอบนี้"
          why={missingDocs.length
            ? `ยังขาด ${missingDocs.join(" · ")} — ตัวเลขที่เห็นยังไม่ใช่ผลที่สมบูรณ์`
            : "บัญชีแยกประเภท รายงานการรับเงิน และ Statement ธนาคารครบแล้ว"}
          figure={missingDocs.length ? `ขาด ${missingDocs.length} ฉบับ` : `${loadedDocs} ฉบับ`}
          action="นำเข้าเอกสาร"
          onAction={() => go("upload")}
        />
        <Step
          index={3}
          state={steps.fix}
          title="เคลียร์ยอดที่ยังไม่ตรง"
          why={openWork
            ? `รับเงินแล้วหาเงินเข้าไม่เจอ ${receiptSide} รายการ · เงินเข้าไม่รู้ว่าของใคร ${bankSide} รายการ`
            : "ไม่มียอดค้างทั้งสองฝั่ง"}
          figure={openWork ? `${openWork} รายการ` : undefined}
          action="เปิดคิวงาน"
          onAction={() => go("fix")}
        />
        <Step
          index={4}
          state={steps.settlements}
          title="แตกยอดก้อนโอนจาก OTA"
          why={settlements
            ? `${exactSettlements} ก้อนยอดตรงพอดี กดยืนยันได้เลย · อีก ${settlements - exactSettlements} ก้อนต้องดูก่อน`
            : "ไม่มีก้อนโอนค้างอยู่"}
          figure={settlements ? `${settlements} ก้อน · ${baht(settlementSatang)}` : undefined}
          action="แตกยอด"
          onAction={() => go("ota")}
        />
        <Step
          index={5}
          state={steps.receipts}
          title="ออกใบเสร็จรับเงินให้ OTA"
          why={settledOta
            ? `ก้อนที่กระทบยอดแล้ว ${settledOta} ก้อน ออกใบเสร็จได้`
            : "ยังไม่มีก้อนโอนที่กระทบยอดแล้ว"}
          figure={settledOta ? `${settledOta} ก้อน` : undefined}
          action="ไปออกใบเสร็จ"
          onAction={() => go("receipts")}
        />
        <Step
          index={6}
          state={steps.report}
          title="ตรวจรายงานแล้วปิดรอบ"
          why="เช็คยอดคุมของทุกบัญชี แล้วส่งออกไฟล์เก็บไว้"
          action="ดูรายงาน"
          onAction={() => go("report")}
        />
      </StepList>

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

/**
 * รายละเอียดของกลุ่มที่กระทบยอดแล้ว — เอกสารทั้งสามฝั่งวางเรียงกัน
 *
 * ตารางรายงานตอบได้แค่ว่า "จับคู่แล้ว ยอดเท่านี้" ซึ่งพอสำหรับดูภาพรวม แต่ไม่พอ
 * ตอนมีคนถามว่า "ก้อนนี้คือคำจองไหน จองวันไหน เข้าพักวันไหน แล้วเงินเข้ามาบรรทัด
 * ไหนของ statement" — คำถามที่แผนกบัญชีถามจริงทุกครั้งที่ต้องยืนยันตัวเลข
 *
 * สิ่งที่แสดงคือสิ่งที่กลุ่มเก็บไว้ตอนกระทบยอด ไม่ได้ไปอ่านข้อมูลปัจจุบันมาใหม่
 * รายละเอียดที่เห็นจึงเป็นของรอบที่จับคู่จริง ไม่ใช่ของวันที่เปิดดู
 */
function GroupDetail({ group }: { group: MatchGroup }) {
  return (
    <div className="group-detail">
      <div className="detail-grid">
        <section>
          <h4>จากรายงานการรับเงิน</h4>
          {group.receipts.map((row) => (
            <dl key={row.id} className="detail-card">
              <div><dt>เลขที่การจอง</dt><dd className="mono">{row.reservationNo || "—"}</dd></div>
              <div><dt>ผู้เข้าพัก</dt><dd>{row.guest || "—"}</dd></div>
              <div><dt>วันที่รับเงิน</dt><dd>{thaiDate(row.receiptDate)}</dd></div>
              <div><dt>ช่องทางรับเงิน</dt><dd>{row.method || "—"}</dd></div>
              <div><dt>ยอดที่รับมา</dt><dd className="num">{baht(row.amountSatang)}</dd></div>
              <div><dt>ห้อง</dt><dd>{[row.roomNumber, row.roomType].filter(Boolean).join(" · ") || "—"}</dd></div>
              <div><dt>ช่องทางการจอง</dt><dd>{row.channel || "—"}</dd></div>
              <div><dt>แถวในไฟล์</dt><dd className="mono">{row.sourceRow || "—"}</dd></div>
            </dl>
          ))}
        </section>

        <section>
          <h4>จากบัญชีแยกประเภท</h4>
          {group.receipts.map((row) => (
            <dl key={row.id} className="detail-card">
              <div><dt>วันที่สร้างคำจอง</dt><dd>{row.bookingCreatedDate ? thaiDateTime(row.bookingCreatedAt || row.bookingCreatedDate) : "ไม่พบคำจอง"}</dd></div>
              <div><dt>วัน Check-in</dt><dd>{row.checkIn ? thaiDate(row.checkIn) : "—"}</dd></div>
              <div><dt>วัน Check-out</dt><dd>{row.checkOut ? thaiDate(row.checkOut) : "—"}</dd></div>
              <div><dt>จำนวนคืน</dt><dd>{row.bookingNights || "—"}</dd></div>
              <div><dt>สถานะคำจอง</dt><dd>{row.bookingStatus || "—"}</dd></div>
              <div><dt>ยอดรวมคำจอง</dt><dd className="num">{baht(row.bookingTotalSatang)}</dd></div>
              <div><dt>จ่ายมาแล้ว</dt><dd className="num">{baht(row.bookingPaidSatang)}</dd></div>
              <div>
                <dt>ค้างชำระ</dt>
                <dd className={`num ${row.bookingBalanceDueSatang ? "negative" : "zero-delta"}`}>
                  {baht(row.bookingBalanceDueSatang)}
                </dd>
              </div>
            </dl>
          ))}
        </section>

        <section>
          <h4>จาก Statement ธนาคาร</h4>
          {group.lines.map((line) => (
            <dl key={line.id} className="detail-card">
              <div><dt>บัญชี</dt><dd>•••{group.account} · <span className="mono">{group.accountNo}</span></dd></div>
              <div><dt>วันที่เงินเข้า</dt><dd>{thaiDate(line.date)} {line.time} น.</dd></div>
              <div><dt>รายการ</dt><dd>{line.description || "—"}</dd></div>
              <div><dt>ช่องทาง</dt><dd>{line.channel || "—"}</dd></div>
              <div><dt>รายละเอียด</dt><dd className="wrap">{line.detail || "—"}</dd></div>
              <div><dt>ยอดเงินเข้า</dt><dd className="num">{baht(line.amountSatang)}</dd></div>
              <div>
                <dt>ยอดคงเหลือ</dt>
                <dd className="num">{baht(line.balanceBeforeSatang)} → {baht(line.balanceSatang)}</dd>
              </div>
              <div><dt>อยู่ที่</dt><dd className="mono">หน้า {line.page} บรรทัด {line.row}</dd></div>
            </dl>
          ))}
          {group.statementSource && <p className="detail-source">ไฟล์ต้นฉบับ: {group.statementSource}</p>}
        </section>
      </div>

      <div className="detail-proof">
        <h4>ทำไมระบบถึงจับคู่ให้</h4>
        <ul>
          {group.rulesPassed.map((rule) => (
            <li key={rule.id} className={rule.passed ? "ok" : "bad"}>
              <span className="mono">{rule.id}</span>
              <b>{rule.label}</b>
              <em>
                {typeof rule.left === "number" ? baht(rule.left) : rule.left || "—"}
                {" = "}
                {typeof rule.right === "number" ? baht(rule.right) : rule.right || "—"}
              </em>
            </li>
          ))}
        </ul>
        {group.decision && (
          <p className="detail-decision">
            คนยืนยันเอง — {group.decision.reasonLabel}
            {group.decision.note && ` · ${group.decision.note}`}
            {group.decision.decidedAt && ` · เมื่อ ${thaiDateTime(group.decision.decidedAt)}`}
            {group.deltaSatang !== 0 && ` · ผลต่างที่รับไว้ ${baht(group.deltaSatang)}`}
          </p>
        )}
        {group.crossPeriod && (
          <p className="detail-decision">
            เหลื่อมเดือน — เงินเข้าบัญชีงวด {thaiMonthLabel(group.period)} แต่บันทึกรับเงินไว้งวด{" "}
            {group.sourcePeriods.map(thaiMonthLabel).join(", ")}
          </p>
        )}
      </div>
    </div>
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
  // แถวที่กางรายละเอียดอยู่ — ทีละแถว เพราะรายละเอียดยาวพอที่จะกลบตารางถ้ากางหลายแถว
  const [openGroup, setOpenGroup] = useState("");

  const byType = (["1:1", "1:1+CHECKIN", "N:1", "1:N", "1:1+DEPOSIT", "MANUAL", "OTA"] as const).map((type) => ({
    type,
    label: {
      "1:1": "ระบบจับ 1 ต่อ 1", "N:1": "ระบบจับ หลายต่อ 1", "1:N": "ระบบจับ 1 ต่อหลาย",
      "1:1+CHECKIN": "งวดที่เหลือ วัน Check-in", "1:1+DEPOSIT": "ตรง พร้อมค่าประกัน",
      MANUAL: "คนยืนยันเอง", OTA: "แตกยอด OTA",
    }[type],
    groups: groups.filter((group) => group.type === type),
  })).filter((row) => row.groups.length);

  const visible = account === "all" ? groups : groups.filter((group) => group.account === account);

  const exportCsv = () => {
    const header = [
      "กลุ่ม", "รูปแบบ", "วันที่", "บัญชี", "เลขที่จอง", "ผู้จอง", "ช่องทางรับเงิน",
      "ยอดที่รับมา", "ยอดเงินเข้า", "ค่าประกัน", "ผลต่าง", "เหตุผลของผลต่าง", "หมายเหตุ", "ยืนยันเมื่อ",
    ];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const money = (satang: number) => (satang / 100).toFixed(2);
    const rows = visible.flatMap((group) => group.receipts.map((receipt) => [
      group.id, group.type, group.date, group.account,
      receipt.reservationNo, receipt.guest, receipt.method,
      money(receipt.amountSatang), money(group.bankSatang), money(group.depositSatang ?? 0), money(group.deltaSatang),
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

  /**
   * รายการที่ยังไม่จบ — กระดาษทำการที่แนบท้ายงบพิสูจน์ยอด
   *
   * รายงานส่งออกได้แต่ของที่เคลียร์แล้ว ซึ่งเป็นครึ่งเดียวของสิ่งที่ผู้ตรวจสอบ
   * ถามหา อีกครึ่งคือ "แล้วที่เหลือคืออะไร ทำไมถึงยังไม่จบ" ซึ่งเดิมอ่านได้แต่
   * บนหน้าจอ ต่อจากนี้เอาออกไปเป็นไฟล์ได้เหมือนกัน
   */
  const exportOpen = () => {
    const header = [
      "หมวด", "เหตุผล", "บัญชี", "วันที่รับเงิน", "เลขที่จอง", "ผู้จอง", "ช่องทางรับเงิน",
      "ยอดที่รับมา", "วันที่เงินเข้า", "ยอดเงินเข้า", "รายละเอียดเงินเข้า", "ผลต่าง",
    ];
    const escape = (value: string | number) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const money = (satang: number) => (satang / 100).toFixed(2);

    const rows = [
      ...dataset.reconciliation.exceptions.map((item) => [
        item.receiptId ? "รับเงินแล้วแต่หาเงินเข้าไม่เจอ" : "เงินเข้าแต่ไม่รู้ว่าของใคร",
        item.label, item.account,
        item.receiptDate, item.reservationNo, item.guest, item.receiptMethod,
        item.receiptSatang ? money(item.receiptSatang) : "",
        item.bankDate, item.bankSatang ? money(item.bankSatang) : "",
        item.bankDetail, money(item.deltaSatang),
      ]),
      ...outOfScope.map((item) => [
        "ยังไม่เข้าสู่การกระทบยอด",
        item.reason === "MISSING_STATEMENT" ? "ยังไม่มี Statement ของงวดนี้" : "ช่องทางนี้ไม่มีบัญชีธนาคาร",
        "", "", `${item.count} รายการ`, "", item.method,
        money(item.amountSatang), "", "", item.period, "",
      ]),
    ].map((row) => row.map(escape).join(","));

    const blob = new Blob([`﻿${[header.map(escape).join(","), ...rows].join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clearclose-ค้าง-${dataset.meta.period || "export"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openCount = dataset.reconciliation.exceptions.length
    + outOfScope.reduce((sum, item) => sum + item.count, 0);

  return (
    <>
      <PageHeading
        title="รายงาน"
        description="สรุปผลของรอบนี้ ส่งออกเป็นไฟล์ Excel ได้"
        action={
          <span className="heading-actions">
            <button className="secondary-button" onClick={exportOpen} disabled={!openCount}>
              ⇩ รายการค้าง {openCount ? `(${openCount})` : ""}
            </button>
            <button className="primary-button" onClick={exportCsv}>⇩ ที่กระทบยอดแล้ว</button>
          </span>
        }
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
              {/* ดู "ทุกงวด" อยู่ = บัญชีเดียวกันมีได้หลายแถว แถวละเดือน */}
              {accounts.map((row) => (
                <tr key={`${row.code}-${row.period}`}>
                  <td>
                    <b>•••{row.code}</b>
                    <small className="block">{row.period ? thaiMonthLabel(row.period) : row.branch}</small>
                  </td>
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
              {/* กรองตามเลขบัญชี ไม่ใช่ตามบัญชี+งวด จึงต้องรวมงวดที่ซ้ำกันออกไปก่อน */}
              {[{ value: "all", label: "ทุกบัญชี" }, ...[...new Set(accounts.map((row) => row.code))].map((code) => ({ value: code, label: `•••${code}` }))].map((option) => (
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
                <Fragment key={group.id}>
                <tr
                  className={`clickable ${openGroup === group.id ? "opened" : ""}`}
                  onClick={() => setOpenGroup(openGroup === group.id ? "" : group.id)}
                >
                  <td>
                    <b>{thaiDate(group.date)}</b>
                    <small className="block mono">{group.id}</small>
                  </td>
                  <td>
                    <b>{group.receipts.map((row) => row.guest || row.reservationNo).slice(0, 2).join(", ")}</b>
                    {group.receipts.length > 2 && <small className="block">และอีก {group.receipts.length - 2} รายการ</small>}
                  </td>
                  <td>
                    {baht(group.receiptSatang)}
                    {group.depositSatang > 0 && <small className="block">ค่าห้อง ไม่รวมค่าประกัน</small>}
                  </td>
                  <td>
                    <strong>{baht(group.bankSatang)}</strong>
                    {/* จำนวนค่าประกันอ่านจากกลุ่มเสมอ ไม่ใช่จากตัวเลขที่พิมพ์ไว้ในหน้าจอ
                        เปลี่ยนค่าในหน้าตั้งค่าแล้วบรรทัดนี้เปลี่ยนตามทันที */}
                    {group.depositSatang > 0 && (
                      <small className="block">รวมค่าประกัน {baht(group.depositSatang)}</small>
                    )}
                  </td>
                  <td className={group.deltaSatang === 0 ? "zero-delta" : "negative"}>{baht(group.deltaSatang)}</td>
                  <td>
                    <Pill tone={group.decision ? "amber" : "green"}>
                      {group.decision
                        ? (group.type === "OTA" ? "แตกยอด OTA" : "คนยืนยัน")
                        : group.type === "1:1+DEPOSIT" ? "ตรง พร้อมค่าประกัน"
                        : group.type === "1:1+CHECKIN" ? "งวดที่เหลือ วัน Check-in" : group.type}
                    </Pill>
                    {group.decision?.reasonLabel && <small className="block">{group.decision.reasonLabel}</small>}
                    <small className="block open-hint">{openGroup === group.id ? "▾ ปิด" : "▸ ดูรายละเอียด"}</small>
                  </td>
                </tr>
                {openGroup === group.id && (
                  <tr className="detail-row">
                    <td colSpan={6}><GroupDetail group={group} /></td>
                  </tr>
                )}
                </Fragment>
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
