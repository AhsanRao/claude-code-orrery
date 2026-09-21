/** Small formatting helpers shared by components. */

export const fmtMs = (ms: number): string =>
  ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;

export const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const fmtTokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `${Math.round(n / 1000)}k`
      : n.toLocaleString();

/** `/Users/me/dev/repo` → `~/dev/repo` when a home dir is known. */
export const shortPath = (p: string | undefined, home?: string): string => {
  if (!p) return "";
  if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
};

/** Parse an ISO timestamp, tolerating the empty string. */
export const toMs = (iso: string, fallback = Date.now()): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? fallback : t;
};

/** Human model name from an API id (`claude-opus-5` → `opus`). */
export const shortModel = (model?: string | null): string | undefined => {
  if (!model) return undefined;
  const m = /claude-(?:[0-9-]+-)?(opus|sonnet|haiku|fable)/.exec(model);
  return m?.[1] ?? model;
};
