import generated from "./dataset.generated.json";

// Everything the UI renders comes from this file. It is produced by
// `npm run data:build`, which parses the source documents in data/ — the two
// KBank statement PDFs, the collection report and the ledger export.
// There is no demo, seeded or hand-written data anywhere in the app.

export type MatchType = "1:1" | "N:1" | "1:N";
export type Severity = "high" | "medium" | "low";

export type Booking = {
  reservationNo: string;
  channelReservationNo: string;
  createdAt: string;
  createdDate: string;
  completedAt: string;
  creator: string;
  guest: string;
  mobile: string;
  channel: string;
  status: string;
  roomType: string;
  roomNumber: string;
  nights: number;
  totalSatang: number;
  payments: { method: string; amountSatang: number }[];
  paidSatang: number;
  arSatang: number;
  balanceDueSatang: number;
};

export type Receipt = {
  id: string;
  sourceRow: number;
  date: string;
  kind: "RECEIVE" | "REFUND";
  method: string;
  amountSatang: number;
  reservationNo: string;
  channelReservationNo: string;
  channel: string;
  guest: string;
  group: string;
  roomType: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  note: string;
};

export type StatementLine = {
  id: string;
  date: string;
  time: string;
  description: string;
  channel: string;
  detail: string;
  direction: "credit" | "debit";
  amountSatang: number;
  balanceSatang: number;
  page: number;
  row: number;
};

export type Statement = {
  code: string;
  method: string;
  source: string;
  accountNo: string;
  accountName: string;
  branch: string;
  reference: string;
  cycle: string;
  suffix: string;
  openingSatang: number;
  closingSatang: number;
  creditSatang: number;
  debitSatang: number;
  creditCount: number;
  debitCount: number;
  controlDeltaSatang: number;
  lines: StatementLine[];
};

export type GroupReceipt = {
  id: string;
  reservationNo: string;
  guest: string;
  roomType: string;
  roomNumber: string;
  channel: string;
  method: string;
  receiptDate: string;
  checkIn: string;
  checkOut: string;
  bookingCreatedAt: string;
  bookingCreatedDate: string;
  bookingStatus: string;
  bookingTotalSatang: number;
  bookingPaidSatang: number;
  bookingBalanceDueSatang: number;
  bookingNights: number;
  amountSatang: number;
  allocatedSatang: number;
  sourceRow: number;
};

export type GroupLine = {
  id: string;
  date: string;
  time: string;
  description: string;
  channel: string;
  detail: string;
  amountSatang: number;
  allocatedSatang: number;
  balanceSatang: number;
  balanceBeforeSatang: number;
  page: number;
  row: number;
};

export type RuleCheck = { id: string; label: string; left: string | number; right: string | number; passed: boolean };

export type MatchGroup = {
  id: string;
  account: string;
  accountNo: string;
  accountName: string;
  statementSource: string;
  type: MatchType;
  score: number;
  date: string;
  rulesPassed: RuleCheck[];
  receiptSatang: number;
  bankSatang: number;
  deltaSatang: number;
  receipts: GroupReceipt[];
  lines: GroupLine[];
};

export type ReconciliationException = {
  id: string;
  reason: string;
  label: string;
  severity: Severity;
  account: string;
  accountNo: string;
  reservationNo: string;
  guest: string;
  receiptId: string;
  receiptDate: string;
  receiptSatang: number;
  bookingCreatedAt: string;
  bookingCreatedDate: string;
  bookingStatus: string;
  bankLineId: string;
  bankDate: string;
  bankSatang: number;
  deltaSatang: number;
  candidates: { id: string; time: string; amountSatang: number; detail: string; deltaSatang: number }[];
  status: string;
};

export type AccountResult = {
  code: string;
  accountNo: string;
  method: string;
  branch: string;
  source: string;
  openingSatang: number;
  closingSatang: number;
  creditSatang: number;
  debitSatang: number;
  creditCount: number;
  debitCount: number;
  controlDeltaSatang: number;
  receiptCount: number;
  receiptSatang: number;
  matchedReceipts: number;
  matchedSatang: number;
  groupCount: number;
  exceptionCount: number;
  matchRate: number;
};

export type Dataset = {
  meta: {
    generatedAt: string;
    period: string;
    rulesetVersion: string;
    sources: { kind: string; label?: string; name: string; rows: number }[];
  };
  bookings: Booking[];
  receipts: Receipt[];
  statements: Statement[];
  reconciliation: {
    rulesetVersion: string;
    accounts: AccountResult[];
    groups: MatchGroup[];
    exceptions: ReconciliationException[];
    outOfScope: { method: string; count: number; amountSatang: number }[];
    summary: {
      inScopeReceipts: number;
      matchedReceipts: number;
      matchedGroups: number;
      exceptionCount: number;
      matchRate: number;
      matchedSatang: number;
      unexplainedReceiptSatang: number;
      unexplainedBankSatang: number;
      controlBalanced: boolean;
    };
  };
};

export const dataset = generated as unknown as Dataset;

export const baht = (satang: number) =>
  `${satang < 0 ? "−" : ""}฿${(Math.abs(satang) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export const thaiDate = (iso: string) => {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${day} ${thaiMonths[month - 1]} ${year + 543}`;
};

export const thaiDateTime = (iso: string) => {
  if (!iso) return "—";
  return `${thaiDate(iso)} · ${iso.slice(11, 16)} น.`;
};

export const thaiMonthLabel = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  const full = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  if (!year || !month) return period;
  return `${full[month - 1]} ${year + 543}`;
};
