# Dynamic Beta 07:00 Market Sync and Confirmation Snapshots Design

## Status

Approved in conversation on 2026-07-29. This design adds one internal, weekday 07:00 Asia/Taipei data pipeline. It does not calculate Dynamic Beta, change portfolio behavior, or publish content.

## Goal

Every weekday at 07:00 Asia/Taipei, reuse the existing local morning-brief automation to:

1. synchronize the existing automatically managed FRED and Yahoo market series;
2. ingest the MacroMicro Taiwan TAIEX margin-maintenance ratio from the one approved public chart;
3. calculate and persist immutable D1/D3 confirmation snapshots for recent approved morning briefs whose D3 tracking is not complete; and
4. continue with the existing pending morning-brief draft workflow.

The saved snapshot must preserve what the internal system concluded at that scheduled run. Reloading an admin page must not be required to create it.

## Non-goals

- Do not calculate Dynamic Beta, Market Risk Score, or Crash Risk Score.
- Do not change Target Beta, tolerance bands, holdings, cash, rebalancing, or trading advice.
- Do not expose a public route or public UI.
- Do not approve, reject, or publish a morning brief automatically.
- Do not add another data vendor, npm dependency, relational table, or database migration.
- Do not claim that the snapshot is a true point-in-time vintage backtest.

## Scheduling Decision

There is one scheduled execution only: the existing Codex automation `jj-invest-2`, Monday through Friday at 07:00 Asia/Taipei.

The existing Vercel schedule currently calls `/api/dynamic-beta/cron` at 05:00 UTC (13:00 Asia/Taipei), before the Taiwan market closes. That schedule must be removed from `vercel.json` so it does not create a second daily run. The protected cron route remains available for a future deployment architecture or manual operations.

The Codex automation recurrence must explicitly use Asia/Taipei and continue targeting the existing local project. No duplicate automation is created.

## Architecture

### Automation boundary

The Codex automation remains the only component that reads the MacroMicro webpage. It first opens:

`https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin`

It creates the already-approved exact success or fixed failure JSON in a temporary file. It then invokes one new server-side daily-pipeline CLI with that file. The CLI does not browse the web and does not require `next dev` to be running.

After the CLI returns, the automation continues the existing news research and pending-draft submission flow, regardless of whether the data pipeline reports success, partial success, or failure.

### Daily pipeline

The CLI executes these stages sequentially:

1. **Automatic market sync:** call the existing Dynamic Beta sync service. Its existing external-series filter keeps MacroMicro out of FRED/Yahoo routing. Per-series failures remain isolated.
2. **MacroMicro ingestion:** pass the temporary payload to the existing strict MacroMicro ingestion service. The shared sync lock is acquired and released by each sequential service call, so the two stages never write concurrently.
3. **Confirmation selection:** read approved morning-brief revisions from the existing News Event repository, keep briefs whose `briefDate` is within the inclusive ten-calendar-day lookback, and exclude revisions whose latest saved snapshot is complete.
4. **Confirmation evaluation:** call the existing confirmation service for each selected exact brief revision using the current Asia/Taipei date as `asOf`.
5. **Snapshot persistence:** normalize the evaluation into a content-addressed immutable record and save it atomically.

The pipeline emits one sanitized JSON summary containing stage statuses and snapshot counts. It exits zero for `success` or `partial`; only invalid arguments, disabled required feature flags, missing repositories, or another fatal orchestration failure exit nonzero. The automation contract still requires continuing to pending-draft creation after any pipeline outcome.

## Feature Gates and Configuration

The pipeline requires:

- `DYNAMIC_BETA_DATA_ENABLED=true`
- the existing News Data flag enabled
- existing Upstash Redis configuration
- `FRED_API_KEY` for FRED series

`DYNAMIC_BETA_SCORING_ENABLED` and `DYNAMIC_BETA_PUBLIC_ENABLED` remain false. No new environment variable is introduced. All credentials remain server-side and the CLI never prints them.

If the FRED key or an upstream source is unavailable, the affected stage reports a sanitized failure and later stages may still evaluate using previously stored observations. No historical observation is deleted.

## Snapshot Selection and Completion

The lookback is the inclusive interval from the current Asia/Taipei date minus ten calendar days through the current date.

Each approved News Event morning-brief revision is tracked independently. A later approved revision for the same `briefDate` starts its own snapshot history and does not replace an earlier approved revision.

An event with no configured confirmation rule is terminal as `not_configured` or `insufficient_data` and does not block the brief from completing. A configured rule is terminal when one of these conditions holds:

- D3 has an actual stored observation, even when calculation is impossible because of an invalid numeric baseline;
- the rule is structurally unevaluable because its series is unknown or its frequency is unsupported.

A configured rule remains pending when it is awaiting an observation, is missing history that may still arrive, or is delayed/stale without a D3 observation. A brief snapshot is complete only when every configured rule is terminal. Incomplete briefs remain eligible until they leave the ten-day lookback; no inferred observation is created after expiry.

## Immutable Snapshot Model

### Identity

A snapshot belongs to:

- exact approved morning-brief `revisionId`;
- `briefDate`;
- Asia/Taipei `asOf` date; and
- a content-derived snapshot revision ID.

The content hash excludes volatile run fields such as `evaluatedAt`. It includes the exact brief revision, normalized event results, rule inputs, baseline and D1/D3 observation revision identities, values, dates, and retrieval metadata.

### Saved record

Each immutable record contains:

- `snapshotId` and monotonic `snapshotRevisionNumber` within the brief revision plus `asOf` date;
- `briefDate`, morning-brief `revisionId`, and morning-brief `revisionNumber`;
- `asOf`, `evaluatedAt`, and `createdAt`;
- normalized event, rule, D1, D3, and persistence results;
- baseline and observation dates, values, retrieval timestamps, and stored market-data revision IDs;
- completion state and pending reasons;
- metadata with `vintageMode: "latest_stored_revision_by_observation_date"` and `truePointInTime: false`.

The record stores no credentials and no raw upstream error text.

### Idempotency and revisions

- Same brief revision, same `asOf`, and identical normalized content returns `unchanged` without creating a second record.
- Changed content for the same brief revision and `asOf` creates a new immutable snapshot revision.
- A later `asOf` always has a distinct daily snapshot history.
- Earlier snapshot payloads are never overwritten.

### Redis keys

Use the existing News Event namespace with a dedicated subtree:

`jj-invest-public:dynamic-beta:news:v1:confirmation-snapshot:*`

The repository maintains an immutable revision record, a per-brief/per-`asOf` revision set, a latest pointer, a revision counter, and a timeline index. Creation, revision-number allocation, latest-pointer update, and index writes must use one Redis Lua operation through the existing atomic-script helper. Reads must ignore incomplete/uncommitted records.

No SQL table or migration is added.

## Components and Interfaces

### Snapshot repository

A dedicated repository owns Redis keys and exposes:

- `saveSnapshot(snapshot)`
- `readLatestSnapshot({ briefDate, revisionId, asOf? })`
- `readSnapshotRevisions({ briefDate, revisionId, asOf })`
- `readRecentLatestSnapshots({ since, until, limit })`

### Snapshot service

A service depends on the existing News Event repository, market-data repository, confirmation service, and new snapshot repository. It exposes:

- `run({ asOf, lookbackDays: 10 })`
- `evaluateAndSave({ briefDate, revisionId, asOf })`

The service selects exact approved brief revisions, evaluates them once per run, computes completion, and persists every fully constructed normalized payload, including snapshots whose tracking state is still pending. It never persists a partially assembled payload.

### Daily pipeline CLI

Add a package script and server-side executable that accepts exactly one MacroMicro payload file. It loads `.env.local` through the Node `--env-file` mechanism used by the automation, validates feature flags before constructing services, and returns only a safe summary.

### Internal snapshot API

Add a separate admin-only read route for saved snapshots. It must authorize with the existing admin token before checking flags or constructing Redis services. The existing confirmation endpoint remains a read-only live Preview and must not gain write side effects.

## Admin Experience

The internal Confirmations workspace defaults to the latest saved 07:00 snapshot for the selected approved morning-brief revision. It displays:

- snapshot `asOf`, calculation time, revision number, and complete/pending state;
- per-event D1, D3, and persistence;
- per-rule observation dates and values;
- explicit missing-data or not-configured reasons.

The existing live evaluator remains available as a clearly labeled manual Preview. A Preview is never saved automatically. Draft controls, public pages, and investment screens are unchanged.

## Error Handling and Logging

Each pipeline stage returns `success`, `partial`, `error`, or `skipped_locked`. A failure in one stage does not erase older observations or snapshots and does not prevent the automation from continuing to the pending morning brief.

Logging may include fixed event names, stage, series ID, brief revision ID, `asOf`, counts, and fixed error codes. It must not include environment values, API keys, Redis tokens, request payload contents, arbitrary exception messages, or source HTML.

Lock contention is a safe skip. Snapshot construction happens entirely before the atomic write, so an evaluation failure cannot expose a partial snapshot.

## Testing

Required automated coverage:

- ten-day approved-brief selection and exact revision identity;
- D3 terminal and pending rules, including no-rule events and missing observations;
- content-hash idempotency and same-day immutable revisions;
- atomic first-write, concurrent revision allocation, and retry after injected Redis failure;
- preservation of observation revision IDs and retrieval metadata;
- automatic FRED/Yahoo isolation from MacroMicro;
- sequential shared-lock behavior and lock contention;
- per-stage partial/error continuation and sanitized CLI output;
- protected snapshot API authorization and flag ordering;
- saved-snapshot admin rendering and manual Preview separation;
- automation contract order and removal of the competing Vercel schedule;
- regression coverage proving scoring, public, portfolio, cash, rebalance, and advice paths do not import the pipeline.

Run the full project test suite, ESLint, production build, and `git diff --check`.

## Rollout and Live Verification

After automated verification:

1. update the existing `jj-invest-2` automation in place with an explicit weekday 07:00 Asia/Taipei recurrence and the approved pipeline order;
2. do not create a second automation;
3. run the pipeline manually once with the current MacroMicro payload;
4. verify an immutable snapshot is saved for the approved 2026-07-29 morning brief;
5. rerun the same input and verify `unchanged`;
6. verify the admin Confirmations workspace shows the saved snapshot and the existing live Preview remains separate;
7. verify scoring and public flags remain disabled and no draft lifecycle state changes.

The live smoke test may create confirmation snapshot records only. It must not approve, reject, publish, score, rebalance, or modify user portfolio data.

## Acceptance Criteria

- Exactly one weekday 07:00 Asia/Taipei automation runs the combined data and draft workflow.
- FRED/Yahoo, MacroMicro, confirmation snapshot, and draft stages are independently observable and failure-isolated.
- Recent approved briefs receive immutable, revisioned, reproducible D1/D3 daily snapshots without requiring a page view.
- Same-input reruns are idempotent; changed same-day results append revisions.
- The 2026-07-29 approved brief passes the live inserted-then-unchanged smoke test.
- Existing public and investment behavior is unchanged.
