---
description: "Composer think-level control for the Web GUI: a tool-row seat that rewrites the draft's trailing <|think_*|> tag so each message carries an explicit reasoning level; for users and maintainers of the composer experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-think-tag

English | [中文](README.zh.md)

## Summary

This package puts a think-level control in the composer row: one seat over `conversation.input.right`, inside the composer card, before the model seat and send button. You choose how hard the model thinks for the message you are about to send — no thinking, brief, standard, or deep — or return to the session default. The choice rides the draft as a trailing `<|think_*|>` tag: it is visible in the textarea, logged with the draft, and stripped by the chat template at render time, which instead sets that message's reasoning effort. No submission-pipeline hook is involved; the tag is plain model-visible draft content.

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

Mount the plugin row in the web-app module table; it waits for the conversation composer to declare `conversation.input.right` and installs the control there. The trigger shows the standard Think icon with the active level label; the dropdown offers the four inline levels plus "session default".

### Choosing a level

Choosing a level rewrites the draft's trailing `<|think_*|>` tag through the public `setDraft` action. Because model-visible content is logged draft content, the machine, the transcript, and the wire payload all carry the tag without any pipeline hook; the chat template strips it at render time. "Session default" removes the tag, leaving the provider/session `reasoning_effort` in charge. A tag appearing mid-draft is treated as plain text: only the trailing span is scanned and rewritten, so user prose is never touched.

### Session boundary

The control renders nothing of its own when no session is current (the owner zone is absent). The tag is a per-draft value: it does not persist across sessions, and the session's configured effort stays the default.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers its seat over `conversation.input.right` through declaration-aware `slots.inject()`, so it installs when the composer declares the zone and leaves with the plugin fiber. The trigger button and dropdown are pure presentation: level state is derived from the draft text itself (the trailing tag), which keeps a single source of truth in the logged draft rather than a second store. Selecting a level composes the new draft text and calls the owner's `setDraft` action; no other channel moves data.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Slot registration and inject face (draft access, `setDraft`) |
| [`src/client/core.ts`](src/client/core.ts) | Pure draft-tag manipulation: level detection and trailing-span rewrite |
| [`src/client/ThinkTagControl.tsx`](src/client/ThinkTagControl.tsx) | Trigger button + level dropdown over the seat |
| [`src/client/locales.ts`](src/client/locales.ts) | Level labels in the `thinkTag` locale namespace |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-conversation](../ui-conversation/README.md) — owns the composer card and declares the `conversation.input.right` zone.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the draft's trailing `<|think_*|>` tag, which the chat template strips at render time and replaces with the message's reasoning effort; the control itself registers no prompt, schema, or tool.

#### KV Cache effect

The tag lives at the end of the draft, so the message prefix (system + history) is unchanged and prefix caching is unaffected; switching levels only appends/replaces the trailing token span of the current message.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current control surface. They are package constraints, not a general reasoning-mode comparison or a task backlog.

- **Draft-only, per message** — the tag does not persist across messages or sessions; repeated tagging is the intended workflow (a session-level override would be a settings-plane feature, not this plugin's).
- **Mid-draft tags are inert** — a tag typed in the middle of the text stays literal prose for the model; only the trailing span is controlled.
- **Template support required** — providers whose chat template does not strip `<|think_*|>` tags will see the literal tag as model prose; the control does not detect or gate on template capability.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
