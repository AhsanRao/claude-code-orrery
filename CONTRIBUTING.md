# Contributing to Orrery

Thanks for helping. Orrery is small on purpose; the bar for a change is "does this make the picture of a Claude Code session clearer, without ever touching Claude Code".

## Ground rules

1. **Zero impact is non-negotiable.** Anything that reads `~/.claude` must open files read-only, read only appended bytes, and never write, lock, or connect to sockets there. Read [docs/ZERO_IMPACT.md](docs/ZERO_IMPACT.md) before touching `crates/orrery-core`.
2. **Lenient parsing.** The transcript format belongs to Claude Code and changes without notice. Unknown record types and fields are ignored; a bad line yields no events, never an error.
3. **Pure where possible.** `parser`, `tailer`, `paths` (Rust) and `reducer` (TS) are pure and tested. Put logic there, not in components or the Tauri shell.
4. **Fewest moving parts.** Prefer the standard library and CSS to a new dependency. If a dependency earns its place, say why in the PR.

## Setup

```sh
pnpm install
pnpm app:dev            # desktop app
pnpm dev                # browser, demo mode
```

## Checks (run before opening a PR)

```sh
pnpm lint               # eslint + prettier
pnpm typecheck
pnpm test               # vitest (reducer)
cargo test --workspace  # engine
cargo clippy --workspace --all-targets -- -D warnings
```

CI runs the same on every PR.

## Adding support for a new transcript record

1. Capture a real line (redact paths/prompts) and add it to the parser tests in `crates/orrery-core/src/parser.rs`.
2. Add or extend an `Event` variant in `model.rs` **and** the matching TypeScript type in `src/lib/types.ts`.
3. Handle it in `src/lib/reducer.ts` with a test.
4. Document the record in `docs/DATA_SOURCES.md`.

## Commit style

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). Subject ≤ 72 chars; body explains _why_ when it isn't obvious.

## Using Claude Code on this repo

The repo ships project-scoped skills and plugin settings in `.claude/`. They are picked up automatically when you open the repo with Claude Code; see [`.claude/README.md`](.claude/README.md) if you want to install them elsewhere.

## Code of conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
