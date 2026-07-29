import { randomUUID } from "node:crypto";

import { normalizeMacroMicroPayload } from "./macromicro.js";

function formatTaipeiDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function createMacroMicroIngestionService({
  repository,
  now = () => new Date(),
  logger = console,
  series,
}) {
  return {
    async ingest(payload) {
      const currentTime = now();
      const retrievedAt = currentTime.toISOString();
      const normalized = normalizeMacroMicroPayload(payload, {
        retrievedAt,
        today: formatTaipeiDate(currentTime),
      });
      const lockToken = randomUUID();
      if (!(await repository.acquireSyncLock(lockToken))) {
        throw new Error("Dynamic Beta 資料同步已在執行中。");
      }

      try {
        await repository.writeSeriesStatus(series.seriesId, {
          series_id: series.seriesId,
          status: "running",
          started_at: retrievedAt,
          updated_at: retrievedAt,
        });
        await repository.upsertSeriesMetadata(series, retrievedAt);
        if (normalized.kind === "source-error") {
          await repository.writeSeriesStatus(series.seriesId, {
            series_id: series.seriesId,
            status: "error",
            completed_at: retrievedAt,
            error: normalized.errorMessage,
            updated_at: retrievedAt,
          });
          return {
            seriesId: series.seriesId,
            status: "error",
            errorCode: normalized.errorCode,
          };
        }

        const counts = await repository.saveObservations(series.seriesId, [
          normalized.observation,
        ]);
        await repository.writeSeriesStatus(series.seriesId, {
          series_id: series.seriesId,
          status: "success",
          completed_at: retrievedAt,
          last_success_at: retrievedAt,
          latest_observation_date: normalized.observation.observationDate,
          ...counts,
          error: null,
          updated_at: retrievedAt,
        });
        return {
          seriesId: series.seriesId,
          status: "success",
          ...counts,
          latestObservationDate: normalized.observation.observationDate,
        };
      } catch (error) {
        try {
          await repository.writeSeriesStatus(series.seriesId, {
            series_id: series.seriesId,
            status: "error",
            completed_at: retrievedAt,
            error: "M 平方資料寫入失敗。",
            updated_at: retrievedAt,
          });
        } catch {}
        logger.error("dynamic_beta_macromicro_ingest_failed", {
          seriesId: series.seriesId,
        });
        throw error;
      } finally {
        await repository.releaseSyncLock(lockToken);
      }
    },
  };
}
