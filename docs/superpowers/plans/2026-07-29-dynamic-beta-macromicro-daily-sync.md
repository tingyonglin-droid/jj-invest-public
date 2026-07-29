# Dynamic Beta MacroMicro Daily Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the public MacroMicro Taiwan TAIEX margin-maintenance ratio every weekday through the existing Dynamic Beta revision store and display it in the internal Data workspace.

**Architecture:** Register one externally managed catalog series, but explicitly exclude it from the existing FRED/Yahoo sync loop. A pure validator normalizes browser-extracted success or fixed failure payloads, a dedicated ingestion service reuses the Redis repository and sync lock, and both an admin route and a server-side CLI call that service. The existing local 07:00 Asia/Taipei Codex automation reads the visible MacroMicro page and invokes the CLI before generating the morning-brief draft.

**Tech Stack:** Next.js 16 App Router route handlers, Node.js ESM, `node:test`, Upstash Redis through the existing repository, local Codex browser automation.

## Global Constraints

- Do not calculate or modify Dynamic Beta, Market Risk Score, Crash Risk Score, Target Beta, tolerance bands, holdings, cash, rebalancing, trading advice, public UI, or existing user data.
- Use only `https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin` for the displayed Taiwan margin-maintenance ratio.
- The morning brief displays only the MacroMicro ratio and does not compare the Financial Supervisory Commission whole-account ratio.
- Do not add a database, Redis schema, npm dependency, client-side secret, or public route.
- `released_at`, `source_realtime_start`, and `source_realtime_end` remain null.
- Same date and value is unchanged; same date and changed value creates an immutable revision.
- Never infer an observation date for MacroMicro's unlabeled previous value.
- A MacroMicro failure must not stop FRED/Yahoo synchronization or morning-brief draft creation.
- Scoring and public feature flags remain disabled.

---

### Task 1: Register an externally managed series without changing FRED/Yahoo sync

**Files:**
- Modify: `src/lib/dynamic-beta/catalog.js`
- Modify: `src/lib/dynamic-beta/sync.js`
- Modify: `tests/dynamic-beta.test.js`

**Interfaces:**
- Produces catalog item `MACROMICRO:TAIEX_MARGIN_MAINTENANCE` with `syncMode: "external"`.
- Preserves `createDynamicBetaSyncService(...).sync({ seriesIds? })` for FRED/Yahoo callers.
- Makes an explicit request for an external series fail with the existing unsupported-series error before locking.

- [ ] **Step 1: Write failing catalog and sync-isolation tests**

Update the catalog expectation to 21 series and add assertions:

```js
const macroMicro = getDynamicBetaSeries(
  "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
);
assert.deepEqual(macroMicro, {
  seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
  name: "Taiwan TAIEX Margin Maintenance Ratio",
  category: "market_stress",
  source: "MacroMicro",
  frequency: "Daily",
  unit: "Percent",
  enabled: true,
  syncMode: "external",
  freshnessPolicy: { kind: "weekdays", fresh: 1, delayed: 2 },
});
```

Add a synchronization test with one Yahoo series and one `syncMode: "external"` series. Assert the equity fetcher receives only the Yahoo series. Add a second assertion that requesting only the external ID rejects with:

```text
不支援的 Dynamic Beta series：MACROMICRO:TAIEX_MARGIN_MAINTENANCE
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/dynamic-beta.test.js
```

Expected: FAIL because the catalog has 20 entries, the MacroMicro series is missing, or the external series reaches the Yahoo branch.

- [ ] **Step 3: Add the catalog item and automatic-series filter**

In `catalog.js`, append one frozen external series:

```js
const EXTERNAL_SERIES = [{
  seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
  name: "Taiwan TAIEX Margin Maintenance Ratio",
  category: "market_stress",
  source: "MacroMicro",
  frequency: "Daily",
  unit: "Percent",
  enabled: true,
  syncMode: "external",
  freshnessPolicy: MARKET_DAILY_FRESHNESS,
}];
```

Include `...EXTERNAL_SERIES` in `DYNAMIC_BETA_SERIES`. In `sync.js`, derive the only IDs that route-managed synchronization may accept:

```js
const automaticSeries = seriesCatalog.filter(
  (series) => series.syncMode !== "external",
);
const allowedIds = new Set(automaticSeries.map((series) => series.seriesId));
const selectedSeries = automaticSeries.filter(
  (series) => series.enabled && (!requested || requested.includes(series.seriesId)),
);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run `node --test tests/dynamic-beta.test.js`.

Expected: PASS; scheduled FRED/Yahoo behavior remains unchanged and MacroMicro is catalog-visible but not fetched by the shared sync loop.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/dynamic-beta/catalog.js src/lib/dynamic-beta/sync.js tests/dynamic-beta.test.js
git commit -m "feat: register external MacroMicro series"
```

---

### Task 2: Validate and ingest MacroMicro observations with revision preservation

**Files:**
- Create: `src/lib/dynamic-beta/macromicro.js`
- Create: `src/lib/dynamic-beta/macromicro-service.js`
- Create: `tests/dynamic-beta-macromicro.test.js`

**Interfaces:**
- Produces constants `MACROMICRO_MARGIN_SERIES_ID`, `MACROMICRO_MARGIN_SOURCE_URL`, and `MACROMICRO_SOURCE_ERROR_MESSAGES`.
- Produces `MacroMicroPayloadError` with a stable `code`.
- Produces `normalizeMacroMicroPayload(payload, { retrievedAt, today })` returning `{ kind: "observation", observation }` or `{ kind: "source-error", errorCode, errorMessage }`.
- Produces `createMacroMicroIngestionService({ repository, now, logger, series }).ingest(payload)`.

- [ ] **Step 1: Write failing pure-validation tests**

Cover a successful payload:

```js
assert.deepEqual(
  normalizeMacroMicroPayload(
    {
      observationDate: "2026-07-28",
      value: 140.38,
      sourceUrl: MACROMICRO_MARGIN_SOURCE_URL,
    },
    {
      retrievedAt: "2026-07-29T00:00:00.000Z",
      today: "2026-07-29",
    },
  ),
  {
    kind: "observation",
    observation: {
      seriesId: MACROMICRO_MARGIN_SERIES_ID,
      observationDate: "2026-07-28",
      value: 140.38,
      releasedAt: null,
      retrievedAt: "2026-07-29T00:00:00.000Z",
      sourceRealtimeStart: null,
      sourceRealtimeEnd: null,
    },
  },
);
```

Add separate rejection tests for a wrong URL, malformed/future date, values `99.99`, `500.01`, `NaN`, mixed success/failure fields, and an unsupported failure code. Add acceptance tests for the inclusive 100 and 500 boundaries and for each fixed failure code.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-macromicro.test.js
```

Expected: FAIL with module-not-found because production files do not exist.

- [ ] **Step 3: Implement the pure payload validator**

Use these fixed contracts in `macromicro.js`:

```js
export const MACROMICRO_MARGIN_SERIES_ID =
  "MACROMICRO:TAIEX_MARGIN_MAINTENANCE";
export const MACROMICRO_MARGIN_SOURCE_URL =
  "https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin";
export const MACROMICRO_SOURCE_ERROR_MESSAGES = Object.freeze({
  PAGE_UNAVAILABLE: "M 平方頁面無法讀取。",
  LATEST_DATA_MISSING: "M 平方頁面沒有可確認的最新數據。",
  INVALID_PAGE_VALUE: "M 平方頁面回傳的最新數值無效。",
});
```

Validate exact object shape by rejecting payloads that mix `errorCode` with `observationDate` or `value`. Validate ISO dates by round-tripping `new Date(`${text}T00:00:00.000Z`)`, compare to the injected Asia/Taipei `today`, and enforce `100 <= value <= 500`.

- [ ] **Step 4: Verify validator GREEN before adding service behavior**

Run `node --test tests/dynamic-beta-macromicro.test.js`.

Expected: the validation tests PASS; service tests have not been added yet.

- [ ] **Step 5: Write failing ingestion-service tests**

Use an in-memory repository spy with `acquireSyncLock`, `releaseSyncLock`, `upsertSeriesMetadata`, `saveObservations`, and `writeSeriesStatus`. Assert a success call:

```js
assert.deepEqual(result, {
  seriesId: MACROMICRO_MARGIN_SERIES_ID,
  status: "success",
  inserted: 1,
  revised: 0,
  unchanged: 0,
  latestObservationDate: "2026-07-28",
});
```

Assert metadata is written, status ends in `success`, `last_success_at` is populated, and the lock is released. Add tests that a fixed failure payload writes `status: "error"` without calling `saveObservations`, that lock contention throws `Dynamic Beta 資料同步已在執行中。`, and that an unexpected repository failure still releases the lock and never logs raw secrets.

- [ ] **Step 6: Run ingestion tests and verify RED**

Run `node --test tests/dynamic-beta-macromicro.test.js`.

Expected: FAIL because `createMacroMicroIngestionService` is not exported.

- [ ] **Step 7: Implement the ingestion service**

In `macromicro-service.js`, inject all side effects. The service flow is:

```js
const currentTime = now();
const retrievedAt = currentTime.toISOString();
const normalized = normalizeMacroMicroPayload(payload, {
  retrievedAt,
  today: formatTaipeiDate(currentTime),
});
const lockToken = randomUUID();
if (!(await repository.acquireSyncLock(lockToken))) {
  throw new Error("Dynamic Beta 資料同步已在執行中。");
}
try {
  await repository.writeSeriesStatus(series.seriesId, {
    series_id: series.seriesId,
    status: "running",
    started_at: retrievedAt,
    updated_at: retrievedAt,
  });
  await repository.upsertSeriesMetadata(series, retrievedAt);
  if (normalized.kind === "source-error") {
    await repository.writeSeriesStatus(series.seriesId, {
      series_id: series.seriesId,
      status: "error",
      completed_at: retrievedAt,
      error: normalized.errorMessage,
      updated_at: retrievedAt,
    });
    return { seriesId: series.seriesId, status: "error",
      errorCode: normalized.errorCode };
  }
  const counts = await repository.saveObservations(
    series.seriesId,
    [normalized.observation],
  );
  await repository.writeSeriesStatus(series.seriesId, {
    series_id: series.seriesId,
    status: "success",
    completed_at: retrievedAt,
    last_success_at: retrievedAt,
    latest_observation_date: normalized.observation.observationDate,
    ...counts,
    error: null,
    updated_at: retrievedAt,
  });
  return { seriesId: series.seriesId, status: "success", ...counts,
    latestObservationDate: normalized.observation.observationDate };
} catch (error) {
  try {
    await repository.writeSeriesStatus(series.seriesId, {
      series_id: series.seriesId,
      status: "error",
      completed_at: retrievedAt,
      error: "M 平方資料寫入失敗。",
      updated_at: retrievedAt,
    });
  } catch {}
  logger.error("dynamic_beta_macromicro_ingest_failed", {
    seriesId: series.seriesId,
  });
  throw error;
} finally {
  await repository.releaseSyncLock(lockToken);
}
```

Validation happens before the lock and before any write, so malformed input does not change status. Implement `formatTaipeiDate` with `Intl.DateTimeFormat(...).formatToParts()` so the future-date check does not depend on the host timezone. Log only event names, series ID, counts, date, and fixed error code.

- [ ] **Step 8: Run Task 2 tests and commit**

Run `node --test tests/dynamic-beta-macromicro.test.js` and expect PASS.

```bash
git add src/lib/dynamic-beta/macromicro.js src/lib/dynamic-beta/macromicro-service.js tests/dynamic-beta-macromicro.test.js
git commit -m "feat: ingest MacroMicro margin observations"
```

---

### Task 3: Add the protected manual-ingestion route

**Files:**
- Modify: `app/api/dynamic-beta/_shared.js`
- Create: `app/api/dynamic-beta/macromicro/route.js`
- Modify: `tests/dynamic-beta-routes.test.js`

**Interfaces:**
- Produces `createConfiguredMacroMicroIngestionService(repository = getDynamicBetaRepository())`.
- Produces `POST /api/dynamic-beta/macromicro` protected by the existing admin token and `DYNAMIC_BETA_DATA_ENABLED`.
- Returns status 200 for stored or reported-source-error results, 400 for `MacroMicroPayloadError`, 409 for lock contention, and 503 when Redis is unconfigured.

- [ ] **Step 1: Write failing route tests**

Import the new `POST` handler and add tests that:

```js
assert.equal(
  (await ingestMacroMicro(new Request(
    "https://example.com/api/dynamic-beta/macromicro",
    { method: "POST", body: "{}" },
  ))).status,
  401,
);
```

With an admin token but `DYNAMIC_BETA_DATA_ENABLED=false`, assert 404. With the flag enabled and malformed JSON, assert 400 `{ error: "JSON 格式無效。" }` before any Redis access.

- [ ] **Step 2: Run route tests and verify RED**

Run `node --test tests/dynamic-beta-routes.test.js`.

Expected: FAIL with module-not-found for the new route.

- [ ] **Step 3: Implement configured service and route**

In `_shared.js`, import `createMacroMicroIngestionService` and `getDynamicBetaSeries`, then create the service with the fixed catalog item. In the route, preserve this order:

```js
const unauthorized = authorizeDynamicBetaRequest(request);
if (unauthorized) return unauthorized;
const disabled = requireDynamicBetaDataEnabled();
if (disabled) return disabled;

let payload;
try {
  payload = await request.json();
} catch {
  return Response.json({ error: "JSON 格式無效。" }, { status: 400 });
}

const service = createConfiguredMacroMicroIngestionService();
if (!service) {
  return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
}
```

Map only known validation and lock errors to 400/409; unexpected errors return a generic 500 message and do not echo exception text.

- [ ] **Step 4: Run route tests and commit**

Run `node --test tests/dynamic-beta-routes.test.js` and expect PASS.

```bash
git add app/api/dynamic-beta/_shared.js app/api/dynamic-beta/macromicro/route.js tests/dynamic-beta-routes.test.js
git commit -m "feat: add MacroMicro ingestion route"
```

---

### Task 4: Add the server-side automation CLI

**Files:**
- Create: `src/lib/dynamic-beta/macromicro-submission.js`
- Create: `scripts/dynamic-beta-macromicro-submit.js`
- Create: `tests/dynamic-beta-macromicro-submit.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces `MacroMicroSubmissionError` and `submitMacroMicroFile({ inputPath, readFile, dataEnabled, getService })`.
- Produces `runMacroMicroSubmit(...)` returning process exit code 0 only for a successful stored/unchanged observation and 1 for validation, source-report, or storage failure.
- Adds npm script `market-data:macromicro:submit`.

- [ ] **Step 1: Write failing submission and CLI tests**

Mirror the safety style of `tests/dynamic-beta-morning-brief-submit.test.js`. Test missing path, strict `DYNAMIC_BETA_DATA_ENABLED === "true"`, unreadable file, invalid JSON, unavailable service, successful saved summary, a reported source error returning exit 1, and unexpected errors that contain fake secrets but never print them.

The only successful stdout payload is:

```js
{
  ok: true,
  seriesId: "MACROMICRO:TAIEX_MARGIN_MAINTENANCE",
  status: "success",
  inserted: 1,
  revised: 0,
  unchanged: 0,
  latestObservationDate: "2026-07-28",
}
```

- [ ] **Step 2: Run the CLI test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-macromicro-submit.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the file-submission boundary**

`submitMacroMicroFile` must validate the path and strict feature flag before reading the file, parse JSON without echoing source contents, obtain a service exposing `ingest`, and call it. If the service returns `status: "error"`, throw:

```js
new MacroMicroSubmissionError(
  result.errorCode,
  "M 平方來源同步失敗，已保留既有 observation。",
);
```

Return only the fixed safe success fields; never return the original payload, source HTML, environment, or credentials.

- [ ] **Step 4: Implement the CLI wrapper and package script**

Follow the existing morning-brief CLI dependency-injection pattern. Add:

```json
"market-data:macromicro:submit": "node --env-file=.env.local scripts/dynamic-beta-macromicro-submit.js"
```

The wrapper obtains `getDynamicBetaFlags(environment).dataEnabled` and `createConfiguredMacroMicroIngestionService()`, prints one JSON line to stdout on success, prints one sanitized JSON line to stderr on failure, and uses `pathToFileURL` for direct-execution detection.

- [ ] **Step 5: Run Task 4 tests and commit**

Run `node --test tests/dynamic-beta-macromicro-submit.test.js` and expect PASS.

```bash
git add src/lib/dynamic-beta/macromicro-submission.js scripts/dynamic-beta-macromicro-submit.js tests/dynamic-beta-macromicro-submit.test.js package.json
git commit -m "feat: add MacroMicro sync CLI"
```

---

### Task 5: Update the weekday automation contract and perform end-to-end verification

**Files:**
- Modify: `docs/automations/dynamic-beta-daily-morning-brief.md`
- Modify only if a test exposes a defect: files already listed in Tasks 1–4

**Interfaces:**
- The existing weekday 07:00 Asia/Taipei automation reads MacroMicro and invokes the new CLI before morning-brief generation.
- The existing Vercel Cron remains unchanged and excludes the external series through Task 1.

- [ ] **Step 1: Add the exact automation preflight contract**

Add these instructions before morning-brief research:

```markdown
### M 平方同步前置步驟

1. 使用瀏覽器開啟 `https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin`。
2. 僅從「最新數據」讀取「大盤融資維持率(L)」的日期與數值；不得使用未標日期的前值建立 observation。
3. 成功時建立 JSON：`{"observationDate":"YYYY-MM-DD","value":NUMBER,"sourceUrl":"https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin"}`。
4. 無法讀取頁面、找不到最新資料或數值格式異常時，分別使用 `PAGE_UNAVAILABLE`、`LATEST_DATA_MISSING`、`INVALID_PAGE_VALUE` failure payload。
5. 找出 Codex workspace 提供的 Node.js runtime，執行 `node --env-file=.env.local scripts/dynamic-beta-macromicro-submit.js <json-file>`；不論結果成功或失敗，都繼續產生待核准晨報草稿。
```

- [ ] **Step 2: Run focused and full automated verification**

Run:

```bash
node --test tests/dynamic-beta.test.js tests/dynamic-beta-macromicro.test.js tests/dynamic-beta-routes.test.js tests/dynamic-beta-macromicro-submit.test.js
pnpm test
pnpm lint
pnpm build
```

Expected: every command exits 0. No scoring/public test changes are permitted merely to make the suite pass.

- [ ] **Step 3: Perform one live MacroMicro ingestion**

Read the visible latest date/value from the approved chart. Create a temporary JSON file outside the repository and run:

```bash
node --env-file=.env.local scripts/dynamic-beta-macromicro-submit.js /private/tmp/jj-invest-macromicro-margin.json
```

Expected: one safe JSON line with `status: "success"` and counts. Run the same command again and expect `unchanged: 1`, proving duplicate protection. Do not commit the temporary file.

- [ ] **Step 4: Verify the internal Data workspace**

Start the existing development server, open:

```text
http://localhost:3000/admin/dynamic-beta?token=local-admin&section=data
```

Confirm the Data section shows series ID `MACROMICRO:TAIEX_MARGIN_MAINTENANCE`, the visible MacroMicro value/date, source `MacroMicro`, retrieval time, freshness, and success status. Confirm Scoring and Public remain disabled.

- [ ] **Step 5: Update the existing Codex automation**

Change the existing Monday–Friday 07:00 Asia/Taipei morning-brief automation prompt so the preflight contract from Step 1 runs before news research. Keep the same weekday schedule and pending-draft approval behavior. Do not create a second competing 07:00 automation.

- [ ] **Step 6: Commit Task 5**

```bash
git add docs/automations/dynamic-beta-daily-morning-brief.md
git commit -m "docs: add MacroMicro morning sync preflight"
```

---

## Final Verification Checklist

- [ ] Catalog contains 21 unique series and the MacroMicro series is external-only.
- [ ] Existing FRED/Yahoo manual sync and Vercel Cron never fetch MacroMicro.
- [ ] Exact source URL, date, value range, and failure-code validation pass.
- [ ] Same date/value is unchanged; a changed value preserves a revision.
- [ ] Source failure records a fixed error without replacing the last observation.
- [ ] Admin route requires the existing token and data feature flag.
- [ ] CLI works while the Next.js development server is stopped.
- [ ] Data admin workspace shows the synchronized value and freshness.
- [ ] Weekday 07:00 automation performs MacroMicro sync before draft generation.
- [ ] No Market Risk Score, Dynamic Beta, portfolio, advice, or public behavior changed.
- [ ] Full tests, lint, and production build pass.
