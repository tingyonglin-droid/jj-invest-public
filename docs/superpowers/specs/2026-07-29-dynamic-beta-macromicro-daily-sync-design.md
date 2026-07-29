# Dynamic Beta MacroMicro Daily Sync Design

## Scope

Extend only the internal Dynamic Beta market-data module with a daily Taiwan margin-maintenance observation sourced from MacroMicro. Do not calculate or modify Dynamic Beta, Market Risk Score, Crash Risk Score, Target Beta, tolerance bands, holdings, cash, rebalancing, trading advice, public UI, or existing user data.

The synchronization supplies market data only. It does not automatically change the pending 2026-07-29 morning brief or assign a D1/D3 direction. Future approved morning briefs may reference the new series through the existing confirmation framework.

## Source and Series

Use the public MacroMicro chart at `https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin` as the sole source for the displayed Taiwan margin-maintenance ratio.

Register one enabled series in the existing catalog:

- `series_id`: `MACROMICRO:TAIEX_MARGIN_MAINTENANCE`
- `name`: `Taiwan TAIEX Margin Maintenance Ratio`
- `category`: `market_stress`
- `source`: `MacroMicro`
- `frequency`: `Daily`
- `unit`: `Percent`
- freshness policy: fresh through 1 completed weekday, delayed through 2, stale afterward

The morning brief displays only the MacroMicro value. It does not display or compare the Financial Supervisory Commission whole-account collateral-maintenance ratio.

## Architecture

MacroMicro currently blocks ordinary server-side retrieval in some environments, so Vercel Cron will not scrape the page. The existing weekday 07:00 Asia/Taipei local Codex automation performs the browser read before it generates the morning brief.

The implementation has four isolated units:

1. A pure MacroMicro observation normalizer validates a fixed series ID, an ISO observation date, a finite percentage, and an explicit retrieval timestamp.
2. A small ingestion service writes the normalized observation through the existing Dynamic Beta repository and updates the standard per-series status fields.
3. An admin-only route accepts exactly one MacroMicro observation for manual testing. It reuses the existing admin authorization and `DYNAMIC_BETA_DATA_ENABLED` feature flag and never accepts arbitrary series IDs.
4. A local CLI writes through the same ingestion service directly to the configured Redis repository, matching the existing morning-brief submission pattern and avoiding any requirement that the Next.js development server be running. The Codex automation calls this CLI before creating the daily morning-brief draft.

No new database or Redis schema is introduced. The existing metadata, observation-date index, current-value pointer, immutable revision, status, and sync-lock structures are reused.

## Data Contract

For a successful read, the local automation submits:

```json
{
  "observationDate": "2026-07-28",
  "value": 140.38,
  "sourceUrl": "https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin"
}
```

When the page cannot be read reliably, the automation submits a fixed failure code instead of a value:

```json
{
  "errorCode": "LATEST_DATA_MISSING",
  "sourceUrl": "https://www.macromicro.me/charts/53117/taiwan-taiex-maintenance-margin"
}
```

Allowed failure codes are `PAGE_UNAVAILABLE`, `LATEST_DATA_MISSING`, and `INVALID_PAGE_VALUE`. The service maps each code to a fixed sanitized status message; it does not persist arbitrary page text.

The ingestion service assigns `retrieved_at`. `released_at`, `source_realtime_start`, and `source_realtime_end` remain null because MacroMicro does not provide reliable values for those fields on the public chart.

The shared validator used by both the route and CLI rejects:

- malformed JSON or a payload that mixes success and failure fields;
- any source URL other than the exact approved MacroMicro chart URL;
- for a success payload, a missing or invalid observation date, a date later than the current Asia/Taipei calendar date, or a non-finite value outside the defensive range 100–500 percent;
- for a failure payload, a missing or unsupported `errorCode`;
- an unauthorized request or a disabled data feature flag.

The defensive value range detects page-layout parsing mistakes; it is not a market interpretation threshold.

## Revision and Duplicate Handling

The existing repository remains authoritative:

- same date and same value: no new revision; update the latest observation's `last_seen_at`;
- same date and changed value: create a new immutable revision and make it current;
- new date: create a new observation revision;
- never invent the previous observation's date from MacroMicro's unlabeled `前值` display.

This preserves forward point-in-time history without claiming that the initial sync contains older observations.

## Scheduling

Run only Monday through Friday at 07:00 Asia/Taipei as part of the existing local Codex morning-brief automation:

1. open the approved MacroMicro chart;
2. read the latest date and value from the visible `最新數據` section;
3. submit the observation through the local CLI;
4. report success, unchanged data, or failure;
5. continue to morning-brief generation even when MacroMicro synchronization fails.

Taiwan market holidays may return the same observation date. That is a successful unchanged sync, not an error. Freshness evaluation determines whether the observation is delayed or stale.

The existing Vercel Cron continues to synchronize FRED and Yahoo. It does not call MacroMicro and requires no additional environment variable.

## Failure Isolation and Logging

MacroMicro failure must not fail the FRED/Yahoo synchronization or block morning-brief draft creation. A reported source-read failure writes the standard series status as `error` with a fixed sanitized message when storage is available. Invalid, unauthorized, or feature-disabled requests do not write anything. The CLI exits non-zero for both reported source failures and submission failures and prints a concise error without exposing the admin token or Redis credentials.

The automation must not substitute the previous value as if it were newly observed. The admin Data section continues to show the stored observation date, retrieval time, freshness, last-success time, and error status.

## D1/D3 Boundary

This change makes `MACROMICRO:TAIEX_MARGIN_MAINTENANCE` available to the existing news-confirmation schema. It does not automatically add a confirmation rule to every event. A future event may explicitly expect the ratio to move down and define a threshold; the existing D1/D3 engine then reads the stored history like any other catalog series.

The 130% level may be described as a high deleveraging or forced-selling pressure reference. It must not be encoded as a guaranteed market-bottom rule.

## Verification

Tests cover catalog registration, normalization, defensive validation, exact-source enforcement, duplicate/revision behavior through the repository, ingestion status updates, admin authorization, feature-flag isolation, CLI payload handling, and failure isolation. Run the focused tests first, then the full test suite, lint, and production build. Perform one live MacroMicro read and manual ingestion, then verify the Data admin view displays the observation without changing any scoring or public feature flag.
