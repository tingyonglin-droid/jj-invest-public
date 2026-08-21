import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adjustOperationTargetBeta,
  createOperationRebalance,
  getOperationRebalanceStatus,
  normalizeOperationTargetBetaInput,
  normalizeSelectedRebalanceIds,
} from "../src/lib/operation-rebalance.js";
import {
  applyRebalanceToState,
  getAppliedRebalanceShareDelta,
} from "../src/lib/rebalance-apply.js";

const recommendations = [
  {
    id: "leveraged-a",
    normalizedTicker: "00631L.TW",
    shares: 1000,
    assetBeta: 2,
    targetWeightPct: 60,
    currency: "TWD",
    price: 40,
    priceTwd: 40,
    currentValueTwd: 40000,
    currentSleeveWeight: 0.4,
    targetSleeveWeight: 0.6,
  },
  {
    id: "leveraged-b",
    normalizedTicker: "00685L.TW",
    shares: 1000,
    assetBeta: 2,
    targetWeightPct: 40,
    currency: "TWD",
    price: 50,
    priceTwd: 50,
    currentValueTwd: 50000,
    currentSleeveWeight: 0.5,
    targetSleeveWeight: 0.4,
  },
  {
    id: "original-a",
    normalizedTicker: "0050.TW",
    shares: 1000,
    assetBeta: 1,
    targetWeightPct: 100,
    currency: "TWD",
    price: 10,
    priceTwd: 10,
    currentValueTwd: 10000,
    currentSleeveWeight: 1,
    targetSleeveWeight: 1,
  },
];

function getAppliedBeta(recommendationsToApply, totalAssetsTwd, precision) {
  return recommendationsToApply.reduce((sum, item) => {
    const appliedDeltaShares = getAppliedRebalanceShareDelta(item, precision);
    const afterValueTwd = Math.max(
      item.currentValueTwd + appliedDeltaShares * item.priceTwd,
      0,
    );

    return sum + (afterValueTwd / totalAssetsTwd) * item.assetBeta;
  }, 0);
}

describe("operation rebalance", () => {
  it("classifies the current beta against the inclusive target tolerance range", () => {
    assert.deepEqual(getOperationRebalanceStatus(0.89, 0.9, 1.1), {
      label: "需增加 Beta",
      tone: "increase",
    });
    assert.deepEqual(getOperationRebalanceStatus(0.9, 0.9, 1.1), {
      label: "不需再平衡",
      tone: "balanced",
    });
    assert.deepEqual(getOperationRebalanceStatus(1.1, 0.9, 1.1), {
      label: "不需再平衡",
      tone: "balanced",
    });
    assert.deepEqual(getOperationRebalanceStatus(1.11, 0.9, 1.1), {
      label: "需降低 Beta",
      tone: "decrease",
    });
  });

  it("adjusts the operation target beta in 0.01 steps within the supported range", () => {
    assert.equal(adjustOperationTargetBeta(1, 0.01), 1.01);
    assert.equal(adjustOperationTargetBeta(1, -0.01), 0.99);
    assert.equal(adjustOperationTargetBeta(3, 0.01), 3);
    assert.equal(adjustOperationTargetBeta(0, -0.01), 0);
  });

  it("limits operation beta controls to the portfolio reachable maximum", () => {
    assert.equal(adjustOperationTargetBeta(2.44, 0.01, 2.44), 2.44);
    assert.equal(adjustOperationTargetBeta(2.43, 0.01, 2.44), 2.44);
    assert.equal(normalizeOperationTargetBetaInput("2.58", 2.44), 2.44);
  });

  it("preserves an empty operation beta input while the user edits it", () => {
    assert.equal(normalizeOperationTargetBetaInput("", 2.44), "");
    assert.equal(normalizeOperationTargetBetaInput("2.2", 2.44), "2.2");
  });

  it("defaults every current holding to selected", () => {
    assert.deepEqual(
      normalizeSelectedRebalanceIds({
        currentIds: ["leveraged-a", "leveraged-b", "original-a"],
        previousSelectedIds: [],
      }),
      ["leveraged-a", "leveraged-b", "original-a"],
    );
  });

  it("uses operation target beta instead of portfolio target beta", () => {
    const result = createOperationRebalance({
      recommendations,
      selectedIds: ["leveraged-a", "leveraged-b", "original-a"],
      totalAssetsTwd: 100000,
      targetBeta: 1.4,
      originalTargetRatio: 0.2,
    });

    assert.equal(result.afterBeta, 1.4);
    assert.equal(result.recommendations[0].targetValueTwd, 25000);
    assert.equal(result.recommendations[1].targetValueTwd, 35000);
    assert.equal(result.recommendations[2].targetValueTwd, 20000);
    assert.equal(result.summary.totalAmountTwd, 40000);
  });

  it("derives the leveraged sleeve size from its weighted multiplier", () => {
    const result = createOperationRebalance({
      recommendations: [
        { ...recommendations[0], assetBeta: 3, currentValueTwd: 30000 },
        { ...recommendations[2], currentValueTwd: 20000 },
      ],
      selectedIds: ["leveraged-a", "original-a"],
      totalAssetsTwd: 100000,
      targetBeta: 1.4,
      originalTargetRatio: 0.2,
      leveragedBeta: 3,
    });

    assert.equal(result.recommendations[0].targetValueTwd, 40000);
    assert.equal(result.recommendations[1].targetValueTwd, 20000);
    assert.equal(result.afterBeta, 1.4);
  });

  it("smart rebalancing can target beta above two for 3x holdings", () => {
    const result = createOperationRebalance({
      recommendations: [{
        ...recommendations[0],
        assetBeta: 3,
        shares: 0,
        currentValueTwd: 0,
        priceTwd: 100,
      }],
      selectedIds: ["leveraged-a"],
      totalAssetsTwd: 100000,
      targetBeta: 2.4,
      originalTargetRatio: 0,
      leveragedBeta: 3,
      precision: "shares",
    });

    assert.equal(result.appliedAfterBeta, 2.4);
    assert.ok(result.correctedTargetBeta > 2);
  });

  it("buys every selected holding in a sleeve when that sleeve needs more exposure", () => {
    const result = createOperationRebalance({
      recommendations: [
        { ...recommendations[0], currentValueTwd: 40000, shares: 1000 },
        { ...recommendations[1], currentValueTwd: 0, shares: 0 },
        { ...recommendations[2], currentValueTwd: 20000, shares: 2000 },
      ],
      selectedIds: ["leveraged-a", "leveraged-b", "original-a"],
      totalAssetsTwd: 100000,
      targetBeta: 1.2,
      originalTargetRatio: 0.2,
    });

    assert.deepEqual(
      result.recommendations.map((item) => item.tradeAmountTwd),
      [5000, 5000, 0],
    );
    assert.deepEqual(
      result.recommendations.map((item) => item.action),
      ["buy", "buy", "none"],
    );
    assert.equal(result.afterBeta, 1.2);
  });

  it("leaves zero-share holdings untouched when their sleeve needs less exposure", () => {
    const result = createOperationRebalance({
      recommendations: [
        { ...recommendations[0], currentValueTwd: 60000, shares: 1500 },
        { ...recommendations[1], currentValueTwd: 0, shares: 0 },
        { ...recommendations[2], currentValueTwd: 20000, shares: 2000 },
      ],
      selectedIds: ["leveraged-a", "leveraged-b", "original-a"],
      totalAssetsTwd: 100000,
      targetBeta: 1,
      originalTargetRatio: 0.2,
    });

    assert.deepEqual(
      result.recommendations.map((item) => item.tradeAmountTwd),
      [-20000, 0, 0],
    );
    assert.deepEqual(
      result.recommendations.map((item) => item.action),
      ["sell", "none", "none"],
    );
    assert.equal(result.afterBeta, 1);
  });

  it("redistributes an unsatisfied equal sale across the remaining selected holdings", () => {
    const result = createOperationRebalance({
      recommendations: [
        { ...recommendations[0], currentValueTwd: 5000, shares: 125 },
        { ...recommendations[1], currentValueTwd: 35000, shares: 700 },
      ],
      selectedIds: ["leveraged-a", "leveraged-b"],
      totalAssetsTwd: 100000,
      targetBeta: 0.4,
      originalTargetRatio: 0,
    });

    assert.deepEqual(
      result.recommendations.map((item) => item.tradeAmountTwd),
      [-5000, -15000],
    );
    assert.equal(result.afterBeta, 0.4);
  });

  it("keeps unselected holdings untouched and reallocates selected holdings", () => {
    const result = createOperationRebalance({
      recommendations,
      selectedIds: ["leveraged-a", "original-a"],
      totalAssetsTwd: 100000,
      targetBeta: 1.2,
      originalTargetRatio: 0.2,
    });

    const unselected = result.recommendations.find((item) => item.id === "leveraged-b");
    const selected = result.recommendations.find((item) => item.id === "leveraged-a");

    assert.equal(unselected.isSelected, false);
    assert.equal(unselected.tradeAmountTwd, 0);
    assert.equal(unselected.targetValueTwd, 50000);
    assert.equal(selected.targetValueTwd, 0);
    assert.equal(selected.tradeAmountTwd, -40000);
    assert.equal(result.isReachable, true);
  });

  it("warns when selected holdings cannot fully reach the target beta", () => {
    const result = createOperationRebalance({
      recommendations,
      selectedIds: ["original-a"],
      totalAssetsTwd: 100000,
      targetBeta: 1.2,
      originalTargetRatio: 0.2,
    });

    assert.equal(result.isReachable, false);
    assert.match(result.warnings[0], /無法完全達成指定 Beta/);
    assert.equal(result.recommendations[0].tradeAmountTwd, 0);
    assert.equal(result.recommendations[1].tradeAmountTwd, 0);
  });

  it("one-click rebalance only updates selected holdings and cash", () => {
    const result = createOperationRebalance({
      recommendations,
      selectedIds: ["leveraged-a"],
      totalAssetsTwd: 100000,
      targetBeta: 1.2,
      originalTargetRatio: 0,
    });
    const applied = applyRebalanceToState({
      positions: [
        { id: "leveraged-a", tickerInput: "00631L", shares: 1000 },
        { id: "leveraged-b", tickerInput: "00685L", shares: 1000 },
      ],
      cashTwd: 100000,
      recommendations: result.recommendations,
      precision: "shares",
    });

    assert.deepEqual(
      applied.positions.map((position) => position.shares),
      [250, 1000],
    );
    assert.equal(applied.cashTwd, 130000);
  });

  it("smart-corrects the theoretical beta so applied lot trades land closer to the input beta", () => {
    const lotSensitiveRecommendations = [
      {
        id: "leveraged-a",
        normalizedTicker: "00685L.TW",
        shares: 0,
        assetBeta: 2,
        targetWeightPct: 40,
        priceTwd: 11.665,
        currentValueTwd: 0,
      },
      {
        id: "leveraged-b",
        normalizedTicker: "00631L.TW",
        shares: 0,
        assetBeta: 2,
        targetWeightPct: 40,
        priceTwd: 35.535,
        currentValueTwd: 0,
      },
      {
        id: "leveraged-c",
        normalizedTicker: "QLD",
        shares: 0,
        assetBeta: 2,
        targetWeightPct: 20,
        priceTwd: 2885,
        currentValueTwd: 0,
      },
      {
        id: "original-a",
        normalizedTicker: "0050.TW",
        shares: 0,
        assetBeta: 1,
        targetWeightPct: 50,
        priceTwd: 104.53,
        currentValueTwd: 0,
      },
      {
        id: "original-b",
        normalizedTicker: "006208.TW",
        shares: 0,
        assetBeta: 1,
        targetWeightPct: 50,
        priceTwd: 239.375,
        currentValueTwd: 0,
      },
    ];
    const selectedIds = lotSensitiveRecommendations.map((item) => item.id);
    const baseline = createOperationRebalance({
      recommendations: lotSensitiveRecommendations,
      selectedIds,
      totalAssetsTwd: 1000000,
      targetBeta: 1.2,
      originalTargetRatio: 0.4,
    });
    const corrected = createOperationRebalance({
      recommendations: lotSensitiveRecommendations,
      selectedIds,
      totalAssetsTwd: 1000000,
      targetBeta: 1.2,
      originalTargetRatio: 0.4,
      precision: "lots",
    });
    const baselineAppliedBeta = getAppliedBeta(
      baseline.recommendations,
      1000000,
      "lots",
    );
    const correctedAppliedBeta = getAppliedBeta(
      corrected.recommendations,
      1000000,
      "lots",
    );

    assert.ok(
      Math.abs(correctedAppliedBeta - 1.2) < Math.abs(baselineAppliedBeta - 1.2),
    );
    assert.ok(corrected.correctedTargetBeta < 1.2);
    assert.equal(corrected.appliedAfterBeta, Number(correctedAppliedBeta.toFixed(4)));
  });

  it("allocates a custom sleeve by target weights", () => {
    const result = createOperationRebalance({
      recommendations: [
        { ...recommendations[0], currentValueTwd: 40000 },
        { ...recommendations[1], currentValueTwd: 0, shares: 0 },
      ],
      selectedIds: ["leveraged-a", "leveraged-b"],
      totalAssetsTwd: 100000,
      targetBeta: 1.2,
      originalTargetRatio: 0,
      allocationModes: { leveraged: "custom", original: "auto" },
    });

    assert.deepEqual(result.recommendations.map((item) => item.targetValueTwd), [36000, 24000]);
    assert.deepEqual(result.recommendations.map((item) => item.tradeAmountTwd), [-4000, 24000]);
  });

  it("keeps an unselected custom holding and allocates the remainder by selected weights", () => {
    const result = createOperationRebalance({
      recommendations,
      selectedIds: ["leveraged-a", "original-a"],
      totalAssetsTwd: 100000,
      targetBeta: 1.4,
      originalTargetRatio: 0.2,
      allocationModes: { leveraged: "custom", original: "custom" },
    });

    assert.equal(result.recommendations[1].targetValueTwd, 50000);
    assert.equal(result.recommendations[0].targetValueTwd, 10000);
  });
});
