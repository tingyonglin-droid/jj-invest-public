# News Event Data Module v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal, revision-safe News Event Data Module that captures five-item morning briefs, validates topics, and detects duplicate evidence without changing any production investment behavior.

**Architecture:** Pure normalization and validation functions sit under `src/lib/dynamic-beta/news/`. A focused Redis repository stores immutable evidence and brief revisions plus small indexes. Admin-only App Router handlers reuse the existing Redis and token helpers, and the current Dynamic Beta admin page provides a minimal JSON validation/import view.

**Tech Stack:** Next.js 16 App Router, React 19, Node.js test runner, Upstash Redis, JavaScript ES modules.

## Global Constraints

- No automatic news search, scraping, third-party news API, or AI API in v0.
- No news score, Crash Risk Score, Target Beta, rebalance, holding, cash, recommendation, or public UI changes.
- `DYNAMIC_BETA_NEWS_DATA_ENABLED` is the only news capability that may be enabled.
- `DYNAMIC_BETA_NEWS_SCORING_ENABLED` and `DYNAMIC_BETA_NEWS_PUBLIC_ENABLED` remain false.
- Existing dirty-worktree changes are preserved; no commits are created in this execution.

---

### Task 1: Contracts, normalization, and topic suggestions

**Files:**
- Create: `tests/dynamic-beta-news.test.js`
- Create: `src/lib/dynamic-beta/news/topics.js`
- Create: `src/lib/dynamic-beta/news/normalize.js`
- Create: `src/lib/dynamic-beta/news/schema.js`

**Interfaces:**
- Produces: `canonicalizeNewsUrl(url)`, `normalizeNewsEvidence(input, now)`, `validateMorningBriefPayload(input, options)`, `suggestNewsTopics(text)`.

- [ ] Write failing tests proving tracking parameters/fragments do not alter URL identity, content fingerprints are deterministic, exactly five events are required, topic IDs are allowlisted, confidence is bounded, and optional earnings numbers preserve `null`.
- [ ] Run `node --test tests/dynamic-beta-news.test.js` and confirm failure because the modules do not exist.
- [ ] Implement the minimal pure functions and fixed taxonomy.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Duplicate detection and append-only repository

**Files:**
- Modify: `tests/dynamic-beta-news.test.js`
- Create: `src/lib/dynamic-beta/news/dedupe.js`
- Create: `src/lib/dynamic-beta/news/repository.js`

**Interfaces:**
- Consumes: normalized evidence and snapshots from Task 1.
- Produces: `compareNewsTitles(left, right)`, `createNewsRepository(redis)` with `saveEvidence`, `saveMorningBrief`, `readRecentBriefs`, and `readEvidenceSummaries`.

- [ ] Add failing tests for same URL/same content idempotency, same URL/changed content revision creation, identical content/different URL duplicate linking, likely-title duplicate warnings inside 72 hours, and append-only brief revisions.
- [ ] Run the focused tests and verify the expected behavior failures.
- [ ] Implement the Redis key model and repository methods without expiry or destructive writes.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Ingestion service and isolated flags

**Files:**
- Modify: `tests/dynamic-beta-news.test.js`
- Modify: `src/lib/dynamic-beta/config.js`
- Create: `src/lib/dynamic-beta/news/service.js`

**Interfaces:**
- Produces: `getDynamicBetaNewsFlags(environment)`, `createNewsEventService({ repository, now })` with `validate` and `ingest`.

- [ ] Add failing tests proving absent flags disable all news capabilities, only exact string `true` enables data, ingest saves normalized evidence before an immutable brief revision, and validation performs no writes.
- [ ] Run the focused tests and confirm the failures.
- [ ] Implement the service and flag reader.
- [ ] Run the focused tests and confirm they pass.

### Task 4: Admin API routes

**Files:**
- Modify: `app/api/dynamic-beta/_shared.js`
- Create: `app/api/dynamic-beta/news/route.js`
- Create: `app/api/dynamic-beta/news/validate/route.js`
- Modify: `tests/dynamic-beta-routes.test.js`

**Interfaces:**
- Consumes: existing `USAGE_ADMIN_TOKEN`, shared Redis configuration, and Task 3 service.
- Produces: admin-only GET/POST endpoints with JSON error responses.

- [ ] Add failing route tests for unauthorized access, disabled news data, malformed JSON, validation-only behavior, and scoring/public flags remaining informational only.
- [ ] Run `node --test tests/dynamic-beta-routes.test.js` and confirm the new tests fail.
- [ ] Implement App Router handlers using named HTTP exports and `force-dynamic`.
- [ ] Run route and news tests and confirm they pass.

### Task 5: Internal JSON validation view

**Files:**
- Create: `src/lib/dynamic-beta/news/template.js`
- Modify: `app/admin/dynamic-beta/page.js`

**Interfaces:**
- Consumes: Task 4 APIs.
- Produces: an internal paste/validate/save panel and recent revision summary on the existing admin page.

- [ ] Add a valid five-event JSON template that contains no real news claims.
- [ ] Add textarea, validate, save, warnings, and recent revision rendering while retaining the existing market-data and score-preview sections.
- [ ] Manually verify missing admin token and disabled-flag errors remain visible.

### Task 6: Full verification and documentation

**Files:**
- Modify: `.env.local` only if the user-local file already exists, keeping all values server-side.
- Modify: project documentation only if an existing environment-variable section is present.

**Interfaces:** None.

- [ ] Run `node --test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Exercise validate and ingest with a controlled local payload when Redis configuration is available.
- [ ] Confirm no production portfolio/rebalance/Target Beta module imports the news module.
- [ ] Report files, flags, endpoints, tests, limitations, and manual test steps; stop before scoring work.
