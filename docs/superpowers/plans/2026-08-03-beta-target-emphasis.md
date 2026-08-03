# Beta Target Emphasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the calculated target Beta immediately visible as `目標Beta設定 1.0` in the Beta settings summary.

**Architecture:** Restructure the existing `weightGuard` success state into a summary region and a dedicated Beta badge. Add scoped responsive styles; preserve the existing calculation and error behavior.

**Tech Stack:** Next.js 16, React 19, CSS, Node test runner

## Global Constraints

- Work only on `rebalance-simplify`.
- Do not change portfolio calculation behavior.
- Deploy a Vercel Preview, not production.

---

### Task 1: Beta summary visual hierarchy

**Files:**
- Modify: `app/page.js`
- Modify: `app/globals.css`
- Test: `tests/beta-target-emphasis-ui.test.js`

**Interfaces:**
- Consumes: `calculation.targetBeta`, `calculation.targetLeveragedRatio`, `calculation.targetOriginalRatio`, `calculation.afterCashRatio`, and `betaGuardIsValid`.
- Produces: `.weightGuardSummary`, `.weightGuardBeta`, `.weightGuardBetaLabel`, and `.weightGuardBetaValue` UI hooks, with the label and one-decimal value at the same compact size and the value in danger red.

- [ ] **Step 1: Write the failing test**

Assert that the page contains a dedicated Beta label/value and the stylesheet contains desktop and narrow-screen layout rules.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/beta-target-emphasis-ui.test.js`

Expected: FAIL because the new UI hooks do not exist.

- [ ] **Step 3: Write minimal implementation**

Split the success state into allocation copy and a dedicated Beta badge, then add scoped responsive styling.

- [ ] **Step 4: Run verification**

Run the targeted test, `npm test`, `npm run lint`, and `npm run build`.

- [ ] **Step 5: Commit and deploy preview**

Commit the scoped branch changes, push `rebalance-simplify`, and run a non-production Vercel deployment.
