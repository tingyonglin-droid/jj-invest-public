import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");

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
    assert.match(pageSource, /看全部曲線/);
    assert.match(pageSource, /查看詳細點位/);
    assert.match(pageSource, /aria-pressed=\{chartMode === "overview"\}/);
    assert.match(pageSource, /activePointDate/);
    assert.match(pageSource, /activePointDate === point\.date/);
    assert.match(pageSource, /marketLevelChartWrap.*chartMode/);
    assert.match(pageSource, /股災區間/);
    assert.doesNotMatch(pageSource, /風險區間/);
  });
});
