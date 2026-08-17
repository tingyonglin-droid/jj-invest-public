import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

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

  it("uses market-style Zoom ranges for both history charts", () => {
    assert.match(pageSource, /useState\("1M"\)/);
    assert.match(pageSource, /\["1M", "3M", "6M", "1Y"\]/);
    assert.doesNotMatch(pageSource, />7天</);
    assert.doesNotMatch(pageSource, />30天</);
    assert.doesNotMatch(pageSource, /historyModeTabs/);
  });

  it("renders aligned performance and Beta panels with one shared interaction", () => {
    assert.match(pageSource, /createHistoryStackedChartModel/);
    assert.match(pageSource, /HistoryChartPanel/);
    assert.match(pageSource, /showDateAxis=\{false\}/);
    assert.match(pageSource, /showDateAxis=\{true\}/);
    assert.match(pageSource, /activePointIndex/);
    assert.match(pageSource, /投組績效/);
    assert.match(pageSource, /投組 Beta/);
    assert.match(pageSource, /top:\s*"112px"/);
  });

  it("styles stacked history charts with market-style Zoom controls", () => {
    assert.match(
      styles,
      /\.historyZoomRow\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s,
    );
    assert.match(
      styles,
      /\.historyZoomControls button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--action-selected\);/s,
    );
    assert.match(styles, /\.historyChartStack\s*\{[^}]*display:\s*grid;/s);
    assert.match(styles, /\.historyChartPanel \+ \.historyChartPanel/);
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

  it("matches rebalance summary metric surface and typography", () => {
    assert.match(styles, /\.historyMetric\s*\{[^}]*min-height:\s*84px;[^}]*padding:\s*12px;[^}]*border:\s*1px solid rgba\(17, 24, 33, 0\.07\);[^}]*border-radius:\s*16px;[^}]*background:\s*#ffffff;/s);
    assert.match(styles, /\.historyMetric span\s*\{[^}]*font-size:\s*11px;[^}]*font-weight:\s*720;[^}]*line-height:\s*1\.4;/s);
    assert.match(styles, /\.historyMetric strong\s*\{[^}]*font-size:\s*16px;[^}]*font-weight:\s*840;[^}]*line-height:\s*1\.3;/s);
  });

  it("uses the rebalance title structure and exact heading rhythm", () => {
    assert.match(pageSource, /className="cardTitleRow historyTitleRow">\s*<h2>歷史紀錄<\/h2>/s);
    assert.match(pageSource, /className="cardTitleRow historyTitleRow">\s*<h2>最近紀錄<\/h2>/s);
    assert.match(styles, /\.historySummaryCard \.cardTitleRow h2,\s*\.historyRecordsCard \.cardTitleRow h2\s*\{[^}]*font-size:\s*18px;[^}]*font-weight:\s*760;/s);
    assert.match(styles, /\.historyTitleRow\s*\{[^}]*min-height:\s*32px;[^}]*align-items:\s*center;/s);
    assert.match(styles, /\.appCard\s*\{[^}]*padding:\s*18px 20px;/s);
    assert.match(styles, /\.cardHeaderRow p\s*\{[^}]*margin:\s*3px 0 0;/s);
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
    assert.match(pageSource, /useState\("external"\)/);
  });
});
