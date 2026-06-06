// @ts-nocheck
import { describe, it, expect } from "vitest";
import { BrokenCircuitError } from "cockatiel";
import { makeBreaker, getBreakerStates, getExternalHealth } from "./circuit.js";

describe("circuit breakers", () => {
  it("registers a named breaker, initially Closed / ok", () => {
    makeBreaker("unit-closed", { consecutiveFailures: 3, retries: 0 });
    expect(getBreakerStates()["unit-closed"]).toBe("Closed");
    const h = getExternalHealth();
    expect(h.services["unit-closed"].status).toBe("ok");
  });

  it("executes a successful call and returns its value", async () => {
    const p = makeBreaker("unit-success", { retries: 0 });
    await expect(p.execute(() => "value")).resolves.toBe("value");
  });

  it("opens after consecutive failures and then fails fast", async () => {
    const p = makeBreaker("unit-open", { consecutiveFailures: 2, retries: 0, halfOpenAfterMs: 60_000 });

    await expect(p.execute(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(p.execute(() => { throw new Error("boom"); })).rejects.toThrow("boom");

    // Circuit is now OPEN — next call fails fast with BrokenCircuitError.
    expect(getBreakerStates()["unit-open"]).toBe("Open");
    await expect(p.execute(() => "should-not-run")).rejects.toBeInstanceOf(BrokenCircuitError);

    const h = getExternalHealth();
    expect(h.services["unit-open"].status).toBe("down");
    expect(h.ok).toBe(false);
  });

  it("half-opens after the cooldown and resets to Closed on a successful probe", async () => {
    const p = makeBreaker("unit-recover", { consecutiveFailures: 1, retries: 0, halfOpenAfterMs: 50 });

    await expect(p.execute(() => { throw new Error("x"); })).rejects.toThrow();
    expect(getBreakerStates()["unit-recover"]).toBe("Open");

    await new Promise((r) => setTimeout(r, 80));

    // After cooldown the next call probes (half-open) and, on success, closes.
    await expect(p.execute(() => "ok")).resolves.toBe("ok");
    expect(getBreakerStates()["unit-recover"]).toBe("Closed");
  });

  it("retries an idempotent call that eventually succeeds", async () => {
    const p = makeBreaker("unit-retry", { retries: 2 });
    let calls = 0;
    const result = await p.execute(() => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
      return "recovered";
    });
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });
});
