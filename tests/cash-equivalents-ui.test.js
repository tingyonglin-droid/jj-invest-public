import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

test("cash settings expose automatic and custom cash-equivalent allocation", () => {
  assert.match(page, /類現金標的/);
  assert.match(page, /自動配置/);
  assert.match(page, /自訂比例/);
  assert.match(page, /現金部位內的真實現金比例/);
  assert.match(page, /只分配現金部位，不代表占總資產的比例/);
  assert.match(page, /新增類現金標的/);
  assert.match(page, /類現金 ETF 仍有價格波動，並非保本現金/);
});

test("cash and cash-equivalent settings render as separate sibling cards", () => {
  assert.match(page, /className="positionEditor cashEditor cash" aria-label="現金設定"/);
  assert.match(page, /className=\{`positionEditor cashEquivalentCard/);
  assert.match(page, /aria-label="類現金設定"/);
});

test("cash-equivalent controls support ticker, shares, and custom targets", () => {
  assert.match(page, /onUpdateCashEquivalentPosition/);
  assert.match(page, /position\.tickerInput/);
  assert.match(page, /position\.shares/);
  assert.match(page, /position\.targetWeightPct/);
  assert.doesNotMatch(page, /正規化代號：/);
});

test("operation list places cash equivalents after original holdings", () => {
  assert.match(
    page,
    /title="槓桿再平衡清單"[\s\S]*title="原形再平衡清單"[\s\S]*title="類現金再平衡清單"/,
  );
});

test("cash-equivalent operation checkboxes use the shared selection handler", () => {
  assert.doesNotMatch(page, /cashEquivalentRecommendations[\s\S]*onToggleSelection=\{\(\) => \{\}\}/);
  assert.match(page, /cashEquivalentRecommendations[\s\S]*onToggleSelection=\{onToggleSelection\}/);
  assert.match(
    page,
    /cashEquivalentRecommendations\.map[\s\S]*const isSelected = selectedRebalanceIds\.includes[\s\S]*isSelected,/,
  );
});

test("cash and cash-equivalent editors share compact fields and the cash tone", () => {
  assert.match(page, /className="positionEditor cashEditor cash"/);
  assert.match(page, /cashEquivalentCard cash cashEquivalentSection/);
  assert.match(page, /cashEquivalentEditor[\s\S]*positionEditorPrimaryFields/);
  assert.match(page, /cashEquivalentEditor[\s\S]*positionEditorAllocationField/);
});
