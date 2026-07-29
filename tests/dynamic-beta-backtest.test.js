import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyMacroAvailabilityLag,
  classifyWarning,
  findEventBounds,
} from "../src/lib/dynamic-beta/event-backtest.js";

describe("market risk event backtest", () => {
  it("finds the highest peak and lowest trough inside explicit ranges", () => {
    const spy = [
      { observationDate: "2020-02-18", value: 335 },
      { observationDate: "2020-02-19", value: 339 },
      { observationDate: "2020-02-20", value: 337 },
      { observationDate: "2020-03-20", value: 229 },
      { observationDate: "2020-03-23", value: 223 },
      { observationDate: "2020-03-24", value: 244 },
    ];

    assert.deepEqual(
      findEventBounds(spy, {
        peakFrom: "2020-02-01",
        peakTo: "2020-02-29",
        troughFrom: "2020-03-01",
        troughTo: "2020-04-15",
      }),
      {
        peakDate: "2020-02-19",
        peakValue: 339,
        troughDate: "2020-03-23",
        troughValue: 223,
        drawdownPercent: -34.22,
      },
    );
  });

  it("moves revised macro observations to conservative availability dates", () => {
    assert.deepEqual(
      applyMacroAvailabilityLag({
        UNRATE: [{ observationDate: "2020-02-01", value: 3.5 }],
        CPILFESL: [{ observationDate: "2020-02-01", value: 266 }],
        PCEPILFE: [{ observationDate: "2020-02-01", value: 111 }],
      }),
      {
        UNRATE: [{ observationDate: "2020-03-14", value: 3.5, sourceObservationDate: "2020-02-01" }],
        CPILFESL: [{ observationDate: "2020-03-20", value: 266, sourceObservationDate: "2020-02-01" }],
        PCEPILFE: [{ observationDate: "2020-04-06", value: 111, sourceObservationDate: "2020-02-01" }],
      },
    );
  });

  it("distinguishes early, concurrent, late, and missed warnings", () => {
    assert.equal(
      classifyWarning({ firstCross40: "2020-02-10", peakDate: "2020-02-19", troughDate: "2020-03-23" }),
      "early-warning",
    );
    assert.equal(
      classifyWarning({ firstCross40: "2020-03-02", peakDate: "2020-02-19", troughDate: "2020-03-23" }),
      "concurrent-confirmation",
    );
    assert.equal(
      classifyWarning({ firstCross40: "2020-03-25", peakDate: "2020-02-19", troughDate: "2020-03-23" }),
      "late",
    );
    assert.equal(
      classifyWarning({ firstCross40: null, peakDate: "2020-02-19", troughDate: "2020-03-23" }),
      "missed",
    );
  });
});
