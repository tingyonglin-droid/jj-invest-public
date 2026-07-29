import assert from "node:assert/strict";
import test from "node:test";

import {
  MACROMICRO_MARGIN_SERIES_ID,
  MACROMICRO_MARGIN_SOURCE_URL,
  MACROMICRO_SOURCE_ERROR_MESSAGES,
  MacroMicroPayloadError,
  normalizeMacroMicroPayload,
} from "../src/lib/dynamic-beta/macromicro.js";
import { getDynamicBetaSeries } from "../src/lib/dynamic-beta/catalog.js";
import { createMacroMicroIngestionService } from "../src/lib/dynamic-beta/macromicro-service.js";
import { createDynamicBetaRepository } from "../src/lib/dynamic-beta/repository.js";
import { createConfiguredMacroMicroIngestionService } from "../app/api/dynamic-beta/_shared.js";

const context = Object.freeze({
  retrievedAt: "2026-07-29T00:00:00.000Z",
  today: "2026-07-29",
});

test("normalizes a MacroMicro margin observation", () => {
  assert.deepEqual(
    normalizeMacroMicroPayload(
      {
        observationDate: "2026-07-28",
        value: 140.38,
        sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
      },
      context,
    ),
    {
      kind: "observation",
      observation: {
        seriesId: MACROMICRO_MARGIN_SERIES_ID,
        observationDate: "2026-07-28",
        value: 140.38,
        releasedAt: null,
        retrievedAt: "2026-07-29T00:00:00.000Z",
        sourceRealtimeStart: null,
        sourceRealtimeEnd: null,
      },
    },
  );
});

test("rejects a non-canonical or invalid retrieval timestamp context", () => {
  const invalidRetrievedAtValues = [
    undefined,
    "2026-07-29",
    "2026-07-29T00:00:00Z",
    "2026-07-29T08:00:00.000+08:00",
    "not-an-instant",
  ];

  for (const retrievedAt of invalidRetrievedAtValues) {
    assert.throws(
      () => normalizeMacroMicroPayload({
        errorCode: "PAGE_UNAVAILABLE",
        sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
      }, { ...context, retrievedAt }),
      MacroMicroPayloadError,
    );
  }
});

test("rejects a missing or invalid injected calendar date", () => {
  const invalidTodayValues = [
    undefined,
    "2026-02-30",
    "2026-7-29",
    "2026-07-29T00:00:00.000Z",
  ];

  for (const today of invalidTodayValues) {
    assert.throws(
      () => normalizeMacroMicroPayload({
        errorCode: "PAGE_UNAVAILABLE",
        sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
      }, { ...context, today }),
      MacroMicroPayloadError,
    );
  }
});

test("accepts inclusive MacroMicro margin value boundaries", () => {
  for (const value of [100, 500]) {
    const result = normalizeMacroMicroPayload(
      {
        observationDate: "2026-07-29",
        value,
        sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
      },
      context,
    );

    assert.equal(result.observation.value, value);
  }
});

test("normalizes each fixed MacroMicro source failure", () => {
  for (const [errorCode, errorMessage] of Object.entries(
    MACROMICRO_SOURCE_ERROR_MESSAGES,
  )) {
    assert.deepEqual(
      normalizeMacroMicroPayload({
        errorCode,
        sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
      }, context),
      {
        kind: "source-error",
        errorCode,
        errorMessage,
      },
    );
  }
});

test("rejects MacroMicro source failures without the exact failure shape", () => {
  const invalidFailurePayloads = [
    { errorCode: "PAGE_UNAVAILABLE" },
    {
      errorCode: "PAGE_UNAVAILABLE",
      sourceUrl: "https://example.com/not-macromicro",
    },
    {
      errorCode: "PAGE_UNAVAILABLE",
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
      extra: true,
    },
    {
      errorCode: "PAGE_UNAVAILABLE",
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
      observationDate: "2026-07-28",
      value: 140.38,
    },
  ];

  for (const payload of invalidFailurePayloads) {
    assert.throws(
      () => normalizeMacroMicroPayload(payload, context),
      MacroMicroPayloadError,
    );
  }
});

test("rejects invalid MacroMicro payloads with a stable error code", () => {
  const invalidPayloads = [
    {
      observationDate: "2026-07-28",
      value: 140.38,
      sourceUrl: "https://example.com/not-macromicro",
    },
    {
      observationDate: "2026-02-30",
      value: 140.38,
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    },
    {
      observationDate: "2026-07-30",
      value: 140.38,
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    },
    {
      observationDate: "2026-07-28",
      value: 99.99,
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    },
    {
      observationDate: "2026-07-28",
      value: 500.01,
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    },
    {
      observationDate: "2026-07-28",
      value: Number.NaN,
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    },
    {
      errorCode: "PAGE_UNAVAILABLE",
      observationDate: "2026-07-28",
      value: 140.38,
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    },
    {
      errorCode: "NOT_A_SUPPORTED_FAILURE",
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    },
    { errorCode: "toString", sourceUrl: MACROMICRO_MARGIN_SOURCE_URL },
    { errorCode: "__proto__", sourceUrl: MACROMICRO_MARGIN_SOURCE_URL },
  ];

  for (const payload of invalidPayloads) {
    assert.throws(
      () => normalizeMacroMicroPayload(payload, context),
      (error) =>
        error instanceof MacroMicroPayloadError &&
        error.code === "INVALID_MACROMICRO_PAYLOAD",
    );
  }
});

test("rejects a MacroMicro payload with a non-enumerable extra own key", () => {
  const payload = {
    observationDate: "2026-07-28",
    value: 140.38,
    sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
  };
  Object.defineProperty(payload, "hidden", { value: "extra" });

  assert.throws(
    () => normalizeMacroMicroPayload(payload, context),
    MacroMicroPayloadError,
  );
});

test("rejects a MacroMicro payload with a Symbol extra own key", () => {
  const payload = {
    observationDate: "2026-07-28",
    value: 140.38,
    sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    [Symbol("extra")]: "extra",
  };

  assert.throws(
    () => normalizeMacroMicroPayload(payload, context),
    MacroMicroPayloadError,
  );
});

function createRepositorySpy({ saveObservations } = {}) {
  const calls = {
    acquireSyncLock: [],
    releaseSyncLock: [],
    metadata: [],
    observations: [],
    statuses: [],
  };
  return {
    calls,
    repository: {
      async acquireSyncLock(token) {
        calls.acquireSyncLock.push(token);
        return true;
      },
      async releaseSyncLock(token) {
        calls.releaseSyncLock.push(token);
      },
      async upsertSeriesMetadata(series, updatedAt) {
        calls.metadata.push({ series, updatedAt });
      },
      async saveObservations(seriesId, observations) {
        calls.observations.push({ seriesId, observations });
        return saveObservations
          ? saveObservations(seriesId, observations)
          : { inserted: 1, revised: 0, unchanged: 0 };
      },
      async writeSeriesStatus(seriesId, status) {
        calls.statuses.push({ seriesId, status });
      },
    },
  };
}

class StatusMergeRedis {
  constructor() {
    this.hashes = new Map();
    this.sets = new Map();
    this.strings = new Map();
  }

  async hgetall(key) {
    return { ...(this.hashes.get(key) || {}) };
  }

  async hset(key, values) {
    this.hashes.set(key, { ...(this.hashes.get(key) || {}), ...values });
    return 1;
  }

  async sadd(key, value) {
    const values = this.sets.get(key) || new Set();
    const size = values.size;
    values.add(value);
    this.sets.set(key, values);
    return values.size === size ? 0 : 1;
  }

  async set(key, value, options = {}) {
    if (options.nx && this.strings.has(key)) return null;
    this.strings.set(key, value);
    return "OK";
  }

  async get(key) {
    return this.strings.get(key) ?? null;
  }

  async del(key) {
    return this.strings.delete(key) ? 1 : 0;
  }
}

function createService({ repository, logger = { error() {} } } = {}) {
  return createMacroMicroIngestionService({
    repository,
    now: () => new Date("2026-07-29T00:00:00.000Z"),
    logger,
    series: getDynamicBetaSeries(MACROMICRO_MARGIN_SERIES_ID),
  });
}

const successfulPayload = Object.freeze({
  observationDate: "2026-07-28",
  value: 140.38,
  sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
});

test("constructs and ingests through the configured MacroMicro service factory", async () => {
  const { repository } = createRepositorySpy();
  const service = createConfiguredMacroMicroIngestionService(repository);

  const result = await service.ingest(successfulPayload);

  assert.deepEqual(result, {
    seriesId: MACROMICRO_MARGIN_SERIES_ID,
    status: "success",
    inserted: 1,
    revised: 0,
    unchanged: 0,
    latestObservationDate: "2026-07-28",
  });
});

test("ingests a MacroMicro observation while preserving repository revision counts", async () => {
  const { repository, calls } = createRepositorySpy();

  const result = await createService({ repository }).ingest(successfulPayload);

  assert.deepEqual(result, {
    seriesId: MACROMICRO_MARGIN_SERIES_ID,
    status: "success",
    inserted: 1,
    revised: 0,
    unchanged: 0,
    latestObservationDate: "2026-07-28",
  });
  assert.deepEqual(calls.metadata, [
    {
      series: getDynamicBetaSeries(MACROMICRO_MARGIN_SERIES_ID),
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  ]);
  assert.deepEqual(calls.statuses.at(-1), {
    seriesId: MACROMICRO_MARGIN_SERIES_ID,
    status: {
      series_id: MACROMICRO_MARGIN_SERIES_ID,
      status: "success",
      completed_at: "2026-07-29T00:00:00.000Z",
      last_success_at: "2026-07-29T00:00:00.000Z",
      latest_observation_date: "2026-07-28",
      inserted: 1,
      revised: 0,
      unchanged: 0,
      error: null,
      updated_at: "2026-07-29T00:00:00.000Z",
    },
  });
  assert.deepEqual(calls.releaseSyncLock, calls.acquireSyncLock);
});

test("records a MacroMicro source failure without saving an observation", async () => {
  const { repository, calls } = createRepositorySpy();

  const result = await createService({ repository }).ingest({
    errorCode: "LATEST_DATA_MISSING",
    sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
  });

  assert.deepEqual(result, {
    seriesId: MACROMICRO_MARGIN_SERIES_ID,
    status: "error",
    errorCode: "LATEST_DATA_MISSING",
  });
  assert.equal(calls.observations.length, 0);
  assert.deepEqual(calls.statuses.at(-1), {
    seriesId: MACROMICRO_MARGIN_SERIES_ID,
    status: {
      series_id: MACROMICRO_MARGIN_SERIES_ID,
      status: "error",
      completed_at: "2026-07-29T00:00:00.000Z",
      error: MACROMICRO_SOURCE_ERROR_MESSAGES.LATEST_DATA_MISSING,
      updated_at: "2026-07-29T00:00:00.000Z",
    },
  });
  assert.deepEqual(calls.releaseSyncLock, calls.acquireSyncLock);
});

test("repository status patches preserve the last successful observation on source error", async () => {
  const repository = createDynamicBetaRepository(new StatusMergeRedis());
  await repository.writeSeriesStatus(MACROMICRO_MARGIN_SERIES_ID, {
    series_id: MACROMICRO_MARGIN_SERIES_ID,
    status: "success",
    last_success_at: "2026-07-28T00:00:00.000Z",
    latest_observation_date: "2026-07-27",
  });

  await createService({ repository }).ingest({
    errorCode: "LATEST_DATA_MISSING",
    sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
  });

  const status = await repository.readSeriesStatus(MACROMICRO_MARGIN_SERIES_ID);
  assert.equal(status.status, "error");
  assert.equal(status.last_success_at, "2026-07-28T00:00:00.000Z");
  assert.equal(status.latest_observation_date, "2026-07-27");
  assert.equal(
    status.error,
    MACROMICRO_SOURCE_ERROR_MESSAGES.LATEST_DATA_MISSING,
  );
});

test("rejects MacroMicro ingestion when the Dynamic Beta sync lock is held", async () => {
  const { repository, calls } = createRepositorySpy();
  repository.acquireSyncLock = async () => false;

  await assert.rejects(
    createService({ repository }).ingest(successfulPayload),
    /Dynamic Beta 資料同步已在執行中。/,
  );
  assert.equal(calls.statuses.length, 0);
  assert.equal(calls.releaseSyncLock.length, 0);
});

test("releases the lock and logs no raw secret when MacroMicro repository writes fail", async () => {
  const rawSecret = "super-secret-token";
  const { repository, calls } = createRepositorySpy({
    saveObservations() {
      throw new Error(rawSecret);
    },
  });
  const errors = [];
  const logger = {
    error(event, details) {
      errors.push({ event, details });
    },
  };

  await assert.rejects(createService({ repository, logger }).ingest(successfulPayload));

  assert.deepEqual(calls.releaseSyncLock, calls.acquireSyncLock);
  assert.equal(calls.statuses.at(-1).status.status, "error");
  assert.deepEqual(errors, [
    {
      event: "dynamic_beta_macromicro_ingest_failed",
      details: { seriesId: MACROMICRO_MARGIN_SERIES_ID },
    },
  ]);
  assert.equal(JSON.stringify(errors).includes(rawSecret), false);
});
