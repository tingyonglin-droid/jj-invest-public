# Daily Morning Brief Draft v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only Redis draft and human-approval workflow, then create a pending structured morning brief for `2026-07-28` that enters the existing D1/D3 system only after explicit approval.

**Architecture:** Add a separate append-only draft repository and lifecycle service in front of the existing News Event validator and ingestion service. Thin admin-only routes expose create/list/approve/reject operations, while a self-contained panel on the existing Dynamic Beta admin page previews the selected revision and performs explicit approval or rejection. Pending drafts remain invisible to the existing morning-brief repository and confirmation endpoint.

**Tech Stack:** Next.js 16 App Router, React 19, Node.js ES modules, `node:test`, Upstash Redis, existing News Event schema/repository/service and admin-token authorization.

## Global Constraints

- Do not add an in-app news provider, web crawler, AI provider, AI SDK, scheduled job, dependency, database table, or environment variable.
- Reuse the existing Upstash Redis configuration, `USAGE_ADMIN_TOKEN`, `DYNAMIC_BETA_NEWS_DATA_ENABLED`, News Event validator, evidence deduplication, and morning-brief revision service.
- Only a human-approved draft may enter the existing morning-brief repository and D1/D3 confirmation path.
- Keep `DYNAMIC_BETA_SCORING_ENABLED`, `DYNAMIC_BETA_NEWS_SCORING_ENABLED`, `DYNAMIC_BETA_PUBLIC_ENABLED`, and `DYNAMIC_BETA_NEWS_PUBLIC_ENABLED` false.
- Do not modify Market Risk Score, Dynamic Beta, Target Beta, portfolio, holdings, cash, rebalance, recommendation, or public UI behavior.
- Preserve every draft payload revision; lifecycle metadata may change, but editorial payloads must not be overwritten.
- Approval and identical draft submission must be idempotent.
- A failed publish must leave the draft pending, and retry after a partial status-write failure must not duplicate the published brief.
- The worktree contains unrelated user changes. Do not commit, stage, revert, or reformat unrelated files without an explicit user request; use test and diff checkpoints instead of commits.

---

## File Map

- Create `src/lib/dynamic-beta/news/draft-repository.js`: content-addressed Redis draft revisions, timeline reads, and lifecycle updates.
- Create `src/lib/dynamic-beta/news/draft-service.js`: validation, create, list, idempotent approval, recovery, and rejection orchestration.
- Modify `app/api/dynamic-beta/_shared.js`: construct the draft repository and service from the existing Redis and News Event components.
- Create `app/api/dynamic-beta/news/drafts/_handlers.js`: dependency-injected HTTP handlers and consistent 400/404/409/500 responses.
- Create `app/api/dynamic-beta/news/drafts/route.js`: protected GET/POST collection route.
- Create `app/api/dynamic-beta/news/drafts/approve/route.js`: protected approval route.
- Create `app/api/dynamic-beta/news/drafts/reject/route.js`: protected rejection route.
- Create `src/lib/dynamic-beta/news/draft-view.js`: pure Chinese status labels and rule formatting for the admin panel.
- Create `app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js`: internal draft list, preview, approval, and rejection UI.
- Modify `app/admin/dynamic-beta/page.js`: mount the internal panel without changing existing controls.
- Create `tests/dynamic-beta-news-draft.test.js`: repository and lifecycle service tests.
- Create `tests/dynamic-beta-news-draft-routes.test.js`: handler and route isolation tests.
- Create `tests/dynamic-beta-news-draft-ui.test.js`: view formatting and admin panel contract tests.
- Create `artifacts/dynamic-beta/morning-brief-2026-07-28-draft.json`: sourced five-event payload submitted as a pending draft.

---

### Task 1: Build the Immutable Draft Repository

**Files:**
- Create: `src/lib/dynamic-beta/news/draft-repository.js`
- Create: `tests/dynamic-beta-news-draft.test.js`

**Interfaces:**
- Produces: `createNewsDraftRepository(redis)`.
- Produces: `saveDraft({ payload, warnings, createdAt }) -> { status, draft }`.
- Produces: `readDraft({ briefDate, draftRevisionId? }) -> draft|null`.
- Produces: `readRecentDrafts({ limit? }) -> draft[]`.
- Produces: `markApproved({ briefDate, draftRevisionId, approvedAt, brief, dedupeWarnings }) -> draft|null`.
- Produces: `markRejected({ briefDate, draftRevisionId, rejectedAt, rejectionReason }) -> draft|null`.

- [ ] **Step 1: Write normalized payload and FakeRedis fixtures**

In `tests/dynamic-beta-news-draft.test.js`, copy the small `FakeRedis` API used in `tests/dynamic-beta-news.test.js`: `hgetall`, `hset`, `get`, `set`, `zadd`, and `zrange`. Generate stored data through the real validator:

```js
function normalizedBrief(overrides = {}) {
  const payload = {
    briefDate: "2026-07-28",
    generatedAt: "2026-07-28T00:00:00.000Z",
    analystLabel: "risk_elevated",
    analystRationale: "等待市場數據確認。",
    evidence: [{
      url: "https://example.com/source",
      sourceName: "Example Source",
      sourceTier: "primary",
      title: "Example source title",
      publishedAt: "2026-07-27T23:00:00.000Z",
    }],
    events: Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      headline: `Event ${index + 1}`,
      summary: `Summary ${index + 1}`,
      topicIds: ["global_macro_fed"],
      evidenceUrls: ["https://example.com/source"],
      transmissionPath: ["事件", "市場", "資產"],
      affectedAssets: ["SPY"],
      marketDate: "2026-07-28",
      dataToConfirm: ["YAHOO:SPY"],
      confirmationRules: [{
        seriesId: "YAHOO:SPY",
        expectedDirection: "down",
        changeType: "percent",
        threshold: 1,
      }],
      interpretation: "等待確認。",
      confidence: 0.7,
    })),
    ...overrides,
  };
  const result = validateMorningBriefPayload(payload, {
    now: "2026-07-28T00:05:00.000Z",
  });
  assert.equal(result.valid, true);
  return result.value;
}
```

- [ ] **Step 2: Write failing append-only and lifecycle tests**

Assert identical input is unchanged, changed content creates revision 2, and both revisions remain readable:

```js
const first = await repository.saveDraft({
  payload: firstPayload,
  warnings: ["review"],
  createdAt: "2026-07-28T00:10:00.000Z",
});
const unchanged = await repository.saveDraft({
  payload: firstPayload,
  warnings: ["review"],
  createdAt: "2026-07-28T00:15:00.000Z",
});
const changed = await repository.saveDraft({
  payload: { ...firstPayload, analystLabel: "high_alert" },
  warnings: [],
  createdAt: "2026-07-28T00:20:00.000Z",
});
assert.deepEqual(
  [first.status, unchanged.status, changed.status],
  ["inserted", "unchanged", "revised"],
);
assert.equal(first.draft.draftRevisionNumber, 1);
assert.equal(changed.draft.draftRevisionNumber, 2);
```

Then call `markApproved` and `markRejected` on different revisions and assert `status`, lifecycle timestamps, rejection reason, published brief identity, and dedupe warnings change while `payload` remains deeply equal to the original snapshot. Add a third pending revision and assert the default read selects that newest pending revision; after reviewing every revision, assert it falls back to the most recently submitted reviewed revision. Save a second date and assert `readRecentDrafts({ limit: 1 })` returns only the newest timeline row.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news-draft.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `draft-repository.js`.

- [ ] **Step 4: Implement content-addressed storage**

Create private identity and key helpers:

```js
import { createHash } from "node:crypto";

const PREFIX = "jj-invest-public:dynamic-beta:news:v1:draft";

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function revisionId(payload) {
  return `ndrv_${digest(JSON.stringify(payload))}`;
}
```

Use Redis keys `<prefix>:<briefDate>:current`, `<prefix>:<briefDate>:revision:<id>`, `<prefix>:<briefDate>:revisions`, and `<prefix>:timeline`. Store the payload as JSON and unpack both JSON strings and Upstash-deserialized objects. A new record has this exact lifecycle shape:

```js
{
  draftId: payload.briefDate,
  draftRevisionId,
  draftRevisionNumber,
  briefDate: payload.briefDate,
  status: "pending",
  createdAt,
  updatedAt: createdAt,
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  approvedBriefRevisionId: null,
  approvedBriefRevisionNumber: null,
  validationWarnings: warnings,
  dedupeWarnings: [],
  payload,
}
```

Identical submissions return the stored lifecycle state and never reset an approved or rejected revision to pending.

When `readDraft` has no explicit revision ID, read revision IDs newest-first and return the first pending record. If no pending record exists, fall back to the current pointer so a fully reviewed date remains inspectable.

- [ ] **Step 5: Implement lifecycle metadata updates**

`markApproved` and `markRejected` must read the exact revision, return `null` if missing, and update only lifecycle hash fields. Do not change the current pointer during review actions:

```js
await redis.hset(revisionKey, {
  status: "approved",
  updatedAt: approvedAt,
  approvedAt,
  approvedBriefRevisionId: brief.revisionId,
  approvedBriefRevisionNumber: brief.revisionNumber,
  dedupeWarnings,
});
```

- [ ] **Step 6: Run focused tests and diff checks**

Run:

```bash
node --test tests/dynamic-beta-news-draft.test.js
git diff --check -- src/lib/dynamic-beta/news/draft-repository.js tests/dynamic-beta-news-draft.test.js
```

Expected: repository tests pass and no whitespace errors are reported.

---

### Task 2: Build the Draft Lifecycle Service

**Files:**
- Create: `src/lib/dynamic-beta/news/draft-service.js`
- Modify: `tests/dynamic-beta-news-draft.test.js`

**Interfaces:**
- Consumes: Task 1 repository and existing `createNewsEventService` result.
- Produces: `createNewsDraftService({ draftRepository, newsEventService, now })` with `create`, `list`, `approve`, and `reject` methods.
- Produces: `NewsDraftNotFoundError` and `NewsDraftConflictError`.

- [ ] **Step 1: Write failing create/list tests**

Use a fake News Event service whose `validate` delegates to the real validator and whose `ingest` throws if draft creation accidentally publishes:

```js
const service = createNewsDraftService({
  draftRepository: repository,
  newsEventService: {
    async validate(payload) {
      return validateMorningBriefPayload(payload, {
        now: "2026-07-28T00:05:00.000Z",
      });
    },
    async ingest() {
      throw new Error("create must not publish");
    },
  },
  now: () => new Date("2026-07-28T00:10:00.000Z"),
});
```

Assert invalid input returns `saved: false` with zero draft rows. Assert valid input returns `saved: true`, `status: "pending"`, and appears in `list({ briefDate: "2026-07-28" })`.

- [ ] **Step 2: Write failing approval, rejection, and recovery tests**

Assert first approval calls `ingest` once and stores `nbr_approved`; repeated approval returns `alreadyApproved: true` without calling `ingest` again:

```js
const approved = await service.approve({
  briefDate: "2026-07-28",
  draftRevisionId: created.draft.draftRevisionId,
});
assert.equal(approved.draft.status, "approved");
assert.equal(approved.brief.revisionId, "nbr_approved");
assert.equal(ingestCalls, 1);
```

Also assert missing exact revisions throw `NewsDraftNotFoundError`; rejected revisions cannot be approved; approved revisions cannot be rejected; rejection trims a reason up to 300 characters and never ingests; ingestion failure leaves the record pending; successful approval saves `published.dedupeWarnings`; and retry after one simulated `markApproved` failure receives the same content-addressed brief revision and completes without a second stored morning-brief revision.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news-draft.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `draft-service.js`.

- [ ] **Step 4: Implement errors, time validation, and draft creation**

```js
export class NewsDraftNotFoundError extends Error {
  constructor(message = "找不到指定的晨報草稿。") {
    super(message);
    this.name = "NewsDraftNotFoundError";
  }
}

export class NewsDraftConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "NewsDraftConflictError";
  }
}
```

`create(payload)` calls `newsEventService.validate` exactly once. Invalid results return errors and warnings without a write. Valid results pass the normalized `value`, warnings, and one captured ISO timestamp to `saveDraft`.

- [ ] **Step 5: Implement exact-revision approval**

Use this state order: missing → not found; approved → recorded idempotent result; non-pending → conflict; pending → revalidate → ingest through the existing service → mark approved with `published.dedupeWarnings || []`. Never mark approved before `ingest` returns `saved: true`.

```js
if (draft.status === "approved") {
  return {
    alreadyApproved: true,
    draft,
    brief: {
      revisionId: draft.approvedBriefRevisionId,
      revisionNumber: draft.approvedBriefRevisionNumber,
    },
  };
}
```

Retry safety comes from the existing content-addressed `saveMorningBrief`: if publishing succeeded before the status write failed, repeating ingestion returns the same revision before lifecycle completion.

- [ ] **Step 6: Implement rejection and list selection**

`reject` permits only pending exact revisions, trims the optional reason, and returns conflict for a reason longer than 300 characters. `list({ briefDate, draftRevisionId, limit })` returns one exact/current row when a date is present or up to 20 recent revisions by default.

- [ ] **Step 7: Run focused tests and diff checks**

Run:

```bash
node --test tests/dynamic-beta-news-draft.test.js
git diff --check -- src/lib/dynamic-beta/news/draft-service.js tests/dynamic-beta-news-draft.test.js
```

Expected: repository and lifecycle service tests pass with no whitespace errors.

---

### Task 3: Add Protected Draft APIs and Error Mapping

**Files:**
- Modify: `app/api/dynamic-beta/_shared.js`
- Create: `app/api/dynamic-beta/news/drafts/_handlers.js`
- Create: `app/api/dynamic-beta/news/drafts/route.js`
- Create: `app/api/dynamic-beta/news/drafts/approve/route.js`
- Create: `app/api/dynamic-beta/news/drafts/reject/route.js`
- Create: `tests/dynamic-beta-news-draft-routes.test.js`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `getDynamicBetaNewsDraftRepository()` and `createConfiguredNewsDraftService(...)`.
- Produces: dependency-injected collection and action handler factories for full status-code testing.

- [ ] **Step 1: Write failing collection-handler tests**

Inject authorization, flag, service, and flag-reporting dependencies:

```js
const handlers = createDraftCollectionHandlers({
  authorize() { return null; },
  requireEnabled() { return null; },
  getService() {
    return {
      async list() { return { drafts: [] }; },
      async create() { return { saved: true, draft: { status: "pending" } }; },
    };
  },
  flags() {
    return { dataEnabled: true, scoringEnabled: false, publicEnabled: false };
  },
});
```

Assert authentication short-circuits first, the news-data flag short-circuits second, malformed JSON is 400, impossible dates are 400, `draftRevisionId` without `briefDate` is 400, limit outside 1–50 is 400, and valid GET/POST responses retain disabled scoring/public flags.

- [ ] **Step 2: Write failing action-handler mapping tests**

Inject services that return success or throw `NewsDraftNotFoundError`, `NewsDraftConflictError`, and an unexpected error. Assert mappings 200, 404, 409, and sanitized 500. Assert both actions require exact `briefDate` plus `draftRevisionId`, reject accepts an optional string reason, and neither route leaks a fake secret error message.

- [ ] **Step 3: Run the route test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news-draft-routes.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `_handlers.js`.

- [ ] **Step 4: Wire configured constructors**

In `_shared.js`, instantiate the draft service only when both draft and existing news repositories exist:

```js
export function createConfiguredNewsDraftService({
  draftRepository = getDynamicBetaNewsDraftRepository(),
  newsRepository = getDynamicBetaNewsRepository(),
} = {}) {
  if (!draftRepository || !newsRepository) return null;
  return createNewsDraftService({
    draftRepository,
    newsEventService: createConfiguredNewsEventService(newsRepository),
  });
}
```

- [ ] **Step 5: Implement handlers and status mapping**

Collection GET parses `briefDate`, `draftRevisionId`, and `limit`. Collection POST calls `create`; invalid schema returns 400 and writes nothing. Actions parse JSON and call the exact lifecycle method. Map errors in this order:

```js
if (error instanceof NewsDraftNotFoundError) {
  return Response.json({ error: error.message }, { status: 404 });
}
if (error instanceof NewsDraftConflictError) {
  return Response.json({ error: error.message }, { status: 409 });
}
console.error(`[dynamic-beta-news-draft:${action}]`, error);
return Response.json({ error: "晨報草稿處理失敗。" }, { status: 500 });
```

Null configured service returns the existing 503 response with `缺少 Upstash Redis 設定。`.

- [ ] **Step 6: Add thin protected route modules**

Every route calls `authorizeDynamicBetaRequest` before `requireDynamicBetaNewsDataEnabled`. Drafts do not require `DYNAMIC_BETA_DATA_ENABLED` until an approved brief is later evaluated by the existing confirmation endpoint. Export `dynamic = "force-dynamic"` and handler methods from each route.

- [ ] **Step 7: Run route and regression tests**

Run:

```bash
node --test tests/dynamic-beta-news-draft-routes.test.js tests/dynamic-beta-routes.test.js tests/dynamic-beta-news.test.js
git diff --check -- app/api/dynamic-beta/_shared.js app/api/dynamic-beta/news/drafts tests/dynamic-beta-news-draft-routes.test.js
```

Expected: all selected tests pass and no whitespace errors are reported.

---

### Task 4: Add the Internal Draft Preview and Approval Panel

**Files:**
- Create: `src/lib/dynamic-beta/news/draft-view.js`
- Create: `app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js`
- Modify: `app/admin/dynamic-beta/page.js`
- Create: `tests/dynamic-beta-news-draft-ui.test.js`

**Interfaces:**
- Consumes: Task 3 endpoints.
- Produces: `draftStatusLabel(status)`, `formatDraftRule(rule)`, and a self-contained `<DailyMorningBriefDraftPanel />`.

- [ ] **Step 1: Write failing formatter and panel-contract tests**

```js
assert.equal(draftStatusLabel("pending"), "待核准");
assert.equal(draftStatusLabel("approved"), "已核准");
assert.equal(draftStatusLabel("rejected"), "已拒絕");
assert.equal(formatDraftRule({
  seriesId: "YAHOO:QQQ",
  expectedDirection: "down",
  changeType: "percent",
  threshold: 1,
}), "YAHOO:QQQ · 下跌至少 1%");
```

Read panel/page source as text and assert draft endpoint paths, `window.confirm`, `核准並發布`, `拒絕草稿`, the isolation copy, and the panel import are present.

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news-draft-ui.test.js
```

Expected: FAIL because the helper and panel do not exist.

- [ ] **Step 3: Implement display helpers**

Use fixed Chinese status labels. `formatDraftRule` maps `up/down` to `上升/下跌` and formats `percent`, `basis_points`, and `absolute` thresholds without changing their values.

- [ ] **Step 4: Implement panel state and protected requests**

The component reads the existing token from the admin URL, loads recent drafts on mount, selects the first revision, and retains selection across refreshes. Approval requires:

```js
if (!window.confirm(`核准並發布 ${selected.briefDate} revision #${selected.draftRevisionNumber}？`)) return;
await fetch(`/api/dynamic-beta/news/drafts/approve?token=${encodeURIComponent(token)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    briefDate: selected.briefDate,
    draftRevisionId: selected.draftRevisionId,
  }),
});
```

Rejection gets an optional reason with `window.prompt`, asks for confirmation, posts the exact revision, and reloads. Disable both lifecycle actions while either request is active.

- [ ] **Step 5: Render a complete mobile-readable preview**

Use existing admin CSS classes and one open `<details>` per event. Show date/revision/status, analyst label/rationale, timestamps, validation warnings, approval-time dedupe warnings, five headlines, summaries, source links, topic IDs, transmission path, assets, market date, confirmation rules, interpretation, confidence, rejection reason, and published brief identity. Include this exact isolation copy: `核准只會發布到內部 News Event 系統，不會啟用 scoring、Dynamic Beta 或公開功能。`

- [ ] **Step 6: Mount the panel without changing other controls**

Render `<DailyMorningBriefDraftPanel />` immediately before the existing raw JSON ingestion section. Do not move or modify the raw tool, score preview, confirmation panel, market table, or sync buttons.

- [ ] **Step 7: Run UI tests and lint**

Run:

```bash
node --test tests/dynamic-beta-news-draft-ui.test.js tests/dynamic-beta-news-confirmation-ui.test.js tests/dynamic-beta-news-draft-routes.test.js
npm run lint -- app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js app/admin/dynamic-beta/page.js src/lib/dynamic-beta/news/draft-view.js
git diff --check -- app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js app/admin/dynamic-beta/page.js src/lib/dynamic-beta/news/draft-view.js tests/dynamic-beta-news-draft-ui.test.js
```

Expected: tests and ESLint pass with no whitespace errors and no public component imports.

---

### Task 5: Create and Submit the 2026-07-28 Pending Draft

**Files:**
- Create: `artifacts/dynamic-beta/morning-brief-2026-07-28-draft.json`

**Interfaces:**
- Consumes: existing schema, catalog, and Task 3 draft POST endpoint.
- Produces: one valid sourced five-event payload and one Redis revision with `status: "pending"`.

- [ ] **Step 1: Research the Taiwan morning information window**

Browse current sources because the facts and publication times are time-sensitive. Cover the prior US session through the Taiwan morning of `2026-07-28`, prioritizing official releases, company investor relations, government/central-bank sources, market operators, and reputable financial media. Search global macro/Fed, rates/inflation, oil/geopolitics/credit, AI/semiconductors, megacap results, and Taiwan supply-chain implications. Record direct URLs and explicit timestamps; leave uncertain times and financial values `null`.

- [ ] **Step 2: Rank five events and add explicit confirmation rules**

Rank by broad-market transmission. Use only catalog-valid series. Every rule must match the written thesis; an event without a meaningful directional proxy uses empty `dataToConfirm` and `confirmationRules`. Permitted shapes include:

```json
[
  { "seriesId": "YAHOO:^VIX", "expectedDirection": "up", "changeType": "percent", "threshold": 5 },
  { "seriesId": "YAHOO:CL=F", "expectedDirection": "up", "changeType": "percent", "threshold": 2 },
  { "seriesId": "YAHOO:2YY=F", "expectedDirection": "up", "changeType": "basis_points", "threshold": 5 },
  { "seriesId": "YAHOO:QQQ", "expectedDirection": "down", "changeType": "percent", "threshold": 1 },
  { "seriesId": "YAHOO:SOXX", "expectedDirection": "down", "changeType": "percent", "threshold": 1.5 },
  { "seriesId": "YAHOO:0050.TW", "expectedDirection": "down", "changeType": "percent", "threshold": 1 }
]
```

These are allowed examples, not inferred defaults.

- [ ] **Step 3: Create and validate the JSON artifact**

Write exactly one top-level brief with `briefDate: "2026-07-28"`, captured ISO `generatedAt`, an allowlisted analyst label, sourced evidence, and exactly five events. Validate without storage:

```bash
node --input-type=module -e 'import fs from "node:fs"; import { validateMorningBriefPayload } from "./src/lib/dynamic-beta/news/schema.js"; const path = "artifacts/dynamic-beta/morning-brief-2026-07-28-draft.json"; const payload = JSON.parse(fs.readFileSync(path, "utf8")); const result = validateMorningBriefPayload(payload, { now: payload.generatedAt }); console.log(JSON.stringify({ valid: result.valid, errors: result.errors, warnings: result.warnings }, null, 2)); if (!result.valid) process.exit(1);'
```

Expected: `valid: true`; every warning is reviewed.

- [ ] **Step 4: Submit to the protected draft endpoint**

With the local server and existing `.env.local` configuration:

```bash
curl --fail-with-body -X POST "http://127.0.0.1:3000/api/dynamic-beta/news/drafts?token=local-admin" -H "Content-Type: application/json" --data-binary @artifacts/dynamic-beta/morning-brief-2026-07-28-draft.json
```

Expected: HTTP 200, `saved: true`, `draft.status: "pending"`, and no approved brief identity. If the local token differs, use the configured value for the invocation without printing it.

- [ ] **Step 5: Prove pending isolation and stop**

Read the draft endpoint and existing approved news endpoint. Confirm only the draft response contains the `2026-07-28` payload. Refresh `/admin/dynamic-beta?token=...`, inspect the five cards, and do not call approval on the user's behalf.

---

### Task 6: Full Verification and Isolation Audit

**Files:**
- Verify all Task 1–5 paths.

**Interfaces:**
- Produces: evidence that the feature is internal, regression-safe, and waiting for human approval.

- [ ] **Step 1: Run all tests, lint, and production build**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests pass, ESLint exits successfully, and Next.js production build completes.

- [ ] **Step 2: Audit imports and public exposure**

Run:

```bash
rg -n "draft-service|draft-repository|DailyMorningBriefDraftPanel" app src | sort
rg -n "dynamic-beta/news/drafts" app src | sort
```

Expected: imports are limited to internal Dynamic Beta API/shared modules and `/admin/dynamic-beta`; no portfolio, holdings, cash, rebalance, recommendation, score, or public component imports draft code.

- [ ] **Step 3: Verify feature flags and approval isolation**

Confirm the draft routes return the existing disabled response when `DYNAMIC_BETA_NEWS_DATA_ENABLED=false`. Restore the current setting, verify the pending draft is visible, and verify every scoring/public flag remains false. Do not alter scoring or public environment values.

- [ ] **Step 4: Run final diff checks without staging**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated user files remain untouched.

- [ ] **Step 5: Report the human handoff**

Report files, Redis key family, internal endpoints, no migration, no new environment variable, verification results, pending revision identity, admin-page location, approval instructions, and proof that no scoring or Dynamic Beta work was performed. State clearly that D1/D3 tracking begins only after the user presses `核准並發布`.
