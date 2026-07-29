# Automated Daily Morning Brief Draft Design

**Date:** 2026-07-29
**Status:** Approved design; pending written-spec review and implementation plan

## Purpose

Automatically create one internal morning-brief draft on weekday mornings without adding an OpenAI API integration. A local Codex automation will research current news, select the five events most likely to affect market prices, build the existing structured morning-brief payload, validate it, and save it as a pending Redis-backed draft. An administrator must still approve the exact draft revision before it becomes a published morning brief.

This phase prioritizes reliable daily editorial production. It does not calculate a news score, Market Risk Score, Crash Risk Score, Dynamic Beta, Target Beta, rebalancing action, or trading advice.

## Approved Decisions

- Run Monday through Friday at 07:00 Asia/Taipei.
- Use a standalone local Codex project automation, not Vercel Cron, ChatGPT Tasks, or an in-App AI provider.
- The Mac is expected to remain powered on and connected to the internet.
- Do not require `OPENAI_API_KEY`; research and synthesis use the Codex account executing the automation.
- Save output only as a `pending` draft.
- Never approve, publish, reject, or replace an approved morning brief automatically.
- Reuse the existing Redis draft lifecycle, schema validation, content-addressed revision identity, evidence normalization, deduplication, admin page, and feature flags.
- A future public App surface may read approved morning briefs only. Drafts and internal metadata remain private.

## Architecture

```text
Local Codex weekday automation
  -> current-news research
  -> evidence clustering and deduplication
  -> Market Attention Ranking
  -> exact five-event morning-brief payload
  -> existing schema validation
  -> local server-side draft submission command
  -> existing configured News Draft service
  -> existing Redis pending-draft revision
  -> /admin/dynamic-beta review
  -> explicit human approval
  -> existing immutable published morning brief
```

The automation is the editorial producer. The application remains the validator, persistence layer, lifecycle authority, and review surface.

The local submission command will accept a JSON file, load the existing `.env.local` server-side configuration, require `DYNAMIC_BETA_NEWS_DATA_ENABLED=true`, construct the existing configured News Draft service, and call its `create(payload)` method. It will not require the Next.js development server to be running and will not call an admin-token URL.

No second draft repository, database table, Redis key family, or news schema is introduced.

## Schedule and Brief Date

- Schedule: Monday through Friday at 07:00 in the local Asia/Taipei timezone.
- The automation derives `briefDate` from the Asia/Taipei calendar date at execution time.
- The research window prioritizes developments since the prior US market session through the automation run, while allowing older background sources only when needed to explain the current event.
- Taiwan holidays do not suppress a weekday run. US and global developments may still be relevant to the next tradable Taiwan session.
- Weekend runs are excluded in v1.

## Editorial Research Contract

The automation searches dynamically rather than reading a fixed five-site list. It prioritizes:

1. Official releases, calendars, filings, investor-relations pages, central banks, and government agencies.
2. Reputable financial and general-news organizations with original reporting.
3. Secondary sources only when they add necessary context and the material claim can be traced to a stronger source.

The research scope follows the currently approved morning-brief rules:

- global macroeconomics and the Federal Reserve;
- inflation, employment, rates, Treasury auctions, and liquidity;
- geopolitics, energy supply, Brent, WTI, and shipping disruptions;
- AI, semiconductors, data centers, and financing conditions;
- US technology megacaps and index-level valuation effects;
- Taiwan technology and semiconductor supply chains;
- major earnings and economic releases;
- for relevant technology earnings: revenue growth, AI/cloud growth, CapEx growth, free-cash-flow growth, and whether CapEx is growing faster than free cash flow.

The automation must not invent publication times, reported values, market reactions, earnings values, or confirmation thresholds. Unknown values remain `null`, and scheduled-but-unreleased information is described as a pending market focus rather than an observed result.

## Event Clustering and Deduplication

The unit of selection is an event, not an article.

- Syndicated copies of one wire story count as one source lineage.
- Multiple articles about the same underlying development are clustered into one candidate event.
- One event cannot occupy multiple ranks merely through different headlines.
- Related developments may be combined when they share one causal market thesis, but separate shocks with distinct transmission paths remain separate candidates.
- Existing URL canonicalization and evidence deduplication remain authoritative when the draft is saved.

## Market Attention Ranking

The ranking is an editorial prioritization tool only. It is not a Dynamic Beta input, investment score, or trading signal.

Each candidate event receives a 0–100 ranking assessment:

| Dimension | Weight | Question |
|---|---:|---|
| Market breadth | 25 | Can the event affect a broad index, multiple asset classes, a major sector, or only one small company? |
| Immediacy | 20 | Is it likely to influence today's opening, session, or near-term repricing? |
| Current market attention | 20 | Are independent high-quality sources, investors, or market-pricing reports treating it as a current focus? |
| Transmission-path strength | 20 | Is there a clear causal path from the event through rates, inflation, earnings, liquidity, risk appetite, or valuation to market prices? |
| Surprise | 10 | Does it materially differ from prior expectations or force a reassessment? |
| Source confidence | 5 | Is the claim supported by official or reputable original reporting? |

Selection rules:

- Rank candidate events by the total assessment and choose exactly five.
- Do not force one item from each topic. Actual market importance takes precedence over category quotas.
- When candidate scores are close, prefer a set that avoids redundant exposure to one narrow theme.
- A single-company product story is excluded unless it plausibly affects an index, a major sector, a supply chain, or the market's valuation framework.
- A scheduled event may enter the top five only when it occurs within the near-term information window and markets are demonstrably focused on the uncertainty.
- Article count alone is not proof of market attention.

The automation run summary should explain why each selected event outranked ordinary news. These ranking assessments are operational evidence in the Codex run result; they are not added to the Redis morning-brief schema in this phase.

## Structured Draft Contract

The generated payload must pass the existing `validateMorningBriefPayload` contract:

- valid `briefDate` and `generatedAt`;
- one qualitative `analystLabel` from the existing allowed labels;
- one concise `analystRationale` that does not claim to be a quantitative model;
- normalized evidence with source name, source tier, title, URL, and reliable publication time or `null`;
- exactly five events with ranks 1 through 5;
- headline, factual summary, topic IDs, evidence URLs, transmission path, affected assets, interpretation, and confidence for every event;
- technology earnings fields only when relevant, with unknown values left `null`;
- `marketDate`, `dataToConfirm`, and confirmation rules only when they can be supported without predicting unreleased results.

Existing validation warnings, including missing confirmation rules, do not automatically block a structurally valid draft. They remain visible for human review because this phase intentionally allows market-data confirmation coverage to improve later. Validation errors block every write.

## Draft Identity and Idempotency

The existing draft service and repository remain authoritative:

- The same normalized payload for the same date reuses the existing content-addressed draft revision.
- A materially changed payload creates a new immutable draft revision.
- A pending, rejected, or approved older revision is never overwritten.
- An automation rerun is safe and cannot publish a morning brief.
- An approved morning brief remains immutable and is not replaced by a later automated draft.

## Failure Handling

The automation must fail closed.

- Research failure, insufficient trustworthy evidence, fewer than five valid event clusters, malformed JSON, validation failure, missing Redis configuration, disabled news-data flag, or persistence failure produces no new draft.
- The automation may correct its own payload and retry validation within the same run, but it must not weaken schema rules to force success.
- Errors must not print admin tokens, Redis credentials, API keys, or full secret-bearing upstream messages.
- A failed run leaves the latest approved brief and every existing draft unchanged.
- The Codex run result reports success with the date and draft identity, or failure with a safe actionable reason.
- The operator can manually rerun the automation after correcting connectivity or configuration.

No separate automatic retry schedule is added in v1. Existing content-addressed idempotency makes a manual rerun safe.

## Security and Isolation

- Secrets remain in `.env.local` and are read only by the local server-side command.
- The generated evidence and draft payload must never contain credentials or local filesystem paths.
- The local command does not approve or reject drafts and exposes no lifecycle mutation option.
- `DYNAMIC_BETA_SCORING_ENABLED`, `DYNAMIC_BETA_PUBLIC_ENABLED`, `DYNAMIC_BETA_NEWS_SCORING_ENABLED`, and `DYNAMIC_BETA_NEWS_PUBLIC_ENABLED` remain false.
- No public route, public API, public navigation, portfolio import, holdings import, cash import, rebalance import, advice import, or Target Beta integration is added.

## Operator Experience

On successful creation:

- the automation result lists the brief date, five selected headlines, safe source summary, draft revision identity, and the internal management-page URL;
- the new pending revision appears in Today and Briefs after refresh;
- lifecycle buttons remain available only for the exact pending revision;
- the administrator reviews and explicitly approves or rejects it.

On failure:

- no partial draft appears;
- the automation result states which stage failed: research, clustering, payload generation, validation, configuration, or persistence;
- the management page continues to show the last existing state.

## Future Public Morning Brief

The public App is a separate future phase.

- It reads only approved immutable morning-brief revisions through a public-safe read contract.
- If no current-day brief has been approved, it keeps the most recent approved brief and shows its date rather than exposing a pending draft.
- Draft status, validation warnings, raw JSON, ranking diagnostics, admin tokens, lifecycle controls, and private source metadata remain internal.
- The generation provider can later move from local Codex automation to Vercel plus an API provider without changing the draft schema, review lifecycle, or public rendering contract.

## Implementation Scope

The implementation plan should cover only:

1. A local JSON-to-pending-draft submission command that reuses the configured existing services.
2. Focused tests for configuration gating, validation failure, successful pending creation, duplicate rerun, secret-safe errors, and the absence of approval/public behavior.
3. A local Codex project automation scheduled for weekday 07:00 Asia/Taipei with the approved research and ranking prompt.
4. One manual dry run that creates or reuses a pending draft and verifies it in the admin page without approving it.
5. Relevant tests, lint, build, route/flag/isolation audits, and a concise handoff.

The implementation must not add an in-App model client, news API provider, news scoring, market-data scoring integration, public morning-brief page, or automatic approval.

## Verification and Acceptance Criteria

The phase is complete when:

- the local command can save a valid payload as a pending draft without a running Next.js server;
- invalid or incomplete input writes nothing;
- repeated identical input does not create duplicate content;
- a changed payload becomes a new draft revision without overwriting an earlier revision;
- the Codex automation is configured for Monday through Friday at 07:00 Asia/Taipei;
- one manual automation-equivalent run selects five distinct market-focused events and leaves a visible pending draft;
- no run approves or publishes content;
- the admin page can review the exact generated draft revision;
- no existing Beta, holdings, cash, rebalance, advice, scoring, confirmation, or public-App behavior changes;
- all relevant automated verification passes and the four scoring/public flags remain false.
