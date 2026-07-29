export const MARKET_RISK_SCORE_VERSION = "market-risk-v0.1.0";
const MIN_COVERAGE = 0.7;

const CATEGORY_WEIGHTS = Object.freeze({
  volatility: 0.25,
  trend: 0.3,
  credit: 0.2,
  rates: 0.1,
  macro: 0.15,
});

function dayOffset(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function usableHistory(histories, seriesId, asOf) {
  return (histories[seriesId] || [])
    .filter((item) =>
      item?.observationDate <= asOf && Number.isFinite(Number(item.value)))
    .map((item) => ({
      observationDate: item.observationDate,
      value: Number(item.value),
    }))
    .sort((a, b) => a.observationDate.localeCompare(b.observationDate));
}

function latest(histories, seriesId, asOf) {
  return usableHistory(histories, seriesId, asOf).at(-1) || null;
}

function atOrBefore(histories, seriesId, dateText) {
  return usableHistory(histories, seriesId, dateText).at(-1) || null;
}

function change(histories, seriesId, asOf, days, kind = "difference") {
  const current = latest(histories, seriesId, asOf);
  const prior = atOrBefore(histories, seriesId, dayOffset(asOf, days));
  if (!current || !prior || prior.value === 0) return null;
  return {
    value: kind === "return"
      ? ((current.value / prior.value) - 1) * 100
      : current.value - prior.value,
    observationDate: current.observationDate,
    comparisonDate: prior.observationDate,
  };
}

export function scoreFixedThreshold(value, thresholds, direction = "higher") {
  if (!Number.isFinite(Number(value)) || thresholds.length !== 4) return null;
  const numeric = Number(value);
  if (direction === "lower") {
    if (numeric >= thresholds[0]) return 0;
    if (numeric >= thresholds[1]) return 25;
    if (numeric >= thresholds[2]) return 50;
    if (numeric >= thresholds[3]) return 75;
    return 100;
  }
  if (numeric <= thresholds[0]) return 0;
  if (numeric <= thresholds[1]) return 25;
  if (numeric <= thresholds[2]) return 50;
  if (numeric <= thresholds[3]) return 75;
  return 100;
}

function direct(histories, seriesId, asOf) {
  const item = latest(histories, seriesId, asOf);
  return item && { value: item.value, observationDate: item.observationDate };
}

function relativeReturn(histories, assetId, benchmarkId, asOf) {
  const asset = change(histories, assetId, asOf, 20, "return");
  const benchmark = change(histories, benchmarkId, asOf, 20, "return");
  if (!asset || !benchmark) return null;
  return {
    value: asset.value - benchmark.value,
    observationDate: asset.observationDate,
    comparisonDate: asset.comparisonDate,
  };
}

function drawdown(histories, seriesId, asOf) {
  const values = usableHistory(histories, seriesId, asOf)
    .filter((item) => item.observationDate >= dayOffset(asOf, 365));
  if (!values.length) return null;
  const current = values.at(-1);
  const high = Math.max(...values.map((item) => item.value));
  return {
    value: ((current.value / high) - 1) * 100,
    observationDate: current.observationDate,
  };
}

function curve(histories, asOf) {
  const two = latest(histories, "DGS2", asOf);
  const ten = latest(histories, "DGS10", asOf);
  if (!two || !ten) return null;
  return {
    value: ten.value - two.value,
    observationDate: ten.observationDate > two.observationDate
      ? ten.observationDate
      : two.observationDate,
  };
}

function absoluteChange(histories, seriesId, asOf) {
  const result = change(histories, seriesId, asOf, 20);
  return result && { ...result, value: Math.abs(result.value) };
}

function monthlyChange(histories, seriesId, asOf, periods) {
  const values = usableHistory(histories, seriesId, asOf);
  if (values.length <= periods) return null;
  const current = values.at(-1);
  const prior = values.at(-(periods + 1));
  return {
    value: current.value - prior.value,
    observationDate: current.observationDate,
    comparisonDate: prior.observationDate,
  };
}

function payrollAverageGain(histories, asOf) {
  const values = usableHistory(histories, "PAYEMS", asOf).slice(-4);
  if (values.length < 4) return null;
  const gains = values.slice(1).map((item, index) => item.value - values[index].value);
  return {
    value: gains.reduce((sum, gain) => sum + gain, 0) / gains.length,
    observationDate: values.at(-1).observationDate,
    comparisonDate: values[0].observationDate,
  };
}

function yearOverYear(histories, seriesId, asOf) {
  const values = usableHistory(histories, seriesId, asOf);
  if (values.length < 13) return null;
  const current = values.at(-1);
  const prior = values.at(-13);
  if (!prior.value) return null;
  return {
    value: ((current.value / prior.value) - 1) * 100,
    observationDate: current.observationDate,
    comparisonDate: prior.observationDate,
  };
}

const SIGNAL_DEFINITIONS = Object.freeze([
  { id: "vix_level", name: "VIX 水位", category: "volatility", weight: 0.15, seriesIds: ["VIXCLS"], thresholds: [15, 20, 25, 35], direction: "higher", derive: (h, a) => direct(h, "VIXCLS", a) },
  { id: "vix_20d_change", name: "VIX 20 日變化", category: "volatility", weight: 0.1, seriesIds: ["VIXCLS"], thresholds: [0, 3, 7, 12], direction: "higher", derive: (h, a) => change(h, "VIXCLS", a, 20) },
  { id: "spy_20d_return", name: "SPY 20 日報酬", category: "trend", weight: 0.08, seriesIds: ["YAHOO:SPY"], thresholds: [2, 0, -5, -10], direction: "lower", derive: (h, a) => change(h, "YAHOO:SPY", a, 20, "return") },
  { id: "spy_60d_return", name: "SPY 60 日報酬", category: "trend", weight: 0.08, seriesIds: ["YAHOO:SPY"], thresholds: [5, 0, -8, -15], direction: "lower", derive: (h, a) => change(h, "YAHOO:SPY", a, 60, "return") },
  { id: "spy_drawdown", name: "SPY 近一年回撤", category: "trend", weight: 0.06, seriesIds: ["YAHOO:SPY"], thresholds: [-3, -5, -10, -20], direction: "lower", derive: (h, a) => drawdown(h, "YAHOO:SPY", a) },
  { id: "qqq_relative_20d", name: "QQQ 相對 SPY 20 日", category: "trend", weight: 0.04, seriesIds: ["YAHOO:QQQ", "YAHOO:SPY"], thresholds: [0, -2, -5, -10], direction: "lower", derive: (h, a) => relativeReturn(h, "YAHOO:QQQ", "YAHOO:SPY", a) },
  { id: "soxx_relative_20d", name: "SOXX 相對 SPY 20 日", category: "trend", weight: 0.04, seriesIds: ["YAHOO:SOXX", "YAHOO:SPY"], thresholds: [0, -2, -5, -10], direction: "lower", derive: (h, a) => relativeReturn(h, "YAHOO:SOXX", "YAHOO:SPY", a) },
  { id: "hy_oas_level", name: "高收益債利差", category: "credit", weight: 0.12, seriesIds: ["BAMLH0A0HYM2"], thresholds: [3, 4, 5, 7], direction: "higher", derive: (h, a) => direct(h, "BAMLH0A0HYM2", a) },
  { id: "hy_oas_20d_change", name: "高收益債利差 20 日變化", category: "credit", weight: 0.08, seriesIds: ["BAMLH0A0HYM2"], thresholds: [0, 0.25, 0.75, 1.5], direction: "higher", derive: (h, a) => change(h, "BAMLH0A0HYM2", a, 20) },
  { id: "yield_curve", name: "10Y−2Y 殖利率曲線", category: "rates", weight: 0.04, seriesIds: ["DGS2", "DGS10"], thresholds: [0.5, 0, -0.25, -0.75], direction: "lower", derive: curve },
  { id: "dgs2_20d_move", name: "2Y 殖利率 20 日移動", category: "rates", weight: 0.03, seriesIds: ["DGS2"], thresholds: [0.15, 0.3, 0.5, 0.8], direction: "higher", derive: (h, a) => absoluteChange(h, "DGS2", a) },
  { id: "dgs10_20d_move", name: "10Y 殖利率 20 日移動", category: "rates", weight: 0.03, seriesIds: ["DGS10"], thresholds: [0.15, 0.3, 0.5, 0.8], direction: "higher", derive: (h, a) => absoluteChange(h, "DGS10", a) },
  { id: "unrate_3m_change", name: "失業率 3 個月變化", category: "macro", weight: 0.04, seriesIds: ["UNRATE"], thresholds: [0, 0.1, 0.3, 0.5], direction: "higher", derive: (h, a) => monthlyChange(h, "UNRATE", a, 3) },
  { id: "payems_3m_gain", name: "非農 3 個月平均增量", category: "macro", weight: 0.04, seriesIds: ["PAYEMS"], thresholds: [200, 150, 100, 50], direction: "lower", derive: payrollAverageGain },
  { id: "core_cpi_yoy", name: "核心 CPI 年增率", category: "macro", weight: 0.035, seriesIds: ["CPILFESL"], thresholds: [2.5, 3, 4, 5], direction: "higher", derive: (h, a) => yearOverYear(h, "CPILFESL", a) },
  { id: "core_pce_yoy", name: "核心 PCE 年增率", category: "macro", weight: 0.035, seriesIds: ["PCEPILFE"], thresholds: [2.5, 3, 4, 5], direction: "higher", derive: (h, a) => yearOverYear(h, "PCEPILFE", a) },
]);

function signalResult(definition, derived) {
  if (!derived || !Number.isFinite(derived.value)) {
    return { ...definition, derive: undefined, available: false, value: null, score: null, observationDate: null, comparisonDate: null, reason: "歷史資料不足，未納入計分。" };
  }
  const score = scoreFixedThreshold(
    derived.value,
    definition.thresholds,
    definition.direction,
  );
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    weight: definition.weight,
    seriesIds: definition.seriesIds,
    thresholds: definition.thresholds,
    direction: definition.direction,
    available: true,
    value: derived.value,
    score,
    observationDate: derived.observationDate,
    comparisonDate: derived.comparisonDate || null,
    reason: `${definition.name} 固定門檻評分為 ${score}。`,
  };
}

export function calculateMarketRiskScore({
  histories = {},
  asOf,
  excludedCategories = [],
}) {
  const date = String(asOf || new Date().toISOString().slice(0, 10));
  const excluded = new Set(excludedCategories);
  const activeDefinitions = SIGNAL_DEFINITIONS.filter(
    (definition) => !excluded.has(definition.category),
  );
  const expectedWeight = Number(
    activeDefinitions.reduce((sum, definition) => sum + definition.weight, 0).toFixed(6),
  );
  const signals = activeDefinitions.map((definition) =>
    signalResult(definition, definition.derive(histories, date)));
  const available = signals.filter((signal) => signal.available);
  const rawCoverage = Number(
    available.reduce((sum, signal) => sum + signal.weight, 0).toFixed(6),
  );
  const coverage = expectedWeight
    ? Number((rawCoverage / expectedWeight).toFixed(6))
    : 0;
  const weighted = available.reduce(
    (sum, signal) => sum + signal.score * signal.weight,
    0,
  );
  const score = coverage >= MIN_COVERAGE
    ? Number((weighted / rawCoverage).toFixed(2))
    : null;
  const categories = Object.entries(CATEGORY_WEIGHTS)
    .filter(([id]) => !excluded.has(id))
    .map(([id, weight]) => {
    const items = available.filter((signal) => signal.category === id);
    const availableWeight = items.reduce((sum, item) => sum + item.weight, 0);
    return {
      id,
      weight,
      availableWeight: Number(availableWeight.toFixed(6)),
      score: availableWeight
        ? Number((items.reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight).toFixed(2))
        : null,
    };
  });
  return {
    modelVersion: MARKET_RISK_SCORE_VERSION,
    asOf: date,
    mode: "offline-preview",
    historyQuality: "revised-data",
    status: coverage < MIN_COVERAGE
      ? "insufficient"
      : coverage < 0.999999
        ? "partial"
        : "complete",
    expectedWeight,
    rawCoverage,
    coverage,
    score,
    categories,
    signals,
  };
}
