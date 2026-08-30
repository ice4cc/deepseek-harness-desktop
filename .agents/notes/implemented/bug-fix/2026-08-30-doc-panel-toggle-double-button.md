# Agent Note: Doc panel toggles must not paint twice during the column transition

Status: implemented

English | [中文](2026-08-30-doc-panel-toggle-double-button.zh.md)

## Problem

Closing the document panel painted two toggle buttons at the same coordinates. `DocPanelRoot` showed its portaled reopen button with `hidden={!collapsed}`, which flips the moment state changes, while the frame's grid track animates to zero over `--ds-transition-duration-slow` (300 ms). For the whole transition the in-panel collapse button was still painted (clipped by the shrinking column), so both buttons occupied the same top-right box — a doubled glyph. DOM instrumentation of a real close animation showed both elements visible from 7 ms after the click, and mid-animation the collapse button's layout box drifted up to 20 px right of the reopen button's, leaking a thin sliver past its right edge.

A second artifact in the closed state: at zero column width the conversation column extends to the frame's right edge, so its right-aligned session-header utility (the "Session log" export pill) landed on top of — desktop shell: 12 px below — the portaled reopen button, reading as a second stacked button.

A third surfaced in the web e2e accessibility goldens while fixing these: the always-mounted column body carried only `inert` when collapsed, and Chromium keeps inert subtrees in the accessibility tree (exposed as disabled), so the closed panel's content was still reachable by assistive tech.

A fourth appeared in desktop mode after the first two were fixed: during the last phase of close the in-panel collapse button slid up to 20 px toward the window edge while being clipped, reading as a covered button that reappeared at rest. The `.header` carries 10 px side padding; once the column is narrower than that padding its content box — the positioning context for the absolutely positioned collapse button via `.titlebar` — is pushed past the frame's right edge, and the button follows it.

## Decision

- **One corner toggle portaled into the frame's overlay layer is always visible.** `DocPanelRoot` renders a single button at the frame's top-right corner in both states; its label and action flip with the column state (`panel.expand`/`openPanel` collapsed, `panel.collapse`/`closePanel` expanded). The node never unmounts and never moves, so close is a pure track animation under a stationary button — there is no handoff between two nodes, hence nothing to gate on the transition.
- **The session header clears the frame's top-right corner while the doc panel is closed.** AppFrame passes `docCollapsed` as an owner prop to the `conversation` slot; ConversationRoot forwards it to the `conversation.session.header` slot, and the header adds a 20 px right margin to `.headerUtilities` (48 px from the frame edge in total — an 8 px gap against the button zone at right:12 px plus 28 px width).
- **The collapsed body carries aria-hidden alongside inert.** `inert` alone drops it from focus and interaction but not from the accessibility tree; with both attributes the closed body is invisible to assistive tech while its paint — and the track animation that clips it — continue.

## Consequences

- Every frame of the close animation paints exactly one toggle at the same coordinates: no doubled glyph, no empty corner between two nodes, no drift toward the window edge.
- The closed panel's content no longer reaches assistive tech; expanding removes both attributes in the same render.
- In the closed state, the "Session log" pill (and any future right-aligned header utility) sits clear of the toggle in both shells.
- The corner is occupied by the toggle in both states, so the open panel's title-bar band carries no controls of its own (it remains the desktop drag region).

## Related

The tooltip bubble flash on these same toggles was fixed separately (2026-08-30-tooltip-click-flash) by arming hover on pointer move. That fix removed the only objection to delaying the reopen button's un-hide recorded in that note ("the button would still appear under the stationary cursor — same synthetic mouseenter, same delayed bubble"): with armed-on-move, no bubble pops without a real pointer move regardless of when the button appears.

## Alternatives considered

- **Two persistent buttons with a settle-gated handoff.** The in-panel collapse button stays pinned at the corner (anchored to `.panel`, clipped by the track) while a ResizeObserver watches the section box and, once the column is narrower than the button's right inset, hides the collapse button and un-hides the portaled one in the same render. Shipped mid-session and then replaced: the handoff still left an empty corner frame between the two nodes that read as a blink, and it kept the ResizeObserver machinery and a width constant coupled to a CSS inset. One node with a flipped label removes both.
- **A timeout matching `--ds-transition-duration-slow`.** Couples TypeScript to a CSS token value; it drifts if the token changes and needs a special case for reduced motion.
- **CSS-only clearance for the utilities (padding on the center column or a `data-doc-collapsed` selector from feature CSS).** The collision exists only while the doc panel is closed, so an unconditional indent wastes 48 px of header width in the open state; reaching up to the frame's data attribute from another package's stylesheet would create an implicit cross-package contract that the owner-prop channel replaces.
