import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  convertQuoteToTwd,
  parseTwseQuote,
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

  it("parses TWSE current trade prices for listed Taiwan tickers", () => {
    assert.deepEqual(
      parseTwseQuote({
        c: "00631L",
        d: "20260708",
        z: "37.80",
        y: "37.19",
      }),
      {
        price: 37.8,
        date: "2026-07-08",
        currency: "TWD",
        source: "TWSE",
        error: null,
      },
    );
  });

  it("falls back to TWSE previous close before the market opens", () => {
    assert.deepEqual(
      parseTwseQuote({
        c: "00685L",
        d: "20260708",
        z: "-",
        y: "12.23",
      }),
      {
        price: 12.23,
        date: "2026-07-07",
        currency: "TWD",
        source: "TWSE",
        error: null,
      },
    );
  });
}
);
