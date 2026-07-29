# Dynamic Beta Admin Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the existing authenticated Dynamic Beta admin page into a five-section, mobile-first workspace while preserving every existing API, lifecycle, scoring-isolation, and production-App behavior.

**Architecture:** Keep `/admin/dynamic-beta` as the only route and let `section=today|briefs|confirmations|data|more` select one locally stateful admin section. Extract mutation-free morning-brief presentation components into `src/components/morning-brief`, keep lifecycle and token handling inside admin components, and reuse the current authenticated APIs and controllers. Each section owns its fetch/error/last-successful state so inactive tools do not load or clear one another.

**Tech Stack:** Next.js 16 App Router, React 19 client components, JavaScript ES modules, vanilla scoped CSS, Node test runner, React Test Renderer, Next SWC transform, Upstash Redis-backed existing APIs.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-07-28-dynamic-beta-admin-workspace-design.md`; implementation must remain within that boundary.
- Do not create `/morning-brief`, a public API, a public navigation entry, or any public-facing feature in this plan.
- Do not change Redis keys/schema, database schema, repository persistence, draft lifecycle, confirmation evaluation, market-data freshness rules, score rules, or market-data source selection.
- Do not touch Beta calculation, holdings, cash, rebalance, or operation-advice logic.
- Keep `DYNAMIC_BETA_SCORING_ENABLED`, `DYNAMIC_BETA_PUBLIC_ENABLED`, `DYNAMIC_BETA_NEWS_SCORING_ENABLED`, and `DYNAMIC_BETA_NEWS_PUBLIC_ENABLED` false.
- Preserve the exact `briefDate + draftRevisionId` mutation boundary and keep lifecycle actions unavailable for approved/rejected drafts.
- The worktree is already dirty and contains user-owned work. Do not stage, commit, switch branch, create a worktree, or rewrite unrelated files. At each task boundary, report only files changed by that task.
- Use `apply_patch` for edits. Run the narrow RED/GREEN tests shown below before moving to the next task.
- Reuse the bundled runtime when the shell cannot find Node or pnpm:

```bash
PATH="/Users/jjlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  "/Users/jjlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm" test
```

---

### Task 1: Add the workspace model and accessible section navigation

**Files:**

- Create: `src/lib/dynamic-beta/admin-workspace.js`
- Create: `app/admin/dynamic-beta/AdminWorkspaceNavigation.js`
- Create: `tests/dynamic-beta-admin-workspace.test.js`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing pure navigation tests**

Add tests for these exact exports:

```js
import {
  ADMIN_WORKSPACE_SECTIONS,
  buildAdminWorkspaceHref,
  normalizeAdminWorkspaceSection,
} from "../src/lib/dynamic-beta/admin-workspace.js";
```

Assert:

- `ADMIN_WORKSPACE_SECTIONS` contains exactly `today`, `briefs`, `confirmations`, `data`, and `more` in that order.
- absent, empty, unknown, or duplicated section input normalizes to `today`.
- every valid ID is preserved.
- `buildAdminWorkspaceHref("http://localhost:3000/admin/dynamic-beta?token=local-admin", "data")` keeps the path and token and adds `section=data`.
- changing sections replaces rather than duplicates the `section` parameter.
- URL fragments and unrelated query parameters remain intact.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/dynamic-beta-admin-workspace.test.js
```

Expected: FAIL because the workspace model does not exist.

- [ ] **Step 3: Implement the pure workspace model**

Implement immutable section metadata and URL helpers. Keep the model browser-independent by using the `URL` constructor only on the supplied string. The helper must return a same-origin path/query/hash string, not expose or log the token, and must never accept an arbitrary route target.

Expected exports are the immutable `ADMIN_WORKSPACE_SECTIONS` array shown in Step 1, `normalizeAdminWorkspaceSection(value)`, and `buildAdminWorkspaceHref(currentHref, section)`.

- [ ] **Step 4: Write and implement component behavior tests**

Use the existing SWC + React Test Renderer pattern from `tests/dynamic-beta-news-draft-ui.test.js` to load `AdminWorkspaceNavigation`. Test that:

- both desktop and mobile navigation expose the same five destinations;
- the active destination has semantic current/selected state and a text label;
- selecting a destination calls `onSelect` with the exact section ID;
- navigation controls use button semantics and have an accessible name.

Implement:

```js
export default function AdminWorkspaceNavigation({ activeSection, onSelect })
```

Render a desktop tablist and a mobile labeled navigation. CSS may hide one visual form by breakpoint, but both use the same metadata and handler. Do not use icons without labels.

- [ ] **Step 5: Add scoped navigation CSS**

Add only `.dynamicBetaAdmin*` / `.adminWorkspace*` selectors. Desktop tabs are visible above 760px; fixed mobile bottom navigation is visible at or below 760px. Add 44px minimum targets, visible `:focus-visible`, safe-area bottom padding, and no motion dependency.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-admin-workspace.test.js
```

Expected: PASS.

- [ ] **Step 7: Record the task boundary**

Run `git diff -- src/lib/dynamic-beta/admin-workspace.js app/admin/dynamic-beta/AdminWorkspaceNavigation.js tests/dynamic-beta-admin-workspace.test.js app/globals.css` and confirm no unrelated file was changed. Do not stage or commit.

---

### Task 2: Extract mutation-free morning-brief presentation components

**Files:**

- Create: `src/lib/dynamic-beta/news/brief-presentation.js`
- Create: `src/components/morning-brief/MorningBriefContent.js`
- Create: `tests/dynamic-beta-morning-brief-components.test.js`
- Modify: `src/lib/dynamic-beta/news/draft-panel-controller.js`
- Modify: `app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js`
- Modify: `tests/dynamic-beta-news-draft-ui.test.js`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing normalization and presentation tests**

Define a single read-only presentation shape that both draft and published records can produce:

```js
{
  identity: { kind, briefDate, revisionId, revisionNumber, status },
  analysis: { label, rationale },
  generatedAt,
  evidence: [],
  events: [],
}
```

Test `buildPublishedBriefPresentation(brief)` and the existing `buildDraftPreview(draft)` for:

- explicit `kind: "draft"` versus `kind: "published"`;
- all five events preserved in rank order;
- evidence URL/title/source/timestamps preserved;
- confirmation rules and `dataToConfirm` preserved byte-for-byte;
- confidence `0` remains `0` rather than becoming missing;
- null technology metrics render as `尚未公布`, not `—`;
- an empty confirmation-rule list renders `沒有設定規則`;
- absent optional fields render a specific known reason where possible.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/dynamic-beta-morning-brief-components.test.js tests/dynamic-beta-news-draft-ui.test.js
```

Expected: FAIL because the shared presenter/components do not exist.

- [ ] **Step 3: Implement the shared presenter**

Add the pure exports `buildPublishedBriefPresentation(brief)`, `knownMissingLabel(kind)`, and `formatBriefConfidence(value)` to `brief-presentation.js`.

Keep draft lifecycle timestamps, warnings, rejection reason, and published mapping in the existing draft preview as admin-only metadata. Add a `content` property using the shared shape without removing existing properties required by current tests/controllers.

- [ ] **Step 4: Implement shared read-only components**

Export these named components from `MorningBriefContent.js`:

```js
export function MorningBriefHeader({ brief, compact = false })
export function MorningBriefEventCard({ event, compact = false })
export function TechEarningsDetails({ value })
export function ConfirmationStatusBadge({ status, label })
export function ConfirmationSummary({ summary })
export default function MorningBriefContent({ brief, compact = false })
```

Requirements:

- no `use client` directive unless React behavior actually requires it;
- no token lookup, `fetch`, mutation callback, feature-flag decision, or admin module import;
- source links use `target="_blank" rel="noreferrer"`;
- event details use semantic headings/lists/details;
- status components include visible text, not color alone;
- complete view retains source data, topic IDs, transmission path, assets, market date, `dataToConfirm`, confirmation rules, interpretation, confidence, and tech-earnings fields.

- [ ] **Step 5: Recompose the existing draft panel**

Replace duplicated event/source/tech-earnings rendering inside `DailyMorningBriefDraftPanel` with `MorningBriefContent`. Keep all lifecycle controls, exact-revision selection, warnings, metadata, and controller calls in the admin component. Add a prop:

```js
export default function DailyMorningBriefDraftPanel({ compact = false })
```

`compact=true` shows current identity, analysis, publication mapping, five-event headline summary, and actions; `compact=false` shows the full shared content and admin metadata.

- [ ] **Step 6: Add scoped content styles and verify GREEN**

Add card/definition-list/link wrapping rules under `.morningBrief*`. Ensure long URLs wrap and 375px content never forces page-level horizontal overflow.

Run:

```bash
node --test tests/dynamic-beta-morning-brief-components.test.js tests/dynamic-beta-news-draft-ui.test.js
```

Expected: PASS, including existing exact lifecycle tests.

- [ ] **Step 7: Audit the shared boundary**

Run:

```bash
rg -n "admin/dynamic-beta|USAGE_ADMIN_TOKEN|token=|fetch\(|approve|reject" src/components/morning-brief
```

Expected: no matches for admin token, fetch, or lifecycle mutations. Do not stage or commit.

---

### Task 3: Build the Briefs section with distinct draft and published identities

**Files:**

- Create: `app/admin/dynamic-beta/BriefsAdminSection.js`
- Create: `src/lib/dynamic-beta/news/briefs-admin-state.js`
- Create: `tests/dynamic-beta-briefs-admin-section.test.js`
- Modify: `app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing section-state tests**

Test a pure reducer/controller that:

- stores draft and published lists independently;
- defaults to the newest available exact revision;
- preserves an exact selected published revision across refresh when still present;
- falls back deterministically when the selected revision disappears;
- retains last-successful published briefs and marks the state stale when refresh fails;
- never treats `draftRevisionId` as a published `revisionId`;
- can select and fully render the stored 2026-07-27 brief as well as 2026-07-28.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/dynamic-beta-briefs-admin-section.test.js
```

Expected: FAIL because the section/state module does not exist.

- [ ] **Step 3: Implement local published-brief state**

Add reducer events `load-started`, `load-succeeded`, `load-failed`, and `select-published`. Preserve content on failure. Use the existing authenticated `/api/dynamic-beta/news` GET route unchanged and select by exact `revisionId`.

- [ ] **Step 4: Implement `BriefsAdminSection`**

Expected interface:

```js
export default function BriefsAdminSection()
```

The section contains two clearly labeled views:

- Draft revisions: compose `DailyMorningBriefDraftPanel` with full content and existing lifecycle controls.
- Published revisions: date/revision selector plus `MorningBriefContent` created through `buildPublishedBriefPresentation`.

Show `Draft revision ID` and `Published brief revision ID` as different fields. Approved/rejected drafts remain read-only. Put warnings and lifecycle timestamps in a collapsed `管理資訊` disclosure.

- [ ] **Step 5: Test error preservation and exact identity**

With React Test Renderer and mocked `fetch`, verify:

- initial mount calls only draft and news endpoints, not market-data, score, or confirmation endpoints;
- a 7/27 published selection shows its full five events;
- a failed published refresh leaves the prior brief visible and shows `顯示上次成功讀取結果` plus retry;
- pending draft buttons still submit exact date/revision through the existing controller.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-briefs-admin-section.test.js tests/dynamic-beta-news-draft-ui.test.js tests/dynamic-beta-news-draft-routes.test.js
```

Expected: PASS. Do not stage or commit.

---

### Task 4: Isolate the Confirmations section without changing evaluation

**Files:**

- Create: `src/lib/dynamic-beta/news/confirmation-admin-state.js`
- Create: `app/admin/dynamic-beta/ConfirmationAdminSection.js`
- Create: `tests/dynamic-beta-confirmation-admin-section.test.js`
- Modify: `src/components/morning-brief/MorningBriefContent.js`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing pure summary/reducer tests**

Add tests for the exports `summarizeConfirmationResult(result)`, `confirmationQuery({ token, briefDate, revisionId, asOf })`, and `confirmationAdminReducer(state, event)`.

Assert:

- exact `briefDate`, optional `revisionId`, and `asOf` encoding;
- revision without date is rejected before fetch with the current error message;
- event counts preserve all evaluator statuses (`confirmed`, `reverse`, `unconfirmed`, `observing`, `insufficient_data`, `not_configured`);
- D3 persistence labels are not recomputed;
- failed refresh retains the prior confirmation result and marks it stale.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/dynamic-beta-confirmation-admin-section.test.js
```

Expected: FAIL because the local state and section do not exist.

- [ ] **Step 3: Implement the confirmation section**

Move the current filter and `/api/dynamic-beta/news/confirmations` read behavior from `page.js` into `ConfirmationAdminSection`. Keep the current API contract and point-in-time disclaimer. Render:

- compact aggregate `ConfirmationSummary` first;
- one collapsed event disclosure per result;
- D1 status and final/provisional text in every event summary;
- D3 persistence text;
- wide rule detail inside an explicit `.adminWideTableScroll` container.

Do not copy or alter the evaluator. Use the existing `confirmation-view.js` formatters.

- [ ] **Step 4: Add behavior tests**

Verify the section:

- does not fetch until mounted;
- sends exact filters;
- keeps prior content after a simulated 500 response;
- shows retry locally;
- renders `尚未設定確認規則` instead of an ambiguous dash for `not_configured`;
- keeps rule tables collapsed initially.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-confirmation-admin-section.test.js tests/dynamic-beta-news-confirmation-ui.test.js tests/dynamic-beta-news-confirmation.test.js
```

Expected: PASS with unchanged evaluator output. Do not stage or commit.

---

### Task 5: Build the abnormal-first Market Data section

**Files:**

- Modify: `src/lib/dynamic-beta/admin-view.js`
- Create: `app/admin/dynamic-beta/MarketDataAdminSection.js`
- Create: `tests/dynamic-beta-market-data-admin-section.test.js`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing freshness-summary tests**

Add and test the export `summarizeDynamicBetaSeries(series)`.

The return value must contain:

```js
{
  counts: { fresh, delayed, stale, never, error },
  alerts: [],
  normal: [],
}
```

Assert that every input row is counted once, only `fresh` is normal, alert ordering is `error`, `never`, `stale`, then `delayed` while preserving catalog order within a status, and no status is reclassified.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/dynamic-beta-market-data-admin-section.test.js tests/dynamic-beta.test.js
```

Expected: FAIL on the new summary API.

- [ ] **Step 3: Implement the summary helper and section-local state**

Move existing `/api/dynamic-beta/admin` and `/api/dynamic-beta/sync` behavior into `MarketDataAdminSection`. A refresh failure must leave prior series visible and label it as the last successful result. Manual sync keeps the existing POST body and failure summary.

- [ ] **Step 4: Implement responsive data presentation**

Render:

- five summary counts;
- alert cards first with name, series ID, latest value, observation date, freshness reason, retrieved time, source, and update status;
- normal rows inside a closed `所有正常資料` disclosure;
- the current detailed table on desktop;
- stacked cards on phone;
- `重新整理` and `手動同步` as the only primary controls.

Known missing values should read `沒有資料`, `尚未同步`, or `來源未提供 released/vintage` when that reason is known. Do not fabricate release or vintage dates.

- [ ] **Step 5: Add behavior tests**

Mock fetch and verify:

- mount calls only `/api/dynamic-beta/admin`;
- sync calls only the existing sync route then refreshes;
- failures preserve prior rows;
- abnormal items appear before the closed normal-data disclosure;
- summary counts match helper output.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-market-data-admin-section.test.js tests/dynamic-beta.test.js tests/dynamic-beta-routes.test.js
```

Expected: PASS. Do not stage or commit.

---

### Task 6: Move score preview, raw ingestion, flags, and diagnostics into More

**Files:**

- Modify: `app/api/dynamic-beta/admin/route.js`
- Modify: `app/api/dynamic-beta/_shared.js`
- Create: `app/admin/dynamic-beta/AdvancedToolsSection.js`
- Create: `tests/dynamic-beta-advanced-tools-section.test.js`
- Modify: `tests/dynamic-beta-routes.test.js`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing authorized feature-flag response tests**

Extend the existing admin-route tests to require this additional authorized response field:

```js
flags: {
  dataEnabled: true,
  scoringEnabled: false,
  publicEnabled: false,
}
```

Authorization must still run before feature evaluation, and the response must not include secret values or environment-variable strings. Re-export `getDynamicBetaFlags` from `_shared.js` and add the read-only field only to the already authenticated admin response.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/dynamic-beta-routes.test.js
```

Expected: FAIL because the admin response does not expose the sanitized flag booleans.

- [ ] **Step 3: Implement the minimal internal response extension**

Add `flags: getDynamicBetaFlags()` to successful `/api/dynamic-beta/admin` responses only. Do not add a route, expose names/values publicly, or change disabled/unauthorized responses.

- [ ] **Step 4: Write failing More-section tests**

Test that `AdvancedToolsSection` owns these independent tools:

- Market Risk Score v0 preview and selected date;
- News Event JSON template, validation, and internal save;
- feature status display for data/scoring/public and news data/scoring/public;
- internal-only and point-in-time limitations;
- separate errors and prior-success preservation for score, flags, and JSON operations.

Verify that nothing loads until this section mounts and no lifecycle mutation endpoints are called.

- [ ] **Step 5: Implement `AdvancedToolsSection`**

Move score preview and raw JSON logic out of `page.js` without changing request paths or bodies. Fetch authenticated admin/news status when mounted to show sanitized boolean flags. Put score details and JSON ingestion in separate closed disclosures so the section remains subordinate on phone.

Replace known missing score values with `資料不足` or `不適用`; retain `—` only for genuinely indeterminate diagnostic cells.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-advanced-tools-section.test.js tests/dynamic-beta-routes.test.js tests/dynamic-beta-score.test.js tests/dynamic-beta-news.test.js
```

Expected: PASS. Do not stage or commit.

---

### Task 7: Compose the Today daily-workflow section

**Files:**

- Create: `src/lib/dynamic-beta/today-workspace.js`
- Create: `app/admin/dynamic-beta/TodayWorkspaceSection.js`
- Create: `tests/dynamic-beta-today-workspace.test.js`
- Modify: `app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing aggregate-view tests**

Add pure `buildTodayWorkspaceModel({ drafts, briefs, confirmationResult, series })`. Test that it:

- chooses the latest relevant draft without losing exact identity;
- shows publication mapping if an approved draft has a published brief;
- returns exactly five compact event summaries from the selected brief/draft;
- includes only non-fresh market-data alerts;
- summarizes D1/D3 without changing status meanings;
- produces explicit empty states when no draft, brief, confirmation, or market data exists.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/dynamic-beta-today-workspace.test.js
```

Expected: FAIL because the Today model and component do not exist.

- [ ] **Step 3: Implement Today reads and composition**

On mount, perform authorized read-only requests in parallel to the existing draft, news, market admin, and latest-confirmation endpoints. Do not add an aggregation endpoint. Use independent settled results so one unavailable source does not erase the others.

Compose:

- persistent `內部功能；Scoring 與公開功能仍關閉` notice;
- latest draft/brief identity and compact analysis;
- exact pending approval/rejection controls through `DailyMorningBriefDraftPanel compact`;
- five event headline/summary cards with a button that calls `onOpenSection("briefs")`;
- D1/D3 aggregate with a button for `confirmations`;
- abnormal-data alert summary with a button for `data`.

Expected interface:

```js
export default function TodayWorkspaceSection({ onOpenSection })
```

- [ ] **Step 4: Preserve partial success and local errors**

Use `Promise.allSettled` or equivalent explicit handling. Show a retry beside only the failed block and retain any last-successful block on refresh. Do not use one global error string.

- [ ] **Step 5: Add component tests**

Verify:

- Today is useful when confirmations fail but draft/data reads succeed;
- only abnormal series appear;
- pending lifecycle controls remain available, approved controls remain disabled;
- section shortcuts call the correct IDs;
- no score-preview or raw-ingestion endpoint is requested.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
node --test tests/dynamic-beta-today-workspace.test.js tests/dynamic-beta-news-draft-ui.test.js tests/dynamic-beta-news-confirmation-ui.test.js
```

Expected: PASS. Do not stage or commit.

---

### Task 8: Replace the monolithic page and finish responsive/accessibility behavior

**Files:**

- Modify: `app/admin/dynamic-beta/page.js`
- Modify: `app/globals.css`
- Modify: `tests/dynamic-beta-admin-workspace.test.js`
- Modify: `tests/dynamic-beta-news-draft-ui.test.js`
- Create: `tests/dynamic-beta-admin-page-integration.test.js`

- [ ] **Step 1: Write failing page-integration tests**

Test the page source/component behavior for:

- missing/invalid `section` selects Today;
- valid query state selects exactly one mounted section;
- `popstate` restores the URL-selected section;
- selecting a section uses `history.pushState` with the existing token and new section;
- only the active section is rendered and therefore only its data loads;
- both navigation forms receive identical active state;
- no `/morning-brief` route or link is introduced.

Update the old draft UI source assertion so it checks composition through `BriefsAdminSection`/`TodayWorkspaceSection`, not the old monolithic placement.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/dynamic-beta-admin-page-integration.test.js tests/dynamic-beta-admin-workspace.test.js tests/dynamic-beta-news-draft-ui.test.js
```

Expected: FAIL while `page.js` is still monolithic.

- [ ] **Step 3: Replace `page.js` with the section shell**

The page should own only:

- JJ Invest brand header;
- normalized active section;
- URL/history synchronization and `popstate` cleanup;
- `AdminWorkspaceNavigation`;
- one active section component.

Remove all market, score, news JSON, draft history, and confirmation fetch/state from `page.js`. Do not delete their behavior; it must now live in the section components.

- [ ] **Step 4: Complete scoped responsive CSS**

Verify these layout contracts in CSS and component assertions:

- 375px: one column, fixed five-item bottom navigation, body bottom padding includes `env(safe-area-inset-bottom)`, no page-level horizontal overflow, 16px normal text, 44px controls;
- 768px: stable tablet gutters, no clipped actions, wide detail scroll confined to its container;
- 1024px and wide desktop: top tabs, bottom navigation hidden, useful two-column summaries, readable detailed tables;
- links and long IDs wrap;
- tabular numerals for dates/values/revisions;
- status styles include visible labels;
- `:focus-visible` is clear;
- reduced motion requires no special animation behavior because no essential animation is introduced.

- [ ] **Step 5: Verify component and static accessibility checks**

Run:

```bash
node --test tests/dynamic-beta-admin-page-integration.test.js tests/dynamic-beta-admin-workspace.test.js tests/dynamic-beta-morning-brief-components.test.js
```

Expected: PASS.

- [ ] **Step 6: Manually verify the four approved widths**

Start the existing dev server and inspect:

```text
http://localhost:3000/admin/dynamic-beta?token=local-admin
http://localhost:3000/admin/dynamic-beta?token=local-admin&section=briefs
http://localhost:3000/admin/dynamic-beta?token=local-admin&section=confirmations
http://localhost:3000/admin/dynamic-beta?token=local-admin&section=data
http://localhost:3000/admin/dynamic-beta?token=local-admin&section=more
```

At 375, 768, 1024, and wide desktop widths confirm no page-level horizontal overflow, all five destinations are reachable, lifecycle buttons remain exact-revision safe, and every section has local loading/error feedback. Do not stage or commit.

---

### Task 9: Run the regression, isolation, and production-readiness gate

**Files:**

- Modify only if a verification failure reveals an in-scope defect.

- [ ] **Step 1: Run focused Dynamic Beta tests**

```bash
node --test tests/dynamic-beta*.test.js
```

Expected: all Dynamic Beta market, route, score, draft, news, confirmation, backtest, and UI tests pass.

- [ ] **Step 2: Run the full test suite**

```bash
node --test
```

Expected: all existing and new tests pass, including portfolio, Beta, holdings, cash, rebalance, and operation-advice regression tests.

- [ ] **Step 3: Run lint**

```bash
PATH="/Users/jjlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  "/Users/jjlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm" lint
```

Expected: exit 0 with no new lint errors.

- [ ] **Step 4: Run production build**

```bash
PATH="/Users/jjlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  "/Users/jjlin/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm" build
```

Expected: exit 0; `/admin/dynamic-beta` builds; no `/morning-brief` route appears.

- [ ] **Step 5: Audit the isolation boundaries**

Run:

```bash
rg -n "admin/dynamic-beta|USAGE_ADMIN_TOKEN|drafts/(approve|reject)|news/validate" src/components/morning-brief
rg -n "MorningBriefContent|AdminWorkspace" app/page.js app/components src/lib -g '*.js'
rg -n "DYNAMIC_BETA_(SCORING|PUBLIC)_ENABLED|DYNAMIC_BETA_NEWS_(SCORING|PUBLIC)_ENABLED" .env.local vercel.json 2>/dev/null
```

Expected:

- shared components have no admin imports, token access, or mutations;
- public App code has no new admin workspace import;
- all scoring/public flags remain false;
- no public route/API was added.

- [ ] **Step 6: Review the final diff without staging**

Use `git diff --` on every planned modified file and `git status --short`. Confirm unrelated pre-existing changes remain untouched. Report:

- files created/modified;
- tests, lint, and build results;
- 375/768/1024/desktop verification results;
- confirmation that Redis/API/lifecycle rules did not change except the sanitized authorized admin flag field;
- confirmation that scoring/public behavior remains disabled;
- confirmation that no production App behavior changed.

Do not continue into public morning-brief development or Dynamic Beta scoring.
