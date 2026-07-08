import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBetaSummary } from "../src/lib/beta-summary.js";

describe("beta summary helpers", () => {
  it("formats drift as both beta value and percent of target beta", () => {
    assert.deepEqual(
      createBetaSummary({
        currentBeta: 1.32,
        targetBeta: 1.2,
        tolerancePct: 10,
      }),
      {
        driftText: "+0.12 (+10.00%)",
        driftValue: "+0.12",
        driftPercent: "+10.00%",
        targetText: "1.20 ± 10%",
        toleranceText: "10%",
      },
    );
  });

  it("formats negative drift with a minus sign", () => {
    assert.deepEqual(
      createBetaSummary({
        currentBeta: 1.08,
        targetBeta: 1.2,
        tolerancePct: 10,
      }),
      {
        driftText: "-0.12 (-10.00%)",
        driftValue: "-0.12",
        driftPercent: "-10.00%",
        targetText: "1.20 ± 10%",
        toleranceText: "10%",
      },
    );
  });
});
