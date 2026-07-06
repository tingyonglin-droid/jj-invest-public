import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { shouldAutoRefreshQuotes } from "../src/lib/auto-refresh.js";

describe("auto refresh policy", () => {
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
