# Changelog

All notable changes to Orrery are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/AhsanRao/claude-code-orrery/compare/v0.1.0...master
[0.1.0]: https://github.com/AhsanRao/claude-code-orrery/releases/tag/v0.1.0
