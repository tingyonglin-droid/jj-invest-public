# 0050 Seven-Day Market Level Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 0050 market-level summary with a responsive seven-trading-day drawdown chart whose points reveal price and market-level details when clicked.

**Architecture:** Extend the existing benchmark drawdown model with normalized seven-day history, then add a focused pure chart-layout module for SVG coordinates and tooltip placement. Render the SVG and its click/keyboard interaction inside the existing homepage card, with all visual behavior isolated to market-level CSS classes.

**Tech Stack:** Next.js 16, React 19, native SVG, CSS, Node.js built-in test runner.

## Global Constraints

- Use the latest seven valid trading records, not seven calendar days.
- Reuse the current history and live-quote requests; add no database, chart dependency, or external data service.
- Calculate every drawdown against the full valid history's highest closing price.
- A valid live quote replaces the same-date close or appends a new latest point; keep at most seven chart points.
- A clicked point must show date, 0050 price, drawdown percentage, and market-level label.
- The chart must remain usable on desktop, mobile, and by keyboard.

---

### Task 1: Seven-day benchmark history model

**Files:**
- Modify: `src/lib/benchmark-drawdown.js`
- Modify: `tests/benchmark-drawdown.test.js`

**Interfaces:**
- Consumes: `createBenchmarkDrawdown(prices, { currentQuote })`
- Produces: the existing summary fields plus `currentSource: "live" | "close"` and `history: Array<{ date, price, drawdownRatio, level }>`.

- [ ] **Step 1: Write failing model tests**

Add literal fixtures proving that invalid values are discarded, duplicate dates keep the last value, records are sorted, only the final seven remain, all drawdowns use the full-history closing high, and a live quote replaces/appends the latest date without changing the historical closing high.

```js
assert.deepEqual(result.history.map(({ date }) => date), [
  "2026-07-24", "2026-07-27", "2026-07-28", "2026-07-29",
  "2026-07-30", "2026-07-31", "2026-08-03",
]);
assert.equal(result.history.at(-1).price, 102.03);
assert.equal(result.history.at(-1).drawdownRatio, -0.082051);
assert.equal(result.currentSource, "live");
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/benchmark-drawdown.test.js`

Expected: FAIL because `history` and `currentSource` do not exist.

- [ ] **Step 3: Implement minimal normalization and history output**

Use a `Map` keyed by date after filtering, sort the resulting values, calculate the close-only high before merging the live quote, and map the final seven records through `getBenchmarkDrawdownLevel`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/benchmark-drawdown.test.js`

Expected: all benchmark drawdown tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/benchmark-drawdown.js tests/benchmark-drawdown.test.js
git commit -m "feat: model seven-day 0050 drawdown history"
```

### Task 2: SVG chart layout model

**Files:**
- Create: `src/lib/benchmark-drawdown-chart.js`
- Create: `tests/benchmark-drawdown-chart.test.js`

**Interfaces:**
- Consumes: `createBenchmarkDrawdownChart(history, highPrice)`.
- Produces: `{ viewBox, plot, points, linePoints, thresholds }`, where each point includes `x`, `y`, label position, `tooltipX`, and `tooltipAnchor`.

- [ ] **Step 1: Write failing coordinate tests**

Test hand-derived positions at 0%, -10%, -20%, and -30%, equal horizontal spacing for seven points, clamping beyond the vertical scale, threshold prices `highPrice * 0.9` and `highPrice * 0.8`, and inward tooltip anchors for the first and last points.

```js
assert.deepEqual(model.points.map(({ y }) => y), [40, 140, 240, 340]);
assert.equal(model.points[0].tooltipAnchor, "start");
assert.equal(model.points.at(-1).tooltipAnchor, "end");
assert.equal(model.thresholds[1].price, 100.04);
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/benchmark-drawdown-chart.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal pure layout function**

Use a fixed `760 × 430` viewBox with plot bounds `{ left: 92, right: 718, top: 40, bottom: 340 }`; map 0 to -30% linearly into that range and clamp only the visual position. Return stable tooltip geometry without DOM measurement.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/benchmark-drawdown-chart.test.js`

Expected: all chart-model tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/benchmark-drawdown-chart.js tests/benchmark-drawdown-chart.test.js
git commit -m "feat: add market-level chart layout model"
```

### Task 3: Interactive market-level card

**Files:**
- Modify: `app/page.js`
- Modify: `tests/benchmark-drawdown-ui.test.js`

**Interfaces:**
- Consumes: `createBenchmarkDrawdownChart(benchmarkDrawdown.history, benchmarkDrawdown.highPrice)` and the extended benchmark model.
- Produces: the user-visible SVG chart and local `activePointIndex` interaction state.

- [ ] **Step 1: Write failing behavior tests for interaction helpers**

Export pure helpers from `src/lib/benchmark-drawdown-chart.js` and test that `toggleActiveMarketPoint(currentIndex, clickedIndex)` opens, switches, and closes a point, while `getMarketLevelLabel(level)` returns `正常區間`, `觀察區間`, or `風險區間`.

```js
assert.equal(toggleActiveMarketPoint(null, 2), 2);
assert.equal(toggleActiveMarketPoint(2, 5), 5);
assert.equal(toggleActiveMarketPoint(5, 5), null);
assert.equal(getMarketLevelLabel("prepare"), "觀察區間");
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/benchmark-drawdown-chart.test.js`

Expected: FAIL because the interaction helpers are not implemented.

- [ ] **Step 3: Implement the helpers and card markup**

Replace `MarketLevelCard` summary body with top summaries, SVG background bands, thresholds, line, seven focusable point buttons, date labels, legend, and source footer. On point click or Enter/Space, toggle `activePointIndex`; clicking the SVG background clears it. Render the selected point's detail box with its literal date, formatted price, signed drawdown, and level label.

- [ ] **Step 4: Verify GREEN and build parsing**

Run: `npm test -- tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown-ui.test.js`

Run: `npm run build`

Expected: tests pass and Next.js compiles the JSX.

- [ ] **Step 5: Commit**

```bash
git add app/page.js src/lib/benchmark-drawdown-chart.js tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown-ui.test.js
git commit -m "feat: render interactive 0050 market-level chart"
```

### Task 4: Responsive visual styling and full verification

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: the `marketLevel*` class names rendered by Task 3.
- Produces: desktop and mobile card layouts matching the approved three-band visual design.

- [ ] **Step 1: Add scoped responsive CSS**

Create styles for the summary grid, three band colors, line and points, tooltip card, legends, footer, focus-visible states, and a mobile media-query layout. Keep SVG width at `100%`, prevent overflow, and allow tooltip text wrapping.

- [ ] **Step 2: Run focused and full verification**

Run: `npm test -- tests/benchmark-drawdown.test.js tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown-ui.test.js`

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

Expected: every command exits 0 with no test failures, lint errors, or build errors.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: finish responsive market-level chart"
```

### Task 5: Preview, merge, and production deployment

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: verified feature branch.
- Produces: Vercel Preview URL, merged `main`, and successful production deployment.

- [ ] **Step 1: Push the feature branch and deploy Preview**

Push `codex/market-level-7d-chart`, deploy a non-production Vercel Preview, and record its URL.

- [ ] **Step 2: Inspect Preview at desktop and mobile widths**

Verify seven points, correct current/high summaries, three bands, first/middle/last tooltip placement, keyboard activation, mobile wrapping, and no horizontal overflow.

- [ ] **Step 3: Merge only after Preview verification**

Fast-forward or merge the reviewed feature branch into `main`, preserving unrelated user work.

- [ ] **Step 4: Push `main` and verify Production**

Deploy production, inspect the deployment status and live page, and confirm the same chart and tooltip checks.
