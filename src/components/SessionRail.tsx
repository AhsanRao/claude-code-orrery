import { useStore } from "@/store";
import { orderedSessions, recentCalls, runningAgents } from "@/lib/reducer";
import { fmtDur, shortPath } from "@/lib/format";
import { MAIN, type Session } from "@/lib/types";
import { BotAvatar } from "./Bot";
import { Icon } from "./Icons";

const BINS = 22;

/** Activity over the last 60 s as `BINS` buckets in 0..1. */
function sparkline(s: Session, now: number): number[] {
  const bins = new Array<number>(BINS).fill(0);
  const win = 60_000;
  for (const c of recentCalls(s, win, now)) {
    const i = Math.min(
      BINS - 1,
      Math.max(0, Math.floor(((c.startedAt - (now - win)) / win) * BINS)),
    );
    bins[i] = (bins[i] ?? 0) + 1;
  }
  const max = Math.max(1, ...bins);
  return bins.map((b) => b / max);
}

const avatarState = (s: Session) =>
  s.status === "busy"
    ? "live"
    : s.status === "waiting"
      ? "waiting"
      : s.status === "idle"
        ? "sleep"
        : "";

function SessionCard({ s, selected, seed }: { s: Session; selected: boolean; seed: number }) {
  const select = useStore((st) => st.selectSession);
  const now = useStore((st) => st.now);
  const home = useStore((st) => st.claudeHome).replace(/\/\.claude$/, "");
  const agents = runningAgents(s).length;
  const waitingOn = s.status === "waiting" ? s.agents[MAIN]?.current : undefined;
  const label = s.status === "ended" ? "ended" : s.status;
  return (
    <li>
      <button
        className={`sess ${s.status}${selected ? " sel" : ""}`}
        onClick={() => select(s.id)}
        aria-pressed={selected}
        aria-label={`${s.title ?? s.id}, ${label}`}
      >
        <div className="row">
          <BotAvatar state={avatarState(s)} seed={seed} />
          <span className="title">{s.title ?? s.live?.name ?? s.id.slice(0, 8)}</span>
          <span className={`pill ${s.status}`}>
            <i />
            {label}
          </span>
        </div>
        <div className="cwd">
          {shortPath(s.cwd, home)}
          {s.branch ? ` · ${s.branch}` : ""}
        </div>
        <div className="row">
          <div className="spark" aria-hidden="true">
            {sparkline(s, now).map((v, i) => (
              <span key={i} style={{ height: `${Math.max(8, v * 100)}%` }} />
            ))}
          </div>
        </div>
        <div className="meta">
          <span className="kind">
            {s.live?.entrypoint?.replace("claude-", "") ?? s.live?.kind ?? "history"}
          </span>
          {s.model && (
            <span>
              <b>{s.model}</b>
            </span>
          )}
          {s.startedAt && <span>{fmtDur(now - s.startedAt)}</span>}
          {agents > 0 && (
            <span>
              <b>{agents}</b> agent{agents === 1 ? "" : "s"}
            </span>
          )}
          {waitingOn && (
            <span className="waitmsg">
              <Icon name="bell" />
              {waitingOn.tool} · {waitingOn.summary}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

export function SessionRail() {
  const model = useStore((s) => s.model);
  const selected = useStore((s) => s.selectedSession);
  const home = useStore((s) => s.claudeHome);
  const sessions = orderedSessions(model);
  return (
    <aside className="panel sessions" aria-label="Sessions">
      <div className="ph">
        Sessions <span className="count">{sessions.length}</span>
        <span className="hint" title={home}>
          {home ? `${home.replace(/^.*\/(\.claude)$/, "~/$1")}/sessions` : ""}
        </span>
      </div>
      <ul>
        {sessions.map((s, i) => (
          <SessionCard key={s.id} s={s} selected={s.id === selected} seed={i * 17 + s.id.length} />
        ))}
      </ul>
    </aside>
  );
}
