import { describe, expect, it } from "vitest";
import { traySummary } from "./tray";

describe("traySummary", () => {
  it("shows the most urgent thing, or nothing", () => {
    expect(traySummary({ waiting: 2, busy: 3, agents: 4 })).toBe("2 waiting");
    expect(traySummary({ waiting: 0, busy: 3, agents: 1 })).toBe("1 agent");
    expect(traySummary({ waiting: 0, busy: 3, agents: 0 })).toBe("3 busy");
    expect(traySummary({ waiting: 0, busy: 0, agents: 0 })).toBe("");
  });
});
