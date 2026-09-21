## What

## Why

## Checks

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
- [ ] Zero-impact policy respected (no writes/locks/sockets under `~/.claude`)
- [ ] Docs updated (`docs/`, `CHANGELOG.md`) if behaviour or data sources changed
