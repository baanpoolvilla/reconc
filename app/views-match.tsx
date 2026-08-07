"use client";

import { useMemo, useState } from "react";
import { Banner, EmptyState, PageHeading, Pill, SearchBox, Tabs, useWorkspace } from "./ui";
import { type Receipt, type StatementLine, baht, thaiDate } from "../lib/dataset";
import { DECISION_REASONS, type DecisionReason, dayGap } from "../lib/settings";

// งานจับคู่ — ทั้งการแก้ยอดที่ไม่ตรง และการแตกยอดก้อนโอนของ OTA
//
// ทั้งสองงานคือเรื่องเดียวกันเมื่อมองจากด้านล่าง: หยิบรายการรับเงินฝั่งหนึ่ง
// หยิบเงินเข้าธนาคารอีกฝั่งหนึ่ง แล้วบอกว่าสองกองนี้คือเงินก้อนเดียวกัน
// ต่างกันแค่เริ่มจากฝั่งไหน จึงใช้ตะกร้าใบเดียวกันทั้งคู่

type OpenLine = StatementLine & { account: string };

/** แถวที่ยังไม่มีใครจับคู่ ทั้งสองฝั่ง */
function useOpenRows() {
  const { dataset } = useWorkspace();
  return useMemo(() => {
    const usedReceipts = new Set(dataset.reconciliation.groups.flatMap((group) => group.receipts.map((row) => row.id)));
    const usedLines = new Set(dataset.reconciliation.groups.flatMap((group) => group.lines.map((row) => row.id)));

    const receipts = dataset.receipts.filter((receipt) => !usedReceipts.has(receipt.id));
    const lines: OpenLine[] = [];
    for (const statement of dataset.statements) {
      for (const line of statement.lines) {
        if (line.direction === "credit" && !usedLines.has(line.id)) lines.push({ ...line, account: statement.code });
      }
    }
    return { receipts, lines, receiptById: new Map(receipts.map((row) => [row.id, row])), lineById: new Map(lines.map((row) => [row.id, row])) };
  }, [dataset]);
}

const gapLabel = (gap: number) => (gap === 0 ? "วันเดียวกัน" : gap > 0 ? `ช้ากว่า ${gap} วัน` : `เร็วกว่า ${-gap} วัน`);

// ── ตะกร้าจับคู่ ─────────────────────────────────────────────────────────────

function Basket({ kind, seedReceiptIds, seedLineIds, anchorDate, defaultReason, onDone, onSkip, position }: {
  kind: "MANUAL" | "SETTLEMENT";
  seedReceiptIds: string[];
  seedLineIds: string[];
  anchorDate: string;
  defaultReason: DecisionReason | "";
  onDone: () => void;
  onSkip?: () => void;
  position?: string;
}) {
  const { confirmMatch, busy } = useWorkspace();
  const { receipts, lines, receiptById, lineById } = useOpenRows();

  const [pickedReceipts, setPickedReceipts] = useState<string[]>(seedReceiptIds);
  const [pickedLines, setPickedLines] = useState<string[]>(seedLineIds);
  const [reason, setReason] = useState<DecisionReason | "">(defaultReason);
  const [note, setNote] = useState("");
  const [receiptQuery, setReceiptQuery] = useState("");
  const [lineQuery, setLineQuery] = useState("");

  // เปลี่ยนงาน = ตะกร้าใบใหม่ทั้งใบ ที่เรียกใช้ส่ง key ตามงานมาให้ React ถอด
  // component เก่าทิ้ง ของงานก่อนหน้าจึงไม่มีทางค้างอยู่
  const chosenReceipts = pickedReceipts.map((id) => receiptById.get(id)).filter(Boolean) as Receipt[];
  const chosenLines = pickedLines.map((id) => lineById.get(id)).filter(Boolean) as OpenLine[];
  const receiptSatang = chosenReceipts.reduce((sum, row) => sum + row.amountSatang, 0);
  const bankSatang = chosenLines.reduce((sum, row) => sum + row.amountSatang, 0);
  const difference = receiptSatang - bankSatang;
  const feeRate = receiptSatang > 0 ? (difference / receiptSatang) * 100 : 0;

  const toggle = (list: string[], set: (next: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

  // เรียงตัวเลือกตาม "ฝั่งนี้ยังขาดอีกเท่าไหร่" แล้วค่อยดูวันที่ — คนหาแบบนี้อยู่แล้ว
  //
  // ยอดที่ขาดของแต่ละฝั่งเป็นคนละตัวและตรงข้ามกัน ฝั่งเงินที่รับมาขาดเท่ากับ
  // ยอดธนาคารลบยอดที่รับมา ส่วนฝั่งธนาคารขาดกลับด้าน ถ้าใช้ตัวเดียวกันทั้งสองฝั่ง
  // ฝั่งหนึ่งจะถูกเรียงกลับหัว แล้วตัวที่ใช่จะไปจมอยู่ท้ายรายการ
  const rank = <T extends { amountSatang: number; date: string }>(rows: T[], target: number) =>
    [...rows].sort((a, b) => {
      const byDate = Math.abs(dayGap(a.date, anchorDate)) - Math.abs(dayGap(b.date, anchorDate));
      // ฝั่งนี้เกินอยู่แล้ว การเติมเข้าไปมีแต่จะห่างจากศูนย์ เรียงตามวันอย่างเดียว
      if (target <= 0) return byDate || a.amountSatang - b.amountSatang;
      return Math.abs(a.amountSatang - target) - Math.abs(b.amountSatang - target) || byDate;
    });

  const receiptChoices = rank(receipts.filter((row) => {
    if (pickedReceipts.includes(row.id)) return false;
    if (!receiptQuery.trim()) return true;
    return `${row.reservationNo} ${row.guest} ${row.method} ${row.group} ${row.roomNumber}`.toLowerCase().includes(receiptQuery.trim().toLowerCase());
  }), -difference).slice(0, 40);

  const lineChoices = rank(lines.filter((row) => {
    if (pickedLines.includes(row.id)) return false;
    if (!lineQuery.trim()) return true;
    return `${row.detail} ${row.channel} ${row.description} ${(row.amountSatang / 100).toFixed(2)}`.toLowerCase().includes(lineQuery.trim().toLowerCase());
  }), difference).slice(0, 40);

  const needsReason = difference !== 0;
  const canConfirm = chosenReceipts.length > 0 && chosenLines.length > 0
    && (!needsReason || (reason !== "" && (reason !== "OTHER" || note.trim().length > 0)));

  const confirm = async () => {
    const ok = await confirmMatch({
      kind,
      receiptIds: pickedReceipts,
      bankLineIds: pickedLines,
      receiptSatang,
      bankSatang,
      reason: needsReason ? reason : "",
      note: note.trim(),
    });
    if (ok) onDone();
  };

  return (
    <section className="basket">
      <header className="basket-head">
        <div>
          <small>{position}</small>
          <h2>{kind === "SETTLEMENT" ? "แตกยอดก้อนโอนนี้" : "จับคู่รายการนี้"}</h2>
          <p>เลือกให้ครบทั้งสองฝั่ง ระบบจะบอกทันทีว่ายอดตรงกันหรือยัง</p>
        </div>
        {onSkip && <button className="ghost-button" onClick={onSkip}>ข้ามไปรายการถัดไป →</button>}
      </header>

      <div className="basket-body">
        <BasketSide
          title="เงินที่รับมา"
          hint="จากรายงานการรับเงิน"
          total={receiptSatang}
          empty="ยังไม่ได้เลือกรายการรับเงิน"
          chosen={chosenReceipts.map((row) => ({
            id: row.id,
            title: row.guest || "ไม่ระบุชื่อ",
            sub: `${thaiDate(row.date)} · ${row.method}`,
            code: row.reservationNo,
            amountSatang: row.amountSatang,
          }))}
          onRemove={(id) => toggle(pickedReceipts, setPickedReceipts, id)}
          query={receiptQuery}
          onQuery={setReceiptQuery}
          searchPlaceholder="ค้นหาชื่อผู้จอง เลขที่จอง หรือช่องทาง"
          choices={receiptChoices.map((row) => ({
            id: row.id,
            title: row.guest || "ไม่ระบุชื่อ",
            sub: `${row.method} · ${row.group || "—"}`,
            code: row.reservationNo,
            amountSatang: row.amountSatang,
            gap: dayGap(row.date, anchorDate),
            date: row.date,
          }))}
          onAdd={(id) => toggle(pickedReceipts, setPickedReceipts, id)}
        />

        <BasketSide
          title="เงินเข้าธนาคาร"
          hint="จากรายการเดินบัญชี"
          total={bankSatang}
          empty="ยังไม่ได้เลือกเงินเข้า"
          chosen={chosenLines.map((row) => ({
            id: row.id,
            title: row.detail || row.description,
            sub: `${thaiDate(row.date)} ${row.time} น. · บัญชี •••${row.account}`,
            code: row.channel,
            amountSatang: row.amountSatang,
          }))}
          onRemove={(id) => toggle(pickedLines, setPickedLines, id)}
          query={lineQuery}
          onQuery={setLineQuery}
          searchPlaceholder="ค้นหายอดเงิน ผู้โอน หรือช่องทาง"
          choices={lineChoices.map((row) => ({
            id: row.id,
            title: row.detail || row.description,
            sub: `${row.channel} · บัญชี •••${row.account}`,
            code: `${row.time} น.`,
            amountSatang: row.amountSatang,
            gap: dayGap(row.date, anchorDate),
            date: row.date,
          }))}
          onAdd={(id) => toggle(pickedLines, setPickedLines, id)}
        />
      </div>

      <footer className={`basket-foot ${difference === 0 ? "balanced" : "unbalanced"}`}>
        <div className="basket-sum">
          <span><small>เงินที่รับมา</small><b>{baht(receiptSatang)}</b></span>
          <i>−</i>
          <span><small>เงินเข้าธนาคาร</small><b>{baht(bankSatang)}</b></span>
          <i>=</i>
          <span className="basket-diff">
            <small>{difference === 0 ? "ตรงกันพอดี" : difference > 0 ? "ยังขาดอีก" : "เกินมา"}</small>
            <b>{baht(Math.abs(difference))}</b>
            {difference !== 0 && receiptSatang > 0 && <em>{feeRate.toFixed(1)}% ของยอดที่รับมา</em>}
          </span>
        </div>

        {needsReason && (
          <div className="basket-reason">
            <p>ยอดสองฝั่งไม่เท่ากัน — บอกหน่อยว่าเพราะอะไร แล้วจึงยืนยันได้</p>
            <div className="reason-choices">
              {(Object.keys(DECISION_REASONS) as DecisionReason[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={reason === key ? "active" : ""}
                  onClick={() => setReason(key)}
                >
                  <b>{DECISION_REASONS[key].label}</b>
                  <small>{DECISION_REASONS[key].detail}</small>
                </button>
              ))}
            </div>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={reason === "OTHER" ? "เขียนเหตุผลกำกับ (จำเป็น)" : "หมายเหตุเพิ่มเติม (ไม่บังคับ)"}
            />
          </div>
        )}

        <div className="basket-actions">
          <p>
            {difference === 0
              ? "ยอดตรงพอดี ยืนยันได้เลย"
              : canConfirm
                ? `จะบันทึกผลต่าง ${baht(Math.abs(difference))} เป็น “${DECISION_REASONS[reason as DecisionReason].label}” และยังแสดงค้างไว้ในรายงาน`
                : "เลือกเหตุผลก่อนจึงจะยืนยันได้"}
          </p>
          <button className="confirm-button" onClick={confirm} disabled={!canConfirm || busy}>
            {busy ? "กำลังบันทึก…" : "✓ ยืนยันว่าตรงกัน"}
          </button>
        </div>
      </footer>
    </section>
  );
}

type BasketRow = { id: string; title: string; sub: string; code: string; amountSatang: number; gap?: number; date?: string };

function BasketSide({ title, hint, total, empty, chosen, onRemove, query, onQuery, searchPlaceholder, choices, onAdd }: {
  title: string; hint: string; total: number; empty: string;
  chosen: BasketRow[]; onRemove: (id: string) => void;
  query: string; onQuery: (next: string) => void; searchPlaceholder: string;
  choices: BasketRow[]; onAdd: (id: string) => void;
}) {
  return (
    <div className="basket-side">
      <div className="basket-side-head">
        <span><b>{title}</b><small>{hint}</small></span>
        <strong>{baht(total)}</strong>
      </div>

      <div className="basket-chosen">
        {!chosen.length && <p className="basket-empty">{empty}</p>}
        {chosen.map((row) => (
          <div key={row.id} className="chosen-row">
            <span><b>{row.title}</b><small>{row.sub}</small></span>
            <strong>{baht(row.amountSatang)}</strong>
            <button type="button" aria-label={`เอา ${row.title} ออก`} onClick={() => onRemove(row.id)}>×</button>
          </div>
        ))}
      </div>

      <div className="basket-picker">
        <SearchBox value={query} onChange={onQuery} placeholder={searchPlaceholder} />
        <p className="picker-hint">เรียงตัวที่ใกล้เคียงที่สุดไว้บนสุด · กดเพื่อเพิ่มเข้าตะกร้า</p>
        <div className="picker-list">
          {!choices.length && <p className="basket-empty">ไม่พบรายการที่ค้นหา</p>}
          {choices.map((row) => (
            <button key={row.id} type="button" className="picker-row" onClick={() => onAdd(row.id)}>
              <span className="picker-plus">＋</span>
              <span className="picker-name">
                <b>{row.title}</b>
                <small>{row.code} · {row.sub}</small>
              </span>
              <span className="picker-figures">
                <strong>{baht(row.amountSatang)}</strong>
                {row.date && <small>{thaiDate(row.date)}{row.gap !== undefined && ` · ${gapLabel(row.gap)}`}</small>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── งานที่ 1 · ยอดที่ยังไม่ตรง ───────────────────────────────────────────────

export function FixQueue() {
  const { dataset, online, go } = useWorkspace();
  const [side, setSide] = useState("receipt");
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const receiptSide = dataset.reconciliation.exceptions.filter((item) => item.receiptId);
  const bankSide = dataset.reconciliation.exceptions.filter((item) => item.reason === "UNMATCHED_BANK_CREDIT");
  const list = (side === "receipt" ? receiptSide : bankSide).filter((item) => {
    if (!query.trim()) return true;
    return `${item.reservationNo} ${item.guest} ${item.bankDetail} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase());
  });

  // งานที่กำลังทำหายไปเพราะเพิ่งจับคู่สำเร็จ → ตกมาที่งานถัดไปเอง โดยไม่ต้อง
  // เขียน state ใด ๆ กลับ: รายการที่เปิดอยู่คือรายการที่เลือกไว้ ถ้าไม่มีก็คือตัวแรก
  const current = list.find((item) => item.id === openId) ?? list[0] ?? null;

  return (
    <>
      <PageHeading
        title="ยอดที่ยังไม่ตรง"
        description="เปิดทีละรายการ ดูว่าเงินก้อนไหนน่าจะใช่ แล้วกดยืนยัน"
        action={<button className="ghost-button" onClick={() => go("home")}>← กลับหน้าแรก</button>}
      />

      {!online && (
        <Banner tone="amber" title="ตอนนี้ยังไม่ออนไลน์">
          การจับคู่ที่ยืนยันไว้จะถูกเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น เครื่องอื่นจะไม่เห็น — เปิดโหมดออนไลน์ได้ที่หน้าตั้งค่า
        </Banner>
      )}

      <div className="queue-toolbar">
        <Tabs
          value={side}
          onChange={(next) => { setSide(next); setOpenId(null); }}
          options={[
            { value: "receipt", label: "รับเงินแล้วแต่หาเงินเข้าไม่เจอ", count: receiptSide.length },
            { value: "bank", label: "เงินเข้าแต่ไม่รู้ว่าของใคร", count: bankSide.length },
          ]}
        />
        <SearchBox value={query} onChange={setQuery} placeholder="ค้นหาชื่อ เลขที่จอง หรือยอดเงิน" />
      </div>

      {!list.length && (
        <EmptyState
          title={side === "receipt" ? "เคลียร์ครบแล้ว ไม่มียอดค้าง" : "เงินเข้าทุกก้อนมีเจ้าของแล้ว"}
          detail="ไม่มีอะไรต้องทำในหมวดนี้"
          action={<button className="primary-button" onClick={() => go("home")}>กลับหน้าแรก</button>}
        />
      )}

      {list.length > 0 && (
        <div className="queue-layout">
          <div className="queue-list">
            {list.slice(0, 200).map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`queue-row ${current?.id === item.id ? "active" : ""}`}
                onClick={() => setOpenId(item.id)}
              >
                <span className="queue-index">{index + 1}</span>
                <span className="queue-name">
                  <b>{item.guest || item.bankDetail || "ไม่ระบุชื่อ"}</b>
                  <small>{side === "receipt"
                    ? `${thaiDate(item.receiptDate)} · ${item.receiptMethod || "—"}`
                    : `${thaiDate(item.bankDate)} ${item.bankTime} น. · บัญชี •••${item.account}`}</small>
                </span>
                <span className="queue-amount">
                  {baht(side === "receipt" ? item.receiptSatang : item.bankSatang)}
                </span>
              </button>
            ))}
            {list.length > 200 && <p className="table-note">แสดง 200 จาก {list.length} รายการ · ใช้ช่องค้นหาเพื่อจำกัดผลลัพธ์</p>}
          </div>

          <div className="queue-detail">
            {current && (
              <>
                <div className="queue-why">
                  <Pill tone={current.reason === "MISSING_BOOKING" ? "red" : current.reason === "AMOUNT_MISMATCH" ? "amber" : "blue"}>
                    {whyLabel(current.reason)}
                  </Pill>
                  <p>{whyDetail(current.reason)}</p>
                </div>
                <Basket
                  key={`${side}-${current.id}`}
                  kind="MANUAL"
                  seedReceiptIds={current.receiptId ? [current.receiptId] : []}
                  seedLineIds={current.bankLineId && side === "bank" ? [current.bankLineId] : []}
                  anchorDate={side === "receipt" ? (current.bookingCreatedDate || current.receiptDate) : current.bankDate}
                  defaultReason=""
                  position={`รายการที่ ${list.findIndex((item) => item.id === current.id) + 1} จาก ${list.length}`}
                  onDone={() => setOpenId(null)}
                  onSkip={() => {
                    const index = list.findIndex((item) => item.id === current.id);
                    setOpenId(list[index + 1]?.id ?? null);
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const whyLabel = (reason: string) => ({
  MISSING_BOOKING: "ไม่พบคำจองในบัญชีแยกประเภท",
  DATE_RULE_UNMET: "ไม่มีเงินเข้าในวันที่สร้างคำจอง",
  AMOUNT_MISMATCH: "มีเงินเข้าวันเดียวกัน แต่ยอดไม่ตรง",
  UNMATCHED_BANK_CREDIT: "ยังไม่มีรายการรับเงินรองรับ",
  REFUND_LINE: "รายการคืนเงิน",
}[reason] ?? reason);

const whyDetail = (reason: string) => ({
  MISSING_BOOKING: "รายการรับเงินนี้อ้างเลขที่จองที่ไม่มีในบัญชีแยกประเภท จึงไม่มีวันที่สร้างคำจองให้เทียบ",
  DATE_RULE_UNMET: "วันที่สร้างคำจองไม่มีเงินเข้าบัญชีนั้นเลย ถ้าเงินเข้าจริงคนละวัน เลือกก้อนที่ใช่แล้วยืนยันได้",
  AMOUNT_MISMATCH: "มีเงินเข้าวันเดียวกันแต่ยอดไม่ตรงพอดี ถ้าต่างเพราะค่าธรรมเนียมหรือส่วนลด เลือกเหตุผลแล้วยืนยันได้",
  UNMATCHED_BANK_CREDIT: "เงินเข้าก้อนนี้ยังไม่มีรายการรับเงินมารองรับ ลองหาว่าเป็นของคำจองไหน",
  REFUND_LINE: "รายการคืนเงินควรกระทบกับยอดถอน ไม่ใช่ยอดฝาก",
}[reason] ?? "");

// ── งานที่ 2 · ก้อนโอน OTA ───────────────────────────────────────────────────

export function Settlements() {
  const { effective, settings, go } = useWorkspace();
  const proposals = effective.settlements;
  const [openId, setOpenId] = useState<string | null>(null);

  const current = proposals.find((item) => item.id === openId) ?? proposals[0] ?? null;

  return (
    <>
      <PageHeading
        title="ก้อนโอนจาก OTA"
        description="Airbnb Trip.com และ Booking.com โอนรวมเป็นก้อนหลังหักค่าคอมแล้ว ระบบเสนอให้ว่าก้อนนี้น่าจะเป็นของคำจองไหนบ้าง"
        action={<button className="ghost-button" onClick={() => go("home")}>← กลับหน้าแรก</button>}
      />

      <Banner tone="blue" title="ทำไมยอดถึงไม่มีวันตรงพอดี">
        OTA หักค่าคอมก่อนโอน เงินที่เข้าบัญชีจึงน้อยกว่ายอดที่บันทึกไว้เสมอ
        ระบบจะไล่เลือกคำจองที่วันใกล้ก้อนโอนที่สุด (ภายใน {settings.settlement.windowDays} วัน) จนยอดรวมท่วมก้อน แล้วเหลือส่วนต่างเป็นค่าคอม
        ตัวเลขจะยังไม่เปลี่ยนจนกว่าจะกดยืนยัน
      </Banner>

      {!proposals.length && (
        <EmptyState
          title="ไม่มีก้อนโอน OTA ที่ค้างอยู่"
          detail="ก้อนโอนทุกก้อนถูกแตกยอดเรียบร้อย หรือยังไม่มีเงินเข้าที่เข้าข่าย"
          action={<button className="primary-button" onClick={() => go("home")}>กลับหน้าแรก</button>}
        />
      )}

      {proposals.length > 0 && (
        <div className="queue-layout">
          <div className="queue-list">
            {proposals.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`queue-row ${current?.id === item.id ? "active" : ""}`}
                onClick={() => setOpenId(item.id)}
              >
                <span className={`queue-dot ${item.status === "READY" ? "green" : "amber"}`} />
                <span className="queue-name">
                  <b>{baht(item.netSatang)}</b>
                  <small>{thaiDate(item.date)} · {item.channel} · •••{item.account}</small>
                </span>
                <span className="queue-amount small">
                  {item.status === "READY"
                    ? `${item.candidates.filter((row) => row.selected).length} คำจอง · คอม ${item.feeRate}%`
                    : item.status === "SHORT" ? "หาคำจองไม่พอ"
                    : item.status === "EMPTY" ? "ไม่พบคำจองใกล้เคียง"
                    : `คอม ${item.feeRate}% สูงผิดปกติ`}
                </span>
              </button>
            ))}
          </div>

          <div className="queue-detail">
            {current && (
              <>
                <div className="settlement-head">
                  <div>
                    <small>เงินเข้าบัญชี •••{current.account}</small>
                    <h3>{baht(current.netSatang)}</h3>
                    <p>{thaiDate(current.date)} {current.time} น. · {current.detail || current.description}</p>
                  </div>
                  <div className="settlement-fee">
                    <small>ส่วนต่างที่ระบบเสนอว่าเป็นค่าคอม</small>
                    <b>{baht(current.feeSatang)}</b>
                    <em>{current.feeRate}% ของยอดเต็ม</em>
                  </div>
                </div>
                <Basket
                  key={current.id}
                  kind="SETTLEMENT"
                  seedReceiptIds={current.selectedIds}
                  seedLineIds={[current.lineId]}
                  anchorDate={current.date}
                  defaultReason="COMMISSION"
                  position={`ก้อนที่ ${proposals.findIndex((item) => item.id === current.id) + 1} จาก ${proposals.length}`}
                  onDone={() => setOpenId(null)}
                  onSkip={() => {
                    const index = proposals.findIndex((item) => item.id === current.id);
                    setOpenId(proposals[index + 1]?.id ?? null);
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
