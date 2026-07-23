import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");

describe("benchmark drawdown UI", () => {
  it("shows 0050 closing-high drawdown in a market level card", () => {
    assert.match(pageSource, /MarketLevelCard/);
    assert.match(pageSource, /市場水位/);
    assert.match(pageSource, /0050 距收盤高點/);
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
  });
});
