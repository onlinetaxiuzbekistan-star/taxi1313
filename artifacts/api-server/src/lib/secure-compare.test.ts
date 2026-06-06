import { describe, it, expect } from "vitest";
import { timingSafeEqualStr } from "./secure-compare.js";

describe("timingSafeEqualStr", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualStr("hunter2", "hunter2")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeEqualStr("hunter2", "hunter3")).toBe(false);
  });

  it("returns false for different lengths (no throw)", () => {
    expect(timingSafeEqualStr("short", "a-much-longer-secret")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(timingSafeEqualStr("", "")).toBe(true);
    expect(timingSafeEqualStr("", "x")).toBe(false);
  });

  it("handles unicode/multibyte without throwing", () => {
    expect(timingSafeEqualStr("токен", "токен")).toBe(true);
    expect(timingSafeEqualStr("токен", "tokén")).toBe(false);
  });
});
