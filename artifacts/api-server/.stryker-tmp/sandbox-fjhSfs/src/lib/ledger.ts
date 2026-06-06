/**
 * Shared driver-balance ledger.
 *
 * Single source of truth for the balance-mutation pattern that was previously
 * hand-rolled across completion.ts, payments.ts, marketplace.ts and others:
 *   1. row-lock the driver (SELECT ... FOR UPDATE) so concurrent writers serialize
 *   2. compute balanceBefore / balanceAfter
 *   3. insert the immutable ledger row in `transactions`
 *   4. update users.balance atomically with a SQL expression
 *
 * All three functions MUST be called inside a db.transaction(...) so the ledger
 * row and the balance update commit (or roll back) together.
 */
// @ts-nocheck

import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// The transaction handle passed to db.transaction(async (tx) => ...).
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LedgerType =
  | "income"
  | "commission"
  | "withdraw"
  | "refund"
  | "bonus"
  | "penalty"
  | "adjust";

export interface LedgerEntry {
  driverId: number;
  amount: number; // positive magnitude; direction is decided by credit/debit
  type: LedgerType;
  description: string;
  rideId?: number | null;
}

export interface LedgerResult {
  balanceBefore: number;
  balanceAfter: number;
}

async function lockBalance(tx: DbTransaction, driverId: number): Promise<number> {
  const [row] = await tx
    .select({ balance: usersTable.balance })
    .from(usersTable)
    .where(eq(usersTable.id, driverId))
    .for("update");
  return parseFloat(row?.balance?.toString() || "0");
}

async function insertRow(
  tx: DbTransaction,
  entry: LedgerEntry,
  balanceBefore: number,
  balanceAfter: number,
): Promise<void> {
  await tx.insert(transactionsTable).values({
    driverId: entry.driverId,
    rideId: entry.rideId ?? null,
    type: entry.type,
    amount: String(entry.amount),
    balanceBefore: String(balanceBefore),
    balanceAfter: String(balanceAfter),
    description: entry.description,
  });
}

/** Increase the driver's balance by entry.amount and write the ledger row. */
export async function credit(tx: DbTransaction, entry: LedgerEntry): Promise<LedgerResult> {
  const balanceBefore = await lockBalance(tx, entry.driverId);
  const balanceAfter = balanceBefore + entry.amount;
  await insertRow(tx, entry, balanceBefore, balanceAfter);
  await tx
    .update(usersTable)
    .set({ balance: sql`balance + ${entry.amount}`, updatedAt: new Date() })
    .where(eq(usersTable.id, entry.driverId));
  return { balanceBefore, balanceAfter };
}

/** Decrease the driver's balance by entry.amount and write the ledger row. */
export async function debit(tx: DbTransaction, entry: LedgerEntry): Promise<LedgerResult> {
  const balanceBefore = await lockBalance(tx, entry.driverId);
  const balanceAfter = balanceBefore - entry.amount;
  await insertRow(tx, entry, balanceBefore, balanceAfter);
  await tx
    .update(usersTable)
    .set({ balance: sql`balance - ${entry.amount}`, updatedAt: new Date() })
    .where(eq(usersTable.id, entry.driverId));
  return { balanceBefore, balanceAfter };
}

/**
 * Informational ledger row that does NOT change the platform balance — e.g. the
 * cash a driver collects directly from the client at ride completion.
 */
export async function record(tx: DbTransaction, entry: LedgerEntry): Promise<LedgerResult> {
  const balance = await lockBalance(tx, entry.driverId);
  await insertRow(tx, entry, balance, balance);
  return { balanceBefore: balance, balanceAfter: balance };
}
