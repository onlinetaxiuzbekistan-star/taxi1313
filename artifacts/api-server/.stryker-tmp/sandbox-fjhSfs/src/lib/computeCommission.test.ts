// @ts-nocheck
import { describe, it, expect, vi } from "vitest";

// completion.ts pulls in DB/websocket/revenue/bonuses/settings at import time.
// We only exercise the pure computeCommission() here, so stub the side-effecting
// deps to keep the import graph clean.
vi.mock("@workspace/db", () => ({
  db: {},
  ridesTable: {},
  usersTable: {},
  transactionsTable: {},
  marketplaceListingsTable: {},
}));
vi.mock("./bonuses.js", () => ({ checkMilestoneBonus: vi.fn() }));
vi.mock("./websocket.js", () => ({ broadcastToAll: vi.fn() }));
vi.mock("./settingsCache.js", () => ({ getSettingNum: vi.fn() }));
vi.mock("./revenue-ai-prod.js", () => ({ recordRideCompleted: vi.fn() }));

import { computeCommission } from "./completion.js";

describe("computeCommission", () => {
  it("happy path: 10% of price, no options/fixed", () => {
    const r = computeCommission(10000, 0, 0, 0.1, 0);
    expect(r).toEqual({ baseCommission: 1000, optsCom: 0, totalCommission: 1000, payout: 9000 });
  });

  it("subtracts optionsTotal from the percent base (Variant A)", () => {
    // base = (12000 - 2000) * 0.1 = 1000; payout = price - totalCommission
    const r = computeCommission(12000, 2000, 0, 0.1, 0);
    expect(r.baseCommission).toBe(1000);
    expect(r.totalCommission).toBe(1000);
    expect(r.payout).toBe(11000);
  });

  it("adds fixed per-seat fee (multi-seat)", () => {
    // base = 10000*0.1 + (500 * 3 seats * 1) = 1000 + 1500 = 2500
    const r = computeCommission(10000, 0, 0, 0.1, 500, 3, false);
    expect(r.baseCommission).toBe(2500);
    expect(r.payout).toBe(7500);
  });

  it("doubles the fixed fee on round trips", () => {
    // base = 10000*0.1 + (500 * 1 seat * 2) = 1000 + 1000 = 2000
    const r = computeCommission(10000, 0, 0, 0.1, 500, 1, true);
    expect(r.baseCommission).toBe(2000);
    expect(r.payout).toBe(8000);
  });

  it("combines multi-seat and round trip on the fixed fee", () => {
    // fixedTotal = 500 * 2 seats * 2 = 2000; base = 1000 + 2000 = 3000
    const r = computeCommission(10000, 0, 0, 0.1, 500, 2, true);
    expect(r.baseCommission).toBe(3000);
    expect(r.payout).toBe(7000);
  });

  it("includes options commission in the total", () => {
    // base = 10000*0.1 = 1000; optsCom = 750; total = 1750
    const r = computeCommission(10000, 0, 750, 0.1, 0);
    expect(r.optsCom).toBe(750);
    expect(r.totalCommission).toBe(1750);
    expect(r.payout).toBe(8250);
  });

  it("clamps total commission to price so payout never goes negative", () => {
    // base = 1000, optsCom = 50000 → total would be 51000 > price → clamp to 10000
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = computeCommission(10000, 0, 50000, 0.1, 0);
    expect(r.totalCommission).toBe(10000);
    expect(r.payout).toBe(0);
    warn.mockRestore();
  });

  it("handles zero price (everything zero)", () => {
    const r = computeCommission(0, 0, 0, 0.1, 0);
    expect(r).toEqual({ baseCommission: 0, optsCom: 0, totalCommission: 0, payout: 0 });
  });

  it("treats negative price as zero base (degenerate input)", () => {
    // cleanBase = max(0, -100) = 0 → base 0, optsCom 0 → totalCommission 0.
    // Safety floor then fires (0 > -100) and clamps totalCommission to the price,
    // so payout = round(-100 - (-100)) = 0. Negative price is guarded upstream
    // (no_price), so this just documents the clamp's behavior on bad input.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = computeCommission(-100, 0, 0, 0.1, 0);
    expect(r.baseCommission).toBe(0);
    expect(r.totalCommission).toBe(-100);
    expect(r.payout).toBe(0);
    warn.mockRestore();
  });

  it("clamps optionsTotal larger than price to a zero base", () => {
    // cleanBase = max(0, 5000 - 9999) = 0 → base = round(0*0.1 + 0) = 0
    const r = computeCommission(5000, 9999, 0, 0.1, 0);
    expect(r.baseCommission).toBe(0);
    expect(r.payout).toBe(5000);
  });

  it("rounds commission and payout to integers", () => {
    // base = 10005 * 0.1 = 1000.5 → round → 1001; payout = 10005 - 1001 = 9004
    const r = computeCommission(10005, 0, 0, 0.1, 0);
    expect(r.baseCommission).toBe(1001);
    expect(r.payout).toBe(9004);
    expect(Number.isInteger(r.payout)).toBe(true);
  });

  it("defaults passengers to at least 1 when given 0", () => {
    // seats = max(1, 0) = 1 → fixedTotal = 500; base = 1000 + 500 = 1500
    const r = computeCommission(10000, 0, 0, 0.1, 500, 0, false);
    expect(r.baseCommission).toBe(1500);
  });
});
