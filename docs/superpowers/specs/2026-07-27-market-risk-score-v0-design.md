# Market Risk Score v0 Design

## Scope and isolation

Build a deterministic, administrator-only, offline preview on top of Dynamic Beta observations. `DYNAMIC_BETA_SCORING_ENABLED` and `DYNAMIC_BETA_PUBLIC_ENABLED` remain false. The preview is never scheduled, persisted as a production signal, connected to Target Beta, or consumed by portfolio/rebalance/advice code.

## Model

The score ranges from 0 to 100, where higher means greater market risk. It contains five weighted categories: volatility 25%, market trend 30%, credit 20%, rates 10%, and macro 15%. Each signal maps a derived numeric value to one of 0/25/50/75/100 using versioned fixed thresholds. Every result includes source series, observation dates, raw derived value, score, weight, and explanation.

Signals are VIX level/change; SPY 20/60-day return and 252-day drawdown; QQQ and SOXX 20-day relative return; high-yield OAS level/change; 10Y-2Y curve and 2Y/10Y absolute 20-day moves; unemployment 3-month change; payroll 3-month average monthly gain; and Core CPI/Core PCE year-over-year inflation.

## Missing and stale data

Preview inputs are stored observations as of the requested date. A signal without sufficient history is unavailable. Available signal weights are renormalized inside the total. A total score is emitted only when at least 70% of model weight is available; otherwise total score is null. Results expose coverage and `complete`, `partial`, or `insufficient` status. Historical macro preview is explicitly labelled `revised-data`, because pre-existing ALFRED vintages were not backfilled.

## Interfaces

The repository reads current revisions over a date range without changing data. A pure scoring service receives per-series histories and an as-of date. An admin-token-protected GET route calculates preview output only when the Dynamic Beta data module is enabled. The internal validation page may call it manually; it does not depend on the scoring activation flag.

## Verification

Tests lock threshold boundaries, as-of filtering, category weights, coverage behavior, route isolation, and the absence of any imports from production portfolio/rebalance/advice modules.
