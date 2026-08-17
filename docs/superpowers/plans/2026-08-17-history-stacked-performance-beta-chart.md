# History Stacked Performance and Beta Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the history chart mode toggle with vertically stacked performance and Beta charts that share one Zoom range, aligned dates, synchronized crosshair, and one combined tooltip.

**Architecture:** Keep history normalization and chart geometry in `src/lib/history.js`, adding a calendar-range filter and a paired-model constructor so both charts always consume the same ordered records. In `app/page.js`, replace the mode-specific `HistoryChart` with one `HistoryStackedChart` that owns a shared active index and renders two reusable SVG panels. Reuse the market-level Zoom visual language in `app/globals.css` while preserving the current history series colors and responsive card structure.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, JavaScript, SVG, CSS, Node.js built-in test runner.

## Global Constraints

- The performance chart is above the Beta chart on desktop and mobile.
- Both charts use the same ordered date records and aligned X coordinates.
- Date labels render only beneath the Beta chart.
- Zoom options are exactly `1M / 3M / 6M / 1Y`, with `1M` selected by default.
- One synchronized crosshair and one tooltip expose date, portfolio performance, 0050 performance, and portfolio Beta.
- Each chart keeps its own Y scale.
- Existing history summary, recent records, clear/restore actions, and other pages must remain unchanged.
- Do not add dependencies.

---

### Task 1: Calendar Zoom Filtering and Paired Chart Models

**Files:**
- Modify: `src/lib/history.js`
- Test: `tests/history.test.js`

**Interfaces:**
- Consumes: normalized history record objects with `date`, `totalAssetsTwd`, `benchmark0050Price`, `currentBeta`, `targetBeta`, `betaLower`, and `betaUpper`.
- Produces: `filterHistoryRecordsByRange(records, range = "1M")` returning ordered records inside the calendar window ending on the latest valid record date.
- Produces: `createHistoryStackedChartModel(records)` returning `{ labels, performance, beta }`, where `performance` and `beta` are existing chart model shapes and share identical `labels` and data-point X positions.

- [ ] **Step 1: Write failing range and paired-model tests**

Add imports for `filterHistoryRecordsByRange` and `createHistoryStackedChartModel`, then add tests equivalent to:

```js
it("filters history with calendar Zoom ranges ending on the latest record", () => {
  const records = [
    { date: "2025-08-17" },
    { date: "2026-02-17" },
    { date: "2026-05-17" },
    { date: "2026-07-16" },
    { date: "2026-07-17" },
    { date: "2026-08-17" },
  ];

  assert.deepEqual(filterHistoryRecordsByRange(records, "1M").map(({ date }) => date), [
    "2026-07-17",
    "2026-08-17",
  ]);
  assert.equal(filterHistoryRecordsByRange(records, "3M")[0].date, "2026-05-17");
  assert.equal(filterHistoryRecordsByRange(records, "6M")[0].date, "2026-02-17");
  assert.equal(filterHistoryRecordsByRange(records, "1Y")[0].date, "2025-08-17");
  assert.deepEqual(filterHistoryRecordsByRange(records, "unknown"), filterHistoryRecordsByRange(records, "1M"));
});

it("creates aligned performance and Beta models from the same records", () => {
  const records = [
    { date: "2026-07-17", totalAssetsTwd: 100, benchmark0050Price: 100, currentBeta: 1.1, targetBeta: 1.2, betaLower: 1.08, betaUpper: 1.32 },
    { date: "2026-07-28", totalAssetsTwd: 103, benchmark0050Price: 101, currentBeta: 1.18, targetBeta: 1.2, betaLower: 1.08, betaUpper: 1.32 },
    { date: "2026-08-17", totalAssetsTwd: 106, benchmark0050Price: 104, currentBeta: 1.24, targetBeta: 1.2, betaLower: 1.08, betaUpper: 1.32 },
  ];
  const stacked = createHistoryStackedChartModel(records);

  assert.deepEqual(stacked.performance.labels, stacked.beta.labels);
  assert.deepEqual(
    stacked.performance.dataPoints.map(({ date, x }) => [date, x]),
    stacked.beta.dataPoints.map(({ date, x }) => [date, x]),
  );
  assert.ok(stacked.performance.dataPoints[1].x < stacked.performance.width / 2);
  assert.notEqual(stacked.performance.minValue, stacked.beta.minValue);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test tests/history.test.js`

Expected: FAIL because both new exports are missing.

- [ ] **Step 3: Implement calendar filtering and paired model construction**

Add a range-month map, a month-end-safe calendar helper, and exported helpers near the chart model functions:

```js
const HISTORY_RANGE_MONTHS = Object.freeze({
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
});

function subtractCalendarMonths(dateText, months) {
  const [year, month, day] = dateText.split("-").map(Number);
  const targetMonthIndex = year * 12 + month - 1 - months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function filterHistoryRecordsByRange(records, range = "1M") {
  const normalized = normalizeHistoryRecords(records);
  const latestDate = normalized.at(-1)?.date;
  if (!latestDate) return [];

  const months = HISTORY_RANGE_MONTHS[range] || HISTORY_RANGE_MONTHS["1M"];
  const startKey = subtractCalendarMonths(latestDate, months);
  return normalized.filter((record) => record.date >= startKey);
}

export function createHistoryStackedChartModel(records) {
  const performance = createHistoryChartModel(records, "performance");
  const beta = createHistoryChartModel(records, "beta");
  return { labels: performance.labels, performance, beta };
}
```

Keep `normalizeHistoryRecords` as the sole sorting and validation path. Add a month-end assertion such as latest `2026-03-31` including `2026-02-28` in `1M`.

Refactor geometry to use elapsed date time instead of the array index. Add:

```js
function createDateXPositions(records, plot) {
  if (!records.length) return [];
  const times = records.map((record) => Date.parse(`${record.date}T00:00:00Z`));
  const first = times[0];
  const span = times.at(-1) - first || 1;
  return times.map((time) => roundNumber(plot.left + ((time - first) / span) * plot.width, 2));
}
```

Change `createPoints(values, xPositions, plot, minValue, maxValue)` and `getPointCoordinate(x, value, plot, minValue, maxValue)` to consume these shared X coordinates. In `createHistoryChartModel`, derive `xPositions` once from `normalized`, pass it to every series, and assign `dataPoints[index].x = xPositions[index]`. This makes real date gaps proportional while keeping performance and Beta perfectly aligned.

- [ ] **Step 4: Run focused tests and verify success**

Run: `node --test tests/history.test.js`

Expected: PASS, including month-end boundary coverage added alongside the main test.

- [ ] **Step 5: Commit the data/model change**

```bash
git add src/lib/history.js tests/history.test.js
git commit -m "feat: add history zoom and aligned chart models"
```

---

### Task 2: Replace History Chart Controls and Render Stacked Panels

**Files:**
- Modify: `app/page.js`
- Test: `tests/history-ui.test.js`

**Interfaces:**
- Consumes: `filterHistoryRecordsByRange(records, historyRange)` and `createHistoryStackedChartModel(chartRecords)` from Task 1.
- Produces: `HistoryStackedChart({ model })`, which renders performance then Beta and owns one `activePointIndex` shared by both panels.
- Produces: `HistoryChartPanel({ model, activePointIndex, onActivePointChange, showDateAxis })`, a presentational SVG panel with no independent selected-date state.

- [ ] **Step 1: Replace obsolete UI assertions with failing stacked-chart assertions**

Update `tests/history-ui.test.js` so the range test requires the new state and controls, and the interaction test requires the shared model:

```js
it("uses market-style Zoom ranges for both history charts", () => {
  assert.match(pageSource, /useState\("1M"\)/);
  assert.match(pageSource, /\["1M", "3M", "6M", "1Y"\]/);
  assert.doesNotMatch(pageSource, />7天</);
  assert.doesNotMatch(pageSource, />30天</);
  assert.doesNotMatch(pageSource, /historyModeTabs/);
});

it("renders aligned performance and Beta panels with one shared interaction", () => {
  assert.match(pageSource, /createHistoryStackedChartModel/);
  assert.match(pageSource, /HistoryChartPanel/);
  assert.match(pageSource, /showDateAxis=\{false\}/);
  assert.match(pageSource, /showDateAxis=\{true\}/);
  assert.match(pageSource, /activePointIndex/);
  assert.match(pageSource, /投組績效/);
  assert.match(pageSource, /投組 Beta/);
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test tests/history-ui.test.js`

Expected: FAIL because the page still contains mode tabs and 7/30-day state.

- [ ] **Step 3: Replace page state and HistoryView props**

Change the page state and call site:

```js
const [historyRange, setHistoryRange] = useState("1M");
```

Pass only `historyRange={historyRange}` and `onRangeChange={setHistoryRange}`. Remove `historyMode`, `setHistoryMode`, `historyRangeDays`, `setHistoryRangeDays`, `onModeChange`, and the old `getHistoryChartRecords` slice helper.

Inside `HistoryView`, construct:

```js
const chartRecords = filterHistoryRecordsByRange(records, historyRange);
const chartModel = createHistoryStackedChartModel(chartRecords);
const chartDateRange = chartRecords.length
  ? `${chartRecords[0].date.slice(5).replace("-", "/")}–${chartRecords.at(-1).date.slice(5).replace("-", "/")}`
  : "";
```

- [ ] **Step 4: Add one Zoom row and the stacked chart component**

Replace the old tab controls with:

```jsx
<div className="historyZoomRow">
  <div className="historyZoomControls" aria-label="歷史顯示期間">
    <span>Zoom</span>
    {["1M", "3M", "6M", "1Y"].map((range) => (
      <button
        type="button"
        key={range}
        aria-pressed={historyRange === range}
        onClick={() => onRangeChange(range)}
      >
        {range}
      </button>
    ))}
  </div>
  <span className="historyChartDateRange">{chartDateRange}</span>
</div>
<HistoryStackedChart model={chartModel} />
```

Implement `HistoryStackedChart` with one `activePointIndex`. Render headings and legends above two `HistoryChartPanel` instances. Pass `showDateAxis={false}` to performance and `showDateAxis={true}` to Beta. Render one tooltip outside both SVGs with:

```jsx
<strong>{performancePoint.date}</strong>
<span>投組績效 {formatSignedPercent(performancePoint.portfolioReturn)}</span>
<span>0050 {performancePoint.benchmarkReturn === null ? "資料不足" : formatSignedPercent(performancePoint.benchmarkReturn)}</span>
<span>投組 Beta {formatNumber(betaPoint.currentBeta)}</span>
```

In each `HistoryChartPanel`, use the point index for focus, pointer-enter, click, and keyboard activation. Render the crosshair and marker from the shared index. Only render `model.xTicks` when `showDateAxis` is true.

- [ ] **Step 5: Run UI and history tests and verify success**

Run: `node --test tests/history-ui.test.js tests/history.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the component behavior**

```bash
git add app/page.js tests/history-ui.test.js
git commit -m "feat: stack synchronized history charts"
```

---

### Task 3: Match the Approved Responsive Visual Design

**Files:**
- Modify: `app/globals.css`
- Test: `tests/history-ui.test.js`

**Interfaces:**
- Consumes: `.historyZoomRow`, `.historyZoomControls`, `.historyChartStack`, `.historyChartPanel`, `.historyPanelHeader`, `.historyChartSvg`, and `.historyTooltip` markup from Task 2.
- Produces: market-level-style Zoom controls and two vertically aligned responsive SVG panels.

- [ ] **Step 1: Add failing CSS structure assertions**

Add a UI test equivalent to:

```js
it("styles stacked history charts with market-style Zoom controls", () => {
  assert.match(styles, /\.historyZoomRow\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s);
  assert.match(styles, /\.historyZoomControls button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--action-selected\);/s);
  assert.match(styles, /\.historyChartStack\s*\{[^}]*display:\s*grid;/s);
  assert.match(styles, /\.historyChartPanel \+ \.historyChartPanel/);
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test tests/history-ui.test.js`

Expected: FAIL because the new selectors are not styled.

- [ ] **Step 3: Replace obsolete tab CSS with stacked-chart styling**

Remove `.historyModeTabs` and `.historyRangeTabs` rules. Add styles following the existing market-level control dimensions and approved visual:

```css
.historyZoomRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.historyZoomControls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.historyZoomControls button {
  min-width: 44px;
  min-height: 40px;
  border: 0;
  border-radius: 12px;
  color: var(--text);
  background: #f1f4f6;
  font-size: 13px;
  font-weight: 820;
}

.historyZoomControls button[aria-pressed="true"] {
  background: var(--action-selected);
}

.historyChartStack { position: relative; display: grid; gap: 12px; }
.historyChartPanel + .historyChartPanel { margin-top: 4px; }
.historyChartPanel { min-width: 0; }
.historyPanelHeader { display: flex; align-items: center; justify-content: space-between; margin: 0 8px 4px 44px; }
.historyPanelHeader h3 { margin: 0; font-size: 15px; font-weight: 840; }
.historyChartPanel .historyChartSvg { height: 168px; }
.historyChartPanel:first-child .historyXAxisLabel { display: none; }
.historyChartDateRange { color: var(--muted); font-size: 12px; font-weight: 760; white-space: nowrap; }

@media (max-width: 560px) {
  .historyZoomRow { align-items: flex-start; gap: 8px; }
  .historyZoomControls { gap: 4px; }
  .historyZoomControls button { min-width: 40px; min-height: 38px; }
  .historyPanelHeader { margin-left: 38px; }
  .historyChartPanel .historyChartSvg { height: 150px; }
}
```

Keep the common `CHART_PLOT` geometry from Task 1 as the source of horizontal alignment. `showDateAxis` remains the rendering authority for date labels; the first-panel CSS rule is only a defensive guard.

- [ ] **Step 4: Run UI tests and verify success**

Run: `node --test tests/history-ui.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the visual styling**

```bash
git add app/globals.css tests/history-ui.test.js
git commit -m "style: align stacked history chart layout"
```

---

### Task 4: Regression, Build, Visual Verification, and Preview Deployment

**Files:**
- Modify only if verification finds a scoped defect: `app/page.js`, `app/globals.css`, `src/lib/history.js`, `tests/history.test.js`, `tests/history-ui.test.js`

**Interfaces:**
- Consumes: completed stacked history chart from Tasks 1–3.
- Produces: verified desktop/mobile behavior and a Vercel Preview URL for this branch.

- [ ] **Step 1: Run formatting and full automated regression checks**

Run:

```bash
git diff --check
pnpm test
pnpm build
```

Expected: no whitespace errors, all tests PASS, and the Next.js production build succeeds.

- [ ] **Step 2: Start the app and verify the approved interaction at desktop width**

Open the history page at approximately 1024px width with demo history loaded. Verify:

- Zoom shows `1M / 3M / 6M / 1Y` and defaults to `1M`.
- Performance is above Beta.
- X positions align and dates appear only below Beta.
- Hovering either panel produces aligned guides in both panels and one tooltip containing all four values.
- Switching every Zoom option updates both panels and the displayed date range.

- [ ] **Step 3: Verify mobile layout**

At approximately 390px width, verify the Zoom row remains usable, no text or tooltip escapes the card, both charts remain vertically stacked, date labels do not overlap, and keyboard/focus interaction remains available.

- [ ] **Step 4: Fix only observed scoped defects and rerun verification**

For each defect, first add or tighten the smallest relevant automated test, verify it fails, apply the minimal code or CSS fix, and rerun `pnpm test` plus `pnpm build`.

- [ ] **Step 5: Commit any verification fixes**

If files changed during visual verification:

```bash
git add app/page.js app/globals.css src/lib/history.js tests/history.test.js tests/history-ui.test.js
git commit -m "fix: polish stacked history chart"
```

- [ ] **Step 6: Deploy and verify Vercel Preview**

Run the repository's established Vercel Preview deployment command, wait until the deployment reports Ready, then request the Preview URL and verify it returns HTTP 200.

- [ ] **Step 7: Report the result**

Provide the Preview link, summarize the stacked chart and Zoom behavior, and report test/build results. Do not merge to `main` without a separate user instruction.
