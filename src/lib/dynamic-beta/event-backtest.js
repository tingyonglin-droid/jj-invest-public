import { calculateMarketRiskScore } from "./market-risk-score.js";

const MACRO_LAGS = Object.freeze({
  UNRATE: 42,
  PAYEMS: 42,
  CPILFESL: 48,
  PCEPILFE: 65,
});

const MACRO_SERIES = new Set(Object.keys(MACRO_LAGS));

export const MARKET_RISK_EVENTS = Object.freeze([
  Object.freeze({ id: "covid-2020", name: "2020 年 3 月疫情崩盤", peakFrom: "2020-01-15", peakTo: "2020-02-29", troughFrom: "2020-03-01", troughTo: "2020-04-15" }),
  Object.freeze({ id: "bear-market-2022", name: "2022 年 10 月熊市低點", peakFrom: "2022-07-15", peakTo: "2022-08-31", troughFrom: "2022-09-15", troughTo: "2022-11-15" }),
  Object.freeze({ id: "selloff-2024-08", name: "2024 年 8 月急跌", peakFrom: "2024-07-01", peakTo: "2024-07-31", troughFrom: "2024-08-01", troughTo: "2024-08-20" }),
  Object.freeze({ id: "selloff-2025-04", name: "2025 年 4 月急跌", peakFrom: "2025-02-15", peakTo: "2025-03-31", troughFrom: "2025-04-01", troughTo: "2025-04-30" }),
]);

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function applyMacroAvailabilityLag(histories) {
  return Object.fromEntries(
    Object.entries(histories).map(([seriesId, observations]) => [
      seriesId,
      observations.map((observation) => {
        const lag = MACRO_LAGS[seriesId];
        return lag
          ? {
              ...observation,
              observationDate: addDays(observation.observationDate, lag),
              sourceObservationDate: observation.observationDate,
            }
          : { ...observation };
      }),
    ]),
  );
}

export function findEventBounds(spyHistory, event) {
  const peakCandidates = spyHistory.filter(
    (item) => item.observationDate >= event.peakFrom && item.observationDate <= event.peakTo,
  );
  const troughCandidates = spyHistory.filter(
    (item) => item.observationDate >= event.troughFrom && item.observationDate <= event.troughTo,
  );
  if (!peakCandidates.length || !troughCandidates.length) {
    throw new Error(`事件 ${event.id || event.name || "unknown"} 缺少 SPY 價格。`);
  }
  const peak = peakCandidates.reduce((best, item) =>
    Number(item.value) > Number(best.value) ? item : best);
  const trough = troughCandidates.reduce((best, item) =>
    Number(item.value) < Number(best.value) ? item : best);
  return {
    peakDate: peak.observationDate,
    peakValue: Number(peak.value),
    troughDate: trough.observationDate,
    troughValue: Number(trough.value),
    drawdownPercent: Number(
      (((Number(trough.value) / Number(peak.value)) - 1) * 100).toFixed(2),
    ),
  };
}

export function classifyWarning({ firstCross40, peakDate, troughDate }) {
  if (!firstCross40) return "missed";
  if (firstCross40 < peakDate) return "early-warning";
  if (firstCross40 <= troughDate) return "concurrent-confirmation";
  return "late";
}

function scoreDates(histories, dates, options = {}) {
  return dates.map((date) =>
    calculateMarketRiskScore({ histories, asOf: date, ...options }));
}

function firstCross(scores, threshold) {
  return scores.find((item) => item.score !== null && item.score >= threshold) || null;
}

function maximumScore(scores) {
  return scores
    .filter((item) => item.score !== null)
    .reduce((best, item) => !best || item.score > best.score ? item : best, null);
}

function pointAtOffset(scoresByDate, tradingDates, anchorIndex, offset) {
  const date = tradingDates[anchorIndex + offset];
  const point = date ? scoresByDate.get(date) : null;
  return point ? { date, score: point.score, coverage: point.coverage } : null;
}

function summarizeModel(scores, tradingDates, peakIndex, troughIndex) {
  const byDate = new Map(scores.map((item) => [item.asOf, item]));
  const preScores = scores.filter((item) => item.asOf <= tradingDates[peakIndex]);
  const throughTrough = scores.filter((item) => item.asOf <= tradingDates[troughIndex]);
  const first40 = firstCross(scores, 40);
  const first60 = firstCross(scores, 60);
  const preMax = maximumScore(preScores);
  const throughTroughMax = maximumScore(throughTrough);
  const crossIndex = first40 ? tradingDates.indexOf(first40.asOf) : -1;
  const topContributors = (preMax?.signals || [])
    .filter((signal) => signal.available)
    .map((signal) => ({
      id: signal.id,
      name: signal.name,
      score: signal.score,
      weight: signal.weight,
      weightedContribution: Number((signal.score * signal.weight).toFixed(3)),
    }))
    .sort((a, b) => b.weightedContribution - a.weightedContribution)
    .slice(0, 5);
  return {
    classification: classifyWarning({
      firstCross40: first40?.asOf || null,
      peakDate: tradingDates[peakIndex],
      troughDate: tradingDates[troughIndex],
    }),
    firstCross40: first40?.asOf || null,
    firstCross60: first60?.asOf || null,
    leadTradingDays: crossIndex >= 0 ? peakIndex - crossIndex : null,
    preEventMaximum: preMax
      ? { date: preMax.asOf, score: preMax.score, coverage: preMax.coverage }
      : null,
    throughTroughMaximum: throughTroughMax
      ? { date: throughTroughMax.asOf, score: throughTroughMax.score, coverage: throughTroughMax.coverage }
      : null,
    checkpoints: {
      pre60: pointAtOffset(byDate, tradingDates, peakIndex, -60),
      pre20: pointAtOffset(byDate, tradingDates, peakIndex, -20),
      pre5: pointAtOffset(byDate, tradingDates, peakIndex, -5),
      peak: pointAtOffset(byDate, tradingDates, peakIndex, 0),
      trough: pointAtOffset(byDate, tradingDates, troughIndex, 0),
    },
    topPreEventContributors: topContributors,
  };
}

export function runMarketRiskEventBacktest({
  histories,
  events = MARKET_RISK_EVENTS,
}) {
  const spy = (histories["YAHOO:SPY"] || [])
    .map((item) => ({ ...item, value: Number(item.value) }))
    .sort((a, b) => a.observationDate.localeCompare(b.observationDate));
  const tradingDates = spy.map((item) => item.observationDate);
  const fullHistories = applyMacroAvailabilityLag(histories);
  const marketHistories = Object.fromEntries(
    Object.entries(histories).filter(([seriesId]) => !MACRO_SERIES.has(seriesId)),
  );

  return {
    generatedAt: new Date().toISOString(),
    scoreModel: "market-risk-v0.1.0",
    macroHistoryQuality: "revised-data-with-conservative-release-lag",
    events: events.map((event) => {
      const bounds = findEventBounds(spy, event);
      const peakIndex = tradingDates.indexOf(bounds.peakDate);
      const troughIndex = tradingDates.indexOf(bounds.troughDate);
      const startIndex = Math.max(0, peakIndex - 60);
      const endIndex = Math.min(tradingDates.length - 1, troughIndex + 20);
      const dates = tradingDates.slice(startIndex, endIndex + 1);
      const marketScores = scoreDates(marketHistories, dates, {
        excludedCategories: ["macro"],
      });
      const fullScores = scoreDates(fullHistories, dates);
      return {
        id: event.id,
        name: event.name,
        ...bounds,
        marketOnly: summarizeModel(
          marketScores,
          tradingDates,
          peakIndex,
          troughIndex,
        ),
        fullModel: summarizeModel(
          fullScores,
          tradingDates,
          peakIndex,
          troughIndex,
        ),
      };
    }),
  };
}
