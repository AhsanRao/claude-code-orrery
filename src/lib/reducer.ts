/**
 * Pure reducer: folds `OrreryEvent`s into the UI model.
 *
 * It is the only place that knows how raw transcript facts relate to each
 * other (which `tool-end` closes which call, which subagent file belongs to
 * which `Agent` call...). Keeping it pure makes it trivially testable and lets
 * the same code replay history and consume live events.
 */

import {
  MAIN,
  type Agent,
  type OrreryEvent,
  type OrreryState,
  type Session,
  type SessionStatus,
  type ToolCall,
  type Usage,
} from "./types";
import { shortModel, toMs } from "./format";

/** Calls kept per session; older ones are dropped. */
export const MAX_CALLS = 600;
/** Diagnostics kept. */
const MAX_DIAGNOSTICS = 50;

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export const initialState = (): OrreryState => ({
  sessions: {},
  callIndex: {},
  diagnostics: [],
  registryLoaded: false,
});

const newAgent = (sessionId: string, id: string, type: string, at: number): Agent => ({
  id,
  sessionId,
  type,
  description: "",
  parentId: id === MAIN ? null : MAIN,
  status: "running",
  startedAt: at,
  toolCount: 0,
  tokens: emptyUsage(),
});

const newSession = (id: string, at: number): Session => ({
  id,
  live: null,
  status: "ended",
  lastActivity: at,
  agents: { [MAIN]: newAgent(id, MAIN, "main", at) },
  calls: [],
  tokens: emptyUsage(),
});

/** Map Claude Code's registry status onto ours. */
const statusFromLive = (status: string | null | undefined): SessionStatus => {
  switch (status) {
    case "busy":
      return "busy";
    case "waiting":
    case "blocked":
      return "waiting";
    case "idle":
      return "idle";
    default:
      return "busy";
  }
};

/**
 * Apply a batch of events. Returns a new state object; untouched sessions keep
 * their identity so React can skip re-rendering them.
 */
export function reduce(prev: OrreryState, events: OrreryEvent[]): OrreryState {
  if (events.length === 0) return prev;
  const state: OrreryState = {
    ...prev,
    sessions: { ...prev.sessions },
    callIndex: { ...prev.callIndex },
    diagnostics: prev.diagnostics,
  };
  // Sessions cloned lazily, once per batch.
  const touched = new Set<string>();
  const session = (id: string, at: number): Session => {
    let s = state.sessions[id];
    if (!s) {
      s = newSession(id, at);
      state.sessions[id] = s;
      touched.add(id);
    } else if (!touched.has(id)) {
      s = { ...s, agents: { ...s.agents }, calls: s.calls.slice(), tokens: { ...s.tokens } };
      state.sessions[id] = s;
      touched.add(id);
    }
    if (at > s.lastActivity) s.lastActivity = at;
    return s;
  };
  const agent = (s: Session, id: string | null, type: string, at: number): Agent => {
    const key = id ?? MAIN;
    const existing = s.agents[key];
    const a = existing
      ? { ...existing, tokens: { ...existing.tokens } }
      : newAgent(s.id, key, type, at);
    s.agents[key] = a;
    return a;
  };

  for (const ev of events) {
    switch (ev.kind) {
      case "session-registry": {
        const now = Date.now();
        const seen = new Set<string>();
        for (const live of ev.sessions) {
          seen.add(live.sessionId);
          const s = session(live.sessionId, live.updatedAt ?? now);
          s.live = live;
          s.status = statusFromLive(live.status);
          s.cwd ??= live.cwd ?? undefined;
          s.startedAt ??= live.startedAt ?? undefined;
          if (!s.title && live.name) s.title = live.name;
        }
        for (const s of Object.values(state.sessions)) {
          if (s.live && !seen.has(s.id)) {
            const ended = session(s.id, now);
            ended.live = null;
            ended.status = "ended";
          }
        }
        state.registryLoaded = true;
        break;
      }
      case "session-meta": {
        const s = session(ev.sessionId, Date.now());
        s.transcriptPath = ev.transcriptPath;
        s.cwd = ev.cwd ?? s.cwd;
        s.branch = ev.gitBranch ?? s.branch;
        s.version = ev.version ?? s.version;
        break;
      }
      case "session-title": {
        const s = session(ev.sessionId, Date.now());
        s.title = ev.title;
        break;
      }
      case "prompt": {
        const at = toMs(ev.ts);
        const s = session(ev.sessionId, at);
        s.lastPrompt = ev.text;
        s.startedAt ??= at;
        if (!s.live) s.status = "ended";
        break;
      }
      case "assistant-text": {
        const at = toMs(ev.ts);
        const s = session(ev.sessionId, at);
        const a = agent(s, ev.agentId, "agent", at);
        a.lastText = ev.text;
        if (ev.model) a.model = shortModel(ev.model);
        if (!ev.agentId && ev.model) s.model = shortModel(ev.model);
        break;
      }
      case "tool-start": {
        const at = toMs(ev.ts);
        const s = session(ev.sessionId, at);
        const a = agent(s, ev.agentId, "agent", at);
        const call: ToolCall = {
          id: ev.toolUseId,
          sessionId: s.id,
          agentId: a.id,
          tool: ev.tool,
          summary: ev.summary,
          input: ev.input,
          startedAt: at,
        };
        s.calls.push(call);
        if (s.calls.length > MAX_CALLS) {
          const dropped = s.calls.splice(0, s.calls.length - MAX_CALLS);
          for (const d of dropped) delete state.callIndex[d.id];
        }
        state.callIndex[ev.toolUseId] = s.id;
        a.current = call;
        a.toolCount += 1;
        // The registry says "busy" while Claude waits on a question; the transcript knows better.
        if (a.id === MAIN && ev.tool === "AskUserQuestion" && s.live) s.status = "waiting";
        break;
      }
      case "tool-end": {
        const at = toMs(ev.ts);
        const sid = state.callIndex[ev.toolUseId] ?? ev.sessionId;
        const s = session(sid, at);
        const idx = s.calls.findIndex((c) => c.id === ev.toolUseId);
        if (idx < 0) break;
        const done: ToolCall = {
          ...s.calls[idx]!,
          endedAt: at,
          ok: ev.ok,
          outputChars: ev.outputChars,
        };
        s.calls[idx] = done;
        const a = agent(s, done.agentId === MAIN ? null : done.agentId, "agent", at);
        if (a.current?.id === done.id) a.current = undefined;
        if (a.id === MAIN && done.tool === "AskUserQuestion" && s.live)
          s.status = statusFromLive(s.live.status);
        // The Agent tool returning means that subagent is finished.
        if (done.tool === "Agent" || done.tool === "Task") {
          for (const other of Object.values(s.agents)) {
            if (other.spawnToolUseId === done.id && other.status === "running") {
              const finished = agent(s, other.id, other.type, at);
              finished.status = ev.ok ? "done" : "failed";
              finished.endedAt = at;
              finished.current = undefined;
            }
          }
        }
        break;
      }
      case "agent-spawn": {
        const at = toMs(ev.ts);
        const s = session(ev.sessionId, at);
        // Link to a transcript that appeared before its spawn line was read
        // (possible during startup replay), else create a placeholder keyed by
        // the tool-use id until the transcript shows up.
        const orphan = Object.values(s.agents).find(
          (a) => a.id !== MAIN && !a.spawnToolUseId && a.transcriptPath && a.status === "running",
        );
        const a = orphan
          ? agent(s, orphan.id, ev.agentType, at)
          : agent(s, `pending:${ev.toolUseId}`, ev.agentType, at);
        a.type = ev.agentType;
        a.description = ev.description;
        a.parentId = ev.parentAgentId ?? MAIN;
        a.spawnToolUseId = ev.toolUseId;
        if (!orphan) a.startedAt = at;
        break;
      }
      case "agent-transcript": {
        const s = session(ev.sessionId, Date.now());
        if (s.agents[ev.agentId]) break;
        // Adopt the oldest placeholder still waiting for a transcript.
        const pending = Object.values(s.agents)
          .filter((a) => a.id.startsWith("pending:") && a.status === "running")
          .sort((x, y) => x.startedAt - y.startedAt)[0];
        if (pending) {
          delete s.agents[pending.id];
          const a: Agent = { ...pending, id: ev.agentId, transcriptPath: ev.transcriptPath };
          s.agents[ev.agentId] = a;
          for (const c of s.calls) if (c.agentId === pending.id) c.agentId = ev.agentId;
        } else {
          const a = agent(s, ev.agentId, "agent", Date.now());
          a.transcriptPath = ev.transcriptPath;
        }
        break;
      }
      case "agent-result": {
        const at = toMs(ev.ts);
        const s = session(ev.sessionId, at);
        const byId = ev.agentId ? s.agents[ev.agentId] : undefined;
        const bySpawn = Object.values(s.agents).find((a) => a.spawnToolUseId === ev.toolUseId);
        const target = byId ?? bySpawn;
        if (!target) break;
        const a = agent(s, target.id, target.type, at);
        a.status = ev.status === "failed" ? "failed" : "done";
        a.endedAt = at;
        a.current = undefined;
        break;
      }
      case "usage": {
        const at = toMs(ev.ts);
        const s = session(ev.sessionId, at);
        const a = agent(s, ev.agentId, "agent", at);
        for (const k of Object.keys(ev.usage) as (keyof Usage)[]) {
          a.tokens[k] += ev.usage[k];
          s.tokens[k] += ev.usage[k];
        }
        if (ev.model) {
          a.model = shortModel(ev.model);
          if (!ev.agentId) s.model = shortModel(ev.model);
        }
        break;
      }
      case "diagnostic": {
        state.diagnostics = [
          ...state.diagnostics,
          { at: Date.now(), level: ev.level, message: ev.message },
        ].slice(-MAX_DIAGNOSTICS);
        break;
      }
    }
  }
  return state;
}

/* ---------- Selectors ---------- */

/** Sessions ordered: live & busy first, then by recency. */
export const orderedSessions = (state: OrreryState): Session[] =>
  Object.values(state.sessions).sort((a, b) => {
    const rank = (s: Session) =>
      s.status === "busy" ? 0 : s.status === "waiting" ? 1 : s.status === "idle" ? 2 : 3;
    return rank(a) - rank(b) || b.lastActivity - a.lastActivity;
  });

export const runningAgents = (s: Session): Agent[] =>
  Object.values(s.agents).filter((a) => a.id !== MAIN && a.status === "running");

/** Tool calls started in the last `windowMs`, across all agents of a session. */
export const recentCalls = (s: Session, windowMs: number, now = Date.now()): ToolCall[] =>
  s.calls.filter((c) => (c.endedAt ?? now) >= now - windowMs);
