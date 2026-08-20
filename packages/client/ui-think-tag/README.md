# @deepseek-ai/dsh-client-ui-think-tag

English | [中文](README.zh.md)

Composer think-tag control: a tool-row seat over `conversation.input.right` (inside the composer card, before the model seat and send button). The trigger shows the standard Think icon with the active level label; the dropdown offers the four inline levels (no thinking / brief / standard / deep) plus "session default".

## Mechanism

Choosing a level rewrites the draft's trailing `<|think_*|>` tag through the public `setDraft` action — the tag is visible in the textarea (model-visible content is logged draft content, so the machine, the transcript, and the wire payload all carry it without a submission-pipeline hook) and the chat template strips it at render time. "Session default" removes the tag, leaving the provider/session `reasoning_effort` in charge. A tag appearing mid-draft is treated as plain text: only the trailing span is scanned and rewritten, so user prose is never touched.

The control renders nothing of its own when no session is current (the owner zone is absent); the tag is a per-draft value, so it does not persist across sessions and the session's configured effort stays the default.

## Model Experience

### Think-tagged user message

#### What the model sees

The trailing `<|think_*|>` tag never reaches the rendered prompt: the froggeric chat template strips it and instead sets the message's reasoning effort to the chosen level. A tagged message reaches the model as the user's plain text; an untagged message renders unchanged, with the provider/session `reasoning_effort` still in charge.

#### Token effect

On the wire the tag rides the user message body as one trailing token span; the template strips it, so no tag tokens enter the rendered prompt. The chosen level changes how much reasoning the model produces for that one message, not the prompt size, and switching levels before sending costs no tokens.

#### KV Cache effect

The tag lives at the end of the draft, so the message prefix (system + history) is unchanged and prefix caching is unaffected; switching levels only appends/replaces the trailing token span of the current message.

## Known Limitations and Deferred Work

- **Draft-only, per message** — the tag does not persist across messages or sessions; repeated tagging is the intended workflow (a session-level override would be a settings-plane feature, not this plugin's).
- **Mid-draft tags are inert** — a tag typed in the middle of the text stays literal prose for the model; only the trailing span is controlled.
- **Template support required** — providers whose chat template does not strip `<|think_*|>` tags will see the literal tag as model prose; the control does not detect or gate on template capability.
