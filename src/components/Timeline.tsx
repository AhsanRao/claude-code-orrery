/**
 * Swimlanes: one per agent, bars per tool call, sliding 60-second window with
 * "now" pinned to the right edge. Re-renders ten times a second, which is
 * plenty for a window this wide and far cheaper than per-frame layout.
 */

import { useEffect, useState } from "react";
import { useStore } from "@/store";
import { MAIN, type Session, type ToolCall } from "@/lib/types";
import { agentColor, toolStyle } from "@/lib/tools";
import { fmtMs } from "@/lib/format";

const WINDOW = 60_000;
const TICKS = [60, 50, 40, 30, 20, 10, 0];

function useFastNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function Lane({
  s,
  agentId,
  label,
  color,
  calls,
  now,
  gone,
}: {
  s: Session;
  agentId: string;
  label: string;
  color: string;
  calls: ToolCall[];
  now: number;
  gone: boolean;
}) {
  const w0 = now - WINDOW;
  return (
    <div className={`lane${gone ? " gone" : ""}`} data-agent={agentId} data-session={s.id}>
      <div className="ln">
        <i style={{ background: color }} />
        {label}
      </div>
      <div className="track">
        {calls.map((c) => {
          const end = c.endedAt ?? now;
          const left = Math.max(0, ((c.startedAt - w0) / WINDOW) * 100);
          const right = ((end - w0) / WINDOW) * 100;
          const style = toolStyle(c.tool);
          return (
            <div
              key={c.id}
              className={`bar fam-${style.family}${c.endedAt ? "" : " running"}${c.ok === false ? " err" : ""}`}
              style={{ left: `${left}%`, width: `${Math.max(0.3, right - left)}%` }}
              title={`${c.tool} ${c.summary}${c.endedAt ? ` · ${fmtMs(c.endedAt - c.startedAt)}` : " · running"}`}
            />
          );
        })}
      </div>
    </div>
  );
}

export function Timeline() {
  const session = useStore((s) =>
    s.selectedSession ? s.model.sessions[s.selectedSession] : undefined,
  );
  const now = useFastNow(!!session);
  const w0 = now - WINDOW;
  const recent = session ? session.calls.filter((c) => (c.endedAt ?? now) >= w0) : [];
  const byAgent = new Map<string, ToolCall[]>();
  for (const c of recent) byAgent.set(c.agentId, [...(byAgent.get(c.agentId) ?? []), c]);
  const agents = session
    ? Object.values(session.agents)
        .filter((a) => a.id === MAIN || byAgent.has(a.id))
        .sort((a, b) => (a.id === MAIN ? -1 : b.id === MAIN ? 1 : a.startedAt - b.startedAt))
    : [];
  const empty = !session
    ? "select a session"
    : recent.length === 0
      ? session.status === "waiting"
        ? "paused · waiting on permission"
        : "no tool calls in the last 60 s"
      : null;

  return (
    <div className="panel timeline">
      <div className="ph">
        Timeline <span className="hint">last 60 s · one lane per agent</span>
      </div>
      <div className="lanes">
        {session &&
          agents.map((a) => (
            <Lane
              key={a.id}
              s={session}
              agentId={a.id}
              label={a.id === MAIN ? "main" : a.type}
              color={agentColor(a.type)}
              calls={byAgent.get(a.id) ?? []}
              now={now}
              gone={a.status !== "running"}
            />
          ))}
        <div className="ticks" aria-hidden="true">
          {TICKS.map((t) => (
            <span key={t} style={{ left: `${100 - (t / 60) * 100}%` }}>
              {t === 0 ? "now" : `-${t}s`}
            </span>
          ))}
        </div>
        <div className="playhead" aria-hidden="true" />
        {empty && <div className="empty">{empty}</div>}
      </div>
    </div>
  );
}
