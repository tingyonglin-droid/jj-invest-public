# News Event × Market Data Confirmation v0 Design

## Objective

Add an internal, deterministic confirmation layer between structured morning-brief events and the existing Dynamic Beta market-data repository. For every event, the module reads explicitly configured market series and reports whether the observed market move confirmed the event thesis, failed to confirm it, or moved in the opposite direction.

This phase does not calculate a news score, Market Risk Score, Crash Risk Score, Dynamic Beta, Target Beta, or any trading action. It does not change the public application or any existing portfolio, cash, rebalance, or recommendation behavior.

## Design Principles

- Every expected direction, comparison unit, and threshold is explicit event data. The application never infers these rules from prose.
- Rules are deterministic and stored in the immutable morning-brief revision so that the same brief and market observations produce the same result.
- The existing FRED and Yahoo market-data repository is the only data source.
- Confirmation is read-only and internal. A failure in this module cannot block or alter production investment behavior.
- Historical briefs that only contain `dataToConfirm` string identifiers remain readable.

## Scope

### Included

- Structured confirmation rules on news events.
- Previous-observation baseline plus one-session and three-session evaluation.
- Per-series and per-event confirmation output.
- An admin-token-protected read API.
- A small internal validation section on `/admin/dynamic-beta`.
- Unit, service, route, compatibility, and regression verification.

### Excluded

- Automatic news collection or AI interpretation.
- Automatic inference of direction or threshold.
- Any score or weighted score.
- Changes to Market Risk Score v0 or Dynamic Beta.
- Public UI or public API exposure.
- New providers, cron jobs, database tables, or environment variables.
- True historical FRED/ALFRED vintage reconstruction.

## Alternatives Considered

### Per-event explicit rules — selected

Each event records its series, expected direction, change unit, and threshold. This is verbose but transparent, auditable, and stable for later backtests.

### Global per-series defaults

The application could assign one threshold to every use of a series. This reduces input work but assumes the same market move is meaningful for every type of event.

### Volatility-adjusted thresholds

Thresholds could be derived from recent volatility. This is adaptive but introduces model behavior and calibration before the confirmation layer has been validated.

## Event Schema

The existing `dataToConfirm` string array remains unchanged. Events gain two optional fields:

```json
{
  "marketDate": "2026-07-27",
  "dataToConfirm": ["YAHOO:CL=F", "DGS10"],
  "confirmationRules": [
    {
      "seriesId": "YAHOO:CL=F",
      "expectedDirection": "up",
      "changeType": "percent",
      "threshold": 2
    },
    {
      "seriesId": "DGS10",
      "expectedDirection": "up",
      "changeType": "basis_points",
      "threshold": 10
    }
  ]
}
```

### `marketDate`

- ISO date representing the first market session expected to reflect the event.
- Defaults to the brief's `briefDate` when omitted.
- It is explicit rather than inferred from evidence timestamps because a Taiwan morning brief can refer to an event before, during, or after a US session.

### `confirmationRules`

Each rule contains:

- `seriesId`: a series in the existing Dynamic Beta catalog.
- `expectedDirection`: `up` or `down`.
- `changeType`: `percent`, `absolute`, or `basis_points`.
- `threshold`: a finite number greater than zero.

Rules are unique by `seriesId` within an event. The validator rejects unknown series, duplicate rules, unsupported enums, and invalid thresholds. Every rule series must also appear in `dataToConfirm`; a `dataToConfirm` entry without a rule produces a warning so old briefs remain valid.

The input template is updated to demonstrate structured rules. Saving a brief stores the normalized rules in its immutable revision. No existing revision is mutated.

## Observation Selection

For each rule, the service reads the current observation history for the rule's series through the requested `asOf` date:

- Baseline: the latest observation strictly before `marketDate`.
- D1: the first available observation on or after `marketDate`.
- D3: the third available observation on or after `marketDate`.

This selection uses actual observation dates instead of a hard-coded trading calendar, so weekends, market holidays, and source gaps are naturally skipped. D1 and D3 must not be later than `asOf`.

Only daily market series are supported in v0. If a monthly or otherwise unsuitable series is referenced, that rule returns `insufficient_data` with an explicit reason.

When a required D1 or D3 observation is not yet present, the service reuses the existing series-specific freshness evaluator as of the requested date. A source that is `fresh` or within its accepted reporting delay returns `observing`; a source that is stale or has never produced data returns `insufficient_data`. This prevents a broken or abandoned feed from remaining in `observing` forever.

`asOf` is an observation-date cutoff, not a true vintage timestamp. The repository currently reads the latest stored revision for each historical observation date. Therefore, the module prevents future observation dates from leaking into an evaluation but cannot reconstruct FRED values exactly as originally published before the project began retaining revisions. The API exposes this limitation in its metadata.

## Change Calculation

The evaluator calculates the raw move from baseline to the selected observation:

- `percent`: `(observation / baseline - 1) × 100`.
- `absolute`: `observation - baseline`.
- `basis_points`: `(observation - baseline) × 100`, because the stored yield and spread series are in percentage points.

The raw move is normalized to the expected direction:

- Expected `up`: normalized move equals raw move.
- Expected `down`: normalized move equals negative raw move.

The same explicit threshold is used symmetrically in both directions:

- Normalized move greater than or equal to the threshold: `confirmed`.
- Normalized move less than or equal to the negative threshold: `reverse`.
- Move between the two boundaries: `unconfirmed`.

Boundary comparisons are inclusive. Calculations retain full precision; rounding is display-only.

A zero or non-finite baseline cannot produce a percent change and returns `insufficient_data` rather than an infinite or fabricated move.

## Timing States

Each rule has separate D1 and D3 results:

- `confirmed`
- `reverse`
- `unconfirmed`
- `observing`: the relevant observation window has not completed as of the requested date.
- `insufficient_data`: baseline, supported frequency, or required observations are unavailable.
- `not_configured`: the historical event has a `dataToConfirm` entry but no structured rule.

D1 is the primary confirmation result. D3 is displayed as persistence evidence and never rewrites the D1 conclusion. The response derives one descriptive persistence label with no numerical effect:

- `sustained`: D1 and D3 have the same directional result (`confirmed` or `reverse`).
- `faded`: D1 is directional and D3 is `unconfirmed`.
- `reversed`: D1 and D3 have opposite directional results.
- `emerged_late`: D1 is `unconfirmed` and D3 becomes directional.
- `unchanged`: D1 and D3 are both `unconfirmed`.
- `observing`, `insufficient_data`, or `not_configured`: evaluation cannot yet produce both comparable windows.

## Event Rollup

D1 and D3 are rolled up independently using an unweighted majority of evaluable rules. This is a status summary, not a risk score.

For a given window:

1. Count only `confirmed`, `reverse`, and `unconfirmed` rules as evaluable.
2. Required majority is `floor(evaluable / 2) + 1`.
3. A confirmed majority returns `confirmed`.
4. A reverse majority returns `reverse`.
5. Any other evaluable combination returns `unconfirmed`; the response distinguishes ordinary no-threshold results from split signals.
6. If no rule is evaluable and at least one rule is still observing, return `observing`.
7. If nothing is evaluable or observing, return `insufficient_data` or `not_configured`, as applicable.

If some rules are still observing, the rollup includes `isFinal: false`. The admin page labels such a result as provisional and shows the counts rather than hiding incomplete inputs.

## Architecture

```text
Immutable morning-brief revision
  -> explicit confirmation rules
  -> confirmation service
  -> existing market-data repository
  -> pure D1/D3 evaluator
  -> admin-only API
  -> internal validation view
```

### Pure evaluator

A new pure module owns observation selection, unit conversion, direction normalization, rule statuses, persistence descriptions, and majority rollups. It performs no I/O and has no dependency on scoring modules.

### Confirmation service

The service receives a brief revision, market repository, and `asOf`. It groups rules by series, fetches each required history once, runs the evaluator, and returns event results in brief rank order.

The service does not write evaluation results in v0. Rules remain part of the immutable brief revision, while evaluation output represents the market data currently stored for the requested observation-date cutoff.

### API

Add:

`GET /api/dynamic-beta/news/confirmations`

Query parameters:

- Existing admin token mechanism.
- Optional `briefDate`; defaults to the latest available brief.
- Optional `revisionId`; defaults to the current revision for the selected date.
- Optional ISO `asOf`; defaults to today's date.

The response includes:

- Brief identity and revision.
- `asOf`, `evaluatedAt`, and vintage limitation metadata.
- Event-level D1 and D3 rollups.
- Per-rule baseline, D1, D3, dates, raw moves, statuses, and reasons.
- Counts for confirmed, reverse, unconfirmed, observing, and insufficient rules.
- A separate not-configured count for legacy `dataToConfirm` entries without rules.

The route requires both `DYNAMIC_BETA_DATA_ENABLED` and `DYNAMIC_BETA_NEWS_DATA_ENABLED`. It does not require or enable any scoring or public feature flag. Invalid input returns 400, failed authentication returns the existing authorization response, a missing brief returns 404, and unexpected repository failures return 500 with server-side logging.

## Internal Validation View

The existing `/admin/dynamic-beta?token=...` page gains a small confirmation panel. It is loaded manually and is not part of the public navigation.

For each event it displays:

- Rank and headline.
- Market date.
- Primary D1 status and whether it is final.
- D3 persistence status.
- Confirmed/reverse/unconfirmed counts.
- Expandable per-series rows showing expected direction, threshold, baseline, D1, D3, actual changes, observation dates, and failure reason.

Historical events without rules display `尚未設定確認規則`. The page does not generate rules, scores, or investment recommendations.

## Feature Isolation

- No new environment variable is required.
- `DYNAMIC_BETA_DATA_ENABLED=true` and `DYNAMIC_BETA_NEWS_DATA_ENABLED=true` are required for the internal endpoint.
- `DYNAMIC_BETA_SCORING_ENABLED=false`, `DYNAMIC_BETA_NEWS_SCORING_ENABLED=false`, `DYNAMIC_BETA_PUBLIC_ENABLED=false`, and `DYNAMIC_BETA_NEWS_PUBLIC_ENABLED=false` remain unchanged.
- No existing production code path imports or calls the confirmation service.
- Errors remain contained within the internal route and validation panel.

## Tests and Verification

### Pure evaluator tests

- Up and down expectations.
- Inclusive threshold boundaries.
- Percent, absolute, and basis-point conversion.
- Baseline, D1, and D3 selection across weekends and missing observation dates.
- `asOf` cutoff behavior.
- Confirmed, reverse, unconfirmed, observing, insufficient, and not-configured states.
- Persistence descriptions.
- Majority, split-signal, provisional, and no-evaluable-rule rollups.
- Invalid and zero baselines for percent changes.

### Schema and compatibility tests

- Valid structured rules normalize successfully.
- Unknown series, duplicates, invalid enums, and invalid thresholds fail validation.
- Missing rules produce warnings without invalidating old briefs.
- Existing stored brief revisions still deserialize and display.

### Service and route tests

- Histories are fetched once per distinct series.
- Brief selection by date and revision.
- Admin authorization and both data flags.
- Invalid dates, missing briefs, and repository failures.
- Response metadata states the latest-revision/vintage limitation.

### Regression verification

- Full unit test suite.
- ESLint.
- Next.js production build.
- Local admin-route smoke test using a new brief revision with explicit confirmation rules.
- Confirm existing Beta, portfolio, cash, rebalance, and recommendation routes continue to build and their existing tests remain unchanged.

## Success Criteria

- An internal user can select a structured morning brief and see deterministic D1 and D3 market confirmation evidence for every configured event.
- Every status can be traced to a stored rule, exact observation dates, values, and calculation.
- Old briefs remain readable and are never silently assigned inferred directions.
- No score or production investment behavior changes.
