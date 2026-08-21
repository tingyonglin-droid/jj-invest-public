import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRebalanceToState,
  getAppliedRebalanceSummary,
  getAppliedRebalanceShareDelta,
  getCashSleeveValueAfterStockTrades,
  getRebalanceShareDelta,
  createFundedRebalanceRecommendations,
  getAppliedTradeAmounts,
  getMinimumCashBalances,
  isTaiwanTicker,
} from "../src/lib/rebalance-apply.js";

const recommendations = [
  {
    id: "tw",
    normalizedTicker: "00631L.TW",
    currency: "TWD",
    tradeAmountTwd: 46000,
    price: 40,
    priceTwd: 40,
  },
  {
    id: "us",
    normalizedTicker: "QLD",
    currency: "USD",
    tradeAmountTwd: -3200,
    price: 100,
    priceTwd: 3150,
  },
];

describe("apply rebalance", () => {
  it("allocates the required cash reserve across existing TWD and USD cash", () => {
    assert.deepEqual(getMinimumCashBalances({
      targetRealCashTwd: 6400,
      cashTwd: 3200,
      cashUsd: 200,
      usdTwd: 32,
    }), { TWD: 2133, USD: 133.34 });
  });

  it("keeps the combined cash target in USD when selected Taiwan buys use the TWD balance", () => {
    assert.deepEqual(getMinimumCashBalances({
      targetRealCashTwd: 210448,
      cashTwd: 201039,
      cashUsd: 6869.43,
      usdTwd: 31.82,
      recommendations: [
        { id: "tw-leveraged", normalizedTicker: "00631L.TW", currency: "TWD", tradeAmountTwd: 160980, price: 34.84, priceTwd: 34.84 },
        { id: "tw-original", normalizedTicker: "0050.TW", currency: "TWD", tradeAmountTwd: 48196, price: 104.65, priceTwd: 104.65 },
      ],
    }), { TWD: 0, USD: 6613.7 });
  });

  it("does not use excess TWD to fund a U.S. buy", () => {
    const funded = createFundedRebalanceRecommendations({
      cashBalances: { TWD: 1000000, USD: 100 },
      minimumCashBalances: { TWD: 0, USD: 0 },
      recommendations: [{
        id: "us-buy",
        normalizedTicker: "QLD",
        shares: 0,
        currency: "USD",
        price: 60,
        priceTwd: 1920,
        tradeAmountTwd: 19200,
      }],
    });

    assert.equal(getAppliedRebalanceShareDelta(funded.recommendations[0]), 1);
    assert.match(funded.warnings.join(" "), /美元現金不足/);
  });

  it("uses same-currency sale proceeds but never cross-currency proceeds", () => {
    const funded = createFundedRebalanceRecommendations({
      cashBalances: { TWD: 0, USD: 0 },
      minimumCashBalances: { TWD: 0, USD: 0 },
      recommendations: [
        { id: "us-sell", normalizedTicker: "QQQ", shares: 2, currency: "USD", price: 50, priceTwd: 1600, tradeAmountTwd: -3200 },
        { id: "us-buy", normalizedTicker: "QLD", shares: 0, currency: "USD", price: 100, priceTwd: 3200, tradeAmountTwd: 3200 },
        { id: "tw-buy", normalizedTicker: "0050.TW", shares: 0, currency: "TWD", price: 100, priceTwd: 100, tradeAmountTwd: 100 },
      ],
    });

    assert.equal(getAppliedRebalanceShareDelta(funded.recommendations[1]), 1);
    assert.equal(getAppliedRebalanceShareDelta(funded.recommendations[2]), 0);
    assert.deepEqual(funded.requiresSellFirstCurrencies, ["USD"]);
  });

  it("blocks recommendations with unsupported settlement currency", () => {
    const funded = createFundedRebalanceRecommendations({
      cashBalances: { TWD: 1000, USD: 1000 },
      minimumCashBalances: { TWD: 0, USD: 0 },
      recommendations: [{ id: "bad", normalizedTicker: "BAD", shares: 0, currency: "EUR", price: 10, priceTwd: 350, tradeAmountTwd: 350 }],
    });

    assert.equal(funded.recommendations[0].tradeAmountTwd, 0);
    assert.match(funded.warnings.join(" "), /不支援的交易幣別/);
  });

  it("derives local and TWD amounts from the applied U.S. share quantity", () => {
    assert.deepEqual(
      getAppliedTradeAmounts({
        normalizedTicker: "QLD",
        shares: 0,
        tradeAmountTwd: 3948.8,
        price: 12.34,
        priceTwd: 394.88,
        currency: "USD",
      }),
      {
        deltaShares: 10,
        settlementCurrency: "USD",
        amountLocal: 123.4,
        amountTwd: 3948.8,
      },
    );
  });

  it("treats both TW and TWO suffixes as Taiwan tickers", () => {
    assert.equal(isTaiwanTicker("0050.TW"), true);
    assert.equal(isTaiwanTicker("00679B.TWO"), true);
    assert.equal(getRebalanceShareDelta({
      normalizedTicker: "00679B.TWO",
      tradeAmountTwd: 45000,
      priceTwd: 30,
    }, "lots"), 2000);
  });

  it("derives the cash sleeve from applied stock lots instead of theoretical beta", () => {
    const cashSleeveValue = getCashSleeveValueAfterStockTrades({
      totalAssetsTwd: 1000000,
      precision: "lots",
      recommendations: [
        {
          id: "leveraged",
          normalizedTicker: "00631L.TW",
          shares: 0,
          assetBeta: 2,
          currentValueTwd: 0,
          tradeAmountTwd: 383570,
          priceTwd: 34.87,
        },
        {
          id: "original",
          normalizedTicker: "0050.TW",
          shares: 0,
          assetBeta: 1,
          currentValueTwd: 0,
          tradeAmountTwd: 418400,
          priceTwd: 104.6,
        },
      ],
    });

    assert.equal(cashSleeveValue, 198030);
  });

  it("keeps the closer cash-equivalent lot in custom allocation mode", () => {
    const funded = createFundedRebalanceRecommendations({
      cashBalances: { TWD: 148670, USD: 0 },
      minimumCashBalances: { TWD: 100000, USD: 0 },
      cashTargetStrategy: "nearest",
      precision: "lots",
      recommendations: [
        {
          id: "bond",
          normalizedTicker: "00865B.TW",
          shares: 1000,
          assetType: "cashEquivalent",
          currency: "TWD",
          tradeAmountTwd: 50640,
          price: 49.36,
          priceTwd: 49.36,
        },
      ],
    });

    assert.equal(getAppliedRebalanceShareDelta(funded.recommendations[0], "lots"), 1000);
    assert.equal(funded.recommendations[0].tradeAmountTwd, 49360);
  });

  it("reduces rounded cash-equivalent buys before breaching the real-cash reserve", () => {
    const funded = createFundedRebalanceRecommendations({
      cashBalances: { TWD: 1000000, USD: 0 },
      minimumCashBalances: { TWD: 20000, USD: 0 },
      precision: "lots",
      recommendations: [
        { id: "leveraged", normalizedTicker: "00631L.TW", shares: 0, assetBeta: 2, currency: "TWD", tradeAmountTwd: 383570, price: 34.87, priceTwd: 34.87 },
        { id: "original", normalizedTicker: "0050.TW", shares: 0, assetBeta: 1, currency: "TWD", tradeAmountTwd: 418400, price: 104.6, priceTwd: 104.6 },
        { id: "bond", normalizedTicker: "00865B.TW", shares: 0, assetType: "cashEquivalent", currency: "TWD", tradeAmountTwd: 180000, price: 49.36, priceTwd: 49.36 },
      ],
    });
    const summary = getAppliedRebalanceSummary({ recommendations: funded.recommendations, precision: "lots" });

    assert.equal(getAppliedRebalanceShareDelta(funded.recommendations[2], "lots"), 3000);
    assert.equal(1000000 + summary.cashDeltaTwd, 49950);
    assert.ok(1000000 + summary.cashDeltaTwd >= 20000);
  });

  it("does not report a currency shortage when buys fit available cash but are trimmed for the cash reserve", () => {
    const funded = createFundedRebalanceRecommendations({
      cashBalances: { TWD: 1000000, USD: 33000 },
      minimumCashBalances: { TWD: 200000, USD: 6600 },
      recommendations: [
        { id: "tw-leveraged", normalizedTicker: "00631L.TW", shares: 0, assetBeta: 2, currency: "TWD", tradeAmountTwd: 390556, price: 34.84, priceTwd: 34.84 },
        { id: "tw-original", normalizedTicker: "0050.TW", shares: 0, assetBeta: 1, currency: "TWD", tradeAmountTwd: 409914, price: 104.65, priceTwd: 104.65 },
        { id: "us-leveraged", normalizedTicker: "QLD", shares: 0, assetBeta: 2, currency: "USD", tradeAmountTwd: 411303.744, price: 65.99, priceTwd: 2098.482 },
        { id: "us-original", normalizedTicker: "QQQ", shares: 0, assetBeta: 1, currency: "USD", tradeAmountTwd: 408888.216, price: 617.91, priceTwd: 19649.538 },
      ],
    });

    assert.doesNotMatch(funded.warnings.join(" "), /台幣現金不足/);
    assert.doesNotMatch(funded.warnings.join(" "), /美元現金不足/);
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
      cashUsd: 0,
      recommendations,
      precision: "lots",
    });

    assert.deepEqual(
      result.positions.map((position) => position.shares),
      [2000, 9],
    );
    assert.equal(result.cashTwd, 60000);
    assert.equal(result.cashUsd, 100);
  });

  it("settles Taiwan and U.S. trades against separate cash balances", () => {
    const result = applyRebalanceToState({
      positions: [
        { id: "tw", tickerInput: "0050", shares: 0 },
        { id: "us", tickerInput: "QLD", shares: 0 },
      ],
      cashTwd: 100000,
      cashUsd: 1000,
      recommendations: [
        { id: "tw", normalizedTicker: "0050.TW", shares: 0, currency: "TWD", price: 100, priceTwd: 100, tradeAmountTwd: 100 },
        { id: "us", normalizedTicker: "QLD", shares: 0, currency: "USD", price: 50, priceTwd: 1600, tradeAmountTwd: 3200 },
      ],
      precision: "shares",
    });

    assert.equal(result.cashTwd, 99900);
    assert.equal(result.cashUsd, 900);
  });

  it("reports separate TWD and USD cash changes", () => {
    const summary = getAppliedRebalanceSummary({
      recommendations: [
        { id: "tw", normalizedTicker: "0050.TW", shares: 0, assetBeta: 1, currency: "TWD", price: 100, priceTwd: 100, tradeAmountTwd: 100 },
        { id: "us", normalizedTicker: "QLD", shares: 0, assetBeta: 2, currency: "USD", price: 50, priceTwd: 1600, tradeAmountTwd: 3200 },
      ],
    });

    assert.equal(summary.cashDeltaTwd, -100);
    assert.equal(summary.cashDeltaUsd, -100);
    assert.equal(summary.originalNetAmountSettlementTwd, 100);
    assert.equal(summary.leveragedNetAmountUsd, 100);
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
          currency: "TWD",
          tradeAmountTwd: 12000,
          price: 42.25,
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
          currency: "TWD",
          shares: 1000,
          tradeAmountTwd: 20000,
          price: 100,
          priceTwd: 100,
        },
        {
          id: "large-tw",
          normalizedTicker: "00631L.TW",
          currency: "TWD",
          shares: 1000,
          tradeAmountTwd: 120000,
          price: 40,
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
          currency: "TWD",
          shares: 1000,
          assetBeta: 2,
          tradeAmountTwd: 46000,
          price: 40,
          priceTwd: 40,
        },
        {
          id: "original-sell",
          normalizedTicker: "0050.TW",
          currency: "TWD",
          shares: 1000,
          assetBeta: 1,
          tradeAmountTwd: -25200,
          price: 25,
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
          currency: "TWD",
          shares: 0,
          assetBeta: 2,
          tradeAmountTwd: 0.4,
          price: 0.4,
          priceTwd: 0.4,
        },
        {
          id: "fraction-b",
          normalizedTicker: "SSO",
          currency: "TWD",
          shares: 0,
          assetBeta: 2,
          tradeAmountTwd: 0.4,
          price: 0.4,
          priceTwd: 0.4,
        },
      ],
      precision: "shares",
    });

    assert.equal(summary.leveragedNetAmountTwd, 1);
    assert.equal(summary.cashDeltaTwd, -1);
  });
});
