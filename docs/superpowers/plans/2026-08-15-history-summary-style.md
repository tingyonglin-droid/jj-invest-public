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

- [ ] **Step 6: Commit and redeploy Preview**

```bash
git add tests/history-ui.test.js app/globals.css docs/superpowers/plans/2026-08-15-history-summary-style.md
git commit -m "style: align history section titles"
pnpm dlx vercel deploy --yes
```

Inspect the returned URL and verify target `preview`, status `Ready`, and an HTTP 200 response before reporting it.
