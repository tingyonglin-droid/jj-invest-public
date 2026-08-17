# History Card Spacing and Chart Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the history page's three-card spacing to the overview page and add the title「績效與 Beta 走勢」above the chart controls.

**Architecture:** Keep the existing `HistoryView` structure and centralize vertical spacing in `.historyStack`. Add a semantic title row inside the chart card, then preserve the existing Zoom controls, date range, stacked charts, and interactions beneath it.

**Tech Stack:** Next.js 16, React, CSS, Node.js test runner

## Global Constraints

- History card spacing must be exactly 12px, matching the overview page.
- The chart title copy must be exactly「績效與 Beta 走勢」.
- The title must be left aligned and reuse the history page heading typography.
- Zoom controls and the date range must remain beneath the new title.
- Do not change chart dimensions, colors, legends, time-axis behavior, range-filter logic, or interactions.
- Desktop and mobile layouts must not overflow or overlap.

---

### Task 1: Lock the spacing and title layout with tests

**Files:**
- Modify: `tests/history-ui.test.js`

**Interfaces:**
- Consumes: `app/page.js` JSX source and `app/globals.css` source already loaded by the test file.
- Produces: regression assertions for the chart title markup and 12px `.historyStack` gap.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/history-ui.test.js`:

```js
it("matches overview card spacing and labels the combined history chart", () => {
  assert.match(
    pageSource,
    /className="appCard historyChartCard">\s*<div className="cardTitleRow historyTitleRow">\s*<h2>績效與 Beta 走勢<\/h2>/s,
  );
  assert.match(
    pageSource,
    /<h2>績效與 Beta 走勢<\/h2>[\s\S]*className="historyZoomRow"/,
  );
  assert.match(styles, /\.historyStack\s*\{[^}]*gap:\s*12px;/s);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/history-ui.test.js
```

Expected: FAIL because the chart title is absent and `.historyStack` still uses `gap: 18px`.

- [ ] **Step 3: Commit the red test**

```bash
git add tests/history-ui.test.js
git commit -m "test: define history chart heading layout"
```

---

### Task 2: Add the chart heading and align card spacing

**Files:**
- Modify: `app/page.js:1942-1959`
- Modify: `app/globals.css:1213-1223`
- Test: `tests/history-ui.test.js`

**Interfaces:**
- Consumes: existing `.cardTitleRow`, `.historyTitleRow`, `.historyZoomRow`, and `.historyStack` styles.
- Produces: a semantic `<h2>` chart heading and a 12px card stack gap.

- [ ] **Step 1: Add the chart title before the Zoom row**

Change the start of the chart card in `app/page.js` to:

```jsx
<section className="appCard historyChartCard">
  <div className="cardTitleRow historyTitleRow">
    <h2>績效與 Beta 走勢</h2>
  </div>
  <div className="historyZoomRow">
```

Keep the existing Zoom buttons, date range, and `<HistoryStackedChart model={chartModel} />` unchanged after this insertion.

- [ ] **Step 2: Match the overview card spacing**

Update `.historyStack` in `app/globals.css`:

```css
.historyStack {
  display: grid;
  gap: 12px;
}
```

The existing `.historySummaryCard`, `.historyChartCard`, `.historyRecordsCard`, and `.historyEmptyCard` `margin-bottom: 0` rule remains unchanged.

- [ ] **Step 3: Run the focused history tests**

Run:

```bash
node --test tests/history-ui.test.js tests/history.test.js
```

Expected: PASS.

- [ ] **Step 4: Run formatting validation**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 5: Commit the implementation**

```bash
git add app/page.js app/globals.css
git commit -m "style: align history card spacing and chart title"
```

---

### Task 3: Verify the full experience and update Preview

**Files:**
- Verify only: `app/page.js`, `app/globals.css`, `tests/history-ui.test.js`

**Interfaces:**
- Consumes: the completed history layout from Task 2.
- Produces: test, build, responsive visual, and deployed Preview evidence.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Build the production app**

Run:

```bash
pnpm build
```

Expected: Next.js production build succeeds.

- [ ] **Step 3: Verify desktop and mobile layouts in the browser**

Start the local app, open the history page, and verify at desktop width and approximately 390px CSS width:

- all three card-to-card gaps measure 12px;
-「績效與 Beta 走勢」is the first element in the chart card;
- the heading matches「歷史紀錄」and「最近紀錄」typography;
- Zoom and the date range remain below the heading;
- no horizontal overflow, clipping, or overlap occurs;
- both chart panels and their shared interactions remain visible.

- [ ] **Step 4: Deploy a Vercel Preview**

Run:

```bash
pnpm dlx vercel deploy --yes
```

Expected: deployment reaches `READY` and returns a Preview URL.

- [ ] **Step 5: Verify the Preview response**

Run:

```bash
PREVIEW_URL="the exact Preview URL returned by Step 4"
pnpm dlx vercel curl "$PREVIEW_URL" -- --head
```

Expected: HTTP 200.
