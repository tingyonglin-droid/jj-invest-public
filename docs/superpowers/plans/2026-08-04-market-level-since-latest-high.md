# 0050 Latest-High Market Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven-trading-day market-level window with every trading day from the latest historical highest close through the current quote, using a horizontally scrollable interactive chart.

**Architecture:** Keep the existing Yahoo history API and `createBenchmarkDrawdown` public model. Change the drawdown selector to choose the latest occurrence of the maximum historical close and retain every record from that date, then make the SVG chart model width grow with its point count while the React card owns scroll-to-latest behavior.

**Tech Stack:** Next.js 16 App Router, React 19, native SVG, CSS, Node.js built-in test runner.

## Global Constraints

- Historical-high detection uses valid historical closes only; live prices never reset the chart start.
- Equal maximum closes use the latest date.
- Every valid trading date from the latest high is retained; weekends, holidays absent from the feed, invalid prices, and duplicate dates are not fabricated.
- No chart library, database, or external data service is added.
- Work only on `codex/market-level-7d-chart`; do not merge `main` or create/promote a Production deployment.

---

### Task 1: Select the latest high and retain the full drawdown cycle

**Files:**
- Modify: `tests/benchmark-drawdown.test.js`
- Modify: `src/lib/benchmark-drawdown.js`

**Interfaces:**
- Consumes: `createBenchmarkDrawdown(prices, { currentQuote? })` with historical `{ date, price }[]` and an optional live quote.
- Produces: the existing drawdown object whose `history` contains all valid records from `highDate` through `currentDate`.

- [ ] **Step 1: Replace the obsolete seven-point expectation with failing latest-high-cycle tests**

Add fixtures that assert literal dates and values:

```js
it("keeps every trading date from the latest historical closing high", () => {
  const drawdown = createBenchmarkDrawdown([
    { date: "2026-06-19", price: 99 },
    { date: "2026-06-22", price: 100 },
    { date: "2026-06-23", price: 99 },
    { date: "2026-06-24", price: 98 },
    { date: "2026-06-25", price: 97 },
    { date: "2026-06-26", price: 96 },
    { date: "2026-06-29", price: 95 },
    { date: "2026-06-30", price: 94 },
    { date: "2026-07-01", price: 93 },
  ]);

  assert.equal(drawdown.highDate, "2026-06-22");
  assert.deepEqual(drawdown.history.map(({ date }) => date), [
    "2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25",
    "2026-06-26", "2026-06-29", "2026-06-30", "2026-07-01",
  ]);
});

it("restarts at the latest date that matches the highest close", () => {
  const drawdown = createBenchmarkDrawdown([
    { date: "2026-06-22", price: 100 },
    { date: "2026-06-23", price: 98 },
    { date: "2026-07-02", price: 100 },
    { date: "2026-07-03", price: 97 },
  ]);

  assert.equal(drawdown.highDate, "2026-07-02");
  assert.deepEqual(drawdown.history.map(({ date }) => date), ["2026-07-02", "2026-07-03"]);
});
```

Keep the existing live-quote test and strengthen it to assert that a live price above the closing high does not change `highDate` or remove the closing-high start point.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/benchmark-drawdown.test.js`

Expected: FAIL because the current model slices to seven dates and chooses the first rather than latest equal high.

- [ ] **Step 3: Implement the minimal latest-high selection and history filter**

Change the historical-high reducer so equal values select the later record:

```js
const high = validPrices.reduce(
  (best, item) => (item.price >= best.price ? item : best),
  validPrices[0],
);
```

Replace `.slice(-7)` with a filter beginning at `high.date`, after the existing current-date cutoff:

```js
.filter((item) => item.date >= high.date && item.date <= current.date)
```

Do not include `liveCurrent` in the high reducer.

- [ ] **Step 4: Run focused and full model tests and verify GREEN**

Run: `node --test tests/benchmark-drawdown.test.js`

Expected: all benchmark drawdown tests pass with no warnings.

- [ ] **Step 5: Commit the model behavior**

```bash
git add tests/benchmark-drawdown.test.js src/lib/benchmark-drawdown.js
git commit -m "feat: chart market level from latest high"
```

---

### Task 2: Grow the SVG chart for all retained trading dates

**Files:**
- Modify: `tests/benchmark-drawdown-chart.test.js`
- Modify: `src/lib/benchmark-drawdown-chart.js`

**Interfaces:**
- Consumes: `createBenchmarkDrawdownChart(history, highPrice)` and the variable-length `history` produced by Task 1.
- Produces: `{ width, height, viewBox, plot, points, linePoints, thresholds }`, where every point also contains `showDateLabel`, `tooltipX`, and `tooltipAnchor`.

- [ ] **Step 1: Write failing dynamic-width and label-density tests**

Add a 24-record fixture and hand-check these contracts:

```js
it("grows wide charts without dropping trading dates", () => {
  const history = Array.from({ length: 24 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    price: 100 - index,
    drawdownRatio: -index / 100,
    level: index < 10 ? "normal" : index < 20 ? "prepare" : "deep",
  }));
  const model = createBenchmarkDrawdownChart(history, 100);

  assert.equal(model.points.length, 24);
  assert.ok(model.width > 760);
  assert.ok(model.points[1].x - model.points[0].x >= 44);
  assert.equal(model.points[0].showDateLabel, true);
  assert.equal(model.points.at(-1).showDateLabel, true);
  assert.equal(model.plot.right, model.width - 42);
});
```

Update the seven-point coordinate test to assert spacing, tooltips, and boundary behavior rather than the old fixed x-coordinate list.

- [ ] **Step 2: Run the chart-model test and verify RED**

Run: `node --test tests/benchmark-drawdown-chart.test.js`

Expected: FAIL because `width` and `showDateLabel` do not exist and the current plot always remains 760 pixels wide.

- [ ] **Step 3: Implement dynamic geometry**

Use constants `MIN_WIDTH = 760`, `POINT_GAP = 44`, `LEFT = 92`, `RIGHT_PADDING = 42`, and compute:

```js
const width = Math.max(MIN_WIDTH, LEFT + RIGHT_PADDING + Math.max(0, records.length - 1) * POINT_GAP);
const plot = { ...PLOT, right: width - RIGHT_PADDING };
const labelEvery = Math.max(1, Math.ceil(records.length / 12));
```

Space points across `plot.left..plot.right`, set `showDateLabel` for the first, last, and every `labelEvery` point, extend threshold metadata and the returned `viewBox` to `width`, and calculate tooltip anchors from the first/last point exactly as before.

- [ ] **Step 4: Run the chart-model tests and verify GREEN**

Run: `node --test tests/benchmark-drawdown-chart.test.js`

Expected: all chart-model tests pass.

- [ ] **Step 5: Commit the chart geometry**

```bash
git add tests/benchmark-drawdown-chart.test.js src/lib/benchmark-drawdown-chart.js
git commit -m "feat: expand market chart across trading dates"
```

---

### Task 3: Add scroll-to-latest UI and variable-width rendering

**Files:**
- Modify: `tests/benchmark-drawdown-ui.test.js`
- Modify: `tests/benchmark-drawdown-chart.test.js`
- Modify: `src/lib/benchmark-drawdown-chart.js`
- Modify: `app/page.js`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: the Task 2 chart model, including `width`, `height`, dynamic `plot.right`, and `point.showDateLabel`.
- Produces: `getMarketChartScrollLeft(scrollWidth)` plus a horizontally scrollable chart that starts at the latest point and preserves point click/keyboard tooltip behavior.

- [ ] **Step 1: Write a failing scroll-target behavior test**

Add this real helper contract to `tests/benchmark-drawdown-chart.test.js`:

```js
it("targets the newest edge when the chart is wider than its viewport", () => {
  assert.equal(getMarketChartScrollLeft(1840), 1840);
  assert.equal(getMarketChartScrollLeft(0), 0);
  assert.equal(getMarketChartScrollLeft(Number.NaN), 0);
});
```

Remove the obsolete `最近七個交易日` assertion from `tests/benchmark-drawdown-ui.test.js`; the new wording is verified through the built page during Preview inspection rather than a source-text change detector.

- [ ] **Step 2: Run the chart helper test and verify RED**

Run: `node --test tests/benchmark-drawdown-chart.test.js`

Expected: FAIL because `getMarketChartScrollLeft` does not exist.

- [ ] **Step 3: Implement variable-width SVG and scroll behavior**

In `MarketLevelCard`:

- add `const chartScrollRef = useRef(null)` and import/use the existing React hook;
- after chart creation, run an effect keyed by `chart.width` that sets `element.scrollLeft = getMarketChartScrollLeft(element.scrollWidth)`;
- attach the ref to `.marketLevelChartWrap`;
- set SVG `width={chart.width}` and `height={chart.height}` while retaining `viewBox`;
- replace every hard-coded background/threshold right edge (`760`, `718`, `752`) with `chart.width`, `chart.plot.right`, or `chart.width - 8`;
- render date and weekday text only when `point.showDateLabel` is true;
- update the aria-label to the approved latest-high copy.

In `app/globals.css`, set `.marketLevelChartWrap { overflow-x: auto; overflow-y: hidden; }`, give `.marketLevelChart` a block layout with `max-width: none`, and retain touch-friendly point sizes and responsive card containment.

In `src/lib/benchmark-drawdown-chart.js`, export the minimal pure helper:

```js
export function getMarketChartScrollLeft(scrollWidth) {
  const width = Number(scrollWidth);
  return Number.isFinite(width) && width > 0 ? width : 0;
}
```

- [ ] **Step 4: Run focused tests, lint, and build**

Run:

```bash
node --test tests/benchmark-drawdown-ui.test.js tests/benchmark-drawdown-chart.test.js tests/benchmark-drawdown.test.js
npm test
npm run lint
npm run build
```

Expected: all tests pass, ESLint exits 0, and Next.js production build exits 0.

- [ ] **Step 5: Commit the UI behavior**

```bash
git add tests/benchmark-drawdown-ui.test.js tests/benchmark-drawdown-chart.test.js src/lib/benchmark-drawdown-chart.js app/page.js app/globals.css
git commit -m "feat: scroll market chart from latest high"
```

---

### Task 4: Preview verification and handoff

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: verified feature branch commits from Tasks 1-3.
- Produces: a pushed `codex/market-level-7d-chart` branch and one Vercel Preview URL; `main` and Production remain unchanged.

- [ ] **Step 1: Verify branch boundaries and clean changes**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
```

Expected: only intentional feature/spec/plan commits differ from `main`, with no whitespace errors or uncommitted tracked files.

- [ ] **Step 2: Push only the feature branch**

Run: `git push origin codex/market-level-7d-chart`

Expected: remote feature branch advances; `origin/main` remains `79de9fe`.

- [ ] **Step 3: Create an explicit Preview deployment**

Run: `vercel deploy --yes`

Expected: Vercel returns a unique deployment whose target is `preview`, never `production`.

- [ ] **Step 4: Inspect and manually verify the Preview**

Run: `vercel inspect <preview-url>` and open the unique Preview URL.

Verify desktop and mobile widths: first point is the latest historical closing high, every trading date is present, the view starts at the newest point, horizontal scrolling reaches the high date, and point tooltips show the literal price and drawdown.

- [ ] **Step 5: Confirm no main or Production mutation**

Run:

```bash
git ls-remote --heads origin main codex/market-level-7d-chart
vercel inspect jj-invest-public-tingyonglin-droids-projects.vercel.app
```

Expected: `main` remains `79de9fe`; the production alias still resolves to the pre-existing production deployment.
