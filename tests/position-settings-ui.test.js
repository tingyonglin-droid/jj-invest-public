import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("holding settings expose independent automatic and custom allocation modes", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /個股佔比分配方式/);
  assert.match(page, /自動分配/);
  assert.match(page, /自訂個股佔比/);
  assert.match(page, /allocationModes/);
  assert.match(page, /同類資產內目標比例 %/);
  assert.match(page, /合計.*100%/);
  assert.match(page, /initializePositionTargetWeights/);
});

test("custom allocation renders target ratios in the rebalance list", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /holdingProgressTarget/);
  assert.match(page, /目標 \{formatPercent\(item\.targetSleeveWeight\)\}/);
  assert.match(styles, /\.holdingProgressTarget/);
  assert.match(styles, /\.allocationModeControl/);
});
