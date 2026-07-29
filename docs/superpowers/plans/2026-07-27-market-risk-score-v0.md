# Market Risk Score v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explainable fixed-rule Market Risk Score v0 for administrator-only offline preview.

**Architecture:** Pure transformation and scoring modules consume repository histories. A read-only repository method supplies current revisions, and a protected preview route/page exposes results without activating Dynamic Beta scoring or public behavior.

**Tech Stack:** JavaScript ES modules, Node test runner, Upstash Redis, Next.js App Router.

## Global Constraints

- Keep `DYNAMIC_BETA_SCORING_ENABLED=false` and `DYNAMIC_BETA_PUBLIC_ENABLED=false`.
- Do not modify Target Beta, portfolio, cash, rebalance, or advice behavior.
- Do not persist preview scores as production signals.
- Do not claim full point-in-time accuracy for historical macro data.

---

### Task 1: Fixed-rule transformations and scoring

**Files:**
- Create: `src/lib/dynamic-beta/market-risk-score.js`
- Test: `tests/dynamic-beta-score.test.js`

- [ ] Write failing tests for threshold direction, as-of transforms, category weights, and explanations.
- [ ] Implement versioned signal definitions and score calculation.
- [ ] Verify focused tests pass.

### Task 2: Coverage and missing data

**Files:**
- Modify: `src/lib/dynamic-beta/market-risk-score.js`
- Test: `tests/dynamic-beta-score.test.js`

- [ ] Write failing tests for partial and insufficient coverage.
- [ ] Implement weight renormalization and 70% minimum coverage.
- [ ] Verify focused tests pass.

### Task 3: Read-only history repository

**Files:**
- Modify: `src/lib/dynamic-beta/repository.js`
- Modify: `tests/dynamic-beta.test.js`

- [ ] Write a failing test for date-bounded ordered current-revision reads.
- [ ] Implement `readObservationHistory` without writes.
- [ ] Verify repository tests pass.

### Task 4: Admin preview API and view

**Files:**
- Create: `app/api/dynamic-beta/score-preview/route.js`
- Modify: `app/admin/dynamic-beta/page.js`
- Modify: `tests/dynamic-beta-routes.test.js`

- [ ] Write failing authorization and feature-isolation route tests.
- [ ] Implement protected on-demand preview composition.
- [ ] Add a compact internal preview section with manual calculation.
- [ ] Verify route and presentation tests pass.

### Task 5: Full verification

- [ ] Run `pnpm test`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Confirm scoring/public flags remain false and production investment modules are unchanged.
