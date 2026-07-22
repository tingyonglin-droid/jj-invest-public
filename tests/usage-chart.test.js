import { test } from "node:test";
import assert from "node:assert/strict";

import { createUsageChartModel } from "../src/lib/usage-chart.js";

test("creates SVG polyline points for cumulative usage trend", () => {
  const model = createUsageChartModel([
    { date: "2026-07-22", totalDevices: 10, totalOpens: 20 },
    { date: "2026-07-23", totalDevices: 12, totalOpens: 30 },
    { date: "2026-07-24", totalDevices: 15, totalOpens: 45 },
  ]);

  assert.equal(model.maxY, 45);
  assert.equal(model.devicePoints, "0,77.78 50,73.33 100,66.67");
  assert.equal(model.openPoints, "0,55.56 50,33.33 100,0");
  assert.deepEqual(model.labels, ["7/22", "7/24"]);
});

test("keeps a single-point chart drawable", () => {
  const model = createUsageChartModel([
    { date: "2026-07-22", totalDevices: 7, totalOpens: 13 },
  ]);

  assert.equal(model.devicePoints, "100,46.15");
  assert.equal(model.openPoints, "100,0");
  assert.deepEqual(model.labels, ["7/22"]);
});
