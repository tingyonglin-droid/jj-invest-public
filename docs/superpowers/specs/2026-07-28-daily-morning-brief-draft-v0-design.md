# Daily Morning Brief Draft v0 Design

## Objective

Add an internal, human-approved draft workflow in front of the existing News Event morning-brief ingestion and D1/D3 market-confirmation system. Codex searches current information outside the application, prepares one structured five-event draft, and saves it into the existing Redis instance. An administrator must explicitly approve that draft before it becomes an immutable morning-brief revision that the existing confirmation service can read.

This phase will first produce a draft for `2026-07-28`. It does not add an in-app news provider, an AI provider, news scoring, Market Risk Score integration, Dynamic Beta calculation, Target Beta changes, trading advice, or public UI.

## Approved Approach

Use a separate Redis-backed draft lifecycle.

```text
Codex current-news research
  -> structured five-event payload
  -> admin-only draft API
  -> immutable pending draft revision in Redis
  -> internal preview
  -> explicit human approval
  -> existing News Event ingestion service
  -> immutable approved morning-brief revision
  -> existing read-only D1/D3 confirmation service
```

A pending draft is not a morning brief. It must not appear in the existing recent-brief list or be selectable by the confirmation endpoint until approval succeeds.

## Boundaries

- Reuse the existing Upstash Redis configuration, News Event payload validator, evidence deduplication, morning-brief repository, admin-token authorization, and feature flags.
- Do not add a third-party news API, web crawler, OpenAI/AI SDK, scheduled job, database table, or environment variable.
- Codex remains responsible for current-news research and for submitting a structured draft through the internal endpoint.
- The application stores, validates, previews, approves, and rejects drafts; it does not create or rewrite their editorial content.
- Only approved drafts enter the existing morning-brief and D1/D3 paths.
- Do not import the draft module from public pages, portfolio calculations, Beta calculations, rebalance logic, cash logic, or recommendation logic.
- Keep `DYNAMIC_BETA_SCORING_ENABLED`, `DYNAMIC_BETA_NEWS_SCORING_ENABLED`, `DYNAMIC_BETA_PUBLIC_ENABLED`, and `DYNAMIC_BETA_NEWS_PUBLIC_ENABLED` false.

## Alternatives Considered

### Redis-backed pending drafts — selected

Drafts are available from mobile and survive process restarts. The approval boundary is explicit, and the existing immutable published-brief repository remains unchanged.

### Local JSON artifacts only

This is simpler, but drafts are tied to the development workspace, are inconvenient to inspect from mobile, and can be lost before approval.

### Directly save generated content as a morning brief

This reuses the fewest components but has no genuine approval boundary. It could expose an unreviewed event set to the existing confirmation workflow.

## Draft Data Model

Each draft revision stores:

- `draftId`: stable identifier derived from `briefDate`.
- `draftRevisionId`: content-addressed immutable identifier for the normalized payload.
- `draftRevisionNumber`: increasing display number within the date.
- `briefDate`.
- `status`: `pending`, `approved`, or `rejected`.
- `createdAt` and `updatedAt`.
- `approvedAt` or `rejectedAt`, otherwise `null`.
- `approvedBriefRevisionId` and `approvedBriefRevisionNumber`, otherwise `null`.
- `validationWarnings`: schema warnings recorded when the draft is created.
- `dedupeWarnings`: likely duplicate-evidence warnings recorded when approval runs the existing ingestion service; empty before approval.
- `payload`: the normalized morning-brief payload accepted by the existing validator.

The normalized payload retains the existing fields:

- Evidence URLs, source names, source tiers, titles, summaries, publication timestamps, and retrieval timestamps.
- Exactly five ranked events.
- Event summaries, topic IDs, transmission paths, affected assets, interpretations, confidence, and optional technology-earnings fields.
- Explicit `marketDate`, `dataToConfirm`, and deterministic confirmation rules.
- The qualitative `analystLabel` and rationale, which remain separate from quantitative scores.

Missing publication timestamps or financial values remain `null`; the system never invents them.

## Identity and Revision Rules

- There is one stable `draftId` per `briefDate`.
- Every distinct normalized payload creates or reuses a content-addressed immutable draft revision.
- Submitting an identical payload is idempotent and returns `unchanged`.
- Submitting changed content creates a new pending revision without overwriting earlier revisions.
- The latest pending revision is the default preview for a date. When no pending revision exists, the most recently submitted reviewed revision is the fallback.
- Approving an older explicit revision is allowed only when the caller supplies its exact `draftRevisionId`; the response makes the selected revision clear.
- Approval or rejection records lifecycle metadata without rewriting the stored payload.
- Once a revision is approved or rejected, that revision cannot return to `pending`.
- A later corrected payload becomes a new draft revision and can be approved as a new published morning-brief revision through the existing append-only behavior.

## Approval Semantics

Approval is an explicit admin action, not an automatic side effect of validation.

The approval service performs these steps:

1. Read the exact draft revision requested by the administrator.
2. Require its status to be `pending`.
3. Revalidate the stored payload with the existing News Event validator.
4. Pass the payload to the existing News Event ingestion service so evidence deduplication and immutable morning-brief revision logic remain authoritative.
5. Mark the draft revision `approved` and store the resulting published brief identity plus any evidence deduplication warnings returned by ingestion.
6. Return both draft and published-brief identities.

Approval must be idempotent. Repeating approval for an already approved draft returns its recorded published identity and must not create another morning-brief revision.

If morning-brief ingestion fails, the draft remains `pending`. The system must not mark a draft approved before the existing ingestion service reports success. Because Redis does not provide a cross-service database transaction here, the approval service must also recover safely if publishing succeeded but lifecycle metadata failed: a retry relies on the content-addressed published revision and then completes the draft status update without duplicating content.

Rejection changes only the selected pending draft revision to `rejected`. It does not delete the draft, its evidence, another revision, or any approved morning brief. An optional short rejection reason may be stored as internal metadata.

## Redis Storage

Use a separate prefix under the existing News Event namespace, for example:

```text
jj-invest-public:dynamic-beta:news:v1:draft:<briefDate>:current
jj-invest-public:dynamic-beta:news:v1:draft:<briefDate>:revision:<draftRevisionId>
jj-invest-public:dynamic-beta:news:v1:draft:<briefDate>:revisions
jj-invest-public:dynamic-beta:news:v1:draft:timeline
```

The exact key helpers remain private to the repository. Draft payload revisions are append-only. Lifecycle fields may be updated on the revision record because they describe review state rather than replacing editorial content.

No draft key is read by the existing morning-brief repository or confirmation service.

## Internal API

All routes require the existing admin-token authorization and `DYNAMIC_BETA_NEWS_DATA_ENABLED=true`.

### `GET /api/dynamic-beta/news/drafts`

Lists recent draft revisions. Optional query parameters select a `briefDate` or exact `draftRevisionId`. The response includes status, timestamps, the normalized payload, validation warnings, and approved morning-brief identity when present.

### `POST /api/dynamic-beta/news/drafts`

Validates and saves a structured payload as a pending immutable draft revision. Validation errors return 400 and write nothing. A valid submission does not publish a morning brief.

### `POST /api/dynamic-beta/news/drafts/approve`

Accepts `briefDate` and `draftRevisionId`. It performs the approval flow and returns the resulting morning-brief revision. Missing drafts return 404; non-pending incompatible states return 409; malformed input returns 400.

### `POST /api/dynamic-beta/news/drafts/reject`

Accepts `briefDate`, `draftRevisionId`, and an optional short reason. It changes a pending revision to rejected. Missing drafts return 404 and incompatible states return 409.

Unexpected Redis or service failures return 500 with server-side logging. Error responses must not reveal secrets or full source payloads.

## Internal Validation View

Add a `今日晨報草稿` section to the existing `/admin/dynamic-beta?token=...` page. It is not linked from public navigation.

The section displays:

- Brief date, draft revision number, and status.
- Generated and last-updated times.
- Overall qualitative label and rationale.
- Five ranked event cards.
- For each event: headline, summary, source links, topic, transmission path, affected assets, market date, data-to-confirm series, explicit confirmation rules, interpretation, and confidence.
- Validation warnings and likely duplicate evidence warnings when available.
- The published morning-brief revision after approval.

Available actions:

- Refresh recent drafts.
- Select a draft revision.
- Approve and publish a pending revision.
- Reject a pending revision with an optional reason.

The page must clearly state that approval publishes data only to the internal News Event system and does not enable scoring, Dynamic Beta, or public features. Approval and rejection require a confirmation prompt and disable repeated clicks while a request is running.

The existing raw JSON validation/save tool remains available for debugging, but the draft preview becomes the normal approval path.

## Creating the 2026-07-28 Draft

After the draft workflow passes verification, Codex will:

1. Search current information for the Taiwan morning of `2026-07-28`, prioritizing primary and reputable sources.
2. Select the five events with the clearest relevance to the broad market, rates, liquidity, AI/semiconductors, and Taiwan technology supply chain.
3. Separate sourced facts from analyst interpretation.
4. Add explicit, catalog-valid market confirmation rules only when the event thesis has a meaningful observable proxy.
5. Leave uncertain publication times or financial figures `null`.
6. Validate locally and submit the payload to the admin-only draft endpoint.
7. Stop at `pending` so the user can inspect and approve it.

Creating this initial draft requires current web research, but no web-search capability or credentials are added to the application.

## Feature Isolation

- Required: `DYNAMIC_BETA_NEWS_DATA_ENABLED=true` plus the existing admin token and Redis configuration.
- Remain disabled: all scoring and public feature flags.
- Draft route failures cannot prevent existing market-data synchronization, portfolio reads, Beta calculations, cash handling, rebalancing, or recommendations.
- A draft does not trigger confirmation evaluation, because only the existing approved morning-brief repository is visible to the confirmation endpoint.
- No cron integration is included in v0.

## Testing and Verification

### Repository tests

- First draft insertion.
- Identical submission is idempotent.
- Changed content creates an immutable new revision.
- Earlier revisions remain readable.
- Current pending revision selection.
- Approval and rejection lifecycle updates preserve payloads.
- Approved published identity remains readable.

### Service tests

- Invalid payload writes nothing.
- Valid payload saves as pending only.
- Approval revalidates and delegates to the existing ingestion service.
- Approval is idempotent.
- Publishing failure leaves the draft pending.
- Retry after partial lifecycle-update failure does not duplicate the published brief.
- Rejection cannot publish data.
- Rejected or incompatible revisions return conflicts.

### Route tests

- Authentication and feature-flag enforcement.
- 400, 404, 409, and 500 mappings.
- No secret leakage in errors.
- A pending draft is absent from the existing morning-brief and confirmation endpoints.
- An approved draft appears as the expected immutable morning-brief revision.

### Admin view tests

- Loading and selecting revisions.
- Complete five-event preview.
- Pending, approved, rejected, loading, and error states.
- Approval/rejection confirmation and duplicate-click protection.
- Published revision link or identifier display.

### Regression verification

- Existing News Event, D1/D3 confirmation, market-data, Market Risk Score preview, and full application tests remain passing.
- Lint and production build pass.
- The public application contains no draft navigation or data.
- Existing Beta, holdings, cash, rebalance, and recommendation behavior is unchanged.

## Completion Boundary

The phase is complete when the internal draft workflow is verified and a valid `2026-07-28` draft is visible as `pending` in the admin page. The user, not Codex or the application, decides whether to approve it. Work stops before news scoring or any Dynamic Beta integration.
