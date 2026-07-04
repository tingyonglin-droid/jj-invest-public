import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculatePortfolio } from "../src/lib/portfolio.js";

const positions = [
  {
    id: "tw-leveraged",
    tickerInput: "00631L",
    shares: 1000,
    assetBeta: 2,
    targetWeightPct: 37.5,
  },
  {
    id: "us-leveraged",
    tickerInput: "QLD",
    shares: 10,
    assetBeta: 2.5,
    targetWeightPct: 62.5,
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
      tolerancePct: 10,
    });

    assert.equal(result.totalAssetsTwd, 100000);
    assert.equal(result.stockValueTwd, 71500);
    assert.equal(result.currentBeta, 1.5875);
    assert.equal(result.betaDrift, 0.3875);
    assert.equal(result.betaLower, 1.08);
    assert.equal(result.betaUpper, 1.32);
    assert.equal(result.needsRebalance, true);
  });

  it("creates per-position rebalance recommendations from target weights inside the leveraged sleeve", () => {
    const result = calculatePortfolio({
      positions,
      quotes,
      cashTwd: 28500,
      targetBeta: 1.2,
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
          currentSleeveWeight: 0.5594,
          targetSleeveWeight: 0.375,
          targetValueTwd: 19459.46,
          tradeAmountTwd: -20540.54,
          action: "sell",
        },
        {
          ticker: "QLD",
          currentValueTwd: 31500,
          currentSleeveWeight: 0.4406,
          targetSleeveWeight: 0.625,
          targetValueTwd: 32432.43,
          tradeAmountTwd: 932.43,
          action: "buy",
        },
      ],
    );
  });

  it("derives post-rebalance stock and cash ratios from the target beta", () => {
    const result = calculatePortfolio({
      positions,
      quotes,
      cashTwd: 28500,
      targetBeta: 1.2,
      tolerancePct: 10,
    });

    assert.equal(result.afterCashRatio, 0.4811);
    assert.equal(result.afterStockRatio, 0.5189);
    assert.equal(result.afterBeta, 1.2);
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
      positions: positions.map((position) => ({
        ...position,
        targetWeightPct: 60,
      })),
      quotes,
      cashTwd: 28500,
      targetBeta: 1.2,
      tolerancePct: 10,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.errors[0], "正二內目標比例總和必須等於 100%。");
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
    assert.equal(result.errors[0], "正二內目標比例總和必須等於 100%。");
  });
});
