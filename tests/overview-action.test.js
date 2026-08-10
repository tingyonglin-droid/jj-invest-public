import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOverviewAction } from "../src/lib/overview-action.js";

describe("overview action", () => {
  it("presents a non-interactive balanced status inside tolerance", () => {
    assert.deepEqual(
      createOverviewAction({ isValid: true, needsRebalance: false, issues: [] }),
      {
        kind: "balanced",
        label: "不需再平衡",
        tone: "balanced",
        destination: null,
        settingsPage: null,
        ariaLabel: null,
      },
    );
  });

  it("routes an out-of-tolerance portfolio to rebalance confirmation", () => {
    assert.deepEqual(
      createOverviewAction({ isValid: true, needsRebalance: true, issues: [] }),
      {
        kind: "rebalance",
        label: "需再平衡 →",
        tone: "rebalance",
        destination: "operations",
        settingsPage: null,
        ariaLabel: "需再平衡，前往再平衡頁確認",
      },
    );
  });

  it("routes a missing holding error to holdings settings before rebalance", () => {
    assert.deepEqual(
      createOverviewAction({
        isValid: false,
        needsRebalance: true,
        issues: [
          { code: "TARGET_TOTAL_EXCEEDED", message: "比例錯誤", settingsPage: "beta" },
          { code: "MISSING_ORIGINAL_POSITION", message: "缺少標的", settingsPage: "positions" },
        ],
      }),
      {
        kind: "settings",
        label: "設定需修正 →",
        tone: "error",
        destination: "settings",
        settingsPage: "positions",
        ariaLabel: "設定需修正，前往設定頁查看問題",
      },
    );
  });

  it("routes portfolio-level configuration errors to beta settings", () => {
    assert.equal(
      createOverviewAction({
        isValid: false,
        needsRebalance: false,
        issues: [
          { code: "TARGET_TOTAL_EXCEEDED", message: "比例錯誤", settingsPage: "beta" },
        ],
      }).settingsPage,
      "beta",
    );
  });
});
