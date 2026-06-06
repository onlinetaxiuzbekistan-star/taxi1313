import { Router, type IRouter } from "express";
import { db, usersTable, paymentsTable, transactionsTable, driverCardsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { authMiddleware, AuthRequest } from "../middlewares/auth.js";
import {
  atmosBindCardInit,
  atmosBindCardConfirm,
  atmosRemoveCard,
  atmosCreateTransaction,
  atmosPreApply,
  atmosApply,
} from "../lib/atmos.js";
import { validateBody } from "../middlewares/validate.js";
import { depositInitBodySchema, depositConfirmBodySchema } from "../middlewares/request-schemas.js";
import { processTopup, getBalance } from "../lib/services/payments.service.js";

const router: IRouter = Router();

router.get("/cards", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const cards = await db.select({
      id: driverCardsTable.id,
      pan: driverCardsTable.pan,
      expiry: driverCardsTable.expiry,
      cardHolder: driverCardsTable.cardHolder,
      createdAt: driverCardsTable.createdAt,
    }).from(driverCardsTable)
      .where(and(eq(driverCardsTable.driverId, driverId), eq(driverCardsTable.isActive, true)))
      .orderBy(desc(driverCardsTable.createdAt));
    res.json({ cards });
  } catch (err) {
    req.log.error({ err }, "List cards error");
    res.status(500).json({ error: "server_error", message: "Ошибка при загрузке карт" });
  }
});

router.post("/cards/bind-init", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { cardNumber, expiry } = req.body;
    if (!cardNumber || !expiry) {
      res.status(400).json({ error: "validation_error", message: "Введите номер карты и срок действия" });
      return;
    }
    const cleanNumber = cardNumber.replace(/\s/g, "");
    if (cleanNumber.length !== 16) {
      res.status(400).json({ error: "validation_error", message: "Номер карты должен содержать 16 цифр" });
      return;
    }

    const result = await atmosBindCardInit(cleanNumber, expiry);
    res.json({
      transactionId: result.transaction_id,
      phone: result.phone,
    });
  } catch (err: any) {
    req.log.error({ err }, "Card bind init error");
    res.status(400).json({ error: "atmos_error", message: err.message || "Ошибка привязки карты" });
  }
});

router.post("/cards/bind-confirm", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { transactionId, otp } = req.body;
    if (!transactionId || !otp) {
      res.status(400).json({ error: "validation_error", message: "Введите код подтверждения" });
      return;
    }

    const result = await atmosBindCardConfirm(transactionId, otp);
    const cardData = result.data;

    const [card] = await db.insert(driverCardsTable).values({
      driverId,
      cardToken: cardData.card_token,
      cardId: String(cardData.card_id),
      pan: cardData.pan,
      expiry: cardData.expiry,
      cardHolder: cardData.card_holder,
    }).returning();

    req.log.info({ driverId, cardId: cardData.card_id, pan: cardData.pan }, "Card bound");
    res.json({ card: { id: card.id, pan: card.pan, expiry: card.expiry, cardHolder: card.cardHolder } });
  } catch (err: any) {
    req.log.error({ err }, "Card bind confirm error");
    res.status(400).json({ error: "atmos_error", message: err.message || "Ошибка подтверждения" });
  }
});

router.post("/cards/remove", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { cardId } = req.body;
    if (!cardId) {
      res.status(400).json({ error: "validation_error", message: "ID карты не указан" });
      return;
    }

    const [card] = await db.select().from(driverCardsTable)
      .where(and(eq(driverCardsTable.id, cardId), eq(driverCardsTable.driverId, driverId), eq(driverCardsTable.isActive, true)));
    if (!card) {
      res.status(404).json({ error: "not_found", message: "Карта не найдена" });
      return;
    }

    await db.update(driverCardsTable).set({ isActive: false, updatedAt: new Date() })
      .where(eq(driverCardsTable.id, card.id));

    try {
      if (card.cardId) {
        await atmosRemoveCard(card.cardId);
      }
    } catch (e) {
      req.log.warn({ e }, "Atmos remove card failed (card deactivated locally)");
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Card remove error");
    res.status(500).json({ error: "server_error", message: "Ошибка удаления карты" });
  }
});

router.post("/deposit/init", authMiddleware, validateBody(depositInitBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { amount, cardDbId } = req.body;

    if (!amount || amount < 1000) {
      res.status(400).json({ error: "validation_error", message: "Минимальная сумма 1 000 сум" });
      return;
    }
    if (!cardDbId) {
      res.status(400).json({ error: "validation_error", message: "Выберите карту" });
      return;
    }

    const [card] = await db.select().from(driverCardsTable)
      .where(and(eq(driverCardsTable.id, cardDbId), eq(driverCardsTable.driverId, driverId), eq(driverCardsTable.isActive, true)));
    if (!card) {
      res.status(404).json({ error: "not_found", message: "Карта не найдена" });
      return;
    }

    const amountTiyin = Math.round(amount * 100);
    const account = `driver_${driverId}_${Date.now()}`;

    const txResult = await atmosCreateTransaction(amountTiyin, account);
    const atmosTxId = txResult.transaction_id;

    const preApplyResult = await atmosPreApply(atmosTxId, card.cardToken);

    const [payment] = await db.insert(paymentsTable).values({
      driverId,
      amount: String(amount),
      provider: "uzcard",
      status: "pending",
      externalId: String(atmosTxId),
      description: `Пополнение через Atmos: ${Number(amount).toLocaleString("ru-RU")} сум (${card.pan})`,
    }).returning();

    res.json({
      paymentId: payment.id,
      atmosTransactionId: atmosTxId,
      pan: card.pan,
    });
  } catch (err: any) {
    req.log.error({ err }, "Deposit init error");
    res.status(400).json({ error: "atmos_error", message: err.message || "Ошибка создания платежа" });
  }
});

router.post("/deposit/confirm", authMiddleware, validateBody(depositConfirmBodySchema), async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const { paymentId, otp } = req.body;

    if (!paymentId || !otp) {
      res.status(400).json({ error: "validation_error", message: "Введите код подтверждения" });
      return;
    }

    const [payment] = await db.select().from(paymentsTable)
      .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.driverId, driverId)));
    if (!payment) {
      res.status(404).json({ error: "not_found", message: "Платёж не найден" });
      return;
    }
    if (payment.status !== "pending") {
      res.status(400).json({ error: "already_processed", message: "Платёж уже обработан" });
      return;
    }

    const atmosTxId = parseInt(payment.externalId || "0");
    // External (irreversible) gateway charge — must run before the DB transaction (no network in a tx).
    await atmosApply(atmosTxId, otp);

    const amount = parseFloat(payment.amount || "0");

    const result = await processTopup(
      driverId,
      paymentId,
      amount,
      `Пополнение через Atmos: ${Number(amount).toLocaleString("ru-RU")} сум`,
    );

    if (!result.applied) {
      // Another concurrent request already confirmed this payment.
      res.status(400).json({ error: "already_processed", message: "Платёж уже обработан" });
      return;
    }

    req.log.info({ driverId, amount, paymentId }, "Atmos deposit confirmed");

    res.json({
      success: true,
      newBalance: result.balanceAfter,
      message: `Баланс пополнен на ${Number(amount).toLocaleString("ru-RU")} сум`,
    });
  } catch (err: any) {
    req.log.error({ err }, "Deposit confirm error");
    res.status(400).json({ error: "atmos_error", message: err.message || "Ошибка подтверждения платежа" });
  }
});

router.get("/balance", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const balance = await getBalance(req.userId!);
    res.json({ balance });
  } catch (err) {
    req.log.error({ err }, "Get balance error");
    res.status(500).json({ error: "server_error" });
  }
});

router.get("/history", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const driverId = req.userId!;
    const payments = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.driverId, driverId))
      .orderBy(desc(paymentsTable.createdAt))
      .limit(50);
    res.json({ payments, total: payments.length });
  } catch (err) {
    req.log.error({ err }, "Payment history error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

router.get("/transactions", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const isDispatcher = req.userRole === "dispatcher";
    const { type, limit: limitStr } = req.query as { type?: string; limit?: string };
    const queryLimit = Math.min(parseInt(limitStr || "50"), 200);

    const conditions: any[] = [];
    if (!isDispatcher) {
      conditions.push(eq(transactionsTable.driverId, userId));
    }
    if (type && ["income", "commission", "withdraw", "refund", "bonus", "penalty"].includes(type)) {
      conditions.push(eq(transactionsTable.type, type as any));
    }

    let query = db.select({
      id: transactionsTable.id,
      driverId: transactionsTable.driverId,
      type: transactionsTable.type,
      amount: transactionsTable.amount,
      balanceBefore: transactionsTable.balanceBefore,
      balanceAfter: transactionsTable.balanceAfter,
      description: transactionsTable.description,
      rideId: transactionsTable.rideId,
      createdAt: transactionsTable.createdAt,
      userName: usersTable.name,
    })
      .from(transactionsTable)
      .leftJoin(usersTable, eq(transactionsTable.driverId, usersTable.id))
      .$dynamic();

    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions));
    }

    const transactions = await query
      .orderBy(desc(transactionsTable.createdAt))
      .limit(queryLimit);

    res.json({ transactions, total: transactions.length });
  } catch (err) {
    req.log.error({ err }, "Transactions error");
    res.status(500).json({ error: "server_error", message: "Internal server error" });
  }
});

export default router;
