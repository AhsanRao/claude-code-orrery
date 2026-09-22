# Orrery — Project Plan

_Last updated: 2026-09-23 (v0.2.0). This is the living roadmap. Edit it when scope changes; the CHANGELOG records what shipped._

## 1. Purpose

Give Claude Code users a live, animated picture of what their sessions are doing — every session, every spawned agent, every tool call — **without affecting Claude Code in any way**. Orrery observes files; it never hooks, patches, or talks to Claude Code.

## 2. Principles

| #   | Principle           | What it means in practice                                                    |
| --- | ------------------- | ---------------------------------------------------------------------------- |
| 1   | Zero impact         | Read-only, append-only reads, no hooks/env/sockets. See `ZERO_IMPACT.md`.    |
| 2   | Lenient by design   | Transcript format is Claude Code's; unknown = ignored, malformed = skipped.  |
| 3   | Pure core           | Parsing and reduction are pure functions with tests. Shell and UI stay thin. |
| 4   | Fewest moving parts | Standard library and CSS before dependencies.                                |
| 5   | Product quality     | Named, branded, documented, accessible, dark/light, reduced-motion aware.    |

## 3. Current state (v0.2.0)

### Existing features

**Engine (`crates/orrery-core`)**

- [x] Locate `~/.claude` (honours `CLAUDE_CONFIG_DIR`).
- [x] Classify paths: session registry, main transcript, subagent transcript; ignore memory, tool-result spills, orphaned/superseded copies.
- [x] Byte-offset tailer with partial-line buffering, truncation recovery, bounded initial replay (32 MiB default).
- [x] Parser for `user`, `assistant`, `ai-title` records → `prompt`, `assistant-text`, `tool-start`, `tool-end`, `agent-spawn`, `agent-result`, `usage`, `session-meta`, `session-title`.
- [x] Usage de-duplication across per-block lines of one API message.
- [x] Session registry reader (`sessions/<pid>.json`) with change detection.
- [x] Watcher: FSEvents/inotify via `notify`, 16 ms coalescing, 1 s sweep as safety net, canonical-path handling on macOS.
- [x] History API: list transcripts, replay one session with its subagents.
- [x] Background sessions: `jobs/<id>/state.json` read and merged into the registry; finished jobs dropped so they read as history.
- [x] Headless `tail` example.
- [x] 24 unit/integration tests including an end-to-end watcher test.

**Desktop shell (`src-tauri`)**

- [x] Tauri 2 app, single window, macOS overlay title bar, minimal capabilities.
- [x] Engine started on setup; events forwarded on `orrery://events`.
- [x] Commands: `claude_home`, `live_sessions`, `list_transcripts`, `load_history`, `start_engine`.
- [x] Icon set generated from `design/brand/orrery-icon.svg`.

**UI (`src/`)**

- [x] Pure reducer with spawn↔transcript linking, agent lifecycle, bounded call history, per-agent/per-session token sums (7 tests).
- [x] Session rail: status pills, 60 s sparkline, model, elapsed, agent count, "waiting on" hint, bot avatars.
- [x] Constellation: main thread + up to 6 agents in stable orbit slots, edges with flowing particles, spawn burst, result flight home, root flash, bot characters with expressions, animated tool badges, scenes for waiting/idle/ended sessions.
- [x] Timeline: one lane per agent, bars by tool family, running/error styling, sliding 60 s window.
- [x] Inspector: identity, model, elapsed, tool count, tokens, "now running" with live ms, tool feed with animated icons.
- [x] Toasts for spawn / result / edits (fresh events only, never during replay), with a mute toggle.
- [x] Nested agents drawn around their parent; cost estimates with an editable price table; transcript tab with redaction; session filter; tray counter; native "needs you" notification.
- [x] Onboarding empty state; demo mode in plain browsers.
- [x] Dark + light themes, `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`, keyboard focus rings, ARIA labels.

**Repo**

- [x] README, LICENSE (MIT), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, CI, issue/PR templates.
- [x] Docs: architecture, data sources, design, zero-impact, this plan.
- [x] Project-scoped Claude Code skills + `skills.json` installer for contributors.

### Known limitations

- Subagent ↔ spawn linking is heuristic (FIFO by session). Two agents spawned in the same instant could swap descriptions. Exact ids arrive only for resumable agents (`agent-result.agentId`).
- Sessions not in the registry are followed from the end of their transcript; their history is loaded only on demand (`load_history` is exposed but the picker UI is not built yet).
- Background jobs (`~/.claude/jobs`) are not read yet.
- Windows title bar is default (overlay style is macOS-only).
- Cost is an estimate by model _family_; the transcript does not record the account's tier or discounts.
- Redaction in the transcript view is a courtesy for screen-sharing, not a security control.
- Only two levels of agents are drawn; deeper ones stay in the model and the inspector.

## 4. To-do (ordered)

### v0.1.0 — first release

- [x] **History picker**: rail lists past transcripts (title read from the file tail), click replays via `load_history`; ended sessions get a native range slider to scrub the 60 s window.
- [x] **Waiting detection**: `AskUserQuestion` open on the main thread → `waiting`, even when the registry still says `busy`. Permission prompts are not in the transcript; they still rely on the registry.
- [x] **Pending agent placeholders**: spawn seen, transcript not yet → dotted node that keeps its slot when the real id arrives.
- [x] **Settings (minimal)**: toast mute toggle (localStorage). Custom Claude home = `CLAUDE_CONFIG_DIR`, same as Claude Code. Replay budget stays a `Config` default — add a UI when someone needs it.
- [x] Release pipeline: `release.yml` builds macOS (universal), Windows and Linux bundles on `v*` tags into a draft release. Unsigned until certificates are added as repo secrets.
- [x] macOS DMG verified locally (`pnpm app:build` → `target/release/bundle/dmg/Orrery_0.1.0_aarch64.dmg`).
- [ ] **Windows/Linux pass**: CI compiles on all three; manual verification of title bar, fonts and notify quirks still owed.
- [ ] Screenshots/GIF for README from the real app (needs screen-recording permission on the maintainer's machine).

### v0.2.0 — depth

- [x] Background sessions from `~/.claude/jobs/<id>/state.json`, merged into the live registry and watched like `sessions/`. `claude agents --json` stays unused: it would cost a process spawn per change.
- [x] Nested agents: `parentAgentId` drives both the model (`agentDepth`) and the layout — children orbit their own parent with their own edge.
- [x] Cost estimates per model family from token usage, with a price table the user can edit in the top bar (stored per viewer).
- [x] Prompt/answer transcript view in the inspector, with obvious secrets blanked before display.
- [x] Session search and filters (free text over title/path/branch/model, plus `status:`).
- [x] Menu-bar / tray mode: live counter, click to reopen, quit from the tray menu.
- [x] Notifications (native) when a session starts waiting on you.

### v0.3.0 — optional precision mode

- [ ] Opt-in `async: true` command hooks for `SubagentStart/Stop`, `Stop`, `Notification` delivering exact agent ids and end-of-turn signals. Off by default; the settings screen explains the trade-off (one process spawn per event). Never HTTP hooks (they block Claude).
- [ ] Hook installer/uninstaller that only touches `~/.claude/settings.json` with explicit user confirmation and a visible diff.

## 5. Future ideas (unscheduled)

- Remote engine: run `orrery-core` on another machine, stream events over WebSocket/SSH to the UI.
- Team view: several machines' sessions in one orrery.
- Replay export: save a session as a self-contained HTML animation to share.
- "Why is it slow?" view: token throughput, cache hit rate, tool latency percentiles per session.
- File-heat map: which files each agent touched, edits vs reads, across a session.
- Diff peek: show the edit an agent just made (from `file-history` snapshots) without leaving Orrery.
- Plugin/skill telemetry: which skills and MCP tools fire most.
- VS Code extension wrapper embedding the same UI in a webview.
- Agent teams: teammates as separate suns with their own orbits.
- Sound design: optional subtle audio cues on spawn/result (with harmony rules from the Apple design skill).

## 6. Non-goals

- Controlling sessions (sending prompts, approving permissions). Orrery observes. If control is ever added it will be a separate, clearly-marked mode.
- Cloud sessions (claude.ai/code): no local data to observe.
- Persisting user transcripts anywhere outside `~/.claude`.
