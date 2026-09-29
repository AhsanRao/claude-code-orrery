import { useStore } from "@/store";
import { fmtTokens } from "@/lib/format";
import { estimateCost, fmtCost, type Price } from "@/lib/cost";
import { recentCalls, runningAgents } from "@/lib/reducer";
import { Icon } from "./Icons";
import { useState } from "react";

/** Cost tile that opens the editable price table. */
function CostStat({ usd }: { usd: number }) {
  const prices = useStore((s) => s.prices);
  const setPrice = useStore((s) => s.setPrice);
  const [open, setOpen] = useState(false);
  const field = (model: string, key: keyof Price, label: string) => (
    <label key={`${model}-${key}`}>
      <span>{label}</span>
      <input
        id={`price-${model}-${key}`}
        type="number"
        min="0"
        step="0.1"
        value={prices[model]?.[key] ?? 0}
        onChange={(e) => setPrice(model, { ...prices[model]!, [key]: Number(e.target.value) || 0 })}
      />
    </label>
  );
  return (
    <div className="stat cost">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Estimate from token counts — click to edit the price table"
      >
        <span className="k">Cost · live</span>
        <span className="v">~{fmtCost(usd)}</span>
      </button>
      {open && (
        <div className="prices" role="dialog" aria-label="Price table">
          <p>USD per million tokens. Estimates only — your plan may differ.</p>
          {Object.keys(prices).map((model) => (
            <div className="prow" key={model}>
              <b>{model}</b>
              {field(model, "input", "in")}
              {field(model, "output", "out")}
              {field(model, "cacheRead", "cache r")}
              {field(model, "cacheWrite", "cache w")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const prices = useStore((s) => s.prices);
  const toastsEnabled = useStore((s) => s.toastsEnabled);
  const precision = useStore((s) => s.precision);
  const openSettings = useStore((s) => s.openSettings);
  const setToastsEnabled = useStore((s) => s.setToastsEnabled);
  const sessions = Object.values(model.sessions);
  const live = sessions.filter((s) => s.live).length;
  const agents = sessions.reduce((n, s) => n + runningAgents(s).length, 0);
  const tpm = sessions.reduce(
    (n, s) => n + recentCalls(s, 60_000, now).filter((c) => c.tool !== "Agent").length,
    0,
  );
  const liveSessions = sessions.filter((s) => s.live);
  const tokens = liveSessions.reduce((n, s) => n + s.tokens.outputTokens + s.tokens.inputTokens, 0);
  const cost = liveSessions.reduce((n, s) => n + estimateCost(s.tokens, s.model, prices), 0);

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
        <CostStat usd={cost} />
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
            ? precision?.installed
              ? "precision · hooks on"
              : "passive · read-only"
            : "connecting…"}
        <span className="sep" aria-hidden="true" />
        <button type="button" onClick={() => openSettings(true)} title="Settings">
          <Icon name="sliders" />
          settings
        </button>
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
