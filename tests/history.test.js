import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDemoHistoryRecords,
  createHistoryChartModel,
  createHistorySnapshot,
  createHistorySummary,
  createPerformanceSeries,
  getTaipeiDateKey,
  mergeDemoHistoryRecords,
  upsertDailyHistorySnapshot,
} from "../src/lib/history.js";

describe("history snapshots", () => {
  it("creates a daily snapshot from a valid portfolio calculation and 0050 price", () => {
    const snapshot = createHistorySnapshot({
      date: "2026-07-23",
      calculation: {
        isValid: true,
        totalAssetsTwd: 1000000,
        currentBeta: 1.18,
        targetBeta: 1.2,
        betaLower: 1.08,
        betaUpper: 1.32,
        leveragedValueTwd: 600000,
        originalValueTwd: 200000,
        cashTwd: 200000,
      },
      benchmark0050Price: 250,
    });

    assert.deepEqual(snapshot, {
      date: "2026-07-23",
      totalAssetsTwd: 1000000,
      currentBeta: 1.18,
      targetBeta: 1.2,
      betaLower: 1.08,
      betaUpper: 1.32,
      leveragedValueTwd: 600000,
      originalValueTwd: 200000,
      cashTwd: 200000,
      benchmark0050Price: 250,
    });
  });

  it("does not create a snapshot when calculation or benchmark data is invalid", () => {
    assert.equal(
      createHistorySnapshot({
        date: "2026-07-23",
        calculation: { isValid: false, totalAssetsTwd: 1000000 },
        benchmark0050Price: 250,
      }),
      null,
    );
    assert.equal(
      createHistorySnapshot({
        date: "2026-07-23",
        calculation: { isValid: true, totalAssetsTwd: 1000000 },
        benchmark0050Price: null,
      }),
      null,
    );
  });

  it("overwrites the same date, sorts by date, and keeps the latest 365 snapshots", () => {
    const startDate = new Date("2025-07-01T00:00:00Z");
    const records = Array.from({ length: 366 }, (_, index) => ({
      date: new Date(startDate.getTime() + index * 86400000).toISOString().slice(0, 10),
      totalAssetsTwd: index,
      currentBeta: 1,
      targetBeta: 1,
      betaLower: 0.9,
      betaUpper: 1.1,
      leveragedValueTwd: 0,
      originalValueTwd: 0,
      cashTwd: 0,
      benchmark0050Price: 100,
    }));
    const result = upsertDailyHistorySnapshot(records, {
      ...records[200],
      totalAssetsTwd: 999999,
    });

    assert.equal(result.length, 365);
    assert.equal(result[0].date, "2025-07-02");
    assert.equal(result.find((item) => item.date === records[200].date).totalAssetsTwd, 999999);
  });

  it("creates same-start performance series for portfolio and 0050", () => {
    const series = createPerformanceSeries([
      { date: "2026-07-21", totalAssetsTwd: 1000000, benchmark0050Price: 100 },
      { date: "2026-07-22", totalAssetsTwd: 1100000, benchmark0050Price: 105 },
      { date: "2026-07-23", totalAssetsTwd: 900000, benchmark0050Price: 95 },
    ]);

    assert.deepEqual(series.map((item) => item.portfolioReturn), [0, 0.1, -0.1]);
    assert.deepEqual(series.map((item) => item.benchmarkReturn), [0, 0.05, -0.05]);
  });

  it("creates summary and chart models for history UI", () => {
    const records = [
      {
        date: "2026-07-21",
        totalAssetsTwd: 1000000,
        currentBeta: 1.1,
        targetBeta: 1.2,
        betaLower: 1.08,
        betaUpper: 1.32,
        benchmark0050Price: 100,
      },
      {
        date: "2026-07-22",
        totalAssetsTwd: 1100000,
        currentBeta: 1.2,
        targetBeta: 1.2,
        betaLower: 1.08,
        betaUpper: 1.32,
        benchmark0050Price: 105,
      },
    ];
    const summary = createHistorySummary(records);
    const performanceChart = createHistoryChartModel(records, "performance");
    const betaChart = createHistoryChartModel(records, "beta");

    assert.equal(summary.latestTotalAssetsTwd, 1100000);
    assert.equal(summary.latestBeta, 1.2);
    assert.equal(summary.portfolioReturn, 0.1);
    assert.equal(summary.benchmarkReturn, 0.05);
    assert.ok(performanceChart.portfolioPoints.length > 0);
    assert.ok(performanceChart.benchmarkPoints.length > 0);
    assert.equal(performanceChart.xTicks.length, 2);
    assert.equal(performanceChart.yTicks.length, 3);
    assert.equal(performanceChart.dataPoints.length, 2);
    assert.equal(performanceChart.dataPoints[1].date, "2026-07-22");
    assert.equal(performanceChart.dataPoints[1].portfolioReturn, 0.1);
    assert.equal(performanceChart.dataPoints[1].benchmarkReturn, 0.05);
    assert.ok(betaChart.betaPoints.length > 0);
    assert.ok(betaChart.targetPoints.length > 0);
    assert.equal(betaChart.xTicks.length, 2);
    assert.equal(betaChart.yTicks.length, 3);
    assert.equal(betaChart.dataPoints.length, 2);
    assert.equal(betaChart.dataPoints[1].currentBeta, 1.2);
    assert.equal(betaChart.dataPoints[1].targetBeta, 1.2);
    assert.deepEqual(
      betaChart.yTicks.map((tick) => tick.label),
      ["上限 1.32", "目標 1.20", "下限 1.08"],
    );
    assert.ok(betaChart.minValue > 0.9);
    assert.ok(betaChart.maxValue < 1.5);
  });

  it("creates Taipei date keys", () => {
    assert.equal(getTaipeiDateKey(new Date("2026-07-22T18:00:00.000Z")), "2026-07-23");
  });

  it("creates demo history records for local curve preview", () => {
    const records = createDemoHistoryRecords(new Date("2026-07-23T04:00:00.000Z"));
    const summary = createHistorySummary(records);
    const chart = createHistoryChartModel(records, "performance");

    assert.equal(records.length, 30);
    assert.equal(records[0].date, "2026-06-24");
    assert.equal(records.at(-1).date, "2026-07-23");
    assert.ok(summary.latestTotalAssetsTwd > records[0].totalAssetsTwd);
    assert.ok(chart.portfolioPoints.length > 0);
    assert.ok(chart.benchmarkPoints.length > 0);
  });

  it("merges demo records without replacing existing official history dates", () => {
    const officialRecord = {
      date: "2026-07-23",
      totalAssetsTwd: 6393600,
      currentBeta: 2,
      targetBeta: 1.2,
      betaLower: 1.08,
      betaUpper: 1.32,
      leveragedValueTwd: 6393600,
      originalValueTwd: 0,
      cashTwd: 0,
      benchmark0050Price: 103.5,
    };
    const records = mergeDemoHistoryRecords(
      [officialRecord],
      new Date("2026-07-23T04:00:00.000Z"),
    );
    const series = createPerformanceSeries(records);

    assert.equal(records.length, 30);
    assert.deepEqual(records.at(-1), officialRecord);
    assert.equal(records[0].date, "2026-06-24");
    assert.ok(series.at(-1).benchmarkReturn > -0.1);
    assert.ok(series.at(-1).benchmarkReturn < 0.1);
  });

  it("replaces legacy demo records that used a mismatched 0050 price scale", () => {
    const records = mergeDemoHistoryRecords(
      [
        {
          date: "2026-07-22",
          totalAssetsTwd: 1079042,
          currentBeta: 1.13,
          targetBeta: 1.2,
          betaLower: 1.08,
          betaUpper: 1.32,
          leveragedValueTwd: 647425,
          originalValueTwd: 107904,
          cashTwd: 323713,
          benchmark0050Price: 254.2,
        },
        {
          date: "2026-07-23",
          totalAssetsTwd: 1000000,
          currentBeta: 1.21,
          targetBeta: 1.2,
          betaLower: 1.08,
          betaUpper: 1.32,
          leveragedValueTwd: 600000,
          originalValueTwd: 100000,
          cashTwd: 300000,
          benchmark0050Price: 103.5,
        },
      ],
      new Date("2026-07-23T04:00:00.000Z"),
    );
    const previousDay = records.find((record) => record.date === "2026-07-22");
    const series = createPerformanceSeries(records);

    assert.ok(previousDay.benchmark0050Price < 120);
    assert.ok(series.at(-1).benchmarkReturn > -0.1);
    assert.ok(series.at(-1).benchmarkReturn < 0.1);
  });
});
