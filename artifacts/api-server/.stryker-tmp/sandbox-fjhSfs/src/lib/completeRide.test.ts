// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared, mutable mock state (hoisted so the vi.mock factory can close over it).
const H = vi.hoisted(() => ({
  state: {
    selects: [] as any[], // FIFO results for top-level db.select(...) awaits
    rideUpdateReturning: [] as any[], // result of tx.update().set().where().returning()
    driverRows: [] as any[], // result of tx.select(...).for("update")
    setCaptures: [] as any[], // captured tx.update().set(arg)
    insertCaptures: [] as any[], // captured tx.insert().values(arg)
    txCount: 0,
  },
}));

const thenable = (val: any) => ({ then: (res: any, rej: any) => Promise.resolve(val).then(res, rej) });

vi.mock("@workspace/db", () => {
  const s = H.state;

  const selectChain = (): any => {
    const b: any = {
      from: () => b,
      where: () => b,
      limit: () => b,
      orderBy: () => b,
      for: () => b,
      then: (res: any, rej: any) =>
        Promise.resolve(s.selects.length ? s.selects.shift() : []).then(res, rej),
    };
    return b;
  };

  const db = {
    select: (_proj?: any) => selectChain(),
    execute: () => Promise.resolve([]),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve(), then: (r: any, j: any) => Promise.resolve().then(r, j) }) }),
    update: () => ({
      set: () => ({ where: () => Object.assign(thenable(undefined), { returning: () => Promise.resolve([]) }) }),
    }),
    transaction: async (cb: any) => {
      s.txCount++;
      const tx = {
        update: () => ({
          set: (arg: any) => {
            s.setCaptures.push(arg);
            return {
              where: () =>
                Object.assign(thenable(undefined), {
                  returning: () => Promise.resolve(s.rideUpdateReturning),
                }),
            };
          },
        }),
        select: (_proj?: any) => ({ from: () => ({ where: () => ({ for: () => Promise.resolve(s.driverRows) }) }) }),
        insert: () => ({ values: (arg: any) => { s.insertCaptures.push(arg); return Promise.resolve(); } }),
      };
      return cb(tx);
    },
  };

  return { db, ridesTable: {}, usersTable: {}, transactionsTable: {}, marketplaceListingsTable: {} };
});

vi.mock("./settingsCache.js", () => ({
  getSettingNum: (key: string, def: number) =>
    key === "commission_percent" ? 10 : key === "commission_fixed" ? 0 : def,
}));
vi.mock("./bonuses.js", () => ({ checkMilestoneBonus: vi.fn(async () => false) }));
vi.mock("./websocket.js", () => ({ broadcastToAll: vi.fn() }));
vi.mock("./revenue-ai-prod.js", () => ({ recordRideCompleted: vi.fn() }));

import { completeRide } from "./completion.js";

const baseRide = {
  id: 1,
  status: "accepted",
  driverId: 7,
  riderPhone: "+998901112233",
  price: 10000,
  optionsTotal: 0,
  optionsCommission: 0,
  passengers: 1,
  roundTrip: false,
};

beforeEach(() => {
  H.state.selects = [];
  H.state.rideUpdateReturning = [];
  H.state.driverRows = [];
  H.state.setCaptures = [];
  H.state.insertCaptures = [];
  H.state.txCount = 0;
});

describe("completeRide", () => {
  it("returns an error when the ride does not exist", async () => {
    H.state.selects = [[]]; // existing lookup → empty
    const r = await completeRide(999);
    expect(r).toEqual({ success: false, error: "Ride not found" });
    expect(H.state.txCount).toBe(0);
  });

  it("is idempotent for an already-completed ride (no double commission)", async () => {
    H.state.selects = [
      [{ ...baseRide, status: "completed" }], // existing
      [], // cascade children lookup → none
    ];
    const r = await completeRide(1);
    expect(r.success).toBe(true);
    expect(H.state.txCount).toBe(0); // no commission transaction
    expect(H.state.insertCaptures).toHaveLength(0); // no ledger rows
  });

  it("fails when the ride has no assigned driver", async () => {
    H.state.selects = [[{ ...baseRide, status: "pending", driverId: null }]];
    const r = await completeRide(1);
    expect(r.success).toBe(false);
    expect(r.error).toBe("no_driver");
    expect(H.state.txCount).toBe(0);
  });

  it("fails when a non-trip ride has no valid price", async () => {
    H.state.selects = [[{ ...baseRide, status: "pending", price: 0 }]];
    const r = await completeRide(1);
    expect(r.success).toBe(false);
    expect(r.error).toBe("no_price");
    expect(H.state.txCount).toBe(0);
  });

  it("does not double-charge when completed concurrently (update returns no row)", async () => {
    H.state.selects = [[{ ...baseRide }]];
    H.state.rideUpdateReturning = []; // status flip matched 0 rows → lost the race
    const r = await completeRide(1);
    expect(r.success).toBe(true);
    expect(H.state.txCount).toBe(1); // transaction was attempted
    expect(H.state.insertCaptures).toHaveLength(0); // but no balance/ledger writes happened
  });

  it("completes atomically: flips status, debits commission, writes ledger rows", async () => {
    H.state.selects = [
      [{ ...baseRide }], // existing
      [], // cascade children
      [], // marketplace listings
    ];
    H.state.rideUpdateReturning = [{ id: 1 }]; // status flip succeeded
    H.state.driverRows = [{ balance: "5000" }];

    const r = await completeRide(1);
    expect(r.success).toBe(true);
    expect(H.state.txCount).toBe(1);

    // ride update carried the computed commission/payout (10% of 10000)
    const rideSet = H.state.setCaptures[0];
    expect(rideSet.commission).toBe(1000);
    expect(rideSet.driverPayout).toBe(9000);
    expect(rideSet.status).toBe("completed");

    // two ledger rows: income (cash to driver) + commission (debit)
    expect(H.state.insertCaptures).toHaveLength(2);
    const income = H.state.insertCaptures.find((t) => t.type === "income");
    const commission = H.state.insertCaptures.find((t) => t.type === "commission");
    expect(income.amount).toBe("9000");
    expect(commission.amount).toBe("1000");
    expect(commission.balanceBefore).toBe("5000");
    expect(commission.balanceAfter).toBe("4000"); // 5000 - 1000 commission
  });
});
