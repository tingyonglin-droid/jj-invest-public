import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alignHistoricalPricesToDates,
  createDateRange,
  parseYahooHistoricalPrices,
} from "../src/lib/market-data.js";

describe("historical market data", () => {
  it("parses Yahoo chart close prices into dated historical prices", () => {
    const prices = parseYahooHistoricalPrices(
      {
        chart: {
          result: [
            {
              timestamp: [1784592000, 1784678400, 1784764800],
              meta: { currency: "TWD" },
              indicators: {
                quote: [
                  {
                    close: [100, null, 102.5],
                  },
                ],
              },
            },
          ],
        },
      },
      "0050.TW",
    );

    assert.deepEqual(prices, [
      {
        date: "2026-07-21",
        price: 100,
        currency: "TWD",
        source: "Yahoo Finance",
      },
      {
        date: "2026-07-23",
        price: 102.5,
        currency: "TWD",
        source: "Yahoo Finance",
      },
    ]);
  });

  it("aligns non-trading dates to the previous available close", () => {
    const aligned = alignHistoricalPricesToDates(
      [
        { date: "2026-07-17", price: 98 },
        { date: "2026-07-20", price: 100 },
        { date: "2026-07-21", price: 101 },
      ],
      ["2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21"],
    );

    assert.deepEqual(aligned.map((item) => item.price), [98, 98, 100, 101]);
  });

  it("creates inclusive date ranges", () => {
    assert.deepEqual(createDateRange("2026-07-21", "2026-07-23"), [
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
  });
});
