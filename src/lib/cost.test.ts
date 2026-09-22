import { describe, expect, it } from "vitest";
import { DEFAULT_PRICES, estimateCost, fmtCost } from "./cost";

const usage = (o: Partial<Record<string, number>> = {}) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...o,
});

describe("estimateCost", () => {
  it("prices each bucket by model family", () => {
    // 1M output on opus = $75
    expect(estimateCost(usage({ outputTokens: 1_000_000 }), "opus")).toBeCloseTo(75);
    expect(estimateCost(usage({ inputTokens: 1_000_000 }), "haiku")).toBeCloseTo(1);
    expect(estimateCost(usage({ cacheReadTokens: 1_000_000 }), "sonnet")).toBeCloseTo(0.3);
  });

  it("falls back to sonnet for unknown or missing models", () => {
    const u = usage({ outputTokens: 1_000_000 });
    expect(estimateCost(u, "some-future-model")).toBe(estimateCost(u, "sonnet"));
    expect(estimateCost(u, undefined)).toBe(estimateCost(u, "sonnet"));
  });

  it("honours an override table", () => {
    const prices = {
      ...DEFAULT_PRICES,
      opus: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
    };
    expect(estimateCost(usage({ outputTokens: 2_000_000 }), "opus", prices)).toBeCloseTo(2);
  });
});

describe("fmtCost", () => {
  it("stays short at every magnitude", () => {
    for (const [usd, out] of [
      [0, "$0"],
      [0.00042, "$0.0004"],
      [1.234, "$1.23"],
      [1840.4, "$1840"],
    ] as [number, string][]) {
      expect(fmtCost(usd)).toBe(out);
      expect(fmtCost(usd).length).toBeLessThanOrEqual(7);
    }
  });
});
