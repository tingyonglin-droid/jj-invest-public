# Beta Target Emphasis Design

## Goal

Make the calculated target Beta the primary visual takeaway in the Beta settings summary without changing any portfolio calculations.

## Approved design

- Keep the inferred allocation summary on the left.
- Present `換算 Beta` and its formatted value in a dedicated high-contrast badge on the right.
- Keep the explanatory sentence visually secondary.
- Stack the summary and badge on narrow screens.
- Show validation errors in the existing error state without the Beta badge.

## Verification

- Add a source-level UI regression test for the new semantic structure and responsive CSS hooks.
- Run the targeted test, full test suite, lint, and production build.
- Deploy the `rebalance-simplify` working tree as a Vercel Preview deployment.
