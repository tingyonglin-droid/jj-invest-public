import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateCashTwdValue } from "../src/lib/cash.js";

describe("cash helpers", () => {
  it("adds TWD cash and USD cash converted to TWD", () => {
    assert.equal(
      calculateCashTwdValue({
        cashTwd: 12000,
        cashUsd: 1000,
        usdTwd: 31.5,
      }),
      43500,
    );
  });

  it("uses only TWD cash when no valid FX rate is available", () => {
    assert.equal(
      calculateCashTwdValue({
        cashTwd: 12000,
        cashUsd: 1000,
        usdTwd: null,
      }),
      12000,
    );
  });
});
