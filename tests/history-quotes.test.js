import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alignHistoricalPricesToDates,
  createDateRange,
  mergeHistoricalPriceObservations,
  parseTwseHistoricalPrices,
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

  it("parses official TWSE monthly closing prices", () => {
    const prices = parseTwseHistoricalPrices({
      fields: ["日期", "成交股數", "成交金額", "開盤價", "最高價", "最低價", "收盤價"],
      data: [
        ["115/08/19", "100", "1000", "103.05", "103.85", "102.70", "103.10"],
        ["115/08/20", "100", "1000", "104.20", "104.25", "102.95", "103.80"],
      ],
    });

    assert.deepEqual(prices.map(({ date, price, source }) => ({ date, price, source })), [
      { date: "2026-08-19", price: 103.1, source: "TWSE" },
      { date: "2026-08-20", price: 103.8, source: "TWSE" },
    ]);
  });

  it("uses official TWSE prices to replace a missing Yahoo trading day", () => {
    const merged = mergeHistoricalPriceObservations(
      [{ date: "2026-08-19", price: 103.1, source: "Yahoo Finance" }],
      [
        { date: "2026-08-19", price: 103.1, source: "TWSE" },
        { date: "2026-08-20", price: 103.8, source: "TWSE" },
      ],
    );

    assert.deepEqual(merged.map(({ date, price, source }) => ({ date, price, source })), [
      { date: "2026-08-19", price: 103.1, source: "TWSE" },
      { date: "2026-08-20", price: 103.8, source: "TWSE" },
    ]);
  });

  it("creates inclusive date ranges", () => {
    assert.deepEqual(createDateRange("2026-07-21", "2026-07-23"), [
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
  });
});
