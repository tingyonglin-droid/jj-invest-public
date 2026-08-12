import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  QUOTE_RETRY_DELAYS_MS,
  createQuoteRetryController,
  hasCompletePriorQuoteResult,
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

  it("runs one bounded retry sequence and reports exhaustion", () => {
    const scheduled = [];
    const cleared = [];
    const retries = [];
    let exhausted = 0;
    const controller = createQuoteRetryController({
      setTimeoutFn(callback, delay) {
        const timer = { callback, delay };
        scheduled.push(timer);
        return timer;
      },
      clearTimeoutFn(timer) {
        cleared.push(timer);
      },
      onRetry() {
        retries.push("retry");
      },
      onExhausted() {
        exhausted += 1;
      },
    });

    controller.schedule();
    controller.schedule();
    assert.equal(scheduled.length, 2);
    assert.equal(cleared.length, 1);
    assert.equal(scheduled[1].delay, 2_000);

    scheduled[1].callback();
    assert.equal(retries.length, 1);
    controller.schedule();
    assert.equal(scheduled[2].delay, 5_000);

    scheduled[2].callback();
    controller.schedule();
    assert.equal(scheduled[3].delay, 15_000);

    scheduled[3].callback();
    controller.schedule();
    assert.equal(exhausted, 1);
    assert.equal(scheduled.length, 4);
  });

  it("resets retry delays and cancels pending work after success", () => {
    const scheduled = [];
    const cleared = [];
    const controller = createQuoteRetryController({
      setTimeoutFn(callback, delay) {
        const timer = { callback, delay };
        scheduled.push(timer);
        return timer;
      },
      clearTimeoutFn(timer) {
        cleared.push(timer);
      },
      onRetry() {},
      onExhausted() {},
    });

    controller.schedule();
    scheduled[0].callback();
    controller.schedule();
    controller.reset();
    controller.schedule();

    assert.equal(cleared.at(-1), scheduled[1]);
    assert.equal(scheduled[2].delay, 2_000);
  });

  it("requires every current ticker and FX value before hiding a request failure", () => {
    const prior = {
      quotes: [
        {
          inputTicker: "00631L",
          normalizedTicker: "00631L.TW",
          priceTwd: 40,
          error: null,
        },
      ],
      fx: { usdTwd: 30, error: null },
    };

    assert.equal(hasCompletePriorQuoteResult(prior, ["00631L"]), true);
    assert.equal(hasCompletePriorQuoteResult(prior, ["00631L", "00685L"]), false);
    assert.equal(
      hasCompletePriorQuoteResult({ ...prior, fx: { usdTwd: null, error: "失敗" } }, ["00631L"]),
      false,
    );
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
