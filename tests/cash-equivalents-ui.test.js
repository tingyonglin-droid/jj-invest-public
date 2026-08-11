import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

test("cash settings expose automatic and custom cash-equivalent allocation", () => {
  assert.match(page, /類現金標的/);
  assert.match(page, /自動配置/);
  assert.match(page, /自訂比例/);
  assert.match(page, /真實現金保留比例/);
  assert.match(page, /占現金＋類現金部位/);
  assert.match(page, /新增類現金標的/);
  assert.match(page, /類現金 ETF 仍有價格波動，並非保本現金/);
});

test("cash-equivalent controls support ticker, shares, and custom targets", () => {
  assert.match(page, /onUpdateCashEquivalentPosition/);
  assert.match(page, /position\.tickerInput/);
  assert.match(page, /position\.shares/);
  assert.match(page, /position\.targetWeightPct/);
});
