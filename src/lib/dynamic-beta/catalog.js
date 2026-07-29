const FRED_DAILY_FRESHNESS = Object.freeze({
  kind: "weekdays",
  fresh: 2,
  delayed: 4,
});
const MARKET_DAILY_FRESHNESS = Object.freeze({
  kind: "weekdays",
  fresh: 1,
  delayed: 2,
});
const MONTHLY_FRESHNESS = Object.freeze({
  UNRATE: Object.freeze({ kind: "month_end_days", fresh: 12, delayed: 20 }),
  PAYEMS: Object.freeze({ kind: "month_end_days", fresh: 12, delayed: 20 }),
  CPILFESL: Object.freeze({ kind: "month_end_days", fresh: 18, delayed: 25 }),
  PCEPILFE: Object.freeze({ kind: "month_end_days", fresh: 35, delayed: 45 }),
});

const FRED_SERIES = [
  ["VIXCLS", "VIX", "volatility"],
  ["DGS2", "US 2-Year Treasury Yield", "rates"],
  ["DGS10", "US 10-Year Treasury Yield", "rates"],
  ["BAMLH0A0HYM2", "US High Yield Option-Adjusted Spread", "credit"],
  ["DCOILBRENTEU", "Brent Crude Oil", "commodities"],
  ["DCOILWTICO", "WTI Crude Oil", "commodities"],
  ["UNRATE", "US Unemployment Rate", "labor"],
  ["PAYEMS", "US Nonfarm Payrolls", "labor"],
  ["CPILFESL", "US Core CPI", "inflation"],
  ["PCEPILFE", "US Core PCE", "inflation"],
].map(([seriesId, name, category]) => ({
  seriesId,
  name,
  category,
  source: "FRED",
  frequency: null,
  unit: null,
  enabled: true,
  freshnessPolicy: MONTHLY_FRESHNESS[seriesId] || FRED_DAILY_FRESHNESS,
}));

const EQUITY_SERIES = [
  ["SPY", "SPDR S&P 500 ETF Trust", "USD", "equity_market"],
  ["QQQ", "Invesco QQQ Trust", "USD", "equity_market"],
  ["SOXX", "iShares Semiconductor ETF", "USD", "equity_market"],
  ["0050.TW", "Yuanta Taiwan 50", "TWD", "equity_market"],
  ["00631L.TW", "Yuanta Daily Taiwan 50 Bull 2X", "TWD", "equity_market"],
  ["^VIX", "VIX Market Proxy", "Index", "market_proxy"],
  ["CL=F", "WTI Crude Oil Futures", "Dollars per Barrel", "market_proxy"],
  ["BZ=F", "Brent Crude Oil Futures", "Dollars per Barrel", "market_proxy"],
  ["^TNX", "US 10-Year Treasury Yield Market Proxy", "Percent", "market_proxy"],
  ["2YY=F", "US 2-Year Treasury Yield Market Proxy", "Percent", "market_proxy"],
].map(([symbol, name, unit, category]) => ({
  seriesId: `YAHOO:${symbol}`,
  symbol,
  name,
  category,
  source: "Yahoo Finance",
  frequency: "Daily",
  unit,
  enabled: true,
  freshnessPolicy: MARKET_DAILY_FRESHNESS,
}));

export const DYNAMIC_BETA_SERIES = Object.freeze([
  ...FRED_SERIES,
  ...EQUITY_SERIES,
].map((series) => Object.freeze(series)));

export function getDynamicBetaSeries(seriesId) {
  return DYNAMIC_BETA_SERIES.find((series) => series.seriesId === seriesId) || null;
}
