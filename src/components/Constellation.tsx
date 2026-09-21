/**
 * The orrery itself: the session's main thread at the center, subagents in
 * orbit. Layout is a fixed ring of slots so nodes never jump; enter/exit use
 * critically damped springs, ambient life (blink, bob, glow) is CSS.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store";
import { MAIN, type Agent, type Session } from "@/lib/types";
import { agentColor, toolStyle } from "@/lib/tools";
import { Bot } from "./Bot";
import { SvgIcon } from "./Icons";

const W = 800;
const H = 440;
const CX = 400;
const CY = 222;
const R_ROOT = 42;
const R_AGENT = 34;
/** How long a finished agent stays in orbit before drifting away. */
const LINGER_MS = 8000;
const SLOTS = [-90, -30, 30, 90, 150, 210].map((deg) => {
  const r = (deg * Math.PI) / 180;
  return { x: CX + Math.cos(r) * 205, y: CY + Math.sin(r) * 150 };
});

/**
 * Assign each visible agent a stable slot index; reuse slots as agents leave.
 *
 * The map is a render-time cache, not state: it must reflect this render's
 * `ids` immediately (a spawn and its slot appear in the same frame) and must
 * remember earlier assignments so nodes never jump. That is exactly what a
 * ref mutated during render gives us; the compiler lint is disabled knowingly.
 */
function useSlots(ids: string[]): Map<string, number> {
  /* eslint-disable react-hooks/refs */
  const ref = useRef(new Map<string, number>());
  const map = ref.current;
  for (const id of [...map.keys()]) if (!ids.includes(id)) map.delete(id);
  for (const id of ids) {
    if (map.has(id)) continue;
    const used = new Set(map.values());
    const free = SLOTS.findIndex((_, i) => !used.has(i));
    if (free >= 0) map.set(id, free);
  }
  return map;
  /* eslint-enable react-hooks/refs */
}

function edgePath(slot: { x: number; y: number }): string {
  const dx = slot.x - CX;
  const dy = slot.y - CY;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const mx = (CX + slot.x) / 2 - uy * 28;
  const my = (CY + slot.y) / 2 + ux * 28;
  const sx = CX + ux * (R_ROOT + 2);
  const sy = CY + uy * (R_ROOT + 2);
  const ex = slot.x - ux * (R_AGENT + 3);
  const ey = slot.y - uy * (R_AGENT + 3);
  return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
}

function ToolBadge({ agent, r }: { agent: Agent; r: number }) {
  const cur = agent.current;
  const running = agent.status === "running";
  const style =
    agent.status === "done"
      ? { family: "read", icon: "check" }
      : cur
        ? toolStyle(cur.tool)
        : { family: "think", icon: "dots" };
  const hidden = agent.id === MAIN && !cur;
  // Outer group positions; inner group animates. CSS `transform` from the
  // keyframes would otherwise replace the translate attribute.
  return (
    <g transform={`translate(${r - 3} ${-r + 11})`} style={{ opacity: hidden ? 0 : 1 }}>
      <g className={`acc fam-${style.family}${running && cur ? " running" : ""}`}>
        <circle className="abg" r="12.5" />
        <SvgIcon name={style.icon} size={14} />
      </g>
    </g>
  );
}

function Chip({ agent, r }: { agent: Agent; r: number }) {
  const text =
    agent.status === "done"
      ? "done"
      : agent.status === "failed"
        ? "failed"
        : agent.current
          ? agent.current.tool
          : "thinking";
  if (agent.id === MAIN && !agent.current) return null;
  const w = text.length * 6.6 + 14;
  return (
    <>
      <rect
        className="chipbg"
        x={-w / 2}
        y={-r - 22}
        width={w}
        height={16}
        fill={agentColor(agent.type)}
      />
      <text className="chip" y={-r - 10.5}>
        {text}
      </text>
    </>
  );
}

function AgentNode({
  agent,
  x,
  y,
  selected,
  onSelect,
  flash,
  seed,
  leaving = false,
}: {
  agent: Agent;
  x: number;
  y: number;
  selected: boolean;
  onSelect: () => void;
  flash: boolean;
  seed: number;
  leaving?: boolean;
}) {
  const isMain = agent.id === MAIN;
  const r = isMain ? R_ROOT : R_AGENT;
  const cls = [
    "node",
    "enter",
    leaving && "leave",
    isMain && "root",
    agent.status === "running" && agent.current && "live",
    agent.status === "done" && "done",
    agent.status === "failed" && "failed",
    selected && "sel",
    flash && "flash",
  ]
    .filter(Boolean)
    .join(" ");
  const label = isMain ? "main thread" : agent.type;
  const desc = isMain ? agent.description : agent.description || agent.id;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g
        className={cls}
        onClick={onSelect}
        onPointerDown={(e) => e.currentTarget.classList.add("pressed")}
        onPointerUp={(e) => e.currentTarget.classList.remove("pressed")}
        role="button"
        tabIndex={0}
        aria-label={`${label}: ${desc}`}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      >
        <title>{`${label} · ${desc}`}</title>
        <circle className="halo" r={r + 10} />
        <circle className="base" r={r} />
        {!isMain && (
          <circle
            className="ring"
            r={r}
            stroke={agentColor(agent.type)}
            strokeDasharray={`${2 * Math.PI * r * 0.28} ${2 * Math.PI * r}`}
          />
        )}
        <Bot scale={isMain ? 1.15 : 1} seed={seed} />
        <ToolBadge agent={agent} r={r} />
        <text className="lbl" y={r + 22}>
          {label}
        </text>
        <text className="desc" y={r + 37}>
          {desc.length > 34 ? `${desc.slice(0, 33)}…` : desc}
        </text>
        <Chip agent={agent} r={r} />
      </g>
    </g>
  );
}

/** One-shot expanding ring drawn when an agent appears. */
function Burst({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <circle className="burst" cx={x} cy={y} r="20" stroke={color}>
      <animate attributeName="r" from="20" to="70" dur="0.7s" fill="freeze" />
      <animate attributeName="opacity" from="1" to="0" dur="0.7s" fill="freeze" />
    </circle>
  );
}

/** Scene for a session with nothing in orbit: waiting, idle or ended. */
function Scene({ s }: { s: Session }) {
  const main = s.agents[MAIN];
  const waitingOn = s.status === "waiting" ? main?.current : undefined;
  const cls =
    s.status === "waiting"
      ? "waiting"
      : s.status === "idle"
        ? "sleep"
        : s.status === "ended"
          ? "done"
          : "";
  const msg =
    s.status === "waiting"
      ? `Waiting for your permission${waitingOn ? ` · ${waitingOn.tool} ${waitingOn.summary}` : ""}`
      : s.status === "idle"
        ? "Idle · waiting for the next prompt"
        : s.status === "ended"
          ? "Session ended · history only"
          : "Thinking…";
  const w = Math.min(560, msg.length * 6.4 + 24);
  return (
    <g className={`scene node ${cls}`} transform={`translate(${CX} ${CY - 20})`}>
      <circle
        className="base"
        r="46"
        stroke={
          s.status === "waiting"
            ? "var(--wait)"
            : s.status === "ended"
              ? "var(--faint)"
              : "var(--line-2)"
        }
      />
      <Bot scale={1.3} seed={7} />
      {s.status === "waiting" && (
        <>
          <text className="qmark" x="44" y="-30">
            ?
          </text>
          <g className="bell" transform="translate(-58 -36)">
            <SvgIcon name="bell" size={22} className="fam-shell" />
          </g>
        </>
      )}
      {s.status === "idle" &&
        ["z", "z", "z"].map((z, i) => (
          <text key={i} className={`zzz${i ? ` z${i + 1}` : ""}`} x="40" y="-28">
            {z}
          </text>
        ))}
      <text className="lbl" y="72">
        {s.title ?? s.id}
      </text>
      <rect className="msgbg" x={-w / 2} y="84" width={w} height="26" />
      <text className="msg" y="101">
        {msg.length > 84 ? `${msg.slice(0, 83)}…` : msg}
      </text>
    </g>
  );
}

export function Constellation() {
  const session = useStore((s) =>
    s.selectedSession ? s.model.sessions[s.selectedSession] : undefined,
  );
  const selectedAgent = useStore((s) => s.selectedAgent);
  const selectAgent = useStore((s) => s.selectAgent);
  const now = useStore((s) => s.now);

  const visible = useMemo(() => {
    if (!session) return [] as Agent[];
    return Object.values(session.agents)
      .filter((a) => a.id !== MAIN && !a.id.startsWith("pending:"))
      .filter((a) => a.status === "running" || (a.endedAt ?? 0) > now - LINGER_MS)
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, SLOTS.length);
  }, [session, now]);
  const slots = useSlots(visible.map((a) => a.id));

  // Transient effects: burst on spawn, particle flying home on completion, root flash.
  const prev = useRef(new Map<string, Agent["status"]>());
  const [bursts, setBursts] = useState<{ id: string; slot: number; color: string }[]>([]);
  const [flights, setFlights] = useState<{ id: string; slot: number }[]>([]);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const seen = prev.current;
    for (const a of visible) {
      const slot = slots.get(a.id);
      if (slot === undefined) continue;
      const was = seen.get(a.id);
      if (!was) {
        setBursts((b) => [...b, { id: a.id, slot, color: agentColor(a.type) }]);
        setFlash(true);
        window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== a.id)), 800);
      } else if (was === "running" && a.status !== "running") {
        setFlights((f) => [...f, { id: a.id, slot }]);
        window.setTimeout(() => {
          setFlights((f) => f.filter((x) => x.id !== a.id));
          setFlash(true);
        }, 900);
      }
      seen.set(a.id, a.status);
    }
    for (const id of [...seen.keys()]) if (!visible.some((a) => a.id === id)) seen.delete(id);
  }, [visible, slots]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 700);
    return () => window.clearTimeout(t);
  }, [flash]);

  const main = session?.agents[MAIN];
  const showScene =
    session && visible.length === 0 && (session.status !== "busy" || !main?.current);

  return (
    <div className="panel graph">
      <div className="ph">
        Constellation
        <span className="hint">{session?.id ?? ""}</span>
      </div>
      <svg
        className="stage"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Agents orbiting the main thread"
      >
        {session && showScene && <Scene s={session} />}
        {session && !showScene && main && (
          <>
            <g id="edges">
              {visible.map((a) => {
                const slot = SLOTS[slots.get(a.id) ?? 0]!;
                const live = a.status === "running";
                return (
                  <g key={a.id}>
                    <path
                      id={`edge-${a.id}`}
                      className={`edge${live ? " live" : " done"}`}
                      d={edgePath(slot)}
                    />
                    {live && (
                      <circle className="particle" r="3.2">
                        <animateMotion dur="1.4s" repeatCount="indefinite">
                          <mpath href={`#edge-${a.id}`} />
                        </animateMotion>
                      </circle>
                    )}
                  </g>
                );
              })}
              {flights.map((f) => (
                <circle key={f.id} className="particle back" r="4.5">
                  <animateMotion
                    dur="0.9s"
                    keyPoints="1;0"
                    keyTimes="0;1"
                    calcMode="linear"
                    fill="freeze"
                  >
                    <mpath href={`#edge-${f.id}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
            {bursts.map((b) => (
              <Burst key={b.id} x={SLOTS[b.slot]!.x} y={SLOTS[b.slot]!.y} color={b.color} />
            ))}
            <AgentNode
              key={MAIN}
              agent={{ ...main, description: session.title ?? session.cwd ?? "" }}
              x={CX}
              y={CY}
              selected={selectedAgent === MAIN}
              onSelect={() => selectAgent(MAIN)}
              flash={flash}
              seed={1}
            />
            {visible.map((a, i) => {
              const slot = SLOTS[slots.get(a.id) ?? 0]!;
              const leaving = a.status !== "running" && (a.endedAt ?? 0) < now - (LINGER_MS - 1000);
              return (
                <AgentNode
                  key={a.id}
                  agent={a}
                  x={slot.x}
                  y={slot.y}
                  selected={selectedAgent === a.id}
                  onSelect={() => selectAgent(a.id)}
                  flash={false}
                  seed={i + 3}
                  leaving={leaving}
                />
              );
            })}
          </>
        )}
      </svg>
      <div className="glegend" aria-hidden="true">
        <span>
          <i style={{ background: "var(--ty-explore)" }} />
          Explore
        </span>
        <span>
          <i style={{ background: "var(--ty-plan)" }} />
          Plan
        </span>
        <span>
          <i style={{ background: "var(--ty-gp)" }} />
          general-purpose
        </span>
        <span>
          <i style={{ background: "var(--ty-review)" }} />
          reviewer
        </span>
      </div>
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" style={{ ["--c" as string]: t.color }}>
          <span className="ic">
            <SvgIconInline name={t.icon} />
          </span>
          <b>{t.title}</b>
          <span className="m">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function SvgIconInline({ name }: { name: string }) {
  return (
    <svg className="icon" aria-hidden="true">
      <use href={`#ic-${name}`} />
    </svg>
  );
}
