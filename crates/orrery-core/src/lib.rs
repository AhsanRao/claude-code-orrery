//! # orrery-core
//!
//! The observation engine behind Orrery. It never talks to Claude Code: it only
//! watches the files Claude Code already writes under `~/.claude` and converts
//! them into a stream of [`Event`]s that a UI (or any other consumer) can reduce
//! into a live picture of sessions, agents and tool calls.
//!
//! Design constraints, in priority order:
//!
//! 1. **Zero impact on Claude Code.** Files are opened read-only, only appended
//!    bytes are read, nothing is ever written under `~/.claude`, and no hooks,
//!    sockets or environment variables are touched.
//! 2. **Pure, testable pieces.** [`parser`], [`tailer`] and [`paths`] have no
//!    I/O side effects beyond reading and are covered by unit tests.
//! 3. **One consumer-facing type.** Everything a UI needs arrives as [`Event`].
//!
//! See `docs/DATA_SOURCES.md` in the repository for the exact file layout this
//! crate understands.

pub mod engine;
pub mod history;
pub mod model;
pub mod parser;
pub mod paths;
pub mod registry;
pub mod tailer;

pub use engine::{Config, Engine, EngineError, EventSink};
pub use history::{find_transcript, list_transcripts, load_history};
pub use model::{Event, LiveSession, TranscriptSummary};
