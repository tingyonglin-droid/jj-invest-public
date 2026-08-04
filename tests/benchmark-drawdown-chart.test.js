import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBenchmarkDrawdownChart,
  getMarketLevelLabel,
  toggleActiveMarketPoint,
} from "../src/lib/benchmark-drawdown-chart.js";
import * as benchmarkChart from "../src/lib/benchmark-drawdown-chart.js";

describe("benchmark drawdown chart", () => {
  it("maps drawdown boundaries into a fixed comparable vertical scale", () => {
    const model = createBenchmarkDrawdownChart(
      [
        { date: "2026-07-29", price: 100, drawdownRatio: 0, level: "normal" },
        { date: "2026-07-30", price: 90, drawdownRatio: -0.1, level: "prepare" },
        { date: "2026-07-31", price: 80, drawdownRatio: -0.2, level: "deep" },
        { date: "2026-08-03", price: 70, drawdownRatio: -0.3, level: "deep" },
      ],
      100,
    );

    assert.deepEqual(model.points.map(({ y }) => y), [40, 140, 240, 340]);
    assert.equal(model.points[0].x, 92);
    assert.equal(model.points.at(-1).x, 718);
    assert.equal(model.linePoints, "92,40 300.67,140 509.33,240 718,340");
  });

  it("clamps only visual positions and calculates literal threshold prices", () => {
    const model = createBenchmarkDrawdownChart(
      [
        { date: "2026-07-31", price: 112, drawdownRatio: 0.02, level: "normal" },
        { date: "2026-08-03", price: 65, drawdownRatio: -0.42, level: "deep" },
      ],
      111.15,
    );

    assert.deepEqual(model.points.map(({ y }) => y), [40, 340]);
    assert.deepEqual(model.thresholds, [
      { ratio: 0, y: 40, price: 111.15 },
      { ratio: -0.1, y: 140, price: 100.04 },
      { ratio: -0.2, y: 240, price: 88.92 },
    ]);
  });

  it("keeps edge tooltips inside the plot and spaces seven points evenly", () => {
    const history = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-07-${String(index + 21).padStart(2, "0")}`,
      price: 100 - index,
      drawdownRatio: -index / 100,
      level: "normal",
    }));
    const model = createBenchmarkDrawdownChart(history, 100);

    assert.deepEqual(model.points.map(({ x }) => x), [92, 196.33, 300.67, 405, 509.33, 613.67, 718]);
    assert.equal(model.points[0].tooltipAnchor, "start");
    assert.equal(model.points[0].tooltipX, 104);
    assert.equal(model.points[3].tooltipAnchor, "middle");
    assert.equal(model.points.at(-1).tooltipAnchor, "end");
    assert.equal(model.points.at(-1).tooltipX, 706);
  });

  it("grows wide charts without dropping trading dates", () => {
    const history = Array.from({ length: 24 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      price: 100 - index,
      drawdownRatio: -index / 100,
      level: index < 10 ? "normal" : index < 20 ? "prepare" : "deep",
    }));
    const model = createBenchmarkDrawdownChart(history, 100, { mode: "detail" });
    const overview = createBenchmarkDrawdownChart(history, 100, { mode: "overview" });

    assert.equal(model.mode, "detail");
    assert.equal(model.points.length, 24);
    assert.equal(model.width, 1146);
    assert.equal(model.height, 430);
    assert.equal(model.viewBox, "0 0 1146 430");
    assert.ok(model.points[1].x - model.points[0].x >= 44);
    assert.equal(model.points[0].showDateLabel, true);
    assert.equal(model.points.at(-1).showDateLabel, true);
    assert.equal(model.plot.right, model.width - 42);
    assert.equal(overview.mode, "overview");
    assert.equal(overview.width, 760);
    assert.equal(overview.points.length, 24);
    assert.deepEqual(
      overview.points.map(({ price, drawdownRatio, y }) => ({ price, drawdownRatio, y })),
      model.points.map(({ price, drawdownRatio, y }) => ({ price, drawdownRatio, y })),
    );
    assert.equal(overview.points[0].showDateLabel, true);
    assert.equal(overview.points.at(-1).showDateLabel, true);
    assert.ok(
      overview.points.filter(({ showPercentLabel }) => showPercentLabel).length <
        model.points.filter(({ showPercentLabel }) => showPercentLabel).length,
    );
  });

  it("changes the scroll key when short-chart data arrives at the same width", () => {
    const emptyModel = createBenchmarkDrawdownChart([], 100);
    const loadedModel = createBenchmarkDrawdownChart(
      [{ date: "2026-06-22", price: 100, drawdownRatio: 0, level: "normal" }],
      100,
    );

    assert.equal(emptyModel.width, loadedModel.width);
    assert.notEqual(emptyModel.scrollKey, loadedModel.scrollKey);
    assert.equal(loadedModel.scrollKey, "1:2026-06-22");
  });

  it("opens, switches, and closes one active point at a time", () => {
    assert.equal(toggleActiveMarketPoint(null, 2), 2);
    assert.equal(toggleActiveMarketPoint(2, 5), 5);
    assert.equal(toggleActiveMarketPoint(5, 5), null);
  });

  it("targets the newest edge when the chart is wider than its viewport", () => {
    assert.equal(typeof benchmarkChart.getMarketChartScrollLeft, "function");
    assert.equal(benchmarkChart.getMarketChartScrollLeft(1840), 1840);
    assert.equal(benchmarkChart.getMarketChartScrollLeft(0), 0);
    assert.equal(benchmarkChart.getMarketChartScrollLeft(Number.NaN), 0);
  });

  it("returns the user-facing market level labels", () => {
    assert.equal(getMarketLevelLabel("normal"), "正常區間");
    assert.equal(getMarketLevelLabel("prepare"), "觀察區間");
    assert.equal(getMarketLevelLabel("deep"), "股災區間");
    assert.equal(getMarketLevelLabel("unknown"), "市場水位");
  });
});
