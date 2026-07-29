import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildConfirmationSnapshot,
  ConfirmationSnapshotError,
  confirmationSnapshotId,
  isConfirmationSnapshotComplete,
  parseStoredConfirmationSnapshot,
} from "../src/lib/dynamic-beta/news/confirmation-snapshot.js";

const CREATED_AT = "2026-07-29T23:00:10.000Z";

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

    assert.equal(parseStoredConfirmationSnapshot({ payload, committed: "0" }), null);
    assert.equal(parseStoredConfirmationSnapshot({ payload: "not json", committed: "1" }), null);
    assert.deepEqual(parseStoredConfirmationSnapshot({ payload, committed: "1" }), snapshot);
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

  it("reports only explicitly complete snapshots as complete", () => {
    assert.equal(isConfirmationSnapshotComplete({ completion: { complete: true } }), true);
    assert.equal(isConfirmationSnapshotComplete({ completion: { complete: false } }), false);
    assert.equal(isConfirmationSnapshotComplete(null), false);
  });
});
