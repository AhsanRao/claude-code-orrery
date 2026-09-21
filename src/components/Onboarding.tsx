/** Shown when the engine is connected but nothing has been observed yet. */

import { useStore } from "@/store";

export function Onboarding() {
  const home = useStore((s) => s.claudeHome);
  return (
    <div className="onboard">
      <div className="card">
        <svg width="72" height="72" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="none" stroke="var(--line-2)" strokeWidth="1.2" />
          <circle cx="16" cy="16" r="4.5" fill="var(--accent)" />
          <circle cx="27" cy="11" r="2.6" fill="var(--active)" />
          <circle cx="7" cy="23" r="2.2" fill="var(--t-search)" />
        </svg>
        <h2>Nothing in orbit yet</h2>
        <p>
          Orrery is watching <code>{home || "~/.claude"}</code>. Start a Claude Code session in any
          terminal or in VS Code and it will appear here within a second.
        </p>
        <p>Orrery only reads; Claude Code is never touched.</p>
      </div>
    </div>
  );
}
