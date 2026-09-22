# Architecture

Orrery has three layers. Data flows one way; the only "commands" go back for on-demand history.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ~/.claude (written by Claude Code, read by Orrery)                     │
│   sessions/<pid>.json   projects/<proj>/<sid>.jsonl   …/subagents/*.jsonl │
└──────────────┬────────────────────────────────────────────────────────┘
               │ notify (FSEvents / inotify / ReadDirectoryChangesW)
┌──────────────▼────────────────────────────────────────────────────────┐
│ crates/orrery-core                                                     │
│   paths     classify a path → Registry | MainTranscript | AgentTranscript │
│   tailer    FileTail: remember offset, read appended bytes, split lines │
│   parser    JSONL line → Vec<Event>   (pure, lenient)                   │
│   registry  sessions/*.json + jobs/*/state.json → Vec<LiveSession>     │
│   history   list transcripts, replay one session on demand              │
│   engine    watcher thread: coalesce → follow → parse → sink(Vec<Event>)│
└──────────────┬────────────────────────────────────────────────────────┘
               │ EventSink (Arc<dyn Fn(Vec<Event>)>)
┌──────────────▼────────────────────────────────────────────────────────┐
│ src-tauri  (thin)                                                      │
│   setup: Engine::start → app.emit("orrery://events", batch)            │
│   commands: claude_home, live_sessions, list_transcripts, load_history │
└──────────────┬────────────────────────────────────────────────────────┘
               │ @tauri-apps/api listen / invoke
┌──────────────▼────────────────────────────────────────────────────────┐
│ src (React)                                                            │
│   lib/bridge     Tauri or demo simulator, same interface                │
│   lib/reducer    OrreryState = reduce(prev, events)   (pure, tested)    │
│   store          zustand: model + selection + toasts                    │
│   components     TopBar · SessionRail · Constellation · Timeline · Inspector │
└───────────────────────────────────────────────────────────────────────┘
```

## Engine details

**Thread model.** One OS thread (`orrery-engine`). No async runtime; the watcher callback pushes into an `mpsc` channel and the loop `recv_timeout`s. Dropping `Engine` sets a stop flag and joins.

**Startup.**

1. Canonicalize the home path (macOS reports `/private/var/...`).
2. Emit `session-registry` from `sessions/`.
3. Discover transcripts on disk. Live sessions (present in the registry) are replayed from the end minus `max_history_bytes`; everything else is followed from its end so a resumed session shows up the moment it writes.

**Steady state.**

- Notifications are coalesced for `debounce` (16 ms) so a burst of writes becomes one read per file.
- A registry path change → re-read `sessions/`, emit only if changed.
- A transcript path → ensure a `FileTail` exists (new files replay from the start), read new lines, parse, emit one batch.
- Every `registry_poll` (1 s) with no notifications: re-read the registry and stat every followed file (drops are possible under load). Stat-only unless a file grew.

**Parsing.** See `DATA_SOURCES.md`. The parser is stateless per line except: `session-meta` is emitted once per file; API usage is de-duplicated per `message.id` because Claude Code writes one line per content block.

## UI details

**Reducer.** Sessions are cloned lazily once per batch so untouched sessions keep referential identity. `callIndex` maps tool-use id → session id so `tool-end` is O(1). Agent linking:

- `agent-spawn` creates `pending:<toolUseId>` (or adopts an orphan transcript seen earlier).
- `agent-transcript` renames the oldest pending placeholder to the real agent id.
- `agent-result` (or the `Agent` tool's `tool-end`) closes the agent.

**Constellation.** Fixed ring of six slots for depth-1 agents; deeper agents fan out around their own parent at a smaller radius, so a subagent's subagents read as belonging to it. A render-time cache maps agent id → slot so nodes never jump when neighbours leave. Finished agents linger 8 s then fade. Transient effects (burst, return particle, root flash) are local component state keyed on status transitions.

**Animation policy.** Ambient life (blink, bob, glow, dash) is CSS keyframes; enter/exit are CSS with a critically damped-feeling curve; particles are SMIL `animateMotion` along the edge path. Everything respects `prefers-reduced-motion`.

**Timeline.** Re-renders at 10 Hz; layout is percentage-based over a 60 s window with "now" pinned to the right.

## Testing

- `cargo test --workspace`: unit tests per module plus an end-to-end watcher test that writes to a temp `~/.claude` and expects events.
- `pnpm test`: reducer behaviour (linking, lifecycle, sums, identity stability).
- Demo mode doubles as a manual integration check of the whole UI path.
