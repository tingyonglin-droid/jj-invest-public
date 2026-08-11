import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOperationListText,
  getOperationSummary,
  getPositionDisplayName,
  getTickerPlaceholder,
  getTickerBadgeText,
} from "../src/lib/presentation.js";

describe("presentation helpers", () => {
  it("maps known tickers to app-friendly display names", () => {
    assert.equal(getPositionDisplayName("0050.TW"), "元大台灣50");
    assert.equal(getPositionDisplayName("006208.TW"), "富邦台50");
    assert.equal(getPositionDisplayName("00631L.TW"), "元大台灣50正2");
    assert.equal(getPositionDisplayName("00685L.TW"), "群益台灣加權正2");
    assert.equal(getPositionDisplayName("00663L.TW", 2), "國泰台灣加權正2");
    assert.equal(getPositionDisplayName("00675L.TW", 2), "富邦台灣加權正2");
    assert.equal(getPositionDisplayName("00865B.TW", 0), "國泰US短期公債");
    assert.equal(getPositionDisplayName("00859B.TW", 0), "群益0-1年美債");
    assert.equal(getPositionDisplayName("00859B.TWO", 0), "群益0-1年美債");
    assert.equal(getPositionDisplayName("00864B.TW", 0), "中信美國公債0-1");
    assert.equal(getPositionDisplayName("00864B.TWO", 0), "中信美國公債0-1");
    assert.equal(getPositionDisplayName("00662.TW", 1), "富邦NASDAQ");
    assert.equal(getPositionDisplayName("SSO", 2), "ProShares Ultra S&P500");
    assert.equal(getPositionDisplayName("VOO", 1), "Vanguard S&P 500 ETF");
    assert.equal(getPositionDisplayName("QQQ", 1), "Invesco QQQ Trust ETF");
    assert.equal(getPositionDisplayName("SMH", 1), "VanEck Semiconductor ETF");
    assert.equal(getPositionDisplayName("SOXX", 1), "iShares Semiconductor ETF");
    assert.equal(getPositionDisplayName("USD", 2), "ProShares Ultra Semiconductors");
    assert.equal(getPositionDisplayName("QLD"), "ProShares Ultra QQQ");
  });

  it("falls back to generic asset labels by asset beta", () => {
    assert.equal(getPositionDisplayName("2330.TW", 1), "原形標的");
    assert.equal(getPositionDisplayName("2330.TW", 2), "正二標的");
  });

  it("shows asset-specific ticker examples in settings", () => {
    assert.equal(getTickerPlaceholder("leveraged"), "00631L / 00685L / SSO / QLD");
    assert.equal(getTickerPlaceholder("original"), "0050 / 006208 / VOO / QQQ");
    assert.equal(getTickerPlaceholder("cashEquivalent"), "00865B / 00859B / SGOV / BSV");
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
