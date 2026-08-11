import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRebalanceToState,
  getAppliedRebalanceSummary,
  getAppliedRebalanceShareDelta,
  getRebalanceShareDelta,
  createFundedRebalanceRecommendations,
} from "../src/lib/rebalance-apply.js";

const recommendations = [
  {
    id: "tw",
    normalizedTicker: "00631L.TW",
    tradeAmountTwd: 46000,
    priceTwd: 40,
  },
  {
    id: "us",
    normalizedTicker: "QLD",
    tradeAmountTwd: -3200,
    priceTwd: 3150,
  },
];

describe("apply rebalance", () => {
  it("reduces rounded cash-equivalent buys before breaching the real-cash reserve", () => {
    const funded = createFundedRebalanceRecommendations({
      cashTwd: 1000000,
      minimumCashTwd: 20000,
      precision: "lots",
      recommendations: [
        { id: "leveraged", normalizedTicker: "00631L.TW", shares: 0, assetBeta: 2, tradeAmountTwd: 383570, priceTwd: 34.87 },
        { id: "original", normalizedTicker: "0050.TW", shares: 0, assetBeta: 1, tradeAmountTwd: 418400, priceTwd: 104.6 },
        { id: "bond", normalizedTicker: "00865B.TW", shares: 0, assetType: "cashEquivalent", tradeAmountTwd: 180000, priceTwd: 49.36 },
      ],
    });
    const summary = getAppliedRebalanceSummary({ recommendations: funded, precision: "lots" });

    assert.equal(getAppliedRebalanceShareDelta(funded[2], "lots"), 3000);
    assert.equal(1000000 + summary.cashDeltaTwd, 49950);
    assert.ok(1000000 + summary.cashDeltaTwd >= 20000);
  });

  it("rounds all assets to shares in share precision mode", () => {
    assert.equal(getRebalanceShareDelta(recommendations[0], "shares"), 1150);
    assert.equal(getRebalanceShareDelta(recommendations[1], "shares"), -1);
  });

  it("rounds Taiwan tickers to lots while US tickers remain share-based", () => {
    assert.equal(getRebalanceShareDelta(recommendations[0], "lots"), 1000);
    assert.equal(getRebalanceShareDelta(recommendations[1], "lots"), -1);
  });

  it("caps displayed applied shares at the current holding size", () => {
    assert.equal(
      getAppliedRebalanceShareDelta(
        {
          id: "tw",
          normalizedTicker: "00631L.TW",
          shares: 500,
          tradeAmountTwd: -46000,
          priceTwd: 40,
        },
        "shares",
      ),
      -500,
    );
  });

  it("updates position shares and cash using applied trade values", () => {
    const result = applyRebalanceToState({
      positions: [
        { id: "tw", tickerInput: "00631L", shares: 1000 },
        { id: "us", tickerInput: "QLD", shares: 10 },
      ],
      cashTwd: 100000,
      recommendations,
      precision: "lots",
    });

    assert.deepEqual(
      result.positions.map((position) => position.shares),
      [2000, 9],
    );
    assert.equal(result.cashTwd, 63150);
  });

  it("does not sell below zero shares", () => {
    const result = applyRebalanceToState({
      positions: [{ id: "us", tickerInput: "QLD", shares: 0 }],
      cashTwd: 1000,
      recommendations,
      precision: "shares",
    });

    assert.equal(result.positions[0].shares, 0);
    assert.equal(result.cashTwd, 1000);
  });

  it("rounds applied cash to whole TWD", () => {
    const result = applyRebalanceToState({
      positions: [{ id: "tw", tickerInput: "00631L", shares: 1000 }],
      cashTwd: 100000,
      recommendations: [
        {
          id: "tw",
          normalizedTicker: "00631L.TW",
          tradeAmountTwd: 12000,
          priceTwd: 42.25,
        },
      ],
      precision: "shares",
    });

    assert.equal(result.positions[0].shares, 1284);
    assert.equal(result.cashTwd, 88001);
  });

  it("counts only holdings with actual applied share changes", () => {
    const summary = getAppliedRebalanceSummary({
      recommendations: [
        {
          id: "small-tw",
          normalizedTicker: "0050.TW",
          shares: 1000,
          tradeAmountTwd: 20000,
          priceTwd: 100,
        },
        {
          id: "large-tw",
          normalizedTicker: "00631L.TW",
          shares: 1000,
          tradeAmountTwd: 120000,
          priceTwd: 40,
        },
      ],
      precision: "lots",
    });

    assert.equal(summary.actionCount, 1);
    assert.equal(summary.totalAmountTwd, 120000);
  });

  it("summarizes applied net trades by sleeve and the matching cash change", () => {
    const summary = getAppliedRebalanceSummary({
      recommendations: [
        {
          id: "leveraged-buy",
          normalizedTicker: "00631L.TW",
          shares: 1000,
          assetBeta: 2,
          tradeAmountTwd: 46000,
          priceTwd: 40,
        },
        {
          id: "original-sell",
          normalizedTicker: "0050.TW",
          shares: 1000,
          assetBeta: 1,
          tradeAmountTwd: -25200,
          priceTwd: 25,
        },
      ],
      precision: "lots",
    });

    assert.equal(summary.leveragedNetAmountTwd, 40000);
    assert.equal(summary.originalNetAmountTwd, -25000);
    assert.equal(summary.cashDeltaTwd, -15000);
  });

  it("rounds sleeve and cash net amounts after combining fractional trades", () => {
    const summary = getAppliedRebalanceSummary({
      recommendations: [
        {
          id: "fraction-a",
          normalizedTicker: "QLD",
          shares: 0,
          assetBeta: 2,
          tradeAmountTwd: 0.4,
          priceTwd: 0.4,
        },
        {
          id: "fraction-b",
          normalizedTicker: "SSO",
          shares: 0,
          assetBeta: 2,
          tradeAmountTwd: 0.4,
          priceTwd: 0.4,
        },
      ],
      precision: "shares",
    });

    assert.equal(summary.leveragedNetAmountTwd, 1);
    assert.equal(summary.cashDeltaTwd, -1);
  });
});
