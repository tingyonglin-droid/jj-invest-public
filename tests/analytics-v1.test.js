import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANALYTICS_V1_EVENT_NAMES,
  ANALYTICS_V1_TRACKING_VERSION,
  createAnalyticsEvent,
  createAnalyticsRetentionSummary,
  createSessionState,
  getAnalyticsAppVersion,
  getHoldingCountBucket,
  sanitizeAnalyticsEventPayload,
} from "../src/lib/analytics-v1.js";

test("creates or resumes sessions with a 30 minute inactivity timeout", () => {
  const appVersion = getAnalyticsAppVersion("");
  const existing = {
    sessionId: "session-1",
    lastActivityAt: "2026-07-23T01:00:00.000Z",
  };

  assert.deepEqual(
    createSessionState({
      currentSession: existing,
      now: new Date("2026-07-23T01:29:59.000Z"),
      appVersion,
      createId: () => "unused",
    }),
    {
      appVersion: "dev",
      lastActivityAt: "2026-07-23T01:29:59.000Z",
      sessionId: "session-1",
      shouldCreate: false,
      trackingVersion: ANALYTICS_V1_TRACKING_VERSION,
    },
  );

  assert.deepEqual(
    createSessionState({
      currentSession: existing,
      now: new Date("2026-07-23T01:30:01.000Z"),
      appVersion,
      createId: () => "session-2",
    }),
    {
      appVersion: "dev",
      lastActivityAt: "2026-07-23T01:30:01.000Z",
      sessionId: "session-2",
      shouldCreate: true,
      trackingVersion: ANALYTICS_V1_TRACKING_VERSION,
    },
  );
});

test("accepts only whitelisted analytics events and safe properties", () => {
  assert.deepEqual(ANALYTICS_V1_EVENT_NAMES, [
    "beta_calculated",
    "holding_added",
    "holding_deleted",
  ]);

  assert.deepEqual(
    sanitizeAnalyticsEventPayload({
      eventName: "holding_added",
      properties: {
        asset_type: "leveraged",
        market: "TW",
        ticker: "00631L",
      },
    }),
    {
      eventName: "holding_added",
      properties: {
        asset_type: "leveraged",
        market: "TW",
      },
    },
  );

  assert.equal(
    sanitizeAnalyticsEventPayload({
      eventName: "portfolio_saved",
      properties: {},
    }),
    null,
  );
});

test("creates events with stable idempotency metadata", () => {
  assert.deepEqual(
    createAnalyticsEvent({
      anonymousId: "device-1234567890",
      sessionId: "session-1234567890",
      eventName: "beta_calculated",
      eventId: "event-1234567890",
      appVersion: "0.1.0",
      properties: {
        holding_count_bucket: "2-3",
        result_status: "rebalance_needed",
      },
      now: new Date("2026-07-23T02:00:00.000Z"),
    }),
    {
      anonymous_id: "device-1234567890",
      app_version: "0.1.0",
      created_at: "2026-07-23T02:00:00.000Z",
      event_id: "event-1234567890",
      event_name: "beta_calculated",
      properties_json: "{\"holding_count_bucket\":\"2-3\",\"result_status\":\"rebalance_needed\"}",
      session_id: "session-1234567890",
      tracking_version: ANALYTICS_V1_TRACKING_VERSION,
    },
  );
});

test("builds exact-day retention and leaves immature cohorts blank", () => {
  const summary = createAnalyticsRetentionSummary({
    cohorts: [
      {
        date: "2026-07-20",
        devices: ["a", "b"],
      },
      {
        date: "2026-07-22",
        devices: ["c"],
      },
    ],
    activeByDate: {
      "2026-07-21": ["a"],
      "2026-07-23": ["c"],
    },
    now: new Date("2026-07-23T12:00:00.000Z"),
  });

  assert.deepEqual(summary.weighted, {
    d1: {
      matureDevices: 3,
      retainedDevices: 2,
      ratio: 2 / 3,
    },
    d7: null,
    d30: null,
  });
  assert.deepEqual(summary.cohorts[0].retention.d1, {
    mature: true,
    retainedDevices: 1,
    ratio: 0.5,
  });
  assert.equal(summary.cohorts[0].retention.d7.mature, false);
});

test("buckets holding counts without exposing portfolio contents", () => {
  assert.equal(getHoldingCountBucket(0), "0");
  assert.equal(getHoldingCountBucket(1), "1");
  assert.equal(getHoldingCountBucket(3), "2-3");
  assert.equal(getHoldingCountBucket(5), "4-5");
  assert.equal(getHoldingCountBucket(9), "6+");
});
