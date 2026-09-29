# Precision mode

Orrery is passive by default: it reads files and nothing else. Precision mode is the one feature that asks Claude Code for something, and it is off until you turn it on after seeing exactly what changes.

## What it buys you

| Without hooks (default)                                                                                                  | With precision mode                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| A spawned agent is matched to its transcript **in order** — two agents spawned in the same instant can swap descriptions | Each agent is identified by the id Claude Code reports, so the match is exact                        |
| An agent is "done" when its `Agent` tool result appears in the parent transcript                                         | `SubagentStop` says so the moment it happens                                                         |
| The end of a turn is inferred from the session registry, which lags a second                                             | `Stop` is immediate, and every running agent is closed with it                                       |
| Permission prompts are only visible as a `waiting` status                                                                | `Notification` carries the text — the rail and the native notification say what Claude is asking for |

## What it costs

Claude Code spawns **one short-lived shell per hook event** (four event types: `SubagentStart`, `SubagentStop`, `Stop`, `Notification`). The hooks are registered with `async: true`, so Claude Code never waits for them and never sees their output. That is the whole cost; there is no server, no port and no daemon.

HTTP hooks are deliberately **not** used: they block the session until the server answers.

## What gets written

Four entries are merged into `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`). Every other key, and every hook you already had, is left exactly as it was. Before writing, the previous file is copied to `settings.json.orrery-backup`.

Each entry looks like this:

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "{ cat; echo; } >> '/Users/you/Library/Application Support/dev.orrery.app/orrery-hook-sink.jsonl' 2>/dev/null",
            "async": true
          }
        ]
      }
    ]
  }
}
```

The command is the entire mechanism: it copies the hook's JSON payload from stdin to a file in Orrery's own data directory, which only Orrery reads. Orrery tails that file exactly like a transcript, and truncates it on startup so a previous run's payloads are never replayed.

## Turning it on and off

Top bar → **settings** → _Precision mode_. The dialog shows the diff of your real settings file before anything is written. Removing the hooks deletes only the entries whose command points at Orrery's sink, and removes the `hooks` key entirely if nothing else is left in it.

Hooks are loaded when a Claude Code session starts, so **restart your sessions** after installing.

## Limitations

- POSIX shells only for now (macOS, Linux). On Windows the dialog says so and Orrery stays passive.
- If `settings.json` is not valid JSON, Orrery refuses to touch it rather than guess.
- Payloads carry no timestamp, so Orrery stamps them with its own receive time — accurate to a few milliseconds, not authoritative.
