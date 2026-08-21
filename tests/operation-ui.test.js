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
  assert.match(page, /槓桿/);
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
  assert.match(page, /max=\{calculation\.maximumReachableBeta\}/);
  assert.match(page, /adjustOperationTargetBeta\(rebalanceTargetBeta, 0\.01, calculation\.maximumReachableBeta\)/);
  assert.match(page, /useState\(null\)/);
  assert.match(page, /rebalanceTargetBetaOverride === null/);
  assert.match(page, /operationRebalanceStatus/);
  assert.match(page, /getOperationRebalanceStatus/);
  assert.match(page, /cardHeaderRow operationHeaderRow/);
  assert.match(styles, /\.operationHeaderRow/);
});

test("rebalance summary labels unchanged sleeves as no adjustment needed", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /return "不需調整";/);
  assert.doesNotMatch(page, /return "無調整";/);
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
  assert.match(page, />\s*復原\s*<\/button>/);
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

  assert.match(page, /槓桿再平衡清單/);
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

test("rebalance rows show a compact exposure multiplier beside each leveraged ticker", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /className="holdingTickerLine"/);
  assert.match(page, /className="exposureMultiplierBadge"/);
  assert.match(page, /formatExposureMultiplier\(item\.assetBeta\)/);
  assert.match(styles, /\.exposureMultiplierBadge\s*\{[^}]*font-size:\s*12px;/s);
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

test("rebalance target reset stays in the stepper and enables only for a temporary target", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(
    page,
    /className="operationBetaStepper"[\s\S]*?className="operationBetaReset"[\s\S]*?disabled=\{!showTargetBetaReset\}/s,
  );
  assert.match(page, /aria-label=\{`回到目標 Beta/);
  assert.match(page, />\s*回到\s*<span>目標<\/span>/s);
  assert.match(
    styles,
    /\.operationBetaStepper\s*\{[^}]*grid-template-columns:\s*44px minmax\(88px, 120px\) 44px 54px;/s,
  );
  assert.match(styles, /\.operationBetaReset\s*\{[^}]*line-height:/s);
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
  assert.match(
    styles,
    /\.operationPrecisionField\s*\{[^}]*grid-template-columns:\s*minmax\(112px,[^)]*\)\s+minmax\(0,/s,
  );
  assert.doesNotMatch(
    styles,
    /\.operationPrecisionField\s*\{[^}]*minmax\(240px,/s,
  );
  assert.match(styles, /\.operationPrecisionField > \*\s*\{[^}]*min-width:\s*0;/s);
});

test("rebalance page uses the approved compact typography scale", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(styles, /\.operationsPageCard \.cardTitleRow h2\s*\{[^}]*font-size:\s*18px;/s);
  assert.match(styles, /\.operationBetaStepper input\s*\{[^}]*font-size:\s*16px;/s);
  assert.match(styles, /\.operationBetaStepper button\s*\{[^}]*font-size:\s*18px;/s);
  assert.match(styles, /\.holdingGroupHeader strong\s*\{[^}]*font-size:\s*16px;/s);
  assert.match(styles, /\.holdingIdentity strong\s*\{[^}]*font-size:\s*16px;/s);
  assert.match(styles, /\.holdingIdentity span,[\s\S]*?\.holdingIdentity em\s*\{[^}]*font-size:\s*12px;/s);
  assert.match(styles, /\.holdingAction strong\s*\{[^}]*font-size:\s*14px;/s);
});

test("rebalance holding cards use warm white interiors and two-line trade advice", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(styles, /\.holdingRow\s*\{[^}]*background:\s*#ffffff;/s);
  assert.match(page, /const actionSummaryText =/);
  assert.match(page, /className={`holdingActionLine \$\{displayedAction\}`}/);
  assert.match(page, /\{actionSummaryText\}/);
  assert.doesNotMatch(page, /className={`actionPill/);
  assert.doesNotMatch(page, /<em>\{estimatedShares\.toLocaleString/);
  assert.match(styles, /\.holdingActionLine\s*\{[^}]*font-size:\s*14px;/s);
});

test("rebalance apply footer uses the approved compact sizing", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(styles, /\.operationApplyFooter\s*\{[^}]*gap:\s*8px;[^}]*padding:\s*14px;/s);
  assert.match(styles, /\.operationApplyActions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.6fr\)\s+minmax\(88px,\s*0\.8fr\);[^}]*gap:\s*8px;/s);
  assert.match(styles, /\.operationApplyActions :is\(\.primaryButton, \.secondaryButton\)\s*\{[^}]*min-height:\s*42px;/s);
  assert.match(page, />\s*套用再平衡結果\s*<\/button>[\s\S]*?>\s*復原\s*<\/button>/s);
  assert.match(styles, /\.operationRestoreStatus\s*\{[^}]*padding:\s*0;[^}]*color:\s*var\(--muted\);[^}]*background:\s*transparent;[^}]*font-size:\s*11px;/s);
});
