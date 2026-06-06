import { db, usersTable, transactionsTable, paynetTransactionsTable, settingsTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { timingSafeEqualStr } from "./secure-compare.js";

export const PaynetCode = {
  OK: 0,
  InsufficientFundsForCancel: 77,
  ServiceUnavailable: 100,
  SystemError: 102,
  UnknownError: 103,
  AmountAboveMax: 415,
  AmountBelowMin: 416,
  TransactionAlreadyExists: 201,
  TransactionAlreadyCancelled: 202,
  TransactionNotFound: 203,
  ClientNotFound: 302,
  AuthError: -32504,
  MethodNotFound: -32601,
  MissingParams: -32602,
  InternalError: -32603,
  ParseError: -32700,
  InvalidRequest: -32600,
  WrongHttpMethod: -32300,
} as const;

export const PaynetMessages: Record<number, string> = {
  [PaynetCode.OK]: "OK",
  [PaynetCode.InsufficientFundsForCancel]: "Недостаточно средств на счету клиента для отмены платежа",
  [PaynetCode.ServiceUnavailable]: "Услуга временно не поддерживается",
  [PaynetCode.SystemError]: "Системная ошибка",
  [PaynetCode.UnknownError]: "Неизвестная ошибка",
  [PaynetCode.AmountAboveMax]: "Сумма превышает максимальный лимит",
  [PaynetCode.AmountBelowMin]: "Сумма ниже минимального лимита",
  [PaynetCode.TransactionAlreadyExists]: "Транзакция уже существует",
  [PaynetCode.TransactionAlreadyCancelled]: "Транзакция уже отменена",
  [PaynetCode.TransactionNotFound]: "Транзакция не найдена",
  [PaynetCode.ClientNotFound]: "Клиент не найден",
  [PaynetCode.AuthError]: "Ошибка авторизации",
  [PaynetCode.MethodNotFound]: "Метод не найден",
  [PaynetCode.MissingParams]: "Отсутствуют обязательные поля параметров",
  [PaynetCode.InternalError]: "Системная (внутренняя) ошибка",
};

export class PaynetError extends Error {
  code: number;
  constructor(code: number, message?: string) {
    super(message || PaynetMessages[code] || "Error");
    this.code = code;
  }
}

export interface PaynetSettings {
  enabled: boolean;
  username: string;
  password: string;
  serviceId: number;
  minAmountSum: number;
  maxAmountSum: number;
}

export async function getPaynetSettings(): Promise<PaynetSettings> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.category, "payments"));
  const m = new Map(rows.map(r => [r.key, r.value]));
  return {
    enabled: m.get("paynet_enabled") === "true",
    username: m.get("paynet_username") || "",
    password: m.get("paynet_password") || "",
    serviceId: parseInt(m.get("paynet_service_id") || "0") || 0,
    minAmountSum: parseInt(m.get("paynet_min_amount_sum") || "1000") || 1000,
    maxAmountSum: parseInt(m.get("paynet_max_amount_sum") || "500000") || 500000,
  };
}

export function authenticatePaynet(authHeader: string | undefined, s: PaynetSettings): boolean {
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;
  if (!s.username || !s.password) return false;
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);
  return timingSafeEqualStr(u, s.username) && timingSafeEqualStr(p, s.password);
}

function tsNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parsePaynetTimestamp(input: any): Date | null {
  if (!input) return null;
  if (typeof input !== "string") return null;
  const s = input.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})[:\-](\d{2})[:\-](\d{2})/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, da, h, mi, se] = m;
  const d = new Date(`${y}-${mo}-${da}T${h}:${mi}:${se}`);
  return isNaN(d.getTime()) ? null : d;
}

function normalizePhone(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 13 && digits.startsWith("998")) return `+${digits.slice(0, 12)}`;
  return `+${digits}`;
}

function fioOf(u: { firstName: string | null; lastName: string | null; name: string }): string {
  const fn = (u.firstName || "").trim();
  const ln = (u.lastName || "").trim();
  if (fn || ln) return `${ln} ${fn}`.trim();
  return (u.name || "").trim() || "Водитель";
}

async function findDriverByPhone(phone: string) {
  const rows = await db.select({
    id: usersTable.id,
    phone: usersTable.phone,
    name: usersTable.name,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    balance: usersTable.balance,
    role: usersTable.role,
  }).from(usersTable).where(eq(usersTable.phone, phone)).limit(1);
  const u = rows[0];
  if (!u || u.role !== "driver") return null;
  return u;
}


function checkServiceId(params: any, settings: PaynetSettings) {
  const raw = params?.serviceId ?? params?.service_id;
  if (raw === undefined || raw === null || raw === "") return;
  const sid = Number(raw);
  if (!Number.isFinite(sid) || sid !== settings.serviceId) {
    throw new PaynetError(PaynetCode.ClientNotFound, "Услуга не найдена");
  }
}

function tsCheckFormat(d: Date): string {
  // "Tue Dec 30 10:29:03 UZT 2025" — UZT = UTC+5
  const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  // pull components in UZT (UTC+5)
  const ms = d.getTime() + 5*3600*1000;
  const u = new Date(ms);
  const pad = (n:number)=>String(n).padStart(2,"0");
  return `${wd[u.getUTCDay()]} ${mo[u.getUTCMonth()]} ${pad(u.getUTCDate())} ${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}:${pad(u.getUTCSeconds())} UZT ${u.getUTCFullYear()}`;
}

export async function paynetGetInformation(params: any) {
  const settings = await getPaynetSettings();
  checkServiceId(params, settings);
  const fields = params?.fields;
  const clientId = fields?.client_id ?? fields?.clientId;
  if (!clientId) throw new PaynetError(PaynetCode.MissingParams, "client_id is required");
  const phone = normalizePhone(clientId);
  if (!phone) throw new PaynetError(PaynetCode.ClientNotFound);
  const driver = await findDriverByPhone(phone);
  if (!driver) throw new PaynetError(PaynetCode.ClientNotFound);
  const balanceSum = parseFloat(driver.balance ?? "0");
  return {
    status: String(PaynetCode.OK),
    timestamp: tsNow(),
    fields: {
      balance: Number(balanceSum.toFixed(2)),
      name: fioOf(driver),
    },
  };
}

export async function paynetPerformTransaction(params: any) {
  const settings = await getPaynetSettings();
  checkServiceId(params, settings);
  const transactionId = params?.transactionId ?? params?.transaction_id;
  const amountTiyin = Number(params?.amount);
  const fields = params?.fields;
  const clientId = fields?.client_id ?? fields?.clientId;
  const tsStr = params?.timestamp;

  if (!transactionId || !amountTiyin || !clientId) {
    throw new PaynetError(PaynetCode.MissingParams);
  }
  if (!Number.isFinite(amountTiyin) || amountTiyin <= 0) {
    throw new PaynetError(PaynetCode.AmountBelowMin);
  }
  const amountSum = amountTiyin / 100;
  if (amountSum < settings.minAmountSum) throw new PaynetError(PaynetCode.AmountBelowMin);
  if (amountSum > settings.maxAmountSum) throw new PaynetError(PaynetCode.AmountAboveMax);

  const phone = normalizePhone(clientId);
  if (!phone) throw new PaynetError(PaynetCode.ClientNotFound);
  const driver = await findDriverByPhone(phone);
  if (!driver) throw new PaynetError(PaynetCode.ClientNotFound);

  const trnIdStr = String(transactionId);
  const existing = await db.select().from(paynetTransactionsTable)
    .where(eq(paynetTransactionsTable.paynetTransactionId, trnIdStr)).limit(1);
  if (existing.length > 0) {
    throw new PaynetError(PaynetCode.TransactionAlreadyExists);
  }

  const paynetTs = parsePaynetTimestamp(tsStr);

  const result = await db.transaction(async (tx) => {
    const updated = await tx.update(usersTable)
      .set({ balance: sql`COALESCE(${usersTable.balance}, 0) + ${amountSum.toFixed(2)}` })
      .where(eq(usersTable.id, driver.id))
      .returning({ balanceAfter: usersTable.balance });
    const balanceAfter = parseFloat(updated[0]?.balanceAfter ?? "0");
    const balanceBefore = balanceAfter - amountSum;

    await tx.insert(transactionsTable).values({
      driverId: driver.id,
      type: "income",
      amount: amountSum.toFixed(2),
      balanceBefore: balanceBefore.toFixed(2),
      balanceAfter: balanceAfter.toFixed(2),
      description: `Пополнение через Paynet, trnId=${trnIdStr}`,
    });

    let inserted;
    try {
      inserted = await tx.insert(paynetTransactionsTable).values({
        paynetTransactionId: trnIdStr,
        providerTrnId: 0,
        driverId: driver.id,
        phone,
        amountTiyin,
        amountSum: amountSum.toFixed(2),
        status: "created",
        paynetTimestamp: paynetTs,
      }).returning({ id: paynetTransactionsTable.id });
    } catch (e: any) {
      throw new PaynetError(PaynetCode.TransactionAlreadyExists);
    }
    const providerTrnId = inserted[0].id;
    await tx.update(paynetTransactionsTable)
      .set({ providerTrnId })
      .where(eq(paynetTransactionsTable.id, providerTrnId));
    return { providerTrnId };
  });

  return {
    timestamp: tsNow(),
    providerTrnId: result.providerTrnId,
    fields: { client_id: String(driver.id) },
  };
}

export async function paynetCheckTransaction(params: any) {
  const settings = await getPaynetSettings();
  checkServiceId(params, settings);
  const transactionId = params?.transactionId ?? params?.transaction_id;
  if (!transactionId) throw new PaynetError(PaynetCode.MissingParams);
  const rows = await db.select().from(paynetTransactionsTable)
    .where(eq(paynetTransactionsTable.paynetTransactionId, String(transactionId))).limit(1);
  if (rows.length === 0) throw new PaynetError(PaynetCode.TransactionNotFound);
  const t = rows[0];
  return {
    timestamp: tsCheckFormat(t.createdAt ?? new Date()),
    providerTrnId: t.providerTrnId,
    transactionState: t.status === "cancelled" ? -1 : 1,
  };
}

export async function paynetCancelTransaction(params: any) {
  const settings = await getPaynetSettings();
  checkServiceId(params, settings);
  const transactionId = params?.transactionId ?? params?.transaction_id;
  if (!transactionId) throw new PaynetError(PaynetCode.MissingParams);
  const rows = await db.select().from(paynetTransactionsTable)
    .where(eq(paynetTransactionsTable.paynetTransactionId, String(transactionId))).limit(1);
  if (rows.length === 0) throw new PaynetError(PaynetCode.TransactionNotFound);
  const t = rows[0];
  if (t.status === "cancelled") {
    return {
      timestamp: tsNow(),
      providerTrnId: t.providerTrnId,
      transactionState: -1,
      transactionStatus: "cancelled",
    };
  }

  await db.transaction(async (tx) => {
    const drvRows = await tx.select({ balance: usersTable.balance })
      .from(usersTable).where(eq(usersTable.id, t.driverId)).limit(1);
    const balance = parseFloat(drvRows[0]?.balance ?? "0");
    const amountSum = parseFloat(t.amountSum);
    if (balance < amountSum) {
      throw new PaynetError(PaynetCode.InsufficientFundsForCancel);
    }
    const updated = await tx.update(usersTable)
      .set({ balance: sql`${usersTable.balance} - ${amountSum.toFixed(2)}` })
      .where(eq(usersTable.id, t.driverId))
      .returning({ balanceAfter: usersTable.balance });
    const balanceAfter = parseFloat(updated[0]?.balanceAfter ?? "0");
    const balanceBefore = balanceAfter + amountSum;
    await tx.insert(transactionsTable).values({
      driverId: t.driverId,
      type: "refund",
      amount: amountSum.toFixed(2),
      balanceBefore: balanceBefore.toFixed(2),
      balanceAfter: balanceAfter.toFixed(2),
      description: `Отмена Paynet, trnId=${t.paynetTransactionId}`,
    });
    await tx.update(paynetTransactionsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(paynetTransactionsTable.id, t.id));
  });

  return {
    timestamp: tsNow(),
    providerTrnId: t.providerTrnId,
    transactionState: -1,
    transactionStatus: "cancelled",
  };
}

export async function paynetGetStatement(params: any) {
  const settings = await getPaynetSettings();
  checkServiceId(params, settings);
  const fromStr = params?.dateFrom ?? params?.from;
  const toStr = params?.dateTo ?? params?.to;
  const from = parsePaynetTimestamp(fromStr);
  const to = parsePaynetTimestamp(toStr);
  if (!from || !to) throw new PaynetError(PaynetCode.MissingParams, "dateFrom/dateTo required");
  const rows = await db.select().from(paynetTransactionsTable)
    .where(and(
      gte(paynetTransactionsTable.createdAt, from),
      lte(paynetTransactionsTable.createdAt, to),
    ));
  return {
    timestamp: tsNow(),
    statements: rows.map(r => ({
      providerTrnId: r.providerTrnId,
      transactionId: r.paynetTransactionId,
      amount: r.amountTiyin,
      timestamp: r.createdAt?.toISOString().replace("T", " ").slice(0, 19),
    })),
  };
}

export async function paynetChangePassword(params: any) {
  const newPassword = params?.newPassword ?? params?.new_password;
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    throw new PaynetError(PaynetCode.MissingParams, "newPassword min 8 chars");
  }
  await db.update(settingsTable)
    .set({ value: newPassword })
    .where(eq(settingsTable.key, "paynet_password"));
  return { timestamp: tsNow(), status: PaynetCode.OK };
}
