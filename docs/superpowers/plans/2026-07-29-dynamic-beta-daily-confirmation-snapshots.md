# Dynamic Beta Daily Confirmation Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the existing weekday 07:00 Asia/Taipei run, synchronize FRED/Yahoo and MacroMicro data, then save immutable D1/D3 confirmation snapshots for recent approved morning briefs before continuing the pending-draft workflow.

**Architecture:** Keep browsing outside the application: the existing Codex automation reads the approved MacroMicro chart and passes one strict JSON file to a new server-side daily-pipeline CLI. The CLI reuses the current market sync, MacroMicro ingestion, News Event, and confirmation services, while a focused Redis/Lua repository appends content-addressed confirmation snapshots. The internal Confirmations workspace reads saved snapshots by default and exposes the existing live evaluator only as a clearly separate, non-persisting Preview.

**Tech Stack:** Next.js 16 App Router, Node.js ESM, `node:test`, React 19, Upstash Redis, existing Redis Lua helper, existing local Codex weekday automation.

## Global Constraints

- The only schedule is the existing Codex automation `jj-invest-2`, Monday through Friday at exactly 07:00 Asia/Taipei.
- Do not calculate Dynamic Beta, Market Risk Score, or Crash Risk Score.
- Do not change Target Beta, tolerance bands, holdings, cash, rebalancing, trading advice, draft approval state, or public UI.
- Do not add a data vendor, npm dependency, relational table, database migration, public route, or environment variable.
- Require `DYNAMIC_BETA_DATA_ENABLED=true` and `DYNAMIC_BETA_NEWS_DATA_ENABLED=true`; keep `DYNAMIC_BETA_SCORING_ENABLED=false`, `DYNAMIC_BETA_PUBLIC_ENABLED=false`, and the News scoring/public flags false.
- Keep `FRED_API_KEY` server-side for FRED synchronization; introduce no new environment variable.
- Keep API keys, Redis credentials, payload contents, raw source HTML, arbitrary exception messages, and environment values out of CLI/API output and logs.
- Treat saved market history as `vintageMode: "latest_stored_revision_by_observation_date"` and `truePointInTime: false`; never label it as a true point-in-time vintage backtest.
- Preserve every earlier snapshot payload. Identical same-day content is `unchanged`; changed same-day content appends an immutable revision.
- Snapshot live verification may create snapshot records only; it must not approve, reject, publish, score, rebalance, or modify user portfolio data.

## File Map

**Create:**

- `src/lib/dynamic-beta/news/confirmation-snapshot.js` — canonical snapshot content, completion rules, stable content hash, and safe stored-record parsing.
- `src/lib/dynamic-beta/news/confirmation-snapshot-repository.js` — dedicated Redis key ownership and immutable snapshot reads/writes.
- `src/lib/dynamic-beta/news/confirmation-snapshot-service.js` — inclusive ten-calendar-day lookback selection, exact brief-revision evaluation, completion skip, and per-brief failure isolation.
- `src/lib/dynamic-beta/daily-pipeline.js` — sequential automatic sync, MacroMicro ingestion, and snapshot orchestration with safe stage summaries.
- `src/lib/dynamic-beta/daily-pipeline-submission.js` — strict file/flag/service boundary for the executable.
- `scripts/dynamic-beta-daily-pipeline.js` — one-argument JSON CLI with sanitized stdout/stderr.
- `app/api/dynamic-beta/news/confirmation-snapshots/route.js` — protected, read-only saved-snapshot endpoint.
- `tests/dynamic-beta-news-confirmation-snapshot.test.js` — snapshot model and selection/service tests.
- `tests/dynamic-beta-news-confirmation-snapshot-repository.test.js` — Redis/Lua idempotency, concurrency, and retry tests.
- `tests/dynamic-beta-daily-pipeline.test.js` — stage isolation, flags, CLI, scheduling contract, and import-boundary tests.

**Modify:**

- `src/lib/dynamic-beta/repository.js` — expose stored observation revision and retrieval metadata in history rows.
- `src/lib/dynamic-beta/news/redis-atomic.js` — add the one atomic snapshot append script.
- `app/api/dynamic-beta/_shared.js` — configured snapshot repository/service factories.
- `src/lib/dynamic-beta/news/confirmation-admin-state.js` — saved-snapshot query/controller plus separately named live Preview query/controller.
- `app/admin/dynamic-beta/ConfirmationAdminSection.js` — saved snapshot default, metadata/completion display, manual Preview action.
- `app/admin/dynamic-beta/TodayWorkspaceSection.js` — load the latest saved snapshot summary instead of calculating live confirmation on page load.
- `tests/dynamic-beta.test.js` — repository history metadata regression.
- `tests/dynamic-beta-news-lua.test.js` — production Lua execution boundary.
- `tests/dynamic-beta-routes.test.js` — snapshot route auth, flags, exact selection, and safe errors.
- `tests/dynamic-beta-confirmation-admin-section.test.js` — saved/default and Preview/manual behavior.
- `tests/dynamic-beta-today-workspace.test.js` — saved snapshot endpoint wiring.
- `package.json` — add `market-data:daily-pipeline`.
- `vercel.json` — remove only the competing Vercel cron declaration.
- `docs/automations/dynamic-beta-daily-morning-brief.md` — replace the standalone MacroMicro command with the combined pipeline command and define required continuation order.
- Existing Codex automation `jj-invest-2` — update in place after automated verification; do not create another automation.

---

### Task 1: Preserve market observation revision identity in confirmation inputs

**Files:**
- Modify: `src/lib/dynamic-beta/repository.js`
- Modify: `tests/dynamic-beta.test.js`
- Modify: `tests/dynamic-beta-news-confirmation.test.js`

**Interfaces:**
- Preserves `readObservationHistory(seriesId, { from, to })`.
- Extends each returned row with `revisionId`, `firstSeenAt`, `lastSeenAt`, `sourceRealtimeStart`, and `sourceRealtimeEnd` while retaining the current fields.
- The existing confirmation evaluator continues copying the complete observation object into `baseline`, `d1.observation`, and `d3.observation`.

- [ ] **Step 1: Write the failing repository metadata assertion**

Change the expected rows in the existing bounded-history test to include the stored immutable identity:

```js
assert.deepEqual({ ...history[0], revisionId: "checked-separately" }, {
  revisionId: "checked-separately",
  observationDate: "2026-07-15",
  value: 4.2,
  releasedAt: null,
  retrievedAt: "2026-07-16T00:00:00.000Z",
  firstSeenAt: "2026-07-16T00:00:00.000Z",
  lastSeenAt: "2026-07-16T00:00:00.000Z",
  sourceRealtimeStart: "2026-07-16",
  sourceRealtimeEnd: "2026-07-16",
});
assert.match(history[0].revisionId, /^[a-f0-9]{24}$/);
```

Add a confirmation-service assertion that a history row containing `revisionId: "obs_dgs10_r3"` and `retrievedAt` survives unchanged in the returned D3 observation.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test tests/dynamic-beta.test.js tests/dynamic-beta-news-confirmation.test.js
```

Expected: FAIL because history currently drops revision and first/last-seen metadata.

- [ ] **Step 3: Return the complete safe history row**

Replace the final history mapping with:

```js
return observations.filter(Boolean).map((observation) => ({
  revisionId: observation.revision_id || null,
  observationDate: observation.observation_date,
  value: Number(observation.value),
  releasedAt: observation.released_at || null,
  retrievedAt: observation.retrieved_at || null,
  firstSeenAt: observation.first_seen_at || observation.retrieved_at || null,
  lastSeenAt: observation.last_seen_at || observation.retrieved_at || null,
  sourceRealtimeStart: observation.source_realtime_start || null,
  sourceRealtimeEnd: observation.source_realtime_end || null,
}));
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS with no change to observation selection or confirmation statuses.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/dynamic-beta/repository.js tests/dynamic-beta.test.js tests/dynamic-beta-news-confirmation.test.js
git commit -m "feat: preserve confirmation observation identity"
```

---

### Task 2: Build canonical immutable confirmation snapshots

**Files:**
- Create: `src/lib/dynamic-beta/news/confirmation-snapshot.js`
- Create: `tests/dynamic-beta-news-confirmation-snapshot.test.js`

**Interfaces:**
- Produces `buildConfirmationSnapshot({ evaluation, createdAt })`.
- Produces `confirmationSnapshotId(content)` using SHA-256 truncated to 24 hexadecimal characters and prefixed with `ncs_`.
- Produces `isConfirmationSnapshotComplete(snapshot)`.
- Produces `parseStoredConfirmationSnapshot(record)` and returns `null` for missing, malformed, or uncommitted records.
- The canonical hash excludes `evaluatedAt`, `createdAt`, and `snapshotRevisionNumber` but includes exact brief identity, `asOf`, metadata, completion, events, rules, and observation metadata.

- [ ] **Step 1: Write failing completion tests**

Use small evaluation fixtures and assert:

```js
assert.deepEqual(
  buildConfirmationSnapshot({
    evaluation: awaitingD3Evaluation,
    createdAt: "2026-07-29T23:00:10.000Z",
  }).completion,
  {
    complete: false,
    pendingReasons: [{
      eventRank: 1,
      seriesId: "YAHOO:QQQ",
      reason: "awaiting_observation",
    }],
  },
);
```

Add separate fixtures proving that these do not block completion:

```js
{ expectedDirection: null, d3: { observation: null, reason: "not_configured" } }
{ expectedDirection: "down", d3: { observation: null, reason: "unknown_series" } }
{ expectedDirection: "up", d3: { observation: null, reason: "unsupported_frequency" } }
{ expectedDirection: "up", d3: { observation: d3Row, reason: "invalid_baseline" } }
```

Also assert that `missing_observation`, `missing_baseline`, and `awaiting_observation` without a D3 observation remain pending.

- [ ] **Step 2: Run the new model test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news-confirmation-snapshot.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement explicit terminal/pending classification**

Use the following rule, without inferring a D3 value:

```js
const TERMINAL_MISSING_REASONS = new Set([
  "not_configured",
  "unknown_series",
  "unsupported_frequency",
]);

function pendingReason(rule) {
  if (rule?.expectedDirection === null) return null;
  if (rule?.d3?.observation) return null;
  if (TERMINAL_MISSING_REASONS.has(rule?.d3?.reason)) return null;
  return rule?.d3?.reason || "missing_observation";
}
```

Walk all `evaluation.events[].rules[]`, collect stable `{ eventRank, seriesId, reason }` objects, and set `complete` only when the list is empty. An event with no rules is terminal.

- [ ] **Step 4: Write failing identity and normalization tests**

Assert all of the following:

```js
assert.equal(first.snapshotId, second.snapshotId); // only evaluatedAt/createdAt differ
assert.notEqual(first.snapshotId, changedObservation.snapshotId);
assert.equal(first.metadata.vintageMode, "latest_stored_revision_by_observation_date");
assert.equal(first.metadata.truePointInTime, false);
assert.equal(first.events[0].rules[0].d3.observation.revisionId, "obs_qqq_r7");
assert.equal(first.events[0].rules[0].d3.observation.retrievedAt,
  "2026-07-29T20:05:00.000Z");
```

Assert `parseStoredConfirmationSnapshot({ payload, committed: "0" })` and malformed JSON return `null`, while a record with `committed: "1"` returns the parsed object.

- [ ] **Step 5: Implement stable content construction and hash**

Construct the content object in a fixed property order:

```js
const content = {
  briefDate: evaluation.briefDate,
  revisionId: evaluation.revisionId,
  revisionNumber: evaluation.revisionNumber,
  asOf: evaluation.asOf,
  metadata: {
    vintageMode: "latest_stored_revision_by_observation_date",
    truePointInTime: false,
  },
  completion,
  events: normalizeEvents(evaluation.events),
};
```

Return:

```js
{
  snapshotId: confirmationSnapshotId(content),
  snapshotRevisionNumber: null,
  ...content,
  evaluatedAt: evaluation.evaluatedAt,
  createdAt,
}
```

Normalization must retain only declared scalar/result/observation properties, convert absent optional values to `null`, and reject a non-date `asOf`, invalid `createdAt`, or identity mismatch with a stable `ConfirmationSnapshotError` code.

- [ ] **Step 6: Run the model tests and verify GREEN**

Run `node --test tests/dynamic-beta-news-confirmation-snapshot.test.js`. Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/lib/dynamic-beta/news/confirmation-snapshot.js tests/dynamic-beta-news-confirmation-snapshot.test.js
git commit -m "feat: model immutable confirmation snapshots"
```

---

### Task 3: Append snapshots atomically in Redis

**Files:**
- Modify: `src/lib/dynamic-beta/news/redis-atomic.js`
- Create: `src/lib/dynamic-beta/news/confirmation-snapshot-repository.js`
- Create: `tests/dynamic-beta-news-confirmation-snapshot-repository.test.js`
- Modify: `tests/dynamic-beta-news-lua.test.js`

**Interfaces:**
- Exports `SAVE_CONFIRMATION_SNAPSHOT_SCRIPT` from `redis-atomic.js`.
- Exports `createConfirmationSnapshotRepository(redis)` with exactly:
  - `saveSnapshot(snapshot)`
  - `readLatestSnapshot({ briefDate, revisionId, asOf? })`
  - `readSnapshotRevisions({ briefDate, revisionId, asOf })`
  - `readRecentLatestSnapshots({ since, until, limit })`
- Uses key prefix `jj-invest-public:dynamic-beta:news:v1:confirmation-snapshot`.
- `saveSnapshot` returns `{ status, snapshotId, snapshotRevisionNumber }`, where status is `inserted`, `revised`, or `unchanged`.

- [ ] **Step 1: Write failing repository behavior tests**

With `FakeRedis`, assert:

```js
assert.deepEqual(await repository.saveSnapshot(snapshot), {
  status: "inserted",
  snapshotId: snapshot.snapshotId,
  snapshotRevisionNumber: 1,
});
assert.deepEqual(await repository.saveSnapshot(snapshot), {
  status: "unchanged",
  snapshotId: snapshot.snapshotId,
  snapshotRevisionNumber: 1,
});
assert.equal((await repository.readSnapshotRevisions(identity)).length, 1);
```

Save changed content with the same brief revision and `asOf`; assert revision number 2, the latest pointer returns revision 2, and revision 1 remains readable. Save the same brief on the next `asOf`; assert that its revision counter starts at 1 for that date.

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news-confirmation-snapshot-repository.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the Redis key boundary and strict reads**

Use these six key families per scope:

```text
...:revision:<briefDate>:<briefRevisionId>:<asOf>:<snapshotId>
...:revisions:<briefDate>:<briefRevisionId>:<asOf>
...:latest:<briefDate>:<briefRevisionId>:<asOf>
...:revision-count:<briefDate>:<briefRevisionId>:<asOf>
...:dates:<briefDate>:<briefRevisionId>
...:timeline
```

The latest key is a hash with `snapshotId` and `snapshotRevisionNumber`; this prevents a retry of an older write from replacing a newer pointer. The timeline member is `${briefDate}:${revisionId}:${asOf}` and its score is the UTC midnight score of `asOf`. `readRecentLatestSnapshots` reads timeline members in descending order, resolves their latest hashes, ignores `committed !== "1"`, and applies `limit` after filtering.

When `readLatestSnapshot` receives `asOf`, resolve that exact date's latest hash. When `asOf` is omitted, read the per-brief dates set in reverse order and return the first committed latest record. `readSnapshotRevisions` reads every snapshot ID in ascending revision-number order and filters uncommitted records. Validate all date keys and require both `briefDate` and `revisionId` before performing Redis reads.

- [ ] **Step 4: Add the atomic Lua append operation**

The script marker is `-- jj-news-confirmation-snapshot-save-v1`. Its ordered behavior is:

```lua
local payload = redis.call("HGET", KEYS[1], "payload")
local wasCommitted = redis.call("HGET", KEYS[1], "committed") == "1"
local revisionNumber
if payload then
  revisionNumber = tonumber(redis.call("HGET", KEYS[1], "snapshotRevisionNumber"))
else
  local count = tonumber(redis.call("GET", KEYS[4]))
  if not count then count = redis.call("ZCARD", KEYS[2]) end
  revisionNumber = count + 1
  local snapshot = cjson.decode(ARGV[4])
  snapshot["snapshotRevisionNumber"] = revisionNumber
  redis.call("HSET", KEYS[1],
    "payload", cjson.encode(snapshot),
    "snapshotRevisionNumber", tostring(revisionNumber),
    "committed", "0")
  redis.call("SET", KEYS[4], tostring(revisionNumber))
end
redis.call("ZADD", KEYS[2], revisionNumber, ARGV[1])
redis.call("ZADD", KEYS[5], ARGV[2], ARGV[3])
redis.call("ZADD", KEYS[6], ARGV[2], ARGV[5])
local latestNumber = tonumber(redis.call("HGET", KEYS[3], "snapshotRevisionNumber")) or 0
if revisionNumber >= latestNumber then
  redis.call("HSET", KEYS[3],
    "snapshotId", ARGV[1],
    "snapshotRevisionNumber", tostring(revisionNumber))
end
redis.call("HSET", KEYS[1], "committed", "1")
local status = "inserted"
if wasCommitted then status = "unchanged"
elseif revisionNumber > 1 then status = "revised" end
return {status, ARGV[1], tostring(revisionNumber)}
```

Pass `snapshotId`, `asOfScore`, `asOf`, serialized snapshot, and timeline member as arguments. All index and pointer operations must complete before `committed` becomes `"1"`; the final commit-marker HSET is deliberately last. A retry of an uncommitted payload reuses its allocated revision number but returns `inserted` or `revised` after the first successful commit, while a previously committed identical payload returns `unchanged`. Validate the three returned fields before returning success.

- [ ] **Step 5: Add Lua execution and failure-retry tests**

In `dynamic-beta-news-lua.test.js`, execute the production script through `runRedisScript` and assert all six keys are updated. Mutate one HSET field/value pair and assert the fake runtime rejects it.

In the repository test:

```js
redis.failNextEval("jj-news-confirmation-snapshot-save-v1");
await assert.rejects(repository.saveSnapshot(snapshot), /forced/);
assert.equal(await repository.readLatestSnapshot(identity), null);
assert.equal((await repository.saveSnapshot(snapshot)).status, "inserted");
```

Also inject a real Lua runtime error after record allocation but before the commit marker by pre-seeding the timeline key with the wrong Redis type. Assert `saveSnapshot` rejects, all repository reads ignore the uncommitted record, clearing the bad key and retrying returns `inserted`, and the same subsequent retry returns `unchanged`. Call two different same-day snapshots concurrently with `Promise.all`; assert revision numbers are `{1, 2}`, both payloads exist, and latest is revision 2.

Add real-client compatibility fixtures where `hgetall` returns `committed: 1`, an already-deserialized payload object, and numeric `snapshotRevisionNumber`. Assert exact, history, and recent reads accept these Upstash automatic-deserialization shapes without weakening structural or content-hash validation.

- [ ] **Step 6: Run repository and Lua tests and verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-news-confirmation-snapshot-repository.test.js tests/dynamic-beta-news-lua.test.js
```

Expected: PASS, including immutable revision 1 after revision 2 is written.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/lib/dynamic-beta/news/redis-atomic.js src/lib/dynamic-beta/news/confirmation-snapshot-repository.js tests/dynamic-beta-news-confirmation-snapshot-repository.test.js tests/dynamic-beta-news-lua.test.js
git commit -m "feat: persist confirmation snapshots atomically"
```

---

### Task 4: Select and snapshot recent approved brief revisions

**Files:**
- Create: `src/lib/dynamic-beta/news/confirmation-snapshot-service.js`
- Modify: `tests/dynamic-beta-news-confirmation-snapshot.test.js`

**Interfaces:**
- Exports `createConfirmationSnapshotService({ newsRepository, confirmationService, snapshotRepository, now, logger })`.
- Exposes `run({ asOf, lookbackDays: 10 })` and `evaluateAndSave({ briefDate, revisionId, asOf })`.
- `run` returns only fixed fields: `status`, `selected`, `skippedComplete`, `inserted`, `revised`, `unchanged`, `failed`, and per-brief safe results.
- Selection uses exact published `briefDate` plus `revisionId`; it never silently switches to the current revision.

- [ ] **Step 1: Write failing selection tests**

Seed `readRecentBriefs({ limit: 200 })` with revisions dated 2026-07-18 through 2026-07-29 and call:

```js
const result = await service.run({ asOf: "2026-07-29", lookbackDays: 10 });
```

Assert 2026-07-19 through 2026-07-29 are eligible, 2026-07-18 is excluded, two revisions for 2026-07-27 are evaluated independently, and every evaluator call includes its exact revision ID.

Use only `newsRepository.readRecentBriefs`; do not consult the pending/rejected draft repository. In the existing architecture these stored News Event brief revisions are the publication outputs of the approval flow, while pending and rejected drafts remain in the separate draft repository.

Seed an older complete snapshot for one exact revision and an incomplete snapshot for another. Assert the complete revision is skipped and the incomplete revision is evaluated again.

- [ ] **Step 2: Run the service test and verify RED**

Run `node --test tests/dynamic-beta-news-confirmation-snapshot.test.js`.

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement exact selection and one-brief save**

`evaluateAndSave` must perform these calls in order:

```js
const evaluation = await confirmationService.evaluate({
  briefDate,
  revisionId,
  asOf,
});
if (evaluation.briefDate !== briefDate || evaluation.revisionId !== revisionId) {
  throw snapshotServiceError("IDENTITY_MISMATCH");
}
const snapshot = buildConfirmationSnapshot({
  evaluation,
  createdAt: now().toISOString(),
});
const saved = await snapshotRepository.saveSnapshot(snapshot);
return { ...saved, complete: snapshot.completion.complete };
```

Validate `asOf`, require integer `lookbackDays` from 0 through 30, compute `since` by UTC date arithmetic, and filter `briefDate >= since && briefDate <= asOf`. Sort oldest date first, then ascending `revisionNumber`, so daily results are deterministic.

- [ ] **Step 4: Write failing completion-skip and isolation tests**

Assert:

- an incomplete saved snapshot is re-evaluated and may become complete;
- a complete latest snapshot is never evaluated again;
- one evaluator failure records `{ status: "error", code: "EVALUATION_FAILED" }` and later briefs still save;
- no thrown message containing `FRED_API_KEY=secret` appears in returned results or logger arguments;
- no snapshot write occurs when the evaluator returns a mismatched brief identity.

- [ ] **Step 5: Implement per-brief safe results and overall status**

Use fixed per-brief codes only. `status` is `success` when `failed === 0`, `partial` when at least one item succeeds or is skipped and at least one fails, and `error` when every selected item fails. With no eligible items, return `success` and zero counts.

- [ ] **Step 6: Run snapshot model/service tests and verify GREEN**

Run `node --test tests/dynamic-beta-news-confirmation-snapshot.test.js`. Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/lib/dynamic-beta/news/confirmation-snapshot-service.js tests/dynamic-beta-news-confirmation-snapshot.test.js
git commit -m "feat: snapshot recent brief confirmations"
```

---

### Task 5: Add the protected saved-snapshot API

**Files:**
- Modify: `app/api/dynamic-beta/_shared.js`
- Create: `app/api/dynamic-beta/news/confirmation-snapshots/route.js`
- Modify: `tests/dynamic-beta-routes.test.js`

**Interfaces:**
- Adds `getDynamicBetaConfirmationSnapshotRepository()`.
- Adds `createConfiguredConfirmationSnapshotService()` for the CLI.
- Adds admin-only `GET /api/dynamic-beta/news/confirmation-snapshots`.
- Query behavior:
  - no filters: latest saved snapshot;
  - `briefDate` only: current published revision for that date, latest saved snapshot;
  - `briefDate` plus `revisionId`: exact revision, latest saved snapshot;
  - optional `asOf`: exact saved date for the resolved revision;
  - `revisionId` without `briefDate`: 400.

- [ ] **Step 1: Write failing route-order and selection tests**

Add route tests proving this exact order:

```js
authorizeDynamicBetaRequest(request)
requireDynamicBetaDataEnabled()
requireDynamicBetaNewsDataEnabled()
construct Redis repositories
```

Assert unauthorized requests return 401 without reading flags or Redis; disabled data/news returns 404 without repository construction; missing Redis returns 503; invalid dates and unscoped revision IDs return 400; missing saved snapshot returns 404.

Add success cases for default latest, date-current-revision, and exact revision/asOf. Assert the JSON contains `snapshotId`, `snapshotRevisionNumber`, `completion`, `metadata`, and `events` unchanged.

- [ ] **Step 2: Run route tests and verify RED**

Run:

```bash
node --test tests/dynamic-beta-routes.test.js
```

Expected: FAIL because the route and factories do not exist.

- [ ] **Step 3: Add configured factories**

In `_shared.js`, construct the snapshot repository from the existing `getRedis()`. Build the snapshot service with the existing News repository and live confirmation service; return `null` when any required repository is unavailable.

- [ ] **Step 4: Implement the read-only route**

Resolve a date-only request using:

```js
const brief = await newsRepository.readMorningBrief({ briefDate });
if (!brief) return Response.json({ error: "找不到指定的 morning brief。" }, { status: 404 });
const snapshot = await snapshotRepository.readLatestSnapshot({
  briefDate,
  revisionId: brief.revisionId,
  asOf: asOf || undefined,
});
```

For no `briefDate`, call `readRecentLatestSnapshots({ since: "1900-01-01", until: asOf || "9999-12-31", limit: 1 })`. Never invoke `confirmationService.evaluate` in this route. Catch unknown errors and return only `Confirmation snapshot 讀取失敗。`.

- [ ] **Step 5: Run route tests and verify GREEN**

Run `node --test tests/dynamic-beta-routes.test.js`. Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add app/api/dynamic-beta/_shared.js app/api/dynamic-beta/news/confirmation-snapshots/route.js tests/dynamic-beta-routes.test.js
git commit -m "feat: expose saved confirmation snapshots internally"
```

---

### Task 6: Build the failure-isolated daily pipeline CLI

**Files:**
- Create: `src/lib/dynamic-beta/daily-pipeline.js`
- Create: `src/lib/dynamic-beta/daily-pipeline-submission.js`
- Create: `scripts/dynamic-beta-daily-pipeline.js`
- Modify: `package.json`
- Create: `tests/dynamic-beta-daily-pipeline.test.js`

**Interfaces:**
- `createDynamicBetaDailyPipeline({ syncService, macroMicroService, snapshotService, logger }).run({ macroMicroPayload, asOf })`.
- `submitDynamicBetaDailyPipelineFile({ inputPath, readFile, environment, getPipeline, now })` validates the one file and required flags, derives Asia/Taipei `asOf`, and returns a safe summary.
- `runDynamicBetaDailyPipeline(...)` accepts exactly one path, writes one JSON line, and returns exit code 0 for overall `success` or `partial`; fatal boundary failures return exit code 1.
- Adds package script:

```json
"market-data:daily-pipeline": "node --env-file=.env.local scripts/dynamic-beta-daily-pipeline.js"
```

- [ ] **Step 1: Write failing sequential-stage tests**

Use call-order spies and assert:

```js
assert.deepEqual(calls, [
  "automatic-sync",
  "macromicro-ingest",
  "confirmation-snapshots",
]);
```

Assert the MacroMicro payload reaches only its service, `asOf` reaches the snapshot service, and automatic sync result series never includes `MACROMICRO:TAIEX_MARGIN_MAINTENANCE`.

- [ ] **Step 2: Run the pipeline test and verify RED**

Run `node --test tests/dynamic-beta-daily-pipeline.test.js`.

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement fixed stage summaries and continuation**

Every returned stage has only:

```js
{ name, status, code, counts }
```

where `status` is one of `success`, `partial`, `error`, or `skipped_locked`; `code` is null or a fixed internal code; and `counts` contains non-negative integers only. Map errors containing the existing exact lock-contention sentence to `skipped_locked`; map all other exceptions to fixed codes without copying `.message`.

Always attempt all three stages in sequence. Overall status is `success` only when all stages succeed, otherwise `partial`; stage failure is not a fatal CLI failure.

- [ ] **Step 4: Write failing isolation and sanitization tests**

Cover:

- automatic sync returns partial and MacroMicro/snapshot still run;
- automatic lock contention is `skipped_locked` and later stages run;
- MacroMicro fixed source failure is `error` and snapshots still run from stored data;
- MacroMicro lock contention is `skipped_locked`;
- snapshot service error does not remove earlier successful stage summaries;
- a thrown message containing FRED key, Redis token, source payload, or HTML appears in neither stdout, stderr, return value, nor logger arguments.

- [ ] **Step 5: Implement strict file/feature/service boundary**

Reject with stable codes:

```text
INPUT_REQUIRED
INPUT_READ_FAILED
INVALID_JSON
DATA_DISABLED
NEWS_DATA_DISABLED
SERVICE_UNCONFIGURED
INVALID_DATE
```

Check both data flags before constructing services. Do not require `FRED_API_KEY` at the boundary: the existing sync service isolates affected FRED series and may still update Yahoo data. Derive the date with `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })`.

- [ ] **Step 6: Write and implement CLI tests**

Assert zero arguments and two arguments fail before reading a file. Assert valid `success` and `partial` outputs exit 0 and write only to stdout. Assert every fatal known error exits 1 and writes only this shape to stderr:

```js
{ ok: false, code: "INVALID_JSON", error: "Daily pipeline JSON 格式無效。" }
```

Assert unknown thrown errors become `PIPELINE_FAILED` with a fixed message. Test direct-execution guarding through `pathToFileURL` as in the existing MacroMicro CLI.

- [ ] **Step 7: Construct production services in the executable**

Build the pipeline lazily from existing `_shared.js` factories:

```js
const repository = getDynamicBetaRepository();
const syncService = repository ? createConfiguredSyncService(repository) : null;
const macroMicroService = createConfiguredMacroMicroIngestionService(repository);
const snapshotService = createConfiguredConfirmationSnapshotService();
```

Return `null` unless all three are configured. The executable must not start Next.js and must not print environment values.

- [ ] **Step 8: Run pipeline tests and verify GREEN**

Run `node --test tests/dynamic-beta-daily-pipeline.test.js`. Expected: PASS.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/lib/dynamic-beta/daily-pipeline.js src/lib/dynamic-beta/daily-pipeline-submission.js scripts/dynamic-beta-daily-pipeline.js package.json tests/dynamic-beta-daily-pipeline.test.js
git commit -m "feat: add daily market confirmation pipeline"
```

---

### Task 7: Make saved snapshots the internal UI default and Preview explicit

**Files:**
- Modify: `src/lib/dynamic-beta/news/confirmation-admin-state.js`
- Modify: `app/admin/dynamic-beta/ConfirmationAdminSection.js`
- Modify: `app/admin/dynamic-beta/TodayWorkspaceSection.js`
- Modify: `tests/dynamic-beta-confirmation-admin-section.test.js`
- Modify: `tests/dynamic-beta-today-workspace.test.js`

**Interfaces:**
- Adds `confirmationSnapshotQuery({ token, briefDate, revisionId, asOf })` targeting `/confirmation-snapshots`.
- Renames the current live URL builder to `confirmationPreviewQuery(...)` while retaining the same `/confirmations` endpoint.
- Adds `createConfirmationSnapshotAdminController({ fetchImpl })` and `createConfirmationPreviewAdminController({ fetchImpl })`.
- Saved snapshot is loaded on mount; Preview runs only after the explicit Preview button.

- [ ] **Step 1: Write failing state/controller tests**

Assert exact URLs:

```js
confirmationSnapshotQuery({ token: "admin token" })
// /api/dynamic-beta/news/confirmation-snapshots?token=admin+token

confirmationPreviewQuery({
  token: "admin token",
  briefDate: "2026-07-29",
  revisionId: "nbr exact",
  asOf: "2026-07-30",
})
// /api/dynamic-beta/news/confirmations?token=admin+token&asOf=2026-07-30&briefDate=2026-07-29&revisionId=nbr+exact
```

Saved-controller validation must require `snapshotId`, integer `snapshotRevisionNumber`, `completion.complete`, metadata, and events. Preview validation retains the current live result shape.

- [ ] **Step 2: Write failing component behavior tests**

On mount, assert exactly one request to `/confirmation-snapshots` and zero requests to `/confirmations`. The rendered saved result must include:

```text
07:00 已保存快照
Snapshot revision #2
追蹤中
資料採各 observation date 最新儲存 revision，並非完整 point-in-time vintage
```

After clicking `計算即時 Preview`, assert one live request, a visible `即時 Preview（不會保存）` label, and no POST/PUT/PATCH request. Verify separate stale/error state so a failed Preview does not erase a successfully loaded saved snapshot.

- [ ] **Step 3: Implement two independent result states**

Keep one reducer state for saved data and a second for Preview. Default filters are blank for the latest saved snapshot. When Preview is requested without `asOf`, fill it with the current Asia/Taipei date immediately before the request. Display saved `createdAt`, `evaluatedAt`, `asOf`, snapshot revision, and completion/pending reasons above the existing `ConfirmationSummary` and event details.

- [ ] **Step 4: Switch Today workspace to saved summary**

Change only its confirmation URL to `confirmationSnapshotQuery({ token })`. Keep independent loading/error behavior and the shortcut to `section=confirmations`. Update its empty state to `目前沒有已保存的 D1／D3 快照。` and never call the live endpoint during page load.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-confirmation-admin-section.test.js tests/dynamic-beta-today-workspace.test.js
```

Expected: PASS; saved snapshot reads are default, Preview is manual and side-effect free.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/lib/dynamic-beta/news/confirmation-admin-state.js app/admin/dynamic-beta/ConfirmationAdminSection.js app/admin/dynamic-beta/TodayWorkspaceSection.js tests/dynamic-beta-confirmation-admin-section.test.js tests/dynamic-beta-today-workspace.test.js
git commit -m "feat: show saved confirmation snapshots in admin"
```

---

### Task 8: Consolidate scheduling into the existing 07:00 automation

**Files:**
- Modify: `vercel.json`
- Modify: `docs/automations/dynamic-beta-daily-morning-brief.md`
- Modify: `tests/dynamic-beta-daily-pipeline.test.js`
- Update external state: existing Codex automation `jj-invest-2`

**Interfaces:**
- `vercel.json` retains only its schema declaration; `/api/dynamic-beta/cron` remains in the repository and protected by `CRON_SECRET`.
- The automation invokes:

```bash
node --env-file=.env.local scripts/dynamic-beta-daily-pipeline.js <macromicro-json-file>
```

- The automation continues news research and pending-draft submission after any pipeline exit status.

- [ ] **Step 1: Write failing runtime schedule-configuration tests**

Read `vercel.json` and `package.json` as runtime configuration. Assert:

```js
assert.equal("crons" in vercelConfig, false);
assert.equal(packageJson.scripts["market-data:daily-pipeline"],
  "node --env-file=.env.local scripts/dynamic-beta-daily-pipeline.js");
```

Do not add tests that grep human documentation or production source text. The automation document is reviewed manually in Step 4, and import isolation is verified by the behavioral regressions and final code review in Task 9 for these production modules:

```text
src/lib/portfolio.js
src/lib/cash.js
src/lib/operation-rebalance.js
src/lib/rebalance-apply.js
src/lib/advice-summary.js
src/lib/beta-summary.js
src/lib/beta-rail.js
```

- [ ] **Step 2: Run the contract test and verify RED**

Run `node --test tests/dynamic-beta-daily-pipeline.test.js`.

Expected: FAIL because Vercel still contains the 13:00 schedule.

- [ ] **Step 3: Remove only the competing Vercel schedule**

Set `vercel.json` to:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json"
}
```

Do not delete or weaken `app/api/dynamic-beta/cron/route.js`.

- [ ] **Step 4: Update the checked-in automation contract**

Keep the exact MacroMicro success/failure JSON rules, then replace its command with the daily pipeline CLI. Explicitly order:

```text
MacroMicro browser extraction
→ combined daily pipeline
→ news research/ranking
→ pending morning-brief draft submission
```

State that pipeline success, partial, fatal failure, or lock skip never authorizes approval/publication and must not stop the draft stage.

Review the rendered diff manually against this exact order instead of adding a source-text assertion.

- [ ] **Step 5: Run the contract test and verify GREEN**

Run `node --test tests/dynamic-beta-daily-pipeline.test.js`. Expected: PASS.

- [ ] **Step 6: Commit repository scheduling changes**

```bash
git add vercel.json docs/automations/dynamic-beta-daily-morning-brief.md tests/dynamic-beta-daily-pipeline.test.js
git commit -m "chore: consolidate dynamic beta daily schedule"
```

- [ ] **Step 7: Update `jj-invest-2` in place**

Use the Codex automation update capability to inspect `jj-invest-2`, preserve its ID and enabled state, set the recurrence explicitly to weekdays at 07:00 Asia/Taipei, and replace its instructions with the checked-in contract. Verify the automation list contains one matching workflow and no duplicate was created.

- [ ] **Step 8: Record safe automation evidence**

Record only automation ID, enabled state, timezone, recurrence, and next-run time in the implementation handoff. Do not copy secrets, environment values, or the MacroMicro payload into logs or commits.

---

### Task 9: Full verification and inserted-then-unchanged live smoke

**Files:**
- No production edits expected.
- Snapshot records may be appended to configured Redis only for the approved 2026-07-29 brief.

**Interfaces:**
- Uses the real CLI with `.env.local` server-side.
- Uses the approved MacroMicro URL and an exact temporary JSON file outside the repository.
- Verifies the admin saved view and separate Preview.

- [ ] **Step 1: Run all automated verification**

Run in this order:

```bash
node --test
pnpm lint
pnpm build
git diff --check
```

Expected: all tests PASS, lint exits 0, production build exits 0, and diff check prints nothing.

- [ ] **Step 2: Verify feature gates before live writes**

Without printing values, verify data and News Data are enabled and both scoring/public flags remain disabled. If scoring or public is enabled, stop the smoke test and report the configuration conflict.

- [ ] **Step 3: Create one exact temporary MacroMicro payload**

Open only:

```text
https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin
```

Read the labeled latest date and value. Write either the exact success payload or one approved fixed failure payload to a system temporary file; do not place it in the repository.

- [ ] **Step 4: Run the first live pipeline smoke**

Run with the workspace-provided Node runtime:

```bash
node --env-file=.env.local scripts/dynamic-beta-daily-pipeline.js <absolute-temp-json-path>
```

Expected: exit 0 with `ok: true`; snapshot results include the exact approved 2026-07-29 morning-brief revision and status `inserted` or `revised`. Confirm the saved record has `asOf` equal to the current Asia/Taipei date and includes observation revision IDs where observations exist.

- [ ] **Step 5: Rerun identical input and verify idempotency**

Run the identical command again. Expected: the same snapshot ID, status `unchanged`, unchanged snapshot revision count, and no mutation to the approved brief or draft lifecycle.

- [ ] **Step 6: Verify both admin modes**

Open:

```text
http://localhost:3000/admin/dynamic-beta?token=local-admin&section=confirmations
```

Verify the saved 07:00 snapshot appears by default with completion state and snapshot revision. Click the manual Preview only if needed; verify it is labeled non-persisting and does not change the saved snapshot count.

- [ ] **Step 7: Re-run critical formal behavior regressions**

Run:

```bash
node --test tests/beta-summary.test.js tests/cash.test.js tests/portfolio.test.js tests/operation-rebalance.test.js tests/advice-summary.test.js tests/dynamic-beta-score.test.js
```

Expected: PASS, proving the new pipeline is not imported into existing beta, cash, portfolio, rebalancing, advice, or scoring paths.

Also run the daily pipeline CLI once with an intentionally invalid temporary JSON file, confirm it returns a sanitized fatal result, then run the existing morning-brief draft CLI with a valid test fixture and confirm draft creation still succeeds. This executable flow check proves a pipeline failure does not make the independent pending-draft command unusable; it does not approve or publish the draft. During final code review, inspect the seven formal behavior modules listed in Task 8 and confirm none imports the pipeline or snapshot services.

- [ ] **Step 8: Inspect final scope**

Run:

```bash
git status --short
git diff --stat HEAD~1
git log --oneline -12
```

Confirm `.superpowers/`, `ig-app-intro/`, and `reels-beta-update/` remain untouched user-owned untracked directories. Confirm no `.env.local`, temporary payload, credential, or generated build output is staged.

- [ ] **Step 9: Final implementation handoff**

Report:

- changed/created files and Redis key subtree;
- no SQL migration and no new environment variable;
- the three pipeline stage statuses and snapshot counts;
- exact 2026-07-29 inserted/revised then unchanged evidence;
- latest observation/retrieval metadata availability and remaining missing D3 reasons;
- one active weekday 07:00 Asia/Taipei automation and removed Vercel duplicate schedule;
- saved admin URL and manual CLI command;
- test, lint, build, and diff-check results;
- explicit confirmation that scoring/public and formal App behavior remain unchanged.
