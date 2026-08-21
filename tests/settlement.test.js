import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeSettlementCurrency,
  roundSettlementMoney,
} from "../src/lib/settlement.js";

describe("settlement currency", () => {
  it("normalizes only supported settlement currencies", () => {
    assert.equal(normalizeSettlementCurrency("usd"), "USD");
    assert.equal(normalizeSettlementCurrency("TWD"), "TWD");
    assert.equal(normalizeSettlementCurrency("EUR"), null);
  });

  it("rounds local cash using currency precision", () => {
    assert.equal(roundSettlementMoney(123.456, "USD"), 123.46);
    assert.equal(roundSettlementMoney(123.456, "TWD"), 123);
  });
});
