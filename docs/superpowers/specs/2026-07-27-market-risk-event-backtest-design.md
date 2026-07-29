# Market Risk Event Backtest Design

## Goal

Evaluate whether Market Risk Score v0 rose before, during, or after four specified selloffs: March 2020, October 2022, August 2024, and April 2025.

## Event semantics

Each event defines a pre-event peak-search range and a trough-search range. The engine finds the highest SPY close in the peak range and lowest close in the trough range. It evaluates every SPY trading date from 60 trading days before the peak through 20 trading days after the trough.

For both market-only and full models it reports scores 60/20/5 trading days before the peak, score at peak and trough, maximum score before the peak, first crossings of 40 and 60, lead time, top weighted contributors, and one classification: early-warning, concurrent-confirmation, late, or missed.

## Point-in-time limits

Market-only excludes unemployment, payrolls, Core CPI, and Core PCE. Full model uses current revised macro history but moves availability dates conservatively: UNRATE/PAYEMS observation month +42 days, Core CPI +48 days, and Core PCE +65 days. This prevents using observation dates as release dates but does not recreate historical vintages. Results remain labelled revised-data.

## Execution

A local script reads stored observations, invokes the pure engine, and writes JSON and CSV artifacts. It is not a Vercel route, cron, public UI, or production score. It does not change scoring/public flags or Target Beta.
