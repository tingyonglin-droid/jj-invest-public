import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("operations page exposes target beta and selectable holdings", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /再平衡參數設定/);
  assert.match(page, /再平衡到 Beta/);
  assert.match(page, /調整後 Beta/);
  assert.match(page, /預估調整/);
  assert.match(page, /getAppliedTotalTradeAmount/);
  assert.doesNotMatch(page, /formatTwd\(summary\.totalAmountTwd\)/);
  assert.match(page, /是否納入本次再平衡/);
  assert.match(page, /className="holdingSelect"/);
  assert.match(page, /不納入再平衡清單/);
  assert.doesNotMatch(page, /<h2>再平衡操作清單<\/h2>/);
  assert.doesNotMatch(page, /<span>納入本次再平衡<\/span>/);
});

test("holding progress shows after rebalance ratio", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /再平衡後/);
  assert.match(page, /holdingProgressAfter/);
});

test("operations list separates leveraged and original holdings", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /正二操作清單/);
  assert.match(page, /原形操作清單/);
  assert.match(page, /調整後市值/);
  assert.match(page, /目前 \{formatPercent\(allocationRatio\)\}/);
  assert.match(page, /調整後 \{formatPercent\(appliedAfterAllocationRatio\)\}/);
  assert.match(styles, /\.holdingGroup\.leveraged/);
  assert.match(styles, /\.holdingGroup\.original/);
  assert.match(styles, /\.holdingGroupAllocation/);
});

test("operations page has info panel for target beta and checkbox usage", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /aria-label="查看再平衡操作說明"/);
  assert.match(page, /這裡可以設定本次想再平衡到的 Beta/);
  assert.match(page, /取消勾選的持股本次不買不賣/);
});
