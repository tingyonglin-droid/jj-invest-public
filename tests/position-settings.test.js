import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getPositionGroups,
  getPositionGroupTargetStatus,
  initializePositionTargetWeights,
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
});
