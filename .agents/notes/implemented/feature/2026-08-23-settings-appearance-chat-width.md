# Agent Note: Appearance settings section with chat content width levels

Status: implemented

English | [中文](2026-08-23-settings-appearance-chat-width.zh.md)

## Problem

The web GUI's conversation column has one fixed shipped width: `--dsh-chat-content-width` (748px), declared in ui-conversation's `ConversationRoot`. On large screens a user who wants a wider reading column had no control at all — the value lives in a CSS declaration inside another package, and the settings panel had no appearance surface to host a preference for it.

## Decision

A new package `@deepseek-ai/dsh-client-ui-settings-appearance` registers an `appearance` section (id `appearance`, order 5, between general and models) over the `settings.section` seat through `ctx.slots.inject`. The section is one row: chat content width, three levels — standard / wide / xwide.

The level is a durable preference in the settings namespace `ui-settings-appearance` (field `contentWidth`): the node half registers the namespace and its zod schema when a settings provider exists, and the browser half binds it through `ctx.settingsScope`. The live level sits in a plugin-lifetime snapshot store because the settings panel unmounts its sections on close. Selecting a level publishes to that store and writes the field back; external document changes fold back through the shared describe mirror and converge row and override together.

The width itself is applied by an override `<style>` sheet owned by the plugin, not the section component: wide and xwide inject `div { --dsh-chat-content-width: <px>px !important; }` (880px / 1200px) into `document.head`, and standard injects nothing. Because the composer card width and the centering padding derive from the same variable, the whole content axis widens consistently. Two load-bearing choices:

- **Standard means "no override", not a pinned 748px.** The shipped default stays owned by ui-conversation; if that package moves its default, standard follows without a second copy of the number.
- **Adoption and CSS application are separate steps in `apply`.** A local pick publishes before its write round-trips, so adopting from the scope snapshot on that path reverts the pick against the still-stale durable value (this exact regression was caught by the plugin spec). Adoption runs at activation and on scope notifications only; the pick path applies CSS directly.

## Alternatives considered

**A dynamic Cordis plugin.** The prototype that started this work: it shipped the same three levels as a process-local plugin in one session, but it vanished on every restart, needed per-session approval, and could not persist the choice — the maintenance cost is exactly what motivated moving to a static package.

**A session-scoped preference (busyEnter style).** Width is a machine-level presentation fact, not a session property: per-session storage would fragment one visual choice across sessions and add submission-settings machinery for a value that never reaches a model request.

**A row inside the existing general section.** The user asked for a dedicated appearance tab, and appearance preferences (font size, density) are expected to grow; a section of its own keeps general's behavior toggles clean.

## Consequences

Pure presentation: no session event, draft content, or request payload changes at any level, so model requests render exactly as before (documented in the package README's Model Experience). The override couples this package to ui-conversation's variable name — a cross-package presentation contract, not a data one; changing that variable renames one line here. Only the chat content axis widens: trajectory view and details column keep their own widths (README limitation). Settings RPCs are loopback-only, so remote browsers run the scope in memory mode — the tab works there but a pick does not persist (the shared limitation of every settings-backed preference). A durable `ui-settings-appearance` section remains in the settings document if the package is ever removed; it is namespaced and inert.

## Testing

`packages/client/ui-settings-appearance/tests/`: `core.client.spec.ts` for the level→CSS mapping, `appearance-section.client.spec.tsx` for the segmented row (active state, picks, external store moves), `browser-plugin.client.spec.ts` for the plugin over a real SlotRegistry with the settings transport mocked at the `settingsScope` boundary (seat deferral and teardown, durable adoption, pick write-back, stale-scope non-reversion, sheet create/reuse/remove), plus host, invariant, and locale-parity specs — 100% per-file coverage. `pnpm run test:gui` is green. The new nav item rewrites every settings-dialog golden by exactly one entry (re-recorded under `DSH_SNAPSHOT=refresh`, diff-verified to be the nav button only), and the keyless `DSH_SNAPSHOT=replay` pass of `test:web` is green except `reference-composer.e2e.ts`, whose composer golden mismatch (missing think-tag selector) fails identically on a clean tree and predates this change.
