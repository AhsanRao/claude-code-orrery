//! Serializable types shared with the UI. Field names are `camelCase` on the
//! wire so the TypeScript side can consume them without a mapping layer.

use serde::{Deserialize, Serialize};

/// One running Claude Code process, as described by `~/.claude/sessions/<pid>.json`.
///
/// Every field except `session_id` is optional because the file format is
/// owned by Claude Code and has grown over time; unknown fields are ignored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub session_id: String,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    /// `busy`, `idle` or `waiting` as reported by Claude Code.
    #[serde(default)]
    pub status: Option<String>,
    /// `interactive`, `background`, ...
    #[serde(default)]
    pub kind: Option<String>,
    /// `claude-cli`, `claude-vscode`, ...
    #[serde(default)]
    pub entrypoint: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    /// Unix milliseconds.
    #[serde(default)]
    pub started_at: Option<u64>,
    /// Unix milliseconds.
    #[serde(default)]
    pub updated_at: Option<u64>,
}

/// A transcript found on disk, used to list historical sessions cheaply.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSummary {
    pub session_id: String,
    pub project_dir: String,
    pub transcript_path: String,
    /// Unix milliseconds of the last write.
    pub modified_at: u64,
    pub size_bytes: u64,
    /// Claude Code's AI title, if one was found near the end of the file.
    pub title: Option<String>,
}

/// Token usage reported by the API for one assistant turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

/// A normalized observation. Tagged with `kind` on the wire.
///
/// `agent_id` is `None` for the main thread of a session and `Some` for lines
/// that came from a subagent transcript.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    /// Full snapshot of `~/.claude/sessions`. Sent on start and whenever the
    /// directory changes; the UI replaces its live-session list with it.
    SessionRegistry { sessions: Vec<LiveSession> },

    /// Metadata gleaned from the first transcript line that carries it.
    SessionMeta {
        session_id: String,
        transcript_path: String,
        cwd: Option<String>,
        git_branch: Option<String>,
        version: Option<String>,
    },

    /// Claude Code's own AI-generated title for the session.
    SessionTitle { session_id: String, title: String },

    /// The user typed a prompt.
    Prompt {
        session_id: String,
        ts: String,
        text: String,
    },

    /// Assistant prose (not tool calls).
    AssistantText {
        session_id: String,
        agent_id: Option<String>,
        ts: String,
        text: String,
        model: Option<String>,
    },

    /// A tool call was issued. Emitted before the tool runs because Claude Code
    /// writes the assistant message to the transcript before executing it.
    ToolStart {
        session_id: String,
        agent_id: Option<String>,
        ts: String,
        tool_use_id: String,
        tool: String,
        /// Human-readable one-liner: file path, command, pattern, URL...
        summary: String,
        input: serde_json::Value,
    },

    /// The tool returned.
    ToolEnd {
        session_id: String,
        agent_id: Option<String>,
        ts: String,
        tool_use_id: String,
        ok: bool,
        output_chars: usize,
    },

    /// The `Agent` tool was invoked, i.e. a subagent was requested.
    AgentSpawn {
        session_id: String,
        parent_agent_id: Option<String>,
        ts: String,
        tool_use_id: String,
        agent_type: String,
        description: String,
        prompt_preview: String,
    },

    /// The `Agent` tool returned. `agent_id` is only present for resumable agents.
    AgentResult {
        session_id: String,
        parent_agent_id: Option<String>,
        ts: String,
        tool_use_id: String,
        agent_id: Option<String>,
        status: Option<String>,
    },

    /// A subagent transcript file appeared on disk.
    AgentTranscript {
        session_id: String,
        agent_id: String,
        transcript_path: String,
    },

    /// Token accounting for one assistant turn.
    Usage {
        session_id: String,
        agent_id: Option<String>,
        ts: String,
        model: Option<String>,
        usage: Usage,
    },

    /// A payload from an installed precision-mode hook. Carries facts the
    /// transcript cannot: exact agent identity, and end-of-turn signals.
    Hook {
        /// `SubagentStart`, `SubagentStop`, `Stop`, `Notification`.
        event: String,
        session_id: String,
        agent_id: Option<String>,
        agent_type: Option<String>,
        cwd: Option<String>,
        /// Notification text, or the last assistant message on `Stop`.
        message: Option<String>,
    },

    /// Engine diagnostics (watcher started, file skipped, parse warning...).
    Diagnostic { level: String, message: String },
}
