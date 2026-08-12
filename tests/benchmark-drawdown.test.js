import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBenchmarkDrawdown } from "../src/lib/benchmark-drawdown.js";

describe("benchmark drawdown", () => {
  it("calculates current drawdown from the highest historical closing price", () => {
    const drawdown = createBenchmarkDrawdown([
      { date: "2026-06-19", price: 250 },
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
      currentSource: "close",
      fullHistory: [
        { date: "2026-06-19", price: 250, drawdownRatio: 0, level: "normal" },
        { date: "2026-06-23", price: 260.1, drawdownRatio: 0, level: "normal" },
        { date: "2026-07-23", price: 244.18, drawdownRatio: -0.061207, level: "normal" },
      ],
      history: [
        { date: "2026-06-23", price: 260.1, drawdownRatio: 0, level: "normal" },
        { date: "2026-07-23", price: 244.18, drawdownRatio: -0.061207, level: "normal" },
      ],
    });
  });

  it("calculates each historical point from the highest close available on that date", () => {
    const drawdown = createBenchmarkDrawdown([
      { date: "2025-08-11", price: 50 },
      { date: "2025-08-12", price: 45 },
      { date: "2026-06-22", price: 100 },
      { date: "2026-08-10", price: 70 },
    ]);

    assert.deepEqual(
      drawdown.fullHistory.map(({ date, drawdownRatio }) => ({ date, drawdownRatio })),
      [
        { date: "2025-08-11", drawdownRatio: 0 },
        { date: "2025-08-12", drawdownRatio: -0.1 },
        { date: "2026-06-22", drawdownRatio: 0 },
        { date: "2026-08-10", drawdownRatio: -0.3 },
      ],
    );
  });

  it("normalizes an unadjusted four-for-one split segment before finding historical highs", () => {
    const drawdown = createBenchmarkDrawdown([
      { date: "2011-01-28", price: 63 },
      { date: "2013-12-31", price: 58.7 },
      { date: "2014-01-02", price: 14.6375 },
      { date: "2025-08-13", price: 53.35 },
      { date: "2025-08-19", price: 53.2 },
    ]);

    assert.equal(drawdown.fullHistory[0].price, 15.75);
    assert.equal(drawdown.fullHistory[1].price, 14.675);
    assert.equal(drawdown.fullHistory.at(-1).drawdownRatio, -0.002812);
  });

  it("uses live 0050 quote as the current market level when available", () => {
    const drawdown = createBenchmarkDrawdown(
      [
        { date: "2026-06-19", price: 250 },
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
      currentSource: "live",
      fullHistory: [
        { date: "2026-06-19", price: 250, drawdownRatio: 0, level: "normal" },
        { date: "2026-06-23", price: 260, drawdownRatio: 0, level: "normal" },
        { date: "2026-07-23", price: 258, drawdownRatio: -0.007692, level: "normal" },
        { date: "2026-07-24", price: 244.4, drawdownRatio: -0.06, level: "normal" },
      ],
      history: [
        { date: "2026-06-23", price: 260, drawdownRatio: 0, level: "normal" },
        { date: "2026-07-23", price: 258, drawdownRatio: -0.007692, level: "normal" },
        { date: "2026-07-24", price: 244.4, drawdownRatio: -0.06, level: "normal" },
      ],
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

  it("keeps every trading date from the latest historical closing high", () => {
    const drawdown = createBenchmarkDrawdown([
      { date: "2026-06-19", price: 99 },
      { date: "2026-06-22", price: 100 },
      { date: "2026-06-23", price: 99 },
      { date: "2026-06-24", price: 98 },
      { date: "2026-06-25", price: 97 },
      { date: "2026-06-26", price: 96 },
      { date: "2026-06-29", price: 95 },
      { date: "2026-06-30", price: 93 },
      { date: "2026-06-30", price: 94 },
      { date: "2026-07-01", price: 93 },
      { date: "", price: 500 },
      { date: "2026-06-27", price: 500 },
    ]);

    assert.equal(drawdown.highDate, "2026-06-22");
    assert.deepEqual(drawdown.history.map(({ date }) => date), [
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
    ]);
    assert.equal(drawdown.history.at(-2).price, 94);
    assert.equal(drawdown.history.at(-1).drawdownRatio, -0.07);
  });

  it("restarts at the latest date that matches the highest close", () => {
    const drawdown = createBenchmarkDrawdown([
      { date: "2026-06-22", price: 100 },
      { date: "2026-06-23", price: 98 },
      { date: "2026-07-02", price: 100 },
      { date: "2026-07-03", price: 97 },
    ]);

    assert.equal(drawdown.highDate, "2026-07-02");
    assert.deepEqual(drawdown.history.map(({ date }) => date), ["2026-07-02", "2026-07-03"]);
  });

  it("replaces the same-date close with a live quote without redefining the closing high", () => {
    const drawdown = createBenchmarkDrawdown(
      [
        { date: "2026-06-22", price: 100 },
        { date: "2026-08-03", price: 91 },
      ],
      { currentQuote: { date: "2026-08-03", price: 102, source: "TWSE" } },
    );

    assert.equal(drawdown.highPrice, 100);
    assert.equal(drawdown.highDate, "2026-06-22");
    assert.equal(drawdown.drawdownRatio, 0.02);
    assert.equal(drawdown.currentSource, "live");
    assert.deepEqual(drawdown.history, [
      { date: "2026-06-22", price: 100, drawdownRatio: 0, level: "normal" },
      { date: "2026-08-03", price: 102, drawdownRatio: 0.02, level: "normal" },
    ]);
  });

  it("excludes weekend carry-forwards and closes later than the live quote date", () => {
    const drawdown = createBenchmarkDrawdown(
      [
        { date: "2026-07-31", price: 100 },
        { date: "2026-08-01", price: 100 },
        { date: "2026-08-02", price: 100 },
        { date: "2026-08-03", price: 99 },
        { date: "2026-08-04", price: 99 },
      ],
      { currentQuote: { date: "2026-08-03", price: 98, source: "TWSE" } },
    );

    assert.deepEqual(drawdown.history, [
      { date: "2026-07-31", price: 100, drawdownRatio: 0, level: "normal" },
      { date: "2026-08-03", price: 98, drawdownRatio: -0.02, level: "normal" },
    ]);
  });
});
