# Zero-impact policy

Orrery must never change how Claude Code behaves, performs, or feels. This is the contract every change to `crates/orrery-core` is reviewed against.

## What "zero impact" means

| We do                                                      | We never do                                               |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Open transcript files read-only and close them immediately | Hold files open, lock them, or open for write             |
| Read only the bytes appended since the last read           | Re-read whole files on every change                       |
| Subscribe to OS filesystem notifications                   | Poll aggressively (the 1 s sweep is stat-only)            |
| Read `sessions/*.json` (a handful of tiny files)           | Connect to `messagingSocketPath` (`/tmp/cc-socks/*.sock`) |
| Keep everything in memory                                  | Write anything under `~/.claude`                          |
| Bound startup replay (32 MiB per live session)             | Load gigabytes of history on the hot path                 |

No hooks are installed **by default**. No environment variables are set for Claude Code. No OpenTelemetry exporters are configured. Out of the box, Claude Code has no way to observe that Orrery is running.

## The one exception: precision mode

[Precision mode](PRECISION_MODE.md) is opt-in, off until the user installs it from the settings dialog, and the only thing in Orrery that writes to `~/.claude/settings.json`. It is bound by its own rules:

- Nothing is written until the user has seen the real before/after diff of their settings file and confirmed.
- The previous file is copied to `settings.json.orrery-backup` first, and every unrelated key — including hooks the user installed themselves — is preserved byte for byte.
- Only `async: true` **command** hooks are installed, so Claude Code never waits for them. HTTP hooks are never used because they block the session.
- The hook writes to a file in Orrery's own data directory, never under `~/.claude`.
- Removing precision mode removes exactly the entries whose command points at Orrery's sink.
- A `settings.json` that is not valid JSON is never overwritten.

## Why hooks are not the default

Claude Code hooks are powerful but every kind of hook costs the session something:

- **HTTP hooks block** the session until the server responds.
- **Command hooks** fork a process per event; even with `async: true` that is a spawn on Claude's critical path.
- Any hook failure shows up in the user's transcript.

The transcript already contains everything needed for a live picture: the `tool_use` line is written **before** the tool runs and the `tool_result` line after. Hooks would add exact subagent ids and end-of-turn signals — useful, but not worth a default-on cost. They ship as the explicit opt-in described in [PRECISION_MODE.md](PRECISION_MODE.md), with `async: true` command hooks only.

## Why not OpenTelemetry?

It requires `CLAUDE_CODE_ENABLE_TELEMETRY` and exporter variables in Claude Code's environment, which changes its behaviour and adds an exporter to its process.

## Failure modes

- If `~/.claude` is missing, the engine reports a diagnostic and the UI shows onboarding. Nothing else happens.
- If a file is truncated or rotated, the tailer restarts from zero for that file.
- If a line is malformed, it yields no events.
- If Orrery crashes, Claude Code continues untouched — there is no coupling to undo.

## Checklist for reviewers

- [ ] Every `File::open` is read-only and short-lived.
- [ ] No `std::fs::write`, `OpenOptions::write/append`, `rename`, `remove` on paths under the Claude home — `crates/orrery-core/src/hooks.rs` is the single, user-confirmed exception.
- [ ] No sockets, no child processes on the watch path.
- [ ] New reads are bounded (size or count) and tested with a large-file case.
- [ ] Docs updated if a new file under `~/.claude` is read.
