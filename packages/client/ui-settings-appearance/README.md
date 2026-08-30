---
description: "Appearance settings section for the Web GUI: a durable chat content width preference with three levels (Standard / Wide / Extra wide); for users and maintainers of the settings panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-appearance

English | [中文](README.zh.md)

## Summary

This package adds an Appearance section to the settings panel with one preference: the chat content width. You choose Standard, Wide, or Extra wide; the wider levels override ui-conversation's `--dsh-chat-content-width` axis (shipped default 748px), and because the composer card width and the centering padding derive from the same variable, the whole content axis widens consistently. The pick is a durable preference: it survives restarts and closes of the settings panel, and it applies for as long as the browser stays open.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin row in the web-app module table; when a settings provider exists, an `appearance` entry appears in the settings panel navigation with one preference row. Selecting a level applies it immediately and persists it.

### Width levels

Standard keeps the shipped conversation column width (748px). Wide and Extra wide override the `--dsh-chat-content-width` custom property declared on the conversation root; the composer card width and the centering padding derive from that same variable, so one pick widens the whole content axis at once. A level at or below Standard injects no override at all.

### Persistence

The level is a durable preference in this package's settings namespace (`ui-settings-appearance`, field `contentWidth`). The node half registers the field when a settings provider exists; the browser half binds it through `ctx.settingsScope`. Selecting a level publishes it to a plugin-lifetime store — the settings panel unmounts its sections on close, so the row's state must outlive any single render — and writes the field back. External document changes (another browser, a direct edit) fold back through the shared describe mirror and converge both the row and the width sheet.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The override sheet for the width variable is owned by the plugin, not the section component: closing settings never resets the column, and the sheet outlives any single render of the row. The node half declares the namespace and field so the preference exists in the Host document; the browser half binds the scope, renders the row, and publishes the active level to the store that owns the override injection.

| File | Role |
|---|---|
| [`src/appearance-settings.ts`](src/appearance-settings.ts) | Namespace, field name, and the settings type |
| [`src/client/index.ts`](src/client/index.ts) | Plugin body: scope binding, store declaration, row registration |
| [`src/client/core.ts`](src/client/core.ts) | Pure level-to-CSS mapping for the width override |
| [`src/client/AppearanceSection.tsx`](src/client/AppearanceSection.tsx) | The settings row and its level control |
| [`src/client/locales.ts`](src/client/locales.ts) | Section copy in the `settings.appearance` locale namespace |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — the settings panel shell that hosts this section.
- [Web styling reference](../../../docs/web-styling.md) — the token and CSS-module rules the override follows.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the width level is pure presentation: it overrides `--dsh-chat-content-width` in one browser and touches no session event, draft content, or request payload.

#### KV Cache effect

None; the message prefix (system + history) is byte-identical across levels, so prefix caching is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current appearance surface. They are package constraints, not a general theme-system comparison or a task backlog.

- **One width axis** — the override targets `--dsh-chat-content-width` only; the trajectory view, the details column, and other product surfaces keep their own widths.
- **Loopback persistence** — settings RPCs are loopback-only, so remote browsers run the scope in memory mode: the tab and its control work, but a pick there does not persist to the Host document (the shared limitation of every settings-backed preference).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
