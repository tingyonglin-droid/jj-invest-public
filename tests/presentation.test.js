import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOperationListText,
  getOperationSummary,
  getPositionDisplayName,
  getTickerDisplayText,
  getTickerPlaceholder,
  getTickerBadgeText,
  getTickerDefaultAssetBeta,
  formatExposureMultiplier,
  getHoldingActionPresentation,
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
    assert.equal(getPositionDisplayName("009816.TW", 1), "凱基台灣TOP50");
    assert.equal(getPositionDisplayName(" 009816.tw ", 1), "凱基台灣TOP50");
    assert.equal(getPositionDisplayName("SSO", 2), "ProShares Ultra S&P500");
    assert.equal(getPositionDisplayName("VOO", 1), "Vanguard S&P 500 ETF");
    assert.equal(getPositionDisplayName("QQQ", 1), "Invesco QQQ Trust ETF");
    assert.equal(getPositionDisplayName("QQQI", 1), "NEOS Nasdaq-100 High Income ETF");
    assert.equal(getPositionDisplayName("BOXX", 0), "Alpha Architect 1-3 Month Box ETF");
    assert.equal(getPositionDisplayName("SMH", 1), "VanEck Semiconductor ETF");
    assert.equal(getPositionDisplayName("SOXX", 1), "iShares Semiconductor ETF");
    assert.equal(getPositionDisplayName("USD", 2), "ProShares Ultra Semiconductors");
    assert.equal(getPositionDisplayName("QLD"), "ProShares Ultra QQQ");
    assert.equal(getPositionDisplayName("SOXL", 3), "Direxion Daily Semiconductor Bull 3X ETF");
  });

  it("falls back to generic asset labels by asset beta", () => {
    assert.equal(getPositionDisplayName("2330.TW", 1), "原形標的");
    assert.equal(getPositionDisplayName("2330.TW", 2), "槓桿標的");
  });

  it("provides a known ticker multiplier without preventing manual overrides", () => {
    assert.equal(getTickerDefaultAssetBeta("SOXL"), 3);
    assert.equal(getTickerDefaultAssetBeta("TQQQ"), 3);
    assert.equal(getTickerDefaultAssetBeta("NTSD"), 1.5);
    assert.equal(getTickerDefaultAssetBeta("QLD"), 2);
    assert.equal(getTickerDefaultAssetBeta("00631L"), 2);
    assert.equal(getTickerDefaultAssetBeta("00631L.TW"), 2);
    assert.equal(getTickerDefaultAssetBeta("QQQI"), 1);
    assert.equal(getTickerDefaultAssetBeta("UNKNOWN"), null);
  });

  it("formats compact exposure multiplier labels", () => {
    assert.equal(formatExposureMultiplier(1.5), "1.5×");
    assert.equal(formatExposureMultiplier(2), "2×");
    assert.equal(formatExposureMultiplier(3), "3×");
  });

  it("shows asset-specific ticker examples in settings", () => {
    assert.equal(getTickerPlaceholder("leveraged"), "00631L / 00685L / QLD / SOXL");
    assert.equal(getTickerPlaceholder("original"), "0050 / 006208 / VOO / QQQ");
    assert.equal(getTickerPlaceholder("cashEquivalent"), "00865B / 00859B / SGOV / BOXX");
  });

  it("creates compact badge text from tickers", () => {
    assert.equal(getTickerBadgeText("00631L.TW"), "2x");
    assert.equal(getTickerBadgeText("QLD"), "QLD");
  });

  it("formats normalized tickers for user-facing text", () => {
    assert.equal(getTickerDisplayText("00631L.TW"), "00631L");
    assert.equal(getTickerDisplayText("00864B.TWO"), "00864B");
    assert.equal(getTickerDisplayText(" qld "), "QLD");
    assert.equal(getTickerDisplayText(), "");
  });

  it("creates a copyable operation list from recommendations", () => {
    const text = createOperationListText([
      {
        normalizedTicker: "00631L.TW",
        action: "sell",
        currency: "TWD",
        tradeAmountTwd: -10000,
        price: 40,
        priceTwd: 40,
      },
      {
        normalizedTicker: "QLD",
        action: "buy",
        currency: "USD",
        tradeAmountTwd: 19200,
        price: 300,
        priceTwd: 9600,
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
        "00631L 賣出 NT$10,000，約 250 股",
        "QLD 買入 US$600.00（約 NT$19,200），2 股",
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

  it("hides zero trade amounts for unselected and unchanged holdings", () => {
    assert.deepEqual(
      getHoldingActionPresentation({ isSelected: false, action: "buy", estimatedShares: 10 }),
      {
        displayedAction: "none",
        actionSummaryText: "不納入再平衡清單",
        showAmount: false,
      },
    );
    assert.deepEqual(
      getHoldingActionPresentation({ isSelected: true, action: "none", estimatedShares: 0 }),
      {
        displayedAction: "none",
        actionSummaryText: "不動作",
        showAmount: false,
      },
    );
    assert.deepEqual(
      getHoldingActionPresentation({ isSelected: true, action: "buy", estimatedShares: 12 }),
      {
        displayedAction: "buy",
        actionSummaryText: "買入 12 股",
        showAmount: true,
      },
    );
  });
});
