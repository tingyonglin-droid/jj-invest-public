# Dynamic Beta Freshness, Cron, and Vintage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trustworthy data freshness, daily secured synchronization, and forward-only point-in-time revision capture to the isolated Dynamic Beta data module.

**Architecture:** A pure freshness evaluator consumes catalog policy and dashboard state. The repository retains immutable revisions and updates last-seen metadata for identical source vintages. A dedicated secured GET route reuses the existing sync service and lock and is registered in `vercel.json`.

**Tech Stack:** Next.js App Router, Node test runner, Upstash Redis, Vercel Cron, FRED and Yahoo clients.

## Global Constraints

- Keep Dynamic Beta scoring and public flags disabled.
- Do not modify production beta, portfolio, cash, rebalance, or advice behavior.
- Do not infer `released_at`.
- Do not backfill historical ALFRED vintages.

---

### Task 1: Freshness policies and evaluator

**Files:**
- Create: `src/lib/dynamic-beta/freshness.js`
- Modify: `src/lib/dynamic-beta/catalog.js`
- Test: `tests/dynamic-beta.test.js`

**Interfaces:**
- Produces: `evaluateDynamicBetaFreshness({ series, observationDate, updateStatus, asOf })` returning status, age, thresholds, and reason.

- [ ] Write tests for weekday-aware Yahoo/FRED daily data and every monthly policy.
- [ ] Run focused tests and verify they fail because the evaluator is absent.
- [ ] Add catalog policies and implement the pure evaluator.
- [ ] Run focused tests and verify they pass.

### Task 2: Forward vintage persistence

**Files:**
- Modify: `src/lib/dynamic-beta/repository.js`
- Test: `tests/dynamic-beta.test.js`

**Interfaces:**
- Consumes normalized observation realtime boundaries.
- Produces immutable value-revision records with `first_seen_at` and `last_seen_at`; an identical value updates only last seen.

- [ ] Write tests proving identical values update last seen even when realtime query boundaries move.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement vintage identity and last-seen updates without replacing historical revisions.
- [ ] Run focused tests and verify they pass.

### Task 3: Dashboard freshness and vintage fields

**Files:**
- Modify: `src/lib/dynamic-beta/repository.js`
- Modify: `src/lib/dynamic-beta/admin-view.js`
- Modify: `app/admin/dynamic-beta/page.js`
- Test: `tests/dynamic-beta.test.js`

**Interfaces:**
- Dashboard rows include freshness and current revision audit fields.

- [ ] Write repository/admin formatting tests for the new fields.
- [ ] Verify focused tests fail.
- [ ] Evaluate freshness while reading dashboard rows and render compact internal columns.
- [ ] Verify focused tests pass.

### Task 4: Secured daily cron

**Files:**
- Create: `app/api/dynamic-beta/cron/route.js`
- Create: `vercel.json`
- Modify: `tests/dynamic-beta-routes.test.js`

**Interfaces:**
- `GET /api/dynamic-beta/cron` requires exact bearer `CRON_SECRET` and invokes the configured full sync.

- [ ] Write route tests for missing/wrong secret and disabled data flag.
- [ ] Verify tests fail because the route is absent.
- [ ] Implement the secured route and daily Vercel schedule.
- [ ] Verify route tests pass.

### Task 5: End-to-end verification

**Files:**
- Modify documentation only if verification reveals an operational difference.

- [ ] Run `pnpm test`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Confirm the admin page/API exposes freshness without enabling scoring or public flags.
