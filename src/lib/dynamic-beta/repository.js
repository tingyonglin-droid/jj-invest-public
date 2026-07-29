import { createHash } from "node:crypto";
import { evaluateDynamicBetaFreshness } from "./freshness.js";

export const DYNAMIC_BETA_KEY_PREFIX = "jj-invest-public:dynamic-beta:data:v1";
const WRITE_BATCH_SIZE = 250;

function keys(seriesId, observationDate, revisionId) {
  return {
    current: `${DYNAMIC_BETA_KEY_PREFIX}:current:${seriesId}`,
    currentValues: `${DYNAMIC_BETA_KEY_PREFIX}:current-values:${seriesId}`,
    dates: `${DYNAMIC_BETA_KEY_PREFIX}:dates:${seriesId}`,
    revision: `${DYNAMIC_BETA_KEY_PREFIX}:revision:${seriesId}:${observationDate}:${revisionId}`,
    revisions: `${DYNAMIC_BETA_KEY_PREFIX}:revisions:${seriesId}:${observationDate}`,
    metadata: `${DYNAMIC_BETA_KEY_PREFIX}:series:${seriesId}`,
    series: `${DYNAMIC_BETA_KEY_PREFIX}:series`,
    status: `${DYNAMIC_BETA_KEY_PREFIX}:status:${seriesId}`,
    syncLock: `${DYNAMIC_BETA_KEY_PREFIX}:sync-lock`,
  };
}

function hashRevisionParts(parts) {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 24);
}

function createLegacyRevisionId(observation) {
  return hashRevisionParts([
    observation.seriesId,
    observation.observationDate,
    observation.value,
  ]);
}

function createRevisionId(observation) {
  return hashRevisionParts([
    observation.seriesId,
    observation.observationDate,
    observation.value,
    observation.retrievedAt,
  ]);
}

function revisionRecord(observation, revisionId) {
  return {
    revision_id: revisionId,
    series_id: observation.seriesId,
    observation_date: observation.observationDate,
    value: observation.value,
    released_at: observation.releasedAt,
    retrieved_at: observation.retrievedAt,
    first_seen_at: observation.retrievedAt,
    last_seen_at: observation.retrievedAt,
    source_realtime_start: observation.sourceRealtimeStart,
    source_realtime_end: observation.sourceRealtimeEnd,
  };
}

export function createDynamicBetaRepository(redis) {
  if (!redis) {
    throw new Error("Dynamic Beta repository 需要 Redis。");
  }

  return {
    async acquireSyncLock(token) {
      const result = await redis.set(keys().syncLock, token, { nx: true, ex: 15 * 60 });
      return result === "OK";
    },

    async releaseSyncLock(token) {
      const lockKey = keys().syncLock;
      if ((await redis.get(lockKey)) === token) {
        await redis.del(lockKey);
      }
    },

    async saveObservations(seriesId, observations) {
      const currentKey = keys(seriesId).current;
      const currentValuesKey = keys(seriesId).currentValues;
      const [storedPointers, storedValues] = await Promise.all([
        redis.hgetall(currentKey),
        redis.hgetall(currentValuesKey),
      ]);
      const currentPointers = storedPointers || {};
      const currentValues = storedValues || {};
      const operations = [];
      const counts = { inserted: 0, revised: 0, unchanged: 0 };
      const latestInputDate = observations.at(-1)?.observationDate || null;

      for (const observation of observations) {
        const revisionId = createRevisionId(observation);
        const legacyRevisionId = createLegacyRevisionId(observation);
        const existingRevisionId = currentPointers[observation.observationDate];
        const existingValue = currentValues[observation.observationDate];
        const observationKeys = keys(
          seriesId,
          observation.observationDate,
          revisionId,
        );

        if (
          (existingValue !== null &&
            existingValue !== undefined &&
            Number(existingValue) === observation.value) ||
          ((existingValue === null || existingValue === undefined) &&
            existingRevisionId === legacyRevisionId)
        ) {
          if (existingValue === null || existingValue === undefined) {
            operations.push({
              type: "migrate-current-value",
              currentValuesKey,
              observation,
            });
          } else if (
            existingRevisionId &&
            observation.observationDate === latestInputDate
          ) {
            operations.push({
              type: "last-seen",
              revisionKey: keys(
                seriesId,
                observation.observationDate,
                existingRevisionId,
              ).revision,
              retrievedAt: observation.retrievedAt,
            });
          }
          counts.unchanged += 1;
          continue;
        }

        operations.push({
          type: "revision",
          currentKey,
          currentValuesKey,
          dateKey: observationKeys.dates,
          revisionKey: observationKeys.revision,
          revisionsKey: observationKeys.revisions,
          observation,
          revisionId,
        });
        if (existingRevisionId) {
          counts.revised += 1;
        } else {
          counts.inserted += 1;
        }
        currentPointers[observation.observationDate] = revisionId;
        currentValues[observation.observationDate] = observation.value;
      }

      for (let offset = 0; offset < operations.length; offset += WRITE_BATCH_SIZE) {
        const pipeline = redis.pipeline();
        for (const operation of operations.slice(offset, offset + WRITE_BATCH_SIZE)) {
          if (operation.type === "migrate-current-value") {
            pipeline.hset(operation.currentValuesKey, {
              [operation.observation.observationDate]: operation.observation.value,
            });
            continue;
          }
          if (operation.type === "last-seen") {
            pipeline.hset(operation.revisionKey, {
              last_seen_at: operation.retrievedAt,
            });
            continue;
          }

          const score = Date.parse(`${operation.observation.observationDate}T00:00:00Z`);
          const retrievedScore = Date.parse(operation.observation.retrievedAt);
          pipeline
            .hset(
              operation.revisionKey,
              revisionRecord(operation.observation, operation.revisionId),
            )
            .zadd(operation.dateKey, {
              score,
              member: operation.observation.observationDate,
            })
            .zadd(operation.revisionsKey, {
              score: retrievedScore,
              member: operation.revisionId,
            })
            .hset(operation.currentKey, {
              [operation.observation.observationDate]: operation.revisionId,
            })
            .hset(operation.currentValuesKey, {
              [operation.observation.observationDate]: operation.observation.value,
            });
        }
        await pipeline.exec();
      }

      return counts;
    },

    async upsertSeriesMetadata(series, updatedAt) {
      const seriesKeys = keys(series.seriesId);
      const existing = (await redis.hgetall(seriesKeys.metadata)) || {};
      await Promise.all([
        redis.hset(seriesKeys.metadata, {
          series_id: series.seriesId,
          name: series.name,
          category: series.category,
          source: series.source,
          frequency: series.frequency,
          unit: series.unit,
          enabled: Boolean(series.enabled),
          created_at: existing.created_at || updatedAt,
          updated_at: updatedAt,
        }),
        redis.sadd(seriesKeys.series, series.seriesId),
      ]);
    },

    async writeSeriesStatus(seriesId, status) {
      await redis.hset(keys(seriesId).status, status);
    },

    async readSeriesStatus(seriesId) {
      return redis.hgetall(keys(seriesId).status);
    },

    async readDashboard(seriesCatalog, { asOf = new Date() } = {}) {
      return Promise.all(
        seriesCatalog.map(async (series) => {
          const seriesKeys = keys(series.seriesId);
          const [metadata, status] = await Promise.all([
            redis.hgetall(seriesKeys.metadata),
            redis.hgetall(seriesKeys.status),
          ]);
          const observationDate = status?.latest_observation_date || null;
          const observation = observationDate
            ? await this.readObservation(series.seriesId, observationDate)
            : null;
          const freshness = evaluateDynamicBetaFreshness({
            series: {
              ...series,
              frequency: metadata?.frequency || series.frequency || null,
            },
            observationDate,
            updateStatus: status?.status || "never",
            asOf,
          });

          return {
            seriesId: series.seriesId,
            name: metadata?.name || series.name || series.seriesId,
            category: metadata?.category || series.category || null,
            source: metadata?.source || series.source || null,
            frequency: metadata?.frequency || series.frequency || null,
            unit: metadata?.unit || series.unit || null,
            enabled: metadata?.enabled ?? Boolean(series.enabled),
            latestValue:
              observation?.value === null || observation?.value === undefined
                ? null
                : Number(observation.value),
            observationDate,
            retrievedAt: observation?.retrieved_at || null,
            releasedAt: observation?.released_at || null,
            sourceRealtimeStart: observation?.source_realtime_start || null,
            sourceRealtimeEnd: observation?.source_realtime_end || null,
            firstSeenAt:
              observation?.first_seen_at || observation?.retrieved_at || null,
            lastSeenAt:
              observation?.last_seen_at || observation?.retrieved_at || null,
            freshnessStatus: freshness.status,
            freshnessAge: freshness.age,
            freshnessFreshThreshold: freshness.freshThreshold,
            freshnessStaleThreshold: freshness.staleThreshold,
            freshnessReason: freshness.reason,
            updateStatus: status?.status || "never",
            lastSuccessAt: status?.last_success_at || null,
            error: status?.error || null,
          };
        }),
      );
    },

    async readObservation(seriesId, observationDate) {
      const currentKey = keys(seriesId).current;
      const revisionId = await redis.hget(currentKey, observationDate);
      if (!revisionId) {
        return null;
      }
      return redis.hgetall(keys(seriesId, observationDate, revisionId).revision);
    },

    async readObservationHistory(
      seriesId,
      { from = "1900-01-01", to = "9999-12-31" } = {},
    ) {
      const fromScore = Date.parse(`${from}T00:00:00.000Z`);
      const toScore = Date.parse(`${to}T00:00:00.000Z`);
      const dates = await redis.zrange(
        keys(seriesId).dates,
        fromScore,
        toScore,
        { byScore: true },
      );
      const observations = await Promise.all(
        dates.map((date) => this.readObservation(seriesId, date)),
      );
      return observations.filter(Boolean).map((observation) => ({
        observationDate: observation.observation_date,
        value: Number(observation.value),
        releasedAt: observation.released_at || null,
        retrievedAt: observation.retrieved_at || null,
      }));
    },
  };
}
