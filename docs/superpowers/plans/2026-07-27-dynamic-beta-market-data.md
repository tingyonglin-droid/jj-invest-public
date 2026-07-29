# Dynamic Beta Market Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated, feature-flagged Dynamic Beta market-data pipeline for ten FRED series and five existing equity quote symbols without changing public portfolio behavior.

**Architecture:** Server-only adapters normalize FRED and Yahoo observations into one shape, then an Upstash repository stores metadata, date indexes, current pointers, and append-only revisions. Protected admin endpoints trigger synchronization and expose validation status; a hidden admin page consumes only those endpoints.

**Tech Stack:** Next.js 16 App Router, Node.js ES modules, `@upstash/redis`, Node test runner, FRED API, existing Yahoo Finance/TWSE helpers.

## Global Constraints

- Do not change Dynamic Beta scoring, current Beta, holdings, cash, rebalancing, today advice, or public UI.
- `FRED_API_KEY` remains server-only.
- Only `DYNAMIC_BETA_DATA_ENABLED=true`; scoring and public flags remain false.
- Preserve all user-owned uncommitted changes.
- Do not add a new market-data provider, database provider, or Vercel Cron configuration.

---

### Task 1: Catalog, flags, and normalization

**Files:**
- Create: `src/lib/dynamic-beta/catalog.js`
- Create: `src/lib/dynamic-beta/config.js`
- Create: `src/lib/dynamic-beta/normalize.js`
- Test: `tests/dynamic-beta.test.js`

- [ ] Write failing tests for the 15 catalog entries, strict feature flags, FRED missing values, and normalized observations.
- [ ] Run the focused test and confirm it fails because the module does not exist.
- [ ] Implement the minimal catalog, config, and normalization helpers.
- [ ] Run the focused test and confirm it passes.

### Task 2: FRED and equity adapters

**Files:**
- Create: `src/lib/dynamic-beta/fred-client.js`
- Create: `src/lib/dynamic-beta/equity-client.js`
- Modify: `src/lib/market-data.js`
- Test: `tests/dynamic-beta.test.js`

- [ ] Write failing tests for safe FRED requests/errors and raw trading-day equity history.
- [ ] Add an injectable FRED client and a raw Yahoo history export without changing existing aligned history behavior.
- [ ] Verify focused and existing market tests.

### Task 3: Append-only Upstash repository and sync service

**Files:**
- Create: `src/lib/dynamic-beta/repository.js`
- Create: `src/lib/dynamic-beta/sync.js`
- Test: `tests/dynamic-beta.test.js`

- [ ] Write failing tests for idempotent writes, revisions, current pointers, status, partial failures, and locking.
- [ ] Implement Redis keys and dependency-injected repository/sync services.
- [ ] Verify focused tests.

### Task 4: Protected routes and validation page

**Files:**
- Create: `app/api/dynamic-beta/_shared.js`
- Create: `app/api/dynamic-beta/sync/route.js`
- Create: `app/api/dynamic-beta/admin/route.js`
- Create: `app/admin/dynamic-beta/page.js`
- Test: `tests/dynamic-beta-routes.test.js`

- [ ] Write failing tests for admin authorization, disabled flags, route isolation, and hidden admin UI.
- [ ] Implement protected sync/read routes and the minimal validation view.
- [ ] Verify route tests.

### Task 5: Compatibility and live verification

- [ ] Run the full test suite, lint, and production build in single processes.
- [ ] With configured credentials, trigger a real sync and record each series result; otherwise report the exact missing configuration.
- [ ] Confirm public modules do not import Dynamic Beta and inspect the final diff for unrelated changes.
