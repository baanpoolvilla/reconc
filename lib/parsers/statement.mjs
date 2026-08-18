import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { extractPdfTextFromBuffer, groupIntoLines } from "./pdf.mjs";

const datePattern = /^\d{2}-\d{2}-\d{2}$/;
const timePattern = /^\d{2}:\d{2}$/;
const moneyPattern = /^-?[\d,]+\.\d{2}$/;

const AMOUNT_MAX_X = 275;
const BALANCE_MIN_X = 276;
const BALANCE_MAX_X = 332;

function toSatang(text) {
  const clean = text.replace(/,/g, "");
  const [whole, fraction = "00"] = clean.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, "0")));
}

function toIsoDate(text) {
  // KBank prints dd-mm-yy where yy is the Gregorian year minus 2000.
  const [day, month, year] = text.split("-");
  return `20${year}-${month}-${day}`;
}

function fieldFrom(labelledLines, label) {
  for (const line of labelledLines) {
    const index = line.runs.findIndex((run) => run.text.startsWith(label));
    if (index >= 0 && line.runs[index + 1]) return line.runs[index + 1].text;
  }
  return "";
}

/** Parses a KBank K BIZ savings-account statement PDF into canonical lines. */
export function parseStatementPdf(path) {
  return parseStatementBuffer(readFileSync(path), basename(path));
}

/** Same, for a statement already in memory — an upload, for instance. */
export function parseStatementBuffer(buffer, sourceName) {
  const pages = extractPdfTextFromBuffer(buffer);
  const allLines = pages.map((page) => groupIntoLines(page));
  const headerLines = allLines[0];

  // ไม่มีหน้าไหนมีข้อความให้อ่านเลย = ไฟล์นี้ไม่ใช่ Statement ที่ K BIZ ออกให้
  // เช่นเป็นไฟล์ที่สแกนมาเป็นรูป หรือ PDF ที่สร้างจากเครื่องมืออื่น ถ้าปล่อยผ่าน
  // บรรทัดถัดไปจะพังเป็น "undefined is not iterable" ซึ่งบอกอะไรใครไม่ได้เลย
  if (!headerLines) {
    throw new Error(
      "อ่านข้อความในไฟล์ไม่ได้เลย — ต้องเป็น Statement PDF ที่ดาวน์โหลดจาก K BIZ โดยตรง ไม่ใช่ไฟล์สแกนหรือรูปภาพ",
    );
  }

  const accountNo = fieldFrom(headerLines, "เลขที่บัญชีเงินฝาก");
  const branch = fieldFrom(headerLines, "สาขาเจ้าของบัญชี");
  const reference = fieldFrom(headerLines, "เลขที่อ้างอิง");
  const cycle = fieldFrom(headerLines, "รอบระหว่างวันที่");
  const accountName = fieldFrom(headerLines, "ชื่อบัญชี");
  const suffix = accountNo.replace(/\D/g, "").slice(-4, -1);

  const lines = [];
  let openingSatang = null;
  let closingSatang = null;

  allLines.forEach((pageLines, pageIndex) => {
    pageLines.forEach((line, lineIndex) => {
      const [first, second] = line.runs;
      if (!first || !datePattern.test(first.text)) return;

      const money = line.runs.filter((run) => moneyPattern.test(run.text));
      if (!money.length) return;

      const balanceRun = money.find((run) => run.x >= BALANCE_MIN_X && run.x <= BALANCE_MAX_X) ?? money.at(-1);
      const balanceSatang = toSatang(balanceRun.text);

      // "ยอดยกมา" (carry-forward) rows only restate the running balance.
      if (!second || !timePattern.test(second.text)) {
        if (openingSatang === null) openingSatang = balanceSatang;
        return;
      }

      const amountRun = money.find((run) => run !== balanceRun && run.x <= AMOUNT_MAX_X);
      if (!amountRun) return;

      const previousBalance = lines.length ? lines.at(-1).balanceSatang : openingSatang;
      const amountSatang = toSatang(amountRun.text);
      const delta = previousBalance === null ? amountSatang : balanceSatang - previousBalance;
      const direction = delta >= 0 ? "credit" : "debit";

      const descriptionRuns = line.runs.filter((run) => run.x > 110 && run.x < 213);
      const channelRuns = line.runs.filter((run) => run.x >= 333 && run.x < 400);
      const detailRuns = line.runs.filter((run) => run.x >= 400);

      lines.push({
        id: `${suffix}-${toIsoDate(first.text).replace(/-/g, "")}-${String(lines.length + 1).padStart(3, "0")}`,
        date: toIsoDate(first.text),
        time: second.text,
        description: descriptionRuns.map((run) => run.text).join(" ").trim(),
        channel: channelRuns.map((run) => run.text).join(" ").trim(),
        detail: detailRuns.map((run) => run.text).join(" ").replace(/\+\+?$/, "").trim(),
        direction,
        amountSatang: Math.abs(amountSatang),
        balanceSatang,
        page: pageIndex + 1,
        row: lineIndex + 1,
      });
      closingSatang = balanceSatang;
    });
  });

  // อ่านข้อความออก แต่ไม่เจอสิ่งที่ statement ต้องมี = คนละเอกสารกัน
  if (!accountNo) {
    throw new Error("ไม่มีเลขที่บัญชีเงินฝากอยู่ในเอกสาร — น่าจะไม่ใช่ Statement ของ K BIZ");
  }
  if (!lines.length) {
    throw new Error("ไม่มีรายการเดินบัญชีให้อ่านสักบรรทัด");
  }

  const creditSatang = lines.filter((line) => line.direction === "credit").reduce((sum, line) => sum + line.amountSatang, 0);
  const debitSatang = lines.filter((line) => line.direction === "debit").reduce((sum, line) => sum + line.amountSatang, 0);

  return {
    source: sourceName,
    accountNo,
    accountName,
    branch,
    reference,
    cycle,
    suffix,
    openingSatang: openingSatang ?? 0,
    closingSatang: closingSatang ?? 0,
    creditSatang,
    debitSatang,
    creditCount: lines.filter((line) => line.direction === "credit").length,
    debitCount: lines.filter((line) => line.direction === "debit").length,
    controlDeltaSatang: (openingSatang ?? 0) + creditSatang - debitSatang - (closingSatang ?? 0),
    lines,
  };
}
