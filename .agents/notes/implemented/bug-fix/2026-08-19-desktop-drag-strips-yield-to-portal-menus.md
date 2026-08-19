# Agent Note: Desktop drag strips yield to open portaled menus

Status: implemented

English | [中文](2026-08-19-desktop-drag-strips-yield-to-portal-menus.zh.md)

## Problem

In the desktop shell, the conversation column's empty areas (the blank-draft hero sheet, or the 44 px band above the session header once a session is open) and the sidebar brand row are window drag strips ([desktop shell note](../architecture/2026-08-16-desktop-shell-mode-a.md)). Chromium caches the drag rectangles in the browser process and routes a mousedown inside one to the window even when other elements paint above it, and an element in a different tree branch cannot carve the strip's own cached rectangle — which is why the settings dialog needed the `<html data-settings-open>` flag with each strip yielding, on top of declaring no-drag on its own layer.

`Menu`'s portal mode renders its list into `document.body` — a different branch from every strip. On the new-session hero, the agent-preset seat menu opens straight over the hero sheet: rows overlapping the composer card (a no-drag hole carved inside the strip's subtree) pick up clicks, but the rows hanging below the card — 极简模式, 创造模式 — sit over the bare drag region and never receive the pointer events; the mousedown moves the window, so the user experiences the rows as blocked and unselectable. The same hole exists for every portaled menu opened over a strip (workspace picker, permission rows, JsonTree), and for outside-click dismissal: a click meant to close the menu is swallowed by the window too.

## Decision

An open portaled menu flags `<html data-portal-menu-open>` for its open lifetime. `ui-primitives`' Menu sets and clears the flag itself — a module-scoped refcount, incremented when a portaled menu opens and decremented on close or unmount, the attribute removed when the count reaches zero — so two concurrently open menus do not unflag each other. In-place (non-portal) menus set no flag: they render inside their own branch, and the strip's no-drag carve-out for interactive descendants already covers their rows.

Each desktop drag strip yields for the flag's lifetime in its own module CSS: the conversation's `.dragBand` and hero `.scrollBody` in `ConversationRoot.module.css`, the sidebar's `.logoRow` in `SidebarRoot.module.css` — each as `:global(html[data-shell='desktop']:is([data-settings-open], [data-portal-menu-open]))`, the same yield pattern as the settings dialog. While a portaled menu is open, a click in the strip outside the menu reaches the page and closes the menu instead of moving the window. Plain web-shell loads carry no drag regions and ignore the flag.

## Verification

The `Menu` spec in `ui-primitives` (`tests/atoms.client.spec.tsx`) pins the flag lifecycle: an open portaled menu sets the attribute, an open in-place menu does not, two concurrently open portaled menus keep it held across one of their closes, and the last close removes it. `pnpm run test:gui` is green. The click-swallowing itself is Chromium's cached drag-rectangle behavior — the same documented behavior the settings-dialog flag and the portaled floating-toggle fix address in the desktop shell note — so the Playwright Chromium lane, where `-webkit-app-region` is inert, cannot reproduce it. The user-visible defect was that on the desktop app's blank-draft hero, picking 极简模式 or 创造模式 from the preset menu dragged the window instead of selecting the mode.

## Alternatives considered

**Declare no-drag on the portaled list itself.** Rejected — an element in a different tree branch cannot carve the strip's cached rectangle. That is exactly the lesson the settings overlay recorded: its own no-drag covers a layer mounted inside a drag strip, but strips merely under it in screen space must be cleared by the flag, the only reliable way to remove a rectangle another branch of the tree owns.

**Render the seat menu in place (no portal).** Rejected — portal mode exists because in-place lists get cropped by overflow-clipping ancestors (the hero sheet sits inside the scroll body, a scroll container). In place, the menu would also be a scroll-content child of the strip's subtree, and its card chrome — padding, inter-row gaps — would inherit `drag`. The bug would move, not vanish.

**Yield the strip only over the menu's own rectangle.** Rejected — the cached rectangles can only be removed, not addressed per-rectangle at click time. A whole-strip yield for the menu's open lifetime is the same policy the settings dialog accepts: dragging the window through an open overlay is not a supported gesture.

**One flag per menu site (preset seat only).** Rejected — every portaled menu (workspace picker, permission rows, JsonTree) opens over these strips; the signal belongs to the shared portal mechanism they all pass through, not one consumer.

## Consequences

While any portaled menu is open, the desktop drag strips cannot move the window; a click in them reaches the page and closes the menu. That is the accepted trade, the same as the settings dialog. `data-portal-menu-open` is a new cross-package contract: `ui-primitives` sets it, `ui-conversation` and `ui-sidebar` consume it in their module CSS, and both sides are listed in `apps/desktop/README.md`'s upstream-sync table. A future interactive surface portaled over a strip (a HoverCard with actionable content) will need the same flag.
