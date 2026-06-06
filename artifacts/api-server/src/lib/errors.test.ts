import { describe, it, expect } from "vitest";
import { errorMessage } from "./errors.js";

describe("errorMessage", () => {
  it("extracts .message from an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error value", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("handles a subclass of Error", () => {
    class MyError extends Error {}
    expect(errorMessage(new MyError("custom"))).toBe("custom");
  });

  it("stringifies objects without a message", () => {
    expect(errorMessage({ code: "X" })).toBe("[object Object]");
  });
});
