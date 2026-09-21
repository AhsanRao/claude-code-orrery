# Orrery — notes for Claude Code

Read-only desktop observer for Claude Code sessions. Tauri 2 + Rust core + React/TS.

## Rules that matter most

- Zero impact on Claude Code: `crates/orrery-core` reads `~/.claude` read-only, appended bytes only, never writes, never hooks, never touches `/tmp/cc-socks`. See `docs/ZERO_IMPACT.md`.
- Transcript parsing is lenient: unknown → ignored, malformed → no events.
- Logic lives in pure, tested modules (`parser`, `tailer`, `paths`, `history` in Rust; `src/lib/reducer.ts`). Keep `src-tauri` and components thin.
- Prefer stdlib/CSS over new deps (ponytail mode is enabled for this repo).

## Commands

- `pnpm dev` browser demo · `pnpm app:dev` desktop · `pnpm app:build` bundle
- `pnpm lint && pnpm typecheck && pnpm test && cargo test --workspace` before a PR
- `cargo run -p orrery-core --example tail` prints live events as JSON

## Map

- `crates/orrery-core/src/{paths,tailer,parser,registry,history,engine}.rs`
- `src-tauri/src/lib.rs` commands + event forwarding (`orrery://events`)
- `src/lib/{types,reducer,bridge,demo}.ts`, `src/store.ts`, `src/components/*`
- `docs/PROJECT_PLAN.md` is the roadmap; update it when scope changes.

## Design

Tokens in `src/styles/tokens.css`; rationale in `docs/DESIGN.md`. Skills for UI work: `/apple-design`, `ui-ux-pro-max` (see `.claude/README.md`).
