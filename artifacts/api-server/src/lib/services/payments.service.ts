/**
 * Payments service — DB/business logic for driver balances, kept out of the
 * route handlers so routes only do HTTP concerns (auth, validation, gateway IO).
 */
import { db, usersTable, paymentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { credit } from "../ledger.js";

export async function getBalance(driverId: number): Promise<number> {
  const [u] = await db
    .select({ balance: usersTable.balance })
    .from(usersTable)
    .where(eq(usersTable.id, driverId));
  return parseFloat(u?.balance?.toString() || "0");
}

export interface TopupResult {
  applied: boolean;
  balanceAfter?: number;
}

/**
 * Atomic + idempotent top-up: CAS the payment pending→success and credit the
 * driver's balance in one transaction. `applied: false` means a concurrent
 * confirm already processed it (no double credit).
 */
export async function processTopup(
  driverId: number,
  paymentId: number,
  amount: number,
  description: string,
): Promise<TopupResult> {
  return db.transaction(async (tx) => {
    const [marked] = await tx
      .update(paymentsTable)
      .set({ status: "success", updatedAt: new Date() })
      .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.status, "pending")))
      .returning();

    if (!marked) return { applied: false };

    const { balanceAfter } = await credit(tx, { driverId, type: "income", amount, description });
    return { applied: true, balanceAfter };
  });
}
