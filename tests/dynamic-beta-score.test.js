import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MARKET_RISK_SCORE_VERSION,
  calculateMarketRiskScore,
  scoreFixedThreshold,
} from "../src/lib/dynamic-beta/market-risk-score.js";

function history(values) {
  return values.map(([observationDate, value]) => ({ observationDate, value }));
}

describe("market risk score fixed rules", () => {
  it("maps increasing and decreasing risk thresholds deterministically", () => {
    assert.equal(scoreFixedThreshold(14, [15, 20, 25, 35], "higher"), 0);
    assert.equal(scoreFixedThreshold(20, [15, 20, 25, 35], "higher"), 25);
    assert.equal(scoreFixedThreshold(36, [15, 20, 25, 35], "higher"), 100);
    assert.equal(scoreFixedThreshold(6, [5, 0, -8, -15], "lower"), 0);
    assert.equal(scoreFixedThreshold(-10, [5, 0, -8, -15], "lower"), 75);
  });

  it("uses only observations available on or before the requested date", () => {
    const result = calculateMarketRiskScore({
      asOf: "2026-07-24",
      histories: {
        VIXCLS: history([
          ["2026-07-01", 18],
          ["2026-07-24", 20],
          ["2026-07-27", 40],
        ]),
      },
    });
    const level = result.signals.find((signal) => signal.id === "vix_level");

    assert.equal(level.value, 20);
    assert.equal(level.score, 25);
    assert.equal(level.observationDate, "2026-07-24");
    assert.equal(result.modelVersion, MARKET_RISK_SCORE_VERSION);
  });

  it("returns no total when available model weight is below 70 percent", () => {
    const result = calculateMarketRiskScore({
      asOf: "2026-07-24",
      histories: { VIXCLS: history([["2026-07-24", 20]]) },
    });

    assert.equal(result.status, "insufficient");
    assert.equal(result.score, null);
    assert.equal(result.coverage, 0.15);
  });

  it("renormalizes available weights and reports partial coverage", () => {
    const result = calculateMarketRiskScore({
      asOf: "2026-07-24",
      histories: {
        VIXCLS: history([
          ["2026-07-01", 18],
          ["2026-07-24", 20],
        ]),
        "YAHOO:SPY": history([
          ["2025-07-24", 100],
          ["2026-05-25", 100],
          ["2026-07-04", 100],
          ["2026-07-24", 100],
        ]),
        "YAHOO:QQQ": history([
          ["2026-07-04", 100],
          ["2026-07-24", 100],
        ]),
        "YAHOO:SOXX": history([
          ["2026-07-04", 100],
          ["2026-07-24", 100],
        ]),
        BAMLH0A0HYM2: history([
          ["2026-07-04", 3],
          ["2026-07-24", 3],
        ]),
        DGS2: history([
          ["2026-07-04", 4],
          ["2026-07-24", 4],
        ]),
        DGS10: history([
          ["2026-07-04", 4.5],
          ["2026-07-24", 4.5],
        ]),
      },
    });

    assert.equal(result.status, "partial");
    assert.ok(result.coverage >= 0.7 && result.coverage < 1);
    assert.ok(Number.isFinite(result.score));
    assert.ok(result.categories.every((category) => "availableWeight" in category));
  });

  it("measures market-only coverage against its own model weight", () => {
    const result = calculateMarketRiskScore({
      asOf: "2026-07-24",
      excludedCategories: ["macro"],
      histories: {
        VIXCLS: history([["2026-07-24", 20]]),
      },
    });

    assert.equal(result.expectedWeight, 0.85);
    assert.equal(result.rawCoverage, 0.15);
    assert.equal(result.coverage, 0.176471);
    assert.equal(result.status, "insufficient");
    assert.equal(result.categories.some((item) => item.id === "macro"), false);
  });
});
