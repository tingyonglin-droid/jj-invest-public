import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createAnalyticsClient,
  getMarketFromTicker,
  getResultStatus,
} from "../src/lib/analytics-client.js";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("starts a session and tracks safe events through one service", async () => {
  const requests = [];
  const storage = createMemoryStorage({
    "jj-invest-public-device-id-v1": "device-1234567890",
  });
  const sessionStorage = createMemoryStorage();
  const client = createAnalyticsClient({
    appVersion: "0.1.0",
    fetcher: async (url, options) => {
      requests.push({ url, options: JSON.parse(options.body) });
      return { ok: true };
    },
    localStorage: storage,
    sessionStorage,
    createId: () => `id-${requests.length}`,
    now: () => new Date("2026-07-23T01:00:00.000Z"),
  });

  await client.startOrResumeSession();
  await client.trackHoldingAdded({ assetType: "leveraged", market: "TW" });

  assert.equal(requests[0].url, "/api/analytics/session");
  assert.equal(requests[0].options.appVersion, "0.1.0");
  const eventRequest = requests.at(-1);
  assert.equal(eventRequest.url, "/api/analytics/event");
  assert.equal(eventRequest.options.eventName, "holding_added");
  assert.deepEqual(eventRequest.options.properties, {
    asset_type: "leveraged",
    market: "TW",
  });
});

test("analytics client swallows API failures", async () => {
  const client = createAnalyticsClient({
    fetcher: async () => {
      throw new Error("offline");
    },
    localStorage: createMemoryStorage(),
    sessionStorage: createMemoryStorage(),
    createId: () => "id-1",
    now: () => new Date("2026-07-23T01:00:00.000Z"),
  });

  await assert.doesNotReject(client.startOrResumeSession());
  await assert.doesNotReject(client.trackBetaCalculated({
    holdingCount: 3,
    resultStatus: "rebalance_needed",
  }));
});

test("derives coarse market and beta result status without exposing values", () => {
  assert.equal(getMarketFromTicker("00631L"), "TW");
  assert.equal(getMarketFromTicker("VOO"), "US");
  assert.equal(getMarketFromTicker(""), "unknown");
  assert.equal(getResultStatus({ isValid: false }), "invalid");
  assert.equal(getResultStatus({ isValid: true, needsRebalance: true }), "rebalance_needed");
  assert.equal(getResultStatus({ isValid: true, needsRebalance: false }), "within_tolerance");
});
