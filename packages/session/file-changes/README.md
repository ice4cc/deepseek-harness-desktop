# @deepseek-ai/dsh-file-changes

English | [中文](README.zh.md)

Function plugin registering the `fileChanges` projection unit: a bounded per-path aggregation of successful `edit`/`write` tool results — edit count, added/removed line totals, last change time, and the newest change's hunks — folded from `tool/call`/`tool/result` pairs and served through the session-projection seam (registry snapshot, change feed, and every projection carrier). The reference consumer is the web document panel's Changes tab, which lists the session's file changes with inline diffs.

## Fold semantics

- Only successful `edit`/`write` results contribute: the call parks its `file_path` (and, for `write`, the raw `content`) by callId at `tool/call`, and the paired `tool/result` folds it. Errored results, other tools, malformed arguments, and unpaired results change nothing.
- `added`/`removed` count each hunk's changed lines as the context-cancelled multiset difference of its old/new sides (context lines appear on both sides and cancel); a `null` old side counts its new lines as added. The line-terminator rule mirrors the diff surface: empty text is zero lines, one trailing newline terminates rather than adds.
- `lastDiff` retains the newest change's hunks only; `edits`, `added`, and `removed` accumulate across every folded change on the path.
- Boundedness is part of the contract: at most 32 paths (LRU-evicted by touch order), at most 40 hunks per retained diff, each hunk side truncated to 8,000 characters with a marker. Truncation is display-side only — the counts still cover every hunk.
- A call whose result never lands belongs to a cancelled or failed turn; parked calls are dropped at `turn/end` (results land within their turn).
- Paths are recorded verbatim as the model wrote them (model-facing, unresolved); relativizing against the session cwd is the consumer's job, and a change made through any other surface (bash, a manual edit) is invisible to this projection by design.

## Composition

```yaml
- id: file-changes
  name: '@deepseek-ai/dsh-file-changes'
```

Injects `sessionProjections` — the plugin's whole purpose; in assemblies without the registry the fiber stays pending and nothing registers.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Tool-name scoping** — the fold matches tools named `edit`/`write`, which in this harness are owned by dsh-tool-fs; a differently-shaped tool reusing those names would fold with its own argument fields (a missing `file_path` simply parks nothing).
- **An edit without result metadata keeps no diff** — `lastDiff` stays null for that change (the counts still accrue), because the applied hunks are not reconstructable from the log alone.
- **Mounted only in the web-app bundle** — other assemblies serve no `fileChanges` key; consumers read the value's absence as "no changes" rather than an error.
