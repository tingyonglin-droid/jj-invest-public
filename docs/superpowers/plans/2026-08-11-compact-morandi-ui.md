# Compact Morandi UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make holdings and rebalance settings substantially more compact and apply one cohesive Morandi color system across settings, rebalance, and overview surfaces.

**Architecture:** Preserve all state, calculations, and component boundaries in `app/page.js`; add semantic asset-tone classes and compact layout wrappers only where rendering needs them. Centralize the visual system in CSS custom properties, then let settings, rebalance, overview allocation, market states, and navigation consume those variables.

**Tech Stack:** Next.js 16, React 19, JavaScript ES modules, Node.js test runner, CSS.

## Global Constraints

- Do not modify quote, storage, portfolio, cash, validation, or rebalance calculations.
- Keep every interactive control at least 44px high on mobile.
- Use color as a secondary cue; retain all text labels and status copy.
- Category colors are `#9B8AA1` for leveraged, `#87988A` for original, and `#8797A4` for cash plus cash equivalents.
- Selected controls use warm taupe, add actions use warm greige, remove actions use dusty rose, and valid totals use muted sage-gray.
- Preserve visible focus styles and responsive behavior down to 320px.

---

### Task 1: Compact holding and cash-equivalent editors

**Files:**
- Modify: `app/page.js`
- Modify: `app/globals.css`
- Test: `tests/position-settings-ui.test.js`
- Test: `tests/cash-equivalents-ui.test.js`

**Interfaces:**
- Consumes: existing `assetType`, allocation mode, position values, and validation status.
- Produces: `positionSection leveraged|original`, `positionEditorFields`, `positionEditorPrimaryFields`, and full-width custom allocation rows.

- [ ] **Step 1: Write failing compact-layout tests**

Add assertions that require semantic tone classes and field wrappers:

```js
assert.match(page, /className=\{`positionSection \$\{assetType\}/);
assert.match(page, /className="positionEditorPrimaryFields"/);
assert.match(styles, /\.positionEditorPrimaryFields\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
assert.match(styles, /@media \(max-width: 420px\)[\s\S]*\.positionEditorPrimaryFields/s);
```

For cash equivalents, require the same primary-field wrapper and `cash` tone on both cash outer cards.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test tests/position-settings-ui.test.js tests/cash-equivalents-ui.test.js`

Expected: FAIL because the wrappers and asset tone classes do not exist.

- [ ] **Step 3: Implement compact editor markup**

In `PositionSection`, add `assetType` to the section class. Wrap ticker and shares labels in:

```jsx
<div className="positionEditorPrimaryFields">
  {/* ticker label */}
  {/* shares label */}
</div>
```

Render the custom percentage label after the primary fields with `className="positionEditorAllocationField"`. Apply the same structure to each cash-equivalent editor. Add `cash` to the cash and cash-equivalent outer-card classes.

- [ ] **Step 4: Implement compact editor CSS**

Add a two-column primary field grid, reduce editor and section gaps/padding, make the allocation field full width, and keep a 320px-safe fallback. Apply category outer border/background variables only to the outer sections; inner editors remain warm white with neutral borders.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm test tests/position-settings-ui.test.js tests/cash-equivalents-ui.test.js tests/position-settings.test.js tests/cash-equivalents.test.js`

Expected: all focused tests PASS.

### Task 2: Compact rebalance parameter controls

**Files:**
- Modify: `app/page.js`
- Modify: `app/globals.css`
- Test: `tests/operation-ui.test.js`

**Interfaces:**
- Consumes: existing operation target Beta and precision handlers.
- Produces: two compact parameter rows without changing control semantics.

- [ ] **Step 1: Write a failing parameter-layout test**

Add assertions for the new row classes and conventional stepper order:

```js
assert.match(page, /className="operationParameterRow operationBetaField"/);
assert.match(page, /className="operationParameterRow operationPrecisionField"/);
assert.ok(page.indexOf('aria-label="降低再平衡 Beta 0.01"') < page.indexOf('value={operationTargetBeta}'));
assert.ok(page.indexOf('value={operationTargetBeta}') < page.indexOf('aria-label="提高再平衡 Beta 0.01"'));
assert.match(styles, /\.operationParameterRow\s*\{[^}]*grid-template-columns:/s);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test tests/operation-ui.test.js`

Expected: FAIL because the row classes and stepper order are absent.

- [ ] **Step 3: Implement compact parameter rows**

Place the Beta label and stepper in one row. Reorder controls to minus, numeric input, plus while preserving the existing event handlers and accessible labels. Place the precision label and segmented control in a second row, with its helper paragraph below the control.

- [ ] **Step 4: Implement responsive parameter CSS**

Use a label/control grid on wider screens, compact intrinsic widths for the Beta input and buttons, and a stacked fallback below 420px only when needed. Preserve 44px minimum button sizes.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `pnpm test tests/operation-ui.test.js tests/operation-rebalance.test.js tests/rebalance-apply.test.js`

Expected: all focused tests PASS.

### Task 3: Apply the Morandi semantic color system

**Files:**
- Modify: `app/page.js`
- Modify: `app/globals.css`
- Test: `tests/overview-card-header.test.js`
- Test: `tests/benchmark-drawdown-ui.test.js`
- Test: `tests/operation-ui.test.js`
- Test: `tests/position-settings-ui.test.js`
- Test: `tests/cash-equivalents-ui.test.js`

**Interfaces:**
- Produces CSS custom properties `--asset-leveraged`, `--asset-original`, `--asset-cash`, matching pale surfaces, and Morandi action/status variables.
- Consumes existing `purple`, `teal`, and `blue` allocation class hooks, remapped to the semantic asset variables for compatibility.

- [ ] **Step 1: Write failing semantic-color tests**

Require exact root variables:

```js
assert.match(styles, /--asset-leveraged:\s*#9b8aa1;/i);
assert.match(styles, /--asset-original:\s*#87988a;/i);
assert.match(styles, /--asset-cash:\s*#8797a4;/i);
assert.match(styles, /--action-selected:\s*#ddd7cf;/i);
assert.match(styles, /--action-remove:\s*#a07779;/i);
```

Also require `.positionSection.leveraged`, `.positionSection.original`, `.positionEditor.cash`, `.holdingGroup.cash`, Morandi market bands, and a warm selected bottom-navigation state.

- [ ] **Step 2: Run color/UI tests and verify RED**

Run: `pnpm test tests/overview-card-header.test.js tests/benchmark-drawdown-ui.test.js tests/operation-ui.test.js tests/position-settings-ui.test.js tests/cash-equivalents-ui.test.js`

Expected: FAIL because the semantic variables and tone selectors do not exist.

- [ ] **Step 3: Add semantic variables and category tones**

Define exact root variables for warm surfaces, three asset colors and surfaces, selected/add/remove/valid actions, and semantic risk bands. Remap allocation bar/legend colors to the new asset variables. Add `tone="cash"` to the cash-equivalent `HoldingGroup` call.

- [ ] **Step 4: Recolor approved overview and action surfaces**

Update only the approved surfaces: overall background/card/line/shadow neutrals, Beta rebalance pill and rail, market risk bands and range selection, allocation bar/legend, active bottom navigation, allocation mode selections, add buttons, remove text, and valid allocation totals. Preserve danger/error styling and focus visibility.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Run: `pnpm test tests/overview-card-header.test.js tests/benchmark-drawdown-ui.test.js tests/operation-ui.test.js tests/position-settings-ui.test.js tests/cash-equivalents-ui.test.js`

Expected: all focused tests PASS.

### Task 4: Verify and preview the integrated UI

**Files:**
- Verify only unless visual inspection identifies a scoped layout defect.

**Interfaces:**
- Consumes: completed compact layouts and color system.
- Produces: fresh automated and visual evidence plus a Vercel Preview URL.

- [ ] **Step 1: Run complete verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: zero failed tests, zero lint errors, and successful production build.

- [ ] **Step 2: Inspect mobile surfaces**

At a 390px viewport, inspect and capture the overview, holdings settings in automatic and custom modes, cash settings, and rebalance parameters. Confirm no overflow, overlap, clipped focus rings, or sub-44px controls.

- [ ] **Step 3: Commit the implementation**

```bash
git add app/page.js app/globals.css tests
git commit -m "feat: compact settings with Morandi palette"
```

- [ ] **Step 4: Deploy Vercel Preview**

Deploy the current branch to the linked `tingyonglin-droids-projects` project without `--prod`, inspect the deployment, and report its READY Preview URL.
