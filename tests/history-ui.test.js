import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");

describe("history UI", () => {
  it("adds a history tab and history page controls", () => {
    assert.match(pageSource, /onChange\("history"\)/);
    assert.match(pageSource, />歷史</);
    assert.match(pageSource, /績效/);
    assert.match(pageSource, /Beta/);
    assert.match(pageSource, /成功更新價格後會自動記錄今日/);
    assert.match(pageSource, /清除歷史紀錄/);
  });

  it("confirms history clearing and offers one-step restore", () => {
    assert.match(pageSource, /createHistoryRestorePoint/);
    assert.match(pageSource, /parseHistoryRestorePoint/);
    assert.match(pageSource, /清除歷史紀錄？/);
    assert.match(pageSource, /復原上一步/);
    assert.match(pageSource, /historyRestoreStatus/);
  });

  it("uses browser localStorage for history records", () => {
    assert.match(pageSource, /jj-invest-public-history-v1/);
    assert.match(pageSource, /window\.localStorage\.setItem\(HISTORY_STORAGE_KEY/);
  });

  it("offers a local-only demo curve loader for history preview", () => {
    assert.match(pageSource, /載入示範曲線/);
    assert.match(pageSource, /historyActions/);
    assert.match(pageSource, /hydrated &&/);
    assert.match(pageSource, /192\.168\./);
    assert.match(pageSource, /mergeDemoHistoryRecords/);
  });

  it("shows point details when interacting with history chart points", () => {
    assert.match(pageSource, /historyHitPoint/);
    assert.match(pageSource, /historyTooltip/);
    assert.match(pageSource, /aria-label=\{`\$\{point\.date\} 歷史數據`\}/);
  });

  it("supports 7 and 30 day ranges for history charts", () => {
    assert.match(pageSource, /useState\("30"\)/);
    assert.match(pageSource, /7天/);
    assert.match(pageSource, /30天/);
    assert.match(pageSource, /chartRecords/);
    assert.match(pageSource, /historyRangeDays/);
  });

  it("draws the 0050 performance line above the portfolio line when they overlap", () => {
    assert.match(
      pageSource,
      /<polyline className="historyLine portfolio" points=\{model\.portfolioPoints\} \/>[\s\S]*<polyline className="historyLine benchmark performanceBenchmark" points=\{model\.benchmarkPoints\} \/>/,
    );
  });

  it("does not show a separate 0050 daily change metric on the history page", () => {
    assert.doesNotMatch(pageSource, /0050 今日漲跌/);
    assert.match(pageSource, /selectBenchmark0050SnapshotPrice/);
  });

  it("shows full app backup controls in settings", () => {
    assert.match(pageSource, /資料備份/);
    assert.match(pageSource, /匯出完整備份/);
    assert.match(pageSource, /匯入完整備份/);
    assert.match(pageSource, /handleExportBackup/);
    assert.match(pageSource, /handleImportBackup/);
  });

  it("lets users classify manual cash changes for performance accounting", () => {
    assert.match(pageSource, /本次現金變動原因/);
    assert.match(pageSource, /手續費 \/ 交易成本/);
    assert.match(pageSource, /新資金投入 \/ 提領/);
    assert.match(pageSource, /資料修正/);
    assert.match(pageSource, /addHistoryPerformanceAdjustment/);
  });
});
