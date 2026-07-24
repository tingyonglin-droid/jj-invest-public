import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createUsageMetrics,
  createUsageTrend,
  getTaipeiDateKey,
  getTaipeiDateKeys,
  isUsageAdminAuthorized,
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

test("creates cumulative trend points and carries totals through empty days", () => {
  const trend = createUsageTrend({
    dates: ["2026-07-22", "2026-07-23", "2026-07-24"],
    snapshots: {
      "2026-07-22": { totalDevices: 14, totalOpens: 21 },
      "2026-07-24": { totalDevices: 18, totalOpens: 34 },
    },
  });

  assert.deepEqual(trend, [
    { date: "2026-07-22", totalDevices: 14, totalOpens: 21 },
    { date: "2026-07-23", totalDevices: 14, totalOpens: 21 },
    { date: "2026-07-24", totalDevices: 18, totalOpens: 34 },
  ]);
});

test("authorizes usage stats reads only with the configured token", () => {
  assert.equal(isUsageAdminAuthorized("https://example.com/api/usage?token=secret", "secret"), true);
  assert.equal(isUsageAdminAuthorized("https://example.com/api/usage?token=wrong", "secret"), false);
  assert.equal(isUsageAdminAuthorized("https://example.com/api/usage", "secret"), false);
  assert.equal(isUsageAdminAuthorized("https://example.com/api/usage?token=secret", ""), false);
});

test("keeps usage statistics out of the public settings UI", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../app/admin/usage/page.js", import.meta.url), "utf8");

  assert.doesNotMatch(page, /使用統計/);
  assert.match(adminPage, /Legacy 使用統計/);
  assert.match(adminPage, /Analytics v1/);
  assert.match(adminPage, /有效使用裝置/);
});

test("admin page does not load legacy usage stats automatically", async () => {
  const adminPage = await readFile(new URL("../app/admin/usage/page.js", import.meta.url), "utf8");

  assert.doesNotMatch(adminPage, /loadLegacyStats/);
  assert.doesNotMatch(adminPage, /載入 Legacy/);
  assert.match(adminPage, /loadAnalyticsStats/);
  assert.doesNotMatch(adminPage, /\/api\/usage/);
});

test("public app does not write legacy usage stats", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.doesNotMatch(page, /recordUsageOpen/);
  assert.doesNotMatch(page, /\/api\/usage/);
});
