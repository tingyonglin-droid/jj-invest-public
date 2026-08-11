import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("operations page exposes target beta and selectable holdings", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /再平衡參數設定/);
  assert.match(page, /cardTitleRow operationTitleRow/);
  assert.match(page, /className="infoButton overviewCardInfoButton"/);
  assert.match(styles, /\.operationTitleRow\s*\{[^}]*gap:\s*7px;/s);
  assert.match(page, /再平衡/);
  assert.match(page, /再平衡到 Beta/);
  assert.match(page, /目標 Beta/);
  assert.match(page, /容忍區間/);
  assert.match(page, /目前 Beta/);
  assert.match(page, /再平衡後 Beta/);
  assert.match(page, /正二/);
  assert.match(page, /原形/);
  assert.match(page, /現金/);
  assert.match(page, /淨買入/);
  assert.match(page, /淨賣出/);
  assert.match(page, /淨增加/);
  assert.match(page, /淨減少/);
  assert.match(page, /getAppliedRebalanceSummary/);
  assert.match(page, /appliedSummary\.actionCount/);
  assert.doesNotMatch(page, /summary\.actionCount/);
  assert.doesNotMatch(page, /formatTwd\(summary\.totalAmountTwd\)/);
  assert.match(page, /是否納入本次再平衡/);
  assert.match(page, /className="holdingSelect"/);
  assert.match(page, /不納入再平衡清單/);
  assert.doesNotMatch(page, /<h2>再平衡操作清單<\/h2>/);
  assert.doesNotMatch(page, /<span>納入本次再平衡<\/span>/);
  assert.match(page, /aria-label="降低再平衡 Beta 0\.01"/);
  assert.match(page, /aria-label="提高再平衡 Beta 0\.01"/);
  assert.match(page, /operationRebalanceStatus/);
  assert.match(page, /getOperationRebalanceStatus/);
  assert.match(page, /cardHeaderRow operationHeaderRow/);
  assert.match(styles, /\.operationHeaderRow/);
});

test("operations page places precision in parameters and apply action after the list", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /operationParameterCard/);
  assert.match(page, /operationApplyFooter/);
  assert.ok(page.indexOf("precisionControl") < page.indexOf("<HoldingList"));
  assert.ok(page.indexOf("<HoldingList") < page.indexOf("operationApplyFooter"));
});

test("operations page confirms apply and offers restore after rebalance", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /BEFORE_REBALANCE_STORAGE_KEY/);
  assert.match(page, /createRebalanceRestorePoint/);
  assert.match(page, /parseRebalanceRestorePoint/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /套用再平衡結果/);
  assert.match(page, /復原上一步/);
  assert.doesNotMatch(page, />一鍵再平衡</);
});

test("holding progress shows after rebalance ratio", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /再平衡後/);
  assert.match(page, /holdingProgressAfter/);
});

test("operations list separates leveraged and original holdings", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /正二再平衡清單/);
  assert.match(page, /原形再平衡清單/);
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

test("rebalance rows show simple ticker text without circular badges", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /getTickerDisplayText\(item\.normalizedTicker\)/);
  assert.doesNotMatch(page, /className=\{`tickerBadge/);
  assert.doesNotMatch(styles, /\.tickerBadge/);
});

test("rebalance parameters use compact rows and conventional stepper order", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /className="operationParameterRow operationBetaField"/);
  assert.match(page, /className="operationParameterRow operationPrecisionField"/);
  assert.ok(page.indexOf('aria-label="降低再平衡 Beta 0.01"') < page.indexOf('value={rebalanceTargetBeta}'));
  assert.ok(page.indexOf('value={rebalanceTargetBeta}') < page.indexOf('aria-label="提高再平衡 Beta 0.01"'));
  assert.match(styles, /\.operationParameterRow\s*\{[^}]*grid-template-columns:/s);
});

test("mobile rebalance precision keeps both choices on one row", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(
    page,
    /className="operationPrecisionLabel"[\s\S]*?台股交易精度[\s\S]*?美股固定精確到股數。/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 480px\)[\s\S]*?\.operationPrecisionField \.precisionControl\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 420px\)[\s\S]*?\.operationPrecisionField\s*\{[^}]*grid-template-columns:/s,
  );
  assert.match(styles, /\.operationPrecisionLabel\s*\{[^}]*display:\s*grid;[^}]*gap:/s);
  assert.match(styles, /\.operationPrecisionLabel p\s*\{[^}]*font-size:\s*11px;/s);
  assert.match(styles, /\.operationPrecisionField \.precisionControl\s*\{[^}]*gap:\s*12px;/s);
});
