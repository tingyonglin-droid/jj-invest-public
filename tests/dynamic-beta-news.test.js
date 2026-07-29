import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalizeNewsUrl,
  normalizeNewsEvidence,
} from "../src/lib/dynamic-beta/news/normalize.js";
import {
  validateMorningBriefPayload,
} from "../src/lib/dynamic-beta/news/schema.js";
import {
  suggestNewsTopics,
} from "../src/lib/dynamic-beta/news/topics.js";
import { compareNewsTitles } from "../src/lib/dynamic-beta/news/dedupe.js";
import { createNewsRepository } from "../src/lib/dynamic-beta/news/repository.js";
import { getDynamicBetaNewsFlags } from "../src/lib/dynamic-beta/config.js";
import { createNewsEventService } from "../src/lib/dynamic-beta/news/service.js";
import { createMorningBriefTemplate } from "../src/lib/dynamic-beta/news/template.js";
import { FakeRedis } from "./helpers/news-fake-redis.js";

function evidence(overrides = {}) {
  return {
    url: "https://example.com/markets/story",
    sourceName: "Example Markets",
    sourceTier: "reputable_media",
    title: "Fed keeps rates unchanged as inflation remains elevated",
    summary: "Officials kept policy unchanged and emphasized incoming data.",
    publishedAt: "2026-07-27T00:30:00.000Z",
    ...overrides,
  };
}

function event(rank, overrides = {}) {
  return {
    rank,
    headline: `Market event ${rank}`,
    summary: `Summary for market event ${rank}.`,
    topicIds: ["global_macro_fed"],
    evidenceUrls: [`https://example.com/news/${rank}`],
    transmissionPath: ["Policy", "Rates", "Equity valuation"],
    affectedAssets: ["SPY", "QQQ"],
    dataToConfirm: ["DGS2", "DGS10"],
    interpretation: "Higher discount rates may pressure long-duration equities.",
    confidence: 0.7,
    ...overrides,
  };
}

function brief(overrides = {}) {
  return {
    briefDate: "2026-07-27",
    generatedAt: "2026-07-27T23:00:00.000Z",
    analystLabel: "risk_elevated",
    analystRationale: "Rates and energy require confirmation from market data.",
    evidence: Array.from({ length: 5 }, (_, index) => evidence({
      url: `https://example.com/news/${index + 1}`,
      title: `Source evidence ${index + 1}`,
    })),
    events: [event(1), event(2), event(3), event(4), event(5)],
    ...overrides,
  };
}

describe("dynamic beta news normalization", () => {
  it("uses one canonical URL for tracking variants", () => {
    assert.equal(
      canonicalizeNewsUrl(
        "HTTPS://Example.COM/news/story/?utm_source=morning&b=2&fbclid=abc&a=1#chart",
      ),
      "https://example.com/news/story?a=1&b=2",
    );
  });

  it("creates a deterministic fingerprint without inventing release time", () => {
    const first = normalizeNewsEvidence(
      evidence({ publishedAt: null }),
      "2026-07-27T23:10:00.000Z",
    );
    const second = normalizeNewsEvidence(
      evidence({
        url: "https://example.com/markets/story?utm_medium=email",
        publishedAt: null,
      }),
      "2026-07-27T23:15:00.000Z",
    );

    assert.equal(first.canonicalUrl, "https://example.com/markets/story");
    assert.equal(first.contentFingerprint, second.contentFingerprint);
    assert.equal(first.publishedAt, null);
    assert.equal(first.retrievedAt, "2026-07-27T23:10:00.000Z");
    assert.match(first.evidenceId, /^ev_[a-f0-9]{24}$/);
    assert.match(first.revisionId, /^evr_[a-f0-9]{24}$/);
  });
});

describe("dynamic beta morning brief schema", () => {
  it("accepts exactly five ranked events and preserves unknown earnings data as null", () => {
    const payload = brief({
      events: [
        event(1, {
          topicIds: ["megacap_earnings", "ai_semiconductors"],
          techEarnings: {
            company: "Example Cloud",
            revenueGrowthPct: 12.5,
            aiCloudGrowthPct: null,
            capexGrowthPct: 40,
            freeCashFlowGrowthPct: null,
            capexGrowingFasterThanFcf: null,
          },
        }),
        event(2),
        event(3),
        event(4),
        event(5),
      ],
    });

    const result = validateMorningBriefPayload(payload);

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.value.events.length, 5);
    assert.equal(result.value.events[0].techEarnings.aiCloudGrowthPct, null);
    assert.equal(result.value.events[0].techEarnings.capexGrowingFasterThanFcf, null);
  });

  it("rejects missing events, unknown topics, and confidence outside zero to one", () => {
    const result = validateMorningBriefPayload(
      brief({
        events: [
          event(1, { topicIds: ["unapproved_topic"], confidence: 1.2 }),
          event(2),
          event(3),
          event(4),
        ],
      }),
    );

    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("events 必須剛好包含 5 個事件。"));
    assert.ok(result.errors.includes("events[0].topicIds 包含未知主題：unapproved_topic。"));
    assert.ok(result.errors.includes("events[0].confidence 必須介於 0 與 1。"));
  });

  it("suggests fixed topics without changing the supplied payload", () => {
    assert.deepEqual(
      suggestNewsTopics(
        "Microsoft AI cloud revenue accelerated while CapEx and data center spending surged",
      ),
      ["ai_semiconductors", "data_centers", "megacap_earnings"],
    );
    assert.deepEqual(
      suggestNewsTopics("Fed said inflation remains elevated"),
      ["global_macro_fed", "inflation_rates"],
    );
  });

  it("rejects event URLs that are absent from the evidence collection", () => {
    const result = validateMorningBriefPayload(brief({
      events: [
        event(1, { evidenceUrls: ["https://unlisted.example.com/story"] }),
        event(2),
        event(3),
        event(4),
        event(5),
      ],
    }));

    assert.equal(result.valid, false);
    assert.ok(result.errors.includes(
      "events[0].evidenceUrls 引用了 evidence 中不存在的 URL：https://unlisted.example.com/story。",
    ));
  });

  it("normalizes explicit market confirmation rules", () => {
    const result = validateMorningBriefPayload(brief({
      events: [
        event(1, {
          marketDate: "2026-07-28",
          dataToConfirm: ["YAHOO:QQQ", "DGS10"],
          confirmationRules: [
            {
              seriesId: "YAHOO:QQQ",
              expectedDirection: "down",
              changeType: "percent",
              threshold: 1,
            },
            {
              seriesId: "DGS10",
              expectedDirection: "up",
              changeType: "basis_points",
              threshold: 5,
            },
          ],
        }),
        event(2), event(3), event(4), event(5),
      ],
    }));

    assert.equal(result.valid, true);
    assert.equal(result.value.events[0].marketDate, "2026-07-28");
    assert.deepEqual(result.value.events[0].confirmationRules[0], {
      seriesId: "YAHOO:QQQ",
      expectedDirection: "down",
      changeType: "percent",
      threshold: 1,
    });
    assert.deepEqual(result.value.events[1].confirmationRules, []);
    assert.ok(result.warnings.some((message) => message.includes("尚未設定確認規則")));
  });

  it("rejects invalid market confirmation rule shapes", () => {
    const result = validateMorningBriefPayload(brief({
      events: [
        event(1, {
          marketDate: "2026-02-30",
          confirmationRules: [
            {
              seriesId: "UNKNOWN",
              expectedDirection: "flat",
              changeType: "ratio",
              threshold: 0,
            },
            {
              seriesId: "DGS2",
              expectedDirection: "up",
              changeType: "percent",
              threshold: 1,
            },
            {
              seriesId: "DGS2",
              expectedDirection: "up",
              changeType: "percent",
              threshold: 1,
            },
          ],
        }),
        event(2), event(3), event(4), event(5),
      ],
    }));

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((message) => message.includes("marketDate")));
    assert.ok(result.errors.some((message) => message.includes("UNKNOWN")));
    assert.ok(result.errors.some((message) => message.includes("不可重複")));
    assert.ok(result.errors.some((message) => message.includes("expectedDirection")));
    assert.ok(result.errors.some((message) => message.includes("changeType")));
    assert.ok(result.errors.some((message) => message.includes("threshold")));
    assert.ok(result.errors.some((message) => message.includes("dataToConfirm")));
  });
});

describe("dynamic beta news deduplication", () => {
  it("recognizes near-identical English and Chinese headlines", () => {
    assert.ok(
      compareNewsTitles(
        "Oil prices surge after major supply disruption",
        "Oil prices surge following major supply disruption",
      ).similarity >= 0.7,
    );
    assert.ok(
      compareNewsTitles(
        "聯準會維持利率不變市場關注通膨",
        "聯準會維持利率不變，市場關注通膨",
      ).similarity >= 0.9,
    );
  });

  it("keeps identical retrievals idempotent and appends changed content", async () => {
    const repository = createNewsRepository(new FakeRedis());
    const first = normalizeNewsEvidence(evidence(), "2026-07-27T00:00:00.000Z");
    const seenAgain = normalizeNewsEvidence(
      evidence({ url: "https://example.com/markets/story?utm_source=email" }),
      "2026-07-27T01:00:00.000Z",
    );
    const changed = normalizeNewsEvidence(
      evidence({ title: "Fed signals rates may stay high as inflation persists" }),
      "2026-07-27T02:00:00.000Z",
    );

    assert.equal((await repository.saveEvidence(first)).status, "inserted");
    assert.equal((await repository.saveEvidence(seenAgain)).status, "unchanged");
    assert.equal((await repository.saveEvidence(changed)).status, "revised");

    const revisions = await repository.readEvidenceRevisions(first.evidenceId);
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0].firstSeenAt, "2026-07-27T00:00:00.000Z");
    assert.equal(revisions[0].lastSeenAt, "2026-07-27T01:00:00.000Z");
    assert.equal(revisions[1].title, changed.title);
  });

  it("does not overwrite the first revision when content changes from A to B to A", async () => {
    const repository = createNewsRepository(new FakeRedis());
    const versionA = normalizeNewsEvidence(evidence(), "2026-07-27T00:00:00.000Z");
    const versionB = normalizeNewsEvidence(
      evidence({ title: "Fed signals rates may stay high as inflation persists" }),
      "2026-07-27T01:00:00.000Z",
    );
    const versionAAgain = normalizeNewsEvidence(evidence(), "2026-07-27T02:00:00.000Z");

    await repository.saveEvidence(versionA);
    await repository.saveEvidence(versionB);
    await repository.saveEvidence(versionAAgain);

    const revisions = await repository.readEvidenceRevisions(versionA.evidenceId);
    const storedA = revisions.find((item) => item.revisionId === versionA.revisionId);
    assert.equal(revisions.length, 2);
    assert.deepEqual(revisions.map((item) => item.title), [versionA.title, versionB.title]);
    assert.equal(storedA.firstSeenAt, "2026-07-27T00:00:00.000Z");
    assert.equal(storedA.lastSeenAt, "2026-07-27T02:00:00.000Z");
  });

  it("links identical content from another URL instead of discarding it", async () => {
    const repository = createNewsRepository(new FakeRedis());
    const original = normalizeNewsEvidence(evidence(), "2026-07-27T00:00:00.000Z");
    const syndicated = normalizeNewsEvidence(
      evidence({ url: "https://syndicator.example.net/same-story" }),
      "2026-07-27T00:10:00.000Z",
    );

    await repository.saveEvidence(original);
    const result = await repository.saveEvidence(syndicated);

    assert.equal(result.status, "inserted");
    assert.equal(result.duplicateOfEvidenceId, original.evidenceId);
    assert.equal(
      (await repository.readEvidenceRevisions(syndicated.evidenceId))[0]
        .duplicateOfEvidenceId,
      original.evidenceId,
    );
  });

  it("warns about similar titles only inside the 72-hour window", async () => {
    const repository = createNewsRepository(new FakeRedis());
    await repository.saveEvidence(
      normalizeNewsEvidence(
        evidence({ title: "Oil prices surge after major supply disruption" }),
        "2026-07-24T00:00:00.000Z",
      ),
    );
    const candidate = normalizeNewsEvidence(
      evidence({
        url: "https://another.example.com/oil",
        title: "Oil prices surge following major supply disruption",
      }),
      "2026-07-27T00:00:00.000Z",
    );

    assert.equal((await repository.findLikelyDuplicates(candidate)).length, 1);
    assert.equal(
      (await repository.findLikelyDuplicates({
        ...candidate,
        retrievedAt: "2026-07-27T00:00:01.000Z",
      })).length,
      0,
    );
  });
});

describe("dynamic beta news brief revisions", () => {
  it("publishes a brief as one atomic commit and retries cleanly after an injected failure", async () => {
    const redis = new FakeRedis();
    const repository = createNewsRepository(redis);
    const validated = validateMorningBriefPayload(brief()).value;
    redis.failNextEval("jj-news-brief-save-v1", new Error("atomic brief write failed"));

    await assert.rejects(repository.saveMorningBrief(validated), /atomic brief write failed/);
    assert.equal(await repository.readMorningBrief({ briefDate: validated.briefDate }), null);
    assert.deepEqual(await repository.readRecentBriefs({ limit: 20 }), []);

    const retried = await repository.saveMorningBrief(validated);
    assert.equal(retried.status, "inserted");
    assert.equal(retried.revisionNumber, 1);
  });

  it("allocates distinct revision numbers for concurrent brief publications", async () => {
    const repository = createNewsRepository(new FakeRedis());
    const validated = validateMorningBriefPayload(brief()).value;
    const [first, second] = await Promise.all([
      repository.saveMorningBrief(validated),
      repository.saveMorningBrief({
        ...validated,
        generatedAt: "2026-07-27T23:30:00.000Z",
        analystLabel: "high_alert",
      }),
    ]);

    assert.deepEqual(
      [first.revisionNumber, second.revisionNumber].sort((a, b) => a - b),
      [1, 2],
    );
    assert.notEqual(first.revisionId, second.revisionId);
  });

  it("repairs missing brief indexes and current pointer on an idempotent retry", async () => {
    const redis = new FakeRedis();
    const repository = createNewsRepository(redis);
    const validated = validateMorningBriefPayload(brief()).value;
    const first = await repository.saveMorningBrief(validated);
    const prefix = "jj-invest-public:dynamic-beta:news:v1";
    redis.strings.delete(`${prefix}:brief:${validated.briefDate}:current`);
    redis.sortedSets.delete(`${prefix}:brief:${validated.briefDate}:revisions`);
    redis.sortedSets.delete(`${prefix}:brief:timeline`);

    const repaired = await repository.saveMorningBrief(validated);
    const recent = await repository.readRecentBriefs({ limit: 20 });

    assert.equal(repaired.revisionId, first.revisionId);
    assert.equal((await repository.readMorningBrief({
      briefDate: validated.briefDate,
    })).revisionId, first.revisionId);
    assert.deepEqual(recent.map((item) => item.revisionId), [first.revisionId]);
  });

  it("stores changed snapshots as revisions without duplicating identical input", async () => {
    const repository = createNewsRepository(new FakeRedis());
    const validated = validateMorningBriefPayload(brief()).value;

    const first = await repository.saveMorningBrief(validated);
    const unchanged = await repository.saveMorningBrief(validated);
    const revised = await repository.saveMorningBrief({
      ...validated,
      analystLabel: "high_alert",
      generatedAt: "2026-07-27T23:30:00.000Z",
    });

    assert.deepEqual(
      [first.status, unchanged.status, revised.status],
      ["inserted", "unchanged", "revised"],
    );
    assert.deepEqual(
      [first.revisionNumber, unchanged.revisionNumber, revised.revisionNumber],
      [1, 1, 2],
    );
    const rows = await repository.readRecentBriefs({ limit: 10 });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].analystLabel, "high_alert");
    assert.equal(rows[1].analystLabel, "risk_elevated");
  });

  it("reads brief payloads that Upstash automatically deserializes to objects", async () => {
    const redis = new FakeRedis();
    const repository = createNewsRepository(redis);
    const validated = validateMorningBriefPayload(brief()).value;
    await repository.saveMorningBrief(validated);
    for (const [key, row] of redis.hashes.entries()) {
      if (key.includes(":brief:") && typeof row.payload === "string") {
        redis.hashes.set(key, { ...row, payload: JSON.parse(row.payload) });
      }
    }

    const rows = await repository.readRecentBriefs({ limit: 10 });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].briefDate, "2026-07-27");
    assert.equal(rows[0].revisionNumber, 1);
  });

  it("reads the current brief by default and an exact immutable revision by ID", async () => {
    const repository = createNewsRepository(new FakeRedis());
    const validated = validateMorningBriefPayload(brief()).value;
    const first = await repository.saveMorningBrief(validated);
    const revised = await repository.saveMorningBrief({
      ...validated,
      analystLabel: "high_alert",
      generatedAt: "2026-07-27T23:30:00.000Z",
    });

    const current = await repository.readMorningBrief({ briefDate: "2026-07-27" });
    const original = await repository.readMorningBrief({
      briefDate: "2026-07-27",
      revisionId: first.revisionId,
    });

    assert.equal(current.revisionId, revised.revisionId);
    assert.equal(current.analystLabel, "high_alert");
    assert.equal(original.revisionId, first.revisionId);
    assert.equal(original.analystLabel, "risk_elevated");
  });
});

describe("dynamic beta news service and flags", () => {
  it("keeps every news capability disabled unless exact flags are true", () => {
    assert.deepEqual(getDynamicBetaNewsFlags({}), {
      dataEnabled: false,
      scoringEnabled: false,
      publicEnabled: false,
    });
    assert.deepEqual(
      getDynamicBetaNewsFlags({
        DYNAMIC_BETA_NEWS_DATA_ENABLED: "true",
        DYNAMIC_BETA_NEWS_SCORING_ENABLED: "TRUE",
        DYNAMIC_BETA_NEWS_PUBLIC_ENABLED: "1",
      }),
      { dataEnabled: true, scoringEnabled: false, publicEnabled: false },
    );
  });

  it("validates without performing repository writes", async () => {
    const service = createNewsEventService({
      repository: {
        async saveEvidence() {
          throw new Error("validation must not save evidence");
        },
        async saveMorningBrief() {
          throw new Error("validation must not save a brief");
        },
      },
      now: () => new Date("2026-07-27T23:10:00.000Z"),
    });

    const result = await service.validate(brief());

    assert.equal(result.valid, true);
    assert.equal(result.value.evidence[0].retrievedAt, "2026-07-27T23:10:00.000Z");
  });

  it("saves normalized evidence before the immutable brief snapshot", async () => {
    const calls = [];
    const service = createNewsEventService({
      repository: {
        async findLikelyDuplicates(item) {
          calls.push(`check:${item.evidenceId}`);
          return [];
        },
        async saveEvidence(item) {
          calls.push(`evidence:${item.evidenceId}`);
          return {
            status: "inserted",
            evidenceId: item.evidenceId,
            revisionId: item.revisionId,
            duplicateOfEvidenceId: null,
          };
        },
        async saveMorningBrief(snapshot) {
          calls.push(`brief:${snapshot.briefDate}`);
          return { status: "inserted", revisionId: "nbr_123", revisionNumber: 1 };
        },
      },
      now: () => new Date("2026-07-27T23:10:00.000Z"),
    });

    const result = await service.ingest(brief());

    assert.equal(result.saved, true);
    assert.equal(result.evidence.length, 5);
    assert.ok(calls.indexOf("brief:2026-07-27") > calls.lastIndexOf(`evidence:${result.evidence[4].evidenceId}`));
  });

  it("returns validation errors without writing invalid payloads", async () => {
    let writes = 0;
    const service = createNewsEventService({
      repository: {
        async saveEvidence() { writes += 1; },
        async saveMorningBrief() { writes += 1; },
      },
      now: () => new Date("2026-07-27T23:10:00.000Z"),
    });

    const result = await service.ingest(brief({ events: [] }));

    assert.equal(result.saved, false);
    assert.ok(result.errors.includes("events 必須剛好包含 5 個事件。"));
    assert.equal(writes, 0);
  });
});

describe("dynamic beta news admin template", () => {
  it("produces a valid claim-free five-event payload for the selected date", () => {
    const template = createMorningBriefTemplate(
      "2026-07-28",
      new Date("2026-07-27T23:30:00.000Z"),
    );
    const result = validateMorningBriefPayload(template, {
      now: "2026-07-27T23:30:00.000Z",
    });

    assert.equal(result.valid, true);
    assert.equal(template.briefDate, "2026-07-28");
    assert.equal(template.events.length, 5);
    assert.ok(template.events.every((item) => item.headline.startsWith("請填入")));
  });
});
