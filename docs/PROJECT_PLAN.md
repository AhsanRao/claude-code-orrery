# Orrery — Project Plan

_Last updated: 2026-09-22. This is the living roadmap. Edit it when scope changes; the CHANGELOG records what shipped._

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

## 3. Current state (v0.1.0-alpha)

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
- [x] Toasts for spawn / result / edits (fresh events only, never during replay).
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

## 4. To-do (ordered)

### v0.1.0 — first release

- [ ] **History picker**: list past sessions (`list_transcripts`), open one, replay via `load_history`, scrub the timeline.
- [ ] **Waiting detection**: derive `waiting` from `Notification`-like signals in the transcript (permission prompts, `AskUserQuestion`) when the registry says `busy`.
- [ ] **Pending agent placeholders** in the constellation (spawn seen, transcript not yet) with a dotted ring.
- [ ] **Settings**: custom Claude home, replay budget, toast toggles; persisted with `tauri-plugin-store`.
- [ ] **Windows/Linux pass**: title bar, fonts fallback, notify backend quirks; CI build matrix.
- [ ] Release pipeline: signed macOS DMG, Windows MSI, Linux AppImage via GitHub Actions on tags.
- [ ] Screenshots/GIF for README from the real app.

### v0.2.0 — depth

- [ ] Background sessions from `~/.claude/jobs/<id>/state.json` + `claude agents --json` (on demand only, never on the hot path).
- [ ] Nested agents: draw agent→agent edges (`parentAgentId`), depth-aware orbit layout.
- [ ] Cost estimates per model from token usage (user-editable price table).
- [ ] Prompt/answer transcript view in the inspector (read-only, redaction of obvious secrets).
- [ ] Session search and filters (by cwd, branch, model, status).
- [ ] Menu-bar / tray mode: compact live counters, click to open.
- [ ] Notifications (native) when a session starts waiting on you.

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
