# History Summary Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four history summary metrics visually match the rebalance summary metrics without changing layout or behavior.

**Architecture:** Keep the existing `HistoryView` and `HistoryMetric` markup unchanged. Add a focused stylesheet contract test, then update only the history metric CSS declarations to mirror the approved rebalance metric values.

**Tech Stack:** Next.js, React, CSS, Node.js test runner

## Global Constraints

- Only change the four summary metrics in the history page's `歷史紀錄` card.
- Preserve the outer card structure, subtitle, date pill, chart, records, data, storage, and interactions.
- Set only the `歷史紀錄` and `最近紀錄` section titles to 18px, matching `再平衡參數設定`.
- Preserve the global `.cardHeaderRow h2` 16px rule for all other cards.
- Preserve the desktop four-column and mobile two-column layouts.
- Do not modify the rebalance page styles or extract shared components.
- Deploy a Vercel Preview only; do not deploy to production.

---

### Task 1: Align history summary metric styling

**Files:**
- Modify: `tests/history-ui.test.js`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: existing `.historyMetric`, `.historyMetric span`, and `.historyMetric strong` selectors.
- Produces: history summary metrics with the same surface and typography values as rebalance summary metrics.

- [x] **Step 1: Write the failing UI stylesheet test**

Add a test that reads `app/globals.css` and asserts the history metric block includes these literal approved values:

```js
it("matches rebalance summary metric surface and typography", () => {
  assert.match(styles, /\.historyMetric\s*\{[^}]*min-height:\s*84px;[^}]*padding:\s*12px;[^}]*border:\s*1px solid rgba\(17, 24, 33, 0\.07\);[^}]*border-radius:\s*16px;[^}]*background:\s*#ffffff;/s);
  assert.match(styles, /\.historyMetric span\s*\{[^}]*font-size:\s*11px;[^}]*font-weight:\s*720;[^}]*line-height:\s*1\.4;/s);
  assert.match(styles, /\.historyMetric strong\s*\{[^}]*font-size:\s*16px;[^}]*font-weight:\s*840;[^}]*line-height:\s*1\.3;/s);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/history-ui.test.js`

Expected: FAIL in `matches rebalance summary metric surface and typography` because the current history metric uses a filled soft background, 18px radius, 14px padding, and larger typography.

- [x] **Step 3: Apply the minimal stylesheet change**

Update the three existing history selectors to:

```css
.historyMetric {
  display: grid;
  align-content: start;
  gap: 4px;
  min-width: 0;
  min-height: 84px;
  padding: 12px;
  border: 1px solid rgba(17, 24, 33, 0.07);
  border-radius: 16px;
  background: #ffffff;
}

.historyMetric span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 720;
  line-height: 1.4;
}

.historyMetric strong {
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 16px;
  font-weight: 840;
  line-height: 1.3;
}
```

- [x] **Step 4: Run focused and related tests and verify GREEN**

Run: `node --test tests/history-ui.test.js tests/morandi-ui.test.js tests/operation-ui.test.js`

Expected: all tests PASS.

- [x] **Step 5: Run full verification**

Run: `pnpm test`

Run: `pnpm build`

Expected: both commands exit 0 with no failures.

- [ ] **Step 6: Commit the implementation**

```bash
git add tests/history-ui.test.js app/globals.css docs/superpowers/plans/2026-08-15-history-summary-style.md
git commit -m "style: align history summary metrics"
```

### Task 2: Deploy and inspect Vercel Preview

**Files:**
- No source files changed.

**Interfaces:**
- Consumes: verified feature-branch working tree and existing Vercel project link.
- Produces: a READY Vercel Preview URL for user review.

- [ ] **Step 1: Create a Preview deployment**

Run: `pnpm dlx vercel deploy --yes`

Expected: command returns a unique preview deployment URL and does not use `--prod`.

- [ ] **Step 2: Inspect deployment readiness**

Run: `pnpm dlx vercel inspect <preview-url> --wait --timeout 2m`

Expected: deployment status is READY.

- [ ] **Step 3: Report preview result**

Report the URL, preview target, READY status, short commit SHA, detected framework, and available build duration from inspection output.

### Task 3: Align history section title size

**Files:**
- Modify: `tests/history-ui.test.js`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: existing `.historySummaryCard`, `.historyRecordsCard`, and `.cardHeaderRow h2` selectors.
- Produces: 18px headings only inside the history summary and records cards while preserving the global 16px card heading rule.

- [x] **Step 1: Write the failing title-size test**

Add this test to the existing history UI suite:

```js
it("matches rebalance heading size for history section titles only", () => {
  assert.match(styles, /\.historySummaryCard \.cardHeaderRow h2,\s*\.historyRecordsCard \.cardHeaderRow h2\s*\{[^}]*font-size:\s*18px;/s);
  assert.match(styles, /\.cardHeaderRow h2\s*\{[^}]*font-size:\s*16px;/s);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/history-ui.test.js`

Expected: FAIL only in `matches rebalance heading size for history section titles only` because no history-specific 18px heading rule exists.

- [x] **Step 3: Add the minimal scoped CSS rule**

Add immediately after the global `.cardHeaderRow h2` rule:

```css
.historySummaryCard .cardHeaderRow h2,
.historyRecordsCard .cardHeaderRow h2 {
  font-size: 18px;
}
```

- [x] **Step 4: Run focused and related tests and verify GREEN**

Run: `node --test tests/history-ui.test.js tests/operation-ui.test.js`

Expected: all tests PASS.

- [x] **Step 5: Run full verification**

Run: `pnpm test`

Run: `pnpm build`

Expected: both commands exit 0 with no failures.

- [x] **Step 6: Commit and redeploy Preview**

```bash
git add tests/history-ui.test.js app/globals.css docs/superpowers/plans/2026-08-15-history-summary-style.md
git commit -m "style: align history section titles"
pnpm dlx vercel deploy --yes
```

Inspect the returned URL and verify target `preview`, status `Ready`, and an HTTP 200 response before reporting it.

### Task 4: Match history title-row height to rebalance

**Files:**
- Modify: `tests/history-ui.test.js`
- Modify: `app/globals.css:207-215`

**Interfaces:**
- Consumes: the existing `.historyTitleRow` markup and `.cardTitleRow` flex alignment.
- Produces: a 32px minimum history title-row height matching the rebalance title row created by its 40px information control and vertical negative margins.

- [x] **Step 1: Write the failing title-row height test**

Extend `uses the rebalance title structure and exact heading rhythm` with:

```js
assert.match(styles, /\.historyTitleRow\s*\{[^}]*min-height:\s*32px;[^}]*align-items:\s*center;/s);
```

Production mutation caught: removing or changing the 32px title-row height, or failing to center the title within it.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/history-ui.test.js`

Expected: FAIL only in `uses the rebalance title structure and exact heading rhythm` because `.historyTitleRow` has no dedicated height rule.

- [x] **Step 3: Add the minimal scoped CSS rule**

Add after `.operationTitleRow`:

```css
.historyTitleRow {
  min-height: 32px;
  align-items: center;
}
```

- [x] **Step 4: Run focused and related tests and verify GREEN**

Run: `node --test tests/history-ui.test.js tests/operation-ui.test.js`

Expected: all tests PASS.

- [x] **Step 5: Run full verification**

Run: `pnpm test`

Run: `pnpm build`

Expected: both commands exit 0 with no failures.

- [x] **Step 6: Commit and redeploy Preview**

```bash
git add tests/history-ui.test.js app/globals.css docs/superpowers/plans/2026-08-15-history-summary-style.md
git commit -m "style: align history title row spacing"
pnpm dlx vercel deploy --yes
```

Inspect the returned URL and verify target `preview`, status `Ready`, and an HTTP 200 response before reporting it.

### Completed prerequisite: Exactly align history and settings headings with rebalance

**Files:**
- Modify: `tests/history-ui.test.js`
- Modify: `tests/position-settings-ui.test.js`
- Modify: `app/page.js:1927-1987`
- Modify: `app/globals.css:1082-1092, 2161-2182, 3504-3512`

**Interfaces:**
- Consumes: `.cardTitleRow`, `.cardHeaderRow h2`, `.cardHeaderRow p`, `.settingsIntro p`, and `.settingsIntro span`.
- Produces: history and settings headings with the rebalance title's 18px/760 typography and a 3px subtitle gap, without changing data or interactions.

- [x] **Step 1: Write failing history heading alignment tests**

Replace the existing history heading assertion with:

```js
it("uses the rebalance title structure and exact heading rhythm", () => {
  assert.match(pageSource, /className="cardTitleRow historyTitleRow">\s*<h2>歷史紀錄<\/h2>/s);
  assert.match(pageSource, /className="cardTitleRow historyTitleRow">\s*<h2>最近紀錄<\/h2>/s);
  assert.match(styles, /\.historySummaryCard \.cardTitleRow h2,\s*\.historyRecordsCard \.cardTitleRow h2\s*\{[^}]*font-size:\s*18px;[^}]*font-weight:\s*760;/s);
  assert.match(styles, /\.appCard\s*\{[^}]*padding:\s*18px 20px;/s);
  assert.match(styles, /\.cardHeaderRow p\s*\{[^}]*margin:\s*3px 0 0;/s);
});
```

Production mutations caught: removing either shared title row, reverting either heading to 20px/800, changing desktop card top padding, or changing the shared subtitle gap.

- [x] **Step 2: Write failing settings heading alignment tests**

Add to `tests/position-settings-ui.test.js`:

```js
test("settings intro matches rebalance heading typography and subtitle gap", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(styles, /\.settingsIntro p\s*\{[^}]*font-size:\s*18px;[^}]*font-weight:\s*760;/s);
  assert.match(styles, /\.settingsIntro span\s*\{[^}]*margin-top:\s*3px;/s);
  assert.doesNotMatch(styles, /@media \(max-width:\s*480px\)[\s\S]*?\.settingsIntro p\s*\{/s);
});
```

Production mutations caught: restoring 20px/820, restoring the 4px subtitle gap, or adding a mobile-only title override.

- [x] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/history-ui.test.js tests/position-settings-ui.test.js`

Expected: FAIL because history lacks `historyTitleRow`, history is 20px/800, settings is 20px/820 with a 4px gap, and the mobile override still exists.

- [x] **Step 4: Apply the minimal history markup and CSS changes**

Wrap each history heading in the same title-row structure used by rebalance:

```jsx
<div className="cardTitleRow historyTitleRow">
  <h2>歷史紀錄</h2>
</div>
```

and:

```jsx
<div className="cardTitleRow historyTitleRow">
  <h2>最近紀錄</h2>
</div>
```

Replace the current history heading override with:

```css
.historySummaryCard .cardTitleRow h2,
.historyRecordsCard .cardTitleRow h2 {
  font-size: 18px;
  font-weight: 760;
}
```

- [x] **Step 5: Apply the minimal settings CSS changes**

Update the existing rules to:

```css
.settingsIntro p {
  margin: 0;
  color: var(--text);
  font-size: 18px;
  font-weight: 760;
}

.settingsIntro span {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 680;
  line-height: 1.45;
}
```

Delete the `.settingsIntro p { font-size: 18px; }` override from the 480px media query.

- [x] **Step 6: Run focused and related tests and verify GREEN**

Run: `node --test tests/history-ui.test.js tests/position-settings-ui.test.js tests/operation-ui.test.js`

Expected: all tests PASS.

- [x] **Step 7: Run full verification**

Run: `pnpm test`

Run: `pnpm build`

Expected: both commands exit 0 with no failures.

- [x] **Step 8: Commit and redeploy Preview**

```bash
git add tests/history-ui.test.js tests/position-settings-ui.test.js app/page.js app/globals.css docs/superpowers/plans/2026-08-15-history-summary-style.md
git commit -m "style: align section heading rhythm"
pnpm dlx vercel deploy --yes
```

Inspect the returned URL and verify target `preview`, status `Ready`, and an HTTP 200 response before reporting it.

### Superseded task: Add visual compensation to short history headings

This completed experiment is retained for history but is superseded by Task 4 above after visual review showed that 20px/800 overcompensated.

**Files:**
- Modify: `tests/history-ui.test.js`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: the existing scoped history heading selector.
- Produces: 20px, weight-800 history section headings without changing the rebalance or global card headings.

- [x] **Step 1: Update the test expectation first**

Change the scoped history heading assertion to require both approved values:

```js
assert.match(styles, /\.historySummaryCard \.cardHeaderRow h2,\s*\.historyRecordsCard \.cardHeaderRow h2\s*\{[^}]*font-size:\s*20px;[^}]*font-weight:\s*800;/s);
```

Keep the existing assertion that `.cardHeaderRow h2` remains 16px.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/history-ui.test.js`

Expected: FAIL in the history heading visual-weight test because production CSS is still 18px with inherited weight 760.

- [x] **Step 3: Apply the minimal CSS change**

Update only the scoped rule:

```css
.historySummaryCard .cardHeaderRow h2,
.historyRecordsCard .cardHeaderRow h2 {
  font-size: 20px;
  font-weight: 800;
}
```

- [x] **Step 4: Run focused and related tests and verify GREEN**

Run: `node --test tests/history-ui.test.js tests/operation-ui.test.js`

Expected: all tests PASS.

- [x] **Step 5: Run full verification**

Run: `pnpm test`

Run: `pnpm build`

Expected: both commands exit 0 with no failures.

- [ ] **Step 6: Commit and redeploy Preview**

```bash
git add tests/history-ui.test.js app/globals.css docs/superpowers/plans/2026-08-15-history-summary-style.md
git commit -m "style: strengthen history section headings"
pnpm dlx vercel deploy --yes
```

Inspect the returned URL and verify target `preview`, status `Ready`, and an HTTP 200 response before reporting it.

### Task 5: Match settings title-row height to rebalance

**Files:**
- Modify: `tests/position-settings-ui.test.js`
- Modify: `app/page.js:2712-2718`
- Modify: `app/globals.css:2161-2182`

**Interfaces:**
- Consumes: `.cardTitleRow`, `.settingsIntro`, and the existing 18px/760 settings title typography.
- Produces: `.settingsTitleRow` with a 32px minimum height and centered title, without changing the settings frame, subtitle, or tabs.

- [x] **Step 1: Write the failing settings title-row test**

Extend `settings intro matches rebalance heading typography and subtitle gap` with:

```js
const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

assert.match(page, /className="cardTitleRow settingsTitleRow">\s*<p>參數設定<\/p>/s);
assert.match(styles, /\.settingsTitleRow\s*\{[^}]*min-height:\s*32px;[^}]*align-items:\s*center;/s);
```

Production mutations caught: removing the shared settings title-row structure, changing its 32px height, or failing to center the title.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/position-settings-ui.test.js`

Expected: FAIL only in the settings intro alignment test because the shared wrapper and `.settingsTitleRow` rule do not exist.

- [x] **Step 3: Add the shared wrapper and scoped CSS**

Replace the standalone settings title with:

```jsx
<div className="cardTitleRow settingsTitleRow">
  <p>參數設定</p>
</div>
```

Add near `.settingsIntro`:

```css
.settingsTitleRow {
  min-height: 32px;
  align-items: center;
}
```

- [x] **Step 4: Run focused and related tests and verify GREEN**

Run: `node --test tests/position-settings-ui.test.js tests/history-ui.test.js tests/operation-ui.test.js`

Expected: all tests PASS.

- [x] **Step 5: Run full verification**

Run: `pnpm test`

Run: `pnpm build`

Expected: both commands exit 0 with no failures.

- [x] **Step 6: Commit and redeploy Preview**

```bash
git add tests/position-settings-ui.test.js app/page.js app/globals.css docs/superpowers/plans/2026-08-15-history-summary-style.md
git commit -m "style: align settings title row spacing"
pnpm dlx vercel deploy --yes
```

Inspect the returned URL and verify target `preview`, status `Ready`, and an HTTP 200 response before reporting it.
