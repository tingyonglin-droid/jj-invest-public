import { getDynamicBetaSeries } from "../catalog.js";
import { evaluateDynamicBetaFreshness } from "../freshness.js";
import { evaluateEventConfirmation } from "./confirmation.js";

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function subtractDays(value, count) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createNewsMarketConfirmationService({
  newsRepository,
  marketRepository,
  now = () => new Date(),
}) {
  return {
    async evaluate({ briefDate = null, revisionId = null, asOf = null } = {}) {
      if (!newsRepository || !marketRepository) {
        throw serviceError("UNCONFIGURED_REPOSITORY", "Confirmation repository 尚未設定。");
      }
      const current = now();
      const currentDate = current instanceof Date ? current : new Date(current);
      if (Number.isNaN(currentDate.getTime())) {
        throw serviceError("INVALID_DATE", "Confirmation service 的 now 無效。");
      }
      const selectedAsOf = asOf || currentDate.toISOString().slice(0, 10);
      if (!validDateKey(selectedAsOf)) {
        throw serviceError("INVALID_DATE", "asOf 必須使用有效的 YYYY-MM-DD。");
      }
      if (briefDate && !validDateKey(briefDate)) {
        throw serviceError("INVALID_DATE", "briefDate 必須使用有效的 YYYY-MM-DD。");
      }
      if (revisionId && !briefDate) {
        throw serviceError("INVALID_QUERY", "revisionId 必須搭配 briefDate。");
      }
      const brief = briefDate
        ? await newsRepository.readMorningBrief({ briefDate, revisionId })
        : (await newsRepository.readRecentBriefs({ limit: 1 }))[0] || null;
      if (!brief) throw serviceError("MISSING_BRIEF", "找不到指定的 morning brief。");

      const earliestMarketDate = new Map();
      for (const event of brief.events || []) {
        const marketDate = event.marketDate || brief.briefDate;
        for (const rule of event.confirmationRules || []) {
          const previous = earliestMarketDate.get(rule.seriesId);
          if (!previous || marketDate < previous) {
            earliestMarketDate.set(rule.seriesId, marketDate);
          }
        }
      }

      const histories = {};
      const freshnessBySeries = {};
      await Promise.all([...earliestMarketDate].map(async ([seriesId, marketDate]) => {
        let history = await marketRepository.readObservationHistory(seriesId, {
          from: subtractDays(marketDate, 10),
          to: selectedAsOf,
        });
        if (!history.some((row) => row.observationDate < marketDate)) {
          history = await marketRepository.readObservationHistory(seriesId, {
            from: subtractDays(marketDate, 45),
            to: selectedAsOf,
          });
        }
        histories[seriesId] = history;
        const latest = history
          .filter((row) => row.observationDate <= selectedAsOf)
          .at(-1);
        freshnessBySeries[seriesId] = evaluateDynamicBetaFreshness({
          series: getDynamicBetaSeries(seriesId),
          observationDate: latest?.observationDate || null,
          updateStatus: latest ? "success" : "never",
          asOf: new Date(`${selectedAsOf}T12:00:00.000Z`),
        }).status;
      }));

      return {
        briefDate: brief.briefDate,
        revisionId: brief.revisionId,
        revisionNumber: brief.revisionNumber,
        asOf: selectedAsOf,
        evaluatedAt: currentDate.toISOString(),
        metadata: {
          vintageMode: "latest_stored_revision_by_observation_date",
          truePointInTime: false,
        },
        events: (brief.events || []).map((event) => evaluateEventConfirmation({
          event,
          briefDate: brief.briefDate,
          histories,
          freshnessBySeries,
          asOf: selectedAsOf,
        })),
      };
    },
  };
}
