import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBenchmarkDrawdownChart,
  filterBenchmarkHistoryByRange,
  getNearestMarketPointIndex,
  getMarketLevelLabel,
  toggleActiveMarketPoint,
} from "../src/lib/benchmark-drawdown-chart.js";
import * as benchmarkChart from "../src/lib/benchmark-drawdown-chart.js";

describe("benchmark drawdown chart", () => {
  it("filters market history into 1M, 3M, 6M, and 1Y windows ending on the current date", () => {
    const history = [
      { date: "2025-08-08", price: 80 },
      { date: "2025-08-11", price: 81 },
      { date: "2026-02-10", price: 90 },
      { date: "2026-05-11", price: 95 },
      { date: "2026-07-10", price: 100 },
      { date: "2026-08-10", price: 104 },
    ];

    assert.deepEqual(filterBenchmarkHistoryByRange(history, "2026-08-10", "1M").map(({ date }) => date), ["2026-07-10", "2026-08-10"]);
    assert.deepEqual(filterBenchmarkHistoryByRange(history, "2026-08-10", "3M").map(({ date }) => date), ["2026-05-11", "2026-07-10", "2026-08-10"]);
    assert.deepEqual(filterBenchmarkHistoryByRange(history, "2026-08-10", "6M").map(({ date }) => date), ["2026-02-10", "2026-05-11", "2026-07-10", "2026-08-10"]);
    assert.deepEqual(filterBenchmarkHistoryByRange(history, "2026-08-10", "1Y").map(({ date }) => date), ["2025-08-11", "2026-02-10", "2026-05-11", "2026-07-10", "2026-08-10"]);
  });

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
    assert.deepEqual(
      model.points.map(({ percentLabelY }) => percentLabelY),
      [71.42, 171.42, 271.42, 336],
    );
    assert.equal(model.points[0].x, 92);
    assert.equal(model.points.at(-1).x, 718);
    assert.equal(model.linePoints, "92,40 300.67,140 509.33,240 718,340");
  });

  it("extends the vertical scale by ten-percent steps for drawdowns below thirty percent", () => {
    const model = createBenchmarkDrawdownChart(
      [
        { date: "2026-07-31", price: 112, drawdownRatio: 0.02, level: "normal" },
        { date: "2026-08-03", price: 65, drawdownRatio: -0.42, level: "deep" },
      ],
      111.15,
    );

    assert.equal(model.scaleMin, -0.5);
    assert.deepEqual(model.points.map(({ y }) => y), [40, 292]);
    assert.deepEqual(model.thresholds, [
      { ratio: 0, y: 40, price: 111.15 },
      { ratio: -0.1, y: 100, price: 100.04 },
      { ratio: -0.2, y: 160, price: 88.92 },
    ]);
    assert.deepEqual(model.bands, [
      { level: "normal", top: 40, bottom: 100 },
      { level: "prepare", top: 100, bottom: 160 },
      { level: "deep", top: 160, bottom: 340 },
    ]);
    assert.deepEqual(model.scaleFloor, { ratio: -0.5, y: 340 });
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

  it("moves percentage labels farther from descending lines while keeping them inside their band", () => {
    const model = createBenchmarkDrawdownChart([
      { date: "2026-08-03", price: 96, drawdownRatio: -0.04, level: "normal" },
      { date: "2026-08-04", price: 96, drawdownRatio: -0.04, level: "normal" },
      { date: "2026-08-05", price: 90.1, drawdownRatio: -0.099, level: "normal" },
    ], 100);

    assert.equal(model.points[0].percentLabelY, 98);
    assert.ok(model.points[1].percentLabelY > model.points[0].percentLabelY);
    assert.equal(model.points[2].percentLabelY, 136);
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
    assert.equal(model.edgeLabelInset, 40);
    assert.equal(model.bandInset, 32);
    assert.equal(model.dateLabelY, 362);
    assert.equal(model.points.length, 24);
    assert.equal(model.width, 1146);
    assert.equal(model.height, 400);
    assert.equal(model.viewBox, "0 0 1146 400");
    assert.ok(model.points[1].x - model.points[0].x >= 44);
    assert.equal(model.points[0].showDateLabel, true);
    assert.equal(model.points.at(-1).showDateLabel, true);
    assert.equal(model.plot.right, model.width - 42);
    assert.equal(overview.mode, "overview");
    assert.equal(overview.edgeLabelInset, 40);
    assert.equal(overview.bandInset, 32);
    assert.equal(overview.dateLabelY, 362);
    assert.equal(overview.width, 760);
    assert.equal(overview.points.length, 24);
    assert.deepEqual(
      overview.points.map(({ price, drawdownRatio, y }) => ({ price, drawdownRatio, y })),
      model.points.map(({ price, drawdownRatio, y }) => ({ price, drawdownRatio, y })),
    );
    assert.equal(overview.points[0].showDateLabel, true);
    assert.equal(overview.points.at(-1).showDateLabel, true);
    assert.equal(
      overview.points.filter(({ showPercentLabel }) => showPercentLabel).length,
      0,
    );
    const overviewDateLabels = overview.points.filter(({ showDateLabel }) => showDateLabel);
    assert.ok(overviewDateLabels.length >= 4);
    assert.ok(overviewDateLabels.length <= 5);
    assert.equal(overviewDateLabels[0].date, history[0].date);
    assert.equal(overviewDateLabels.at(-1).date, history.at(-1).date);
    assert.equal(
      model.points.filter(({ showPercentLabel }) => showPercentLabel).length,
      history.length,
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
    assert.equal(loadedModel.scrollKey, "1:2026-06-22:2026-06-22");

    const restartedModel = createBenchmarkDrawdownChart(
      [{ date: "2026-07-01", price: 100, drawdownRatio: 0, level: "normal" }],
      100,
    );
    assert.notEqual(loadedModel.scrollKey, restartedModel.scrollKey);
  });

  it("opens, switches, and closes one active point at a time", () => {
    assert.equal(toggleActiveMarketPoint(null, 2), 2);
    assert.equal(toggleActiveMarketPoint(2, 5), 5);
    assert.equal(toggleActiveMarketPoint(5, 5), null);
  });

  it("selects the nearest overview point from a rendered chart coordinate", () => {
    const points = [{ x: 92 }, { x: 405 }, { x: 718 }];
    assert.equal(getNearestMarketPointIndex(points, 100), 0);
    assert.equal(getNearestMarketPointIndex(points, 390), 1);
    assert.equal(getNearestMarketPointIndex(points, 700), 2);
    assert.equal(getNearestMarketPointIndex([], 100), null);
  });

  it("targets the newest edge when the chart is wider than its viewport", () => {
    assert.equal(typeof benchmarkChart.getMarketChartScrollLeft, "function");
    assert.equal(benchmarkChart.getMarketChartScrollLeft(1840, "detail"), 1840);
    assert.equal(benchmarkChart.getMarketChartScrollLeft(1840, "overview"), 0);
    assert.equal(benchmarkChart.getMarketChartScrollLeft(0, "detail"), 0);
    assert.equal(benchmarkChart.getMarketChartScrollLeft(Number.NaN, "detail"), 0);
  });

  it("returns the user-facing market level labels", () => {
    assert.equal(getMarketLevelLabel("normal"), "正常區間");
    assert.equal(getMarketLevelLabel("prepare"), "觀察區間");
    assert.equal(getMarketLevelLabel("deep"), "股災區間");
    assert.equal(getMarketLevelLabel("unknown"), "市場水位");
  });
});
