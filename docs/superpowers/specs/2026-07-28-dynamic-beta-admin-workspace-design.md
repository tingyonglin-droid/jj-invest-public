# Dynamic Beta Admin Workspace Redesign

Date: 2026-07-28
Status: Implemented and verified; responsive checks completed at the browser backend's available viewport steps

Implementation plan: `docs/superpowers/plans/2026-07-28-dynamic-beta-admin-workspace.md`

## Context

The existing `/admin/dynamic-beta` page grew incrementally as the Dynamic Beta infrastructure expanded. It now contains market-data validation, manual synchronization, Market Risk Score preview, morning-brief draft approval, raw News Event JSON ingestion, published-brief history, D1/D3 confirmation, and the full market-data table inside one long page.

The primary operator workflow is now daily morning-brief review, approval, and subsequent D1/D3 tracking. The current information hierarchy does not reflect that priority, particularly on a phone. Low-frequency developer tools and wide diagnostic tables compete visually with the daily workflow.

The future public morning-brief experience has a different audience, security boundary, and reading goal. It must not reuse the admin page itself. Admin and public surfaces will remain separate while sharing safe, read-only presentation components.

## Goals

- Make the internal admin workflow comfortable on a 375px-wide phone without reducing desktop usability.
- Make the latest morning brief, its lifecycle state, and D1/D3 progress the default view.
- Separate daily operation, published history, confirmations, market data, and advanced/debug tools into clear sections.
- Preserve the existing exact-revision approval boundary and Redis lifecycle behavior.
- Extract safe read-only morning-brief presentation components that a future public page may reuse.
- Keep scoring, Dynamic Beta, Target Beta, and public features disabled and behaviorally isolated.

## Non-Goals

- Do not build `/morning-brief` or any public route in this task.
- Do not add a public API or expose admin APIs without authentication.
- Do not change the Redis schema, database schema, market-data catalog, synchronization rules, score rules, confirmation rules, or draft lifecycle.
- Do not modify existing Beta calculations, holdings, cash, rebalance logic, or operation recommendations.
- Do not automate news search or morning-brief generation.
- Do not redesign the public investment App.

## Product Boundary

The internal and future public experiences use the same approved brief data but remain separate consumers:

```text
Approved Morning Brief Repository
├── Admin workspace
│   ├── lifecycle controls
│   ├── warnings and diagnostics
│   ├── D1/D3 investigation
│   └── raw/debug tools
└── Future public morning-brief page
    ├── approved and explicitly public content only
    ├── read-only content components
    └── no admin metadata, token, controls, or raw payloads
```

The public branch is architectural preparation only. It is not implemented or enabled in this task.

## Information Architecture

The admin workspace remains at one authenticated route:

```text
/admin/dynamic-beta?token=<existing-token>&section=<section-id>
```

The `section` query parameter provides a stable deep link and preserves the active section across reloads. An absent or invalid value selects `today`.

### 1. Today (`section=today`)

This is the default view and contains only information requiring daily attention:

- Latest morning-brief date, analyst label, rationale, draft status, and published revision.
- Approve/reject actions only when the exact selected draft is pending.
- A compact summary of five events with a path to the full brief.
- D1/D3 aggregate counts and current tracking stage.
- Market-data alerts limited to stale, delayed, failed, or missing series.
- Clear persistent notice that scoring and public features remain disabled.

Normal market-data rows, raw JSON, and model details do not appear here.

### 2. Briefs (`section=briefs`)

- Lists draft and published morning-brief revisions by date.
- Defaults to the newest relevant revision while preserving exact revision selection.
- Displays the complete read-only brief preview: identity, sources, five events, transmission paths, affected assets, confirmation rules, interpretation, confidence, and technology-earnings fields.
- Shows lifecycle controls only for pending drafts.
- Shows approval/rejection/publication metadata and warnings in an admin-only metadata block.
- Treats approved and rejected revisions as immutable, read-only records.
- Makes the distinction between a draft revision and a published brief revision explicit.

### 3. Confirmations (`section=confirmations`)

- Filters by brief date, optional exact published revision ID, and `asOf` date.
- Defaults to the latest published brief when the brief date is empty.
- Summarizes each event's D1 status and D3 persistence before showing rule detail.
- Keeps each event and its wide rule table collapsed until requested.
- Preserves all existing confirmation meanings, thresholds, and point-in-time limitations.

### 4. Data (`section=data`)

- Presents counts for fresh, delayed, stale, missing, and failed series.
- Shows abnormal series first as mobile-friendly summary cards.
- Places normal series behind an explicit “All data” expansion.
- Retains refresh and manual synchronization controls with visible loading/result feedback.
- Uses a responsive card layout on phone and the existing detailed table on sufficiently wide screens.
- Does not change freshness logic or source selection.

### 5. More (`section=more`)

- Market Risk Score v0 offline preview.
- Raw News Event JSON validation and internal ingestion.
- Template reset and developer diagnostics.
- Feature-flag status and internal-only limitations.

This section is intentionally visually subordinate and is never the default.

## Navigation and Responsive Behavior

### Mobile

- Use a fixed bottom navigation with five labeled destinations: Today, Briefs, Confirmations, Data, and More.
- Keep each touch target at least 44×44 CSS pixels with at least 8px separation where controls are adjacent.
- Reserve bottom padding so page content cannot hide behind the navigation.
- Use a single content column with 16px minimum body text and a consistent 4px/8px spacing scale.
- Convert dense tables to summary cards or place exceptional wide detail inside an explicit horizontal-scroll container.
- Use native `<details>` disclosure for long event, rule, and debug content when practical.
- Do not rely on hover or color alone to communicate status.

### Tablet and Desktop

- Replace the bottom navigation with a stable top tab row using the same five labels and section IDs.
- Use a consistent maximum content width and adaptive gutters.
- Allow two-column summaries where the relationship is useful, such as current brief beside D1/D3 status.
- Show detailed market and confirmation tables only at widths where columns remain readable.

Both navigation forms update the same `section` query parameter and preserve the existing admin token parameter.

## Component Boundaries

### Shared read-only presentation components

These components contain no admin token, mutation call, feature-flag decision, or lifecycle control:

- `MorningBriefHeader`: date, label, rationale, and publication identity when supplied.
- `MorningBriefEventCard`: event headline, summary, topic, sources, transmission path, affected assets, interpretation, and confidence.
- `TechEarningsDetails`: complete technology-earnings fields with explicit missing/unpublished labels.
- `ConfirmationStatusBadge`: status text plus semantic style without color-only meaning.
- `ConfirmationSummary`: D1/D3 aggregate presentation without performing evaluation.

The exact filenames and final folder location may follow existing repository conventions during planning, but the mutation-free boundary is mandatory.

### Admin-only components

- `AdminWorkspaceNavigation`
- `TodayWorkspaceSection`
- `BriefAdminSection`
- `ConfirmationAdminSection`
- `MarketDataAdminSection`
- `AdvancedToolsSection`
- Existing draft lifecycle controller and action controls
- Admin-only validation, deduplication, feature, and source metadata

Admin-only components may compose shared read-only components. Shared components must never import admin-only modules.

## Data Loading and State

- Load only the active section's primary data instead of loading every admin API on initial mount.
- Keep loading, error, refresh, and last-successful content state local to each section.
- Preserve the last successful content when a refresh fails, while clearly displaying the error and retry action.
- Avoid a single global error that clears unrelated sections.
- Reuse the existing admin APIs and controllers wherever their contracts already satisfy the section.
- Do not add a new persistence layer or rewrite existing API services for this visual reorganization.

The Today section may compose compact results returned by existing admin, draft, news, and confirmation endpoints. If reducing request duplication requires a small internal read-only aggregation endpoint, the implementation plan must first prove that existing parallel requests are insufficient and must keep the same authorization and feature gates.

## Lifecycle and Security Requirements

- Every approval or rejection request carries the exact selected `draftRevisionId` and `briefDate`.
- Lifecycle actions remain disabled while another action is active.
- Approved and rejected drafts cannot regain lifecycle controls through navigation or reload.
- Existing Redis claims, publication phases, atomic scripts, retry behavior, and immutable revision rules remain unchanged.
- Admin authorization occurs before reading feature or data state.
- No admin token, lifecycle control, raw payload, warning, or internal API is introduced into public code.
- No `/morning-brief` page or public data endpoint is created in this task.
- `DYNAMIC_BETA_SCORING_ENABLED`, `DYNAMIC_BETA_PUBLIC_ENABLED`, `DYNAMIC_BETA_NEWS_SCORING_ENABLED`, and `DYNAMIC_BETA_NEWS_PUBLIC_ENABLED` remain false.

## Status, Missing Data, and Error Language

- Replace ambiguous em dashes with a reason where the reason is known: “Not yet published,” “No confirmation rule,” “No data,” or “Not applicable.”
- Preserve an em dash only when the system genuinely cannot determine a more specific reason.
- Distinguish fresh, delayed, stale, missing, and failed data using text labels plus semantic color.
- Show loading feedback inside the initiating section or button.
- Display errors next to the affected operation with a recovery action.
- Keep stale content visible after refresh failure and mark it as the previous successful result.
- Maintain the existing server-side sanitized error boundary and avoid exposing secrets or full payloads.

## Visual System

- Preserve the existing JJ Invest brand header and light neutral surfaces.
- Use a restrained internal-finance dashboard style rather than introducing a separate decorative theme.
- Establish clear hierarchy through typography, spacing, borders, and surface elevation rather than adding many colors.
- Use one semantic status palette for success, warning, error, observing, and neutral states.
- Use tabular numerals for dates, values, scores, and revision numbers.
- Keep one primary action per section; destructive rejection remains visually and spatially subordinate.
- Provide visible keyboard focus states and accessible names for every navigation and action control.

## Accessibility

- Normal text contrast meets WCAG AA 4.5:1; large text and non-text UI meet the applicable 3:1 threshold.
- Keyboard order follows the visible order; active navigation uses semantic selected/current state.
- Status never relies on color alone.
- Expand/collapse controls communicate expanded state.
- Errors and completed actions use accessible live feedback without stealing focus.
- Text zoom and a 375px viewport do not clip controls or cause page-level horizontal overflow.
- The layout respects reduced-motion preferences; no animation is required for correctness.

## Testing and Acceptance

### Navigation and responsive behavior

- An absent or invalid `section` selects Today.
- Each of the five section IDs creates a stable, reloadable URL.
- Mobile bottom navigation and desktop top tabs expose the same destinations and active state.
- The layout is verified at 375px, 768px, 1024px, and a wide desktop viewport.
- No page-level horizontal overflow occurs at 375px.
- All mobile actions meet the minimum touch-target requirement.

### Morning-brief behavior

- The newest pending draft is actionable; exact approved/rejected revisions are read-only.
- Approval and rejection submit the exact selected revision.
- Published morning-brief identity remains visible after approval.
- All five events, source data, confidence, confirmation rules, and technology-earnings fields remain present.
- Draft and published revisions are labeled as different identities.

### Confirmation and market data

- D1/D3 statuses and persistence match the current confirmation evaluator output.
- Confirmation filters retain exact revision behavior.
- Data summary counts match the underlying series statuses.
- Abnormal series appear before the normal-data expansion without changing freshness classification.
- Manual synchronization keeps existing authorization, duplicate protection, and error behavior.

### Isolation and regression

- Existing Dynamic Beta/news route, repository, lifecycle, and confirmation tests continue passing.
- Add behavioral component tests for section navigation, responsive presentation contracts, local loading/error preservation, and exact lifecycle selection.
- Run the full project test suite, lint, and production build.
- Audit imports to prove shared read-only components do not import admin controls and no public code imports admin modules.
- Confirm all scoring/public feature flags remain disabled.
- Confirm existing Beta, holdings, cash, rebalance, and operation-advice tests remain unchanged and passing.

## Rollout

- Replace the internal page layout without changing the route or public navigation.
- Keep the existing admin token and feature-gate behavior.
- Treat the first release as an internal responsive-workspace update.
- Validate the complete approval and D1/D3 workflow on desktop and phone before any later public-page design begins.
- Future public morning-brief work receives a separate design, security review, feature flag, API contract, and implementation plan.

## Approved Decisions

- Primary use case: daily morning-brief review, approval, and D1/D3 tracking.
- Architecture: separate admin and future public pages, with shared mutation-free presentation components.
- Current task: admin workspace redesign and shared-component preparation only.
- Navigation: five sections with mobile bottom navigation and desktop top tabs.
- Public route and public API: explicitly deferred.
