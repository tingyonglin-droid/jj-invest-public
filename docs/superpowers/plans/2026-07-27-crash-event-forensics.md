# Crash Event Indicator Forensics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Produce reproducible per-indicator forensic and normal-control reports for four selected selloffs.

**Architecture:** A pure forensics module builds mechanically filtered control dates, evaluates existing v0 signals, classifies timing/persistence/false positives, and ranks signals. A local runner reads stored histories and exports research artifacts.

**Tech Stack:** JavaScript ES modules, Node test runner, Upstash Redis, JSON/CSV/Markdown.

## Constraints

- No Crash Risk Score or production behavior.
- No new external provider.
- No use of observations before conservative availability dates.
- No hand-picked normal controls.

### Task 1: Pure forensic rules

- Create `src/lib/dynamic-beta/event-forensics.js`.
- Create `tests/dynamic-beta-forensics.test.js`.
- Test mechanical control exclusion, future-drawdown filters, and signal classification.

### Task 2: Event analysis and rankings

- Evaluate all v0 signals through each event window.
- Match five normal controls per event.
- Produce per-event and cross-event summaries with explicit missing data.

### Task 3: Runner and reports

- Create `scripts/dynamic-beta-event-forensics.js`.
- Add `forensics:dynamic-beta-events` package script.
- Export JSON, CSV, and Markdown plus a data-gap inventory.

### Task 4: Verification

- Run the real report and inspect controls and classifications.
- Run full tests, lint, and build.
