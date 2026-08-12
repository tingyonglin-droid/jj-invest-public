# Portfolio Setup Overview Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a setup link instead of rebalance status until holdings, cash, and the first quote response are available.

**Architecture:** Add a pure setup-completion helper next to the overview action model, pass the result into `createOverviewAction`, and retain the existing destination handling in `app/page.js`.

**Tech Stack:** React 19, JavaScript ES modules, Node.js test runner, Next.js 16.

## Global Constraints

- Do not change portfolio, Beta, or rebalance formulas.
- Route setup to `settings` with `settingsPage: "positions"`.
- Treat TWD cash, USD cash, and cash-equivalent shares as valid cash setup.

---

### Task 1: Setup completion model

**Files:**
- Modify: `src/lib/overview-action.js`
- Modify: `tests/overview-action.test.js`

- [ ] Write failing tests for missing quotes, holdings, and cash plus TWD, USD, and cash-equivalent success cases.
- [ ] Run `node --test tests/overview-action.test.js` and verify failure.
- [ ] Implement `isPortfolioSetupComplete({ formState, hasReceivedQuoteResponse })`.
- [ ] Run the focused test and verify success.

### Task 2: Setup action integration

**Files:**
- Modify: `app/page.js`
- Modify: `src/lib/overview-action.js`
- Modify: `tests/overview-action.test.js`

- [ ] Write a failing action test for incomplete setup.
- [ ] Extend `createOverviewAction(calculation, { setupComplete })` with the setup action before validation and rebalance branches.
- [ ] Pass setup completion from `Home` and run overview action/UI tests.
- [ ] Run full tests, lint, and production build.
- [ ] Commit and push the branch to update Vercel Preview.
