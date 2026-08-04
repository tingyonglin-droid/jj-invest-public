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
        leveragedTradeAmountTwd: 289600,
        originalTradeAmountTwd: -447962,
        cashTradeAmountTwd: 158362,
      }),
      {
        headline: "提高曝險",
        classActions: [
          "正二：買入 NT$289,600",
          "原形：賣出 NT$447,962",
          "現金：增加 NT$158,362",
        ],
        tone: "buy",
      },
    );
  });
});
