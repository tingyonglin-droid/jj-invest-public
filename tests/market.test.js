import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  convertQuoteToTwd,
  normalizeTicker,
} from "../src/lib/market-data.js";

describe("market data helpers", () => {
  it("normalizes bare Taiwan tickers to Yahoo Finance TW symbols", () => {
    assert.equal(normalizeTicker("00631L"), "00631L.TW");
  });

  it("keeps US tickers unchanged when normalizing", () => {
    assert.equal(normalizeTicker("QLD"), "QLD");
  });

  it("converts USD quote prices to TWD with the USD/TWD rate", () => {
    assert.deepEqual(
      convertQuoteToTwd({ price: 100, currency: "USD" }, 31.5),
      {
        priceTwd: 3150,
        error: null,
      },
    );
  });

  it("keeps TWD quote prices as TWD values", () => {
    assert.deepEqual(
      convertQuoteToTwd({ price: 42.25, currency: "TWD" }, 31.5),
      {
        priceTwd: 42.25,
        error: null,
      },
    );
  });
}
);
