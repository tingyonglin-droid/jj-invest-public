import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAdviceActionText,
  createAdviceDisplay,
} from "../src/lib/advice-summary.js";

describe("advice summary helpers", () => {
  it("formats action and amount on one line", () => {
    assert.equal(
      createAdviceActionText({ label: "賣出", amount: "NT$1,777,866" }),
      "賣出 NT$1,777,866",
    );
  });

  it("omits the amount when there is no amount text", () => {
    assert.equal(
      createAdviceActionText({ label: "無需操作", amount: "" }),
      "無需操作",
    );
  });

  it("uses beta direction as the headline and net cash flow as supporting text", () => {
    assert.deepEqual(
      createAdviceDisplay({
        betaBoundaryLabel: "低於下限",
        totalTradeAmountTwd: -158362,
        recommendations: [
          { action: "buy", tradeAmountTwd: 289600, assetBeta: 2 },
          { action: "sell", tradeAmountTwd: -233000, assetBeta: 1 },
          { action: "sell", tradeAmountTwd: -122000, assetBeta: 1 },
          { action: "sell", tradeAmountTwd: -92962, assetBeta: 1 },
        ],
      }),
      {
        headline: "提高曝險",
        netFlowText: "淨調整：賣出 NT$158,362",
        primaryActionText: "主要動作：賣出原形、買入正二",
        tone: "buy",
      },
    );
  });
});
