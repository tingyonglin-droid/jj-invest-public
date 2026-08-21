# Dual-Currency Rebalance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Taiwan and U.S. securities settle against separate TWD and USD cash balances while retaining TWD as the portfolio valuation currency.

**Architecture:** Add a focused settlement helper that derives actual local-currency trade amounts from rounded share deltas. Refactor funding, summaries, and state application to operate on `{ TWD, USD }` cash ledgers, while portfolio allocation and Beta calculations continue using TWD-equivalent values. UI consumers display local currency first for U.S. holdings and expose both cash deltas.

**Tech Stack:** Next.js 16, React 19, JavaScript ES modules, Node.js test runner, CSS

**Spec:** `docs/superpowers/specs/2026-08-21-dual-currency-rebalance-design.md`

## Global Constraints

- Do not automatically exchange TWD and USD.
- The only supported settlement currencies are exactly `TWD` and `USD`.
- Quote `currency`, not ETF underlying exposure or ticker text, determines settlement currency.
- Portfolio allocation, Beta, history, and aggregate values remain TWD-denominated.
- TWD cash rounds to whole dollars; USD cash rounds to two decimal places.
- `.TW` and `.TWO` both use Taiwan trading-unit rules; U.S. securities always use whole shares.
- Same-currency sale proceeds may fund same-run buys; cross-currency proceeds may not.
- Preserve unrelated user files and changes in the worktree.

---

### Task 1: Settlement Currency and Applied Trade Amounts

**Files:**
- Create: `src/lib/settlement.js`
- Modify: `src/lib/rebalance-apply.js`
- Test: `tests/settlement.test.js`
- Test: `tests/rebalance-apply.test.js`

**Interfaces:**
- Produces: `normalizeSettlementCurrency(currency): "TWD" | "USD" | null`
- Produces: `roundSettlementMoney(value, currency): number`
- Produces: `getAppliedTradeAmounts(recommendation, precision): { deltaShares, settlementCurrency, amountLocal, amountTwd }`
- Consumes: existing `getAppliedRebalanceShareDelta(recommendation, precision)`.

- [ ] **Step 1: Write failing settlement tests**

```js
import {
  normalizeSettlementCurrency,
  roundSettlementMoney,
} from "../src/lib/settlement.js";

assert.equal(normalizeSettlementCurrency("usd"), "USD");
assert.equal(normalizeSettlementCurrency("TWD"), "TWD");
assert.equal(normalizeSettlementCurrency("EUR"), null);
assert.equal(roundSettlementMoney(123.456, "USD"), 123.46);
assert.equal(roundSettlementMoney(123.456, "TWD"), 123);
```

Add rebalance tests proving that a 10-share U.S. trade at `price: 12.34`, `priceTwd: 394.88`, and `currency: "USD"` produces `amountLocal: 123.4` and `amountTwd: 3948.8`.

- [ ] **Step 2: Run the focused tests and confirm the missing-module/missing-function failures**

Run:

```bash
node --test tests/settlement.test.js tests/rebalance-apply.test.js
```

Expected: FAIL because settlement helpers do not exist.

- [ ] **Step 3: Implement settlement helpers**

```js
export function normalizeSettlementCurrency(currency) {
  const normalized = String(currency || "").trim().toUpperCase();
  return normalized === "TWD" || normalized === "USD" ? normalized : null;
}

export function roundSettlementMoney(value, currency) {
  const digits = normalizeSettlementCurrency(currency) === "USD" ? 100 : 1;
  return Math.round((Number(value) + Number.EPSILON) * digits) / digits;
}
```

In `rebalance-apply.js`, export `getAppliedTradeAmounts`. It must use the already-rounded/capped share delta, multiply by `recommendation.price` for local currency and `recommendation.priceTwd` for TWD equivalent, and return `settlementCurrency: null` for unsupported quote currencies.

- [ ] **Step 4: Treat `.TWO` as a Taiwan ticker**

Change `isTaiwanTicker` to accept both suffixes:

```js
return /\.(?:TW|TWO)$/.test(String(normalizedTicker || "").toUpperCase());
```

Add an assertion that `.TWO` rounds to lots in lot mode.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test tests/settlement.test.js tests/rebalance-apply.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the isolated settlement foundation**

```bash
git add src/lib/settlement.js src/lib/rebalance-apply.js tests/settlement.test.js tests/rebalance-apply.test.js
git commit -m "feat: add currency-aware settlement amounts"
```

---

### Task 2: Per-Currency Funding and Cash Reserve Allocation

**Files:**
- Modify: `src/lib/rebalance-apply.js`
- Modify: `app/page.js`
- Test: `tests/rebalance-apply.test.js`

**Interfaces:**
- Produces: `getMinimumCashBalances({ targetRealCashTwd, cashTwd, cashUsd, usdTwd }): { TWD, USD }`
- Changes: `createFundedRebalanceRecommendations(...)` returns `{ recommendations, warnings, requiresSellFirstCurrencies }`.
- Consumes: `cashBalances: { TWD, USD }`, `minimumCashBalances: { TWD, USD }`, `price`, `priceTwd`, and `currency` on every recommendation.

- [ ] **Step 1: Write failing tests for independent funding pools**

Add literal scenarios:

```js
// USD shortage cannot consume TWD.
cashBalances: { TWD: 1_000_000, USD: 100 }
recommendation: { currency: "USD", price: 60, priceTwd: 1_920, tradeAmountTwd: 19_200 }
// Expected maximum applied buy: 1 share, USD remains 40, TWD unchanged.
```

Cover all required branches:

- TWD shortage with excess USD.
- Same-currency sell proceeds funding buys.
- Cross-currency sale proceeds not funding buys.
- U.S. cash-equivalent buys reduced before U.S. stock buys.
- Unknown currency produces a blocking warning and zero applied trade.
- `requiresSellFirstCurrencies` includes `USD` when USD sales are required before USD buys.

- [ ] **Step 2: Run the funding tests and verify they fail for the current single-TWD pool**

Run:

```bash
node --test tests/rebalance-apply.test.js
```

Expected: FAIL because the function accepts only `cashTwd` and returns an array.

- [ ] **Step 3: Implement cash-reserve allocation**

`getMinimumCashBalances` must:

1. Convert current USD cash to TWD with `usdTwd`.
2. Clamp both cash balances and target reserve at zero.
3. Allocate `targetRealCashTwd` in proportion to the pre-rebalance TWD-equivalent balances.
4. Return the USD reserve in USD by dividing its TWD allocation by `usdTwd`.
5. Return `{ TWD: targetRealCashTwd, USD: 0 }` when there is no valid USD value.

- [ ] **Step 4: Refactor funding by settlement currency**

For each currency:

1. Compute rounded applied share deltas.
2. Add local-currency sell proceeds to starting cash.
3. Subtract the currency-specific reserve to determine the buy budget.
4. Reduce buys one legal share unit at a time when over budget.
5. Preserve the existing priority: cash-equivalent buys first, then other buys by descending TWD-equivalent size.
6. Rewrite each funded row's `tradeAmountTwd` from the funded share delta so existing downstream Beta calculations use the executable quantity.
7. Return currency-specific warnings and sell-first flags.

- [ ] **Step 5: Wire both cash balances and FX into the operation calculation**

In `app/page.js`, replace the single `cashTwd: calculation.realCashTwd` funding call with:

```js
const minimumCashBalances = getMinimumCashBalances({
  targetRealCashTwd,
  cashTwd: formState.cashTwd,
  cashUsd: formState.cashUsd,
  usdTwd: fx.usdTwd,
});
```

Pass raw `cashTwd` and `cashUsd` rather than the merged TWD value. Append returned funding warnings to `operationRebalance.warnings`.

- [ ] **Step 6: Run funding and operation calculation tests**

Run:

```bash
node --test tests/rebalance-apply.test.js tests/operation-rebalance.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit currency-isolated funding**

```bash
git add src/lib/rebalance-apply.js app/page.js tests/rebalance-apply.test.js tests/operation-rebalance.test.js
git commit -m "fix: fund rebalance trades by settlement currency"
```

---

### Task 3: Dual-Currency Apply, Summary, Restore, and Backup Precision

**Files:**
- Modify: `src/lib/rebalance-apply.js`
- Modify: `src/lib/backup.js`
- Modify: `app/page.js`
- Test: `tests/rebalance-apply.test.js`
- Test: `tests/backup.test.js`
- Test: `tests/rebalance-restore.test.js`

**Interfaces:**
- Changes: `applyRebalanceToState({ positions, cashEquivalentPositions, cashTwd, cashUsd, recommendations, precision })` returns both `cashTwd` and `cashUsd`.
- Changes: `getAppliedRebalanceSummary(...)` returns both `cashDeltaTwd` and `cashDeltaUsd`; sleeve totals remain TWD-equivalent.
- Changes: `normalizeBackupSettings` preserves `cashUsd` to two decimals.

- [ ] **Step 1: Write failing apply tests**

Use a mixed transaction with literal expectations:

```js
cashTwd: 100_000,
cashUsd: 1_000,
// Buy 1 Taiwan share at NT$100 and 2 U.S. shares at US$50.
// Expected cashTwd: 99_900; cashUsd: 900.00.
```

Also prove:

- U.S. sale increases only `cashUsd`.
- Taiwan sale increases only `cashTwd`.
- Summary returns separate deltas.
- Unknown settlement currency is not applied.
- Mixed trades conserve TWD-equivalent assets within rounding tolerance.

- [ ] **Step 2: Write failing backup and restore precision tests**

Change existing expectations from rounded whole USD to cents:

```js
assert.equal(parsed.settings.cashUsd, 999.4);
assert.equal(restored.settings.cashUsd, 499.7);
```

Add a round-trip value such as `123.45`.

- [ ] **Step 3: Run focused tests and verify current behavior fails**

Run:

```bash
node --test tests/rebalance-apply.test.js tests/backup.test.js tests/rebalance-restore.test.js
```

Expected: FAIL because apply only returns TWD cash and backup rounds USD to integers.

- [ ] **Step 4: Refactor summary and state application**

Use `getAppliedTradeAmounts` for every applied recommendation. Add/subtract `amountLocal` from the matching cash ledger. Round TWD with zero decimals and USD with two decimals. Do not derive either balance by subtracting an FX-converted combined cash value.

- [ ] **Step 5: Preserve USD cents in state and backups**

Add `toCurrencyAmount(value, digits)` in `backup.js` and normalize `cashUsd` with two decimals. In `app/page.js`:

- Normalize stored `cashUsd` with `parseNumericInput`, not `parseIntegerInput`.
- Keep `cashTwd` as an integer.
- Make the USD field use `step="0.01"`.
- Route `updateSetting("cashUsd", ...)` through numeric parsing without integer rounding.

- [ ] **Step 6: Simplify one-click apply**

Remove the current combine-then-subtract-back flow. Pass both balances directly:

```js
const result = applyRebalanceToState({
  positions: current.positions,
  cashEquivalentPositions: current.cashEquivalentPositions,
  cashTwd: current.cashTwd,
  cashUsd: current.cashUsd,
  recommendations: operationRebalance.recommendations,
  precision: rebalancePrecision,
});
```

Copy `result.cashTwd` and `result.cashUsd` into the next state.

- [ ] **Step 7: Run apply, backup, and restore tests**

Run:

```bash
node --test tests/rebalance-apply.test.js tests/backup.test.js tests/rebalance-restore.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit dual-currency persistence and apply**

```bash
git add src/lib/rebalance-apply.js src/lib/backup.js app/page.js tests/rebalance-apply.test.js tests/backup.test.js tests/rebalance-restore.test.js
git commit -m "fix: apply rebalance to separate cash ledgers"
```

---

### Task 4: Currency-Aware Holding Cards and Operation Summaries

**Files:**
- Modify: `app/page.js`
- Modify: `app/globals.css`
- Test: `tests/operation-ui.test.js`
- Test: `tests/advice-summary.test.js`

**Interfaces:**
- Produces: `formatUsd(value): string` using two decimals.
- Produces: `formatCashDelta(value, currency): string`.
- Consumes: recommendation `currency`, `price`, `priceTwd`, `currentValueTwd`, and applied local amount.

- [ ] **Step 1: Write failing UI source/component tests**

Require the U.S. card to render all three strings from actual row values:

```text
市值 US$12,345.67
約 NT$395,061
股價 US$123.45
```

Require Taiwan cards to retain one TWD market-value row. Require the operation summary to contain separate labels `台幣現金` and `美元現金`.

- [ ] **Step 2: Run UI tests and verify the new labels/formatters are absent**

Run:

```bash
node --test tests/operation-ui.test.js tests/advice-summary.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add local-currency formatters**

Use a dedicated USD formatter with exactly two decimal places. Keep TWD market values at whole-dollar display precision. `formatCashDelta` must select `NT$` or `US$` from an explicit currency argument.

- [ ] **Step 4: Render U.S. holding values and action amounts**

In `HoldingRow`:

- `currency === "USD"`: render `shares × price` as the primary market value and `currentValueTwd` as `約 NT$…`.
- `currency === "TWD"`: keep the current TWD market-value line.
- For actionable U.S. rows, display `US$…（約 NT$…）` below the share instruction.
- Keep the current TWD action display for Taiwan rows.

- [ ] **Step 5: Split the cash summary cards**

Replace the single `現金` card with:

```jsx
<div><span>台幣現金</span><strong>{formatCashDelta(summary.cashDeltaTwd, "TWD")}</strong></div>
<div><span>美元現金</span><strong>{formatCashDelta(summary.cashDeltaUsd, "USD")}</strong></div>
```

Sleeve cards remain TWD-equivalent and should say `約 NT$` when their totals contain mixed currencies.

- [ ] **Step 6: Add sell-first and currency shortage messaging**

Render funding warnings in the existing operation warning area. When `requiresSellFirstCurrencies` is non-empty, show `部分買入需使用本次賣出所得，請先完成賣出再買入。`

- [ ] **Step 7: Run UI tests**

Run:

```bash
node --test tests/operation-ui.test.js tests/advice-summary.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit the currency-aware UI**

```bash
git add app/page.js app/globals.css tests/operation-ui.test.js tests/advice-summary.test.js
git commit -m "feat: show local currency in rebalance results"
```

---

### Task 5: Currency-Aware Copy List and Confirmation Flow

**Files:**
- Modify: `src/lib/presentation.js`
- Modify: `app/page.js`
- Test: `tests/presentation.test.js`
- Test: `tests/operation-ui.test.js`

**Interfaces:**
- Changes: `createOperationListText(recommendations)` formats actual applied local amounts using each recommendation's `currency` and `price`.
- Consumes: `getAppliedRebalanceShareDelta` or precomputed applied trade metadata passed by the caller.

- [ ] **Step 1: Write failing copy-list tests**

Expected mixed list:

```text
JJ Invest System 操作清單
0050 賣出 NT$10,000，約 100 股
QLD 買入 US$600.00（約 NT$19,200），2 股
```

Do not infer USD from a ticker name; use `currency`.

- [ ] **Step 2: Write a failing confirmation-copy test**

Require the confirmation source to contain:

```text
這會更新持股股數、台幣現金與美元現金
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
node --test tests/presentation.test.js tests/operation-ui.test.js
```

Expected: FAIL because the current list and confirmation are TWD-only.

- [ ] **Step 4: Implement currency-aware copy and confirmation**

Use local-currency amount as the primary amount and include TWD equivalent for USD. Preserve current filtering of no-op rows and share rounding. Update the successful-apply status only if needed; do not add claims of executed brokerage orders.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test tests/presentation.test.js tests/operation-ui.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit copy and confirmation changes**

```bash
git add src/lib/presentation.js app/page.js tests/presentation.test.js tests/operation-ui.test.js
git commit -m "fix: describe rebalance trades in settlement currency"
```

---

### Task 6: End-to-End Currency Safety and Regression Verification

**Files:**
- Modify: `tests/portfolio.test.js` only if an integration fixture needs explicit quote currency.
- Modify: `tests/operation-rebalance.test.js`
- Modify: `tests/rebalance-apply.test.js`
- Modify: `tests/operation-ui.test.js`
- Modify: `docs/supported-tickers.md` only if generated documentation changes.

**Interfaces:**
- Verifies the complete flow: quote currency → TWD target allocation → rounded shares → per-currency funding → UI summary → dual-currency apply → restore.

- [ ] **Step 1: Add a full mixed-market integration fixture**

Use one `.TW` holding, one `.TWO` holding, one U.S. leveraged ETF, one U.S. original ETF, TWD cash, USD cash, and a fixed FX rate. Hand-calculate expected rounded shares, cash deltas, and after-Beta. Assert neither cash ledger becomes negative.

- [ ] **Step 2: Add blocked-input integration fixtures**

Cover missing FX and an unsupported quote currency. Assert `canApplyRebalance` is false and the user-facing issue identifies the cause.

- [ ] **Step 3: Run all focused rebalance and UI tests**

Run:

```bash
node --test tests/portfolio.test.js tests/operation-rebalance.test.js tests/rebalance-apply.test.js tests/operation-ui.test.js tests/presentation.test.js tests/backup.test.js tests/rebalance-restore.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 4: Run the complete quality gate**

Run:

```bash
git diff --check
pnpm test
pnpm lint
pnpm build
```

Expected: all tests pass, lint exits zero, and Next.js production build succeeds.

- [ ] **Step 5: Verify the Preview on a mobile-width viewport**

Use a 390–430px viewport and verify:

- U.S. market value shows USD and approximate TWD without horizontal overflow.
- TWD and USD cash summary cards fit the two-column grid.
- Shortage and sell-first warnings remain readable.
- Applying a mixed-market result updates the correct cash fields in settings.
- Restore returns both cash balances and all shares to their prior values.

- [ ] **Step 6: Commit integration coverage and any final scoped corrections**

```bash
git add tests/portfolio.test.js tests/operation-rebalance.test.js tests/rebalance-apply.test.js tests/operation-ui.test.js tests/presentation.test.js tests/backup.test.js tests/rebalance-restore.test.js app/page.js app/globals.css src/lib
git commit -m "test: cover dual-currency rebalance flow"
```

- [ ] **Step 7: Push and deploy a Vercel Preview**

```bash
git push
pnpm dlx vercel deploy --yes --scope tingyonglin-droids-projects
```

Expected: Vercel deployment reaches `READY`; report the Preview URL without promoting to production.
