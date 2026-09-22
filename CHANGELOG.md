# Changelog

All notable changes to Orrery are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-09-23

### Added

- Background sessions: `~/.claude/jobs/<id>/state.json` is read alongside the live registry, so `claude --bg` and `claude agents` work show up. Finished jobs fall through to history.
- Nested agents: an agent spawned by an agent hangs off its parent in a smaller orbit, with its own edge; depth is unlimited in the model and drawn two levels deep.
- Cost estimates from token usage, per session and per agent, with an editable price table (USD per million tokens, stored per viewer).
- Transcript tab in the inspector: prompts and replies for the selected agent, with obvious secrets blanked before display.
- Session filter: free text over title, path, branch and model, plus `status:waiting`.
- Menu-bar tray: live counter (`2 waiting`, `3 agents`), click or menu to reopen the window, quit from the tray.
- Native notification when a session starts waiting on you.

## [0.1.0] - 2026-09-22

### Added

- `orrery-core`: read-only engine that tails `~/.claude/sessions`, main transcripts and subagent transcripts and emits normalized events (`session-registry`, `tool-start`, `tool-end`, `agent-spawn`, `agent-result`, `usage`, …).
- Headless `tail` example that prints events as JSON lines.
- Tauri 2 desktop shell with `live_sessions`, `list_transcripts`, `load_history` commands.
- React UI: session rail with activity sparklines, agent constellation with bot characters, 60-second timeline, inspector with live tool feed, event toasts.
- Demo mode when running in a plain browser.
- Project docs: architecture, data sources, design system, zero-impact policy, project plan.
- Project-scoped Claude Code skills and plugin configuration for contributors.
- History: past transcripts listed in the rail with their titles; click to replay; timeline scrubber for ended sessions.
- `waiting` status while the main thread has an `AskUserQuestion` open.
- Pending agent placeholders (dotted) between spawn and transcript appearance.
- Toast mute toggle in the top bar.

[Unreleased]: https://github.com/AhsanRao/claude-code-orrery/compare/v0.2.0...master
[0.2.0]: https://github.com/AhsanRao/claude-code-orrery/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/AhsanRao/claude-code-orrery/releases/tag/v0.1.0
