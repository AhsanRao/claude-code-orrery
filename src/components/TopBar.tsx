import { useStore } from "@/store";
import { fmtTokens } from "@/lib/format";
import { recentCalls, runningAgents } from "@/lib/reducer";
import { Icon } from "./Icons";

function Stat({ label, value, live }: { label: string; value: string | number; live?: boolean }) {
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className={`v${live ? " live" : ""}`}>{value}</span>
    </div>
  );
}

export function TopBar() {
  const model = useStore((s) => s.model);
  const mode = useStore((s) => s.mode);
  const now = useStore((s) => s.now);
  const toastsEnabled = useStore((s) => s.toastsEnabled);
  const setToastsEnabled = useStore((s) => s.setToastsEnabled);
  const sessions = Object.values(model.sessions);
  const live = sessions.filter((s) => s.live).length;
  const agents = sessions.reduce((n, s) => n + runningAgents(s).length, 0);
  const tpm = sessions.reduce(
    (n, s) => n + recentCalls(s, 60_000, now).filter((c) => c.tool !== "Agent").length,
    0,
  );
  const tokens = sessions
    .filter((s) => s.live)
    .reduce((n, s) => n + s.tokens.outputTokens + s.tokens.inputTokens, 0);

  return (
    <header className="top" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
          <circle cx="16" cy="16" r="4.5" fill="var(--accent)" />
          <g className="orbit">
            <circle cx="27" cy="11" r="2.6" fill="var(--active)" />
            <circle cx="7" cy="23" r="2.2" fill="var(--t-search)" />
            <circle cx="21" cy="28" r="1.8" fill="var(--t-web)" />
          </g>
        </svg>
        <span className="name">Orrery</span>
        <span className="sub">Claude Code sessions, live</span>
      </div>
      <div className="stats">
        <Stat label="Live sessions" value={live} live={live > 0} />
        <Stat label="Agents running" value={agents} live={agents > 0} />
        <Stat label="Tools / min" value={tpm} />
        <Stat label="Tokens · live" value={fmtTokens(tokens)} />
      </div>
      <div
        className={`mode ${mode}`}
        title={
          mode === "demo"
            ? "Demo data. Run inside the desktop app to watch real sessions."
            : "No hooks, no env vars. Read-only watch on ~/.claude."
        }
      >
        <span className="dot" />
        {mode === "demo"
          ? "demo · simulated"
          : mode === "tauri"
            ? "passive · read-only"
            : "connecting…"}
        <span className="sep" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={toastsEnabled}
          onClick={() => setToastsEnabled(!toastsEnabled)}
          title={toastsEnabled ? "Toasts on — click to mute" : "Toasts off — click to enable"}
        >
          <Icon name="bell" />
          {toastsEnabled ? "toasts" : "muted"}
        </button>
      </div>
    </header>
  );
}
