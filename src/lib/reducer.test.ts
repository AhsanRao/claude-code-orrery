import { describe, expect, it } from "vitest";
import {
  agentDepth,
  initialState,
  matchesQuery,
  orderedSessions,
  reduce,
  runningAgents,
} from "./reducer";
import { MAIN, type OrreryEvent } from "./types";

const S = "sess-1";
const t = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString();

describe("reduce", () => {
  it("creates sessions from the registry and marks vanished ones ended", () => {
    let st = reduce(initialState(), [
      {
        kind: "session-registry",
        sessions: [{ sessionId: S, status: "busy", cwd: "/repo", name: "repo-1" }],
      },
    ]);
    expect(st.sessions[S]?.status).toBe("busy");
    expect(st.sessions[S]?.title).toBe("repo-1");
    st = reduce(st, [{ kind: "session-registry", sessions: [] }]);
    expect(st.sessions[S]?.status).toBe("ended");
    expect(st.registryLoaded).toBe(true);
  });

  it("tracks a tool call from start to end on the main thread", () => {
    let st = reduce(initialState(), [
      {
        kind: "tool-start",
        sessionId: S,
        agentId: null,
        ts: t(0),
        toolUseId: "t1",
        tool: "Read",
        summary: "a.ts",
        input: {},
      },
    ]);
    expect(st.sessions[S]?.agents[MAIN]?.current?.id).toBe("t1");
    st = reduce(st, [
      {
        kind: "tool-end",
        sessionId: S,
        agentId: null,
        ts: t(2),
        toolUseId: "t1",
        ok: true,
        outputChars: 9,
      },
    ]);
    const call = st.sessions[S]?.calls[0];
    expect(call!.endedAt! - call!.startedAt).toBe(2000);
    expect(call?.ok).toBe(true);
    expect(st.sessions[S]?.agents[MAIN]?.current).toBeUndefined();
    expect(st.sessions[S]?.agents[MAIN]?.toolCount).toBe(1);
  });

  it("links a spawn to its transcript and closes it on result", () => {
    const events: OrreryEvent[] = [
      {
        kind: "agent-spawn",
        sessionId: S,
        parentAgentId: null,
        ts: t(0),
        toolUseId: "spawn-1",
        agentType: "Explore",
        description: "Map parser",
        promptPreview: "…",
      },
      {
        kind: "tool-start",
        sessionId: S,
        agentId: null,
        ts: t(0),
        toolUseId: "spawn-1",
        tool: "Agent",
        summary: "Map parser",
        input: {},
      },
      {
        kind: "agent-transcript",
        sessionId: S,
        agentId: "agent-9",
        transcriptPath: "/x/agent-9.jsonl",
      },
      {
        kind: "tool-start",
        sessionId: S,
        agentId: "agent-9",
        ts: t(1),
        toolUseId: "t2",
        tool: "Grep",
        summary: "foo",
        input: {},
      },
    ];
    let st = reduce(initialState(), events);
    const a = st.sessions[S]?.agents["agent-9"];
    expect(a?.type).toBe("Explore");
    expect(a?.description).toBe("Map parser");
    expect(a?.spawnToolUseId).toBe("spawn-1");
    expect(st.sessions[S]?.agents["pending:spawn-1"]).toBeUndefined();
    expect(runningAgents(st.sessions[S]!).map((x) => x.id)).toEqual(["agent-9"]);

    st = reduce(st, [
      {
        kind: "tool-end",
        sessionId: S,
        agentId: "agent-9",
        ts: t(2),
        toolUseId: "t2",
        ok: true,
        outputChars: 1,
      },
      {
        kind: "agent-result",
        sessionId: S,
        parentAgentId: null,
        ts: t(3),
        toolUseId: "spawn-1",
        agentId: "agent-9",
        status: "completed",
      },
      {
        kind: "tool-end",
        sessionId: S,
        agentId: null,
        ts: t(3),
        toolUseId: "spawn-1",
        ok: true,
        outputChars: 40,
      },
    ]);
    expect(st.sessions[S]?.agents["agent-9"]?.status).toBe("done");
    expect(runningAgents(st.sessions[S]!)).toHaveLength(0);
  });

  it("adopts an orphan transcript when its spawn line arrives later", () => {
    const st = reduce(initialState(), [
      { kind: "agent-transcript", sessionId: S, agentId: "agent-1", transcriptPath: "/p" },
      {
        kind: "agent-spawn",
        sessionId: S,
        parentAgentId: null,
        ts: t(0),
        toolUseId: "sp",
        agentType: "Plan",
        description: "Plan it",
        promptPreview: "",
      },
    ]);
    expect(Object.keys(st.sessions[S]!.agents).sort()).toEqual(["agent-1", MAIN]);
    expect(st.sessions[S]?.agents["agent-1"]?.type).toBe("Plan");
  });

  it("sums usage per agent and per session", () => {
    const usage = { inputTokens: 1, outputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 0 };
    const st = reduce(initialState(), [
      { kind: "usage", sessionId: S, agentId: null, ts: t(0), model: "claude-opus-5", usage },
      {
        kind: "usage",
        sessionId: S,
        agentId: "agent-1",
        ts: t(0),
        model: "claude-haiku-4-5",
        usage,
      },
    ]);
    expect(st.sessions[S]?.tokens.outputTokens).toBe(20);
    expect(st.sessions[S]?.agents[MAIN]?.tokens.outputTokens).toBe(10);
    expect(st.sessions[S]?.model).toBe("opus");
    expect(st.sessions[S]?.agents["agent-1"]?.model).toBe("haiku");
  });

  it("keeps untouched sessions referentially stable", () => {
    const st1 = reduce(initialState(), [
      { kind: "session-title", sessionId: "a", title: "A" },
      { kind: "session-title", sessionId: "b", title: "B" },
    ]);
    const st2 = reduce(st1, [{ kind: "session-title", sessionId: "a", title: "A2" }]);
    expect(st2.sessions["b"]).toBe(st1.sessions["b"]);
    expect(st2.sessions["a"]).not.toBe(st1.sessions["a"]);
  });

  it("orders busy sessions first, then by recency", () => {
    const st = reduce(initialState(), [
      { kind: "session-title", sessionId: "old", title: "old" },
      { kind: "session-registry", sessions: [{ sessionId: "live", status: "busy", updatedAt: 5 }] },
    ]);
    expect(orderedSessions(st).map((s) => s.id)).toEqual(["live", "old"]);
  });
});

describe("waiting detection", () => {
  it("marks a live session waiting while AskUserQuestion is open", () => {
    let st = reduce(initialState(), [
      { kind: "session-registry", sessions: [{ sessionId: S, status: "busy" }] },
      {
        kind: "tool-start",
        sessionId: S,
        agentId: null,
        ts: t(0),
        toolUseId: "q",
        tool: "AskUserQuestion",
        summary: "",
        input: {},
      },
    ]);
    expect(st.sessions[S]?.status).toBe("waiting");
    st = reduce(st, [
      {
        kind: "tool-end",
        sessionId: S,
        agentId: null,
        ts: t(5),
        toolUseId: "q",
        ok: true,
        outputChars: 1,
      },
    ]);
    expect(st.sessions[S]?.status).toBe("busy");
  });
});

describe("nesting and filtering", () => {
  it("tracks depth through an agent that spawns an agent", () => {
    const st = reduce(initialState(), [
      {
        kind: "agent-spawn",
        sessionId: S,
        parentAgentId: null,
        ts: t(0),
        toolUseId: "s1",
        agentType: "Plan",
        description: "plan",
        promptPreview: "",
      },
      { kind: "agent-transcript", sessionId: S, agentId: "agent-1", transcriptPath: "/1" },
      {
        kind: "agent-spawn",
        sessionId: S,
        parentAgentId: "agent-1",
        ts: t(1),
        toolUseId: "s2",
        agentType: "Explore",
        description: "look",
        promptPreview: "",
      },
      { kind: "agent-transcript", sessionId: S, agentId: "agent-2", transcriptPath: "/2" },
    ]);
    const sess = st.sessions[S]!;
    expect(sess.agents["agent-2"]?.parentId).toBe("agent-1");
    expect(agentDepth(sess, MAIN)).toBe(0);
    expect(agentDepth(sess, "agent-1")).toBe(1);
    expect(agentDepth(sess, "agent-2")).toBe(2);
  });

  it("keeps prompts and replies for the transcript view", () => {
    const st = reduce(initialState(), [
      { kind: "prompt", sessionId: S, ts: t(0), text: "do the thing" },
      {
        kind: "assistant-text",
        sessionId: S,
        agentId: "agent-1",
        ts: t(1),
        text: "done",
        model: "claude-opus-5",
      },
    ]);
    const msgs = st.sessions[S]!.messages;
    expect(msgs.map((m) => [m.role, m.agentId, m.text])).toEqual([
      ["user", MAIN, "do the thing"],
      ["assistant", "agent-1", "done"],
    ]);
  });

  it("filters the rail by text and by status:", () => {
    const st = reduce(initialState(), [
      {
        kind: "session-registry",
        sessions: [{ sessionId: "a", status: "waiting", cwd: "/dev/ocr" }],
      },
      {
        kind: "session-meta",
        sessionId: "a",
        transcriptPath: "/p",
        cwd: "/dev/ocr",
        gitBranch: "fix/retry",
        version: null,
      },
      { kind: "session-title", sessionId: "a", title: "OCR retries" },
    ]);
    const s = st.sessions["a"]!;
    expect(matchesQuery(s, "")).toBe(true);
    expect(matchesQuery(s, "ocr")).toBe(true);
    expect(matchesQuery(s, "fix/retry")).toBe(true);
    expect(matchesQuery(s, "status:waiting")).toBe(true);
    expect(matchesQuery(s, "status:busy")).toBe(false);
    expect(matchesQuery(s, "ocr keycloak")).toBe(false);
  });
});

describe("precision-mode hooks", () => {
  const hook = (event: string, extra: Record<string, unknown> = {}): OrreryEvent => ({
    kind: "hook",
    event,
    sessionId: S,
    agentId: null,
    agentType: null,
    cwd: null,
    message: null,
    ...extra,
  });

  it("resolves a placeholder by exact id and type instead of order", () => {
    let st = reduce(initialState(), [
      {
        kind: "agent-spawn",
        sessionId: S,
        parentAgentId: null,
        ts: t(0),
        toolUseId: "s1",
        agentType: "Explore",
        description: "look",
        promptPreview: "",
      },
      {
        kind: "agent-spawn",
        sessionId: S,
        parentAgentId: null,
        ts: t(0),
        toolUseId: "s2",
        agentType: "Plan",
        description: "plan",
        promptPreview: "",
      },
    ]);
    st = reduce(st, [hook("SubagentStart", { agentId: "agent-plan", agentType: "Plan" })]);
    const agents = st.sessions[S]!.agents;
    expect(agents["agent-plan"]?.description).toBe("plan");
    expect(Object.keys(agents)).toContain("pending:s1");

    st = reduce(st, [hook("SubagentStop", { agentId: "agent-plan", agentType: "Plan" })]);
    expect(st.sessions[S]?.agents["agent-plan"]?.status).toBe("done");
  });

  it("marks the session as needing attention, and clears it when work resumes", () => {
    let st = reduce(initialState(), [
      { kind: "session-registry", sessions: [{ sessionId: S, status: "busy" }] },
      hook("Notification", { message: "Claude needs permission to run npm" }),
    ]);
    expect(st.sessions[S]?.status).toBe("waiting");
    expect(st.sessions[S]?.needsAttention).toBe("Claude needs permission to run npm");
    // A registry snapshot alone must not clear it...
    st = reduce(st, [
      { kind: "session-registry", sessions: [{ sessionId: S, status: "waiting" }] },
    ]);
    expect(st.sessions[S]?.status).toBe("waiting");
    // ...but the next busy heartbeat does.
    st = reduce(st, [{ kind: "session-registry", sessions: [{ sessionId: S, status: "busy" }] }]);
    expect(st.sessions[S]?.needsAttention).toBeUndefined();
  });

  it("closes every running agent when the turn stops", () => {
    let st = reduce(initialState(), [
      { kind: "session-registry", sessions: [{ sessionId: S, status: "busy" }] },
      {
        kind: "agent-spawn",
        sessionId: S,
        parentAgentId: null,
        ts: t(0),
        toolUseId: "s1",
        agentType: "Explore",
        description: "look",
        promptPreview: "",
      },
      { kind: "agent-transcript", sessionId: S, agentId: "agent-1", transcriptPath: "/1" },
      {
        kind: "tool-start",
        sessionId: S,
        agentId: null,
        ts: t(0),
        toolUseId: "t1",
        tool: "Bash",
        summary: "ls",
        input: {},
      },
    ]);
    st = reduce(st, [hook("Stop", { message: "done" })]);
    const sess = st.sessions[S]!;
    expect(sess.agents["agent-1"]?.status).toBe("done");
    expect(sess.agents[MAIN]?.current).toBeUndefined();
    expect(sess.status).toBe("idle");
  });
});
