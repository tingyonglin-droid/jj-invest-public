import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createUsageMetrics,
  getTaipeiDateKey,
  getTaipeiDateKeys,
  sanitizeDeviceId,
} from "../src/lib/usage-stats.js";

test("sanitizes stable anonymous device ids", () => {
  assert.equal(sanitizeDeviceId(" jj_1234-abcd_5678 "), "jj_1234-abcd_5678");
  assert.equal(sanitizeDeviceId("bad id"), "");
  assert.equal(sanitizeDeviceId("short"), "");
});

test("creates Taipei date keys for today and lookback windows", () => {
  const now = new Date("2026-07-21T16:30:00.000Z");

  assert.equal(getTaipeiDateKey(now), "2026-07-22");
  assert.deepEqual(getTaipeiDateKeys(3, now), [
    "2026-07-22",
    "2026-07-21",
    "2026-07-20",
  ]);
});

test("creates metrics where one device counts once but opens can increase", () => {
  const metrics = createUsageMetrics({
    totalDevices: 1,
    totalOpens: 3,
    todayDevices: ["device-a"],
    sevenDayDevices: ["device-a"],
    thirtyDayDevices: ["device-a"],
    opensToday: 3,
  });

  assert.deepEqual(metrics, {
    configured: true,
    totalDevices: 1,
    totalOpens: 3,
    activeToday: 1,
    active7Days: 1,
    active30Days: 1,
    opensToday: 3,
  });
});
