import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildConfirmationSnapshot,
  ConfirmationSnapshotError,
  confirmationSnapshotId,
  isConfirmationSnapshotComplete,
  parseStoredConfirmationSnapshot,
} from "../src/lib/dynamic-beta/news/confirmation-snapshot.js";
import { createConfirmationSnapshotService } from "../src/lib/dynamic-beta/news/confirmation-snapshot-service.js";

const CREATED_AT = "2026-07-29T23:00:10.000Z";

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
  );
}

function withContentHash(snapshot) {
  return {
    ...snapshot,
    snapshotId: confirmationSnapshotId({
      briefDate: snapshot.briefDate,
      revisionId: snapshot.revisionId,
      revisionNumber: snapshot.revisionNumber,
      asOf: snapshot.asOf,
      metadata: snapshot.metadata,
      completion: snapshot.completion,
      events: snapshot.events,
    }),
  };
}

function d3Row() {
  return {
    observationDate: "2026-07-29",
    value: 103,
    revisionId: "obs_qqq_r7",
    releasedAt: "2026-07-29T19:00:00.000Z",
    retrievedAt: "2026-07-29T20:05:00.000Z",
    firstSeenAt: "2026-07-29T20:05:00.000Z",
    lastSeenAt: "2026-07-29T20:05:00.000Z",
    sourceRealtimeStart: null,
    sourceRealtimeEnd: null,
  };
}

function rule(overrides = {}) {
  return {
    seriesId: "YAHOO:QQQ",
    expectedDirection: "up",
    changeType: "percent",
    threshold: 2,
    baseline: { observationDate: "2026-07-24", value: 100 },
    d1: { status: "confirmed", observation: d3Row(), rawMove: 3, normalizedMove: 3, reason: null },
    d3: { status: "confirmed", observation: d3Row(), rawMove: 3, normalizedMove: 3, reason: null },
    persistence: "sustained",
    ...overrides,
  };
}

function evaluation(rules) {
  return {
    briefDate: "2026-07-27",
    revisionId: "nbr_current",
    revisionNumber: 2,
    asOf: "2026-07-29",
    evaluatedAt: "2026-07-29T22:00:00.000Z",
    events: [{
      rank: 1,
      headline: "Confirmation event",
      marketDate: "2026-07-27",
      rules,
      d1: { status: "confirmed", reason: "majority_confirmed" },
      d3: { status: "confirmed", reason: "majority_confirmed" },
      persistence: "sustained",
    }],
  };
}

function brief({ briefDate, revisionId, revisionNumber }) {
  return { briefDate, revisionId, revisionNumber, events: [] };
}

function serviceEvaluation({ briefDate, revisionId, revisionNumber, asOf, complete = true }) {
  return {
    ...evaluation([rule({
      d3: complete
        ? { status: "confirmed", observation: d3Row(), rawMove: 3, normalizedMove: 3, reason: null }
        : { status: "observing", observation: null, rawMove: null, normalizedMove: null, reason: "awaiting_observation" },
    })]),
    briefDate,
    revisionId,
    revisionNumber,
    asOf,
  };
}

function storedSnapshot({ briefDate, revisionId, revisionNumber, asOf, complete }) {
  return buildConfirmationSnapshot({
    evaluation: serviceEvaluation({ briefDate, revisionId, revisionNumber, asOf, complete }),
    createdAt: CREATED_AT,
  });
}

describe("dynamic beta confirmation snapshots", () => {
  it("keeps D3 observation gaps pending", () => {
    const awaitingD3Evaluation = evaluation([
      rule({ d3: { status: "observing", observation: null, rawMove: null, normalizedMove: null, reason: "awaiting_observation" } }),
    ]);

    assert.deepEqual(
      buildConfirmationSnapshot({ evaluation: awaitingD3Evaluation, createdAt: CREATED_AT }).completion,
      {
        complete: false,
        pendingReasons: [{
          eventRank: 1,
          seriesId: "YAHOO:QQQ",
          reason: "awaiting_observation",
        }],
      },
    );
  });

  it("treats configured, structurally unavailable, and observed D3 rules as terminal", () => {
    const snapshot = buildConfirmationSnapshot({
      evaluation: evaluation([
        rule({ expectedDirection: null, d3: { observation: null, reason: "not_configured" } }),
        rule({ expectedDirection: "down", d3: { observation: null, reason: "unknown_series" } }),
        rule({ expectedDirection: "up", d3: { observation: null, reason: "unsupported_frequency" } }),
        rule({ expectedDirection: "up", d3: { observation: d3Row(), reason: "invalid_baseline" } }),
      ]),
      createdAt: CREATED_AT,
    });

    assert.deepEqual(snapshot.completion, { complete: true, pendingReasons: [] });
  });

  for (const reason of ["missing_observation", "missing_baseline", "awaiting_observation"]) {
    it(`keeps ${reason} without a D3 observation pending`, () => {
      const snapshot = buildConfirmationSnapshot({
        evaluation: evaluation([rule({ d3: { observation: null, reason } })]),
        createdAt: CREATED_AT,
      });

      assert.deepEqual(snapshot.completion, {
        complete: false,
        pendingReasons: [{ eventRank: 1, seriesId: "YAHOO:QQQ", reason }],
      });
    });
  }
});

describe("canonical confirmation snapshot content", () => {
  it("keeps immutable identity separate from evaluation and creation timestamps", () => {
    const base = evaluation([rule()]);
    const first = buildConfirmationSnapshot({ evaluation: base, createdAt: CREATED_AT });
    const second = buildConfirmationSnapshot({
      evaluation: { ...base, evaluatedAt: "2026-07-29T22:30:00.000Z" },
      createdAt: "2026-07-29T23:30:00.000Z",
    });
    const changedObservation = buildConfirmationSnapshot({
      evaluation: evaluation([rule({ d3: { ...rule().d3, observation: { ...d3Row(), revisionId: "obs_qqq_r8" } } })]),
      createdAt: CREATED_AT,
    });

    assert.equal(first.snapshotId, second.snapshotId);
    assert.notEqual(first.snapshotId, changedObservation.snapshotId);
    assert.equal(first.metadata.vintageMode, "latest_stored_revision_by_observation_date");
    assert.equal(first.metadata.truePointInTime, false);
    assert.equal(first.events[0].rules[0].d3.observation.revisionId, "obs_qqq_r7");
    assert.equal(first.events[0].rules[0].d3.observation.retrievedAt, "2026-07-29T20:05:00.000Z");
    assert.equal(first.snapshotRevisionNumber, null);
    assert.equal(first.evaluatedAt, base.evaluatedAt);
    assert.equal(first.createdAt, CREATED_AT);
    assert.equal(first.snapshotId, confirmationSnapshotId({
      briefDate: first.briefDate,
      revisionId: first.revisionId,
      revisionNumber: first.revisionNumber,
      asOf: first.asOf,
      metadata: first.metadata,
      completion: first.completion,
      events: first.events,
    }));
  });

  it("normalizes omitted optional result and observation values to null", () => {
    const snapshot = buildConfirmationSnapshot({
      evaluation: evaluation([rule({
        baseline: undefined,
        d1: { status: "observing" },
        d3: { status: "observing" },
      })]),
      createdAt: CREATED_AT,
    });

    assert.deepEqual(snapshot.events[0].rules[0], {
      seriesId: "YAHOO:QQQ",
      expectedDirection: "up",
      changeType: "percent",
      threshold: 2,
      baseline: null,
      d1: { status: "observing", observation: null, rawMove: null, normalizedMove: null, reason: null },
      d3: { status: "observing", observation: null, rawMove: null, normalizedMove: null, reason: null },
      persistence: "sustained",
    });
  });

  it("parses only committed and well-formed stored snapshots", () => {
    const snapshot = buildConfirmationSnapshot({ evaluation: evaluation([rule()]), createdAt: CREATED_AT });
    const payload = JSON.stringify(snapshot);
    const tampered = { ...snapshot, snapshotId: "ncs_tampered" };

    assert.equal(parseStoredConfirmationSnapshot({ payload, committed: "0" }), null);
    assert.equal(parseStoredConfirmationSnapshot({ payload: "not json", committed: "1" }), null);
    assert.equal(parseStoredConfirmationSnapshot({ payload: "{}", committed: "1" }), null);
    assert.equal(parseStoredConfirmationSnapshot({ payload: JSON.stringify(tampered), committed: "1" }), null);
    assert.deepEqual(parseStoredConfirmationSnapshot({ payload, committed: "1" }), snapshot);
  });

  // Mutation caught: hashing or comparing stored JSON in transport key order.
  it("accepts a valid stored snapshot after top-level and nested object keys are reordered", () => {
    const snapshot = buildConfirmationSnapshot({ evaluation: evaluation([rule()]), createdAt: CREATED_AT });
    const reordered = reverseObjectKeys(snapshot);

    assert.deepEqual(
      parseStoredConfirmationSnapshot({
        payload: JSON.stringify(reordered),
        committed: "1",
      }),
      snapshot,
    );
  });

  // Mutation caught: accepting normalized events or completion objects that carry unknown fields.
  it("rejects extra event and completion fields even when their content hash is recomputed", () => {
    const snapshot = buildConfirmationSnapshot({ evaluation: evaluation([rule()]), createdAt: CREATED_AT });
    const extraEvent = withContentHash({
      ...snapshot,
      events: [{ ...snapshot.events[0], unexpected: "field" }],
    });
    const extraCompletion = withContentHash({
      ...snapshot,
      completion: { ...snapshot.completion, unexpected: "field" },
    });

    assert.equal(
      parseStoredConfirmationSnapshot({
        payload: JSON.stringify(reverseObjectKeys(extraEvent)),
        committed: "1",
      }),
      null,
    );
    assert.equal(
      parseStoredConfirmationSnapshot({
        payload: JSON.stringify(reverseObjectKeys(extraCompletion)),
        committed: "1",
      }),
      null,
    );
  });

  it("round-trips every built snapshot when an optional rule field is omitted", () => {
    const snapshot = buildConfirmationSnapshot({
      evaluation: evaluation([rule({
        expectedDirection: undefined,
        d3: { observation: null, reason: "missing_observation" },
      })]),
      createdAt: CREATED_AT,
    });

    assert.deepEqual(
      parseStoredConfirmationSnapshot({ payload: JSON.stringify(snapshot), committed: "1" }),
      snapshot,
    );
  });

  it("rejects invalid snapshot timestamps with stable error codes", () => {
    assert.throws(
      () => buildConfirmationSnapshot({ evaluation: { ...evaluation([rule()]), asOf: "2026-07-32" }, createdAt: CREATED_AT }),
      (error) => error instanceof ConfirmationSnapshotError && error.code === "INVALID_AS_OF",
    );
    assert.throws(
      () => buildConfirmationSnapshot({ evaluation: evaluation([rule()]), createdAt: "not a timestamp" }),
      (error) => error instanceof ConfirmationSnapshotError && error.code === "INVALID_CREATED_AT",
    );
  });

  it("requires an exact brief identity with a stable error code", () => {
    for (const identity of [
      { briefDate: null },
      { revisionId: "" },
      { revisionNumber: null },
    ]) {
      assert.throws(
        () => buildConfirmationSnapshot({ evaluation: { ...evaluation([rule()]), ...identity }, createdAt: CREATED_AT }),
        (error) => error instanceof ConfirmationSnapshotError && error.code === "IDENTITY_MISMATCH",
      );
    }
  });

  it("reports only explicitly complete snapshots as complete", () => {
    assert.equal(isConfirmationSnapshotComplete({ completion: { complete: true } }), true);
    assert.equal(isConfirmationSnapshotComplete({ completion: { complete: false } }), false);
    assert.equal(isConfirmationSnapshotComplete(null), false);
  });
});

describe("recent confirmation snapshot service", () => {
  it("selects each exact recent revision in deterministic order and skips only complete snapshots", async () => {
    const recent = [
      brief({ briefDate: "2026-07-18", revisionId: "r18", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-29", revisionId: "r29", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-19", revisionId: "r19", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-20", revisionId: "r20", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-21", revisionId: "r21", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-22", revisionId: "r22", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-23", revisionId: "r23", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-24", revisionId: "r24", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-25", revisionId: "r25", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-26", revisionId: "r26", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-27", revisionId: "r27b", revisionNumber: 2 }),
      brief({ briefDate: "2026-07-27", revisionId: "r27a", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-28", revisionId: "r28", revisionNumber: 1 }),
    ];
    const evaluated = [];
    const saved = [];
    const complete = storedSnapshot({
      briefDate: "2026-07-20", revisionId: "r20", revisionNumber: 1, asOf: "2026-07-29", complete: true,
    });
    const incomplete = storedSnapshot({
      briefDate: "2026-07-21", revisionId: "r21", revisionNumber: 1, asOf: "2026-07-29", complete: false,
    });
    const snapshots = new Map([
      ["2026-07-20:r20", complete],
      ["2026-07-21:r21", incomplete],
    ]);
    const service = createConfirmationSnapshotService({
      newsRepository: { readRecentBriefs: async ({ limit }) => { assert.equal(limit, 200); return recent; } },
      confirmationService: {
        evaluate: async (identity) => {
          evaluated.push(identity);
          const matched = recent.find((candidate) => candidate.briefDate === identity.briefDate
            && candidate.revisionId === identity.revisionId);
          return serviceEvaluation({ ...matched, asOf: identity.asOf });
        },
      },
      snapshotRepository: {
        readLatestSnapshot: async ({ briefDate, revisionId }) => snapshots.get(`${briefDate}:${revisionId}`) || null,
        saveSnapshot: async (snapshot) => { saved.push(snapshot); return { status: "inserted", snapshotId: snapshot.snapshotId, snapshotRevisionNumber: 1 }; },
      },
      now: () => new Date(CREATED_AT),
    });

    const result = await service.run({ asOf: "2026-07-29", lookbackDays: 10 });

    assert.deepEqual(evaluated.map(({ briefDate, revisionId, asOf }) => ({ briefDate, revisionId, asOf })), [
      { briefDate: "2026-07-19", revisionId: "r19", asOf: "2026-07-29" },
      { briefDate: "2026-07-21", revisionId: "r21", asOf: "2026-07-29" },
      { briefDate: "2026-07-22", revisionId: "r22", asOf: "2026-07-29" },
      { briefDate: "2026-07-23", revisionId: "r23", asOf: "2026-07-29" },
      { briefDate: "2026-07-24", revisionId: "r24", asOf: "2026-07-29" },
      { briefDate: "2026-07-25", revisionId: "r25", asOf: "2026-07-29" },
      { briefDate: "2026-07-26", revisionId: "r26", asOf: "2026-07-29" },
      { briefDate: "2026-07-27", revisionId: "r27a", asOf: "2026-07-29" },
      { briefDate: "2026-07-27", revisionId: "r27b", asOf: "2026-07-29" },
      { briefDate: "2026-07-28", revisionId: "r28", asOf: "2026-07-29" },
      { briefDate: "2026-07-29", revisionId: "r29", asOf: "2026-07-29" },
    ]);
    assert.equal(saved.length, 11);
    assert.deepEqual(result, {
      status: "success",
      selected: 12,
      skippedComplete: 1,
      inserted: 11,
      revised: 0,
      unchanged: 0,
      failed: 0,
      results: [
        { briefDate: "2026-07-19", revisionId: "r19", status: "inserted" },
        { briefDate: "2026-07-20", revisionId: "r20", status: "skipped_complete" },
        { briefDate: "2026-07-21", revisionId: "r21", status: "inserted" },
        { briefDate: "2026-07-22", revisionId: "r22", status: "inserted" },
        { briefDate: "2026-07-23", revisionId: "r23", status: "inserted" },
        { briefDate: "2026-07-24", revisionId: "r24", status: "inserted" },
        { briefDate: "2026-07-25", revisionId: "r25", status: "inserted" },
        { briefDate: "2026-07-26", revisionId: "r26", status: "inserted" },
        { briefDate: "2026-07-27", revisionId: "r27a", status: "inserted" },
        { briefDate: "2026-07-27", revisionId: "r27b", status: "inserted" },
        { briefDate: "2026-07-28", revisionId: "r28", status: "inserted" },
        { briefDate: "2026-07-29", revisionId: "r29", status: "inserted" },
      ],
    });
  });

  it("re-evaluates incomplete snapshots, isolates safe failures, and never writes a mismatched identity", async () => {
    const recent = [
      brief({ briefDate: "2026-07-25", revisionId: "incomplete", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-26", revisionId: "complete", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-27", revisionId: "evaluator-fails", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-28", revisionId: "mismatch", revisionNumber: 1 }),
      brief({ briefDate: "2026-07-29", revisionId: "succeeds", revisionNumber: 1 }),
    ];
    const evaluated = [];
    const saved = [];
    const logged = [];
    const snapshots = new Map([
      ["2026-07-25:incomplete", storedSnapshot({
        briefDate: "2026-07-25", revisionId: "incomplete", revisionNumber: 1, asOf: "2026-07-29", complete: false,
      })],
      ["2026-07-26:complete", storedSnapshot({
        briefDate: "2026-07-26", revisionId: "complete", revisionNumber: 1, asOf: "2026-07-29", complete: true,
      })],
    ]);
    const service = createConfirmationSnapshotService({
      newsRepository: { readRecentBriefs: async () => recent },
      confirmationService: {
        evaluate: async (identity) => {
          evaluated.push(identity);
          if (identity.revisionId === "evaluator-fails") throw new Error("FRED_API_KEY=secret");
          if (identity.revisionId === "mismatch") {
            return serviceEvaluation({
              briefDate: identity.briefDate,
              revisionId: "wrong-revision",
              revisionNumber: 1,
              asOf: identity.asOf,
            });
          }
          const selected = recent.find((candidate) => candidate.revisionId === identity.revisionId);
          return serviceEvaluation({ ...selected, asOf: identity.asOf, complete: true });
        },
      },
      snapshotRepository: {
        readLatestSnapshot: async ({ briefDate, revisionId }) => snapshots.get(`${briefDate}:${revisionId}`) || null,
        saveSnapshot: async (snapshot) => { saved.push(snapshot); return { status: "inserted", snapshotId: snapshot.snapshotId, snapshotRevisionNumber: 1 }; },
      },
      now: () => new Date(CREATED_AT),
      logger: { error: (...args) => logged.push(args) },
    });

    const result = await service.run({ asOf: "2026-07-29", lookbackDays: 10 });

    assert.deepEqual(evaluated.map(({ revisionId }) => revisionId), [
      "incomplete", "evaluator-fails", "mismatch", "succeeds",
    ]);
    assert.equal(saved.length, 2);
    assert.equal(saved[0].briefDate, "2026-07-25");
    assert.equal(saved[0].completion.complete, true);
    assert.deepEqual(result, {
      status: "partial",
      selected: 5,
      skippedComplete: 1,
      inserted: 2,
      revised: 0,
      unchanged: 0,
      failed: 2,
      results: [
        { briefDate: "2026-07-25", revisionId: "incomplete", status: "inserted" },
        { briefDate: "2026-07-26", revisionId: "complete", status: "skipped_complete" },
        { briefDate: "2026-07-27", revisionId: "evaluator-fails", status: "error", code: "EVALUATION_FAILED" },
        { briefDate: "2026-07-28", revisionId: "mismatch", status: "error", code: "IDENTITY_MISMATCH" },
        { briefDate: "2026-07-29", revisionId: "succeeds", status: "inserted" },
      ],
    });
    assert.doesNotMatch(JSON.stringify({ result, logged }), /FRED_API_KEY=secret/);
  });

  it("uses a fixed snapshot-save code when a write fails", async () => {
    const service = createConfirmationSnapshotService({
      newsRepository: {
        readRecentBriefs: async () => [brief({ briefDate: "2026-07-29", revisionId: "write-fails", revisionNumber: 1 })],
      },
      confirmationService: {
        evaluate: async ({ briefDate, revisionId, asOf }) => serviceEvaluation({
          briefDate, revisionId, revisionNumber: 1, asOf,
        }),
      },
      snapshotRepository: {
        readLatestSnapshot: async () => null,
        saveSnapshot: async () => { throw new Error("FRED_API_KEY=secret"); },
      },
      now: () => new Date(CREATED_AT),
    });

    const result = await service.run({ asOf: "2026-07-29" });

    assert.deepEqual(result, {
      status: "error",
      selected: 1,
      skippedComplete: 0,
      inserted: 0,
      revised: 0,
      unchanged: 0,
      failed: 1,
      results: [{
        briefDate: "2026-07-29",
        revisionId: "write-fails",
        status: "error",
        code: "SNAPSHOT_SAVE_FAILED",
      }],
    });
  });

  it("rejects invalid as-of values and non-integer lookback windows", async () => {
    const service = createConfirmationSnapshotService({
      newsRepository: { readRecentBriefs: async () => [] },
      confirmationService: {},
      snapshotRepository: {},
    });

    await assert.rejects(
      service.run({ asOf: "2026-07-32" }),
      (error) => error.code === "INVALID_AS_OF",
    );
    await assert.rejects(
      service.run({ asOf: "2026-07-29", lookbackDays: 1.5 }),
      (error) => error.code === "INVALID_LOOKBACK_DAYS",
    );
    await assert.rejects(
      service.run({ asOf: "2026-07-29", lookbackDays: 31 }),
      (error) => error.code === "INVALID_LOOKBACK_DAYS",
    );
  });

  it("uses a fixed error when recent brief selection fails", async () => {
    const logged = [];
    const service = createConfirmationSnapshotService({
      newsRepository: { readRecentBriefs: async () => { throw new Error("FRED_API_KEY=secret"); } },
      confirmationService: {},
      snapshotRepository: {},
      logger: { error: (...args) => logged.push(args) },
    });

    await assert.rejects(
      service.run({ asOf: "2026-07-29" }),
      (error) => error.code === "BRIEF_READ_FAILED" && error.message === "BRIEF_READ_FAILED",
    );
    assert.doesNotMatch(JSON.stringify(logged), /FRED_API_KEY=secret/);
  });
});
