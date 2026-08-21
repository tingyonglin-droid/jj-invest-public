export function normalizeSettlementCurrency(currency) {
  const normalized = String(currency || "").trim().toUpperCase();
  return normalized === "TWD" || normalized === "USD" ? normalized : null;
}

export function roundSettlementMoney(value, currency) {
  const digits = normalizeSettlementCurrency(currency) === "USD" ? 100 : 1;
  return Math.round((Number(value) + Number.EPSILON) * digits) / digits;
}
