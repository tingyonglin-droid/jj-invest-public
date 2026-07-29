import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DYNAMIC_BETA_SERIES,
  getDynamicBetaSeries,
} from "../src/lib/dynamic-beta/catalog.js";
import {
  getDynamicBetaFlags,
  isStrictTrue,
} from "../src/lib/dynamic-beta/config.js";
import {
  normalizeFredObservation,
  normalizeMarketObservation,
} from "../src/lib/dynamic-beta/normalize.js";
import { createFredClient } from "../src/lib/dynamic-beta/fred-client.js";
import { fetchEquityObservations } from "../src/lib/dynamic-beta/equity-client.js";
import { createDynamicBetaRepository } from "../src/lib/dynamic-beta/repository.js";
import { createDynamicBetaSyncService } from "../src/lib/dynamic-beta/sync.js";
import { evaluateDynamicBetaFreshness } from "../src/lib/dynamic-beta/freshness.js";
import {
  formatDynamicBetaValue,
  getDynamicBetaFreshnessLabel,
  getDynamicBetaStatusLabel,
} from "../src/lib/dynamic-beta/admin-view.js";

class FakeRedis {
  constructor() {
    this.hashes = new Map();
    this.sortedSets = new Map();
    this.strings = new Map();
    this.hsetCalls = 0;
  }

  async hgetall(key) {
    return { ...(this.hashes.get(key) || {}) };
  }

  async hget(key, field) {
    return this.hashes.get(key)?.[field] ?? null;
  }

  async hset(key, values) {
    this.hsetCalls += 1;
    this.hashes.set(key, { ...(this.hashes.get(key) || {}), ...values });
    return 1;
  }

  async sadd(key, value) {
    const values = this.sortedSets.get(key) || new Map();
    const existed = values.has(value);
    values.set(value, 1);
    this.sortedSets.set(key, values);
    return existed ? 0 : 1;
  }

  async zadd(key, entry) {
    const values = this.sortedSets.get(key) || new Map();
    values.set(entry.member, entry.score);
    this.sortedSets.set(key, values);
    return 1;
  }

  async zrange(key, min, max, options = {}) {
    const values = [...(this.sortedSets.get(key) || new Map()).entries()]
      .filter(([, score]) => !options.byScore || (score >= min && score <= max))
      .sort((a, b) => a[1] - b[1]);
    return values.map(([member]) => member);
  }

  async set(key, value, options = {}) {
    if (options.nx && this.strings.has(key)) {
      return null;
    }
    this.strings.set(key, value);
    return "OK";
  }

  async get(key) {
    return this.strings.get(key) ?? null;
  }

  async del(key) {
    return this.strings.delete(key) ? 1 : 0;
  }

  pipeline() {
    const redis = this;
    const actions = [];
    return {
      hset(...args) {
        actions.push(() => redis.hset(...args));
        return this;
      },
      zadd(...args) {
        actions.push(() => redis.zadd(...args));
        return this;
      },
      async exec() {
        return Promise.all(actions.map((action) => action()));
      },
    };
  }
}

describe("dynamic beta catalog", () => {
  it("contains every requested FRED and equity series exactly once", () => {
    assert.equal(DYNAMIC_BETA_SERIES.length, 21);
    assert.equal(new Set(DYNAMIC_BETA_SERIES.map((series) => series.seriesId)).size, 21);
    assert.deepEqual(
      DYNAMIC_BETA_SERIES.filter((series) => series.source === "FRED").map(
        (series) => series.seriesId,
      ),
      [
        "VIXCLS",
        "DGS2",
        "DGS10",
        "BAMLH0A0HYM2",
        "DCOILBRENTEU",
        "DCOILWTICO",
        "UNRATE",
        "PAYEMS",
        "CPILFESL",
        "PCEPILFE",
      ],
    );
    assert.deepEqual(
      DYNAMIC_BETA_SERIES.filter((series) => series.source === "Yahoo Finance").map(
        (series) => series.symbol,
      ),
      [
        "SPY",
        "QQQ",
        "SOXX",
        "0050.TW",
        "00631L.TW",
        "^VIX",
        "CL=F",
        "BZ=F",
        "^TNX",
        "2YY=F",
      ],
    );
    assert.equal(getDynamicBetaSeries("YAHOO:0050.TW")?.symbol, "0050.TW");
    assert.equal(getDynamicBetaSeries("YAHOO:^VIX")?.unit, "Index");
    assert.equal(getDynamicBetaSeries("YAHOO:CL=F")?.unit, "Dollars per Barrel");
    assert.equal(getDynamicBetaSeries("YAHOO:^TNX")?.unit, "Percent");
    assert.equal(getDynamicBetaSeries("YAHOO:2YY=F")?.unit, "Percent");
    const macroMicro = getDynamicBetaSeries(
      "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
    );
    assert.deepEqual(macroMicro, {
      seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
      name: "Taiwan TAIEX Margin Maintenance Ratio",
      category: "market_stress",
      source: "MacroMicro",
      frequency: "Daily",
      unit: "Percent",
      enabled: true,
      syncMode: "external",
      freshnessPolicy: { kind: "weekdays", fresh: 1, delayed: 2 },
    });
  });
});

describe("dynamic beta flags", () => {
  it("enables a flag only for the exact string true", () => {
    assert.equal(isStrictTrue("true"), true);
    assert.equal(isStrictTrue("TRUE"), false);
    assert.equal(isStrictTrue("1"), false);
    assert.equal(isStrictTrue(true), false);
  });

  it("keeps every flag disabled when environment variables are absent", () => {
    assert.deepEqual(getDynamicBetaFlags({}), {
      dataEnabled: false,
      scoringEnabled: false,
      publicEnabled: false,
    });
  });
});

describe("dynamic beta observation normalization", () => {
  it("normalizes a valid FRED observation without inventing released_at", () => {
    assert.deepEqual(
      normalizeFredObservation(
        "DGS10",
        {
          date: "2026-07-24",
          value: "4.39",
          realtime_start: "2026-07-25",
          realtime_end: "2026-07-25",
        },
        "2026-07-27T01:02:03.000Z",
      ),
      {
        seriesId: "DGS10",
        observationDate: "2026-07-24",
        value: 4.39,
        releasedAt: null,
        retrievedAt: "2026-07-27T01:02:03.000Z",
        sourceRealtimeStart: "2026-07-25",
        sourceRealtimeEnd: "2026-07-25",
      },
    );
  });

  it("drops FRED missing values and malformed observations", () => {
    assert.equal(
      normalizeFredObservation(
        "DGS10",
        { date: "2026-07-24", value: "." },
        "2026-07-27T01:02:03.000Z",
      ),
      null,
    );
    assert.equal(
      normalizeFredObservation(
        "DGS10",
        { date: "not-a-date", value: "4.39" },
        "2026-07-27T01:02:03.000Z",
      ),
      null,
    );
  });

  it("normalizes a real equity trading-day close", () => {
    assert.deepEqual(
      normalizeMarketObservation(
        "YAHOO:SPY",
        { date: "2026-07-24", price: 650.25 },
        "2026-07-27T01:02:03.000Z",
      ),
      {
        seriesId: "YAHOO:SPY",
        observationDate: "2026-07-24",
        value: 650.25,
        releasedAt: null,
        retrievedAt: "2026-07-27T01:02:03.000Z",
        sourceRealtimeStart: null,
        sourceRealtimeEnd: null,
      },
    );
  });
});

describe("dynamic beta freshness", () => {
  it("does not count weekends as stale market days", () => {
    assert.deepEqual(
      evaluateDynamicBetaFreshness({
        series: { freshnessPolicy: { kind: "weekdays", fresh: 1, delayed: 2 } },
        observationDate: "2026-07-24",
        updateStatus: "success",
        asOf: new Date("2026-07-27T12:00:00.000Z"),
      }),
      {
        status: "fresh",
        age: 1,
        freshThreshold: 1,
        staleThreshold: 2,
        reason: "落後 1 個工作日，仍在正常更新窗口內。",
      },
    );
  });

  it("distinguishes delayed and stale daily data", () => {
    const series = {
      freshnessPolicy: { kind: "weekdays", fresh: 2, delayed: 4 },
    };
    assert.equal(
      evaluateDynamicBetaFreshness({
        series,
        observationDate: "2026-07-20",
        updateStatus: "success",
        asOf: new Date("2026-07-24T12:00:00.000Z"),
      }).status,
      "delayed",
    );
    assert.equal(
      evaluateDynamicBetaFreshness({
        series,
        observationDate: "2026-07-17",
        updateStatus: "success",
        asOf: new Date("2026-07-27T12:00:00.000Z"),
      }).status,
      "stale",
    );
  });

  it("uses series-specific calendar windows for monthly releases", () => {
    const policy = { kind: "month_end_days", fresh: 35, delayed: 45 };
    assert.equal(
      evaluateDynamicBetaFreshness({
        series: { freshnessPolicy: policy },
        observationDate: "2026-05-01",
        updateStatus: "success",
        asOf: new Date("2026-08-04T12:00:00.000Z"),
      }).status,
      "fresh",
    );
    assert.equal(
      evaluateDynamicBetaFreshness({
        series: { freshnessPolicy: policy },
        observationDate: "2026-05-01",
        updateStatus: "success",
        asOf: new Date("2026-08-10T12:00:00.000Z"),
      }).status,
      "delayed",
    );
    assert.equal(
      evaluateDynamicBetaFreshness({
        series: { freshnessPolicy: policy },
        observationDate: "2026-05-01",
        updateStatus: "success",
        asOf: new Date("2026-08-20T12:00:00.000Z"),
      }).status,
      "stale",
    );
    assert.equal(
      evaluateDynamicBetaFreshness({
        series: {
          freshnessPolicy: { kind: "month_end_days", fresh: 12, delayed: 20 },
        },
        observationDate: "2026-06-01",
        updateStatus: "success",
        asOf: new Date("2026-07-27T12:00:00.000Z"),
      }).status,
      "fresh",
    );
  });

  it("reports missing and failed synchronization explicitly", () => {
    assert.equal(
      evaluateDynamicBetaFreshness({
        series: {}, observationDate: null, updateStatus: "never",
      }).status,
      "never",
    );
    assert.equal(
      evaluateDynamicBetaFreshness({
        series: {}, observationDate: "2026-07-24", updateStatus: "error",
      }).status,
      "error",
    );
  });
});

describe("dynamic beta source clients", () => {
  it("fetches FRED metadata and observations as JSON", async () => {
    const requestedUrls = [];
    const fetchImpl = async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes("/fred/series?")) {
        return new Response(
          JSON.stringify({
            seriess: [{ id: "DGS10", frequency: "Daily", units: "Percent" }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          observations: [
            {
              date: "2026-07-24",
              value: "4.39",
              realtime_start: "2026-07-25",
              realtime_end: "2026-07-25",
            },
          ],
        }),
        { status: 200 },
      );
    };
    const client = createFredClient({ apiKey: "server-secret", fetchImpl });

    assert.deepEqual(await client.fetchSeriesMetadata("DGS10"), {
      frequency: "Daily",
      unit: "Percent",
    });
    assert.equal((await client.fetchObservations("DGS10")).length, 1);
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls.every((url) => url.includes("api_key=server-secret")));
    assert.ok(requestedUrls.every((url) => url.includes("file_type=json")));
  });

  it("does not expose the FRED key in upstream errors", async () => {
    const client = createFredClient({
      apiKey: "server-secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error_message: "Bad request: server-secret" }), {
          status: 400,
        }),
    });

    await assert.rejects(
      client.fetchObservations("DGS10"),
      (error) =>
        error.message === "FRED API 回應 400：Bad request: [redacted]",
    );
  });

  it("returns only real equity trading-day observations", async () => {
    const observations = await fetchEquityObservations(
      {
        seriesId: "YAHOO:SPY",
        symbol: "SPY",
      },
      {
        from: "2026-07-24",
        to: "2026-07-26",
        retrievedAt: "2026-07-27T01:02:03.000Z",
        fetchHistorical: async () => [
          {
            date: "2026-07-24",
            price: 650.25,
            currency: "USD",
            source: "Yahoo Finance",
          },
        ],
      },
    );

    assert.deepEqual(observations.map((item) => item.observationDate), ["2026-07-24"]);
    assert.equal(observations[0].value, 650.25);
  });
});

describe("dynamic beta repository", () => {
  it("keeps writes idempotent and appends changed values as revisions", async () => {
    const redis = new FakeRedis();
    const repository = createDynamicBetaRepository(redis);
    const base = {
      seriesId: "DGS10",
      observationDate: "2026-07-24",
      value: 4.39,
      releasedAt: null,
      retrievedAt: "2026-07-27T01:00:00.000Z",
      sourceRealtimeStart: "2026-07-27",
      sourceRealtimeEnd: "2026-07-27",
    };

    assert.deepEqual(await repository.saveObservations("DGS10", [base]), {
      inserted: 1,
      revised: 0,
      unchanged: 0,
    });
    assert.deepEqual(
      await repository.saveObservations("DGS10", [
        { ...base, retrievedAt: "2026-07-27T02:00:00.000Z" },
      ]),
      {
        inserted: 0,
        revised: 0,
        unchanged: 1,
      },
    );
    const firstRevision = await repository.readObservation("DGS10", "2026-07-24");
    assert.equal(firstRevision.first_seen_at, "2026-07-27T01:00:00.000Z");
    assert.equal(firstRevision.last_seen_at, "2026-07-27T02:00:00.000Z");
    assert.deepEqual(
      await repository.saveObservations("DGS10", [
        { ...base, value: 4.4, retrievedAt: "2026-07-28T01:00:00.000Z" },
      ]),
      {
        inserted: 0,
        revised: 1,
        unchanged: 0,
      },
    );
    assert.deepEqual(
      await repository.saveObservations("DGS10", [
        { ...base, value: 4.39, retrievedAt: "2026-07-29T01:00:00.000Z" },
      ]),
      {
        inserted: 0,
        revised: 1,
        unchanged: 0,
      },
    );

    const revisions = redis.sortedSets.get(
      "jj-invest-public:dynamic-beta:data:v1:revisions:DGS10:2026-07-24",
    );
    assert.equal(revisions.size, 3);
    const latest = await repository.readObservation("DGS10", "2026-07-24");
    assert.equal(latest.value, 4.39);
    assert.equal(latest.retrieved_at, "2026-07-29T01:00:00.000Z");
  });

  it("does not create a fake revision when only FRED query boundaries change", async () => {
    const redis = new FakeRedis();
    const repository = createDynamicBetaRepository(redis);
    const base = {
      seriesId: "DGS10",
      observationDate: "2026-07-24",
      value: 4.39,
      releasedAt: null,
      retrievedAt: "2026-07-27T01:00:00.000Z",
      sourceRealtimeStart: "2026-07-27",
      sourceRealtimeEnd: "2026-07-27",
    };
    await repository.saveObservations("DGS10", [base]);
    assert.deepEqual(
      await repository.saveObservations("DGS10", [
        {
          ...base,
          retrievedAt: "2026-07-28T01:00:00.000Z",
          sourceRealtimeStart: "2026-07-28",
          sourceRealtimeEnd: "2026-07-28",
        },
      ]),
      { inserted: 0, revised: 0, unchanged: 1 },
    );
    const revisions = redis.sortedSets.get(
      "jj-invest-public:dynamic-beta:data:v1:revisions:DGS10:2026-07-24",
    );
    assert.equal(revisions.size, 1);
    const latest = await repository.readObservation("DGS10", "2026-07-24");
    assert.equal(latest.source_realtime_start, "2026-07-27");
    assert.equal(latest.last_seen_at, "2026-07-28T01:00:00.000Z");
  });

  it("prevents overlapping synchronization with a short-lived lock", async () => {
    const repository = createDynamicBetaRepository(new FakeRedis());

    assert.equal(await repository.acquireSyncLock("first"), true);
    assert.equal(await repository.acquireSyncLock("second"), false);
    await repository.releaseSyncLock("first");
    assert.equal(await repository.acquireSyncLock("third"), true);
  });

  it("reads ordered current revisions inside an inclusive date range", async () => {
    const repository = createDynamicBetaRepository(new FakeRedis());
    await repository.saveObservations("DGS10", [
      { seriesId: "DGS10", observationDate: "2026-07-01", value: 4.1, releasedAt: null, retrievedAt: "2026-07-02T00:00:00.000Z", sourceRealtimeStart: "2026-07-02", sourceRealtimeEnd: "2026-07-02" },
      { seriesId: "DGS10", observationDate: "2026-07-15", value: 4.2, releasedAt: null, retrievedAt: "2026-07-16T00:00:00.000Z", sourceRealtimeStart: "2026-07-16", sourceRealtimeEnd: "2026-07-16" },
      { seriesId: "DGS10", observationDate: "2026-07-24", value: 4.3, releasedAt: null, retrievedAt: "2026-07-25T00:00:00.000Z", sourceRealtimeStart: "2026-07-25", sourceRealtimeEnd: "2026-07-25" },
    ]);

    assert.deepEqual(
      await repository.readObservationHistory("DGS10", {
        from: "2026-07-10",
        to: "2026-07-24",
      }),
      [
        { observationDate: "2026-07-15", value: 4.2, releasedAt: null, retrievedAt: "2026-07-16T00:00:00.000Z" },
        { observationDate: "2026-07-24", value: 4.3, releasedAt: null, retrievedAt: "2026-07-25T00:00:00.000Z" },
      ],
    );
  });

  it("reads the latest observation and status for admin validation", async () => {
    const redis = new FakeRedis();
    const repository = createDynamicBetaRepository(redis);
    await repository.upsertSeriesMetadata(
      {
        seriesId: "DGS10",
        name: "US 10-Year Treasury Yield",
        category: "rates",
        source: "FRED",
        frequency: "Daily",
        unit: "Percent",
        enabled: true,
      },
      "2026-07-27T01:00:00.000Z",
    );
    await repository.saveObservations("DGS10", [
      {
        seriesId: "DGS10",
        observationDate: "2026-07-24",
        value: 4.39,
        releasedAt: null,
        retrievedAt: "2026-07-27T01:00:00.000Z",
        sourceRealtimeStart: "2026-07-27",
        sourceRealtimeEnd: "2026-07-27",
      },
    ]);
    await repository.writeSeriesStatus("DGS10", {
      status: "success",
      latest_observation_date: "2026-07-24",
      last_success_at: "2026-07-27T01:01:00.000Z",
    });
    for (const [key, value] of redis.hashes) {
      if (key.includes(":revision:DGS10:")) {
        redis.hashes.set(key, { ...value, value: "4.39" });
      }
    }

    assert.deepEqual(
      await repository.readDashboard(
        [{
          seriesId: "DGS10",
          freshnessPolicy: { kind: "weekdays", fresh: 2, delayed: 4 },
        }],
        { asOf: new Date("2026-07-27T12:00:00.000Z") },
      ), [
      {
        seriesId: "DGS10",
        name: "US 10-Year Treasury Yield",
        category: "rates",
        source: "FRED",
        frequency: "Daily",
        unit: "Percent",
        enabled: true,
        latestValue: 4.39,
        observationDate: "2026-07-24",
        retrievedAt: "2026-07-27T01:00:00.000Z",
        releasedAt: null,
        sourceRealtimeStart: "2026-07-27",
        sourceRealtimeEnd: "2026-07-27",
        firstSeenAt: "2026-07-27T01:00:00.000Z",
        lastSeenAt: "2026-07-27T01:00:00.000Z",
        freshnessStatus: "fresh",
        freshnessAge: 1,
        freshnessFreshThreshold: 2,
        freshnessStaleThreshold: 4,
        freshnessReason: "落後 1 個工作日，仍在正常更新窗口內。",
        updateStatus: "success",
        lastSuccessAt: "2026-07-27T01:01:00.000Z",
        error: null,
      }]);
  });
});

describe("dynamic beta synchronization", () => {
  it("continues other series when one upstream series fails", async () => {
    const redis = new FakeRedis();
    const repository = createDynamicBetaRepository(redis);
    const service = createDynamicBetaSyncService({
      repository,
      seriesCatalog: [
        {
          seriesId: "DGS10",
          name: "US 10-Year Treasury Yield",
          category: "rates",
          source: "FRED",
          enabled: true,
        },
        {
          seriesId: "BROKEN",
          name: "Broken series",
          category: "test",
          source: "FRED",
          enabled: true,
        },
      ],
      fredClient: {
        async fetchSeriesMetadata(seriesId) {
          if (seriesId === "BROKEN") {
            throw new Error("upstream unavailable");
          }
          return { frequency: "Daily", unit: "Percent" };
        },
        async fetchObservations() {
          return [
            {
              date: "2026-07-24",
              value: "4.39",
              realtime_start: "2026-07-27",
              realtime_end: "2026-07-27",
            },
            { date: "2026-07-25", value: "." },
          ];
        },
      },
      now: () => new Date("2026-07-27T01:00:00.000Z"),
      logger: { info() {}, error() {} },
    });

    const result = await service.sync();

    assert.equal(result.status, "partial");
    assert.equal(result.results[0].status, "success");
    assert.equal(result.results[0].inserted, 1);
    assert.equal(result.results[0].missing, 1);
    assert.equal(result.results[1].status, "error");
    assert.equal(
      (await repository.readSeriesStatus("DGS10")).latest_observation_date,
      "2026-07-24",
    );
    assert.equal((await repository.readSeriesStatus("BROKEN")).status, "error");
  });

  it("rejects unknown requested series before starting synchronization", async () => {
    const service = createDynamicBetaSyncService({
      repository: createDynamicBetaRepository(new FakeRedis()),
      seriesCatalog: [],
      now: () => new Date("2026-07-27T01:00:00.000Z"),
      logger: { info() {}, error() {} },
    });

    await assert.rejects(
      service.sync({ seriesIds: ["NOT_ALLOWED"] }),
      /不支援的 Dynamic Beta series：NOT_ALLOWED/,
    );
  });

  it("excludes externally managed series from Yahoo synchronization", async () => {
    const repository = createDynamicBetaRepository(new FakeRedis());
    const fetchedSeriesIds = [];
    const service = createDynamicBetaSyncService({
      repository,
      seriesCatalog: [
        {
          seriesId: "YAHOO:SPY",
          symbol: "SPY",
          source: "Yahoo Finance",
          enabled: true,
        },
        {
          seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
          source: "MacroMicro",
          enabled: true,
          syncMode: "external",
        },
      ],
      equityFetcher: async (series) => {
        fetchedSeriesIds.push(series.seriesId);
        return [];
      },
      now: () => new Date("2026-07-27T12:00:00.000Z"),
      logger: { info() {}, error() {} },
    });

    await service.sync();

    assert.deepEqual(fetchedSeriesIds, ["YAHOO:SPY"]);
    await assert.rejects(
      service.sync({ seriesIds: ["MACROMICRO:TAIEX_MARGIN_MAINTENANCE"] }),
      /不支援的 Dynamic Beta series：MACROMICRO:TAIEX_MARGIN_MAINTENANCE/,
    );
  });

  it("uses a short overlap window for scheduled Yahoo updates", async () => {
    const repository = createDynamicBetaRepository(new FakeRedis());
    await repository.writeSeriesStatus("YAHOO:SPY", {
      status: "success",
      latest_observation_date: "2026-07-24",
    });
    let requestedFrom = null;
    const service = createDynamicBetaSyncService({
      repository,
      seriesCatalog: [{
        seriesId: "YAHOO:SPY",
        symbol: "SPY",
        source: "Yahoo Finance",
        enabled: true,
      }],
      equityFetcher: async (_series, options) => {
        requestedFrom = options.from;
        return [];
      },
      now: () => new Date("2026-07-27T12:00:00.000Z"),
      logger: { info() {}, error() {} },
    });

    await service.sync();

    assert.equal(requestedFrom, "2026-07-17");
  });
});

describe("dynamic beta admin presentation", () => {
  it("formats missing and numeric observations for validation", () => {
    assert.equal(formatDynamicBetaValue(null), "—");
    assert.equal(formatDynamicBetaValue(4.39), "4.39");
    assert.equal(formatDynamicBetaValue(123456.7), "123,456.7");
  });

  it("maps sync states to concise internal labels", () => {
    assert.equal(getDynamicBetaStatusLabel("success"), "正常");
    assert.equal(getDynamicBetaStatusLabel("error"), "失敗");
    assert.equal(getDynamicBetaStatusLabel("never"), "尚未同步");
    assert.equal(getDynamicBetaStatusLabel("running"), "同步中");
  });

  it("maps freshness states to concise internal labels", () => {
    assert.equal(getDynamicBetaFreshnessLabel("fresh"), "新鮮");
    assert.equal(getDynamicBetaFreshnessLabel("delayed"), "延遲");
    assert.equal(getDynamicBetaFreshnessLabel("stale"), "過期");
    assert.equal(getDynamicBetaFreshnessLabel("never"), "無資料");
    assert.equal(getDynamicBetaFreshnessLabel("error"), "同步失敗");
  });
});
