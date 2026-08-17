# History Update Date Caption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the green history date pill with a small gray `更新日期：YYYY-MM-DD` caption beneath the four summary metrics.

**Architecture:** Keep the latest-date value from `createHistorySummary` unchanged. Move only its rendering position in `HistoryView`, then replace the pill CSS with a focused caption class. Lock the markup order and visual rules with the existing source-based history UI tests.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, CSS, Node.js built-in test runner.

## Global Constraints

- The exact label is `更新日期：YYYY-MM-DD`.
- The caption renders after the four summary metric cards and aligns left.
- The caption has a 10px top margin.
- The caption uses the existing muted text color and a small font size.
- The caption has no background, border, border radius, or pill padding.
- Chart date ranges, recent-record dates, history calculations, and other pages remain unchanged.
- Do not add dependencies.

---

### Task 1: Move and Restyle the History Update Date

**Files:**
- Modify: `app/page.js`
- Modify: `app/globals.css`
- Test: `tests/history-ui.test.js`

**Interfaces:**
- Consumes: `summary.latestDate` from the existing `createHistorySummary(records)` result.
- Produces: `.historyUpdateDate` paragraph rendered immediately after `.historySummaryGrid` with `更新日期：${summary.latestDate}`.

- [ ] **Step 1: Write the failing markup and CSS tests**

Add this test to `tests/history-ui.test.js`:

```js
it("shows the latest history date as a muted caption below summary metrics", () => {
  assert.match(
    pageSource,
    /className="historySummaryGrid"[\s\S]*<p className="historyUpdateDate">更新日期：\{summary\.latestDate\}<\/p>/,
  );
  assert.doesNotMatch(pageSource, /historyDatePill/);
  assert.match(
    styles,
    /\.historyUpdateDate\s*\{[^}]*margin:\s*10px 0 0;[^}]*color:\s*var\(--muted\);[^}]*font-size:\s*11px;/s,
  );
  assert.doesNotMatch(styles, /\.historyDatePill/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/history-ui.test.js`

Expected: FAIL because `historyDatePill` still exists and `.historyUpdateDate` does not.

- [ ] **Step 3: Move the date below the summary grid**

Remove this element from `.cardHeaderRow`:

```jsx
<span className="historyDatePill">{summary.latestDate}</span>
```

Add this element immediately after the closing tag of `.historySummaryGrid`:

```jsx
<p className="historyUpdateDate">更新日期：{summary.latestDate}</p>
```

- [ ] **Step 4: Replace the pill style with caption styling**

Delete the complete `.historyDatePill` rule and add:

```css
.historyUpdateDate {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.4;
  text-align: left;
}
```

- [ ] **Step 5: Run focused tests and verify success**

Run: `node --test tests/history-ui.test.js tests/history.test.js`

Expected: PASS with the new caption test and all existing history behavior tests.

- [ ] **Step 6: Commit the UI change**

```bash
git add app/page.js app/globals.css tests/history-ui.test.js
git commit -m "style: simplify history update date"
```

---

### Task 2: Regression, Visual Verification, and Preview Deployment

**Files:**
- Modify only if a verified scoped defect requires it: `app/page.js`, `app/globals.css`, `tests/history-ui.test.js`

**Interfaces:**
- Consumes: the completed `.historyUpdateDate` caption from Task 1.
- Produces: a verified Vercel Preview deployment of the updated history summary card.

- [ ] **Step 1: Run full automated verification**

Run:

```bash
git diff --check
pnpm test
pnpm build
```

Expected: no whitespace errors, all tests pass, and the Next.js production build succeeds.

- [ ] **Step 2: Verify desktop and mobile rendering**

At desktop width and approximately 390px mobile width, verify the date is beneath all four metric cards, reads `更新日期：2026-08-17` for the sample data, aligns left, has no colored surface, and does not overlap or alter the chart card below.

- [ ] **Step 3: Fix any observed scoped defect with a red-green test cycle**

If visual verification exposes a defect, add one source/CSS assertion that fails for that defect, run it to confirm failure, apply the smallest markup or CSS correction, and rerun `node --test tests/history-ui.test.js tests/history.test.js`.

- [ ] **Step 4: Deploy and verify Vercel Preview**

Run `pnpm dlx vercel deploy --yes`, wait for `readyState: READY`, then run authenticated `vercel curl` against the returned Preview URL and require HTTP 200.

- [ ] **Step 5: Report the result**

Provide the Preview URL, the test/build result, and confirmation that the branch remains unmerged.
