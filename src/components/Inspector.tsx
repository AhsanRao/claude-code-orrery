/**
 * Detail pane for the selected agent (or main thread): identity, counters,
 * what is running right now, and the recent tool feed, newest first.
 */

import { useEffect, useState } from "react";
import { useStore } from "@/store";
import { MAIN, type Agent, type Message, type Session, type ToolCall } from "@/lib/types";
import { estimateCost, fmtCost } from "@/lib/cost";
import { agentColor, toolStyle } from "@/lib/tools";
import { fmtDurShort, fmtMs, fmtTokensShort } from "@/lib/format";
import { Icon } from "./Icons";

const FEED_LIMIT = 40;

function FeedItem({ c }: { c: ToolCall }) {
  const style = toolStyle(c.tool);
  const running = !c.endedAt;
  const isAgent = c.tool === "Agent" || c.tool === "Task";
  const dur = isAgent && running ? "running" : running ? "…" : fmtMs(c.endedAt! - c.startedAt);
  return (
    <li
      className={`fi fam-${style.family}${running ? " running" : ""}${c.ok === false ? " err" : ""}${isAgent ? " agent" : ""}`}
    >
      <span className="ic">
        <Icon name={style.icon} className="anim" />
      </span>
      <span className="tn">{c.tool}</span>
      <span className="ta" title={c.summary}>
        {c.summary}
      </span>
      <span className="td">{dur}</span>
    </li>
  );
}

/**
 * Obvious secrets, blanked before anything is drawn. This is a courtesy for
 * screen-sharing, not a security control: the transcript on disk is unchanged
 * and a determined secret will still slip through.
 */
const SECRET =
  /\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9._-]{20,})/g;
const LABELLED =
  /((?:api[_-]?key|secret|token|password|passwd|authorization)\W{0,3}\s*["']?)([^\s"']{6,})/gi;

// Labelled values first: blanking them afterwards would re-match the marker.
export const redact = (text: string): string =>
  text.replace(LABELLED, (_m, label: string) => `${label}«redacted»`).replace(SECRET, "«redacted»");

function MessageItem({ m }: { m: Message }) {
  const mine = m.role === "user";
  return (
    <li className={`msg ${m.role}`}>
      <span className="who">{mine ? "You" : "Claude"}</span>
      <p>{redact(m.text)}</p>
    </li>
  );
}

function NowRow({ agent }: { agent: Agent }) {
  const [now, setNow] = useState(() => Date.now());
  const currentId = agent.current?.id;
  useEffect(() => {
    if (!currentId) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [currentId]);
  if (agent.status === "done" || agent.status === "failed") {
    return (
      <div className="now">
        <span className="k">Status</span>
        <div className="v">
          <span style={{ color: agent.status === "done" ? "var(--active)" : "var(--err)" }}>
            {agent.status === "done" ? "✓ completed" : "✗ failed"}
          </span>
          <span className="txt" style={{ color: "var(--muted)" }}>
            result returned to{" "}
            {agent.parentId === MAIN || !agent.parentId ? "main thread" : agent.parentId}
          </span>
        </div>
      </div>
    );
  }
  if (agent.current) {
    return (
      <div className="now">
        <span className="k">Now running</span>
        <div className="v">
          <span className="spin" />
          <b>{agent.current.tool}</b>
          <span className="txt">{agent.current.summary}</span>
          <span className="el">{fmtMs(now - agent.current.startedAt)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="now">
      <span className="k">Now</span>
      <div className="v">
        <span className="txt" style={{ color: "var(--muted)" }}>
          {agent.lastText ? agent.lastText : "thinking…"}
        </span>
      </div>
    </div>
  );
}

function Header({ s, a, now }: { s: Session; a: Agent; now: number }) {
  const prices = useStore((st) => st.prices);
  const isMain = a.id === MAIN;
  const tokens = a.tokens.inputTokens + a.tokens.outputTokens;
  return (
    <div className="ihead">
      <div className="who">
        <span className="tybadge" style={{ background: agentColor(a.type) }}>
          {isMain ? "session" : a.type}
        </span>
        <span className="type" title={isMain ? s.title : a.description}>
          {isMain ? (s.title ?? s.id) : a.description || a.id}
        </span>
      </div>
      <div className="id">{isMain ? (s.transcriptPath ?? s.id) : (a.transcriptPath ?? a.id)}</div>
      <div className="kv">
        <div>
          <span className="k">Model</span>
          <div className="v">{a.model ?? s.model ?? "—"}</div>
        </div>
        <div>
          <span className="k">Elapsed</span>
          <div className="v">
            {fmtDurShort(
              (a.endedAt ?? now) - (isMain ? (s.startedAt ?? a.startedAt) : a.startedAt),
            )}
          </div>
        </div>
        <div>
          <span className="k">Tools</span>
          <div className="v">{a.toolCount}</div>
        </div>
        <div>
          <span className="k">Tokens</span>
          <div
            className="v"
            title={`in ${a.tokens.inputTokens} · out ${a.tokens.outputTokens} · cache read ${a.tokens.cacheReadTokens}`}
          >
            {fmtTokensShort(tokens)}
          </div>
        </div>
        <div>
          <span className="k">Cost</span>
          <div className="v" title="Estimate from token counts and the price table — not a bill">
            ~{fmtCost(estimateCost(a.tokens, a.model ?? s.model, prices))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Inspector() {
  const session = useStore((s) =>
    s.selectedSession ? s.model.sessions[s.selectedSession] : undefined,
  );
  const selectedAgent = useStore((s) => s.selectedAgent);
  const now = useStore((s) => s.now);
  const agent = session?.agents[selectedAgent] ?? session?.agents[MAIN];
  const [tab, setTab] = useState<"tools" | "transcript">("tools");
  const feed =
    session && agent
      ? session.calls
          .filter((c) => c.agentId === agent.id)
          .slice(-FEED_LIMIT)
          .reverse()
      : [];
  // Main thread keeps the user's prompts; a subagent only has its own replies.
  const transcript =
    session && agent
      ? session.messages
          .filter((m) => m.agentId === agent.id || (agent.id === MAIN && m.role === "user"))
          .slice(-FEED_LIMIT)
          .reverse()
      : [];

  return (
    <aside className="panel inspector" aria-label="Inspector">
      <div className="ph">
        Inspector
        {session && agent && (
          <div className="tabs" role="tablist" aria-label="Inspector view">
            <button role="tab" aria-selected={tab === "tools"} onClick={() => setTab("tools")}>
              Tools
            </button>
            <button
              role="tab"
              aria-selected={tab === "transcript"}
              onClick={() => setTab("transcript")}
            >
              Transcript
            </button>
          </div>
        )}
        <span className="hint">{agent ? (agent.id === MAIN ? "main thread" : agent.id) : ""}</span>
      </div>
      {session && agent ? (
        <>
          <Header s={session} a={agent} now={now} />
          <NowRow agent={agent} />
          {tab === "tools" ? (
            <ul className="feed">
              {feed.map((c) => (
                <FeedItem key={c.id} c={c} />
              ))}
              {feed.length === 0 && <li className="empty">no tool calls yet</li>}
            </ul>
          ) : (
            <ul className="feed transcript">
              {transcript.map((m) => (
                <MessageItem key={m.id} m={m} />
              ))}
              {transcript.length === 0 && <li className="empty">nothing said yet</li>}
            </ul>
          )}
        </>
      ) : (
        <div className="empty">select a session</div>
      )}
    </aside>
  );
}
