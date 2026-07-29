import {
  MARKET_RISK_EVENTS,
  applyMacroAvailabilityLag,
  findEventBounds,
} from "./event-backtest.js";
import { calculateMarketRiskScore } from "./market-risk-score.js";

export const FORENSIC_ANOMALY_SCORE = 50;

export const CRASH_DATA_GAPS = Object.freeze([
  { id: "market_breadth", name: "市場廣度", purpose: "辨識指數創高但多數成分股已轉弱", relevantEvents: ["2024-08", "2025-04"], currentSource: null, priority: "high" },
  { id: "vix_term_structure", name: "VIX 期貨期限結構", purpose: "辨識短期避險需求與波動結構倒掛", relevantEvents: ["2020-03", "2024-08", "2025-04"], currentSource: null, priority: "high" },
  { id: "skew", name: "CBOE SKEW", purpose: "衡量尾部風險避險定價", relevantEvents: ["2020-03", "2025-04"], currentSource: null, priority: "medium" },
  { id: "put_call", name: "Put/Call Ratio", purpose: "衡量選擇權避險與投機失衡", relevantEvents: ["2020-03", "2024-08"], currentSource: null, priority: "medium" },
  { id: "credit_etfs", name: "HYG／LQD 信用 ETF", purpose: "補足高收益債利差在 2023 年前的歷史缺口", relevantEvents: ["2020-03", "2022-10"], currentSource: null, priority: "high" },
  { id: "move", name: "MOVE 債券波動率", purpose: "辨識利率市場壓力與去槓桿", relevantEvents: ["2022-10", "2025-04"], currentSource: null, priority: "high" },
  { id: "dollar", name: "美元指數", purpose: "辨識全球美元流動性收緊", relevantEvents: ["2020-03", "2022-10"], currentSource: null, priority: "medium" },
  { id: "yen_carry", name: "日圓／套利交易代理", purpose: "辨識日圓套利平倉與跨資產去槓桿", relevantEvents: ["2024-08"], currentSource: null, priority: "high" },
  { id: "financial_conditions", name: "金融條件／資金壓力", purpose: "辨識融資、流動性與市場壓力同步收緊", relevantEvents: ["2020-03", "2022-10", "2025-04"], currentSource: null, priority: "high" },
]);

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function futureMaximumDrawdown(prices, index, tradingDays) {
  const current = Number(prices[index]?.value);
  if (!Number.isFinite(current) || current === 0) return null;
  const future = prices.slice(index + 1, index + tradingDays + 1);
  if (!future.length) return null;
  const minimum = Math.min(...future.map((item) => Number(item.value)));
  return Number((((minimum / current) - 1) * 100).toFixed(4));
}

export function isInsideEventExclusion(dateText, eventBounds, bufferDays = 90) {
  return eventBounds.some((event) =>
    dateText >= addDays(event.peakDate, -bufferDays) &&
    dateText <= addDays(event.troughDate, bufferDays));
}

export function isControlStudyDate(dateText) {
  return dateText >= "2020-01-01" && dateText <= "2025-12-31";
}

export function classifyForensicSignal({
  available,
  firstAnomaly,
  peakDate,
  troughDate,
  leadTradingDays,
  anomalyDaysBeforePeak,
  recoveredBeforePeak,
  controlAnomalyRate,
}) {
  if (!available) return "insufficient-data";
  if (!firstAnomaly) return "quiet";
  if (firstAnomaly < peakDate) {
    if (controlAnomalyRate >= 0.3) return "high-false-positive";
    if (
      leadTradingDays >= 5 &&
      anomalyDaysBeforePeak >= 3 &&
      !recoveredBeforePeak
    ) {
      return "leading";
    }
    return "weak-leading";
  }
  if (firstAnomaly <= troughDate) return "concurrent-confirmation";
  return "late";
}

function monthlyCandidateDates(tradingDates) {
  const byMonth = new Map();
  for (const date of tradingDates) {
    const month = date.slice(0, 7);
    if (date.slice(8, 10) >= "15" && !byMonth.has(month)) {
      byMonth.set(month, date);
    }
  }
  return [...byMonth.values()];
}

function signalAt(score, signalId) {
  return score?.signals.find((signal) => signal.id === signalId) || null;
}

function vectorDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return (
    Math.abs(left.vix - right.vix) / 10 +
    Math.abs(left.spy60 - right.spy60) / 10
  );
}

function riskPercentile(scores, signalId, date, tradingDates) {
  const index = tradingDates.indexOf(date);
  if (index < 0) return null;
  const dates = tradingDates.slice(Math.max(0, index - 251), index + 1);
  const values = dates
    .map((itemDate) => signalAt(scores.get(itemDate), signalId))
    .filter((signal) => signal?.available)
    .map((signal) => signal.direction === "lower" ? -signal.value : signal.value);
  const current = signalAt(scores.get(date), signalId);
  if (!current?.available || !values.length) return null;
  const currentRiskValue = current.direction === "lower" ? -current.value : current.value;
  return Number(
    ((values.filter((value) => value <= currentRiskValue).length / values.length) * 100)
      .toFixed(1),
  );
}

function checkpoint(scores, signalId, tradingDates, anchorIndex, offset) {
  const date = tradingDates[anchorIndex + offset];
  const signal = date ? signalAt(scores.get(date), signalId) : null;
  if (!date || !signal) return null;
  return {
    date,
    value: signal.value,
    score: signal.score,
    riskPercentile1y: riskPercentile(scores, signalId, date, tradingDates),
  };
}

function analyzeSignal({
  signalId,
  scores,
  analysisDates,
  tradingDates,
  peakIndex,
  troughIndex,
  controls,
}) {
  const sequence = analysisDates
    .map((date) => ({ date, signal: signalAt(scores.get(date), signalId) }))
    .filter((item) => item.signal?.available);
  const metadata = analysisDates
    .map((date) => signalAt(scores.get(date), signalId))
    .find(Boolean);
  const anomalies = sequence.filter(
    (item) => item.signal.score >= FORENSIC_ANOMALY_SCORE,
  );
  const first = anomalies[0] || null;
  const preAnomalies = anomalies.filter(
    (item) => item.date < tradingDates[peakIndex],
  );
  const firstIndex = first ? tradingDates.indexOf(first.date) : -1;
  const peakSignal = signalAt(scores.get(tradingDates[peakIndex]), signalId);
  const availableControls = controls
    .map((control) => signalAt(scores.get(control.date), signalId))
    .filter((signal) => signal?.available);
  const controlAnomalyRate = availableControls.length
    ? availableControls.filter((signal) => signal.score >= FORENSIC_ANOMALY_SCORE).length /
      availableControls.length
    : null;
  const summary = {
    id: signalId,
    name: metadata?.name || signalId,
    category: metadata?.category || null,
    available: sequence.length > 0,
    firstAnomaly: first?.date || null,
    leadTradingDays: firstIndex >= 0 ? peakIndex - firstIndex : null,
    anomalyDaysBeforePeak: preAnomalies.length,
    recoveredBeforePeak:
      preAnomalies.length > 0 && (!peakSignal || peakSignal.score < FORENSIC_ANOMALY_SCORE),
    controlAnomalyRate:
      controlAnomalyRate === null ? null : Number(controlAnomalyRate.toFixed(4)),
    checkpoints: {
      pre60: checkpoint(scores, signalId, tradingDates, peakIndex, -60),
      pre40: checkpoint(scores, signalId, tradingDates, peakIndex, -40),
      pre20: checkpoint(scores, signalId, tradingDates, peakIndex, -20),
      pre10: checkpoint(scores, signalId, tradingDates, peakIndex, -10),
      pre5: checkpoint(scores, signalId, tradingDates, peakIndex, -5),
      peak: checkpoint(scores, signalId, tradingDates, peakIndex, 0),
      trough: checkpoint(scores, signalId, tradingDates, troughIndex, 0),
    },
  };
  return {
    ...summary,
    classification: classifyForensicSignal({
      ...summary,
      peakDate: tradingDates[peakIndex],
      troughDate: tradingDates[troughIndex],
      controlAnomalyRate: summary.controlAnomalyRate ?? 1,
    }),
  };
}

export function runCrashEventForensics({
  histories,
  events = MARKET_RISK_EVENTS,
}) {
  const fullHistories = applyMacroAvailabilityLag(histories);
  const spy = (histories["YAHOO:SPY"] || [])
    .map((item) => ({ ...item, value: Number(item.value) }))
    .sort((a, b) => a.observationDate.localeCompare(b.observationDate));
  const tradingDates = spy.map((item) => item.observationDate);
  const bounds = events.map((event) => ({ ...event, ...findEventBounds(spy, event) }));
  const scoreCache = new Map();
  const score = (date) => {
    if (!scoreCache.has(date)) {
      scoreCache.set(
        date,
        calculateMarketRiskScore({ histories: fullHistories, asOf: date }),
      );
    }
    return scoreCache.get(date);
  };

  const controlCandidates = monthlyCandidateDates(tradingDates)
    .filter(isControlStudyDate)
    .map((date) => {
      const index = tradingDates.indexOf(date);
      const scoreResult = score(date);
      const vix = signalAt(scoreResult, "vix_level");
      const spy60 = signalAt(scoreResult, "spy_60d_return");
      return {
        date,
        future20Drawdown: futureMaximumDrawdown(spy, index, 20),
        future60Drawdown: futureMaximumDrawdown(spy, index, 60),
        coverage: scoreResult.coverage,
        vector: vix?.available && spy60?.available
          ? { vix: vix.value, spy60: spy60.value }
          : null,
      };
    })
    .filter((candidate) =>
      !isInsideEventExclusion(candidate.date, bounds, 90) &&
      candidate.future20Drawdown !== null &&
      candidate.future60Drawdown !== null &&
      candidate.future20Drawdown > -5 &&
      candidate.future60Drawdown > -8 &&
      candidate.coverage >= 0.7 &&
      candidate.vector);

  const eventReports = bounds.map((event) => {
    const peakIndex = tradingDates.indexOf(event.peakDate);
    const troughIndex = tradingDates.indexOf(event.troughDate);
    const calculationStart = Math.max(0, peakIndex - 312);
    const analysisStart = Math.max(0, peakIndex - 60);
    const analysisEnd = Math.min(tradingDates.length - 1, troughIndex + 20);
    for (const date of tradingDates.slice(calculationStart, analysisEnd + 1)) {
      score(date);
    }
    const eventScore = score(event.peakDate);
    const eventVix = signalAt(eventScore, "vix_level");
    const eventSpy60 = signalAt(eventScore, "spy_60d_return");
    const eventVector = eventVix?.available && eventSpy60?.available
      ? { vix: eventVix.value, spy60: eventSpy60.value }
      : null;
    const matchedControls = controlCandidates
      .map((candidate) => ({
        ...candidate,
        distance: vectorDistance(candidate.vector, eventVector),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
    const signalIds = eventScore.signals.map((signal) => signal.id);
    const analysisDates = tradingDates.slice(analysisStart, analysisEnd + 1);
    return {
      id: event.id,
      name: event.name,
      peakDate: event.peakDate,
      troughDate: event.troughDate,
      drawdownPercent: event.drawdownPercent,
      matchedControls,
      signals: signalIds.map((signalId) =>
        analyzeSignal({
          signalId,
          scores: scoreCache,
          analysisDates,
          tradingDates,
          peakIndex,
          troughIndex,
          controls: matchedControls,
        })),
    };
  });

  const signalIds = [...new Set(eventReports.flatMap((event) =>
    event.signals.map((signal) => signal.id)))];
  const rankings = signalIds.map((signalId) => {
    const signals = eventReports
      .map((event) => event.signals.find((signal) => signal.id === signalId))
      .filter(Boolean);
    const leading = signals.filter((signal) => signal.classification === "leading");
    const weak = signals.filter((signal) => signal.classification === "weak-leading");
    const controlRates = signals
      .map((signal) => signal.controlAnomalyRate)
      .filter((value) => value !== null);
    return {
      id: signalId,
      name: signals[0]?.name || signalId,
      category: signals[0]?.category || null,
      leadingEvents: leading.length,
      weakLeadingEvents: weak.length,
      concurrentEvents: signals.filter(
        (signal) => signal.classification === "concurrent-confirmation",
      ).length,
      insufficientEvents: signals.filter(
        (signal) => signal.classification === "insufficient-data",
      ).length,
      averageLeadTradingDays: leading.length
        ? Number((leading.reduce((sum, signal) => sum + signal.leadTradingDays, 0) /
          leading.length).toFixed(1))
        : null,
      averageControlAnomalyRate: controlRates.length
        ? Number((controlRates.reduce((sum, value) => sum + value, 0) /
          controlRates.length).toFixed(4))
        : null,
    };
  }).sort((a, b) =>
    b.leadingEvents - a.leadingEvents ||
    a.averageControlAnomalyRate - b.averageControlAnomalyRate);

  return {
    generatedAt: new Date().toISOString(),
    method: "fixed-rule-event-forensics-v0.1.0",
    anomalyScore: FORENSIC_ANOMALY_SCORE,
    macroHistoryQuality: "revised-data-with-conservative-release-lag",
    controlCandidateCount: controlCandidates.length,
    events: eventReports,
    rankings,
    dataGaps: CRASH_DATA_GAPS,
  };
}
