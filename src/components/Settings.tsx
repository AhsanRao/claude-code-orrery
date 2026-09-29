/**
 * Settings dialog. Today it holds one thing: precision mode, the only feature
 * that writes to `~/.claude/settings.json`. Nothing is written until the user
 * has seen the exact change and confirmed it.
 */

import { useEffect, useState } from "react";
import { useStore } from "@/store";
import { Icon } from "./Icons";

/** Side-by-side before/after of the settings file, lines marked. */
function Diff({ before, after }: { before: string; after: string }) {
  const b = before.split("\n");
  const a = after.split("\n");
  const removed = new Set(b.filter((l) => !a.includes(l)));
  const added = new Set(a.filter((l) => !b.includes(l)));
  return (
    <pre className="diff" aria-label="settings.json changes">
      {b
        .filter((l) => removed.has(l))
        .map((l, i) => (
          <code key={`r${i}`} className="del">
            - {l.trim()}
          </code>
        ))}
      {a
        .filter((l) => added.has(l))
        .map((l, i) => (
          <code key={`a${i}`} className="add">
            + {l.trim()}
          </code>
        ))}
    </pre>
  );
}

export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const close = useStore((s) => s.openSettings);
  const precision = useStore((s) => s.precision);
  const preview = useStore((s) => s.previewPrecision);
  const apply = useStore((s) => s.setPrecision);
  const [diff, setDiff] = useState<[string, string] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installing = !precision?.installed;

  useEffect(() => {
    if (!open || !precision?.supported) return;
    let live = true;
    // Both updates land in the promise callbacks, never during the effect body.
    preview(installing)
      .then((d) => {
        if (live) {
          setDiff(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [open, installing, precision?.supported, preview]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await apply(installing);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onClick={() => close(false)}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Precision mode</h2>
          <button onClick={() => close(false)} aria-label="Close settings">
            <Icon name="x" />
          </button>
        </header>

        <p>
          Orrery normally only reads files. Precision mode additionally asks Claude Code to tell it
          when a subagent starts and stops, so agents are identified exactly instead of matched in
          order, and a turn ending is known immediately.
        </p>
        <ul className="tradeoff">
          <li>
            <b>Cost</b> — Claude Code spawns one short-lived shell per hook event. The hooks run
            with <code>async: true</code>, so nothing ever waits for them.
          </li>
          <li>
            <b>What is written</b> — four entries in{" "}
            <code>{precision?.settingsPath ?? "~/.claude/settings.json"}</code>. The previous file
            is copied to <code>settings.json.orrery-backup</code> first; every other setting is left
            untouched.
          </li>
          <li>
            <b>Where events go</b> — the hook appends to{" "}
            <code>{precision?.sinkPath || "Orrery's data directory"}</code>, which only Orrery
            reads. No network, no port, no daemon.
          </li>
          <li>
            <b>Takes effect</b> — for Claude Code sessions started after installing.
          </li>
        </ul>

        {precision && !precision.supported && (
          <p className="warn">
            Not available on this platform yet: the hook is a POSIX shell one-liner. Orrery keeps
            working in passive mode.
          </p>
        )}

        {precision?.supported && diff && <Diff before={diff[0]} after={diff[1]} />}
        {error && <p className="warn">{error}</p>}

        <footer>
          <span className={`state ${precision?.installed ? "on" : "off"}`}>
            {precision?.installed
              ? `installed · ${precision.events.join(", ")}`
              : "not installed — Orrery is fully passive"}
          </span>
          <button className="ghost" onClick={() => close(false)}>
            Cancel
          </button>
          <button
            className={installing ? "primary" : "danger"}
            disabled={busy || !precision?.supported}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : installing ? "Install hooks" : "Remove hooks"}
          </button>
        </footer>
      </div>
    </div>
  );
}
