import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculatePortfolio } from "../src/lib/portfolio.js";

const positions = [
  {
    id: "tw-leveraged",
    tickerInput: "00631L",
    shares: 1000,
    assetBeta: 2,
  },
  {
    id: "us-original",
    tickerInput: "QLD",
    shares: 10,
    assetBeta: 1,
  },
];

const quotes = [
  {
    inputTicker: "00631L",
    normalizedTicker: "00631L.TW",
    price: 40,
    currency: "TWD",
    priceTwd: 40,
    date: "2026-07-03",
    source: "test",
    error: null,
  },
  {
    inputTicker: "QLD",
    normalizedTicker: "QLD",
    price: 100,
    currency: "USD",
    priceTwd: 3150,
    date: "2026-07-02",
    source: "test",
    error: null,
  },
];

describe("portfolio calculations", () => {
  it("calculates current beta, beta drift, and tolerance range across multiple asset betas", () => {
    const result = calculatePortfolio({
      positions,
      quotes,
      cashTwd: 28500,
      leveragedTargetPct: 40,
      originalTargetPct: 40,
      tolerancePct: 10,
    });

    assert.equal(result.totalAssetsTwd, 100000);
    assert.equal(result.stockValueTwd, 71500);
    assert.equal(result.currentBeta, 1.115);
    assert.equal(result.betaDrift, -0.085);
    assert.equal(result.betaLower, 1.08);
    assert.equal(result.betaUpper, 1.32);
    assert.equal(result.needsRebalance, false);
  });

  it("keeps current position values while class targets are calculated separately", () => {
    const result = calculatePortfolio({
      positions,
      quotes,
      cashTwd: 28500,
      leveragedTargetPct: 40,
      originalTargetPct: 40,
      tolerancePct: 10,
    });

    assert.deepEqual(
      result.recommendations.map((item) => ({
        ticker: item.normalizedTicker,
        currentValueTwd: item.currentValueTwd,
        currentSleeveWeight: item.currentSleeveWeight,
      })),
      [
        {
          ticker: "00631L.TW",
          currentValueTwd: 40000,
          currentSleeveWeight: 1,
        },
        {
          ticker: "QLD",
          currentValueTwd: 31500,
          currentSleeveWeight: 1,
        },
      ],
    );
  });

  it("derives post-rebalance asset and cash ratios from the target beta", () => {
    const result = calculatePortfolio({
      positions,
      quotes,
      cashTwd: 28500,
      leveragedTargetPct: 40,
      originalTargetPct: 40,
      tolerancePct: 10,
    });

    assert.equal(result.targetLeveragedRatio, 0.4);
    assert.equal(result.targetOriginalRatio, 0.4);
    assert.equal(result.afterCashRatio, 0.2);
    assert.equal(result.afterStockRatio, 0.8);
    assert.equal(result.afterBeta, 1.2);
  });

  it("uses original target percent to group target allocation by leveraged, original, and cash assets", () => {
    const result = calculatePortfolio({
      positions,
      quotes,
      cashTwd: 28500,
      leveragedTargetPct: 40,
      originalTargetPct: 40,
      tolerancePct: 10,
    });

    assert.equal(result.leveragedValueTwd, 40000);
    assert.equal(result.originalValueTwd, 31500);
    assert.equal(result.leveragedRatio, 0.4);
    assert.equal(result.originalRatio, 0.315);
    assert.equal(result.cashRatio, 0.285);
    assert.equal(result.targetLeveragedRatio, 0.4);
    assert.equal(result.targetOriginalRatio, 0.4);
    assert.equal(result.afterCashRatio, 0.2);
  });

  it("does not treat a single target weight of 100 percent as 100 percent stock exposure", () => {
    const result = calculatePortfolio({
      positions: [
        {
          id: "single",
          tickerInput: "00631L",
          shares: 1000,
          assetBeta: 2,
        },
      ],
      quotes: [quotes[0]],
      cashTwd: 60000,
      leveragedTargetPct: 60,
      tolerancePct: 10,
    });

    assert.equal(result.totalAssetsTwd, 100000);
    assert.equal(result.afterStockRatio, 0.6);
    assert.equal(result.afterCashRatio, 0.4);
    assert.equal(result.afterBeta, 1.2);
    assert.equal(result.leveragedTradeAmountTwd, 20000);
  });

  it("marks class target percentages above 100 percent as invalid", () => {
    const result = calculatePortfolio({
      positions: [
        {
          id: "first",
          tickerInput: "00631L",
          shares: 1000,
          assetBeta: 2,
        },
        {
          id: "second",
          tickerInput: "00685L",
          shares: 1000,
          assetBeta: 2,
        },
      ],
      quotes,
      cashTwd: 28500,
      leveragedTargetPct: 80,
      originalTargetPct: 30,
      tolerancePct: 10,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.errors[0], "正二與原形目標比例合計不能超過 100%。");
    assert.deepEqual(result.issues[0], {
      code: "TARGET_TOTAL_EXCEEDED",
      message: "正二與原形目標比例合計不能超過 100%。",
      settingsPage: "beta",
    });
  });

  it("uses the unallocated class target percentage as cash", () => {
    const result = calculatePortfolio({
      positions: [
        {
          id: "first",
          tickerInput: "00631L",
          shares: 1000,
          assetBeta: 2,
        },
        {
          id: "second",
          tickerInput: "QLD",
          shares: 10,
          assetBeta: 1,
        },
      ],
      quotes,
      cashTwd: 28500,
      leveragedTargetPct: 60,
      originalTargetPct: 20,
      tolerancePct: 10,
    });

    assert.equal(result.isValid, true);
    assert.equal(result.afterCashRatio, 0.2);
    assert.equal(result.targetBeta, 1.4);
  });

  it("marks original target percent without original allocation as invalid", () => {
    const result = calculatePortfolio({
      positions: [
        {
          id: "only-leveraged",
          tickerInput: "00631L",
          shares: 1000,
          assetBeta: 2,
        },
      ],
      quotes: [quotes[0]],
      cashTwd: 60000,
      leveragedTargetPct: 40,
      originalTargetPct: 40,
      tolerancePct: 10,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.errors[0], "原形目標比例大於 0 時，請新增至少一個原形標的。");
    assert.deepEqual(result.issues[0], {
      code: "MISSING_ORIGINAL_POSITION",
      message: "原形目標比例大於 0 時，請新增至少一個原形標的。",
      settingsPage: "positions",
    });
  });

  it("adds custom target sleeve weights and validates each custom sleeve", () => {
    const result = calculatePortfolio({
      positions: [
        { id: "a", tickerInput: "00631L", shares: 1000, assetBeta: 2, targetWeightPct: 60 },
        { id: "b", tickerInput: "00685L", shares: 0, assetBeta: 2, targetWeightPct: 40 },
      ],
      quotes: [
        quotes[0],
        { ...quotes[0], inputTicker: "00685L", normalizedTicker: "00685L.TW", priceTwd: 50 },
      ],
      cashTwd: 60000,
      leveragedTargetPct: 60,
      originalTargetPct: 0,
      tolerancePct: 10,
      allocationModes: { leveraged: "custom", original: "auto" },
    });

    assert.equal(result.isValid, true);
    assert.deepEqual(result.recommendations.map((item) => item.targetSleeveWeight), [0.6, 0.4]);

    const invalid = calculatePortfolio({
      positions: [
        { id: "a", tickerInput: "00631L", shares: 1000, assetBeta: 2, targetWeightPct: 60 },
      ],
      quotes: [quotes[0]],
      cashTwd: 60000,
      leveragedTargetPct: 60,
      tolerancePct: 10,
      allocationModes: { leveraged: "custom", original: "auto" },
    });
    assert.equal(invalid.isValid, false);
    assert.match(invalid.errors[0], /正二.*100%/);
    assert.equal(invalid.issues[0].code, "INVALID_LEVERAGED_WEIGHTS");
    assert.equal(invalid.issues[0].settingsPage, "positions");
  });
});
