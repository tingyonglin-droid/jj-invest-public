import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCashEquivalentTargetStatus,
  getCashSleeveTargets,
} from "../src/lib/cash-equivalents.js";
import { calculatePortfolio } from "../src/lib/portfolio.js";
import { normalizeBackupSettings } from "../src/lib/backup.js";
import { applyRebalanceToState } from "../src/lib/rebalance-apply.js";
import { getPositionDisplayName } from "../src/lib/presentation.js";

describe("cash-equivalent allocation", () => {
  it("keeps the whole cash sleeve as real cash when no ETF is configured", () => {
    assert.deepEqual(getCashSleeveTargets({ mode: "auto", positions: [] }), {
      realCashRatio: 1,
      positionRatios: new Map(),
    });
  });

  it("reserves ten percent real cash and splits the remainder equally in automatic mode", () => {
    const targets = getCashSleeveTargets({
      mode: "auto",
      realCashTargetPct: 10,
      positions: [{ id: "bond-1" }, { id: "bond-2" }],
    });

    assert.equal(targets.realCashRatio, 0.1);
    assert.equal(targets.positionRatios.get("bond-1"), 0.45);
    assert.equal(targets.positionRatios.get("bond-2"), 0.45);
  });

  it("uses explicit real-cash and ETF weights in custom mode", () => {
    const positions = [
      { id: "bond-1", targetWeightPct: 50 },
      { id: "bond-2", targetWeightPct: 30 },
    ];
    const status = getCashEquivalentTargetStatus({
      mode: "custom",
      realCashTargetPct: 20,
      positions,
    });
    const targets = getCashSleeveTargets({
      mode: "custom",
      realCashTargetPct: 20,
      positions,
    });

    assert.deepEqual(status, { isValid: true, totalPct: 100 });
    assert.equal(targets.realCashRatio, 0.2);
    assert.equal(targets.positionRatios.get("bond-1"), 0.5);
    assert.equal(targets.positionRatios.get("bond-2"), 0.3);
  });

  it("rejects a custom cash sleeve that does not total one hundred percent", () => {
    assert.deepEqual(getCashEquivalentTargetStatus({
      mode: "custom",
      realCashTargetPct: 20,
      positions: [{ id: "bond-1", targetWeightPct: 50 }],
    }), { isValid: false, totalPct: 70 });
  });
});

describe("cash-equivalent rebalance application", () => {
  it("updates ETF shares and leaves rounded trade residuals in real cash", () => {
    const result = applyRebalanceToState({
      positions: [{ id: "stock", shares: 10 }],
      cashEquivalentPositions: [{ id: "bond", shares: 10 }],
      cashTwd: 100,
      recommendations: [
        { id: "stock", shares: 10, tradeAmountTwd: 50, priceTwd: 50, normalizedTicker: "00631L.TW" },
        { id: "bond", shares: 10, tradeAmountTwd: -35, priceTwd: 20, normalizedTicker: "SGOV", assetType: "cashEquivalent" },
      ],
      precision: "shares",
    });

    assert.equal(result.positions[0].shares, 11);
    assert.equal(result.cashEquivalentPositions[0].shares, 8);
    assert.equal(result.cashTwd, 90);
  });
});

describe("cash-equivalent presentation", () => {
  it("labels beta-zero ETF positions as cash equivalents", () => {
    assert.equal(getPositionDisplayName("SGOV", 0), "類現金標的");
  });
});

describe("cash-equivalent persistence", () => {
  it("defaults legacy state to an empty automatic cash-equivalent sleeve", () => {
    const settings = normalizeBackupSettings({ positions: [], cashTwd: 100 });

    assert.deepEqual(settings.cashEquivalentPositions, []);
    assert.equal(settings.cashEquivalentMode, "auto");
    assert.equal(settings.realCashTargetPct, 10);
  });

  it("normalizes cash-equivalent ETF settings", () => {
    const settings = normalizeBackupSettings({
      positions: [],
      cashEquivalentMode: "custom",
      realCashTargetPct: 20,
      cashEquivalentPositions: [
        { id: "bond", tickerInput: "SGOV", shares: 12.6, targetWeightPct: 80 },
      ],
    });

    assert.equal(settings.cashEquivalentMode, "custom");
    assert.equal(settings.realCashTargetPct, 20);
    assert.deepEqual(settings.cashEquivalentPositions, [
      { id: "bond", tickerInput: "SGOV", shares: 13, targetWeightPct: 80 },
    ]);
  });
});

describe("cash-equivalent portfolio integration", () => {
  it("values cash-equivalent ETFs inside the beta-zero cash sleeve", () => {
    const result = calculatePortfolio({
      positions: [{ id: "stock", tickerInput: "00631L", shares: 10, assetBeta: 2 }],
      cashEquivalentPositions: [{ id: "bond", tickerInput: "SGOV", shares: 10 }],
      quotes: [
        { normalizedTicker: "00631L.TW", price: 50, priceTwd: 50, currency: "TWD" },
        { normalizedTicker: "SGOV", price: 20, priceTwd: 20, currency: "USD" },
      ],
      cashTwd: 100,
      leveragedTargetPct: 50,
      originalTargetPct: 0,
      tolerancePct: 10,
      cashEquivalentMode: "auto",
      realCashTargetPct: 10,
    });

    assert.equal(result.totalAssetsTwd, 800);
    assert.equal(result.cashEquivalentValueTwd, 200);
    assert.equal(result.cashSleeveValueTwd, 300);
    assert.equal(result.cashRatio, 0.375);
    assert.equal(result.currentBeta, 1.25);
    assert.equal(result.targetRealCashTwd, 40);
    assert.equal(result.cashEquivalentRecommendations[0].targetValueTwd, 360);
    assert.equal(result.cashEquivalentRecommendations[0].tradeAmountTwd, 160);
  });

  it("routes an invalid custom cash-sleeve total to cash settings", () => {
    const result = calculatePortfolio({
      positions: [],
      cashEquivalentPositions: [{ id: "bond", tickerInput: "SGOV", shares: 1, targetWeightPct: 50 }],
      quotes: [{ normalizedTicker: "SGOV", price: 20, priceTwd: 20, currency: "USD" }],
      cashTwd: 100,
      leveragedTargetPct: 0,
      originalTargetPct: 0,
      tolerancePct: 10,
      cashEquivalentMode: "custom",
      realCashTargetPct: 20,
    });

    assert.equal(result.isValid, false);
    assert.equal(result.issues.at(-1).settingsPage, "cash");
  });
});
