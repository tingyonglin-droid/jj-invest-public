import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRebalanceToState,
  getRebalanceShareDelta,
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
  it("rounds all assets to shares in share precision mode", () => {
    assert.equal(getRebalanceShareDelta(recommendations[0], "shares"), 1150);
    assert.equal(getRebalanceShareDelta(recommendations[1], "shares"), -1);
  });

  it("rounds Taiwan tickers to lots while US tickers remain share-based", () => {
    assert.equal(getRebalanceShareDelta(recommendations[0], "lots"), 1000);
    assert.equal(getRebalanceShareDelta(recommendations[1], "lots"), -1);
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
});
