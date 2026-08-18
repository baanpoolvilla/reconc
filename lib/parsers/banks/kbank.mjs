// ธนาคารกสิกรไทย · Statement บัญชีออมทรัพย์จาก K BIZ
//
// ทุกอย่างที่เป็นเรื่องเฉพาะของธนาคารนี้อยู่ในไฟล์นี้ไฟล์เดียว: ป้ายกำกับหัวเอกสาร
// พิกัดของแต่ละคอลัมน์ และรูปแบบวันที่ ธนาคารรายถัดไปคือไฟล์ใหม่ข้าง ๆ กัน ไม่ใช่
// เงื่อนไข if เพิ่มในตัวอ่านกลาง

const datePattern = /^\d{2}-\d{2}-\d{2}$/;
const timePattern = /^\d{2}:\d{2}$/;
const moneyPattern = /^-?[\d,]+\.\d{2}$/;

// K BIZ วางคอลัมน์ไว้ที่พิกัดคงที่ ยอดเงินกับยอดคงเหลือจึงแยกกันด้วยตำแหน่ง ไม่ใช่
// ลำดับ — บรรทัดที่มีตัวเลขสามก้อนจะอ่านผิดทันทีถ้าเดาจากลำดับ
const AMOUNT_MAX_X = 275;
const BALANCE_MIN_X = 276;
const BALANCE_MAX_X = 332;
const DESCRIPTION_MIN_X = 110;
const DESCRIPTION_MAX_X = 213;
const CHANNEL_MIN_X = 333;
const CHANNEL_MAX_X = 400;

const FIELDS = {
  accountNo: "เลขที่บัญชีเงินฝาก",
  branch: "สาขาเจ้าของบัญชี",
  reference: "เลขที่อ้างอิง",
  cycle: "รอบระหว่างวันที่",
  accountName: "ชื่อบัญชี",
};

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

export const kbank = {
  id: "kbank",
  label: "ธนาคารกสิกรไทย (K BIZ)",

  /** ป้ายหัวเอกสารที่ K BIZ พิมพ์ไว้ ใช้บอกว่าไฟล์นี้เป็นของธนาคารนี้ */
  detect(allLines) {
    const header = allLines[0];
    if (!header) return false;
    return Boolean(fieldFrom(header, FIELDS.accountNo) && fieldFrom(header, FIELDS.cycle));
  },

  parse(allLines) {
    const header = allLines[0];
    const accountNo = fieldFrom(header, FIELDS.accountNo);
    // เลขสามตัวท้ายก่อนหลักตรวจสอบ คือรหัสที่คนที่นี่ใช้เรียกบัญชี
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

        const between = (min, max) => line.runs.filter((run) => run.x > min && run.x < max);

        lines.push({
          id: `${suffix}-${toIsoDate(first.text).replace(/-/g, "")}-${String(lines.length + 1).padStart(3, "0")}`,
          date: toIsoDate(first.text),
          time: second.text,
          description: between(DESCRIPTION_MIN_X, DESCRIPTION_MAX_X).map((run) => run.text).join(" ").trim(),
          channel: between(CHANNEL_MIN_X - 1, CHANNEL_MAX_X).map((run) => run.text).join(" ").trim(),
          detail: line.runs.filter((run) => run.x >= CHANNEL_MAX_X).map((run) => run.text).join(" ").replace(/\+\+?$/, "").trim(),
          direction: delta >= 0 ? "credit" : "debit",
          amountSatang: Math.abs(amountSatang),
          balanceSatang,
          page: pageIndex + 1,
          row: lineIndex + 1,
        });
        closingSatang = balanceSatang;
      });
    });

    return {
      accountNo,
      accountName: fieldFrom(header, FIELDS.accountName),
      branch: fieldFrom(header, FIELDS.branch),
      reference: fieldFrom(header, FIELDS.reference),
      cycle: fieldFrom(header, FIELDS.cycle),
      suffix,
      openingSatang,
      closingSatang,
      lines,
    };
  },
};
