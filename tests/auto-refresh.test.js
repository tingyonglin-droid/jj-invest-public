import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  QUOTE_RETRY_DELAYS_MS,
  mergeQuoteResults,
  shouldAutoRefreshQuotes,
} from "../src/lib/auto-refresh.js";

describe("auto refresh policy", () => {
  it("uses short bounded retry delays", () => {
    assert.deepEqual(QUOTE_RETRY_DELAYS_MS, [2_000, 5_000, 15_000]);
  });

  it("replaces prior quote and FX values when the refresh succeeds", () => {
    const merged = mergeQuoteResults(
      {
        quotes: [
          {
            inputTicker: "00685L",
            normalizedTicker: "00685L.TW",
            priceTwd: 10,
            error: null,
          },
        ],
        fx: { usdTwd: 30, error: null },
      },
      {
        quotes: [
          {
            inputTicker: "00685L",
            normalizedTicker: "00685L.TW",
            priceTwd: 11,
            error: null,
          },
        ],
        fx: { usdTwd: 31, error: null },
      },
    );

    assert.equal(merged.result.quotes[0].priceTwd, 11);
    assert.equal(merged.result.fx.usdTwd, 31);
    assert.equal(merged.hasFailures, false);
    assert.equal(merged.usedStaleData, false);
  });

  it("keeps the prior successful quote when one refreshed ticker fails", () => {
    const merged = mergeQuoteResults(
      {
        quotes: [
          {
            inputTicker: "00685L",
            normalizedTicker: "00685L.TW",
            price: 10,
            currency: "TWD",
            priceTwd: 10,
            date: "2026-08-11",
            source: "TWSE",
            error: null,
          },
        ],
        fx: { usdTwd: 30, date: "2026-08-11", source: "Yahoo Finance", error: null },
      },
      {
        quotes: [
          {
            inputTicker: "00685L",
            normalizedTicker: "00685L.TW",
            price: null,
            currency: null,
            priceTwd: null,
            date: null,
            source: null,
            error: "Yahoo Finance 回應 404",
          },
        ],
        fx: { usdTwd: 31, date: "2026-08-12", source: "Yahoo Finance", error: null },
      },
    );

    assert.equal(merged.result.quotes[0].priceTwd, 10);
    assert.equal(merged.result.quotes[0].error, null);
    assert.equal(merged.result.fx.usdTwd, 31);
    assert.equal(merged.hasFailures, true);
    assert.equal(merged.usedStaleData, true);
  });

  it("keeps an error when the ticker has never produced a usable price", () => {
    const merged = mergeQuoteResults(
      { quotes: [], fx: { usdTwd: null, date: null, source: null, error: null } },
      {
        quotes: [
          {
            inputTicker: "00685L",
            normalizedTicker: "00685L.TW",
            price: null,
            currency: null,
            priceTwd: null,
            date: null,
            source: null,
            error: "Yahoo Finance 回應 404",
          },
        ],
        fx: { usdTwd: 31, date: "2026-08-12", source: "Yahoo Finance", error: null },
      },
    );

    assert.match(merged.result.quotes[0].error, /404/);
    assert.equal(merged.hasFailures, true);
    assert.equal(merged.usedStaleData, false);
  });

  it("keeps the prior successful FX value when refreshed FX fails", () => {
    const merged = mergeQuoteResults(
      {
        quotes: [],
        fx: { usdTwd: 30, date: "2026-08-11", source: "Yahoo Finance", error: null },
      },
      {
        quotes: [],
        fx: { usdTwd: null, date: null, source: null, error: "Yahoo Finance 回應 404" },
      },
    );

    assert.equal(merged.result.fx.usdTwd, 30);
    assert.equal(merged.result.fx.error, null);
    assert.equal(merged.hasFailures, true);
    assert.equal(merged.usedStaleData, true);
  });

  it("refreshes only when visible, idle, and tickers exist", () => {
    assert.equal(
      shouldAutoRefreshQuotes({
        tickers: ["00631L"],
        visibilityState: "visible",
        status: "ready",
      }),
      true,
    );

    assert.equal(
      shouldAutoRefreshQuotes({
        tickers: ["00631L"],
        visibilityState: "hidden",
        status: "ready",
      }),
      false,
    );

    assert.equal(
      shouldAutoRefreshQuotes({
        tickers: [],
        visibilityState: "visible",
        status: "ready",
      }),
      false,
    );

    assert.equal(
      shouldAutoRefreshQuotes({
        tickers: ["00631L"],
        visibilityState: "visible",
        status: "loading",
      }),
      false,
    );
  });
});
