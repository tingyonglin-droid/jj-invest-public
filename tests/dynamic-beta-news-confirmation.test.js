import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeConfirmationPersistence,
  evaluateConfirmationRule,
  evaluateEventConfirmation,
  rollupConfirmation,
} from "../src/lib/dynamic-beta/news/confirmation.js";
import {
  createNewsMarketConfirmationService,
} from "../src/lib/dynamic-beta/news/confirmation-service.js";

const priceHistory = [
  { observationDate: "2026-07-24", value: 100 },
  { observationDate: "2026-07-27", value: 97 },
  { observationDate: "2026-07-28", value: 98 },
  { observationDate: "2026-07-29", value: 95 },
];

function rule(overrides = {}) {
  return {
    seriesId: "YAHOO:QQQ",
    expectedDirection: "up",
    changeType: "absolute",
    threshold: 2,
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateConfirmationRule({
    rule: rule(),
    marketDate: "2026-07-27",
    history: [
      { observationDate: "2026-07-24", value: 10 },
      { observationDate: "2026-07-27", value: 12 },
      { observationDate: "2026-07-28", value: 12 },
      { observationDate: "2026-07-29", value: 12 },
    ],
    asOf: "2026-07-29",
    freshnessStatus: "fresh",
    ...overrides,
  });
}

describe("dynamic beta news confirmation evaluator", () => {
  it("selects actual trading observations over a weekend and confirms a down percent move", () => {
    const result = evaluateConfirmationRule({
      rule: rule({
        expectedDirection: "down",
        changeType: "percent",
        threshold: 2,
      }),
      marketDate: "2026-07-27",
      history: priceHistory,
      asOf: "2026-07-29",
      freshnessStatus: "fresh",
    });

    assert.equal(result.baseline.observationDate, "2026-07-24");
    assert.equal(result.d1.observation.observationDate, "2026-07-27");
    assert.equal(result.d3.observation.observationDate, "2026-07-29");
    assert.ok(Math.abs(result.d1.rawMove + 3) < 1e-12);
    assert.equal(result.d1.status, "confirmed");
    assert.ok(Math.abs(result.d3.rawMove + 5) < 1e-12);
    assert.equal(result.d3.status, "confirmed");
  });

  it("calculates absolute VIX-point moves and yield basis-point moves", () => {
    const vix = evaluate({
      rule: rule({ seriesId: "VIXCLS", changeType: "absolute", threshold: 2 }),
      history: [
        { observationDate: "2026-07-24", value: 20 },
        { observationDate: "2026-07-27", value: 22 },
      ],
      asOf: "2026-07-27",
    });
    const yieldMove = evaluate({
      rule: rule({ seriesId: "DGS10", changeType: "basis_points", threshold: 12.5 }),
      history: [
        { observationDate: "2026-07-24", value: 4 },
        { observationDate: "2026-07-27", value: 4.125 },
      ],
      asOf: "2026-07-27",
    });

    assert.equal(vix.d1.rawMove, 2);
    assert.equal(vix.d1.status, "confirmed");
    assert.equal(yieldMove.d1.rawMove, 12.5);
    assert.equal(yieldMove.d1.status, "confirmed");
  });

  it("treats inclusive positive and negative thresholds as directional outcomes", () => {
    const atPositiveBoundary = evaluate();
    const atNegativeBoundary = evaluate({
      history: [
        { observationDate: "2026-07-24", value: 10 },
        { observationDate: "2026-07-27", value: 8 },
      ],
      asOf: "2026-07-27",
    });

    assert.equal(atPositiveBoundary.d1.status, "confirmed");
    assert.equal(atNegativeBoundary.d1.status, "reverse");
  });

  it("leaves an interior move unconfirmed", () => {
    const interior = evaluate({
      history: [
        { observationDate: "2026-07-24", value: 10 },
        { observationDate: "2026-07-27", value: 11 },
      ],
      asOf: "2026-07-27",
    });

    assert.equal(interior.d1.status, "unconfirmed");
  });

  it("reports non-calculable percent moves and absent baselines as insufficient data", () => {
    const zeroBaseline = evaluate({
      rule: rule({ changeType: "percent" }),
      history: [
        { observationDate: "2026-07-24", value: 0 },
        { observationDate: "2026-07-27", value: 10 },
      ],
      asOf: "2026-07-27",
    });
    const missingBaseline = evaluate({
      history: [{ observationDate: "2026-07-27", value: 12 }],
      asOf: "2026-07-27",
    });

    assert.equal(zeroBaseline.d1.status, "insufficient_data");
    assert.equal(missingBaseline.d1.status, "insufficient_data");
  });

  it("keeps an incomplete D3 window observing only while its source remains fresh", () => {
    const input = {
      history: [
        { observationDate: "2026-07-24", value: 10 },
        { observationDate: "2026-07-27", value: 12 },
        { observationDate: "2026-07-28", value: 12 },
      ],
      asOf: "2026-07-28",
    };
    const freshIncomplete = evaluate({ ...input, freshnessStatus: "fresh" });
    const staleIncomplete = evaluate({ ...input, freshnessStatus: "stale" });

    assert.equal(freshIncomplete.d3.status, "observing");
    assert.equal(staleIncomplete.d3.status, "insufficient_data");
  });

  it("excludes observations later than asOf", () => {
    const result = evaluate({
      history: [
        { observationDate: "2026-07-24", value: 10 },
        { observationDate: "2026-07-27", value: 12 },
      ],
      asOf: "2026-07-26",
    });

    assert.equal(result.baseline.observationDate, "2026-07-24");
    assert.equal(result.d1.observation, null);
    assert.equal(result.d1.status, "observing");
  });

  it("keeps missing observations in observing while freshness is delayed", () => {
    const result = evaluate({
      history: [{ observationDate: "2026-07-24", value: 10 }],
      asOf: "2026-07-27",
      freshnessStatus: "delayed",
    });

    assert.equal(result.d1.status, "observing");
    assert.equal(result.d1.reason, "awaiting_observation");
    assert.equal(result.d3.status, "observing");
  });

  it("rejects non-daily catalog rules through event evaluation", () => {
    const result = evaluateEventConfirmation({
      event: {
        rank: 1,
        headline: "Monthly macro release",
        dataToConfirm: ["UNRATE"],
        confirmationRules: [rule({ seriesId: "UNRATE" })],
      },
      briefDate: "2026-07-27",
      histories: {
        UNRATE: [
          { observationDate: "2026-06-01", value: 4 },
          { observationDate: "2026-07-01", value: 4.1 },
        ],
      },
      freshnessBySeries: { UNRATE: "fresh" },
      asOf: "2026-07-29",
    });

    assert.equal(result.rules[0].d1.status, "insufficient_data");
    assert.equal(result.rules[0].d1.reason, "unsupported_frequency");
  });

  it("describes each comparable D1 and D3 persistence state", () => {
    assert.equal(describeConfirmationPersistence("confirmed", "confirmed"), "sustained");
    assert.equal(describeConfirmationPersistence("confirmed", "unconfirmed"), "faded");
    assert.equal(describeConfirmationPersistence("confirmed", "reverse"), "reversed");
    assert.equal(describeConfirmationPersistence("unconfirmed", "confirmed"), "emerged_late");
    assert.equal(describeConfirmationPersistence("unconfirmed", "unconfirmed"), "unchanged");
  });

  it("uses an unweighted majority and marks incomplete rollups provisional", () => {
    const rollup = rollupConfirmation([
      { d1: { status: "confirmed" } },
      { d1: { status: "confirmed" } },
      { d1: { status: "unconfirmed" } },
      { d1: { status: "observing" } },
    ], "d1");

    assert.equal(rollup.status, "confirmed");
    assert.equal(rollup.requiredMajority, 2);
    assert.equal(rollup.isFinal, false);
  });

  it("keeps split signals, pending rules, and legacy-only data distinct", () => {
    const split = rollupConfirmation([
      { d1: { status: "confirmed" } },
      { d1: { status: "reverse" } },
    ], "d1");
    const observing = rollupConfirmation([{ d1: { status: "observing" } }], "d1");
    const legacy = evaluateEventConfirmation({
      event: {
        rank: 2,
        headline: "Legacy event",
        dataToConfirm: ["YAHOO:QQQ"],
        confirmationRules: [],
      },
      briefDate: "2026-07-27",
      histories: {},
      freshnessBySeries: {},
      asOf: "2026-07-27",
    });

    assert.equal(split.status, "unconfirmed");
    assert.equal(split.reason, "split_signals");
    assert.equal(observing.status, "observing");
    assert.equal(observing.requiredMajority, 1);
    assert.equal(legacy.rules[0].d1.status, "not_configured");
    assert.equal(legacy.d1.status, "not_configured");
  });
});

function confirmationEvent(rank, overrides = {}) {
  return {
    rank,
    headline: `Confirmation event ${rank}`,
    marketDate: "2026-07-27",
    dataToConfirm: ["YAHOO:QQQ", "DGS10"],
    confirmationRules: [
      {
        seriesId: "YAHOO:QQQ",
        expectedDirection: "down",
        changeType: "percent",
        threshold: 2,
      },
      {
        seriesId: "DGS10",
        expectedDirection: "up",
        changeType: "basis_points",
        threshold: 10,
      },
    ],
    ...overrides,
  };
}

function confirmationBrief(overrides = {}) {
  return {
    briefDate: "2026-07-27",
    revisionId: "nbr_current",
    revisionNumber: 2,
    events: Array.from({ length: 5 }, (_, index) => confirmationEvent(index + 1)),
    ...overrides,
  };
}

describe("dynamic beta news market confirmation service", () => {
  it("selects the latest brief, deduplicates series reads, and exposes vintage metadata", async () => {
    const calls = [];
    const structuredBrief = confirmationBrief();
    const histories = {
      "YAHOO:QQQ": [
        { observationDate: "2026-07-24", value: 100 },
        { observationDate: "2026-07-27", value: 97 },
        { observationDate: "2026-07-28", value: 98 },
        { observationDate: "2026-07-29", value: 95 },
      ],
      DGS10: [
        { observationDate: "2026-07-24", value: 4 },
        { observationDate: "2026-07-27", value: 4.15 },
        { observationDate: "2026-07-28", value: 4.14 },
        { observationDate: "2026-07-29", value: 4.2 },
      ],
    };
    const service = createNewsMarketConfirmationService({
      newsRepository: {
        readRecentBriefs: async () => [structuredBrief],
        readMorningBrief: async () => structuredBrief,
      },
      marketRepository: {
        readObservationHistory: async (seriesId, range) => {
          calls.push({ seriesId, range });
          return histories[seriesId] || [];
        },
      },
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    const result = await service.evaluate({ asOf: "2026-07-29" });

    assert.equal(result.briefDate, structuredBrief.briefDate);
    assert.equal(result.revisionId, "nbr_current");
    assert.equal(result.revisionNumber, 2);
    assert.equal(result.events.length, 5);
    assert.deepEqual(calls, [
      { seriesId: "YAHOO:QQQ", range: { from: "2026-07-17", to: "2026-07-29" } },
      { seriesId: "DGS10", range: { from: "2026-07-17", to: "2026-07-29" } },
    ]);
    assert.equal(new Set(calls.map((item) => item.seriesId)).size, calls.length);
    assert.equal(result.metadata.vintageMode, "latest_stored_revision_by_observation_date");
    assert.equal(result.metadata.truePointInTime, false);
  });

  it("reads an exact dated revision instead of the recent-brief timeline", async () => {
    const selected = confirmationBrief({ revisionId: "nbr_original", revisionNumber: 1 });
    const briefReads = [];
    let recentReads = 0;
    const service = createNewsMarketConfirmationService({
      newsRepository: {
        async readMorningBrief(query) {
          briefReads.push(query);
          return selected;
        },
        async readRecentBriefs() {
          recentReads += 1;
          return [confirmationBrief()];
        },
      },
      marketRepository: {
        async readObservationHistory() {
          return [
            { observationDate: "2026-07-24", value: 100 },
            { observationDate: "2026-07-27", value: 99 },
          ];
        },
      },
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    const result = await service.evaluate({
      briefDate: "2026-07-27",
      revisionId: "nbr_original",
      asOf: "2026-07-29",
    });

    assert.deepEqual(briefReads, [{ briefDate: "2026-07-27", revisionId: "nbr_original" }]);
    assert.equal(recentReads, 0);
    assert.equal(result.revisionId, "nbr_original");
    assert.equal(result.revisionNumber, 1);
  });

  it("keeps a future market date observing", async () => {
    const futureBrief = confirmationBrief({
      events: [confirmationEvent(1, {
        marketDate: "2026-07-30",
        dataToConfirm: ["YAHOO:QQQ"],
        confirmationRules: [{
          seriesId: "YAHOO:QQQ",
          expectedDirection: "down",
          changeType: "percent",
          threshold: 2,
        }],
      })],
    });
    const service = createNewsMarketConfirmationService({
      newsRepository: { readRecentBriefs: async () => [futureBrief] },
      marketRepository: {
        readObservationHistory: async () => [
          { observationDate: "2026-07-29", value: 100 },
        ],
      },
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    const result = await service.evaluate({ asOf: "2026-07-29" });

    assert.equal(result.events[0].marketDate, "2026-07-30");
    assert.equal(result.events[0].d1.status, "observing");
    assert.equal(result.events[0].d3.status, "observing");
  });

  it("retries once with a wider range only when the initial history lacks a baseline", async () => {
    const calls = [];
    const selected = confirmationBrief({
      events: [confirmationEvent(1, {
        dataToConfirm: ["YAHOO:QQQ"],
        confirmationRules: [{
          seriesId: "YAHOO:QQQ",
          expectedDirection: "down",
          changeType: "percent",
          threshold: 2,
        }],
      })],
    });
    const service = createNewsMarketConfirmationService({
      newsRepository: { readRecentBriefs: async () => [selected] },
      marketRepository: {
        async readObservationHistory(seriesId, range) {
          calls.push({ seriesId, range });
          return range.from === "2026-07-17"
            ? [{ observationDate: "2026-07-27", value: 97 }]
            : [
                { observationDate: "2026-07-11", value: 100 },
                { observationDate: "2026-07-27", value: 97 },
              ];
        },
      },
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    const result = await service.evaluate({ asOf: "2026-07-29" });

    assert.deepEqual(calls, [
      { seriesId: "YAHOO:QQQ", range: { from: "2026-07-17", to: "2026-07-29" } },
      { seriesId: "YAHOO:QQQ", range: { from: "2026-06-12", to: "2026-07-29" } },
    ]);
    assert.equal(result.events[0].rules[0].baseline.observationDate, "2026-07-11");
  });

  it("rejects invalid dates and revision IDs without a brief date", async () => {
    const service = createNewsMarketConfirmationService({
      newsRepository: { readRecentBriefs: async () => [] },
      marketRepository: { readObservationHistory: async () => [] },
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await assert.rejects(
      service.evaluate({ asOf: "2026-02-30" }),
      (error) => error.code === "INVALID_DATE",
    );
    await assert.rejects(
      service.evaluate({ briefDate: "July 27, 2026" }),
      (error) => error.code === "INVALID_DATE",
    );
    await assert.rejects(
      service.evaluate({ revisionId: "nbr_original" }),
      (error) => error.code === "INVALID_QUERY",
    );
  });

  it("reports a stable missing-brief error", async () => {
    const service = createNewsMarketConfirmationService({
      newsRepository: { readRecentBriefs: async () => [] },
      marketRepository: { readObservationHistory: async () => [] },
      now: () => new Date("2026-07-29T12:00:00.000Z"),
    });

    await assert.rejects(
      service.evaluate(),
      (error) => error.code === "MISSING_BRIEF",
    );
  });

  it("rejects an invalid service clock", async () => {
    const service = createNewsMarketConfirmationService({
      newsRepository: { readRecentBriefs: async () => [] },
      marketRepository: { readObservationHistory: async () => [] },
      now: () => new Date("invalid"),
    });

    await assert.rejects(
      service.evaluate(),
      (error) => error.code === "INVALID_DATE",
    );
  });

  it("rejects either missing repository with one stable configuration error", async () => {
    const configurations = [
      { newsRepository: null, marketRepository: {} },
      { newsRepository: {}, marketRepository: null },
    ];

    for (const configuration of configurations) {
      const service = createNewsMarketConfirmationService(configuration);
      await assert.rejects(
        service.evaluate(),
        (error) => error.code === "UNCONFIGURED_REPOSITORY",
      );
    }
  });
});
