/**
 * Wire types shared with `orrery-core` (Rust). Keep in sync with
 * `crates/orrery-core/src/model.rs`; field names are camelCase on the wire.
 */

export interface LiveSession {
  sessionId: string;
  pid?: number | null;
  cwd?: string | null;
  name?: string | null;
  status?: string | null;
  kind?: string | null;
  entrypoint?: string | null;
  version?: string | null;
  startedAt?: number | null;
  updatedAt?: number | null;
}

export interface TranscriptSummary {
  sessionId: string;
  projectDir: string;
  transcriptPath: string;
  modifiedAt: number;
  sizeBytes: number;
  title: string | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type OrreryEvent =
  | { kind: "session-registry"; sessions: LiveSession[] }
  | {
      kind: "session-meta";
      sessionId: string;
      transcriptPath: string;
      cwd: string | null;
      gitBranch: string | null;
      version: string | null;
    }
  | { kind: "session-title"; sessionId: string; title: string }
  | { kind: "prompt"; sessionId: string; ts: string; text: string }
  | {
      kind: "assistant-text";
      sessionId: string;
      agentId: string | null;
      ts: string;
      text: string;
      model: string | null;
    }
  | {
      kind: "tool-start";
      sessionId: string;
      agentId: string | null;
      ts: string;
      toolUseId: string;
      tool: string;
      summary: string;
      input: unknown;
    }
  | {
      kind: "tool-end";
      sessionId: string;
      agentId: string | null;
      ts: string;
      toolUseId: string;
      ok: boolean;
      outputChars: number;
    }
  | {
      kind: "agent-spawn";
      sessionId: string;
      parentAgentId: string | null;
      ts: string;
      toolUseId: string;
      agentType: string;
      description: string;
      promptPreview: string;
    }
  | {
      kind: "agent-result";
      sessionId: string;
      parentAgentId: string | null;
      ts: string;
      toolUseId: string;
      agentId: string | null;
      status: string | null;
    }
  | { kind: "agent-transcript"; sessionId: string; agentId: string; transcriptPath: string }
  | {
      kind: "usage";
      sessionId: string;
      agentId: string | null;
      ts: string;
      model: string | null;
      usage: Usage;
    }
  | {
      kind: "hook";
      event: string;
      sessionId: string;
      agentId: string | null;
      agentType: string | null;
      cwd: string | null;
      message: string | null;
    }
  | { kind: "diagnostic"; level: string; message: string };

/** Precision-mode state, mirrored from `orrery_core::hooks::Status`. */
export interface HookStatus {
  installed: boolean;
  events: string[];
  settingsPath: string;
  sinkPath: string;
  command: string | null;
  supported: boolean;
}

/* ---------- Reduced (UI) model ---------- */

/** Id used for a session's main thread in place of an agent id. */
export const MAIN = "main";

export type SessionStatus = "busy" | "waiting" | "idle" | "ended";
export type AgentStatus = "running" | "done" | "failed";

export interface ToolCall {
  id: string;
  sessionId: string;
  /** `MAIN` or a subagent id. */
  agentId: string;
  tool: string;
  summary: string;
  input: unknown;
  startedAt: number;
  endedAt?: number;
  ok?: boolean;
  outputChars?: number;
}

/** A prompt or an assistant reply, kept for the transcript view. */
export interface Message {
  id: string;
  agentId: string;
  role: "user" | "assistant";
  text: string;
  at: number;
}

export interface Agent {
  id: string;
  sessionId: string;
  /** `main`, `Explore`, `Plan`, `general-purpose`, custom name... */
  type: string;
  description: string;
  parentId: string | null;
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  /** Tool-use id of the `Agent` call that spawned it (undefined for main). */
  spawnToolUseId?: string;
  transcriptPath?: string;
  model?: string;
  toolCount: number;
  tokens: Usage;
  lastText?: string;
  /** Tool call currently in flight, if any. */
  current?: ToolCall;
}

export interface Session {
  id: string;
  title?: string;
  cwd?: string;
  branch?: string;
  version?: string;
  transcriptPath?: string;
  live: LiveSession | null;
  status: SessionStatus;
  startedAt?: number;
  /** Last time anything happened in this session (registry or transcript). */
  lastActivity: number;
  model?: string;
  agents: Record<string, Agent>;
  /** Bounded, oldest first. */
  calls: ToolCall[];
  /** Bounded, oldest first. */
  messages: Message[];
  /** Last notification text from a precision-mode hook, if any. */
  needsAttention?: string;
  tokens: Usage;
  lastPrompt?: string;
}

export interface Diagnostic {
  at: number;
  level: string;
  message: string;
}

export interface OrreryState {
  sessions: Record<string, Session>;
  /** Tool-use id → session id, so `tool-end` can find its call quickly. */
  callIndex: Record<string, string>;
  diagnostics: Diagnostic[];
  /** Sessions we've seen in the registry at least once. */
  registryLoaded: boolean;
}
