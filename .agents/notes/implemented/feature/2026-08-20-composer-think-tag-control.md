# Agent Note: Composer think-tag control over the conversation.input.right seat

Status: implemented

English | [中文](2026-08-20-composer-think-tag-control.zh.md)

## Problem

The web composer had no user-facing control for per-message reasoning effort. The provider/session `reasoning_effort` is a session-level selection, so a user wanting one message to think deeply (or not at all) had no way to say so, and the choice was invisible: nothing in the draft, the transcript, or the wire payload showed which effort a message would receive.

## Decision

A new package `@deepseek-ai/dsh-client-ui-think-tag` registers a tool-row entry over the `conversation.input.right` seat (the composer card, before the model seat and send button) through `ctx.slots.inject('conversation.input.right', ...)`. The control rewrites the composer draft's trailing span with the pure functions in `src/client/core.ts` (`thinkLevelOf` / `setThinkLevel`) through the public `setDraft` input action; it owns no store, registers no event, and has no host-side behavior (the node half is an empty apply).

The level materializes as an inline `<|think_off|>` / `<|think_low|>` / `<|think_medium|>` / `<|think_xhigh|>` tag appended to the draft. Model-visible content is logged draft content, so the tag rides the existing model-visible channel end to end: the input machine, the session log, and the wire payload all carry it without any submission-pipeline hook, and replay re-renders the tagged draft verbatim. The froggeric chat template strips the tag from the rendered prompt and derives the per-message reasoning effort from it. "Session default" removes the tag, putting the provider/session `reasoning_effort` back in charge.

Only the trailing span is scanned: a tag typed mid-draft is literal prose for the model, never rewritten. The tag is a per-draft value — the control keeps no state beyond its own dropdown open/closed, and it renders nothing while no session is current (the owner zone is absent). The session-level effort vocabulary (`ReasoningEffortId`), the request-header logging, and the fallback selection stay where [adapter-owned reasoning effort capabilities](../architecture/2026-07-24-adapter-owned-reasoning-effort-capabilities.md) put them; the tag complements that mechanism per message rather than replacing it.

## Alternatives considered

**Submit-time tag injection from a session-level UI choice.** A send-pipeline hook would append the tag outside the draft, breaking model-visible ⟺ logged: the transcript would not reconstruct the tagged message, and replay would untag it. A session-level choice also needs a store and a settings row for a value that is per-draft anyway.

**A session-level settings row (agent-preset style).** Persisting an override across messages is a settings-plane feature with different owners and lifecycle; per-message tagging is the intended workflow here (a session override is deferred, recorded in the package README's limitations).

**Stripping the tag client-side and attaching the level to a request setting.** That needs a new model-visible input (hence a new session event) or an undocumented wire field; the draft is already the sanctioned carrier for model-visible content.

## Consequences

The composer's a11y tree carries one extra button between the access-mode control and the model seat; the 41 composer-facing web goldens record that trigger (replayed keyless under `DSH_SNAPSHOT=replay`). A tagged message costs one trailing token span on the wire and no prompt tokens — the template strips it — and switching levels before sending is free, with the message prefix (system + history) untouched for prefix caching. Providers whose chat template does not strip `<|think_*|>` tags see the literal tag as user prose; this is documented in the package README and deliberately not gated.

## Testing

`packages/client/ui-think-tag/tests/`: `core.client.spec.ts` for the pure tag logic, `think-tag-control.client.spec.tsx` for the component over the driven input store (level labels, pick/replace/clear/no-op, outside-click and Escape dismissal, non-Escape keys, the no-machine guard — at 100% per-file coverage), and `browser-plugin.client.spec.ts` for the plugin boot through the client runtime. The assembled surface was re-recorded under `DSH_SNAPSHOT=refresh` and validated by a clean `DSH_SNAPSHOT=replay` pass of the web suite.
