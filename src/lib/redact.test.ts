import { describe, expect, it } from "vitest";
import { redact } from "@/components/Inspector";

describe("redact", () => {
  it("blanks obvious secrets before they are drawn", () => {
    expect(redact("use sk-ant-api03-abcdefghijklmnop now")).toBe("use «redacted» now");
    expect(redact("token: ghp_abcdefghijklmnopqrst")).toBe("token: «redacted»");
    expect(redact(`api_key="hunter2hunter2"`)).toBe(`api_key="«redacted»"`);
  });

  it("leaves ordinary text alone", () => {
    const text = "Read src/lib/reducer.ts and fix the sort";
    expect(redact(text)).toBe(text);
  });
});
