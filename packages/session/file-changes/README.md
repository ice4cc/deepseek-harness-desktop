---
description: "Session projection unit that aggregates successful edit/write tool results into a bounded per-path change list with inline diffs; for consumers of the fileChanges projection such as the web document panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-file-changes

English | [中文](README.zh.md)

## Summary

This package gives every session a `fileChanges` projection: a bounded per-path aggregation of successful `edit`/`write` tool results — edit count, added/removed line totals, last change time, and the newest change's hunks. A consumer such as the web document panel's Changes tab reads one value and gets the session's whole file-change story with inline diffs, without scanning the event log. The projection is served through the session-projection seam (registry snapshot, change feed, and every projection carrier), so it updates live as the agent works and replays deterministically from the log.

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

Mount the plugin in an assembly that already provides `sessionProjections`; it registers the `fileChanges` key and consumers read it through the projection seam.

### Mounting

```yaml
- id: file-changes
  name: '@deepseek-ai/dsh-file-changes'
```

The plugin injects `sessionProjections` — its whole purpose; in assemblies without the registry the fiber stays pending and nothing registers.

### What gets folded

- Only successful `edit`/`write` results contribute: the call parks its `file_path` (and, for `write`, the raw `content`) by callId at `tool/call`, and the paired `tool/result` folds it. Errored results, other tools, malformed arguments, and unpaired results change nothing.
- `added`/`removed` count each hunk's changed lines as the context-cancelled multiset difference of its old/new sides (context lines appear on both sides and cancel); a `null` old side counts its new lines as added. The line-terminator rule mirrors the diff surface: empty text is zero lines, one trailing newline terminates rather than adds.
- `lastDiff` retains the newest change's hunks only; `edits`, `added`, and `removed` accumulate across every folded change on the path.
- Boundedness is part of the contract: at most 32 paths (LRU-evicted by touch order), at most 40 hunks per retained diff, each hunk side truncated to 8,000 characters with a marker. Truncation is display-side only — the counts still cover every hunk.
- A call whose result never lands belongs to a cancelled or failed turn; parked calls are dropped at `turn/end` (results land within their turn).
- Paths are recorded verbatim as the model wrote them (model-facing, unresolved); relativizing against the session cwd is the consumer's job, and a change made through any other surface (bash, a manual edit) is invisible to this projection by design.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers one projection unit with the session-projection registry: a state machine keyed by path, updated by `apply(state, event)` over the session log. Because every update is a pure fold of logged events, the same state derives from live streaming and from replay. The client face (`/client`) exposes the typed read model for consumers that run in the browser.

| File | Role |
|---|---|
| [`src/projection.ts`](src/projection.ts) | The `fileChanges` projection definition: schema, fold, wire view |
| [`src/types.ts`](src/types.ts) | Projection state and view types, registry merges |
| [`src/client.ts`](src/client.ts) | Browser-side typed read model |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-doc-panel](../../client/ui-doc-panel/README.md) — the reference consumer: the Changes tab with inline diffs.
- [session-projection](../session-projection/README.md) — the seam that serves this key and every other projection.
- [Session subsystem page](../../../docs/subsystems/session.md) — the event vocabulary the fold consumes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current projection surface. They are package constraints, not a general diff-engine comparison or a task backlog.

- **Tool-name scoping** — the fold matches tools named `edit`/`write`, which in this harness are owned by dsh-tool-fs; a differently-shaped tool reusing those names would fold with its own argument fields (a missing `file_path` simply parks nothing).
- **An edit without result metadata keeps no diff** — `lastDiff` stays null for that change (the counts still accrue), because the applied hunks are not reconstructable from the log alone.
- **Mounted only in the web-app bundle** — other assemblies serve no `fileChanges` key; consumers read the value's absence as "no changes" rather than an error.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
