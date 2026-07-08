import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getPositionGroups,
  getPositionGroupTargetStatus,
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

  it("marks a required section invalid when target weights do not add to 100 percent", () => {
    assert.deepEqual(
      getPositionGroupTargetStatus({
        positions: [
          { targetWeightPct: 60 },
          { targetWeightPct: 20 },
        ],
        targetRatio: 0.4,
      }),
      {
        totalPct: 80,
        isRequired: true,
        isValid: false,
      },
    );
  });

  it("does not require target weights for an unused section", () => {
    assert.deepEqual(
      getPositionGroupTargetStatus({
        positions: [],
        targetRatio: 0,
      }),
      {
        totalPct: 0,
        isRequired: false,
        isValid: true,
      },
    );
  });
});
