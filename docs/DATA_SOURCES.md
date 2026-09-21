# Data sources

Everything Orrery shows comes from files Claude Code already writes. This page documents what is read and how each record maps to an event. Verified against Claude Code 2.1.278 (September 2026); the format is Claude Code's and may change — the parser ignores what it doesn't know.

`HOME` below is `~/.claude`, or `$CLAUDE_CONFIG_DIR` when set.

## 1. `HOME/sessions/<pid>.json` — live session registry

One file per running Claude Code process; deleted on exit. Example:

```json
{
  "pid": 21008,
  "sessionId": "52fd573f-…",
  "cwd": "/Users/me/dev/repo",
  "startedAt": 1790018820358,
  "version": "2.1.278",
  "kind": "interactive",
  "entrypoint": "claude-vscode",
  "name": "repo-0f",
  "status": "busy",
  "updatedAt": 1790019731001,
  "messagingSocketPath": "/tmp/cc-socks/21008.sock"
}
```

| Field                                          | Used for                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `sessionId`                                    | key; joins to the transcript                                         |
| `status`                                       | `busy` / `idle` / `waiting` pill                                     |
| `name`, `cwd`, `entrypoint`, `kind`, `version` | rail card                                                            |
| `startedAt`, `updatedAt`                       | elapsed, ordering                                                    |
| `messagingSocketPath`                          | **never used** — that socket is Claude Code's peer-messaging channel |

Event: `session-registry { sessions: LiveSession[] }` (full snapshot).

The registry does not know about questions: while Claude waits on `AskUserQuestion` it still reports `busy`. The reducer overrides that to `waiting` from the transcript (open `AskUserQuestion` tool call on the main thread).

## 2. `HOME/projects/<project>/<sessionId>.jsonl` — main transcript

`<project>` is the working directory with `/` replaced by `-`. One JSON object per line. Files named `*.orphaned-*` or `*.superseded-*` are ignored.

Common envelope fields on message lines: `type`, `uuid`, `parentUuid`, `timestamp` (ISO), `sessionId`, `cwd`, `gitBranch`, `version`, `isSidechain`, `isMeta`.

### Record types

| `type`                                                                                                            | Handled | Event(s)                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `ai-title`                                                                                                        | ✅      | `session-title`                                                               |
| `user` with `content: string` or `[{type:"text"}]`                                                                | ✅      | `prompt` (skipped when `isMeta` or text starts with `<system-reminder>`)      |
| `user` with `[{type:"tool_result"}]`                                                                              | ✅      | `tool-end` per block; plus `agent-result` when `toolUseResult.agentId` exists |
| `assistant` with `[{type:"text"}]`                                                                                | ✅      | `assistant-text`                                                              |
| `assistant` with `[{type:"tool_use"}]`                                                                            | ✅      | `tool-start`; plus `agent-spawn` when `name` is `Agent`/`Task`                |
| `assistant` `message.usage`                                                                                       | ✅      | `usage` (once per `message.id`)                                               |
| `assistant` with `[{type:"thinking"}]`                                                                            | ignored | —                                                                             |
| `attachment`, `queue-operation`, `last-prompt`, `atis-latch`, `file-history-snapshot`, `frame-link`, `artifact-*` | ignored | —                                                                             |
| first line carrying `cwd`                                                                                         | ✅      | `session-meta`                                                                |

### Why start/end are both available without hooks

Claude Code appends the `assistant` line containing the `tool_use` block **before** executing the tool, and the `user` line with the `tool_result` **after**. The difference of their `timestamp`s is the tool's duration.

### Tool input summaries

`tool-start.summary` is a one-liner derived from `input`:

| Tool                               | Summary                       |
| ---------------------------------- | ----------------------------- |
| Read / Edit / Write / NotebookEdit | `file_path`                   |
| Bash / PowerShell                  | `description`, else `command` |
| Grep                               | `pattern` (+ ` in <path>`)    |
| Glob                               | `pattern`                     |
| WebFetch / WebSearch               | `url` / `query`               |
| Agent / Task                       | `description`                 |
| Skill                              | `skill`                       |
| anything else                      | first string field            |

Truncated to 160 characters. Full `input` is also on the event.

### Usage

`message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` → `usage.usage.{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}`. The same usage object is repeated on every content-block line of one API message; the parser emits it once per `message.id`.

## 3. `HOME/projects/<project>/<sessionId>/subagents/agent-<id>.jsonl` — subagent transcripts

Same line format as the main transcript. Orrery attaches `agentId = "agent-<id>"` to every event from these files and:

- emits `agent-transcript` when the file is first seen,
- suppresses `prompt` (the first user line is the parent's instruction, already shown as the spawn description).

Subagent messages are **not** mirrored into the parent transcript; the parent only gets the `Agent` tool result.

## 4. Linking spawns to transcripts

`agent-spawn` (from the parent's `tool_use`) carries `toolUseId`, `agentType`, `description`, but not the agent id. The transcript file name carries the agent id but not the tool-use id. `agent-result` carries both, but only for resumable agents (built-in `Explore`/`Plan` are one-shot and return no id).

The reducer therefore pairs them FIFO per session: the oldest spawn without a transcript adopts the next transcript that appears. This is correct whenever spawns don't land in the same instant, which is the normal case. Precision mode (planned, opt-in hooks) would make it exact.

## 5. Not read (yet)

| Path                                                   | Why                                                      |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `HOME/jobs/<id>/state.json`, `HOME/daemon/roster.json` | Background sessions — v0.2                               |
| `HOME/projects/<project>/<sessionId>/tool-results/`    | Large spilled outputs; only sizes matter                 |
| `HOME/projects/<project>/memory/`                      | Auto-memory, not activity                                |
| `HOME/history.jsonl`                                   | Prompt history; transcripts already have it with context |
| `HOME/file-history/`                                   | Edit snapshots — future "diff peek"                      |
| `/tmp/cc-socks/*.sock`                                 | **Never.** Peer-messaging sockets between sessions.      |

## 6. Retention

Claude Code deletes transcripts after `cleanupPeriodDays` (default 30). Orrery holds nothing on disk, so it simply stops seeing them.
