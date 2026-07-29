import { randomUUID } from "node:crypto";

import { DYNAMIC_BETA_SERIES } from "./catalog.js";
import { fetchEquityObservations } from "./equity-client.js";
import { normalizeFredObservation } from "./normalize.js";

const EQUITY_HISTORY_START = "1990-01-01";

function subtractUtcDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function safeMessage(error) {
  return String(error instanceof Error ? error.message : "未知同步錯誤").slice(0, 500);
}

export function createDynamicBetaSyncService({
  repository,
  fredClient,
  equityFetcher = fetchEquityObservations,
  seriesCatalog = DYNAMIC_BETA_SERIES,
  now = () => new Date(),
  logger = console,
}) {
  return {
    async sync({ seriesIds } = {}) {
      const requested = seriesIds?.length ? [...new Set(seriesIds)] : null;
      const automaticSeries = seriesCatalog.filter(
        (series) => series.syncMode !== "external",
      );
      const allowedIds = new Set(automaticSeries.map((series) => series.seriesId));
      const unknown = (requested || []).find((seriesId) => !allowedIds.has(seriesId));
      if (unknown) {
        throw new Error(`不支援的 Dynamic Beta series：${unknown}`);
      }

      const selectedSeries = automaticSeries.filter(
        (series) =>
          series.enabled && (!requested || requested.includes(series.seriesId)),
      );
      const lockToken = randomUUID();
      if (!(await repository.acquireSyncLock(lockToken))) {
        throw new Error("Dynamic Beta 資料同步已在執行中。");
      }

      const results = [];
      try {
        for (const series of selectedSeries) {
          const startedAt = now().toISOString();
          await repository.writeSeriesStatus(series.seriesId, {
            series_id: series.seriesId,
            status: "running",
            started_at: startedAt,
            updated_at: startedAt,
          });
          logger.info("dynamic_beta_sync_started", { seriesId: series.seriesId });

          try {
            const retrievedAt = now().toISOString();
            let metadata = series;
            let observations = [];
            let missing = 0;

            if (series.source === "FRED") {
              if (!fredClient) {
                throw new Error("缺少 FRED client。");
              }
              const [fredMetadata, rawObservations] = await Promise.all([
                fredClient.fetchSeriesMetadata(series.seriesId),
                fredClient.fetchObservations(series.seriesId),
              ]);
              metadata = { ...series, ...fredMetadata };
              observations = rawObservations
                .map((observation) =>
                  normalizeFredObservation(
                    series.seriesId,
                    observation,
                    retrievedAt,
                  ),
                )
                .filter(Boolean);
              missing = rawObservations.length - observations.length;
            } else {
              const previousStatus = await repository.readSeriesStatus(
                series.seriesId,
              );
              const from = previousStatus?.latest_observation_date
                ? subtractUtcDays(previousStatus.latest_observation_date, 7)
                : EQUITY_HISTORY_START;
              observations = await equityFetcher(series, {
                from,
                to: retrievedAt.slice(0, 10),
                retrievedAt,
              });
            }

            await repository.upsertSeriesMetadata(metadata, retrievedAt);
            const counts = await repository.saveObservations(
              series.seriesId,
              observations,
            );
            const completedAt = now().toISOString();
            const latestObservationDate =
              observations.at(-1)?.observationDate || null;
            const result = {
              seriesId: series.seriesId,
              status: "success",
              ...counts,
              missing,
              latestObservationDate,
            };
            await repository.writeSeriesStatus(series.seriesId, {
              series_id: series.seriesId,
              status: "success",
              started_at: startedAt,
              completed_at: completedAt,
              last_success_at: completedAt,
              latest_observation_date: latestObservationDate,
              inserted: counts.inserted,
              revised: counts.revised,
              unchanged: counts.unchanged,
              missing,
              error: null,
              updated_at: completedAt,
            });
            results.push(result);
            logger.info("dynamic_beta_sync_completed", result);
          } catch (error) {
            const completedAt = now().toISOString();
            const message = safeMessage(error);
            const result = {
              seriesId: series.seriesId,
              status: "error",
              error: message,
            };
            await repository.writeSeriesStatus(series.seriesId, {
              series_id: series.seriesId,
              status: "error",
              started_at: startedAt,
              completed_at: completedAt,
              error: message,
              updated_at: completedAt,
            });
            results.push(result);
            logger.error("dynamic_beta_sync_failed", result);
          }
        }
      } finally {
        await repository.releaseSyncLock(lockToken);
      }

      const failures = results.filter((result) => result.status === "error").length;
      return {
        status: failures === 0 ? "success" : failures === results.length ? "error" : "partial",
        results,
      };
    },
  };
}
