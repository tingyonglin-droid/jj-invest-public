# Crash Event Indicator Forensics Design

## Goal

Determine which currently available indicators rose before four selected selloffs, whether the same anomalies commonly appeared during normal periods, and which missing datasets deserve later investigation. This is research output only, not a Crash Risk Score.

## Event and control methodology

Use the event peaks/troughs already defined for March 2020, October 2022, August 2024, and April 2025. Inspect every v0 signal at 60/40/20/10/5 trading days before the peak, at the peak, and through the trough.

Normal controls are selected mechanically from monthly candidate trading dates between 2020 and 2025. Exclude dates within 90 calendar days of event peak/trough ranges. Require future 20-trading-day drawdown above -5%, future 60-trading-day drawdown above -8%, and score coverage at least 70%. For each event, choose the five candidates closest in VIX level and SPY 60-day return at the event peak.

## Classification

A signal is anomalous when its fixed-rule score is at least 50. For each event record first anomaly, lead trading days, anomalous pre-peak days, whether it normalized before the peak, and matched-control anomaly rate. Classify as leading, weak-leading, concurrent-confirmation, late, high-false-positive, quiet, or insufficient-data. A leading signal must occur at least five trading days before the peak, persist for at least three sampled trading days, and have matched-control anomaly rate below 30%.

## Point-in-time limits

Apply the same conservative macro availability lags as the event backtest. Macro values remain revised-data because historical ALFRED vintages were not backfilled. Credit OAS before July 2023 is unavailable from the configured FRED series and must be marked missing, not imputed.

## Outputs

Generate JSON, CSV, and Markdown reports with event tables, matched controls, cross-event signal ranking, false-positive rates, and a static data-gap inventory. Do not add an API, cron, public page, Target Beta mapping, or production persistence.
