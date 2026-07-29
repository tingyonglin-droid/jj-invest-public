# Dynamic Beta Freshness, Cron, and Vintage Design

## Scope

Extend only the internal Dynamic Beta market-data module. Do not enable scoring or public features and do not change portfolio, cash, beta, rebalance, or advice behavior.

## Freshness

Each series declares a freshness policy. Yahoo daily market observations use weekday-aware age. FRED daily observations allow a short publication lag; FRED monthly observations use a series-specific release lag measured from the end of the next observation month, because a monthly value remains current until its successor is due. The evaluator returns `fresh`, `delayed`, `stale`, `never`, or `error`, plus age, threshold, and a human-readable reason. Weekends do not make daily observations stale.

Policies:

- Yahoo daily market series: fresh through 1 completed weekday, delayed through 2, stale afterward.
- FRED daily series: fresh through 2 completed weekdays, delayed through 4, stale afterward.
- UNRATE and PAYEMS: after the next observation month ends, fresh through day 12 and delayed through day 20.
- CPILFESL: after the next observation month ends, fresh through day 18 and delayed through day 25.
- PCEPILFE: after the next observation month ends, fresh through day 35 and delayed through day 45.

These thresholds measure whether the stored data is plausibly current, not whether the underlying economic condition is current.

## Forward Vintage Strategy

No ALFRED history backfill is performed. Every changed value creates an immutable revision containing value, retrieval time, the FRED realtime query boundaries first seen with that value, and `first_seen_at`/`last_seen_at`. Re-fetching the same value updates only `last_seen_at`; it does not create a fake revision. FRED realtime query boundaries are audit metadata, not a revision identity. `released_at` remains null unless the source supplies a reliable timestamp; observation dates and realtime dates are not treated as release timestamps.

## Scheduling and Security

Add a Vercel Cron GET endpoint invoked daily at `0 5 * * *` (05:00 UTC / 13:00 Asia/Taipei). It requires `Authorization: Bearer $CRON_SECRET`, the data feature flag, Redis, and the server-only FRED key. The existing distributed lock prevents overlap. The existing admin POST route remains available for manual synchronization.

## Internal Validation

The admin API and page expose freshness state, reason, age/threshold, release timestamp when present, source realtime boundaries, and first/last seen timestamps. This remains protected by the existing admin mechanism.

## Verification

Unit tests cover weekend-aware freshness, series-specific monthly windows, immutable revisions, last-seen updates, cron authorization, and feature-flag isolation. Run the full test suite, lint, build, and a local endpoint check.
