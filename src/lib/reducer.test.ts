import { describe, expect, it } from "vitest";
import { initialState, orderedSessions, reduce, runningAgents } from "./reducer";
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
