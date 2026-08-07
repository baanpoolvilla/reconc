"use client";

import { useMemo, useRef, useState } from "react";
import { Metric, PageHeading, PanelTitle, Pill, Switch, type Tone } from "./ui";
import { type Dataset, baht, thaiDate, thaiDateTime, thaiMonthLabel } from "../lib/dataset";
import {
  type AppSettings,
  type EffectiveDataset,
  type ExclusionScope,
  type Facet,
  DEFAULT_SETTINGS,
  EXCLUSION_SCOPE_LABEL,
  describeFacets,
  normalizeSettings,
  propertyOf,
} from "../lib/settings";

// หน้าการตั้งค่า
//
// ทุกอย่างในหน้านี้เป็นชั้นที่วางทับเอกสารต้นทาง ไม่มีปุ่มไหนเขียนกลับไปที่ไฟล์
// ต้นฉบับหรือฐานข้อมูล เปลี่ยนค่าปุ๊บ ระบบกระทบยอดใหม่ทั้งรอบทันทีในเบราว์เซอร์
// และตัวเลขทุกหน้าจะขยับตาม

type Props = {
  rawDataset: Dataset;
  effective: EffectiveDataset;
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onReset: () => void;
  source: string;
  databaseConfigured: boolean;
};

const scopeTone: Record<ExclusionScope, Tone> = {
  property: "red",
  group: "red",
  method: "amber",
  channel: "blue",
  bookingStatus: "blue",
  keyword: "slate",
  refund: "slate",
  amount: "slate",
};

const sectionList = [
  { id: "exclusions", label: "ตัวกรองรายการ", icon: "⊘" },
  { id: "matching", label: "กฎการจับคู่", icon: "↔" },
  { id: "display", label: "การแสดงผล", icon: "▤" },
  { id: "system", label: "ข้อมูลและระบบ", icon: "▦" },
  { id: "manage", label: "จัดการค่าที่ตั้งไว้", icon: "⚙" },
];

export default function SettingsView({ rawDataset, effective, settings, onChange, onReset, source, databaseConfigured }: Props) {
  const facets = useMemo(() => describeFacets(rawDataset), [rawDataset]);
  const [section, setSection] = useState("exclusions");
  const hasData = rawDataset.meta.sources.length > 0;

  const patch = (partial: Partial<AppSettings>) => onChange({ ...settings, ...partial });
  const patchExclusions = (partial: Partial<AppSettings["exclusions"]>) =>
    patch({ exclusions: { ...settings.exclusions, ...partial } });
  const patchMatching = (partial: Partial<AppSettings["matching"]>) =>
    patch({ matching: { ...settings.matching, ...partial } });
  const patchDisplay = (partial: Partial<AppSettings["display"]>) =>
    patch({ display: { ...settings.display, ...partial } });

  const toggleIn = (key: "properties" | "groups" | "methods" | "channels" | "bookingStatuses", value: string) => {
    const current = settings.exclusions[key];
    patchExclusions({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  };

  const keptCount = effective.dataset.receipts.length;
  const keptSatang = effective.sourceReceiptSatang - effective.excludedSatang;
  const excludedShare = effective.sourceReceiptSatang
    ? Math.round((effective.excludedSatang / effective.sourceReceiptSatang) * 100)
    : 0;

  return (
    <>
      <PageHeading
        eyebrow="Settings"
        title="การตั้งค่า"
        description="กำหนดว่ารายการใดจะไม่ถูกนำเข้ากระทบยอด และระบบจะจับคู่ด้วยรูปแบบใดบ้าง เอกสารต้นทางไม่ถูกแก้ไขในทุกกรณี"
        action={
          <div className="heading-stats">
            <span><b>{effective.activeRuleCount}</b><small>กฎที่เปิดใช้อยู่</small></span>
            <span><b>{effective.excluded.length}</b><small>รายการที่ตัดออก</small></span>
          </div>
        }
      />

      <div className="settings-notice">
        <span>i</span>
        <p>
          <b>การตั้งค่าเก็บอยู่ในเบราว์เซอร์เครื่องนี้เท่านั้น</b>
          <small>
            ไม่ถูกส่งขึ้นเซิร์ฟเวอร์และไม่แก้ไขไฟล์ต้นฉบับใน <code>data/</code> หรือฐานข้อมูล
            เปลี่ยนค่าแล้วระบบจะกระทบยอดใหม่ทั้งรอบทันที · ต้องการให้เครื่องอื่นเห็นเหมือนกัน ให้ส่งออกไฟล์ตั้งค่าแล้วนำเข้าที่เครื่องนั้น
          </small>
        </p>
      </div>

      <section className="metrics-grid">
        <Metric
          label="รายการรับเงินในเอกสารต้นทาง"
          value={effective.sourceReceiptCount.toLocaleString("en-US") + " รายการ"}
          detail={`${baht(effective.sourceReceiptSatang)} · ก่อนใช้ตัวกรองใด ๆ`}
          tone="slate"
        />
        <Metric
          label="ถูกตัดออกตามการตั้งค่า"
          value={effective.excluded.length.toLocaleString("en-US") + " รายการ"}
          detail={`${baht(effective.excludedSatang)} · คิดเป็น ${excludedShare}% ของยอดรับทั้งรอบ`}
          tone="red"
          badge={settings.exclusions.enabled ? `${effective.activeRuleCount} กฎ` : "ปิดตัวกรอง"}
        />
        <Metric
          label="เข้าสู่การกระทบยอด"
          value={keptCount.toLocaleString("en-US") + " รายการ"}
          detail={`${baht(keptSatang)} · เป็นฐานของทุกตัวเลขในระบบ`}
          tone="green"
        />
        <Metric
          label="อัตราการจับคู่หลังกรอง"
          value={`${effective.dataset.reconciliation.summary.matchRate}%`}
          detail={`${effective.dataset.reconciliation.summary.matchedReceipts} จาก ${effective.dataset.reconciliation.summary.inScopeReceipts} รายการในขอบเขต`}
          tone={effective.dataset.reconciliation.summary.matchRate >= 85 ? "green" : "amber"}
          badge={`${effective.dataset.reconciliation.groups.length} กลุ่ม`}
        />
      </section>

      <nav className="settings-nav" aria-label="หมวดการตั้งค่า">
        {sectionList.map((item) => (
          <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>

      {section === "exclusions" && (
        <>
          <section className="panel settings-panel">
            <PanelTitle
              kicker="Master switch"
              title="ตัวกรองรายการที่ไม่นำเข้ากระทบยอด"
              action={
                <span className="settings-master">
                  <span><b>{settings.exclusions.enabled ? "เปิดใช้งาน" : "ปิดทั้งหมด"}</b><small>{settings.exclusions.enabled ? `กำลังตัดออก ${effective.excluded.length} รายการ` : "ทุกรายการเข้ากระทบยอด"}</small></span>
                  <Switch checked={settings.exclusions.enabled} onChange={(next) => patchExclusions({ enabled: next })} label="เปิดปิดตัวกรองทั้งหมด" />
                </span>
              }
            />
            <p className="settings-lead">
              รายการที่ถูกตัดออกจะหายไปจากทุกหน้าจอ ทั้งภาพรวม ตารางรับเงิน การจับคู่ ข้อยกเว้น และไฟล์ CSV ที่ส่งออก
              แต่ยังเรียกดูได้ที่ตารางท้ายหน้านี้พร้อมเหตุผลว่าถูกตัดด้วยกฎข้อใด
            </p>

            {effective.buckets.length > 0 && (
              <div className="active-rule-strip">
                <small>กฎที่กำลังตัดรายการอยู่จริง</small>
                <div>
                  {effective.buckets.map((bucket) => (
                    <span key={`${bucket.scope}:${bucket.value}`} className={`active-rule ${scopeTone[bucket.scope]}`}>
                      <em>{EXCLUSION_SCOPE_LABEL[bucket.scope]}</em>
                      <b>{bucket.value}</b>
                      <i>{bucket.count} รายการ · {baht(bucket.amountSatang)}</i>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          <div className="settings-grid">
            <FacetPanel
              kicker="Property"
              title="กลุ่มทรัพย์สิน"
              hint="ตัดออกทั้งกลุ่ม ครอบคลุมทุกโครงการที่ขึ้นต้นด้วยชื่อนี้ เช่น Medina จะตัด Medina-บางแสน และ Medina อื่น ๆ ที่เพิ่มเข้ามาภายหลังด้วย"
              facets={facets.properties}
              selected={settings.exclusions.properties}
              onToggle={(value) => toggleIn("properties", value)}
              onClear={() => patchExclusions({ properties: [] })}
              disabled={!settings.exclusions.enabled}
            />
            <FacetPanel
              kicker="Payment method"
              title="ช่องทางรับเงิน"
              hint="ตัดรายการที่รับเงินเข้าช่องทางนี้ทั้งหมด ช่องทางที่ไม่มี Statement อยู่นอกขอบเขตการกระทบยอดอยู่แล้ว การตัดออกจะทำให้ไม่ถูกนับแม้ในยอดรวม"
              facets={facets.methods}
              selected={settings.exclusions.methods}
              onToggle={(value) => toggleIn("methods", value)}
              onClear={() => patchExclusions({ methods: [] })}
              disabled={!settings.exclusions.enabled}
            />
            <FacetPanel
              kicker="Group"
              title="กลุ่มย่อยรายโครงการ"
              hint="ใช้เมื่อต้องการตัดเฉพาะบางโครงการ ไม่ใช่ทั้งกลุ่มทรัพย์สิน"
              facets={facets.groups}
              selected={settings.exclusions.groups}
              onToggle={(value) => toggleIn("groups", value)}
              onClear={() => patchExclusions({ groups: [] })}
              disabled={!settings.exclusions.enabled}
              shadowed={settings.exclusions.properties}
            />
            <FacetPanel
              kicker="Booking channel"
              title="ช่องทางการจอง"
              hint="ตัดตามที่มาของคำจอง เช่น OTA หรือ Agent"
              facets={facets.channels}
              selected={settings.exclusions.channels}
              onToggle={(value) => toggleIn("channels", value)}
              onClear={() => patchExclusions({ channels: [] })}
              disabled={!settings.exclusions.enabled}
            />
            <FacetPanel
              kicker="Booking status"
              title="สถานะคำจอง"
              hint="ตัดตามสถานะคำจองในบัญชีแยกประเภท เช่น ไม่นับคำจองที่ยกเลิกแล้ว"
              facets={facets.bookingStatuses}
              selected={settings.exclusions.bookingStatuses}
              onToggle={(value) => toggleIn("bookingStatuses", value)}
              onClear={() => patchExclusions({ bookingStatuses: [] })}
              disabled={!settings.exclusions.enabled}
            />
            <KeywordPanel
              keywords={settings.exclusions.keywords}
              onChange={(keywords) => patchExclusions({ keywords })}
              disabled={!settings.exclusions.enabled}
            />
          </div>

          <section className="panel settings-panel">
            <PanelTitle kicker="Amount & refunds" title="เงื่อนไขเพิ่มเติม" />
            <div className="settings-field">
              <span><b>ตัดรายการคืนเงินออกจากระบบ</b><small>ปกติรายการยอดติดลบจะขึ้นเป็นข้อยกเว้น <code>REFUND_LINE</code> ให้ตรวจ เปิดข้อนี้เมื่อไม่ต้องการเห็นเลย</small></span>
              <Switch checked={settings.exclusions.excludeRefunds} onChange={(next) => patchExclusions({ excludeRefunds: next })} label="ตัดรายการคืนเงิน" />
            </div>
            <div className="settings-field">
              <span><b>ตัดรายการที่ยอดต่ำกว่า</b><small>เว้นว่างไว้เพื่อไม่ใช้เงื่อนไขนี้ · เทียบกับยอดสัมบูรณ์ของแต่ละรายการ</small></span>
              <BahtInput
                value={settings.exclusions.minAmountSatang}
                onChange={(satang) => patchExclusions({ minAmountSatang: satang })}
                placeholder="ไม่จำกัด"
              />
            </div>
            <div className="settings-field">
              <span><b>ตัดรายการที่ยอดสูงกว่า</b><small>ใช้แยกยอดก้อนใหญ่ผิดปกติออกไปตรวจต่างหาก</small></span>
              <BahtInput
                value={settings.exclusions.maxAmountSatang}
                onChange={(satang) => patchExclusions({ maxAmountSatang: satang })}
                placeholder="ไม่จำกัด"
              />
            </div>
          </section>

          <ExcludedPreview effective={effective} />
        </>
      )}

      {section === "matching" && (
        <>
          <section className="panel settings-panel">
            <PanelTitle kicker="Hard rules" title="กฎที่แก้ไขไม่ได้" action={<Pill tone="green">ล็อกไว้เสมอ</Pill>} />
            <p className="settings-lead">
              สองข้อนี้เป็นแกนของ ruleset v{rawDataset.reconciliation.rulesetVersion} ระบบไม่เปิดให้ปรับ
              เพราะการผ่อนปรนแม้เพียงข้อเดียวทำให้ผลกระทบยอดใช้อ้างอิงทางบัญชีไม่ได้
            </p>
            <div className="locked-rules">
              <div>
                <span>R01</span>
                <p><b>วันที่สร้างคำจอง = วันที่เงินเข้า Statement</b><small>เทียบเป็นวันปฏิทินเดียวกัน · date window = 0 วัน</small></p>
                <em>🔒</em>
              </div>
              <div>
                <span>R02</span>
                <p><b>ยอดต้องตรงกันพอดี</b><small>ผลต่างต้องเป็น ฿0.00 · tolerance = ฿0.00</small></p>
                <em>🔒</em>
              </div>
            </div>
          </section>

          <section className="panel settings-panel">
            <PanelTitle kicker="Match shapes" title="รูปแบบการจับคู่ที่อนุญาต" />
            <div className="settings-field">
              <span><b>R03 · จับคู่ 1:1</b><small>หนึ่งรายการรับเงิน = หนึ่งยอดเงินเข้า · เป็นรูปแบบพื้นฐาน ปิดไม่ได้</small></span>
              <span className="settings-locked">บังคับเปิด</span>
            </div>
            <div className="settings-field">
              <span><b>R04 · จับคู่ N:1</b><small>ผลรวมหลายรายการรับเงินในวันเดียวกัน = หนึ่งยอดเงินเข้า · ปิดข้อนี้แล้วรายการเหล่านั้นจะกลายเป็นข้อยกเว้น</small></span>
              <Switch checked={settings.matching.allowManyToOne} onChange={(next) => patchMatching({ allowManyToOne: next })} label="อนุญาต N:1" />
            </div>
            <div className="settings-field">
              <span><b>R05 · จับคู่ 1:N</b><small>หนึ่งรายการรับเงิน = ผลรวมของเงินเข้าหลายรายการในวันเดียวกัน</small></span>
              <Switch checked={settings.matching.allowOneToMany} onChange={(next) => patchMatching({ allowOneToMany: next })} label="อนุญาต 1:N" />
            </div>
            <div className="settings-field">
              <span><b>จำนวนรายการสูงสุดต่อหนึ่งกลุ่ม</b><small>ยิ่งมากยิ่งจับคู่ได้กว้างขึ้น แต่โอกาสที่ผลรวมจะบังเอิญตรงกันก็สูงขึ้นด้วย · ค่าแนะนำคือ 4</small></span>
              <div className="segmented">
                {[2, 3, 4, 5, 6].map((size) => (
                  <button key={size} className={settings.matching.maxGroupSize === size ? "active" : ""} onClick={() => patchMatching({ maxGroupSize: size })}>{size}</button>
                ))}
              </div>
            </div>
          </section>

          <section className="panel settings-panel">
            <PanelTitle kicker="Effect" title="ผลของค่าที่ตั้งไว้ตอนนี้" />
            <div className="responsive-table">
              <table>
                <thead>
                  <tr><th>รูปแบบ</th><th>จำนวนกลุ่ม</th><th>รายการรับเงินที่ครอบคลุม</th><th>ยอดที่ยืนยันแล้ว</th><th>สถานะ</th></tr>
                </thead>
                <tbody>
                  {(["1:1", "N:1", "1:N"] as const).map((type) => {
                    const groups = effective.dataset.reconciliation.groups.filter((group) => group.type === type);
                    const enabled = type === "1:1" || (type === "N:1" ? settings.matching.allowManyToOne : settings.matching.allowOneToMany);
                    return (
                      <tr key={type}>
                        <td><b>{type}</b></td>
                        <td>{groups.length}</td>
                        <td>{groups.reduce((sum, group) => sum + group.receipts.length, 0)}</td>
                        <td><strong>{baht(groups.reduce((sum, group) => sum + group.bankSatang, 0))}</strong></td>
                        <td>{enabled ? <Pill tone="green">เปิดใช้</Pill> : <Pill tone="slate">ปิดอยู่</Pill>}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td><b>ข้อยกเว้น</b></td>
                    <td colSpan={2}>{effective.dataset.reconciliation.exceptions.length} รายการ</td>
                    <td><strong>{baht(effective.dataset.reconciliation.summary.unexplainedReceiptSatang)}</strong></td>
                    <td><Pill tone="red">ต้องตรวจ</Pill></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {section === "display" && (
        <section className="panel settings-panel">
          <PanelTitle kicker="Display" title="การแสดงผลบนตาราง" />
          <div className="settings-field">
            <span><b>จำนวนแถวสูงสุดในตารางรับเงิน</b><small>ตารางที่ยาวเกินไปทำให้หน้าจอหน่วง · การส่งออก CSV จะได้ทุกแถวเสมอไม่ว่าตั้งค่านี้ไว้เท่าใด</small></span>
            <div className="segmented">
              {[100, 300, 600, 1000, 5000].map((limit) => (
                <button key={limit} className={settings.display.ledgerRowLimit === limit ? "active" : ""} onClick={() => patchDisplay({ ledgerRowLimit: limit })}>
                  {limit.toLocaleString("en-US")}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <span><b>แสดงรายการที่ถูกตัดออกในตารางรับเงิน</b><small>เปิดไว้เพื่อตรวจว่าตัวกรองตัดถูกตัว รายการจะขึ้นเป็นสีเทาพร้อมป้ายเหตุผล และไม่ถูกนับในยอดรวมใด ๆ</small></span>
            <Switch checked={settings.display.showExcludedRows} onChange={(next) => patchDisplay({ showExcludedRows: next })} label="แสดงรายการที่ถูกตัดออก" />
          </div>
        </section>
      )}

      {section === "system" && (
        <>
          <section className="panel settings-panel">
            <PanelTitle
              kicker="Data source"
              title="แหล่งข้อมูลที่ระบบกำลังอ่าน"
              action={<Pill tone={databaseConfigured ? "green" : "amber"}>{databaseConfigured ? "Neon Postgres" : "data/ ตอน build"}</Pill>}
            />
            <div className="settings-readonly">
              <span><small>แหล่งข้อมูล</small><b>{source === "database" ? "ฐานข้อมูล Postgres" : source === "build" ? "ไฟล์ในโฟลเดอร์ data/" : "ยังไม่มีข้อมูล"}</b></span>
              <span><small>รอบบัญชี</small><b>{rawDataset.meta.period ? thaiMonthLabel(rawDataset.meta.period) : "—"}</b></span>
              <span><small>ประมวลผลล่าสุด</small><b>{rawDataset.meta.generatedAt ? thaiDateTime(rawDataset.meta.generatedAt) : "—"}</b></span>
              <span><small>Ruleset</small><b className="mono">v{rawDataset.reconciliation.rulesetVersion}</b></span>
              <span><small>เขตเวลา</small><b>Asia/Bangkok</b></span>
              <span><small>คำจองในระบบ</small><b>{rawDataset.bookings.length.toLocaleString("en-US")} รายการ</b></span>
            </div>
          </section>

          <section className="panel settings-panel">
            <PanelTitle kicker="Documents" title="เอกสารต้นทางที่อ่านเข้ามา" />
            <div className="source-list settings-sources">
              {!hasData && <p className="table-note">ยังไม่มีเอกสารในระบบ</p>}
              {rawDataset.meta.sources.map((item) => (
                <div key={item.name}>
                  <span className={`file-icon ${item.name.endsWith(".pdf") ? "pdf" : "sheet"}`}>{item.name.endsWith(".pdf") ? "P" : "X"}</span>
                  <p><b>{item.name}</b><small>{item.label ?? item.kind}</small></p>
                  <em>{item.rows.toLocaleString("en-US")} แถว</em>
                </div>
              ))}
            </div>
          </section>

          {hasData && (
            <section className="panel settings-panel">
              <PanelTitle
                kicker="Control totals"
                title="การตรวจยอดคุมของแต่ละบัญชี"
                action={<Pill tone={effective.dataset.reconciliation.summary.controlBalanced ? "green" : "red"}>{effective.dataset.reconciliation.summary.controlBalanced ? "ตรงทุกบัญชี" : "มีบัญชีไม่ตรง"}</Pill>}
              />
              <div className="responsive-table">
                <table>
                  <thead>
                    <tr><th>บัญชี</th><th>ช่องทางรับเงิน</th><th>ยอดยกมา</th><th>ยอดฝาก</th><th>ยอดถอน</th><th>ยอดยกไป</th><th>ผลต่าง</th></tr>
                  </thead>
                  <tbody>
                    {effective.dataset.reconciliation.accounts.map((account) => (
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
      )}

      {section === "manage" && (
        <ManageSettings settings={settings} onChange={onChange} onReset={onReset} />
      )}
    </>
  );
}

// ── ตัวเลือกที่มาจากข้อมูลจริง ───────────────────────────────────────────────

function FacetPanel({ kicker, title, hint, facets, selected, onToggle, onClear, disabled, shadowed = [] }: {
  kicker: string;
  title: string;
  hint: string;
  facets: Facet[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  disabled: boolean;
  shadowed?: string[];
}) {
  const total = facets.reduce((sum, facet) => sum + Math.abs(facet.amountSatang), 0) || 1;

  return (
    <section className={`panel settings-panel facet-panel ${disabled ? "is-disabled" : ""}`}>
      <PanelTitle
        kicker={kicker}
        title={title}
        action={selected.length ? <button className="text-button" onClick={onClear}>ล้าง {selected.length} รายการ</button> : <Pill>ไม่ได้ตัดออก</Pill>}
      />
      <p className="settings-lead">{hint}</p>
      <div className="facet-list">
        {!facets.length && <p className="table-note">ไม่มีค่านี้ในเอกสารต้นทาง</p>}
        {facets.map((facet) => {
          const checked = selected.includes(facet.value);
          // ถูกตัดไปแล้วด้วยกฎกลุ่มทรัพย์สิน — บอกให้รู้ว่าติ๊กซ้ำก็ไม่เปลี่ยนอะไร
          const covered = !checked && shadowed.some((item) => item.toLowerCase() === propertyOf(facet.value).toLowerCase());
          return (
            <button
              key={facet.value}
              type="button"
              className={`facet-row ${checked ? "checked" : ""} ${covered ? "covered" : ""}`}
              onClick={() => onToggle(facet.value)}
              disabled={disabled}
              aria-pressed={checked}
            >
              <span className="facet-box">{checked ? "✓" : ""}</span>
              <span className="facet-name">
                <b>{facet.value}</b>
                <small>{facet.count} รายการ{facet.note ? ` · ${facet.note}` : ""}{covered ? " · ถูกตัดอยู่แล้วโดยกฎกลุ่มทรัพย์สิน" : ""}</small>
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

function KeywordPanel({ keywords, onChange, disabled }: { keywords: string[]; onChange: (next: string[]) => void; disabled: boolean }) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value || keywords.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...keywords, value]);
    setDraft("");
  };

  return (
    <section className={`panel settings-panel ${disabled ? "is-disabled" : ""}`}>
      <PanelTitle
        kicker="Keyword"
        title="ตัดด้วยคำค้น"
        action={keywords.length ? <button className="text-button" onClick={() => onChange([])}>ล้างทั้งหมด</button> : <Pill>ยังไม่มีคำค้น</Pill>}
      />
      <p className="settings-lead">
        ตัดรายการที่มีคำนี้อยู่ในชื่อผู้จอง หมายเหตุ ห้อง กลุ่ม ช่องทาง หรือเลขที่จอง — ไม่สนตัวพิมพ์ใหญ่เล็ก
        ใช้เมื่อไม่มีตัวเลือกสำเร็จรูปให้เลือก
      </p>
      <div className="keyword-input">
        <input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
          placeholder="พิมพ์คำแล้วกด Enter"
        />
        <button className="small-primary" type="button" onClick={add} disabled={disabled}>เพิ่ม</button>
      </div>
      <div className="keyword-chips">
        {!keywords.length && <span className="table-note">ยังไม่ได้เพิ่มคำค้น</span>}
        {keywords.map((keyword) => (
          <span key={keyword} className="keyword-chip">
            {keyword}
            <button type="button" aria-label={`ลบคำค้น ${keyword}`} onClick={() => onChange(keywords.filter((item) => item !== keyword))}>×</button>
          </span>
        ))}
      </div>
    </section>
  );
}

// ── รายการที่ถูกตัดออกจริง ───────────────────────────────────────────────────

function ExcludedPreview({ effective }: { effective: EffectiveDataset }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? effective.excluded : effective.excluded.slice(0, 25);

  if (!effective.excluded.length) {
    return (
      <section className="panel settings-panel">
        <PanelTitle kicker="Excluded rows" title="รายการที่ถูกตัดออก" />
        <div className="empty-state"><span>✓</span><h3>ยังไม่มีรายการใดถูกตัดออก</h3><p>ทุกรายการในเอกสารต้นทางเข้าสู่การกระทบยอดทั้งหมด</p></div>
      </section>
    );
  }

  return (
    <section className="panel settings-panel data-panel">
      <PanelTitle
        kicker="Excluded rows"
        title={`รายการที่ถูกตัดออก (${effective.excluded.length})`}
        action={<span className="excluded-total">รวม <b>{baht(effective.excludedSatang)}</b></span>}
      />
      <div className="responsive-table scroll-table">
        <table>
          <thead>
            <tr><th>วันที่รับเงิน</th><th>เลขที่จอง / ผู้จอง</th><th>กลุ่ม / ห้อง</th><th>ช่องทางรับเงิน</th><th>ยอด</th><th>ถูกตัดด้วยกฎ</th></tr>
          </thead>
          <tbody>
            {rows.map((receipt) => (
              <tr key={receipt.id}>
                <td>{thaiDate(receipt.date)}<small className="block mono">{receipt.id}</small></td>
                <td><b>{receipt.guest || "—"}</b><small className="block mono">{receipt.reservationNo}</small></td>
                <td>{receipt.group}<small className="block">{receipt.roomType} · {receipt.roomNumber}</small></td>
                <td>{receipt.method}<small className="block">{receipt.channel}</small></td>
                <td><strong>{baht(receipt.amountSatang)}</strong></td>
                <td>
                  <Pill tone={scopeTone[receipt.excludedBy.scope]}>{EXCLUSION_SCOPE_LABEL[receipt.excludedBy.scope]}</Pill>
                  <small className="block">{receipt.excludedBy.value}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {effective.excluded.length > 25 && (
        <p className="table-note">
          <button className="text-button" onClick={() => setExpanded(!expanded)}>
            {expanded ? "ย่อกลับเหลือ 25 แถว" : `แสดงทั้งหมด ${effective.excluded.length} แถว`}
          </button>
        </p>
      )}
    </section>
  );
}

// ── จัดการค่าที่ตั้งไว้ ──────────────────────────────────────────────────────

function ManageSettings({ settings, onChange, onReset }: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onReset: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const json = JSON.stringify(settings, null, 2);
  const isDefault = json === JSON.stringify(DEFAULT_SETTINGS, null, 2);

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

  const importFile = async (file: File) => {
    try {
      onChange(normalizeSettings(JSON.parse(await file.text())));
      setMessage(`นำเข้าการตั้งค่าจาก ${file.name} แล้ว`);
    } catch {
      setMessage("ไฟล์นี้อ่านไม่ได้ ต้องเป็นไฟล์ JSON ที่ส่งออกจากหน้านี้");
    }
  };

  return (
    <>
      <section className="panel settings-panel">
        <PanelTitle
          kicker="Manage"
          title="จัดการค่าที่ตั้งไว้"
          action={<Pill tone={isDefault ? "slate" : "blue"}>{isDefault ? "เป็นค่าตั้งต้น" : "ถูกแก้ไขจากค่าตั้งต้น"}</Pill>}
        />
        <div className="settings-field">
          <span><b>คืนค่าตั้งต้น</b><small>กลับไปเป็นค่าเริ่มต้นของระบบ คือตัดกลุ่ม <code>Medina</code> และช่องทาง <code>Kbank-Posh</code> ออก พร้อมเปิดการจับคู่ทุกรูปแบบ</small></span>
          <button className="secondary-button" onClick={() => { onReset(); setMessage("คืนค่าตั้งต้นเรียบร้อย"); }}>คืนค่าตั้งต้น</button>
        </div>
        <div className="settings-field">
          <span><b>ส่งออกไฟล์การตั้งค่า</b><small>ได้ไฟล์ JSON หนึ่งไฟล์ ใช้ตั้งค่าเครื่องอื่นให้เหมือนกัน หรือแนบไว้กับกระดาษทำการเพื่อบอกว่ารอบนี้กรองอะไรออกไปบ้าง</small></span>
          <button className="secondary-button" onClick={exportFile}>⇩ ส่งออก JSON</button>
        </div>
        <div className="settings-field">
          <span><b>นำเข้าไฟล์การตั้งค่า</b><small>ค่าที่ไม่ถูกต้องจะถูกแทนที่ด้วยค่าตั้งต้นให้อัตโนมัติ ไม่ทำให้ระบบพัง</small></span>
          <span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }}
            />
            <button className="secondary-button" onClick={() => fileRef.current?.click()}>↑ เลือกไฟล์</button>
          </span>
        </div>
        {message && <div className="settings-message">✓ {message}</div>}
      </section>

      <section className="panel settings-panel">
        <PanelTitle kicker="Raw" title="ค่าปัจจุบันในรูปแบบ JSON" action={<button className="text-button" onClick={() => { void navigator.clipboard?.writeText(json); setMessage("คัดลอกไปยังคลิปบอร์ดแล้ว"); }}>คัดลอก</button>} />
        <pre className="settings-json">{json}</pre>
      </section>
    </>
  );
}

// ── ช่องกรอกจำนวนเงิน ────────────────────────────────────────────────────────

function BahtInput({ value, onChange, placeholder }: {
  value: number | null;
  onChange: (satang: number | null) => void;
  placeholder: string;
}) {
  return (
    <span className="baht-input">
      <em>฿</em>
      <input
        type="number"
        min={0}
        step={100}
        placeholder={placeholder}
        value={value === null ? "" : value / 100}
        onChange={(event) => {
          const raw = event.target.value.trim();
          const number = Number(raw);
          onChange(raw === "" || !Number.isFinite(number) || number < 0 ? null : Math.round(number * 100));
        }}
      />
    </span>
  );
}
