import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("benchmark drawdown UI", () => {
  it("shows 0050 closing-high drawdown in a market level card", () => {
    assert.match(pageSource, /MarketLevelCard/);
    assert.match(pageSource, /市場水位/);
    assert.match(pageSource, /0050 距歷史高點/);
    assert.match(pageSource, /高點/);
    assert.match(pageSource, /目前/);
    assert.match(pageSource, /查看 0050 距收盤高點說明/);
    assert.match(pageSource, /-10% 以內/);
    assert.match(pageSource, /<p className="cardLabel">名詞說明<\/p>/);
    assert.match(pageSource, /isBenchmarkDrawdownTopic\s*\?\s*"市場水位"/);
    assert.match(pageSource, /benchmarkIntro/);
    assert.match(pageSource, /benchmarkRules/);
    assert.match(pageSource, /股災等級/);
    assert.match(pageSource, /分批加碼買進/);
    assert.match(pageSource, /createBenchmarkDrawdown/);
    assert.match(pageSource, /marketPointTooltip/);
    assert.match(pageSource, /aria-pressed/);
    assert.match(pageSource, /0050 股價/);
    assert.match(pageSource, /className="marketLevelChart"[^>]*role="group"/);
    assert.doesNotMatch(pageSource, /className="marketLevelChart"[^>]*role="img"/);
    assert.doesNotMatch(pageSource, /看全部曲線/);
    assert.doesNotMatch(pageSource, /看詳細點位/);
    assert.match(
      pageSource,
      /const \[chartRange, setChartRange\] = useState\("1M"\)/,
    );
    assert.match(pageSource, /\["1M", "3M", "6M", "1Y"\]/);
    assert.match(pageSource, /aria-pressed=\{chartRange === range\}/);
    assert.match(pageSource, /filterBenchmarkHistoryByRange/);
    assert.match(pageSource, /activePointDate/);
    assert.match(pageSource, /activePointDate === point\.date/);
    assert.match(pageSource, /getNearestMarketPointIndex/);
    assert.match(pageSource, /className="marketLevelChartWrap"/);
    assert.match(pageSource, /x=\{chart\.bandInset\}/);
    assert.match(pageSource, /width=\{chart\.width - chart\.bandInset \* 2\}/);
    assert.match(pageSource, /chart\.bands\.map\(\(band\) =>/);
    assert.match(pageSource, /className=\{`marketBandName \$\{band\.level\}`\}/);
    assert.match(
      pageSource,
      /className="marketThresholdRatio" x=\{chart\.edgeLabelInset\} y=\{threshold\.y \+ 20\}/,
    );
    assert.match(pageSource, /<OverviewCardHeader[\s\S]*?title="市場水位"/);
    assert.doesNotMatch(pageSource, /marketLevelViewButton/);
    assert.match(
      pageSource,
      /marketLevelDrawdownSummary[\s\S]*?formatSignedPercent\(benchmarkDrawdown\.drawdownRatio\)[\s\S]*?levelLabel/,
    );
    assert.match(pageSource, /目前價格（\{benchmarkDrawdown\.currentSource === "live" \? "即時" : "收盤"\}）/);
    assert.match(pageSource, /歷史高點（收盤）/);
    assert.match(
      cssSource,
      /\.marketLevelSummaries\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s,
    );
    assert.match(
      cssSource,
      /\.marketLevelSummaryLabel\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    assert.doesNotMatch(
      pageSource,
      /marketLevelFooter[\s\S]*?marketLevelBadge/,
    );
    assert.doesNotMatch(pageSource, /marketPointWeekday/);
    assert.doesNotMatch(pageSource, /marketLevelChartToolbar/);
    assert.match(pageSource, /股災區間/);
    assert.doesNotMatch(pageSource, /風險區間/);
    assert.match(cssSource, /\.overviewCardAction[\s\S]*height:\s*32px/);
    assert.match(cssSource, /\.marketLevelRangeControls/);
    assert.match(
      cssSource,
      /\.marketLevelRangeControls\s*\{[^}]*margin-top:\s*6px;/s,
    );
    assert.match(cssSource, /\.marketPoint\s*\{[^}]*r:\s*6px;/s);
    assert.doesNotMatch(pageSource, /marketPointPercent/);
    assert.match(cssSource, /\.marketPoint:not\(\.active\):not\(\.latest\)/);
    assert.match(
      cssSource,
      /@media \(max-width: 760px\)[\s\S]*?\.marketPointTooltip text\s*\{[^}]*font-size:\s*13px;/,
    );
    assert.match(
      cssSource,
      /@media \(max-width: 480px\)[\s\S]*?\.marketLevelChartWrap\s*\{[^}]*margin-top:\s*-20px;[^}]*margin-bottom:\s*-24px;/s,
    );
    assert.match(pageSource, /className="marketPointDate"[\s\S]*?y=\{chart\.dateLabelY\}/);
    assert.doesNotMatch(cssSource, /\.marketLevelChartToolbar/);
  });
});
