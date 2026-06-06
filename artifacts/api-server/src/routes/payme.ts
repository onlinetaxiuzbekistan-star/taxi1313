import { errorMessage } from "../lib/errors.js";
import { Router, type IRouter } from "express";
import { clog } from "../lib/logger.js";
import { db, usersTable, paymentsTable, transactionsTable, paymeTransactionsTable, settingsTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { timingSafeEqualStr } from "../lib/secure-compare.js";

const router: IRouter = Router();

const PAYME_TIMEOUT_MS = 43_200_000;

const PaymeError = {
  InvalidAmount:       { code: -31001, message: { ru: "Неверная сумма", uz: "Noto'g'ri summa", en: "Invalid amount" } },
  AccountNotFound:     { code: -31050, message: { ru: "Аккаунт не найден", uz: "Hisob topilmadi", en: "Account not found" } },
  TransactionNotFound: { code: -31003, message: { ru: "Транзакция не найдена", uz: "Tranzaksiya topilmadi", en: "Transaction not found" } },
  CantPerform:         { code: -31008, message: { ru: "Невозможно выполнить", uz: "Bajarib bo'lmaydi", en: "Cannot perform" } },
  CantCancel:          { code: -31007, message: { ru: "Невозможно отменить", uz: "Bekor qilib bo'lmaydi", en: "Cannot cancel" } },
  AuthError:           { code: -32504, message: { ru: "Ошибка авторизации", uz: "Avtorizatsiya xatosi", en: "Authorization error" } },
  MethodNotFound:      { code: -32601, message: { ru: "Метод не найден", uz: "Metod topilmadi", en: "Method not found" } },
};

function jsonRpcError(id: number | null, error: typeof PaymeError[keyof typeof PaymeError], data?: any) {
  return { jsonrpc: "2.0", id, error: { ...error, data } };
}

function jsonRpcResult(id: number | null, result: any) {
  return { jsonrpc: "2.0", id, result };
}

async function getPaymeSettings() {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.category, "payments"));
  const map = new Map(rows.map(r => [r.key, r.value]));
  const minRaw = parseInt(map.get("payme_min_amount") || "100");
  const maxRaw = parseInt(map.get("payme_max_amount") || "1000000000");
  return {
    enabled: map.get("payme_enabled") === "true",
    merchantId: map.get("payme_merchant_id") || "",
    merchantKey: map.get("payme_merchant_key") || "",
    minAmount: Number.isFinite(minRaw) ? minRaw : 100,
    maxAmount: Number.isFinite(maxRaw) ? maxRaw : 1000000000,
  };
}

function authenticatePayme(authHeader: string | undefined, merchantKey: string): boolean {
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;
  if (!merchantKey) return false; // never authenticate against a blank configured key
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
  const [login, key] = decoded.split(":");
  return login === "Paycom" && timingSafeEqualStr(key || "", merchantKey);
}

async function findDriverByPhone(phone: string) {
  const cleaned = phone.replace(/\D/g, "");
  const variants = new Set([cleaned, `+${cleaned}`]);
  if (cleaned.startsWith("998")) {
    variants.add(`+${cleaned}`);
  }
  if (!cleaned.startsWith("998") && cleaned.length === 9) {
    variants.add(`998${cleaned}`);
    variants.add(`+998${cleaned}`);
  }

  for (const v of variants) {
    const [driver] = await db.select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.phone, v))
      .limit(1);
    if (driver && driver.role === "driver") return driver;
  }
  return null;
}

async function handleCheckPerformTransaction(id: number | null, params: any, settings: any) {
  const phone = params?.account?.phone;
  if (!phone) return jsonRpcError(id, PaymeError.AccountNotFound);

  const amount = params?.amount;
  if (!amount || amount < settings.minAmount || amount > settings.maxAmount) {
    return jsonRpcError(id, PaymeError.InvalidAmount);
  }

  const driver = await findDriverByPhone(phone);
  if (!driver) return jsonRpcError(id, PaymeError.AccountNotFound);

  return jsonRpcResult(id, { allow: true });
}

async function handleCreateTransaction(id: number | null, params: any, settings: any) {
  const paymeId = params?.id;
  const time = params?.time;
  const amount = params?.amount;
  const phone = params?.account?.phone;

  if (!phone) return jsonRpcError(id, PaymeError.AccountNotFound);
  if (!amount || amount < settings.minAmount || amount > settings.maxAmount) {
    return jsonRpcError(id, PaymeError.InvalidAmount);
  }

  const [existing] = await db.select().from(paymeTransactionsTable)
    .where(eq(paymeTransactionsTable.paymeId, paymeId)).limit(1);

  if (existing) {
    if (existing.state === 1) {
      if (Date.now() - existing.createTime > PAYME_TIMEOUT_MS) {
        await db.update(paymeTransactionsTable).set({
          state: -1, reason: 4, cancelTime: Date.now(), updatedAt: new Date(),
        }).where(and(eq(paymeTransactionsTable.id, existing.id), eq(paymeTransactionsTable.state, 1)));
        return jsonRpcError(id, PaymeError.CantPerform);
      }
      return jsonRpcResult(id, {
        create_time: existing.createTime,
        transaction: String(existing.id),
        state: existing.state,
      });
    }
    if (existing.state === 2) {
      return jsonRpcResult(id, {
        create_time: existing.createTime,
        transaction: String(existing.id),
        state: existing.state,
      });
    }
    return jsonRpcError(id, PaymeError.CantPerform);
  }

  const driver = await findDriverByPhone(phone);
  if (!driver) return jsonRpcError(id, PaymeError.AccountNotFound);

  const createTime = time || Date.now();
  const [tx] = await db.insert(paymeTransactionsTable).values({
    paymeId,
    driverId: driver.id,
    amount,
    state: 1,
    createTime,
    account: phone,
  }).returning();

  return jsonRpcResult(id, {
    create_time: tx.createTime,
    transaction: String(tx.id),
    state: 1,
  });
}

async function handlePerformTransaction(id: number | null, params: any) {
  const paymeId = params?.id;

  const [tx] = await db.select().from(paymeTransactionsTable)
    .where(eq(paymeTransactionsTable.paymeId, paymeId)).limit(1);

  if (!tx) return jsonRpcError(id, PaymeError.TransactionNotFound);

  if (tx.state === 2) {
    return jsonRpcResult(id, {
      transaction: String(tx.id),
      perform_time: tx.performTime,
      state: 2,
    });
  }

  if (tx.state !== 1) {
    return jsonRpcError(id, PaymeError.CantPerform);
  }

  if (Date.now() - tx.createTime > PAYME_TIMEOUT_MS) {
    await db.update(paymeTransactionsTable).set({
      state: -1, reason: 4, cancelTime: Date.now(), updatedAt: new Date(),
    }).where(and(eq(paymeTransactionsTable.id, tx.id), eq(paymeTransactionsTable.state, 1)));
    return jsonRpcError(id, PaymeError.CantPerform);
  }

  const performTime = Date.now();
  const amountSom = tx.amount / 100;

  const [updated] = await db.update(paymeTransactionsTable).set({
    state: 2, performTime, updatedAt: new Date(),
  }).where(and(eq(paymeTransactionsTable.id, tx.id), eq(paymeTransactionsTable.state, 1))).returning();

  if (!updated) {
    const [recheck] = await db.select().from(paymeTransactionsTable)
      .where(eq(paymeTransactionsTable.paymeId, paymeId)).limit(1);
    if (recheck?.state === 2) {
      return jsonRpcResult(id, {
        transaction: String(recheck.id),
        perform_time: recheck.performTime,
        state: 2,
      });
    }
    return jsonRpcError(id, PaymeError.CantPerform);
  }

  const [driver] = await db.select({ balance: usersTable.balance })
    .from(usersTable).where(eq(usersTable.id, tx.driverId));
  const balBefore = parseFloat(driver?.balance?.toString() || "0");
  const balAfter = balBefore + amountSom;

  await db.insert(transactionsTable).values({
    driverId: tx.driverId,
    type: "income",
    amount: String(amountSom),
    balanceBefore: String(balBefore),
    balanceAfter: String(balAfter),
    description: `Пополнение через Payme: ${amountSom.toLocaleString("ru-RU")} сум (${tx.account})`,
  });

  await db.update(usersTable).set({
    balance: sql`balance + ${amountSom}`,
    updatedAt: new Date(),
  }).where(eq(usersTable.id, tx.driverId));

  await db.insert(paymentsTable).values({
    driverId: tx.driverId,
    amount: String(amountSom),
    provider: "payme",
    status: "success",
    externalId: tx.paymeId,
    description: `Пополнение через Payme: ${amountSom.toLocaleString("ru-RU")} сум`,
  });

  clog.log(`[PAYME] PerformTransaction: driver ${tx.driverId}, +${amountSom} сум, payme_id=${tx.paymeId}`);

  return jsonRpcResult(id, {
    transaction: String(updated.id),
    perform_time: performTime,
    state: 2,
  });
}

async function handleCancelTransaction(id: number | null, params: any) {
  const paymeId = params?.id;
  const reason = params?.reason;

  const [tx] = await db.select().from(paymeTransactionsTable)
    .where(eq(paymeTransactionsTable.paymeId, paymeId)).limit(1);

  if (!tx) return jsonRpcError(id, PaymeError.TransactionNotFound);

  if (tx.state === -1 || tx.state === -2) {
    return jsonRpcResult(id, {
      transaction: String(tx.id),
      cancel_time: tx.cancelTime,
      state: tx.state,
    });
  }

  const cancelTime = Date.now();

  if (tx.state === 1) {
    const [updated] = await db.update(paymeTransactionsTable).set({
      state: -1, reason, cancelTime, updatedAt: new Date(),
    }).where(and(eq(paymeTransactionsTable.id, tx.id), eq(paymeTransactionsTable.state, 1))).returning();

    if (!updated) {
      const [recheck] = await db.select().from(paymeTransactionsTable)
        .where(eq(paymeTransactionsTable.paymeId, paymeId)).limit(1);
      if (recheck && (recheck.state === -1 || recheck.state === -2)) {
        return jsonRpcResult(id, { transaction: String(recheck.id), cancel_time: recheck.cancelTime, state: recheck.state });
      }
      return jsonRpcError(id, PaymeError.CantCancel);
    }

    return jsonRpcResult(id, {
      transaction: String(updated.id),
      cancel_time: cancelTime,
      state: -1,
    });
  }

  if (tx.state === 2) {
    const [updated] = await db.update(paymeTransactionsTable).set({
      state: -2, reason, cancelTime, updatedAt: new Date(),
    }).where(and(eq(paymeTransactionsTable.id, tx.id), eq(paymeTransactionsTable.state, 2))).returning();

    if (!updated) {
      const [recheck] = await db.select().from(paymeTransactionsTable)
        .where(eq(paymeTransactionsTable.paymeId, paymeId)).limit(1);
      if (recheck && (recheck.state === -1 || recheck.state === -2)) {
        return jsonRpcResult(id, { transaction: String(recheck.id), cancel_time: recheck.cancelTime, state: recheck.state });
      }
      return jsonRpcError(id, PaymeError.CantCancel);
    }

    const amountSom = tx.amount / 100;

    const [driver] = await db.select({ balance: usersTable.balance })
      .from(usersTable).where(eq(usersTable.id, tx.driverId));
    const balBefore = parseFloat(driver?.balance?.toString() || "0");
    const balAfter = balBefore - amountSom;

    await db.insert(transactionsTable).values({
      driverId: tx.driverId,
      type: "penalty",
      amount: String(-amountSom),
      balanceBefore: String(balBefore),
      balanceAfter: String(balAfter),
      description: `Отмена Payme: -${amountSom.toLocaleString("ru-RU")} сум`,
    });

    await db.update(usersTable).set({
      balance: sql`balance - ${amountSom}`,
      updatedAt: new Date(),
    }).where(eq(usersTable.id, tx.driverId));

    clog.log(`[PAYME] CancelTransaction (refund): driver ${tx.driverId}, -${amountSom} сум, payme_id=${tx.paymeId}`);

    return jsonRpcResult(id, {
      transaction: String(updated.id),
      cancel_time: cancelTime,
      state: -2,
    });
  }

  return jsonRpcError(id, PaymeError.CantCancel);
}

async function handleCheckTransaction(id: number | null, params: any) {
  const paymeId = params?.id;

  const [tx] = await db.select().from(paymeTransactionsTable)
    .where(eq(paymeTransactionsTable.paymeId, paymeId)).limit(1);

  if (!tx) return jsonRpcError(id, PaymeError.TransactionNotFound);

  return jsonRpcResult(id, {
    create_time: tx.createTime,
    perform_time: tx.performTime || 0,
    cancel_time: tx.cancelTime || 0,
    transaction: String(tx.id),
    state: tx.state,
    reason: tx.reason ?? null,
  });
}

async function handleGetStatement(id: number | null, params: any) {
  const from = params?.from;
  const to = params?.to;

  const txs = await db.select().from(paymeTransactionsTable)
    .where(and(
      gte(paymeTransactionsTable.createTime, from),
      lte(paymeTransactionsTable.createTime, to),
    ))
    .orderBy(paymeTransactionsTable.createTime);

  const transactions = txs.map(tx => ({
    id: tx.paymeId,
    time: tx.createTime,
    amount: tx.amount,
    account: { phone: tx.account },
    create_time: tx.createTime,
    perform_time: tx.performTime || 0,
    cancel_time: tx.cancelTime || 0,
    transaction: String(tx.id),
    state: tx.state,
    reason: tx.reason ?? null,
  }));

  return jsonRpcResult(id, { transactions });
}

router.post("/", async (req, res) => {
  const { method, params, id: rpcId } = req.body || {};

  try {
    const settings = await getPaymeSettings();

    if (!settings.enabled) {
      res.json(jsonRpcError(rpcId, PaymeError.AuthError));
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authenticatePayme(authHeader, settings.merchantKey)) {
      res.json(jsonRpcError(rpcId, PaymeError.AuthError));
      return;
    }

    let result: any;

    switch (method) {
      case "CheckPerformTransaction":
        result = await handleCheckPerformTransaction(rpcId, params, settings);
        break;
      case "CreateTransaction":
        result = await handleCreateTransaction(rpcId, params, settings);
        break;
      case "PerformTransaction":
        result = await handlePerformTransaction(rpcId, params);
        break;
      case "CancelTransaction":
        result = await handleCancelTransaction(rpcId, params);
        break;
      case "CheckTransaction":
        result = await handleCheckTransaction(rpcId, params);
        break;
      case "GetStatement":
        result = await handleGetStatement(rpcId, params);
        break;
      default:
        result = jsonRpcError(rpcId, PaymeError.MethodNotFound);
    }

    res.json(result);
  } catch (err) {
    clog.error("[PAYME] Error:", err);
    res.json(jsonRpcError(rpcId, { code: -32400, message: { ru: "Внутренняя ошибка", uz: "Ichki xato", en: "Internal error" } }));
  }
});

export default router;
