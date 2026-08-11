import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  convertQuoteToTwd,
  fetchYahooQuote,
  parseTwseQuote,
  normalizeTicker,
  toTpexChannel,
} from "../src/lib/market-data.js";

describe("market data helpers", () => {
  it("normalizes bare Taiwan tickers to Yahoo Finance TW symbols", () => {
    assert.equal(normalizeTicker("00631L"), "00631L.TW");
  });

  it("keeps US tickers unchanged when normalizing", () => {
    assert.equal(normalizeTicker("QLD"), "QLD");
  });

  it("creates a TPEx quote channel for over-the-counter Taiwan ETFs", () => {
    assert.equal(toTpexChannel("00859B.TW"), "otc_00859B.tw");
    assert.equal(toTpexChannel("00864B.TWO"), "otc_00864B.tw");
  });

  it("falls back from TWSE to TPEx before querying Yahoo Finance", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls = [];
    globalThis.fetch = async (url) => {
      requestedUrls.push(String(url));
      if (requestedUrls.length === 1) {
        return new Response(JSON.stringify({ msgArray: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        msgArray: [{ c: "00859B", d: "20260811", z: "41.65", y: "41.61" }],
      }), { status: 200 });
    };

    try {
      const quote = await fetchYahooQuote("00859B.TW");
      assert.equal(quote.price, 41.65);
      assert.equal(quote.source, "TPEx");
      assert.match(requestedUrls[0], /ex_ch=tse_00859B\.tw/);
      assert.match(requestedUrls[1], /ex_ch=otc_00859B\.tw/);
      assert.equal(requestedUrls.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it("uses TWSE best bid and ask midpoint when last trade price is unavailable intraday", () => {
    assert.deepEqual(
      parseTwseQuote({
        c: "00631L",
        d: "20260708",
        t: "10:09:59",
        z: "-",
        a: "36.5900_36.6000_",
        b: "36.5800_36.5700_",
        y: "37.19",
      }),
      {
        price: 36.585,
        date: "2026-07-08",
        currency: "TWD",
        source: "TWSE",
        error: null,
      },
    );
  });
}
);
