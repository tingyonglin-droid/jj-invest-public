import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { GET as readDynamicBetaAdmin } from "../app/api/dynamic-beta/admin/route.js";
import { POST as syncDynamicBeta } from "../app/api/dynamic-beta/sync/route.js";
import {
  POST as ingestMacroMicro,
  createMacroMicroPost,
} from "../app/api/dynamic-beta/macromicro/route.js";
import { MacroMicroPayloadError } from "../src/lib/dynamic-beta/macromicro.js";
import { GET as runDynamicBetaCron } from "../app/api/dynamic-beta/cron/route.js";
import { GET as previewMarketRiskScore } from "../app/api/dynamic-beta/score-preview/route.js";
import {
  GET as readDynamicBetaNews,
  POST as ingestDynamicBetaNews,
} from "../app/api/dynamic-beta/news/route.js";
import { GET as readNewsConfirmations } from "../app/api/dynamic-beta/news/confirmations/route.js";
import {
  createConfirmationSnapshotGet,
} from "../app/api/dynamic-beta/news/confirmation-snapshots/route.js";
import { POST as validateDynamicBetaNews } from "../app/api/dynamic-beta/news/validate/route.js";
import {
  createConfiguredConfirmationSnapshotService,
} from "../app/api/dynamic-beta/_shared.js";

const originalEnvironment = {
  DYNAMIC_BETA_DATA_ENABLED: process.env.DYNAMIC_BETA_DATA_ENABLED,
  DYNAMIC_BETA_SCORING_ENABLED: process.env.DYNAMIC_BETA_SCORING_ENABLED,
  DYNAMIC_BETA_PUBLIC_ENABLED: process.env.DYNAMIC_BETA_PUBLIC_ENABLED,
  USAGE_ADMIN_TOKEN: process.env.USAGE_ADMIN_TOKEN,
  CRON_SECRET: process.env.CRON_SECRET,
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  DYNAMIC_BETA_NEWS_DATA_ENABLED:
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED,
  DYNAMIC_BETA_NEWS_SCORING_ENABLED:
    process.env.DYNAMIC_BETA_NEWS_SCORING_ENABLED,
  DYNAMIC_BETA_NEWS_PUBLIC_ENABLED:
    process.env.DYNAMIC_BETA_NEWS_PUBLIC_ENABLED,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("dynamic beta cron route", () => {
  it("rejects requests without the exact cron bearer secret", async () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";

    const response = await runDynamicBetaCron(
      new Request("https://example.com/api/dynamic-beta/cron"),
    );

    assert.equal(response.status, 401);
  });

  it("still honors the data feature flag after cron authorization", async () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "false";

    const response = await runDynamicBetaCron(
      new Request("https://example.com/api/dynamic-beta/cron", {
        headers: { Authorization: "Bearer cron-secret" },
      }),
    );

    assert.equal(response.status, 404);
  });
});

describe("dynamic beta internal routes", () => {
  it("rejects requests without the existing admin token", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "false";

    const response = await readDynamicBetaAdmin(
      new Request("https://example.com/api/dynamic-beta/admin"),
    );

    assert.equal(response.status, 401);
  });

  it("returns only sanitized feature booleans after successful admin authorization", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";
    process.env.DYNAMIC_BETA_SCORING_ENABLED = "false";
    process.env.DYNAMIC_BETA_PUBLIC_ENABLED = "false";
    process.env.KV_REST_API_URL = "https://redis.example";
    process.env.KV_REST_API_TOKEN = "redis-secret";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ result: [] });

    try {
      const response = await readDynamicBetaAdmin(
        new Request(
          "https://example.com/api/dynamic-beta/admin?token=admin-secret",
        ),
      );
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(payload.flags, {
        dataEnabled: true,
        scoringEnabled: false,
        publicEnabled: false,
      });
      const serialized = JSON.stringify(payload);
      assert.equal(serialized.includes("admin-secret"), false);
      assert.equal(serialized.includes("redis-secret"), false);
      assert.equal(serialized.includes("DYNAMIC_BETA_DATA_ENABLED"), false);
      assert.equal(serialized.includes("DYNAMIC_BETA_SCORING_ENABLED"), false);
      assert.equal(serialized.includes("DYNAMIC_BETA_PUBLIC_ENABLED"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("hides admin data when the data feature flag is disabled", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "false";

    const response = await readDynamicBetaAdmin(
      new Request(
        "https://example.com/api/dynamic-beta/admin?token=admin-secret",
      ),
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      enabled: false,
      error: "Dynamic Beta data module 未啟用。",
    });
  });

  it("does not initialize synchronization when the data flag is disabled", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "false";

    const response = await syncDynamicBeta(
      new Request(
        "https://example.com/api/dynamic-beta/sync?token=admin-secret",
        {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    assert.equal(response.status, 404);
  });
});

describe("MacroMicro ingestion route", () => {
  function request(body = {}) {
    return new Request(
      "https://example.com/api/dynamic-beta/macromicro?token=admin-secret",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  function enableRoute() {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";
  }

  it("rejects requests without the existing admin token", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";

    const response = await ingestMacroMicro(new Request(
      "https://example.com/api/dynamic-beta/macromicro",
      { method: "POST", body: "{}" },
    ));

    assert.equal(response.status, 401);
  });

  it("hides ingestion when the data feature flag is disabled", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "false";

    const response = await ingestMacroMicro(new Request(
      "https://example.com/api/dynamic-beta/macromicro?token=admin-secret",
      { method: "POST", body: "{}" },
    ));

    assert.equal(response.status, 404);
  });

  it("rejects malformed JSON before requiring Redis", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";

    const response = await ingestMacroMicro(new Request(
      "https://example.com/api/dynamic-beta/macromicro?token=admin-secret",
      { method: "POST", body: "{broken" },
    ));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "JSON 格式無效。" });
  });

  it("returns 200 for both successful storage and a fixed source error", async () => {
    enableRoute();
    const results = [
      {
        seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
        status: "success",
        inserted: 1,
        revised: 0,
        unchanged: 0,
        latestObservationDate: "2026-07-28",
      },
      {
        seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
        status: "error",
        errorCode: "LATEST_DATA_MISSING",
      },
    ];

    for (const result of results) {
      const post = createMacroMicroPost({
        getService: () => ({ async ingest() { return result; } }),
      });
      const response = await post(request());

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    }
  });

  it("maps semantic payload validation failures to 400", async () => {
    enableRoute();
    const post = createMacroMicroPost({
      getService: () => ({
        async ingest() { throw new MacroMicroPayloadError(); },
      }),
    });

    const response = await post(request({ observationDate: "invalid" }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "MacroMicro payload 無效。" });
  });

  it("maps lock contention to 409", async () => {
    enableRoute();
    const post = createMacroMicroPost({
      getService: () => ({
        async ingest() { throw new Error("Dynamic Beta 資料同步已在執行中。"); },
      }),
    });

    const response = await post(request());

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "Dynamic Beta 資料同步已在執行中。",
    });
  });

  it("returns 503 when the ingestion service is unconfigured", async () => {
    enableRoute();
    const response = await createMacroMicroPost({
      getService: () => null,
    })(request());

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      configured: false,
      error: "缺少 Upstash Redis 設定。",
    });
  });

  it("sanitizes unexpected ingestion failures as 500", async () => {
    enableRoute();
    const secret = "UPSTASH_REDIS_REST_TOKEN=do-not-reflect";
    const post = createMacroMicroPost({
      getService: () => ({ async ingest() { throw new Error(secret); } }),
    });

    const response = await post(request());
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: "MacroMicro 資料寫入失敗。" });
    assert.equal(JSON.stringify(body).includes(secret), false);
  });
});

describe("market risk score preview route", () => {
  it("requires the existing admin token", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";
    process.env.DYNAMIC_BETA_SCORING_ENABLED = "false";

    const response = await previewMarketRiskScore(
      new Request("https://example.com/api/dynamic-beta/score-preview"),
    );

    assert.equal(response.status, 401);
  });

  it("does not run when the data module is disabled", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "false";
    process.env.DYNAMIC_BETA_SCORING_ENABLED = "false";

    const response = await previewMarketRiskScore(
      new Request(
        "https://example.com/api/dynamic-beta/score-preview?token=admin-secret",
      ),
    );

    assert.equal(response.status, 404);
  });
});

function validNewsBrief() {
  return {
    briefDate: "2026-07-27",
    generatedAt: "2026-07-27T23:00:00.000Z",
    analystLabel: "risk_elevated",
    evidence: [{
      url: "https://example.com/news/fed",
      sourceName: "Example News",
      sourceTier: "reputable_media",
      title: "Fed leaves rates unchanged",
      publishedAt: "2026-07-27T22:00:00.000Z",
    }],
    events: Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      headline: `Event ${index + 1}`,
      summary: `Summary ${index + 1}`,
      topicIds: ["global_macro_fed"],
      evidenceUrls: ["https://example.com/news/fed"],
      transmissionPath: ["Fed", "Rates", "Equities"],
      affectedAssets: ["SPY"],
      dataToConfirm: ["DGS2"],
      interpretation: "Confirm the event with market data.",
      confidence: 0.7,
    })),
  };
}

describe("dynamic beta news admin routes", () => {
  it("requires the existing admin token for reads and validation", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "true";

    const readResponse = await readDynamicBetaNews(
      new Request("https://example.com/api/dynamic-beta/news"),
    );
    const validateResponse = await validateDynamicBetaNews(
      new Request("https://example.com/api/dynamic-beta/news/validate", {
        method: "POST",
        body: JSON.stringify(validNewsBrief()),
        headers: { "Content-Type": "application/json" },
      }),
    );

    assert.equal(readResponse.status, 401);
    assert.equal(validateResponse.status, 401);
  });

  it("hides every news endpoint when its independent data flag is disabled", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "false";

    const response = await validateDynamicBetaNews(
      new Request(
        "https://example.com/api/dynamic-beta/news/validate?token=admin-secret",
        {
          method: "POST",
          body: JSON.stringify(validNewsBrief()),
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      enabled: false,
      error: "Dynamic Beta News Event data module 未啟用。",
    });
  });

  it("returns a useful 400 response for malformed JSON without touching storage", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "true";

    const response = await ingestDynamicBetaNews(
      new Request("https://example.com/api/dynamic-beta/news?token=admin-secret", {
        method: "POST",
        body: "{broken",
        headers: { "Content-Type": "application/json" },
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "JSON 格式無效。" });
  });

  it("validates a complete payload without Redis or scoring/public behavior", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "true";
    process.env.DYNAMIC_BETA_NEWS_SCORING_ENABLED = "false";
    process.env.DYNAMIC_BETA_NEWS_PUBLIC_ENABLED = "false";

    const response = await validateDynamicBetaNews(
      new Request(
        "https://example.com/api/dynamic-beta/news/validate?token=admin-secret",
        {
          method: "POST",
          body: JSON.stringify(validNewsBrief()),
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.valid, true);
    assert.deepEqual(payload.flags, {
      dataEnabled: true,
      scoringEnabled: false,
      publicEnabled: false,
    });
    assert.equal(payload.value.events.length, 5);
  });

  it("rejects invalid briefs before requiring Redis", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "true";

    const response = await ingestDynamicBetaNews(
      new Request("https://example.com/api/dynamic-beta/news?token=admin-secret", {
        method: "POST",
        body: JSON.stringify({ ...validNewsBrief(), events: [] }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    assert.equal(response.status, 400);
    assert.ok((await response.json()).errors.includes("events 必須剛好包含 5 個事件。"));
  });
});

describe("dynamic beta news confirmation route", () => {
  it("requires the existing admin token before checking feature flags", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "false";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "false";

    const response = await readNewsConfirmations(
      new Request("https://example.com/api/dynamic-beta/news/confirmations"),
    );

    assert.equal(response.status, 401);
  });

  it("checks the market data flag before the news data flag", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "false";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "true";

    const response = await readNewsConfirmations(new Request(
      "https://example.com/api/dynamic-beta/news/confirmations?token=admin-secret",
    ));

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      enabled: false,
      error: "Dynamic Beta data module 未啟用。",
    });
  });

  it("checks the news data flag after the market data flag", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "false";

    const response = await readNewsConfirmations(new Request(
      "https://example.com/api/dynamic-beta/news/confirmations?token=admin-secret",
    ));

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      enabled: false,
      error: "Dynamic Beta News Event data module 未啟用。",
    });
  });

  it("rejects impossible query dates before requiring Redis", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "true";

    for (const query of [
      "briefDate=2026-02-30",
      "asOf=2026-99-99",
    ]) {
      const response = await readNewsConfirmations(new Request(
        `https://example.com/api/dynamic-beta/news/confirmations?token=admin-secret&${query}`,
      ));

      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /briefDate.*asOf/);
    }
  });

  it("requires briefDate when revisionId is provided", async () => {
    process.env.USAGE_ADMIN_TOKEN = "admin-secret";
    process.env.DYNAMIC_BETA_DATA_ENABLED = "true";
    process.env.DYNAMIC_BETA_NEWS_DATA_ENABLED = "true";

    const response = await readNewsConfirmations(new Request(
      "https://example.com/api/dynamic-beta/news/confirmations?token=admin-secret&revisionId=revision-1",
    ));

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /revisionId.*briefDate/);
  });
});

function savedConfirmationSnapshot(overrides = {}) {
  return {
    snapshotId: "ncs_saved_snapshot",
    snapshotRevisionNumber: 3,
    briefDate: "2026-07-27",
    revisionId: "revision-current",
    revisionNumber: 2,
    asOf: "2026-07-29",
    evaluatedAt: "2026-07-29T22:00:00.000Z",
    createdAt: "2026-07-29T22:01:00.000Z",
    completion: { complete: false, pendingReasons: [{ eventRank: 1, seriesId: "YAHOO:QQQ", reason: "awaiting_observation" }] },
    metadata: {
      vintageMode: "latest_stored_revision_by_observation_date",
      truePointInTime: false,
    },
    events: [{ rank: 1, headline: "Saved confirmation", rules: [] }],
    ...overrides,
  };
}

function snapshotRequest(query = "") {
  return new Request(
    `https://example.com/api/dynamic-beta/news/confirmation-snapshots?${query}`,
  );
}

function enabledSnapshotGet(overrides = {}) {
  return createConfirmationSnapshotGet({
    authorize: () => null,
    requireMarketData: () => null,
    requireNewsData: () => null,
    getSnapshotRepository: () => ({
      readLatestSnapshot: async () => null,
      readRecentLatestSnapshots: async () => [],
    }),
    getNewsRepository: () => ({ readMorningBrief: async () => null }),
    ...overrides,
  });
}

describe("dynamic beta saved confirmation snapshot route", () => {
  it("authorizes, checks both data flags, then constructs repositories in order", async () => {
    const order = [];
    const get = createConfirmationSnapshotGet({
      authorize: () => { order.push("authorize"); return null; },
      requireMarketData: () => { order.push("market"); return null; },
      requireNewsData: () => { order.push("news"); return null; },
      getSnapshotRepository: () => {
        order.push("snapshotRepository");
        return { readRecentLatestSnapshots: async () => [] };
      },
      getNewsRepository: () => {
        order.push("newsRepository");
        return { readMorningBrief: async () => null };
      },
    });

    const response = await get(snapshotRequest());

    assert.equal(response.status, 404);
    assert.deepEqual(order, [
      "authorize",
      "market",
      "news",
      "snapshotRepository",
      "newsRepository",
    ]);
  });

  it("does not read feature flags or repositories when authorization fails", async () => {
    const order = [];
    const get = createConfirmationSnapshotGet({
      authorize: () => {
        order.push("authorize");
        return Response.json({ error: "unauthorized" }, { status: 401 });
      },
      requireMarketData: () => { order.push("market"); return null; },
      requireNewsData: () => { order.push("news"); return null; },
      getSnapshotRepository: () => { order.push("snapshotRepository"); return null; },
      getNewsRepository: () => { order.push("newsRepository"); return null; },
    });

    const response = await get(snapshotRequest());

    assert.equal(response.status, 401);
    assert.deepEqual(order, ["authorize"]);
  });

  it("does not construct repositories when either data flag disables the route", async () => {
    for (const disabled of ["market", "news"]) {
      const order = [];
      const get = createConfirmationSnapshotGet({
        authorize: () => { order.push("authorize"); return null; },
        requireMarketData: () => {
          order.push("market");
          return disabled === "market" ? Response.json({}, { status: 404 }) : null;
        },
        requireNewsData: () => {
          order.push("news");
          return disabled === "news" ? Response.json({}, { status: 404 }) : null;
        },
        getSnapshotRepository: () => { order.push("snapshotRepository"); return null; },
        getNewsRepository: () => { order.push("newsRepository"); return null; },
      });

      const response = await get(snapshotRequest());

      assert.equal(response.status, 404);
      assert.deepEqual(order, disabled === "market"
        ? ["authorize", "market"]
        : ["authorize", "market", "news"]);
    }
  });

  it("returns 503 when either Redis-backed repository is unavailable", async () => {
    for (const unavailable of ["snapshot", "news"]) {
      const response = await enabledSnapshotGet({
        getSnapshotRepository: () => unavailable === "snapshot" ? null : {
          readRecentLatestSnapshots: async () => [],
        },
        getNewsRepository: () => unavailable === "news" ? null : {
          readMorningBrief: async () => null,
        },
      })(snapshotRequest());

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        configured: false,
        error: "缺少 Upstash Redis 設定。",
      });
    }
  });

  it("rejects invalid snapshot dates and unscoped revision IDs before reading repositories", async () => {
    for (const query of ["briefDate=2026-02-30", "asOf=2026-99-99", "revisionId=revision-1"]) {
      let repositoriesRead = false;
      const response = await enabledSnapshotGet({
        getSnapshotRepository: () => { repositoriesRead = true; return null; },
        getNewsRepository: () => { repositoriesRead = true; return null; },
      })(snapshotRequest(query));

      assert.equal(response.status, 400);
      assert.equal(repositoriesRead, false);
    }
  });

  it("returns the latest saved snapshot without filters unchanged", async () => {
    const snapshot = savedConfirmationSnapshot();
    const calls = [];
    const response = await enabledSnapshotGet({
      getSnapshotRepository: () => ({
        readRecentLatestSnapshots: async (query) => { calls.push(query); return [snapshot]; },
      }),
    })(snapshotRequest());

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ since: "1900-01-01", until: "9999-12-31", limit: 1 }]);
    assert.deepEqual(await response.json(), snapshot);
  });

  it("resolves a date-only request through the current published brief revision", async () => {
    const snapshot = savedConfirmationSnapshot();
    const snapshotCalls = [];
    const response = await enabledSnapshotGet({
      getNewsRepository: () => ({
        readMorningBrief: async (query) => {
          assert.deepEqual(query, { briefDate: "2026-07-27" });
          return { briefDate: "2026-07-27", revisionId: "revision-current" };
        },
      }),
      getSnapshotRepository: () => ({
        readLatestSnapshot: async (query) => { snapshotCalls.push(query); return snapshot; },
      }),
    })(snapshotRequest("briefDate=2026-07-27"));

    assert.equal(response.status, 200);
    assert.deepEqual(snapshotCalls, [{
      briefDate: "2026-07-27",
      revisionId: "revision-current",
      asOf: undefined,
    }]);
    assert.deepEqual(await response.json(), snapshot);
  });

  it("reads an exact revision and saved date without resolving the current brief", async () => {
    const snapshot = savedConfirmationSnapshot({ revisionId: "revision-exact", asOf: "2026-07-28" });
    let readMorningBrief = false;
    const response = await enabledSnapshotGet({
      getNewsRepository: () => ({ readMorningBrief: async () => { readMorningBrief = true; return null; } }),
      getSnapshotRepository: () => ({
        readLatestSnapshot: async (query) => {
          assert.deepEqual(query, {
            briefDate: "2026-07-27",
            revisionId: "revision-exact",
            asOf: "2026-07-28",
          });
          return snapshot;
        },
      }),
    })(snapshotRequest("briefDate=2026-07-27&revisionId=revision-exact&asOf=2026-07-28"));

    assert.equal(response.status, 200);
    assert.equal(readMorningBrief, false);
    assert.deepEqual(await response.json(), snapshot);
  });

  it("returns 404 when the requested brief or saved snapshot does not exist", async () => {
    const missingBrief = await enabledSnapshotGet({
      getNewsRepository: () => ({ readMorningBrief: async () => null }),
    })(snapshotRequest("briefDate=2026-07-27"));
    const missingSnapshot = await enabledSnapshotGet({
      getNewsRepository: () => ({ readMorningBrief: async () => ({ revisionId: "revision-current" }) }),
      getSnapshotRepository: () => ({ readLatestSnapshot: async () => null }),
    })(snapshotRequest("briefDate=2026-07-27"));

    assert.equal(missingBrief.status, 404);
    assert.equal(missingSnapshot.status, 404);
  });

  it("sanitizes unexpected read failures", async () => {
    const secret = "KV_REST_API_TOKEN=do-not-reflect";
    const response = await enabledSnapshotGet({
      getSnapshotRepository: () => ({
        readRecentLatestSnapshots: async () => { throw new Error(secret); },
      }),
    })(snapshotRequest());
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: "Confirmation snapshot 讀取失敗。" });
    assert.equal(JSON.stringify(body).includes(secret), false);
  });
});

describe("configured confirmation snapshot service", () => {
  it("returns null without every required repository and provides the saved-snapshot service when configured", async () => {
    const newsRepository = { readRecentBriefs: async () => [] };
    const snapshotRepository = { saveSnapshot: async () => null, readLatestSnapshot: async () => null };
    const confirmationService = { evaluate: async () => null };

    assert.equal(createConfiguredConfirmationSnapshotService({
      newsRepository: null,
      snapshotRepository,
      confirmationService,
    }), null);
    assert.equal(createConfiguredConfirmationSnapshotService({
      newsRepository,
      snapshotRepository: null,
      confirmationService,
    }), null);

    const service = createConfiguredConfirmationSnapshotService({
      newsRepository,
      snapshotRepository,
      confirmationService,
    });

    assert.deepEqual(await service.run({ asOf: "2026-07-29", lookbackDays: 0 }), {
      status: "success",
      selected: 0,
      skippedComplete: 0,
      inserted: 0,
      revised: 0,
      unchanged: 0,
      failed: 0,
      results: [],
    });
  });
});
