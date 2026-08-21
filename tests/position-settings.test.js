import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getPositionGroups,
  getPositionGroupTargetStatus,
  initializePositionTargetWeights,
  removePositionFromSettings,
} from "../src/lib/position-settings.js";

describe("position settings helpers", () => {
  it("groups holdings into leveraged and original sections by asset beta", () => {
    const positions = [
      { id: "tw-2x", assetBeta: 2 },
      { id: "qqq", assetBeta: 1 },
      { id: "tw-2x-b", assetBeta: 2 },
    ];

    assert.deepEqual(getPositionGroups(positions), {
      leveraged: [positions[0], positions[2]],
      original: [positions[1]],
    });
  });

  it("keeps a new holding in its selected sleeve while its multiplier is blank", () => {
    const leveraged = { id: "new-leveraged", assetBeta: "", assetTypeHint: "leveraged" };
    const original = { id: "new-original", assetBeta: 1, assetTypeHint: "original" };

    assert.deepEqual(getPositionGroups([leveraged, original]), {
      leveraged: [leveraged],
      original: [original],
    });
  });

  it("validates a custom sleeve only when its weights total 100 percent", () => {
    assert.deepEqual(
      getPositionGroupTargetStatus({
        mode: "custom",
        positions: [{ targetWeightPct: 60 }, { targetWeightPct: 40 }],
      }),
      { totalPct: 100, isValid: true },
    );
    assert.deepEqual(
      getPositionGroupTargetStatus({
        mode: "custom",
        positions: [{ targetWeightPct: 60 }, { targetWeightPct: 20 }],
      }),
      { totalPct: 80, isValid: false },
    );
    assert.deepEqual(
      getPositionGroupTargetStatus({
        mode: "auto",
        positions: [{ targetWeightPct: 60 }, { targetWeightPct: 20 }],
      }),
      { totalPct: 80, isValid: true },
    );
  });

  it("initializes custom weights from current sleeve values and absorbs rounding", () => {
    assert.deepEqual(
      initializePositionTargetWeights([
        { id: "a", currentValueTwd: 1 },
        { id: "b", currentValueTwd: 2 },
        { id: "c", currentValueTwd: 0 },
      ]).map((position) => position.targetWeightPct),
      [33.33, 66.67, 0],
    );
  });

  it("rejects custom weights outside zero to 100 even when the total is 100", () => {
    assert.deepEqual(
      getPositionGroupTargetStatus({
        mode: "custom",
        positions: [{ targetWeightPct: -10 }, { targetWeightPct: 110 }],
      }),
      { totalPct: 100, isValid: false },
    );
  });

  it("clears the original target after removing the last original holding", () => {
    const state = {
      positions: [
        { id: "triple", tickerInput: "TQQQ", assetBeta: 3 },
        { id: "original", tickerInput: "QQQ", assetBeta: 1 },
      ],
      originalAllocationMode: "custom",
      originalTargetPct: 50,
      allocationModes: { leveraged: "auto", original: "custom" },
    };

    assert.deepEqual(removePositionFromSettings(state, "original"), {
      ...state,
      positions: [state.positions[0]],
      originalAllocationMode: "current",
      originalTargetPct: 0,
      allocationModes: { leveraged: "auto", original: "auto" },
    });
  });

  it("removes the only original holding and clears its allocation settings", () => {
    const state = {
      positions: [
        { id: "original", tickerInput: "", shares: "", assetBeta: 1 },
      ],
      originalAllocationMode: "custom",
      originalTargetPct: 30,
      allocationModes: { leveraged: "auto", original: "custom" },
    };

    assert.deepEqual(removePositionFromSettings(state, "original"), {
      ...state,
      positions: [],
      originalAllocationMode: "current",
      originalTargetPct: 0,
      allocationModes: { leveraged: "auto", original: "auto" },
    });
  });

  it("keeps the original target while another original holding remains", () => {
    const state = {
      positions: [
        { id: "triple", assetBeta: 3 },
        { id: "original-a", assetBeta: 1 },
        { id: "original-b", assetBeta: 1 },
      ],
      originalAllocationMode: "custom",
      originalTargetPct: 40,
      allocationModes: { leveraged: "auto", original: "custom" },
    };

    assert.deepEqual(removePositionFromSettings(state, "original-a"), {
      ...state,
      positions: [state.positions[0], state.positions[2]],
    });
  });
});
