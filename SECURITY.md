# Security Policy

## What Orrery touches

Orrery reads files under `~/.claude` (or `$CLAUDE_CONFIG_DIR`). Those files contain your prompts, tool outputs and any file contents Claude Code read — including secrets if a session read them. Orrery:

- never sends this data anywhere (no network access in the app besides loading two font families over HTTPS),
- never writes under `~/.claude`,
- keeps everything in memory; nothing is persisted by Orrery itself.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Email the maintainer listed on the GitHub profile with:

- a description of the issue and its impact,
- steps to reproduce,
- the Orrery version / commit.

You will get an acknowledgement within 72 hours and a fix or mitigation plan within 14 days for confirmed issues.

## Supported versions

Only the latest release receives security fixes.
