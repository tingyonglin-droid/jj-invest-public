import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createRebalanceRestorePoint,
  parseRebalanceRestorePoint,
} from "../src/lib/rebalance-restore.js";

const settings = {
  positions: [
    {
      id: "position-1",
      tickerInput: "00631L",
      shares: 1000,
      assetBeta: 2,
    },
  ],
  cashTwd: 100000,
  cashUsd: 500,
  leveragedTargetPct: 60,
  tolerancePct: 10,
  originalTargetPct: 0,
};

describe("rebalance restore points", () => {
  it("captures full settings before applying rebalance", () => {
    const restorePoint = createRebalanceRestorePoint(settings, "2026-07-23T00:00:00.000Z");

    assert.equal(restorePoint.version, 1);
    assert.equal(restorePoint.reason, "before-rebalance");
    assert.equal(restorePoint.createdAt, "2026-07-23T00:00:00.000Z");
    assert.deepEqual(restorePoint.settings, settings);
  });

  it("parses a stored restore point and normalizes integer fields", () => {
    const restorePoint = createRebalanceRestorePoint({
      ...settings,
      cashTwd: 100000.4,
      cashUsd: 499.7,
      positions: [{ ...settings.positions[0], shares: 1000.6 }],
    });

    const parsed = parseRebalanceRestorePoint(JSON.stringify(restorePoint));

    assert.equal(parsed.settings.cashTwd, 100000);
    assert.equal(parsed.settings.cashUsd, 500);
    assert.equal(parsed.settings.positions[0].shares, 1001);
  });

  it("rejects invalid restore point files", () => {
    assert.throws(
      () => parseRebalanceRestorePoint(JSON.stringify({ version: 1 })),
      /無法復原/,
    );
  });
});
