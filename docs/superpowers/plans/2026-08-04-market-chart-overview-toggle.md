# 0050 Market Chart Overview Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the deepest market band to 股災區間 and add an SVG detail/overview toggle that either preserves horizontal point spacing or fits the complete latest-high drawdown curve inside the card.

**Architecture:** Extend the pure chart model with a `mode` option so all geometry and label-density decisions stay outside React. Keep one SVG and one data series; React owns only the selected mode, toggle button, tooltip reset, and scroll position.

**Tech Stack:** Next.js 16, React 19, native SVG/CSS, Node.js built-in test runner.

## Global Constraints

- Public band labels are exactly 正常區間, 觀察區間, 股災區間; internal levels remain `normal`, `prepare`, `deep`.
- Detail mode is the default, retains at least 44px point spacing, and horizontally scrolls to the latest point.
- Overview mode retains every data point, uses a 760px model width, fits the card, and reduces permanent text-label density.
- Both modes retain point click, touch, keyboard, tooltip, and accessible-name behavior.
- Mode switching never fetches data or changes prices, drawdowns, high date, or market levels.
- Work only on `codex/market-level-7d-chart`; do not merge `main` or create/promote Production.

---

### Task 1: Add overview geometry and public 股災區間 naming

**Files:**
- Modify: `tests/benchmark-drawdown-chart.test.js`
- Modify: `src/lib/benchmark-drawdown-chart.js`

**Interfaces:**
- Consumes: `createBenchmarkDrawdownChart(history, highPrice, { mode? })`, defaulting to `detail`.
- Produces: the existing chart model plus `mode`; every point gains `showPercentLabel` while retaining `showDateLabel`.

- [ ] **Step 1: Write failing overview and naming tests**

Use the existing 24-record fixture and assert independent literal behavior:

```js
const detail = createBenchmarkDrawdownChart(history, 100, { mode: "detail" });
const overview = createBenchmarkDrawdownChart(history, 100, { mode: "overview" });

assert.equal(detail.mode, "detail");
assert.equal(detail.width, 1146);
assert.equal(overview.mode, "overview");
assert.equal(overview.width, 760);
assert.equal(overview.points.length, 24);
assert.deepEqual(
  overview.points.map(({ price, drawdownRatio, y }) => ({ price, drawdownRatio, y })),
  detail.points.map(({ price, drawdownRatio, y }) => ({ price, drawdownRatio, y })),
);
assert.equal(overview.points[0].showDateLabel, true);
assert.equal(overview.points.at(-1).showDateLabel, true);
assert.ok(
  overview.points.filter(({ showPercentLabel }) => showPercentLabel).length <
    detail.points.filter(({ showPercentLabel }) => showPercentLabel).length,
);
```

Change the label assertion to `assert.equal(getMarketLevelLabel("deep"), "股災區間")`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/benchmark-drawdown-chart.test.js`

Expected: FAIL because `mode`/`showPercentLabel` do not exist, overview remains wide, and `deep` is still 風險區間.

- [ ] **Step 3: Implement mode-aware pure geometry**

Change the signature and normalize the option:

```js
export function createBenchmarkDrawdownChart(history, highPrice, options = {}) {
  const mode = options.mode === "overview" ? "overview" : "detail";
```

Use `MIN_WIDTH` in overview and the current growing width in detail. Use a detail label target of 12 and overview target of 8:

```js
const width = mode === "overview"
  ? MIN_WIDTH
  : Math.max(MIN_WIDTH, PLOT.left + RIGHT_PADDING + Math.max(0, records.length - 1) * POINT_GAP);
const labelTarget = mode === "overview" ? 8 : 12;
const labelEvery = Math.max(1, Math.ceil(records.length / labelTarget));
```

Set `showDateLabel` for first/last/every interval and `showPercentLabel` to every point in detail but first/last/every interval in overview. Return `mode`. Change `MARKET_LEVEL_LABELS.deep` to `股災區間`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown.test.js`

Expected: all market chart/model tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/benchmark-drawdown-chart.test.js src/lib/benchmark-drawdown-chart.js
git commit -m "feat: add market chart overview geometry"
```

---

### Task 2: Add accessible mode toggle and responsive full-curve view

**Files:**
- Modify: `tests/benchmark-drawdown-chart.test.js`
- Modify: `tests/benchmark-drawdown-ui.test.js`
- Modify: `src/lib/benchmark-drawdown-chart.js`
- Modify: `app/page.js`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 1 chart model `mode`, `width`, `showDateLabel`, and `showPercentLabel`.
- Produces: a `detail`/`overview` UI toggle and `getMarketChartScrollLeft(scrollWidth, mode)` returning the newest edge only for detail mode.

- [ ] **Step 1: Write failing scroll and UI contract tests**

Update the scroll helper test:

```js
assert.equal(getMarketChartScrollLeft(1840, "detail"), 1840);
assert.equal(getMarketChartScrollLeft(1840, "overview"), 0);
assert.equal(getMarketChartScrollLeft(Number.NaN, "detail"), 0);
```

Add UI assertions for the literal button labels, `aria-pressed`, overview wrapper class, `股災區間`, and absence of `風險區間` in the market card source contract.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown-ui.test.js`

Expected: FAIL because the helper ignores mode and the UI has no toggle or overview class.

- [ ] **Step 3: Implement the React toggle**

In `MarketLevelCard`, add `const [chartMode, setChartMode] = useState("detail")`, pass `{ mode: chartMode }` to the model, and define:

```js
function toggleChartMode() {
  setActivePointIndex(null);
  setChartMode((current) => (current === "detail" ? "overview" : "detail"));
}
```

Add a chart-toolbar button with `aria-pressed={chartMode === "overview"}` and text selected from `看全部曲線` / `查看詳細點位`. Set the wrapper class to `marketLevelChartWrap ${chartMode}`. Render percent text only when `point.showPercentLabel`; keep every circle.

Update the scroll effect to call `getMarketChartScrollLeft(element.scrollWidth, chart.mode)` and include `chart.mode` in dependencies. In overview this resets to the left edge; switching back to detail scrolls to the newest edge.

Change the band label and legend to 股災 / 股災區間. In CSS, style the toolbar button with at least 44px height; `.marketLevelChartWrap.overview` hides horizontal overflow and `.marketLevelChartWrap.overview .marketLevelChart` uses `width: 100%`.

- [ ] **Step 4: Run focused tests, full tests, lint, and build**

Run:

```bash
node --test tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown-ui.test.js tests/benchmark-drawdown.test.js
node --test
eslint .
next build
```

Expected: all tests pass, ESLint exits 0, and the production build exits 0.

- [ ] **Step 5: Commit**

```bash
git add tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown-ui.test.js src/lib/benchmark-drawdown-chart.js app/page.js app/globals.css
git commit -m "feat: toggle full market curve overview"
```

---

### Task 3: Review, push, and Preview verification

**Files:**
- No source changes expected unless review finds an issue.

**Interfaces:**
- Consumes: completed Tasks 1-2.
- Produces: pushed `codex/market-level-7d-chart` and one Ready Vercel Preview sourced from its latest commit.

- [ ] **Step 1: Run an independent review and resolve Critical/Important findings**

Review the new commits against `docs/superpowers/specs/2026-08-04-market-chart-overview-toggle-design.md`, focusing on mode state, SVG geometry, text-label density, scroll lifecycle, point accessibility, and branch boundaries.

- [ ] **Step 2: Run fresh completion verification**

Run full tests, ESLint, build, `git diff --check origin/main...HEAD`, and `git status --short`.

Expected: zero failures/errors, successful build, no whitespace errors, and no uncommitted tracked files.

- [ ] **Step 3: Push only the feature branch**

Run: `git push origin codex/market-level-7d-chart`

Expected: the feature branch advances while `main` remains `79de9fe`.

- [ ] **Step 4: Verify the Vercel Git Preview source**

Inspect the newest deployment and build logs. Confirm target `preview`, state `READY`, branch `codex/market-level-7d-chart`, and commit equal to the pushed HEAD.

- [ ] **Step 5: Confirm Production isolation**

Inspect the production alias and remote refs. Confirm Production remains the prior deployment and remote `main` remains `79de9fe`.
