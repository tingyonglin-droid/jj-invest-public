import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createHistoryRestorePoint,
  parseHistoryRestorePoint,
} from "../src/lib/history-restore.js";

describe("history restore points", () => {
  it("captures history records before clearing", () => {
    const records = [
      { date: "2026-07-23", totalAssetsTwd: 1000000, benchmark0050Price: 250 },
      { date: "2026-07-24", totalAssetsTwd: 990000, benchmark0050Price: 247 },
    ];
    const restorePoint = createHistoryRestorePoint(records, "2026-07-24T02:00:00.000Z");

    assert.equal(restorePoint.version, 1);
    assert.equal(restorePoint.reason, "before-clear-history");
    assert.equal(restorePoint.createdAt, "2026-07-24T02:00:00.000Z");
    assert.deepEqual(
      restorePoint.records.map((record) => record.date),
      ["2026-07-23", "2026-07-24"],
    );
  });

  it("parses a stored restore point and normalizes records", () => {
    const restorePoint = createHistoryRestorePoint([
      { date: "2026-07-24", totalAssetsTwd: 1000000.4, benchmark0050Price: 250.1234567 },
    ]);
    const parsed = parseHistoryRestorePoint(JSON.stringify(restorePoint));

    assert.equal(parsed.records[0].totalAssetsTwd, 1000000);
    assert.equal(parsed.records[0].benchmark0050Price, 250.123457);
  });

  it("rejects invalid restore point files", () => {
    assert.throws(
      () => parseHistoryRestorePoint(JSON.stringify({ version: 1 })),
      /無法復原上一筆歷史紀錄/,
    );
  });
});
