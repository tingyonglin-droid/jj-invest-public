import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBetaRailModel } from "../src/lib/beta-rail.js";

describe("beta rail model", () => {
  it("zooms around the target when the current beta is nearby", () => {
    const model = createBetaRailModel({
      currentBeta: 1.13,
      targetBeta: 1,
      betaLower: 0.9,
      betaUpper: 1.1,
    });

    assert.deepEqual(model, {
      scaleMin: 0.7,
      scaleMax: 1.3,
      scaleTicks: [0.7, 0.9, 1.1, 1.3],
      lowerPct: 33.33,
      targetPct: 50,
      upperPct: 66.67,
      currentPct: 71.67,
    });
  });

  it("expands to the next stable range before using the full scale", () => {
    const model = createBetaRailModel({
      currentBeta: 1.42,
      targetBeta: 1,
      betaLower: 0.9,
      betaUpper: 1.1,
    });

    assert.deepEqual(model, {
      scaleMin: 0.5,
      scaleMax: 1.5,
      scaleTicks: [0.5, 0.75, 1, 1.25, 1.5],
      lowerPct: 40,
      targetPct: 50,
      upperPct: 60,
      currentPct: 92,
    });
  });

  it("uses the full 0-3 scale for large deviations and clamps overflow", () => {
    const model = createBetaRailModel({
      currentBeta: 3.3,
      targetBeta: 1.2,
      betaLower: 1.08,
      betaUpper: 1.32,
    });

    assert.deepEqual(model, {
      scaleMin: 0,
      scaleMax: 3,
      scaleTicks: [0, 1, 2, 3],
      lowerPct: 36,
      targetPct: 40,
      upperPct: 44,
      currentPct: 100,
    });
  });
});
