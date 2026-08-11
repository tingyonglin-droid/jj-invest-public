import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOperationListText,
  getOperationSummary,
  getPositionDisplayName,
  getTickerBadgeText,
} from "../src/lib/presentation.js";

describe("presentation helpers", () => {
  it("maps known tickers to app-friendly display names", () => {
    assert.equal(getPositionDisplayName("0050.TW"), "元大台灣50");
    assert.equal(getPositionDisplayName("006208.TW"), "富邦台50");
    assert.equal(getPositionDisplayName("00631L.TW"), "元大台灣50正2");
    assert.equal(getPositionDisplayName("00685L.TW"), "群益台灣加權正2");
    assert.equal(getPositionDisplayName("00865B.TW", 0), "國泰US短期公債");
    assert.equal(getPositionDisplayName("QLD"), "ProShares Ultra QQQ");
  });

  it("falls back to generic asset labels by asset beta", () => {
    assert.equal(getPositionDisplayName("2330.TW", 1), "原形標的");
    assert.equal(getPositionDisplayName("2330.TW", 2), "正二標的");
  });

  it("creates compact badge text from tickers", () => {
    assert.equal(getTickerBadgeText("00631L.TW"), "2x");
    assert.equal(getTickerBadgeText("QLD"), "QLD");
  });

  it("creates a copyable operation list from recommendations", () => {
    const text = createOperationListText([
      {
        normalizedTicker: "00631L.TW",
        action: "sell",
        tradeAmountTwd: -10000,
        priceTwd: 40,
      },
      {
        normalizedTicker: "QLD",
        action: "buy",
        tradeAmountTwd: 18500,
        priceTwd: 3150,
      },
      {
        normalizedTicker: "00685L.TW",
        action: "none",
        tradeAmountTwd: 0,
        priceTwd: 300,
      },
    ]);

    assert.equal(
      text,
      [
        "JJ Invest System 操作清單",
        "00631L.TW 賣出 NT$10,000，約 250 股",
        "QLD 買入 NT$18,500，約 6 股",
      ].join("\n"),
    );
  });

  it("summarizes actionable operation list rows", () => {
    const summary = getOperationSummary([
      {
        action: "sell",
        tradeAmountTwd: -10000,
      },
      {
        action: "buy",
        tradeAmountTwd: 18500,
      },
      {
        action: "none",
        tradeAmountTwd: 0,
      },
    ]);

    assert.deepEqual(summary, {
      actionCount: 2,
      totalAmountTwd: 28500,
    });
  });
});
