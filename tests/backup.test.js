import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAppBackup,
  mergeImportedHistory,
  parseAppBackup,
} from "../src/lib/backup.js";

const settings = {
  positions: [
    {
      id: "position-1",
      tickerInput: "00631L",
      shares: 1000,
      assetBeta: 2,
      targetWeightPct: 100,
    },
  ],
  allocationModes: { leveraged: "custom", original: "auto" },
  cashEquivalentPositions: [],
  cashEquivalentMode: "auto",
  realCashTargetPct: 10,
  cashTwd: 120000,
  cashUsd: 1000,
  leveragedTargetPct: 40,
  originalTargetPct: 40,
  targetBeta: 1.2,
  tolerancePct: 10,
};

describe("app backup", () => {
  it("creates a full app backup with settings and history", () => {
    const backup = createAppBackup({
      settings,
      exportedAt: "2026-07-23T00:00:00.000Z",
      history: [
        {
          date: "2026-07-23",
          totalAssetsTwd: 1000000,
          currentBeta: 1.2,
          targetBeta: 1.2,
          betaLower: 1.08,
          betaUpper: 1.32,
          leveragedValueTwd: 600000,
          originalValueTwd: 100000,
          cashTwd: 300000,
          benchmark0050Price: 250,
        },
      ],
    });

    assert.equal(backup.version, 1);
    assert.equal(backup.app, "jj-invest-public");
    assert.deepEqual(backup.settings, settings);
    assert.equal(backup.history.length, 1);
  });

  it("parses a full backup and normalizes app settings", () => {
    const backupText = JSON.stringify(
      createAppBackup({
        settings: {
          ...settings,
          cashTwd: 120000.6,
          cashUsd: 999.4,
          positions: [{ ...settings.positions[0], shares: 1000.4 }],
        },
        history: [],
      }),
    );
    const parsed = parseAppBackup(backupText);

    assert.equal(parsed.settings.cashTwd, 120001);
    assert.equal(parsed.settings.cashUsd, 999);
    assert.equal(parsed.settings.positions[0].shares, 1000);
    assert.equal(parsed.settings.positions[0].targetWeightPct, 100);
    assert.equal(parsed.settings.targetBeta, 1.2);
    assert.deepEqual(parsed.settings.allocationModes, {
      leveraged: "custom",
      original: "auto",
    });
  });

  it("loads legacy settings in automatic allocation mode", () => {
    const parsed = parseAppBackup(JSON.stringify({
      app: "jj-invest-public",
      version: 1,
      settings: {
        positions: [{ id: "legacy", tickerInput: "00631L", shares: 1, assetBeta: 2 }],
      },
      history: [],
    }));

    assert.deepEqual(parsed.settings.allocationModes, {
      leveraged: "auto",
      original: "auto",
    });
    assert.equal(parsed.settings.positions[0].targetWeightPct, 0);
    assert.equal(parsed.settings.targetBeta, 1.2);
  });

  it("migrates a legacy target from its configured leveraged multipliers", () => {
    const parsed = parseAppBackup(JSON.stringify({
      app: "jj-invest-public",
      version: 1,
      settings: {
        positions: [
          { id: "double", tickerInput: "QLD", shares: 1, assetBeta: 2 },
          { id: "triple", tickerInput: "SOXL", shares: 1, assetBeta: 3 },
        ],
        leveragedTargetPct: 40,
        originalTargetPct: 20,
        allocationModes: { leveraged: "auto", original: "auto" },
      },
      history: [],
    }));

    assert.equal(parsed.settings.targetBeta, 1.2);
  });

  it("prefers a legacy backup's derived target over the current fallback target", () => {
    const parsed = parseAppBackup(JSON.stringify({
      app: "jj-invest-public",
      version: 1,
      settings: {
        positions: [{ id: "triple", tickerInput: "SOXL", shares: 1, assetBeta: 3 }],
        leveragedTargetPct: 40,
        originalTargetPct: 0,
      },
      history: [],
    }), { targetBeta: 0.8 });

    assert.equal(parsed.settings.targetBeta, 1.2);
  });

  it("preserves configurable leveraged multipliers in backups", () => {
    const parsed = parseAppBackup(JSON.stringify({
      app: "jj-invest-public",
      version: 1,
      settings: {
        ...settings,
        positions: [
          { id: "one-half", tickerInput: "TEST", shares: 1, assetBeta: 1.5 },
          { id: "triple", tickerInput: "SOXL", shares: 1, assetBeta: 3 },
        ],
      },
      history: [],
    }));

    assert.deepEqual(parsed.settings.positions.map((position) => position.assetBeta), [1.5, 3]);
  });

  it("keeps an imported automatic mode when fallback settings are custom", () => {
    const parsed = parseAppBackup(JSON.stringify({
      app: "jj-invest-public",
      version: 1,
      settings: { ...settings, allocationModes: { leveraged: "auto", original: "auto" } },
      history: [],
    }), { allocationModes: { leveraged: "custom", original: "custom" } });

    assert.deepEqual(parsed.settings.allocationModes, {
      leveraged: "auto",
      original: "auto",
    });
  });

  it("merges imported history by date without deleting newer local records", () => {
    const merged = mergeImportedHistory(
      [
        { date: "2026-07-22", totalAssetsTwd: 900000, benchmark0050Price: 240 },
        { date: "2026-07-23", totalAssetsTwd: 1000000, benchmark0050Price: 250 },
      ],
      [
        { date: "2026-07-21", totalAssetsTwd: 800000, benchmark0050Price: 230 },
        { date: "2026-07-22", totalAssetsTwd: 880000, benchmark0050Price: 235 },
      ],
    );

    assert.deepEqual(
      merged.map((record) => [record.date, record.totalAssetsTwd]),
      [
        ["2026-07-21", 800000],
        ["2026-07-22", 880000],
        ["2026-07-23", 1000000],
      ],
    );
  });

  it("rejects non app backup files", () => {
    assert.throws(
      () => parseAppBackup(JSON.stringify({ app: "other", version: 1 })),
      /不是可匯入/,
    );
  });
});
