# Market Risk Event Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Produce reproducible event-warning reports for four historical selloffs.

**Architecture:** A pure engine transforms stored histories into point-in-time-safe inputs, locates event peaks/troughs, calculates daily v0 scores, and summarizes warning timing. A local script reads Redis and exports artifacts.

**Tech Stack:** JavaScript ES modules, Node test runner, Upstash Redis, JSON/CSV.

## Constraints

- No Target Beta, portfolio, cash, rebalance, advice, cron, or public UI integration.
- Market-only and revised-data full model must both run.
- Macro observation dates must not be treated as release dates.

### Task 1: Event engine

- Create `src/lib/dynamic-beta/event-backtest.js`.
- Create `tests/dynamic-beta-backtest.test.js` with failing tests for peak/trough location, lead-time classification, and macro availability delays.
- Implement minimal pure functions and verify focused tests.

### Task 2: Local runner and artifacts

- Create `scripts/dynamic-beta-event-backtest.js`.
- Add a package script.
- Read sufficient stored history and output JSON/CSV for the four approved event definitions.

### Task 3: Verification

- Run the real backtest.
- Inspect event dates, scores, crossings, and coverage.
- Run full tests, lint, and build.
