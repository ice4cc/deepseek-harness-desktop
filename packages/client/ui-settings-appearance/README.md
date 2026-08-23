# @deepseek-ai/dsh-client-ui-settings-appearance

English | [中文](README.zh.md)

Appearance settings section: an `appearance` entry in the settings panel navigation with one preference row — the chat content width, as three levels (Standard / Wide / Extra wide). Standard keeps the shipped conversation column width; the wider levels override ui-conversation's `--dsh-chat-content-width` axis, which the composer card width and the centering padding derive from, so the whole content axis widens consistently.

## Mechanism

The level is a durable preference in this package's settings namespace (`ui-settings-appearance`, field `contentWidth`), registered by the node half when a settings provider exists and bound by the browser half through `ctx.settingsScope`. Selecting a level publishes it to a plugin-lifetime store (the settings panel unmounts its sections on close, so the row's state must outlive any single render) and writes the field back. An override sheet for the width variable is owned by the plugin, not the section component: closing settings never resets the column, and a level at or below Standard injects nothing. External document changes (another browser, a direct edit) fold back through the shared describe mirror and converge both the row and the sheet.

## Model Experience

### No model-visible change

#### What the model sees

The width level is pure presentation: it changes how wide the conversation column renders in one browser. No session event, draft content, or request payload is affected, so every model request renders exactly as before.

#### Token effect

None. Prompt size is unchanged at every level.

#### KV Cache effect

None. The message prefix (system + history) is byte-identical across levels, so prefix caching is unaffected.

## Known Limitations and Deferred Work

- **One width axis** — the override targets `--dsh-chat-content-width` only; the trajectory view, the details column, and other product surfaces keep their own widths.
- **Loopback persistence** — settings RPCs are loopback-only, so remote browsers run the scope in memory mode: the tab and its control work, but a pick there does not persist to the Host document (the shared limitation of every settings-backed preference).
