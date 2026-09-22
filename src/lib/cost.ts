/**
 * Cost estimates from token usage.
 *
 * Prices are USD per million tokens and are a *guess by model family*: the
 * transcript records `claude-opus-5`, not which tier or discount an account
 * is on. Treat the number as an order of magnitude, not a bill. Users can
 * override the table; overrides live in this viewer's browser storage.
 */

import type { Usage } from "./types";

export interface Price {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million tokens read from the prompt cache. */
  cacheRead: number;
  /** USD per million tokens written to the prompt cache. */
  cacheWrite: number;
}

/** Defaults by model family. Edit in the app, or override the whole table. */
export const DEFAULT_PRICES: Record<string, Price> = {
  opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const KEY = "orrery.prices";

export function loadPrices(): Record<string, Price> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PRICES;
    return { ...DEFAULT_PRICES, ...(JSON.parse(raw) as Record<string, Price>) };
  } catch {
    return DEFAULT_PRICES;
  }
}

export function savePrices(prices: Record<string, Price>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prices));
  } catch {
    /* private mode: the edit applies to this window only */
  }
}

/** USD for one usage total. Unknown models fall back to sonnet pricing. */
export function estimateCost(
  usage: Usage,
  model: string | undefined,
  prices = DEFAULT_PRICES,
): number {
  const p = (model ? prices[model] : undefined) ?? prices.sonnet ?? DEFAULT_PRICES.sonnet!;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}

/** `$0.0042` · `$1.23` · `$18.40` — always ≤ 7 characters. */
export const fmtCost = (usd: number): string =>
  usd === 0
    ? "$0"
    : usd < 0.01
      ? `$${usd.toFixed(4)}`
      : usd < 100
        ? `$${usd.toFixed(2)}`
        : `$${Math.round(usd)}`;
