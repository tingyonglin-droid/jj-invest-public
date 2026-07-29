import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyForensicSignal,
  futureMaximumDrawdown,
  isControlStudyDate,
  isInsideEventExclusion,
} from "../src/lib/dynamic-beta/event-forensics.js";

describe("crash event indicator forensics", () => {
  it("calculates forward drawdown from the candidate close", () => {
    const prices = [100, 102, 98, 94, 96].map((value, index) => ({
      observationDate: `2024-01-0${index + 1}`,
      value,
    }));
    assert.equal(futureMaximumDrawdown(prices, 0, 4), -6);
  });

  it("excludes controls within the event buffer without hand picking", () => {
    const events = [{ peakDate: "2024-07-16", troughDate: "2024-08-05" }];
    assert.equal(isInsideEventExclusion("2024-05-01", events, 90), true);
    assert.equal(isInsideEventExclusion("2024-11-15", events, 90), false);
  });

  it("limits normal controls to the approved 2020 through 2025 study", () => {
    assert.equal(isControlStudyDate("2019-12-31"), false);
    assert.equal(isControlStudyDate("2020-01-01"), true);
    assert.equal(isControlStudyDate("2025-12-31"), true);
    assert.equal(isControlStudyDate("2026-01-01"), false);
  });

  it("requires lead time, persistence, and low control false positives", () => {
    const base = {
      available: true,
      firstAnomaly: "2024-06-20",
      peakDate: "2024-07-16",
      troughDate: "2024-08-05",
      leadTradingDays: 17,
      anomalyDaysBeforePeak: 5,
      recoveredBeforePeak: false,
      controlAnomalyRate: 0.2,
    };
    assert.equal(classifyForensicSignal(base), "leading");
    assert.equal(
      classifyForensicSignal({ ...base, controlAnomalyRate: 0.4 }),
      "high-false-positive",
    );
    assert.equal(
      classifyForensicSignal({ ...base, anomalyDaysBeforePeak: 1 }),
      "weak-leading",
    );
    assert.equal(
      classifyForensicSignal({
        ...base,
        firstAnomaly: "2024-07-20",
        leadTradingDays: -3,
      }),
      "concurrent-confirmation",
    );
    assert.equal(
      classifyForensicSignal({ ...base, available: false }),
      "insufficient-data",
    );
  });
});
