function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundCash(value) {
  return Math.round(value + Number.EPSILON);
}

function hasValidFxRate(usdTwd) {
  return Number.isFinite(Number(usdTwd)) && Number(usdTwd) > 0;
}

export function calculateCashTwdValue({ cashTwd, cashUsd, usdTwd }) {
  const twdValue = toNumber(cashTwd);
  const usdValueTwd = hasValidFxRate(usdTwd) ? toNumber(cashUsd) * Number(usdTwd) : 0;
  return roundCash(twdValue + usdValueTwd);
}
