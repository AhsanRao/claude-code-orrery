/**
 * Demo simulator. Emits the same `OrreryEvent`s the Rust engine would, so the
 * whole UI path (reducer → store → components) is exercised in a browser.
 * Data is invented and clearly labelled as such in the UI.
 */

import type { LiveSession, OrreryEvent } from "./types";

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const iso = () => new Date().toISOString();

const FILES = [
  "src/daemon/tailer.ts",
  "src/ui/Constellation.tsx",
  "crates/orrery-core/src/parser.rs",
  "docs/ARCHITECTURE.md",
  "src/lib/reducer.ts",
  "src-tauri/src/lib.rs",
];
const PATTERNS = ["isSidechain", "agentId", "tool_use", "SubagentStart", "parentUuid"];
const CMDS = [
  "cargo test -p orrery-core",
  "pnpm test",
  "git diff --stat",
  "ls ~/.claude/sessions",
  "pnpm build",
];
const URLS = [
  "https://code.claude.com/docs/en/hooks",
  "https://code.claude.com/docs/en/sub-agents",
];
const THOUGHTS = [
  "Transcript writes tool_use before execution, so start time needs no hooks.",
  "Coalesce FSEvents for 16 ms before reading; bursts become one read.",
  "Slot assignment must be stable across renders or nodes jump.",
  "Bounded replay: 32 MiB from the end keeps startup cheap on long sessions.",
];
const AGENTS = [
  {
    type: "Explore",
    descs: ["Map transcript parser", "Find SessionStore uses", "Locate subagent writer"],
    tools: ["Grep", "Glob", "Read", "Read", "Grep"],
    model: "claude-haiku-4-5",
  },
  {
    type: "Plan",
    descs: ["Plan tail-follow strategy", "Design event reducer"],
    tools: ["Read", "Grep", "Read", "WebFetch", "Read"],
    model: "claude-opus-5",
  },
  {
    type: "general-purpose",
    descs: ["Wire event bridge", "Add offset tailer", "Implement slot layout"],
    tools: ["Read", "Grep", "Edit", "Edit", "Bash", "Read", "Edit", "Bash"],
    model: "claude-sonnet-5",
  },
  {
    type: "code-reviewer",
    descs: ["Review engine diff", "Audit watcher for leaks"],
    tools: ["Bash", "Read", "Read", "Grep"],
    model: "claude-opus-5",
  },
] as const;

const argFor = (tool: string): { summary: string; input: unknown } => {
  switch (tool) {
    case "Read":
    case "Edit": {
      const f = pick(FILES);
      return { summary: f, input: { file_path: f } };
    }
    case "Grep": {
      const p = pick(PATTERNS);
      return { summary: `${p}  in src`, input: { pattern: p, path: "src" } };
    }
    case "Glob":
      return { summary: "**/*.rs", input: { pattern: "**/*.rs" } };
    case "Bash": {
      const c = pick(CMDS);
      return { summary: c, input: { command: c } };
    }
    case "WebFetch": {
      const u = pick(URLS);
      return { summary: u, input: { url: u } };
    }
    default:
      return { summary: "", input: {} };
  }
};

const MAIN_ID = "11111111-demo-4000-8000-000000000001";
const WAIT_ID = "22222222-demo-4000-8000-000000000002";
const IDLE_ID = "33333333-demo-4000-8000-000000000003";

interface SimAgent {
  id: string;
  spawnId: string;
  plan: string[];
  step: number;
  cur?: { id: string; until: number };
  gapUntil: number;
  model: string;
}

/** Start emitting demo events. Returns a stop function. */
export function startDemo(emit: (events: OrreryEvent[]) => void): () => void {
  const now = Date.now();
  const registry: LiveSession[] = [
    {
      sessionId: MAIN_ID,
      pid: 4242,
      cwd: "/Users/you/dev/orrery",
      name: "orrery-0f",
      status: "busy",
      kind: "interactive",
      entrypoint: "claude-vscode",
      version: "2.1.278",
      startedAt: now - 14 * 60_000,
      updatedAt: now,
    },
    {
      sessionId: WAIT_ID,
      pid: 4243,
      cwd: "/Users/you/dev/ocr-pipeline",
      name: "ocr-pipeline-a1",
      status: "waiting",
      kind: "interactive",
      entrypoint: "claude-cli",
      version: "2.1.278",
      startedAt: now - 42 * 60_000,
      updatedAt: now - 30_000,
    },
    {
      sessionId: IDLE_ID,
      pid: 4244,
      cwd: "/Users/you/dev/keycloak-v2",
      name: "keycloak-v2-7e",
      status: "idle",
      kind: "interactive",
      entrypoint: "claude-cli",
      version: "2.1.278",
      startedAt: now - 96 * 60_000,
      updatedAt: now - 12 * 60_000,
    },
  ];
  emit([
    {
      kind: "diagnostic",
      level: "info",
      message: "demo mode — simulated sessions, not your ~/.claude",
    },
    { kind: "session-registry", sessions: registry },
    {
      kind: "session-meta",
      sessionId: MAIN_ID,
      transcriptPath: "~/.claude/projects/-Users-you-dev-orrery/demo.jsonl",
      cwd: "/Users/you/dev/orrery",
      gitBranch: "main",
      version: "2.1.278",
    },
    { kind: "session-title", sessionId: MAIN_ID, title: "Build the Orrery watcher" },
    {
      kind: "prompt",
      sessionId: MAIN_ID,
      ts: iso(),
      text: "Implement the file watcher and wire it to the constellation view.",
    },
    {
      kind: "session-meta",
      sessionId: WAIT_ID,
      transcriptPath: "~/.claude/projects/-Users-you-dev-ocr-pipeline/demo.jsonl",
      cwd: "/Users/you/dev/ocr-pipeline",
      gitBranch: "fix/retry-backoff",
      version: "2.1.278",
    },
    { kind: "session-title", sessionId: WAIT_ID, title: "Fix OCR pipeline retries" },
    {
      kind: "tool-start",
      sessionId: WAIT_ID,
      agentId: null,
      ts: iso(),
      toolUseId: "w-1",
      tool: "Bash",
      summary: "bun run migrate",
      input: { command: "bun run migrate" },
    },
    {
      kind: "session-meta",
      sessionId: IDLE_ID,
      transcriptPath: "~/.claude/projects/-Users-you-dev-keycloak-v2/demo.jsonl",
      cwd: "/Users/you/dev/keycloak-v2",
      gitBranch: "main",
      version: "2.1.278",
    },
    { kind: "session-title", sessionId: IDLE_ID, title: "Keycloak realm migration" },
  ]);

  const agents: SimAgent[] = [];
  let mainCur: { id: string; until: number } | undefined;
  let mainGap = 0;
  let seq = 0;
  const nextId = (p: string) => `${p}-${(seq++).toString(36)}`;
  const usage = (sessionId: string, agentId: string | null, model: string): OrreryEvent => ({
    kind: "usage",
    sessionId,
    agentId,
    ts: iso(),
    model,
    usage: {
      inputTokens: Math.round(rnd(2, 40)),
      outputTokens: Math.round(rnd(80, 900)),
      cacheReadTokens: Math.round(rnd(2000, 20000)),
      cacheWriteTokens: 0,
    },
  });

  const tick = () => {
    const t = Date.now();
    const out: OrreryEvent[] = [];

    // Main thread.
    if (mainCur && t >= mainCur.until) {
      out.push({
        kind: "tool-end",
        sessionId: MAIN_ID,
        agentId: null,
        ts: iso(),
        toolUseId: mainCur.id,
        ok: true,
        outputChars: Math.round(rnd(20, 4000)),
      });
      mainCur = undefined;
      mainGap = t + rnd(150, 500);
    } else if (!mainCur && t >= mainGap) {
      const running = agents.filter((a) => a.step <= a.plan.length).length;
      if (running < 3 && Math.random() < 0.3) {
        const def = pick(AGENTS);
        const spawnId = nextId("toolu-agent");
        const desc = pick(def.descs);
        out.push({
          kind: "agent-spawn",
          sessionId: MAIN_ID,
          parentAgentId: null,
          ts: iso(),
          toolUseId: spawnId,
          agentType: def.type,
          description: desc,
          promptPreview: `${desc}. Report file:line references.`,
        });
        out.push({
          kind: "tool-start",
          sessionId: MAIN_ID,
          agentId: null,
          ts: iso(),
          toolUseId: spawnId,
          tool: "Agent",
          summary: desc,
          input: { subagent_type: def.type, description: desc },
        });
        out.push(usage(MAIN_ID, null, "claude-opus-5"));
        const id = nextId("agent");
        agents.push({
          id,
          spawnId,
          plan: [...def.tools].sort(() => Math.random() - 0.5).slice(0, 4 + Math.floor(rnd(0, 4))),
          step: 0,
          gapUntil: t + 300,
          model: def.model,
        });
        out.push({
          kind: "agent-transcript",
          sessionId: MAIN_ID,
          agentId: id,
          transcriptPath: `~/.claude/projects/-Users-you-dev-orrery/demo/subagents/${id}.jsonl`,
        });
        mainGap = t + rnd(600, 1400);
      } else if (Math.random() < 0.25) {
        out.push({
          kind: "assistant-text",
          sessionId: MAIN_ID,
          agentId: null,
          ts: iso(),
          text: pick(THOUGHTS),
          model: "claude-opus-5",
        });
        out.push(usage(MAIN_ID, null, "claude-opus-5"));
        mainGap = t + rnd(700, 1600);
      } else {
        const tool = pick(["Read", "Grep", "Edit", "Bash", "Read", "Glob"]);
        const id = nextId("toolu");
        out.push({
          kind: "tool-start",
          sessionId: MAIN_ID,
          agentId: null,
          ts: iso(),
          toolUseId: id,
          tool,
          ...argFor(tool),
        });
        mainCur = { id, until: t + rnd(300, 1800) };
      }
    }

    // Subagents.
    for (const a of agents) {
      if (a.step > a.plan.length) continue;
      if (a.cur && t >= a.cur.until) {
        out.push({
          kind: "tool-end",
          sessionId: MAIN_ID,
          agentId: a.id,
          ts: iso(),
          toolUseId: a.cur.id,
          ok: Math.random() > 0.04,
          outputChars: Math.round(rnd(10, 3000)),
        });
        out.push(usage(MAIN_ID, a.id, a.model));
        a.cur = undefined;
        a.gapUntil = t + rnd(120, 420);
      } else if (!a.cur && t >= a.gapUntil) {
        if (a.step === a.plan.length) {
          a.step += 1;
          out.push({
            kind: "assistant-text",
            sessionId: MAIN_ID,
            agentId: a.id,
            ts: iso(),
            text: "Done. Summary returned to the main thread.",
            model: a.model,
          });
          out.push({
            kind: "agent-result",
            sessionId: MAIN_ID,
            parentAgentId: null,
            ts: iso(),
            toolUseId: a.spawnId,
            agentId: a.id,
            status: "completed",
          });
          out.push({
            kind: "tool-end",
            sessionId: MAIN_ID,
            agentId: null,
            ts: iso(),
            toolUseId: a.spawnId,
            ok: true,
            outputChars: 600,
          });
          continue;
        }
        const tool = a.plan[a.step++]!;
        const id = nextId("toolu");
        out.push({
          kind: "tool-start",
          sessionId: MAIN_ID,
          agentId: a.id,
          ts: iso(),
          toolUseId: id,
          tool,
          ...argFor(tool),
        });
        a.cur = { id, until: t + (tool === "Bash" ? rnd(600, 2600) : rnd(250, 1500)) };
      }
    }
    if (out.length) emit(out);
  };

  const timer = setInterval(tick, 90);
  // Heartbeat on the registry so "updatedAt" moves like the real file does.
  const heartbeat = setInterval(() => {
    registry[0]!.updatedAt = Date.now();
    emit([{ kind: "session-registry", sessions: registry.map((s) => ({ ...s })) }]);
  }, 2000);
  return () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  };
}
