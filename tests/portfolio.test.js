import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculatePortfolio } from "../src/lib/portfolio.js";

const positions = [
  {
    id: "tw-leveraged",
    tickerInput: "00631L",
    shares: 1000,
    assetBeta: 2,
    targetWeightPct: 100,
  },
  {
    id: "us-original",
    tickerInput: "QLD",
    shares: 10,
    assetBeta: 1,
    targetWeightPct: 100,
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
      targetBeta: 1.2,
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

  it("creates per-position rebalance recommendations from target weights inside each asset type", () => {
    const result = calculatePortfolio({
      positions,
      quotes,
      cashTwd: 28500,
      targetBeta: 1.2,
      originalTargetPct: 40,
      tolerancePct: 10,
    });

    assert.deepEqual(
      result.recommendations.map((item) => ({
        ticker: item.normalizedTicker,
        currentValueTwd: item.currentValueTwd,
        currentSleeveWeight: item.currentSleeveWeight,
        targetSleeveWeight: item.targetSleeveWeight,
        targetValueTwd: item.targetValueTwd,
        tradeAmountTwd: item.tradeAmountTwd,
        action: item.action,
      })),
      [
        {
          ticker: "00631L.TW",
          currentValueTwd: 40000,
          currentSleeveWeight: 1,
          targetSleeveWeight: 1,
          targetValueTwd: 40000,
          tradeAmountTwd: 0,
          action: "none",
        },
        {
          ticker: "QLD",
          currentValueTwd: 31500,
          currentSleeveWeight: 1,
          targetSleeveWeight: 1,
          targetValueTwd: 40000,
          tradeAmountTwd: 8500,
          action: "buy",
        },
      ],
    );
  });

  it("derives post-rebalance asset and cash ratios from the target beta", () => {
    const result = calculatePortfolio({
      positions,
      quotes,
      cashTwd: 28500,
      targetBeta: 1.2,
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
      targetBeta: 1.2,
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
          targetWeightPct: 100,
        },
      ],
      quotes: [quotes[0]],
      cashTwd: 60000,
      targetBeta: 1.2,
      tolerancePct: 10,
    });

    assert.equal(result.totalAssetsTwd, 100000);
    assert.equal(result.afterStockRatio, 0.6);
    assert.equal(result.afterCashRatio, 0.4);
    assert.equal(result.afterBeta, 1.2);
    assert.equal(result.recommendations[0].targetValueTwd, 60000);
    assert.equal(result.recommendations[0].tradeAmountTwd, 20000);
    assert.equal(result.recommendations[0].action, "buy");
  });

  it("marks target weights above 100 percent as invalid", () => {
    const result = calculatePortfolio({
      positions: [
        {
          id: "first",
          tickerInput: "00631L",
          shares: 1000,
          assetBeta: 2,
          targetWeightPct: 60,
        },
        {
          id: "second",
          tickerInput: "00685L",
          shares: 1000,
          assetBeta: 2,
          targetWeightPct: 60,
        },
      ],
      quotes,
      cashTwd: 28500,
      targetBeta: 1.2,
      tolerancePct: 10,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.errors[0], "正二標的目標比例合計必須等於 100%。");
  });

  it("marks target weights below 100 percent as invalid", () => {
    const result = calculatePortfolio({
      positions: [
        {
          id: "first",
          tickerInput: "00631L",
          shares: 1000,
          assetBeta: 2,
          targetWeightPct: 60,
        },
        {
          id: "second",
          tickerInput: "QLD",
          shares: 10,
          assetBeta: 2.5,
          targetWeightPct: 20,
        },
      ],
      quotes,
      cashTwd: 28500,
      targetBeta: 1.2,
      tolerancePct: 10,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.errors[0], "正二標的目標比例合計必須等於 100%。");
  });

  it("marks original target percent without original allocation as invalid", () => {
    const result = calculatePortfolio({
      positions: [
        {
          id: "only-leveraged",
          tickerInput: "00631L",
          shares: 1000,
          assetBeta: 2,
          targetWeightPct: 100,
        },
      ],
      quotes: [quotes[0]],
      cashTwd: 60000,
      targetBeta: 1.2,
      originalTargetPct: 40,
      tolerancePct: 10,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.errors[0], "原形標的目標比例合計必須等於 100%。");
  });
});
