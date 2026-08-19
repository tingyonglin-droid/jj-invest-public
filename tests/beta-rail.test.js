import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBetaRailModel } from "../src/lib/beta-rail.js";

describe("beta rail model", () => {
  it("positions target, current beta, and tolerance band on a fixed 0-3 scale", () => {
    const model = createBetaRailModel({
      currentBeta: 1.34,
      targetBeta: 1.2,
      betaLower: 1.08,
      betaUpper: 1.32,
    });

    assert.deepEqual(model, {
      scaleMin: 0,
      scaleMax: 3,
      lowerPct: 36,
      targetPct: 40,
      upperPct: 44,
      currentPct: 44.67,
    });
  });

  it("clamps values above 3 to the right edge visually", () => {
    const model = createBetaRailModel({
      currentBeta: 3.3,
      targetBeta: 1.2,
      betaLower: 1.08,
      betaUpper: 1.32,
    });

    assert.deepEqual(model, {
      scaleMin: 0,
      scaleMax: 3,
      lowerPct: 36,
      targetPct: 40,
      upperPct: 44,
      currentPct: 100,
    });
  });
});
