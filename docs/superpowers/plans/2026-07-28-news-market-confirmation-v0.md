# News Event × Market Data Confirmation v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only, deterministic D1/D3 market-data confirmation view for structured morning-brief events without calculating scores or changing Dynamic Beta behavior.

**Architecture:** Extend immutable news-event revisions with explicit confirmation rules, evaluate those rules in a pure module against histories read from the existing FRED/Yahoo repository, and expose the result through a separate protected API and the existing admin validation page. The confirmation service is read-only and is not imported by any public, portfolio, rebalance, recommendation, or scoring path.

**Tech Stack:** Next.js 16 App Router, React 19, Node.js ES modules, `node:test`, Upstash Redis, existing Dynamic Beta market-data catalog/repository/freshness modules.

## Global Constraints

- Do not calculate a news score, Market Risk Score, Crash Risk Score, Dynamic Beta, Target Beta, or trading action.
- Do not alter public UI, portfolio, cash, rebalance, recommendation, Market Risk Score v0, or existing Beta behavior.
- Reuse only the existing FRED and Yahoo market-data repository; add no provider or package.
- Store directions, units, and thresholds explicitly; never infer them from prose.
- Preserve old briefs containing only `dataToConfirm` string identifiers.
- Require `DYNAMIC_BETA_DATA_ENABLED=true` and `DYNAMIC_BETA_NEWS_DATA_ENABLED=true`; leave all scoring and public flags disabled.
- Add no database table, cron job, or environment variable.
- Treat `asOf` as an observation-date cutoff and disclose that it is not true ALFRED vintage reconstruction.
- The current worktree contains unrelated user changes. Do not commit, stage, revert, or reformat unrelated files without an explicit user request; use verification checkpoints instead of plan commits.

---

## File Map

- Modify `src/lib/dynamic-beta/news/schema.js`: validate and normalize `marketDate` and explicit `confirmationRules` while preserving legacy events.
- Modify `src/lib/dynamic-beta/news/template.js`: show a valid explicit rule in the admin JSON template.
- Create `src/lib/dynamic-beta/news/confirmation.js`: pure observation selection, movement calculation, rule evaluation, D1/D3 persistence, and event rollup.
- Create `src/lib/dynamic-beta/news/confirmation-service.js`: select a brief, fetch each series history once, evaluate freshness, and compose the API response.
- Modify `src/lib/dynamic-beta/news/repository.js`: read a specific current or immutable morning-brief revision.
- Modify `app/api/dynamic-beta/_shared.js`: construct the confirmation service from existing repositories.
- Create `app/api/dynamic-beta/news/confirmations/route.js`: admin-only GET endpoint with both data flags and query validation.
- Create `src/lib/dynamic-beta/news/confirmation-view.js`: pure labels and display formatting consumed by the admin page.
- Modify `app/admin/dynamic-beta/page.js`: load and render the internal D1/D3 confirmation panel.
- Modify `tests/dynamic-beta-news.test.js`: schema, template, and repository compatibility coverage.
- Create `tests/dynamic-beta-news-confirmation.test.js`: pure evaluator and service coverage.
- Modify `tests/dynamic-beta-routes.test.js`: route authorization and flag isolation coverage.
- Create `tests/dynamic-beta-news-confirmation-ui.test.js`: executable behavior tests for confirmation labels and display formatting.
- Create `artifacts/dynamic-beta/morning-brief-2026-07-27-confirmation.json`: immutable smoke-test input derived from the existing brief, with explicit rules only where the event has a directional thesis.

---

### Task 1: Extend the Morning-Brief Schema and Template

**Files:**
- Modify: `src/lib/dynamic-beta/news/schema.js`
- Modify: `src/lib/dynamic-beta/news/template.js`
- Modify: `tests/dynamic-beta-news.test.js`

**Interfaces:**
- Consumes: `getDynamicBetaSeries(seriesId)` from `src/lib/dynamic-beta/catalog.js`.
- Produces: normalized event fields `marketDate: string` and `confirmationRules: Array<{seriesId: string, expectedDirection: "up"|"down", changeType: "percent"|"absolute"|"basis_points", threshold: number}>`.
- Produces: legacy briefs with `confirmationRules: []` plus warnings for unmatched `dataToConfirm` entries.

- [ ] **Step 1: Write failing schema tests for valid explicit rules and legacy compatibility**

Add tests that call the existing `brief()` fixture with one structured event:

```js
it("normalizes explicit market confirmation rules", () => {
  const result = validateMorningBriefPayload(brief({
    events: [
      event(1, {
        marketDate: "2026-07-28",
        dataToConfirm: ["YAHOO:QQQ", "DGS10"],
        confirmationRules: [
          {
            seriesId: "YAHOO:QQQ",
            expectedDirection: "down",
            changeType: "percent",
            threshold: 1,
          },
          {
            seriesId: "DGS10",
            expectedDirection: "up",
            changeType: "basis_points",
            threshold: 5,
          },
        ],
      }),
      event(2), event(3), event(4), event(5),
    ],
  }));

  assert.equal(result.valid, true);
  assert.equal(result.value.events[0].marketDate, "2026-07-28");
  assert.deepEqual(result.value.events[0].confirmationRules[0], {
    seriesId: "YAHOO:QQQ",
    expectedDirection: "down",
    changeType: "percent",
    threshold: 1,
  });
  assert.deepEqual(result.value.events[1].confirmationRules, []);
  assert.ok(result.warnings.some((message) => message.includes("尚未設定確認規則")));
});
```

- [ ] **Step 2: Write failing validation tests for every rejected rule shape**

Use five otherwise valid events and assert errors for an invalid `marketDate`, unknown `seriesId`, duplicate series, direction `flat`, change type `ratio`, non-positive threshold, and a rule series absent from `dataToConfirm`:

```js
assert.ok(result.errors.some((message) => message.includes("marketDate")));
assert.ok(result.errors.some((message) => message.includes("UNKNOWN")));
assert.ok(result.errors.some((message) => message.includes("不可重複")));
assert.ok(result.errors.some((message) => message.includes("expectedDirection")));
assert.ok(result.errors.some((message) => message.includes("changeType")));
assert.ok(result.errors.some((message) => message.includes("threshold")));
assert.ok(result.errors.some((message) => message.includes("dataToConfirm")));
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news.test.js
```

Expected: FAIL because events do not yet contain normalized `marketDate` or `confirmationRules` and invalid rule shapes are not rejected.

- [ ] **Step 4: Implement strict rule normalization in `schema.js`**

Import the catalog lookup and add enums plus a focused helper:

```js
import { getDynamicBetaSeries } from "../catalog.js";

const CONFIRMATION_DIRECTIONS = Object.freeze(["up", "down"]);
const CONFIRMATION_CHANGE_TYPES = Object.freeze([
  "percent",
  "absolute",
  "basis_points",
]);

function normalizeConfirmationRules(value, path, dataToConfirm, errors) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} 必須是陣列。`);
    return [];
  }
  const seen = new Set();
  return value.map((rule, index) => {
    const rulePath = `${path}[${index}]`;
    const seriesId = cleanText(rule?.seriesId);
    const expectedDirection = cleanText(rule?.expectedDirection);
    const changeType = cleanText(rule?.changeType);
    const threshold = rule?.threshold;
    if (!getDynamicBetaSeries(seriesId)) errors.push(`${rulePath}.seriesId 未知：${seriesId}。`);
    if (seen.has(seriesId)) errors.push(`${path}.seriesId 不可重複：${seriesId}。`);
    seen.add(seriesId);
    if (!dataToConfirm.includes(seriesId)) {
      errors.push(`${rulePath}.seriesId 必須同時存在於 dataToConfirm。`);
    }
    if (!CONFIRMATION_DIRECTIONS.includes(expectedDirection)) {
      errors.push(`${rulePath}.expectedDirection 必須是 up 或 down。`);
    }
    if (!CONFIRMATION_CHANGE_TYPES.includes(changeType)) {
      errors.push(`${rulePath}.changeType 必須是 percent、absolute 或 basis_points。`);
    }
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) {
      errors.push(`${rulePath}.threshold 必須是大於 0 的有限數字。`);
    }
    return { seriesId, expectedDirection, changeType, threshold };
  });
}
```

Inside each event, normalize `dataToConfirm` once, default `marketDate` to `input.briefDate`, validate it with `validDateKey`, normalize rules, and warn for each unmatched string. Return both new fields in the immutable event value.

- [ ] **Step 5: Update the JSON template with a valid explicit example**

Give every generated event an explicit `marketDate` and one catalog-valid rule, using the existing topic index only to select a data series, not to infer news meaning:

```js
const confirmationExamples = [
  { seriesId: "DGS2", expectedDirection: "up", changeType: "basis_points", threshold: 5 },
  { seriesId: "YAHOO:CL=F", expectedDirection: "up", changeType: "percent", threshold: 2 },
  { seriesId: "YAHOO:QQQ", expectedDirection: "down", changeType: "percent", threshold: 1 },
  { seriesId: "YAHOO:SOXX", expectedDirection: "down", changeType: "percent", threshold: 1.5 },
  { seriesId: "YAHOO:0050.TW", expectedDirection: "down", changeType: "percent", threshold: 1 },
];
```

Set `dataToConfirm: [confirmationExamples[index].seriesId]` and `confirmationRules: [confirmationExamples[index]]`. The text remains clearly marked as a replaceable template, not an automatically selected rule.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-news.test.js
```

Expected: all news schema, normalization, dedupe, repository, template, and feature-flag tests pass.

- [ ] **Step 7: Review the task diff without staging**

Run:

```bash
git diff --check -- src/lib/dynamic-beta/news/schema.js src/lib/dynamic-beta/news/template.js tests/dynamic-beta-news.test.js
git diff -- src/lib/dynamic-beta/news/schema.js src/lib/dynamic-beta/news/template.js tests/dynamic-beta-news.test.js
```

Expected: no whitespace errors; the diff contains only schema/template behavior and tests.

---

### Task 2: Build the Pure D1/D3 Confirmation Evaluator

**Files:**
- Create: `src/lib/dynamic-beta/news/confirmation.js`
- Create: `tests/dynamic-beta-news-confirmation.test.js`

**Interfaces:**
- Produces: `evaluateConfirmationRule({ rule, marketDate, history, asOf, freshnessStatus })`.
- Produces: `rollupConfirmation(ruleResults, window)` where `window` is `"d1"` or `"d3"`.
- Produces: `describeConfirmationPersistence(d1Status, d3Status)`.
- Produces: `evaluateEventConfirmation({ event, briefDate, histories, freshnessBySeries, asOf })`.
- History rows use `{ observationDate: "YYYY-MM-DD", value: number, retrievedAt?: string|null, releasedAt?: string|null }`.

- [ ] **Step 1: Write failing tests for observation selection and all change types**

Cover an event date after a weekend/gap and assert exact baseline, D1, and D3 dates. Use histories such as:

```js
const priceHistory = [
  { observationDate: "2026-07-24", value: 100 },
  { observationDate: "2026-07-27", value: 97 },
  { observationDate: "2026-07-28", value: 98 },
  { observationDate: "2026-07-29", value: 95 },
];

const result = evaluateConfirmationRule({
  rule: {
    seriesId: "YAHOO:QQQ",
    expectedDirection: "down",
    changeType: "percent",
    threshold: 2,
  },
  marketDate: "2026-07-27",
  history: priceHistory,
  asOf: "2026-07-29",
  freshnessStatus: "fresh",
});

assert.equal(result.baseline.observationDate, "2026-07-24");
assert.equal(result.d1.observation.observationDate, "2026-07-27");
assert.equal(result.d1.rawMove, -3);
assert.equal(result.d1.status, "confirmed");
assert.equal(result.d3.rawMove, -5);
assert.equal(result.d3.status, "confirmed");
```

Add separate exact assertions for `absolute` VIX points and `basis_points` yield moves.

- [ ] **Step 2: Write failing tests for boundaries and failure states**

Test inclusive positive and negative thresholds, an unconfirmed interior move, percent baseline zero, missing baseline, unsupported monthly frequency passed through the event evaluator, fresh incomplete D3 as `observing`, and stale incomplete D3 as `insufficient_data`.

```js
assert.equal(atPositiveBoundary.d1.status, "confirmed");
assert.equal(atNegativeBoundary.d1.status, "reverse");
assert.equal(interior.d1.status, "unconfirmed");
assert.equal(zeroBaseline.d1.status, "insufficient_data");
assert.equal(freshIncomplete.d3.status, "observing");
assert.equal(staleIncomplete.d3.status, "insufficient_data");
```

- [ ] **Step 3: Write failing tests for persistence and majority rollup**

Assert every fixed mapping and the majority formula:

```js
assert.equal(describeConfirmationPersistence("confirmed", "confirmed"), "sustained");
assert.equal(describeConfirmationPersistence("confirmed", "unconfirmed"), "faded");
assert.equal(describeConfirmationPersistence("confirmed", "reverse"), "reversed");
assert.equal(describeConfirmationPersistence("unconfirmed", "confirmed"), "emerged_late");
assert.equal(describeConfirmationPersistence("unconfirmed", "unconfirmed"), "unchanged");

const rollup = rollupConfirmation([
  { d1: { status: "confirmed" } },
  { d1: { status: "confirmed" } },
  { d1: { status: "unconfirmed" } },
  { d1: { status: "observing" } },
], "d1");
assert.equal(rollup.status, "confirmed");
assert.equal(rollup.requiredMajority, 2);
assert.equal(rollup.isFinal, false);
```

Also assert split signals return `unconfirmed` with `reason: "split_signals"`, all-observing returns `observing`, and legacy-only data returns `not_configured`.

- [ ] **Step 4: Run the new test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news-confirmation.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `confirmation.js`.

- [ ] **Step 5: Implement deterministic selection and movement helpers**

Create small private helpers in `confirmation.js`:

```js
function usableHistory(history, asOf) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item?.observationDate <= asOf && Number.isFinite(Number(item?.value)))
    .map((item) => ({ ...item, value: Number(item.value) }))
    .sort((left, right) => left.observationDate.localeCompare(right.observationDate));
}

function calculateMove(changeType, baseline, observation) {
  if (changeType === "percent") {
    if (!Number.isFinite(baseline) || baseline === 0) return null;
    return (observation / baseline - 1) * 100;
  }
  if (changeType === "basis_points") return (observation - baseline) * 100;
  return observation - baseline;
}

function classifyMove(rawMove, rule) {
  if (!Number.isFinite(rawMove)) return "insufficient_data";
  const normalizedMove = rule.expectedDirection === "down" ? -rawMove : rawMove;
  if (normalizedMove >= rule.threshold) return "confirmed";
  if (normalizedMove <= -rule.threshold) return "reverse";
  return "unconfirmed";
}
```

Select the latest row before `marketDate`, the first row on/after it, and the third row on/after it. Missing windows use `observing` only when `freshnessStatus` is `fresh` or `delayed`; otherwise use `insufficient_data` with a machine-readable reason.

- [ ] **Step 6: Implement persistence, rollup, and full event evaluation**

Return traceable result objects with exact inputs and dates:

```js
{
  seriesId: rule.seriesId,
  expectedDirection: rule.expectedDirection,
  changeType: rule.changeType,
  threshold: rule.threshold,
  baseline: { observationDate, value },
  d1: { status, observation, rawMove, normalizedMove, reason },
  d3: { status, observation, rawMove, normalizedMove, reason },
  persistence: "sustained",
}
```

`evaluateEventConfirmation` must synthesize `not_configured` rows for `dataToConfirm` identifiers with no structured rule, reject non-daily catalog series as `insufficient_data`, then add independent D1 and D3 rollups.

The event result shape is fixed for later tasks:

```js
const d1 = rollupConfirmation(rules, "d1");
const d3 = rollupConfirmation(rules, "d3");
return {
  rank: event.rank,
  headline: event.headline,
  marketDate: event.marketDate || briefDate,
  rules,
  d1,
  d3,
  persistence: describeConfirmationPersistence(d1.status, d3.status),
};
```

Each rollup contains `status`, `reason`, `isFinal`, `evaluable`, `requiredMajority`, and `counts` with keys `confirmed`, `reverse`, `unconfirmed`, `observing`, `insufficient_data`, and `not_configured`.

- [ ] **Step 7: Run evaluator tests and verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-news-confirmation.test.js
```

Expected: all evaluator tests pass without Redis, network, React, or scoring imports.

- [ ] **Step 8: Review the task diff without staging**

Run:

```bash
git diff --check -- src/lib/dynamic-beta/news/confirmation.js tests/dynamic-beta-news-confirmation.test.js
git diff -- src/lib/dynamic-beta/news/confirmation.js tests/dynamic-beta-news-confirmation.test.js
```

Expected: no whitespace errors and no import from `market-risk-score.js`, portfolio, rebalance, or public application code.

---

### Task 3: Add Brief Revision Reads and the Read-Only Confirmation Service

**Files:**
- Modify: `src/lib/dynamic-beta/news/repository.js`
- Create: `src/lib/dynamic-beta/news/confirmation-service.js`
- Modify: `tests/dynamic-beta-news.test.js`
- Modify: `tests/dynamic-beta-news-confirmation.test.js`

**Interfaces:**
- Produces repository method: `readMorningBrief({ briefDate, revisionId = null }) -> Promise<object|null>`.
- Produces service factory: `createNewsMarketConfirmationService({ newsRepository, marketRepository, now = () => new Date() })`.
- Produces service method: `evaluate({ briefDate = null, revisionId = null, asOf = null }) -> Promise<ConfirmationResponse>`.
- Consumes Task 2 `evaluateEventConfirmation` and existing `evaluateDynamicBetaFreshness`/`getDynamicBetaSeries`.

- [ ] **Step 1: Write failing repository tests for current and exact revision reads**

After saving two revisions for the same date, assert default reads the current revision and an explicit ID reads the immutable first revision:

```js
const current = await repository.readMorningBrief({ briefDate: "2026-07-27" });
const original = await repository.readMorningBrief({
  briefDate: "2026-07-27",
  revisionId: first.revisionId,
});
assert.equal(current.revisionId, revised.revisionId);
assert.equal(original.revisionId, first.revisionId);
assert.equal(original.analystLabel, "risk_elevated");
```

- [ ] **Step 2: Write failing service tests for selection, deduplicated reads, and metadata**

Use fake repositories that record calls:

```js
const service = createNewsMarketConfirmationService({
  newsRepository: {
    readRecentBriefs: async () => [structuredBrief],
    readMorningBrief: async () => structuredBrief,
  },
  marketRepository: {
    readObservationHistory: async (seriesId, range) => {
      calls.push({ seriesId, range });
      return histories[seriesId] || [];
    },
  },
  now: () => new Date("2026-07-29T12:00:00.000Z"),
});

const result = await service.evaluate({ asOf: "2026-07-29" });
assert.equal(result.briefDate, structuredBrief.briefDate);
assert.equal(result.events.length, 5);
assert.equal(new Set(calls.map((item) => item.seriesId)).size, calls.length);
assert.equal(result.metadata.vintageMode, "latest_stored_revision_by_observation_date");
assert.equal(result.metadata.truePointInTime, false);
```

Also test date/revision selection, future `marketDate` as observing, missing brief, invalid `now`, and missing repository errors.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news.test.js tests/dynamic-beta-news-confirmation.test.js
```

Expected: FAIL because `readMorningBrief` and `confirmation-service.js` do not exist.

- [ ] **Step 4: Implement exact/current revision reading**

Add this repository behavior using the existing key format and `unpackBrief`:

```js
async readMorningBrief({ briefDate, revisionId = null }) {
  if (!briefDate) return null;
  const selectedRevisionId = revisionId || await redis.get(
    keys({ briefDate }).briefCurrent,
  );
  if (!selectedRevisionId) return null;
  return unpackBrief(await redis.hgetall(
    keys({ briefDate, revisionId: selectedRevisionId }).briefRevision,
  ));
},
```

Do not alter save semantics, revision hashes, or timeline ordering.

- [ ] **Step 5: Implement the read-only service**

In `confirmation-service.js`:

```js
import { getDynamicBetaSeries } from "../catalog.js";
import { evaluateDynamicBetaFreshness } from "../freshness.js";
import { evaluateEventConfirmation } from "./confirmation.js";

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function subtractDays(value, count) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createNewsMarketConfirmationService({
  newsRepository,
  marketRepository,
  now = () => new Date(),
}) {
  return {
    async evaluate({ briefDate = null, revisionId = null, asOf = null } = {}) {
      if (!newsRepository || !marketRepository) {
        throw serviceError("UNCONFIGURED_REPOSITORY", "Confirmation repository 尚未設定。");
      }
      const current = now();
      const currentDate = current instanceof Date ? current : new Date(current);
      if (Number.isNaN(currentDate.getTime())) {
        throw serviceError("INVALID_DATE", "Confirmation service 的 now 無效。");
      }
      const selectedAsOf = asOf || currentDate.toISOString().slice(0, 10);
      if (!validDateKey(selectedAsOf)) {
        throw serviceError("INVALID_DATE", "asOf 必須使用有效的 YYYY-MM-DD。");
      }
      if (briefDate && !validDateKey(briefDate)) {
        throw serviceError("INVALID_DATE", "briefDate 必須使用有效的 YYYY-MM-DD。");
      }
      if (revisionId && !briefDate) {
        throw serviceError("INVALID_QUERY", "revisionId 必須搭配 briefDate。");
      }
      const brief = briefDate
        ? await newsRepository.readMorningBrief({ briefDate, revisionId })
        : (await newsRepository.readRecentBriefs({ limit: 1 }))[0] || null;
      if (!brief) throw serviceError("MISSING_BRIEF", "找不到指定的 morning brief。");

      const earliestMarketDate = new Map();
      for (const event of brief.events || []) {
        const marketDate = event.marketDate || brief.briefDate;
        for (const rule of event.confirmationRules || []) {
          const previous = earliestMarketDate.get(rule.seriesId);
          if (!previous || marketDate < previous) earliestMarketDate.set(rule.seriesId, marketDate);
        }
      }

      const histories = {};
      const freshnessBySeries = {};
      await Promise.all([...earliestMarketDate].map(async ([seriesId, marketDate]) => {
        let history = await marketRepository.readObservationHistory(seriesId, {
          from: subtractDays(marketDate, 10),
          to: selectedAsOf,
        });
        if (!history.some((row) => row.observationDate < marketDate)) {
          history = await marketRepository.readObservationHistory(seriesId, {
            from: subtractDays(marketDate, 45),
            to: selectedAsOf,
          });
        }
        histories[seriesId] = history;
        const latest = history.filter((row) => row.observationDate <= selectedAsOf).at(-1);
        freshnessBySeries[seriesId] = evaluateDynamicBetaFreshness({
          series: getDynamicBetaSeries(seriesId),
          observationDate: latest?.observationDate || null,
          updateStatus: latest ? "success" : "never",
          asOf: new Date(`${selectedAsOf}T12:00:00.000Z`),
        }).status;
      }));

      return {
        briefDate: brief.briefDate,
        revisionId: brief.revisionId,
        revisionNumber: brief.revisionNumber,
        asOf: selectedAsOf,
        evaluatedAt: currentDate.toISOString(),
        metadata: {
          vintageMode: "latest_stored_revision_by_observation_date",
          truePointInTime: false,
        },
        events: (brief.events || []).map((event) => evaluateEventConfirmation({
          event,
          briefDate: brief.briefDate,
          histories,
          freshnessBySeries,
          asOf: selectedAsOf,
        })),
      };
    },
  };
}
```

Keep the implementation equivalent to this flow. Histories are keyed by distinct series, and their range starts from the earliest market date that uses the series. Stable error codes are `INVALID_DATE`, `INVALID_QUERY`, `MISSING_BRIEF`, and `UNCONFIGURED_REPOSITORY`, so the route never parses Chinese messages.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-news.test.js tests/dynamic-beta-news-confirmation.test.js
```

Expected: all schema, repository, evaluator, and service tests pass.

- [ ] **Step 7: Review the task diff without staging**

Run:

```bash
git diff --check -- src/lib/dynamic-beta/news/repository.js src/lib/dynamic-beta/news/confirmation-service.js tests/dynamic-beta-news.test.js tests/dynamic-beta-news-confirmation.test.js
```

Expected: no whitespace errors; the service performs only reads and pure evaluation.

---

### Task 4: Expose a Protected Confirmation API

**Files:**
- Modify: `app/api/dynamic-beta/_shared.js`
- Create: `app/api/dynamic-beta/news/confirmations/route.js`
- Modify: `tests/dynamic-beta-routes.test.js`

**Interfaces:**
- Consumes Task 3 service factory and both existing repository factories.
- Produces GET `/api/dynamic-beta/news/confirmations?token=...&briefDate=YYYY-MM-DD&revisionId=...&asOf=YYYY-MM-DD`.
- Response status mapping: invalid query 400, unauthorized 401, disabled flag 404, missing brief 404, missing Redis 503, unexpected failure 500.

- [ ] **Step 1: Write failing route tests for authorization and both feature flags**

Import the new GET handler and add isolated tests:

```js
const response = await readNewsConfirmations(
  new Request("https://example.com/api/dynamic-beta/news/confirmations"),
);
assert.equal(response.status, 401);
```

Then enable only one flag at a time and assert 404. Add `DYNAMIC_BETA_DATA_ENABLED` and all news flags to the existing environment restore object.

- [ ] **Step 2: Write failing route tests for invalid query values**

With both data flags enabled and a valid token, assert 400 before Redis is required:

```js
const response = await readNewsConfirmations(new Request(
  "https://example.com/api/dynamic-beta/news/confirmations?token=admin-secret&asOf=2026-99-99",
));
assert.equal(response.status, 400);
assert.match((await response.json()).error, /asOf/);
```

Also assert `revisionId` without `briefDate` returns 400.

- [ ] **Step 3: Run route tests and verify RED**

Run:

```bash
node --test tests/dynamic-beta-routes.test.js
```

Expected: FAIL because the confirmation route does not exist.

- [ ] **Step 4: Add the configured service factory to `_shared.js`**

Import `createNewsMarketConfirmationService` and export:

```js
export function createConfiguredNewsMarketConfirmationService({
  newsRepository = getDynamicBetaNewsRepository(),
  marketRepository = getDynamicBetaRepository(),
} = {}) {
  if (!newsRepository || !marketRepository) return null;
  return createNewsMarketConfirmationService({ newsRepository, marketRepository });
}
```

- [ ] **Step 5: Implement the isolated GET route**

The handler order must be authorization, market-data flag, news-data flag, query validation, repository configuration, evaluation:

```js
function validDateKey(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request) {
  const unauthorized = authorizeDynamicBetaRequest(request);
  if (unauthorized) return unauthorized;
  const marketDisabled = requireDynamicBetaDataEnabled();
  if (marketDisabled) return marketDisabled;
  const newsDisabled = requireDynamicBetaNewsDataEnabled();
  if (newsDisabled) return newsDisabled;

  const url = new URL(request.url);
  const briefDate = url.searchParams.get("briefDate");
  const revisionId = url.searchParams.get("revisionId");
  const asOf = url.searchParams.get("asOf");
  if (!validDateKey(briefDate) || !validDateKey(asOf)) {
    return Response.json(
      { error: "briefDate 與 asOf 必須使用有效的 YYYY-MM-DD。" },
      { status: 400 },
    );
  }
  if (revisionId && !briefDate) {
    return Response.json(
      { error: "revisionId 必須搭配 briefDate。" },
      { status: 400 },
    );
  }
  const service = createConfiguredNewsMarketConfirmationService();
  if (!service) return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
  try {
    return Response.json(await service.evaluate({ briefDate, revisionId, asOf }));
  } catch (error) {
    if (error?.code === "INVALID_DATE" || error?.code === "INVALID_QUERY") {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error?.code === "MISSING_BRIEF") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error?.code === "UNCONFIGURED_REPOSITORY") {
      return dynamicBetaUnconfiguredResponse(error.message);
    }
    console.error("News market confirmation failed", error);
    return Response.json(
      { error: "News market confirmation 讀取失敗。" },
      { status: 500 },
    );
  }
}
```

Export `dynamic = "force-dynamic"`. Do not import or check any scoring/public flag.

- [ ] **Step 6: Run route tests and verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-routes.test.js
```

Expected: all existing cron, sync, preview, news, and new confirmation route tests pass.

- [ ] **Step 7: Review route isolation without staging**

Run:

```bash
git diff --check -- app/api/dynamic-beta/_shared.js app/api/dynamic-beta/news/confirmations/route.js tests/dynamic-beta-routes.test.js
rg -n "SCORING|PUBLIC|market-risk-score|rebalance|portfolio" app/api/dynamic-beta/news/confirmations src/lib/dynamic-beta/news/confirmation-service.js
```

Expected: diff check passes and the search has no functional dependency on scoring, public, rebalance, or portfolio modules.

---

### Task 5: Add the Internal Admin Confirmation Panel

**Files:**
- Create: `src/lib/dynamic-beta/news/confirmation-view.js`
- Modify: `app/admin/dynamic-beta/page.js`
- Create: `tests/dynamic-beta-news-confirmation-ui.test.js`

**Interfaces:**
- Consumes Task 4 API response.
- Adds client state `confirmationResult`, `confirmationStatus`, `confirmationError`, `confirmationAsOf`, `confirmationBriefDate`, and `confirmationRevisionId`.
- Does not export or link the panel from public navigation.

- [ ] **Step 1: Write failing behavior tests for the UI's display contract**

Import the pure formatting module used by the React page and assert consumer-visible labels and values:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  confirmationLabel,
  formatConfirmationMove,
  formatConfirmationObservation,
  formatRuleExpectation,
  persistenceLabel,
} from "../src/lib/dynamic-beta/news/confirmation-view.js";

describe("dynamic beta news confirmation admin UI", () => {
  it("translates every internal state without changing its meaning", () => {
    assert.equal(confirmationLabel("confirmed"), "已確認");
    assert.equal(confirmationLabel("reverse"), "反向");
    assert.equal(confirmationLabel("unconfirmed"), "未確認");
    assert.equal(confirmationLabel("observing"), "觀察中");
    assert.equal(confirmationLabel("insufficient_data"), "資料不足");
    assert.equal(confirmationLabel("not_configured"), "尚未設定確認規則");
    assert.equal(persistenceLabel("emerged_late"), "延後確認");
  });

  it("formats units and missing observations for the evidence table", () => {
    assert.equal(formatConfirmationMove(-1.23456, "percent"), "-1.23%");
    assert.equal(formatConfirmationMove(7.891, "basis_points"), "7.89 bps");
    assert.equal(formatConfirmationMove(null, "absolute"), "—");
    assert.equal(
      formatConfirmationObservation({ observationDate: "2026-07-27", value: 4.37 }),
      "4.37 · 2026-07-27",
    );
    assert.equal(formatConfirmationObservation(null), "—");
    assert.equal(formatRuleExpectation({
      expectedDirection: "down",
      threshold: 2,
      changeType: "percent",
    }), "下跌至少 2%");
  });
});
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```bash
node --test tests/dynamic-beta-news-confirmation-ui.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because the display-formatting module does not exist.

- [ ] **Step 3: Implement the pure display-formatting module**

Create exact status maps and small pure formatters:

```js
const CONFIRMATION_LABELS = Object.freeze({
  confirmed: "已確認",
  reverse: "反向",
  unconfirmed: "未確認",
  observing: "觀察中",
  insufficient_data: "資料不足",
  not_configured: "尚未設定確認規則",
});

const PERSISTENCE_LABELS = Object.freeze({
  sustained: "持續",
  faded: "消退",
  reversed: "反轉",
  emerged_late: "延後確認",
  unchanged: "未改變",
  observing: "觀察中",
  insufficient_data: "資料不足",
  not_configured: "尚未設定確認規則",
});

export function confirmationLabel(status) {
  return CONFIRMATION_LABELS[status] || status || "—";
}

export function persistenceLabel(status) {
  return PERSISTENCE_LABELS[status] || status || "—";
}
```

Add the three tested formatters using `Number(value).toFixed(2)`, trimming only trailing `.00`, and the suffixes `%`, ` bps`, or an empty absolute suffix. Direction text is `上漲`/`下跌` and must include the rule's formatted threshold.

- [ ] **Step 4: Add confirmation loading state and request logic**

Add a `loadConfirmations` callback that requires the existing URL token and sends `briefDate`, `revisionId`, and `asOf` only when present:

```js
const params = new URLSearchParams({ token, asOf: confirmationAsOf });
if (confirmationBriefDate) params.set("briefDate", confirmationBriefDate);
if (confirmationRevisionId) params.set("revisionId", confirmationRevisionId);
const response = await fetch(
  `/api/dynamic-beta/news/confirmations?${params.toString()}`,
  { cache: "no-store" },
);
```

Keep confirmation errors in their own state so a failed confirmation request does not blank market data, score preview, or news ingestion.

- [ ] **Step 5: Render the internal panel below the morning-brief revision table**

Add date/revision inputs and a manual `讀取確認結果` button. For every result, display:

```jsx
<details key={`${event.rank}:${event.headline}`}>
  <summary>
    #{event.rank} {event.headline} · D1 主要確認：{confirmationLabel(event.d1.status)}
    {event.d1.isFinal ? "" : "（暫定）"} · D3 持續性：{persistenceLabel(event.persistence)}
  </summary>
  <p className="hint">
    D1：確認 {event.d1.counts.confirmed}／反向 {event.d1.counts.reverse}／
    未確認 {event.d1.counts.unconfirmed}／觀察中 {event.d1.counts.observing}；
    D3：確認 {event.d3.counts.confirmed}／反向 {event.d3.counts.reverse}／
    未確認 {event.d3.counts.unconfirmed}／觀察中 {event.d3.counts.observing}
  </p>
  <div className="analyticsTable">
    <div>
      <strong>Series</strong>
      <strong>預期／門檻</strong>
      <strong>Baseline</strong>
      <strong>D1</strong>
      <strong>D1 move</strong>
      <strong>D3</strong>
      <strong>原因</strong>
    </div>
    {event.rules.map((rule) => (
      <div key={rule.seriesId}>
        <span><code>{rule.seriesId}</code></span>
        <span>{formatRuleExpectation(rule)}</span>
        <span>{formatObservation(rule.baseline)}</span>
        <span>{confirmationLabel(rule.d1.status)}</span>
        <span>{formatConfirmationMove(rule.d1.rawMove, rule.changeType)}</span>
        <span>{confirmationLabel(rule.d3.status)}</span>
        <span>{rule.d1.reason || rule.d3.reason || "—"}</span>
      </div>
    ))}
  </div>
</details>
```

Use local label maps for `confirmed`, `reverse`, `unconfirmed`, `observing`, `insufficient_data`, `not_configured`, and all persistence states. `formatObservation`, `formatRuleExpectation`, and `formatConfirmationMove` return `—` for missing values and round only rendered text.

- [ ] **Step 6: Run the UI behavior test and verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-news-confirmation-ui.test.js
```

Expected: all label, unit, missing-value, and expectation formatting behavior tests pass.

- [ ] **Step 7: Run lint on the modified client page**

Run:

```bash
npx eslint src/lib/dynamic-beta/news/confirmation-view.js app/admin/dynamic-beta/page.js tests/dynamic-beta-news-confirmation-ui.test.js
```

Expected: no React hooks, JSX, accessibility, or lint errors.

- [ ] **Step 8: Review the UI diff without staging**

Run:

```bash
git diff --check -- src/lib/dynamic-beta/news/confirmation-view.js app/admin/dynamic-beta/page.js tests/dynamic-beta-news-confirmation-ui.test.js
git diff -- src/lib/dynamic-beta/news/confirmation-view.js app/admin/dynamic-beta/page.js tests/dynamic-beta-news-confirmation-ui.test.js
```

Expected: only the internal admin page changes; `app/page.js` and public components are untouched.

---

### Task 6: Add a Directional Smoke Fixture and Verify the Whole Feature

**Files:**
- Create: `artifacts/dynamic-beta/morning-brief-2026-07-27-confirmation.json`
- Verify only: all implementation and existing application files.

**Interfaces:**
- Consumes Task 1 schema and Task 4 routes.
- Produces a new immutable Redis morning-brief revision when manually posted; never overwrites the existing revision.

- [ ] **Step 1: Create the smoke fixture from the existing July 27 brief**

Copy the existing artifact content into the new file, change only `generatedAt` to `2026-07-28T00:30:00.000Z`, add `marketDate`, and add these explicit rules only to directional events:

Event 1 uses `marketDate: "2026-07-27"` for the de-escalation thesis:

```json
[
  { "seriesId": "YAHOO:BZ=F", "expectedDirection": "down", "changeType": "percent", "threshold": 2 },
  { "seriesId": "YAHOO:CL=F", "expectedDirection": "down", "changeType": "percent", "threshold": 2 },
  { "seriesId": "DGS2", "expectedDirection": "down", "changeType": "basis_points", "threshold": 5 },
  { "seriesId": "DGS10", "expectedDirection": "down", "changeType": "basis_points", "threshold": 5 }
]
```

Event 2 uses `marketDate: "2026-07-30"` for the post-FOMC risk thesis:

```json
[
  { "seriesId": "DGS2", "expectedDirection": "up", "changeType": "basis_points", "threshold": 5 },
  { "seriesId": "DGS10", "expectedDirection": "up", "changeType": "basis_points", "threshold": 5 },
  { "seriesId": "YAHOO:QQQ", "expectedDirection": "down", "changeType": "percent", "threshold": 1 },
  { "seriesId": "YAHOO:SOXX", "expectedDirection": "down", "changeType": "percent", "threshold": 1.5 }
]
```

Event 3 uses `marketDate: "2026-07-27"` for the relief-rally thesis:

```json
[
  { "seriesId": "YAHOO:SPY", "expectedDirection": "up", "changeType": "percent", "threshold": 0.75 },
  { "seriesId": "YAHOO:QQQ", "expectedDirection": "up", "changeType": "percent", "threshold": 1 },
  { "seriesId": "YAHOO:SOXX", "expectedDirection": "up", "changeType": "percent", "threshold": 1.5 },
  { "seriesId": "YAHOO:^VIX", "expectedDirection": "down", "changeType": "absolute", "threshold": 1 },
  { "seriesId": "BAMLH0A0HYM2", "expectedDirection": "down", "changeType": "basis_points", "threshold": 5 },
  { "seriesId": "DGS10", "expectedDirection": "down", "changeType": "basis_points", "threshold": 5 }
]
```

Events 4 and 5 keep `confirmationRules: []`: event 4 is a future earnings watch without an observed result, while event 5 lacks an unambiguous event-session anchor in the stored brief. Their unmatched `dataToConfirm` items intentionally demonstrate legacy/not-configured output rather than inventing a thesis.

- [ ] **Step 2: Run all focused tests**

Run:

```bash
node --test tests/dynamic-beta-news.test.js tests/dynamic-beta-news-confirmation.test.js tests/dynamic-beta-routes.test.js tests/dynamic-beta-news-confirmation-ui.test.js
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the full regression suite**

Run:

```bash
npm test
```

Expected: every existing Beta, cash, portfolio, rebalance, operation, history, Dynamic Beta, news, and confirmation test passes.

- [ ] **Step 4: Run lint and production build**

Run:

```bash
npm run lint
npm run build
```

Expected: ESLint exits 0 and Next.js completes a production build including the new internal route.

- [ ] **Step 5: Validate and save the smoke fixture through the local admin API**

With the existing local development server and `.env.local`, run:

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/dynamic-beta/news/validate?token=local-admin" -H "Content-Type: application/json" --data-binary @artifacts/dynamic-beta/morning-brief-2026-07-27-confirmation.json
curl -sS -X POST "http://127.0.0.1:3000/api/dynamic-beta/news?token=local-admin" -H "Content-Type: application/json" --data-binary @artifacts/dynamic-beta/morning-brief-2026-07-27-confirmation.json
```

Expected: validation returns `valid: true`; save returns `saved: true` and a new revision number while the original revision remains readable.

- [ ] **Step 6: Read the confirmation endpoint at two cutoffs**

Run:

```bash
curl -sS "http://127.0.0.1:3000/api/dynamic-beta/news/confirmations?token=local-admin&briefDate=2026-07-27&asOf=2026-07-28"
curl -sS "http://127.0.0.1:3000/api/dynamic-beta/news/confirmations?token=local-admin&briefDate=2026-07-27"
```

Expected: the first response contains D1 results and D3 observing/insufficient states without using observations after July 28; the second uses the server's current date and still never invents future observations. Both responses include exact dates, values, rules, rollups, and `truePointInTime: false` metadata.

- [ ] **Step 7: Inspect the admin view manually**

Open:

```text
http://127.0.0.1:3000/admin/dynamic-beta?token=local-admin
```

Expected: the confirmation panel lists five events; directional events show per-series D1/D3 evidence, and unconfigured events explicitly say `尚未設定確認規則`. Existing market-data, score-preview, and news-ingestion panels still load.

- [ ] **Step 8: Perform final isolation checks**

Run:

```bash
git diff --check
git status --short
git diff -- app/page.js src/lib/rebalance.js src/lib/portfolio.js
```

Expected: no whitespace errors; status shows only intended feature files plus pre-existing user changes; the public page and investment logic have no confirmation-related diff.
