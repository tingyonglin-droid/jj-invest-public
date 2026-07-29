import { DYNAMIC_BETA_SERIES, getDynamicBetaSeries } from "./catalog.js";
import { evaluateDynamicBetaFreshness } from "./freshness.js";
import { calculateMarketRiskScore } from "./market-risk-score.js";

const MODEL_SERIES = Object.freeze([
  "VIXCLS",
  "YAHOO:SPY",
  "YAHOO:QQQ",
  "YAHOO:SOXX",
  "BAMLH0A0HYM2",
  "DGS2",
  "DGS10",
  "UNRATE",
  "PAYEMS",
  "CPILFESL",
  "PCEPILFE",
]);

const FALLBACKS = Object.freeze({
  VIXCLS: "YAHOO:^VIX",
  DGS2: "YAHOO:2YY=F",
  DGS10: "YAHOO:^TNX",
});

function subtractDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function isUsable(seriesId, history, asOf) {
  const series = getDynamicBetaSeries(seriesId);
  const observationDate = history.at(-1)?.observationDate || null;
  const freshness = evaluateDynamicBetaFreshness({
    series,
    observationDate,
    updateStatus: observationDate ? "success" : "never",
    asOf: new Date(`${asOf}T12:00:00.000Z`),
  });
  return {
    usable: freshness.status === "fresh" || freshness.status === "delayed",
    freshness,
  };
}

export async function createMarketRiskScorePreview({ repository, asOf }) {
  const date = String(asOf || new Date().toISOString().slice(0, 10));
  const requestedIds = [...new Set([...MODEL_SERIES, ...Object.values(FALLBACKS)])];
  const rawHistories = Object.fromEntries(
    await Promise.all(
      requestedIds.map(async (seriesId) => [
        seriesId,
        await repository.readObservationHistory(seriesId, {
          from: subtractDays(date, 500),
          to: date,
        }),
      ]),
    ),
  );
  const histories = {};
  const dataSources = {};

  for (const seriesId of MODEL_SERIES) {
    const primary = rawHistories[seriesId] || [];
    const primaryState = isUsable(seriesId, primary, date);
    const fallbackId = FALLBACKS[seriesId];
    const fallback = fallbackId ? rawHistories[fallbackId] || [] : [];
    const fallbackState = fallbackId
      ? isUsable(fallbackId, fallback, date)
      : null;
    const actualId = primaryState.usable
      ? seriesId
      : fallbackState?.usable
        ? fallbackId
        : null;
    histories[seriesId] = actualId ? rawHistories[actualId] : [];
    dataSources[seriesId] = {
      requestedSeriesId: seriesId,
      actualSeriesId: actualId,
      usedFallback: Boolean(actualId && actualId !== seriesId),
      freshness: actualId === seriesId
        ? primaryState.freshness
        : fallbackState?.freshness || primaryState.freshness,
    };
  }

  const result = calculateMarketRiskScore({ histories, asOf: date });
  return {
    ...result,
    catalogSize: DYNAMIC_BETA_SERIES.length,
    dataSources,
    signals: result.signals.map((signal) => ({
      ...signal,
      actualSeriesIds: signal.seriesIds.map(
        (seriesId) => dataSources[seriesId]?.actualSeriesId || null,
      ),
    })),
  };
}
