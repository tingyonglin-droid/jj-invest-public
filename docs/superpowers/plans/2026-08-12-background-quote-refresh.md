# Background Quote Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all visible quote-refresh controls while keeping successful prices through transient failures and automatically retrying failed background refreshes after 2, 5, and 15 seconds.

**Architecture:** Add pure quote-result reconciliation and retry-policy helpers to `src/lib/auto-refresh.js`, then keep scheduling and React state ownership in `app/page.js`. Every refresh merges fresh successes with the prior successful quote and FX data; unresolved failures drive one cancellable retry sequence while the existing 60-second, focus, and visibility triggers remain and an online trigger is added.

**Tech Stack:** Next.js 16 App Router, React 19 hooks, JavaScript ES modules, Node.js test runner, React test renderer, ESLint.

## Global Constraints

- Remove the page-header update time, update button, and refresh icon together; retain no manual quote-refresh entry point.
- Trigger quote refresh on initial load, focus, visible transition, browser online event, and every 60 seconds.
- Retry transient failures after exactly 2,000 ms, 5,000 ms, and 15,000 ms without overlapping requests.
- Preserve prior successful quote and USD/TWD values when the new response fails; never invent a price for an item that has never succeeded.
- Do not change portfolio, Beta, rebalance, or history-snapshot formulas.
- Do not add a market-data provider, database, dependency, or streaming-price claim.

---

### Task 1: Quote Reconciliation and Retry Policy

**Files:**
- Modify: `src/lib/auto-refresh.js`
- Modify: `tests/auto-refresh.test.js`

**Interfaces:**
- Consumes: quote API results shaped as `{ quotes: Quote[], fx: FxQuote }`, where `Quote.normalizedTicker`, `Quote.priceTwd`, and `Quote.error` identify success, and `FxQuote.usdTwd` and `FxQuote.error` identify FX success.
- Produces: `QUOTE_RETRY_DELAYS_MS: readonly number[]`, `mergeQuoteResults(previous, incoming): { result, hasFailures, usedStaleData }`, and the existing `shouldAutoRefreshQuotes({ tickers, visibilityState, status }): boolean`.

- [ ] **Step 1: Write failing retry-delay and successful-merge tests**

Add imports and tests asserting the public contract:

```js
import {
  QUOTE_RETRY_DELAYS_MS,
  mergeQuoteResults,
  shouldAutoRefreshQuotes,
} from "../src/lib/auto-refresh.js";

it("uses short bounded retry delays", () => {
  assert.deepEqual(QUOTE_RETRY_DELAYS_MS, [2_000, 5_000, 15_000]);
});

it("replaces prior quote and FX values when the refresh succeeds", () => {
  const merged = mergeQuoteResults(
    {
      quotes: [{ inputTicker: "00685L", normalizedTicker: "00685L.TW", priceTwd: 10, error: null }],
      fx: { usdTwd: 30, error: null },
    },
    {
      quotes: [{ inputTicker: "00685L", normalizedTicker: "00685L.TW", priceTwd: 11, error: null }],
      fx: { usdTwd: 31, error: null },
    },
  );

  assert.equal(merged.result.quotes[0].priceTwd, 11);
  assert.equal(merged.result.fx.usdTwd, 31);
  assert.equal(merged.hasFailures, false);
  assert.equal(merged.usedStaleData, false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/auto-refresh.test.js`

Expected: FAIL because `QUOTE_RETRY_DELAYS_MS` and `mergeQuoteResults` are not exported.

- [ ] **Step 3: Implement the minimal constants and successful merge**

In `src/lib/auto-refresh.js`, export the fixed retry delays and a pure merge function. Treat a quote as successful only when it has no `error` and a finite positive `priceTwd`; treat FX as successful only when it has no `error` and a finite positive `usdTwd`.

```js
export const QUOTE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

function hasUsableQuote(quote) {
  return !quote?.error && Number.isFinite(quote?.priceTwd) && quote.priceTwd > 0;
}

function hasUsableFx(fx) {
  return !fx?.error && Number.isFinite(fx?.usdTwd) && fx.usdTwd > 0;
}
```

Return incoming successful data unchanged with `{ hasFailures: false, usedStaleData: false }`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/auto-refresh.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Write failing stale-quote, first-failure, and stale-FX tests**

Add separate tests proving:

```js
it("keeps the prior successful quote when one refreshed ticker fails", () => {
  const merged = mergeQuoteResults(previousResult, {
    quotes: [{ inputTicker: "00685L", normalizedTicker: "00685L.TW", priceTwd: null, error: "Yahoo Finance 回應 404" }],
    fx: { usdTwd: 31, error: null },
  });
  assert.equal(merged.result.quotes[0].priceTwd, 10);
  assert.equal(merged.result.quotes[0].error, null);
  assert.equal(merged.hasFailures, true);
  assert.equal(merged.usedStaleData, true);
});

it("keeps an error when the ticker has never produced a usable price", () => {
  const merged = mergeQuoteResults({ quotes: [], fx: { usdTwd: null, error: null } }, failedResult);
  assert.match(merged.result.quotes[0].error, /404/);
  assert.equal(merged.hasFailures, true);
  assert.equal(merged.usedStaleData, false);
});

it("keeps the prior successful FX value when refreshed FX fails", () => {
  const merged = mergeQuoteResults(previousResult, incomingWithFailedFx);
  assert.equal(merged.result.fx.usdTwd, 30);
  assert.equal(merged.result.fx.error, null);
  assert.equal(merged.hasFailures, true);
  assert.equal(merged.usedStaleData, true);
});
```

Define the literal `previousResult`, `failedResult`, and `incomingWithFailedFx` fixtures inside their tests so each case is readable independently.

- [ ] **Step 6: Run the tests and verify RED**

Run: `node --test tests/auto-refresh.test.js`

Expected: FAIL because failed incoming values still replace prior successes.

- [ ] **Step 7: Implement per-ticker and FX fallback**

Build a map of prior usable quotes keyed by `normalizedTicker`. Map the incoming quote list in its original order: retain incoming successes; for failures, use the prior success when found and otherwise retain the incoming error. Preserve prior FX only when incoming FX fails. Set `hasFailures` for every incoming quote or FX failure, and set `usedStaleData` only when a prior value was actually substituted.

- [ ] **Step 8: Run focused and market-calculation tests**

Run: `node --test tests/auto-refresh.test.js tests/portfolio.test.js tests/cash.test.js`

Expected: all tests PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/lib/auto-refresh.js tests/auto-refresh.test.js
git commit -m "feat: preserve quotes across refresh failures"
```

### Task 2: Background Retry Scheduling and Recovery Events

**Files:**
- Modify: `app/page.js`
- Create: `tests/background-quote-refresh-ui.test.js`

**Interfaces:**
- Consumes: `QUOTE_RETRY_DELAYS_MS`, `mergeQuoteResults(previous, incoming)`, and `shouldAutoRefreshQuotes(...)` from Task 1.
- Produces: Home-page behavior that reconciles each response, owns one retry timer/index via refs, retries unresolved failures, and refreshes on the browser `online` event.

- [ ] **Step 1: Write a failing source-level integration test for required wiring**

Create `tests/background-quote-refresh-ui.test.js` using `readFile` from `node:fs/promises` and assert that `app/page.js` imports `QUOTE_RETRY_DELAYS_MS` and `mergeQuoteResults`, registers and removes an `online` listener, and schedules retry delays from the imported array:

```js
test("wires quote merging, bounded retries, and online recovery", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  assert.match(page, /QUOTE_RETRY_DELAYS_MS/);
  assert.match(page, /mergeQuoteResults/);
  assert.match(page, /addEventListener\("online"/);
  assert.match(page, /removeEventListener\("online"/);
  assert.match(page, /QUOTE_RETRY_DELAYS_MS\[retryIndex/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/background-quote-refresh-ui.test.js`

Expected: FAIL because the page does not yet import merge/retry helpers or listen for `online`.

- [ ] **Step 3: Add refs and merge successful API responses**

Import `useRef`, `QUOTE_RETRY_DELAYS_MS`, and `mergeQuoteResults`. Add refs for current quote data, the active retry timeout, retry index, and request-in-flight state. Keep the quote-data ref synchronized whenever the displayed result changes.

Inside `refreshQuotes`, reject an overlapping call using the in-flight ref. After parsing a successful HTTP response, call:

```js
const merged = mergeQuoteResults(quoteResultRef.current, payload);
quoteResultRef.current = merged.result;
setQuoteResult(merged.result);
```

Only set `lastUpdatedAt` and clear warnings when `merged.hasFailures` is false. Do not replace a prior successful result in the request-level `catch` path.

- [ ] **Step 4: Add the single bounded retry sequence**

Define a callback that clears an existing retry timer before scheduling. When a refresh reports failures, schedule the current delay from `QUOTE_RETRY_DELAYS_MS`; on timeout increment the index and call `refreshQuotes({ isRetry: true })`. Reset the index and cancel the timer after a complete success. After the third failed retry, stop scheduling and set the exact warning:

```text
部分價格暫時無法更新，將自動重試。
```

Use an unmount cleanup effect to cancel the active timeout. Keep request-level first-load errors explicit when no prior usable quote/FX data exists.

- [ ] **Step 5: Add online recovery and retry reset to normal triggers**

In the existing interval/focus/visibility effect, make the shared normal refresh callback clear the exhausted retry state before refreshing. Register `window.addEventListener("online", refreshIfVisible)` and remove it in cleanup. Continue relying on `shouldAutoRefreshQuotes` so hidden pages and active requests do not overlap.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run: `node --test tests/background-quote-refresh-ui.test.js tests/auto-refresh.test.js tests/history-ui.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Run lint for hook dependency and cleanup errors**

Run: `pnpm lint`

Expected: exit 0 with no React hooks warnings or ESLint errors.

- [ ] **Step 8: Commit Task 2**

```bash
git add app/page.js tests/background-quote-refresh-ui.test.js
git commit -m "feat: retry quote refreshes in background"
```

### Task 3: Remove All Visible Refresh Information

**Files:**
- Modify: `app/page.js`
- Modify: `app/globals.css`
- Modify: `tests/background-quote-refresh-ui.test.js`

**Interfaces:**
- Consumes: background refresh behavior from Task 2.
- Produces: `AppHeader()` with brand-only markup and no refresh props, control, status text, icon, or related CSS selectors.

- [ ] **Step 1: Write failing header-removal assertions**

Extend `tests/background-quote-refresh-ui.test.js`:

```js
test("renders no visible or accessible quote refresh control", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.doesNotMatch(page, /headerStatusPill/);
  assert.doesNotMatch(page, /aria-label="更新價格"/);
  assert.doesNotMatch(page, /自動更新/);
  assert.doesNotMatch(page, /<AppHeader[\s\S]*?onRefresh=/);
  assert.doesNotMatch(css, /\.headerStatusPill/);
  assert.doesNotMatch(css, /\.headerActions/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/background-quote-refresh-ui.test.js`

Expected: FAIL on the current header button, text, props, and CSS.

- [ ] **Step 3: Simplify the header and delete dead CSS**

Render `<AppHeader />` with no props. Change `AppHeader` to return only the existing `.brandLockup` inside `.appHeader`. Delete `.headerActions`, `.headerStatusPill`, child, disabled, and responsive rules. Keep `.appHeader` and `.brandLockup` layout rules intact.

Remove `formatLastUpdatedAt` only if it has no remaining call sites; retain internal `lastUpdatedAt` state because history snapshots and benchmark loading consume it.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/background-quote-refresh-ui.test.js tests/morandi-ui.test.js tests/history-ui.test.js`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add app/page.js app/globals.css tests/background-quote-refresh-ui.test.js
git commit -m "refactor: hide background quote refresh UI"
```

### Task 4: Full Verification and Cleanup

**Files:**
- Modify only files already listed if verification exposes a scoped defect.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: verified application behavior with no regression in market data, portfolio math, history, PWA, or responsive styling.

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: all Node test suites PASS with zero failures.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: exit 0 with no warnings promoted to errors.

- [ ] **Step 3: Run the production build**

Run: `pnpm build`

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check HEAD~3..HEAD && git status --short`

Expected: no whitespace errors; only the intended plan, quote policy, page, CSS, and tests are changed. Existing unrelated untracked directories remain untouched.

- [ ] **Step 5: Commit any verification-only correction**

Only if Steps 1–4 required a scoped correction:

```bash
git add src/lib/auto-refresh.js app/page.js app/globals.css tests/auto-refresh.test.js tests/background-quote-refresh-ui.test.js
git commit -m "fix: complete background quote refresh verification"
```
