import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBenchmarkDrawdown } from "../src/lib/benchmark-drawdown.js";

describe("benchmark drawdown", () => {
  it("calculates current drawdown from the highest historical closing price", () => {
    const drawdown = createBenchmarkDrawdown([
      { date: "2026-06-21", price: 250 },
      { date: "2026-06-23", price: 260.1 },
      { date: "2026-07-23", price: 244.18 },
    ]);

    assert.deepEqual(drawdown, {
      currentDate: "2026-07-23",
      currentPrice: 244.18,
      highDate: "2026-06-23",
      highPrice: 260.1,
      drawdownRatio: -0.061207,
      level: "normal",
    });
  });

  it("uses live 0050 quote as the current market level when available", () => {
    const drawdown = createBenchmarkDrawdown(
      [
        { date: "2026-06-21", price: 250 },
        { date: "2026-06-23", price: 260 },
        { date: "2026-07-23", price: 258 },
      ],
      {
        currentQuote: { date: "2026-07-24", price: 244.4, source: "TWSE" },
      },
    );

    assert.deepEqual(drawdown, {
      currentDate: "2026-07-24",
      currentPrice: 244.4,
      highDate: "2026-06-23",
      highPrice: 260,
      drawdownRatio: -0.06,
      level: "normal",
    });
  });

  it("classifies drawdown ranges for market context coloring", () => {
    assert.equal(
      createBenchmarkDrawdown([
        { date: "2026-06-23", price: 260 },
        { date: "2026-07-23", price: 234 },
      ]).level,
      "prepare",
    );
    assert.equal(
      createBenchmarkDrawdown([
        { date: "2026-06-23", price: 260 },
        { date: "2026-07-23", price: 208 },
      ]).level,
      "deep",
    );
  });

  it("ignores invalid prices and returns null when no usable close exists", () => {
    assert.equal(
      createBenchmarkDrawdown([
        { date: "2026-07-21", price: null },
        { date: "2026-07-22", price: 0 },
      ]),
      null,
    );
  });
});
