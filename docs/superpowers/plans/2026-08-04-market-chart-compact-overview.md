# 市場水位卡片緊湊總覽實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將市場水位模式按鈕移至標題列、縮小上方留白，並讓全部曲線模式只保留約 4–5 個日期且不顯示永久跌幅文字。

**Architecture:** 延續既有單一 SVG 雙模式架構。純圖表模型負責 `detail` 與 `overview` 的百分比、日期標籤策略；React 與 CSS 只負責按鈕位置、模式 class 與緊湊響應式版面，不改動資料抓取或跌幅計算。

**Tech Stack:** Next.js 16、React 19、原生 SVG/CSS、Node.js built-in test runner。

## Global Constraints

- 詳細模式維持水平滑動、每點跌幅、既有日期密度及所有點位互動。
- 全部曲線模式保留每一筆交易日資料，但永久跌幅標籤數必須為零。
- 全部曲線長序列日期標籤包含首尾，總數約 4–5 個。
- 模式按鈕位於「市場水位」標題列右側，最小操作高度 44px。
- 不改動最新高點判定、0050 價格、跌幅、市場區間或提示框內容。
- 僅更新 `codex/market-level-7d-chart` 與 Vercel Preview；不得合併 `main` 或部署 Production。

---

### Task 1: 精簡全部曲線的永久標籤

**Files:**
- Modify: `tests/benchmark-drawdown-chart.test.js`
- Modify: `src/lib/benchmark-drawdown-chart.js`

**Interfaces:**
- Consumes: `createBenchmarkDrawdownChart(history, highPrice, { mode })`。
- Produces: 每個 point 的 `showPercentLabel` 與 `showDateLabel`；詳細模式行為不變，全部曲線模式只抽樣 4–5 個日期且不顯示百分比。

- [ ] **Step 1: 寫入失敗測試**

在 24 筆資料的既有測試加入明確斷言：

```js
assert.equal(
  overview.points.filter(({ showPercentLabel }) => showPercentLabel).length,
  0,
);
const overviewDateLabels = overview.points.filter(({ showDateLabel }) => showDateLabel);
assert.ok(overviewDateLabels.length >= 4);
assert.ok(overviewDateLabels.length <= 5);
assert.equal(overviewDateLabels[0].date, history[0].date);
assert.equal(overviewDateLabels.at(-1).date, history.at(-1).date);
assert.equal(
  model.points.filter(({ showPercentLabel }) => showPercentLabel).length,
  history.length,
);
```

- [ ] **Step 2: 執行測試確認 RED**

Run: `node --test tests/benchmark-drawdown-chart.test.js`

Expected: FAIL，因為目前 overview 仍顯示抽樣百分比，日期約為 8 個。

- [ ] **Step 3: 實作模式專屬標籤策略**

在 `createBenchmarkDrawdownChart` 將日期目標與百分比規則分開：

```js
const dateLabelTarget = mode === "overview" ? 5 : 12;
const dateLabelEvery = Math.max(
  1,
  Math.ceil((records.length - 1) / Math.max(1, dateLabelTarget - 1)),
);

showDateLabel:
  isFirst || isLast || (mode === "overview" && index % dateLabelEvery === 0) ||
  (mode === "detail" && index % dateLabelEvery === 0),
showPercentLabel: mode === "detail",
```

首尾必須強制顯示；空資料與單點資料不得除以零。

- [ ] **Step 4: 執行模型測試確認 GREEN**

Run: `node --test tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown.test.js`

Expected: 所有市場水位模型測試通過。

- [ ] **Step 5: 提交**

```bash
git add src/lib/benchmark-drawdown-chart.js tests/benchmark-drawdown-chart.test.js
git commit -m "feat: simplify market overview labels"
```

---

### Task 2: 移動按鈕並縮小市場水位上方留白

**Files:**
- Modify: `tests/benchmark-drawdown-ui.test.js`
- Modify: `app/page.js`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 1 的 `showPercentLabel` 與 `showDateLabel`。
- Produces: 標題列內的 `.marketLevelViewButton`、移除獨立 `.marketLevelChartToolbar`，以及桌機與手機的緊湊間距。

- [ ] **Step 1: 寫入失敗的 UI 合約測試**

讀取 `MarketLevelCard` 原始碼片段，加入下列檢查：

```js
assert.match(pageSource, /marketLevelTitleActions/);
assert.match(pageSource, /cardTitleRow[\s\S]*marketLevelViewButton/);
assert.doesNotMatch(pageSource, /marketLevelChartToolbar/);
```

CSS 合約則讀取 `app/globals.css` 並確認：

```js
assert.match(cssSource, /\.marketLevelTitleActions/);
assert.match(cssSource, /\.marketLevelViewButton[\s\S]*min-height:\s*44px/);
assert.match(cssSource, /\.marketLevelHeader[\s\S]*padding:/);
```

- [ ] **Step 2: 執行 UI 測試確認 RED**

Run: `node --test tests/benchmark-drawdown-ui.test.js`

Expected: FAIL，因為按鈕仍在獨立 toolbar，且尚無標題動作容器。

- [ ] **Step 3: 將模式按鈕移到標題列**

在 `MarketLevelCard` 的 `cardTitleRow` 中建立同列結構：

```jsx
<div className="cardTitleRow marketLevelTitleRow">
  <div className="marketLevelTitleActions">
    <h2>市場水位</h2>
    <button className="infoButton small" type="button" ...>i</button>
  </div>
  <button
    type="button"
    className="marketLevelViewButton"
    aria-pressed={chartMode === "overview"}
    onClick={toggleChartMode}
  >
    {chartMode === "overview" ? "查看詳細點位" : "看全部曲線"}
  </button>
</div>
```

刪除 SVG 前方完整的 `.marketLevelChartToolbar` 區塊。模式狀態、切換函式及 aria 行為不變。

- [ ] **Step 4: 實作緊湊響應式 CSS**

使用現有 class，避免重構整張卡片：

```css
.marketLevelTitleRow {
  justify-content: space-between;
  gap: 12px;
}

.marketLevelTitleActions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.marketLevelHeader {
  padding-top: 18px;
  padding-bottom: 8px;
}

.marketLevelViewButton {
  flex: 0 0 auto;
  min-height: 44px;
}
```

在既有手機 media query 內縮小 header gap 與摘要下方空間，按鈕使用較小水平 padding，但不得低於 44px 高；移除 `.marketLevelChartToolbar` 所有規則。

- [ ] **Step 5: 執行 focused 測試確認 GREEN**

Run: `node --test tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown-ui.test.js tests/benchmark-drawdown.test.js`

Expected: 全部通過，且詳細模式合約仍存在。

- [ ] **Step 6: 執行完整驗證**

Run:

```bash
node --test
eslint .
next build
git diff --check
```

Expected: 所有測試通過、Lint 0 errors、建置成功且無 whitespace errors。

- [ ] **Step 7: 提交**

```bash
git add app/page.js app/globals.css tests/benchmark-drawdown-ui.test.js
git commit -m "style: compact market chart overview"
```

---

### Task 3: 審查、推送與 Preview 核對

**Files:**
- No source changes expected unless review finds a Critical or Important issue.

**Interfaces:**
- Consumes: Tasks 1–2 已驗證的功能分支。
- Produces: `codex/market-level-7d-chart` 最新遠端提交與一個 Ready 的 Vercel Preview。

- [ ] **Step 1: 獨立審查**

檢查本次提交相對於 `68716ad` 的差異，確認按鈕位置、詳細／總覽分工、日期密度、手機 44px 操作高度，以及 Beta 比例設定沒有回歸。修正所有 Critical 或 Important 發現。

- [ ] **Step 2: 重新執行完成前驗證**

Run:

```bash
node --test
eslint .
next build
git diff --check origin/main...HEAD
git status --short
```

Expected: 零失敗、建置成功、工作區乾淨。

- [ ] **Step 3: 僅推送功能分支**

Run: `git push origin codex/market-level-7d-chart`

Expected: 功能分支前進，遠端 `main` 仍為 `79de9fe`。

- [ ] **Step 4: 核對 Vercel Preview**

Inspect 最新 deployment 與 logs，確認 target `preview`、status `Ready`、branch `codex/market-level-7d-chart`、commit 等於 HEAD。

- [ ] **Step 5: 確認 Production 隔離**

確認 Production deployment 仍為既有版本，且未執行 promote、`--prod` 或 main merge。
