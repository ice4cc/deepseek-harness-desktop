# Agent Note: Tooltip bubbles must not flash on toggle-button clicks

Status: implemented

English | [中文](2026-08-30-tooltip-click-flash.zh.md)

## Problem

Clicking the document panel's collapse button produced a visible flash: the "Collapse document panel" bubble popped in at mousedown and dropped out ~10 ms after release, then — with the cursor still parked — the other toggle's bubble popped in under it about half a second later. Instrumented e2e runs (frames plus per-event timestamps) showed both artifacts are defects of the shared `Tooltip` primitive's trigger model, not layout bugs:

1. **Focus flash.** `Tooltip` showed the bubble immediately on any focus. Mousedown focuses the button, so every click on a tooltip-anchored control flashed its own label for the duration of the press, then hid it when the button lost focus (through `inert` or `hidden`).
2. **Synthetic hover flash.** When a panel toggles, the opposite toggle appears at the same coordinates under the stationary cursor. Chromium re-runs hit-testing on that layout change and dispatches a synthetic `mouseover`/`mouseenter` to the newly topmost element with no pointer movement at all (the `mouseover` lands ~10 ms after mouseup with no preceding `mousemove`). That armed the 500 ms hover timer, so a bubble appeared half a second after the click with zero pointer intent — in both directions: after closing (on the reopen button) and after reopening (on the collapse button).

## Decision

The trigger model in `Tooltip` now matches user intent:

- **Hover arms on the entering pointer move, never on `mouseenter` alone.** The first `mousemove` inside the anchor starts the delay timer (once per stay; later moves leave it running). A genuine hover's crossing move targets the anchor in the same event batch as the enter, so it arms within the same frame; an element that appears under a parked cursor receives a synthetic enter with no movement and never shows until the pointer actually moves.
- **A press cancels any pending hover show.** A real hand always produces a genuine move before clicking, so by the time the user presses, the delay timer is often already armed — without cancellation it fires mid-press or right after release, popping the label exactly when the user acts (the residual flash in the doc panel's reopen direction). `pointerdown` on the anchor drops the pending show and resets arming; the next real move re-arms. A bubble already visible from a completed hover stays: the pointer is still on the anchor.
- **Press-originated focus never shows; everything else does, immediately.** Chromium reports `detail === 0` on every focus event — mouse clicks included (verified empirically; the spec's click-count semantics are not implemented), so `detail` cannot separate keyboard from mouse focus. Instead, the anchor records its own `pointerdown` timestamp, and a focus landing within 300 ms of it is treated as the press's own focus and suppressed; anything later (keyboard Tab, programmatic) shows immediately, pinned by the spec. A click on an already-focused button fires no new focus event at all, so there is nothing to suppress.

Both document-panel toggles keep their hover tooltips — with the armed-on-move rule, neither can pop a bubble without pointer intent.

## Consequences

- Every Tooltip consumer (~50 call sites) loses the sub-second label flash on click; copy buttons, rail controls, and panel toggles all stop flashing their own labels during the press.
- No tooltip ever pops under a parked cursor, in either toggle direction; the bubble now requires an actual pointer move over its anchor.
- The doc panel's collapse/reopen pair behaves identically to before for genuine hovers (enter + move arms within the same frame) and for keyboard focus.

## Related

The locale keys `docPanel.panel.expand` / `docPanel.panel.collapse` stay in use through both buttons' tooltips and `aria-label`s. The sidebar floating expand button remains tooltip-free by its own decision (it sits over window chrome).

## Alternatives considered

- **Gate focus on `nativeEvent.detail`** (keyboard = 0, mouse >= 1). The spec's click-count semantics look exactly right, but Chromium reports `detail === 0` for mouse-click focus in every configuration probed — the fix passed jsdom and failed in the real browser. Recorded here so the dead end is not retried.
- **Remove the tooltips from the doc-panel toggles** (the sidebar floating-toggle pattern). Fixes the observed flash without touching shared infrastructure, but leaves the artifact class live for every other tooltip-anchored element that can appear under a parked cursor, and costs the hover affordance both toggles currently have.
- **Gate arming on move-recency timestamps** (a "stale move" threshold). Same outcome as arming-on-move, but adds a magic constant and fails in the opposite direction: a fast pointer stop just inside the anchor would look stale to a coarse threshold.
- **Delay unhiding the reopen button until the track settles.** The button would still appear under the stationary cursor — same synthetic `mouseenter`, same delayed bubble.
- **Toggle `disabled` on the tooltip during the transition.** A transient component-state flag for a purely presentational artifact, and it leaves the focus flash in place.
