const aliases = new Map([
  ["BOOKINGCOMCOLLECT", "BOOKING_COLLECT"],
  ["BOOKINGCOLLECT", "BOOKING_COLLECT"],
  ["TRIPCOMCOLLECT", "TRIP_COLLECT"],
  ["TRIPCOLLECT", "TRIP_COLLECT"],
  ["AIRBNBCOLLECT", "AIRBNB_COLLECT"],
]);

export function normalizePaymentMethod(value) {
  const compact = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.COM/g, "COM")
    .replace(/[^A-Z0-9ก-๙]/g, "");
  return aliases.get(compact) ?? compact;
}

export function toSatang(value) {
  const clean = String(value ?? 0).replace(/,/g, "").trim();
  const match = clean.match(/^(-?)(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) throw new Error(`Invalid money value: ${value}`);
  const fraction = (match[3] ?? "").padEnd(2, "0");
  const amount = Number(match[2]) * 100 + Number(fraction || 0);
  return match[1] ? -amount : amount;
}

export function fromSatang(value) {
  return (value / 100).toFixed(2);
}

export function findAmountCombination(items, target, maxGroup = 4) {
  const targetSatang = typeof target === "number" ? target : toSatang(target);
  const values = items.map((item) => ({ ...item, satang: item.satang ?? toSatang(item.amount) }));

  function search(start, picked, sum) {
    if (picked.length > 0 && sum === targetSatang) return picked;
    if (picked.length >= maxGroup || sum > targetSatang) return null;
    for (let index = start; index < values.length; index += 1) {
      const result = search(index + 1, [...picked, values[index]], sum + values[index].satang);
      if (result) return result;
    }
    return null;
  }

  return search(0, [], 0);
}

export function reconcileBank(receipts, bankTransactions) {
  const remainingReceipts = receipts.map((item) => ({ ...item, satang: toSatang(item.amount) }));
  const remainingBank = bankTransactions.map((item) => ({ ...item, satang: toSatang(item.amount) }));
  const groups = [];

  for (let bankIndex = remainingBank.length - 1; bankIndex >= 0; bankIndex -= 1) {
    const bank = remainingBank[bankIndex];
    const exactIndex = remainingReceipts.findIndex((receipt) => receipt.satang === bank.satang);
    if (exactIndex >= 0) {
      const [receipt] = remainingReceipts.splice(exactIndex, 1);
      remainingBank.splice(bankIndex, 1);
      groups.push({ type: "1:1", receiptIds: [receipt.id], bankIds: [bank.id], score: 100 });
    }
  }

  for (let bankIndex = remainingBank.length - 1; bankIndex >= 0; bankIndex -= 1) {
    const bank = remainingBank[bankIndex];
    const combo = findAmountCombination(remainingReceipts, bank.satang, 4);
    if (combo && combo.length > 1) {
      const ids = new Set(combo.map((item) => item.id));
      for (let i = remainingReceipts.length - 1; i >= 0; i -= 1) {
        if (ids.has(remainingReceipts[i].id)) remainingReceipts.splice(i, 1);
      }
      remainingBank.splice(bankIndex, 1);
      groups.push({ type: "N:1", receiptIds: [...ids], bankIds: [bank.id], score: 92 });
    }
  }

  for (let receiptIndex = remainingReceipts.length - 1; receiptIndex >= 0; receiptIndex -= 1) {
    const receipt = remainingReceipts[receiptIndex];
    const combo = findAmountCombination(remainingBank, receipt.satang, 4);
    if (combo && combo.length > 1) {
      const ids = new Set(combo.map((item) => item.id));
      for (let i = remainingBank.length - 1; i >= 0; i -= 1) {
        if (ids.has(remainingBank[i].id)) remainingBank.splice(i, 1);
      }
      remainingReceipts.splice(receiptIndex, 1);
      groups.push({ type: "1:N", receiptIds: [receipt.id], bankIds: [...ids], score: 90 });
    }
  }

  const exceptions = remainingReceipts.map((receipt) => {
    const candidate = remainingBank[0];
    return {
      reason: candidate ? "AMOUNT_MISMATCH" : "BANK_NOT_FOUND",
      receiptId: receipt.id,
      bankId: candidate?.id ?? null,
      deltaSatang: candidate ? receipt.satang - candidate.satang : receipt.satang,
    };
  });

  return { groups, exceptions, remainingBank };
}

export function reconcileOtaSettlement(bookings, settlementLines, payout) {
  const grossSatang = bookings.reduce((sum, item) => sum + toSatang(item.gross), 0);
  const settlementGrossSatang = settlementLines.reduce((sum, item) => sum + toSatang(item.gross), 0);
  const feeSatang = settlementLines.reduce((sum, item) => sum + toSatang(item.fee), 0);
  const netSatang = settlementLines.reduce((sum, item) => sum + toSatang(item.net), 0);
  const payoutSatang = toSatang(payout.amount);
  return {
    grossSatang,
    feeSatang,
    netSatang,
    payoutSatang,
    bookingToSettlementMatched: grossSatang === settlementGrossSatang,
    settlementToBankMatched: netSatang === payoutSatang,
    deltaSatang: netSatang - payoutSatang,
  };
}

export function invoiceTotals(lines, vatRate = 0.07, pricesIncludeVat = true) {
  const totalSatang = lines.reduce((sum, line) => sum + toSatang(line.amount), 0);
  if (pricesIncludeVat) {
    const subtotalSatang = Math.round(totalSatang / (1 + vatRate));
    return { subtotalSatang, vatSatang: totalSatang - subtotalSatang, totalSatang };
  }
  const vatSatang = Math.round(totalSatang * vatRate);
  return { subtotalSatang: totalSatang, vatSatang, totalSatang: totalSatang + vatSatang };
}
