import { describe, expect, it } from "vitest";
import { fmtDurShort, fmtTokens, fmtTokensShort } from "./format";

describe("token formatting", () => {
  it("top bar: exact until 100k, then K/M", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(99_412)).toBe("99,412");
    expect(fmtTokens(184_320)).toBe("184K");
    expect(fmtTokens(1_240_000)).toBe("1.2M");
    expect(fmtTokens(12_400_000)).toBe("12M");
  });
  it("tiles: always ≤ 5 chars", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [200, "<1k"],
      [1_000, "1k"],
      [2_450, "2.5k"],
      [14_200, "14k"],
      [184_320, "184k"],
      [1_240_000, "1.2M"],
    ];
    for (const [n, out] of cases) {
      expect(fmtTokensShort(n)).toBe(out);
      expect(out.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("short durations", () => {
  it("fits a tile", () => {
    expect(fmtDurShort(42_000)).toBe("42s");
    expect(fmtDurShort(14 * 60_000 + 8_000)).toBe("14m");
    expect(fmtDurShort(65 * 60_000)).toBe("1h05");
    expect(fmtDurShort(27 * 3_600_000)).toBe("1d3h");
  });
});
