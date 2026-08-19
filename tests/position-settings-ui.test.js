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

test("holding settings omit the normalized ticker hint", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.doesNotMatch(page, /正規化代號：/);
});

test("holding editors use compact two-column fields and asset tones", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /className=\{`positionSection \$\{assetType\}/);
  assert.match(page, /className="positionEditorPrimaryFields"/);
  assert.match(page, /className="positionEditorAllocationField"/);
  assert.match(styles, /\.positionEditorPrimaryFields\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(styles, /@media \(max-width: 420px\)[\s\S]*\.positionEditorPrimaryFields/s);
});

test("leveraged holding editors expose a bounded multiplier and updated labels", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /曝險倍數/);
  assert.match(page, /min="1"/);
  assert.match(page, /max="3"/);
  assert.match(page, /step="0\.1"/);
  assert.match(page, /新增槓桿/);
  assert.match(page, /assetBeta: ""/);
});

test("beta parameters keep target beta fixed and present allocation as a result", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /<span>目標 Beta<\/span>/);
  assert.match(page, /onUpdateSetting\("targetBeta"/);
  assert.match(page, /placeholder="1\.0 \/ 1\.2 \/ 1\.4 \/ 1\.6"/);
  assert.match(page, /targetBeta: ""/);
  assert.match(page, /Beta 是目標，持股是工具，現金是結果/);
  assert.doesNotMatch(page, /槓桿目標比例 %/);
  assert.match(page, /原形目標比例 %/);
});

test("beta guidance waits for a configured holding before showing calculated allocation", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /const hasConfiguredPositions =/);
  assert.match(page, /請新增至少一檔槓桿或原形標的/);
  assert.match(page, /依目前持股推算配置/);
  assert.match(page, /positionGroups\.leveraged\.length > 0/);
  assert.match(page, /id: "position-1",\s*tickerInput: ""/s);
  assert.doesNotMatch(page, /className="weightGuardBeta"/);
  assert.match(page, /hasConfiguredPositions && calculation\.errors\.length > 0/);
  assert.match(
    page,
    /className="betaSetupStep"[\s\S]*?先設定目標 Beta[\s\S]*?className="betaSetupStep"[\s\S]*?接下來至持股頁新增持股[\s\S]*?className="betaSetupStep"[\s\S]*?接下來至現金頁填寫可用資金/s,
  );
  assert.match(page, /若有類現金 ETF，也可一併新增/);
});

test("calculated allocation places its ratios on a separate line", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(
    page,
    /<strong>\s*<span>依目前持股推算配置<\/span>\s*<span className="weightGuardRatios">/s,
  );
});

test("beta settings configure original allocation without a redundant leveraged card", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /原形配置/);
  assert.match(page, /維持目前比例/);
  assert.match(page, /自訂目標比例/);
  assert.match(page, /尚未新增原形標的/);
  assert.match(page, /請設定原形目標比例/);
  assert.doesNotMatch(page, /<strong>槓桿配置<\/strong>/);
  assert.match(page, /目前可達 Beta/);
  assert.match(page, /現金部位包含/);
});

test("cash-equivalent settings clarify that real cash is within the cash sleeve", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /現金部位內的真實現金比例/);
  assert.match(page, /只分配現金部位，不代表占總資產的比例/);
});

test("settings intro matches rebalance heading typography and subtitle gap", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /className="cardTitleRow settingsTitleRow">\s*<p>參數設定<\/p>/s);
  assert.match(styles, /\.settingsTitleRow\s*\{[^}]*min-height:\s*32px;[^}]*align-items:\s*center;/s);
  assert.match(styles, /\.settingsIntro p\s*\{[^}]*font-size:\s*18px;[^}]*font-weight:\s*760;/s);
  assert.match(styles, /\.betaSetupStep strong\s*\{[^}]*line-height:\s*22px;/s);
  assert.match(styles, /\.settingsIntro span\s*\{[^}]*margin-top:\s*3px;/s);
  assert.doesNotMatch(styles, /@media \(max-width:\s*480px\)[\s\S]*?\.settingsIntro p\s*\{/s);
});
