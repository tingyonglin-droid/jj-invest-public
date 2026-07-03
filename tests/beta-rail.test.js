import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBetaRailModel } from "../src/lib/beta-rail.js";

describe("beta rail model", () => {
  it("positions target, current beta, and tolerance band on a fixed 0-2 scale", () => {
    const model = createBetaRailModel({
      currentBeta: 1.34,
      targetBeta: 1.2,
      betaLower: 1.08,
      betaUpper: 1.32,
    });

    assert.deepEqual(model, {
      scaleMin: 0,
      scaleMax: 2,
      lowerPct: 54,
      targetPct: 60,
      upperPct: 66,
      currentPct: 67,
    });
  });

  it("clamps values above 2 to the right edge visually", () => {
    const model = createBetaRailModel({
      currentBeta: 2.3,
      targetBeta: 1.2,
      betaLower: 1.08,
      betaUpper: 1.32,
    });

    assert.deepEqual(model, {
      scaleMin: 0,
      scaleMax: 2,
      lowerPct: 54,
      targetPct: 60,
      upperPct: 66,
      currentPct: 100,
    });
  });
});
