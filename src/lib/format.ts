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

/** Top-bar style: exact with separators until it gets long, then 120K / 1.2M. */
export const fmtTokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
    : n >= 100_000
      ? `${Math.round(n / 1000)}K`
      : n.toLocaleString();

/** Tile style (≤ 5 chars): 0 · <1k · 2k · 14k · 120k · 1.2M. */
export const fmtTokensShort = (n: number): string =>
  n === 0
    ? "0"
    : n < 1000
      ? "<1k"
      : n >= 1_000_000
        ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
        : n >= 10_000
          ? `${Math.round(n / 1000)}k`
          : `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;

/** Tile style (≤ 5 chars): 42s · 14m · 1h05 · 2d3h. */
export const fmtDurShort = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
};

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
