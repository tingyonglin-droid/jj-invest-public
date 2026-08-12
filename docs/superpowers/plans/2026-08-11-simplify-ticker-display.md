# Simplified Ticker Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove rebalance-row ticker circles, hide Taiwan exchange suffixes from user-facing ticker text, and remove normalized-ticker hints from settings without changing internal ticker values.

**Architecture:** Add one pure presentation helper that converts normalized Taiwan symbols into display symbols. Use it at the rebalance row and operation-text boundaries, while leaving quote, storage, and calculation paths untouched; remove the two settings-only normalized-symbol hints and obsolete badge styles.

**Tech Stack:** Next.js 16, React 19, JavaScript ES modules, Node.js test runner, CSS.

## Global Constraints

- Internal normalized tickers retain `.TW` or `.TWO` for quotes, currency detection, storage, and calculations.
- Display `00631L.TW` as `00631L` and `00864B.TWO` as `00864B`.
- Non-Taiwan tickers such as `QLD` and `SGOV` remain unchanged.
- Remove the full normalized-ticker hint from both holding and cash-equivalent settings.
- Remove ticker circles only from leveraged, original, and cash-equivalent rebalance lists.

---

### Task 1: Centralize user-facing ticker formatting

**Files:**
- Modify: `src/lib/presentation.js`
- Test: `tests/presentation.test.js`

**Interfaces:**
- Consumes: a normalized ticker value accepted as any value coercible to a string.
- Produces: `getTickerDisplayText(normalizedTicker): string`, returning a trimmed uppercase ticker without a terminal `.TW` or `.TWO` suffix.

- [ ] **Step 1: Write failing display-format tests**

Add `getTickerDisplayText` to the import and add:

```js
it("formats normalized tickers for user-facing text", () => {
  assert.equal(getTickerDisplayText("00631L.TW"), "00631L");
  assert.equal(getTickerDisplayText("00864B.TWO"), "00864B");
  assert.equal(getTickerDisplayText(" qld "), "QLD");
  assert.equal(getTickerDisplayText(), "");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test tests/presentation.test.js`

Expected: FAIL because `getTickerDisplayText` is not exported.

- [ ] **Step 3: Implement minimal formatting and use it in operation text**

Add to `src/lib/presentation.js`:

```js
export function getTickerDisplayText(normalizedTicker) {
  return String(normalizedTicker || "")
    .trim()
    .toUpperCase()
    .replace(/\.(?:TW|TWO)$/, "");
}
```

Change `createOperationListText` to interpolate `getTickerDisplayText(item.normalizedTicker)`.

- [ ] **Step 4: Update the operation-text literal and verify GREEN**

Change the expected Taiwan row to:

```js
"00631L 賣出 NT$10,000，約 250 股"
```

Run: `pnpm test tests/presentation.test.js`

Expected: all presentation tests PASS.

- [ ] **Step 5: Commit the helper and behavior**

```bash
git add src/lib/presentation.js tests/presentation.test.js
git commit -m "feat: simplify displayed Taiwan tickers"
```

### Task 2: Simplify rebalance rows and settings UI

**Files:**
- Modify: `app/page.js`
- Modify: `app/globals.css`
- Test: `tests/operation-ui.test.js`
- Test: `tests/position-settings-ui.test.js`
- Test: `tests/cash-equivalents-ui.test.js`

**Interfaces:**
- Consumes: `getTickerDisplayText(normalizedTicker)` from Task 1.
- Produces: rebalance rows without `.tickerBadge`, user-facing visible and accessible display tickers, and settings without normalized-ticker hints.

- [ ] **Step 1: Write failing UI tests**

In `tests/operation-ui.test.js`, add a test that checks the rendered source path uses the helper and no ticker badge remains:

```js
test("rebalance rows show simple ticker text without circular badges", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /getTickerDisplayText\(item\.normalizedTicker\)/);
  assert.doesNotMatch(page, /className=\{`tickerBadge/);
  assert.doesNotMatch(styles, /\.tickerBadge/);
});
```

In `tests/position-settings-ui.test.js`, add:

```js
test("holding settings omit the normalized ticker hint", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  assert.doesNotMatch(page, /正規化代號：/);
});
```

The single assertion covers both settings locations because the phrase must be absent from the whole page. Add the same absence assertion to the existing cash-equivalent controls test so the cash settings contract names the requirement explicitly.

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `pnpm test tests/operation-ui.test.js tests/position-settings-ui.test.js tests/cash-equivalents-ui.test.js`

Expected: FAIL because the badge styles/markup and normalized-ticker hints remain, and the display helper is not used by `HoldingRow`.

- [ ] **Step 3: Apply minimal UI changes**

In `app/page.js`:

- replace the `getTickerBadgeText` import with `getTickerDisplayText`;
- compute `const displayTicker = getTickerDisplayText(item.normalizedTicker);` in `HoldingRow`;
- use `displayTicker` in the checkbox `aria-label` and `<strong>` text;
- delete the `.tickerBadge` element;
- delete both paragraphs beginning with `正規化代號：`.

In `app/globals.css`:

- change `.holdingAsset` from three columns to `minmax(0, 1fr) auto`;
- place `.holdingIdentity` in the first column and keep `.holdingSelect` in the second column;
- delete `.tickerBadge`, `.tickerBadge.sell`, and `.tickerBadge.none` rules.

- [ ] **Step 4: Run focused UI and presentation tests and verify GREEN**

Run: `pnpm test tests/presentation.test.js tests/operation-ui.test.js tests/position-settings-ui.test.js tests/cash-equivalents-ui.test.js`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the UI changes**

```bash
git add app/page.js app/globals.css tests/operation-ui.test.js tests/position-settings-ui.test.js tests/cash-equivalents-ui.test.js
git commit -m "feat: simplify rebalance ticker rows"
```

### Task 3: Full verification

**Files:**
- Verify only; no planned production edits.

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: fresh evidence that tests, lint, and production build succeed.

- [ ] **Step 1: Run the full automated test suite**

Run: `pnpm test`

Expected: exit code 0 with zero failed tests.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: exit code 0 with zero lint errors.

- [ ] **Step 3: Run the production build**

Run: `pnpm build`

Expected: exit code 0 and a successful Next.js production build.

- [ ] **Step 4: Inspect the final diff and branch state**

Run: `git diff main...HEAD --check && git status --short`

Expected: no whitespace errors; only unrelated pre-existing untracked paths may remain unstaged.
