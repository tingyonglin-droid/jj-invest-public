# News Event Data Module v0 Design

## Purpose

Capture the existing manually generated morning investment brief as structured, revision-safe internal data. This phase creates news evidence, deduplication, topic classification, and an internal validation workflow. It does not fetch news automatically, call an AI provider, calculate a news score, alter Market Risk Score, alter Dynamic Beta, or expose anything publicly.

## Boundaries

- Keep FRED and Yahoo market data unchanged.
- Reuse the existing Upstash Redis connection and `USAGE_ADMIN_TOKEN` authorization.
- Require a separate `DYNAMIC_BETA_NEWS_DATA_ENABLED=true` flag for all news reads and writes.
- Keep `DYNAMIC_BETA_NEWS_SCORING_ENABLED` and `DYNAMIC_BETA_NEWS_PUBLIC_ENABLED` false.
- Store append-only evidence revisions and morning-brief revisions. Never overwrite the historical revision record.
- Do not add a third-party news provider or an AI SDK.

## Data Model

### News evidence

Each source item stores:

- `evidenceId`: stable identifier for a canonical URL.
- `revisionId`: content-addressed immutable revision identifier.
- `canonicalUrl`, `originalUrl`, `sourceName`, `sourceTier`.
- `title`, optional `summary`, optional `publishedAt`, and `retrievedAt`.
- `contentFingerprint` for exact-content deduplication.
- `duplicateOfEvidenceId` when identical content is already known under another URL.
- `firstSeenAt` and `lastSeenAt`.

Tracking query parameters and URL fragments are removed before identity checks. Submitting the same URL and content updates only `lastSeenAt`; changed content creates a new revision. Identical content under another URL is retained as evidence and linked as a duplicate rather than discarded.

### Morning brief snapshot

Each snapshot stores:

- `briefDate`, immutable `revisionId`, `revisionNumber`, `generatedAt`.
- `analystLabel`: `risk_on`, `risk_elevated`, `high_alert`, or `systemic_risk`.
- Optional `analystRationale`.
- Exactly five ranked events.

Each event stores a headline, summary, fixed topic identifiers, evidence URLs, transmission path, affected assets, data to confirm, investment interpretation, and analyst confidence. Optional megacap earnings fields capture revenue, AI/cloud growth, CapEx growth, FCF growth, and whether CapEx is growing faster than FCF. Missing numbers remain `null`; they are never inferred.

## Topic Taxonomy

The v0 allowlist is:

- `global_macro_fed`
- `inflation_rates`
- `credit_liquidity`
- `energy_geopolitics`
- `ai_semiconductors`
- `data_centers`
- `megacap_earnings`
- `taiwan_tech_supply_chain`
- `market_stress`

The module validates explicit topics and provides deterministic keyword suggestions. Suggestions do not silently replace analyst-selected topics.

## Internal Workflow

The existing `/admin/dynamic-beta?token=...` page gains a simple JSON textarea. An administrator pastes a structured payload, validates it locally on the server, then saves evidence and the brief snapshot through an admin-only route. The page lists recent brief revisions and dedupe warnings. This is an internal data-validation tool, not a public UI.

## API

- `GET /api/dynamic-beta/news?token=...`: list recent brief revisions and evidence summaries.
- `POST /api/dynamic-beta/news?token=...`: validate and save one morning-brief payload.
- `POST /api/dynamic-beta/news/validate?token=...`: normalize and validate without writing.

All routes require both the existing admin token and the news data flag. The scoring and public flags are returned for visibility but grant no behavior.

## Future Compatibility

The evidence and brief snapshots retain human/AI qualitative judgments separately from future quantitative scores. Future work can compare the analyst label with market data outcomes, add provider-specific ingestion, or build a scoring model without rewriting the captured source evidence.
