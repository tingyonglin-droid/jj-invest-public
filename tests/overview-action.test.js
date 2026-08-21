import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOverviewAction,
  getSettingsSetupGuide,
  isPortfolioSetupComplete,
} from "../src/lib/overview-action.js";

describe("overview action", () => {
  it("shows setup progress until beta settings and a funded holding are complete", () => {
    const emptyGuide = getSettingsSetupGuide({
      positions: [{ tickerInput: "", shares: 0 }],
      targetBeta: 1,
      tolerancePct: 10,
      cashTwd: 0,
      cashUsd: 0,
      cashEquivalentPositions: [],
    });

    assert.equal(emptyGuide.isVisible, true);
    assert.deepEqual(emptyGuide.completedSteps, {
      beta: true,
      positions: false,
      cash: false,
    });

    const completeGuide = getSettingsSetupGuide({
      positions: [{ tickerInput: "QLD", shares: 10 }],
      targetBeta: 1.2,
      tolerancePct: 10,
      cashTwd: 0,
      cashUsd: 0,
      cashEquivalentPositions: [],
    });

    assert.equal(completeGuide.isVisible, false);
    assert.deepEqual(completeGuide.completedSteps, {
      beta: true,
      positions: true,
      cash: false,
    });
  });

  it("marks optional cash complete without requiring it to hide the guide", () => {
    const guide = getSettingsSetupGuide({
      positions: [{ tickerInput: "", shares: 0 }],
      targetBeta: "",
      tolerancePct: "",
      cashTwd: 1000,
      cashUsd: 0,
      cashEquivalentPositions: [],
    });

    assert.equal(guide.isVisible, true);
    assert.deepEqual(guide.completedSteps, {
      beta: false,
      positions: false,
      cash: true,
    });
  });

  it("requires quotes, a funded holding, and target beta but allows zero cash", () => {
    const baseState = {
      positions: [{ shares: 100 }],
      targetBeta: 1.2,
      cashTwd: 0,
      cashUsd: 0,
      cashEquivalentPositions: [],
    };

    assert.equal(
      isPortfolioSetupComplete({ formState: baseState, hasReceivedQuoteResponse: false }),
      false,
    );
    assert.equal(
      isPortfolioSetupComplete({
        formState: { ...baseState, positions: [{ shares: 0 }] },
        hasReceivedQuoteResponse: true,
      }),
      false,
    );
    assert.equal(
      isPortfolioSetupComplete({
        formState: { ...baseState, targetBeta: "" },
        hasReceivedQuoteResponse: true,
      }),
      false,
    );
    assert.equal(
      isPortfolioSetupComplete({ formState: baseState, hasReceivedQuoteResponse: true }),
      true,
    );
  });

  it("accepts USD cash or funded cash-equivalent holdings as cash setup", () => {
    const positions = [{ shares: 100 }];

    assert.equal(
      isPortfolioSetupComplete({
        formState: { positions, targetBeta: 1, cashTwd: 0, cashUsd: 100, cashEquivalentPositions: [] },
        hasReceivedQuoteResponse: true,
      }),
      true,
    );
    assert.equal(
      isPortfolioSetupComplete({
        formState: {
          positions,
          targetBeta: 1,
          cashTwd: 0,
          cashUsd: 0,
          cashEquivalentPositions: [{ shares: 10 }],
        },
        hasReceivedQuoteResponse: true,
      }),
      true,
    );
  });

  it("routes incomplete setup to beta settings before holdings", () => {
    assert.deepEqual(
      createOverviewAction(
        { isValid: true, needsRebalance: true, issues: [] },
        { setupComplete: false },
      ),
      {
        kind: "setup",
        label: "開始設定 Beta／持股 →",
        tone: "setup",
        destination: "settings",
        settingsPage: "beta",
        ariaLabel: "開始設定 Beta 與持股，前往設定頁",
      },
    );
  });

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
      createOverviewAction({
        isValid: true,
        needsRebalance: true,
        currentBeta: 1.35,
        betaLower: 1.08,
        betaUpper: 1.32,
        issues: [],
      }),
      {
        kind: "rebalance",
        label: "建議降低曝險 →",
        tone: "rebalance",
        destination: "operations",
        settingsPage: null,
        ariaLabel: "建議降低曝險，前往再平衡頁確認",
      },
    );
  });

  it("recommends increasing exposure when beta is below tolerance", () => {
    const action = createOverviewAction({
      isValid: true,
      needsRebalance: true,
      currentBeta: 0.9,
      betaLower: 1.08,
      betaUpper: 1.32,
      issues: [],
    });

    assert.equal(action.label, "建議增加曝險 →");
    assert.equal(action.ariaLabel, "建議增加曝險，前往再平衡頁確認");
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
