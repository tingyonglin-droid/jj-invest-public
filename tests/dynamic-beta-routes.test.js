import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { GET as readDynamicBetaAdmin } from "../app/api/dynamic-beta/admin/route.js";
import { POST as syncDynamicBeta } from "../app/api/dynamic-beta/sync/route.js";
import { GET as runDynamicBetaCron } from "../app/api/dynamic-beta/cron/route.js";
import { GET as previewMarketRiskScore } from "../app/api/dynamic-beta/score-preview/route.js";
import {
  GET as readDynamicBetaNews,
  POST as ingestDynamicBetaNews,
} from "../app/api/dynamic-beta/news/route.js";
import { GET as readNewsConfirmations } from "../app/api/dynamic-beta/news/confirmations/route.js";
import { POST as validateDynamicBetaNews } from "../app/api/dynamic-beta/news/validate/route.js";

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
