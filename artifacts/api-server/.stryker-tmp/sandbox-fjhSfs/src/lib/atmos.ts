// @ts-nocheck
import { db, settingsTable } from "@workspace/db";
import { clog } from "./logger.js";
import { eq } from "drizzle-orm";
import { makeBreaker } from "./circuit.js";

const ATMOS_BASE = "https://apigw.atmos.uz";

// retries: 0 — atmosFetch carries payment mutations (createTransaction, etc.);
// blindly retrying could double-charge. The breaker still fails fast when Atmos
// is down. Idempotent reads tolerate the gateway's own retry semantics.
const atmosBreaker = makeBreaker("atmos", { retries: 0 });

let cachedToken: { token: string; expiresAt: number } | null = null;

async function atmosFetch(url: string, init: RequestInit, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const startedAt = Date.now();
  const reqId = Math.random().toString(36).slice(2, 8);
  const safeBody = typeof init.body === "string"
    ? (init.body.length > 500 ? init.body.slice(0, 500) + "...[trunc]" : init.body)
    : init.body ? "[non-string]" : "";
  // eslint-disable-next-line no-console
  clog.log(`[ATMOS-REQ ${reqId}] ${init.method || "GET"} ${url} body=${safeBody}`);
  try {
    const resp = await atmosBreaker.execute(() => fetch(url, { ...init, signal: ctrl.signal }));
    const ms = Date.now() - startedAt;
    const cloned = resp.clone();
    let bodyPreview = "";
    try {
      const txt = await cloned.text();
      bodyPreview = txt.length > 800 ? txt.slice(0, 800) + "...[trunc]" : txt;
    } catch {}
    // eslint-disable-next-line no-console
    clog.log(`[ATMOS-RES ${reqId}] HTTP ${resp.status} (${ms}ms) body=${bodyPreview}`);
    return resp;
  } catch (err: any) {
    const ms = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    clog.error(`[ATMOS-ERR ${reqId}] ${ms}ms name=${err?.name} code=${err?.code} cause=${err?.cause?.code} message=${err?.message}`);
    if (err?.name === "AbortError" || err?.code === "UND_ERR_CONNECT_TIMEOUT" || err?.code === "ECONNREFUSED" || err?.cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
      throw new Error("Платёжная система Atmos временно недоступна. Обратитесь к диспетчеру.");
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function getAtmosSettings(): Promise<{ consumerKey: string; consumerSecret: string; storeId: number; terminalId: number | null }> {
  const rows = await db.select().from(settingsTable)
    .where(eq(settingsTable.category, "payments"));
  const map = new Map(rows.map(r => [r.key, r.value]));
  const consumerKey = map.get("atmos_consumer_key") || "";
  const consumerSecret = map.get("atmos_consumer_secret") || "";
  const storeIdStr = map.get("atmos_store_id") || "";
  const terminalIdStr = map.get("atmos_terminal_id") || "";
  if (!consumerKey || !consumerSecret || !storeIdStr) {
    throw new Error("Atmos not configured: missing consumer_key, consumer_secret or store_id");
  }
  return {
    consumerKey,
    consumerSecret,
    storeId: parseInt(storeIdStr),
    terminalId: terminalIdStr ? parseInt(terminalIdStr) : null,
  };
}

export async function getAtmosToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  const { consumerKey, consumerSecret } = await getAtmosSettings();
  const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const res = await atmosFetch(`${ATMOS_BASE}/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Atmos token error: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

export async function atmosBindCardInit(cardNumber: string, expiry: string) {
  const token = await getAtmosToken();
  const res = await atmosFetch(`${ATMOS_BASE}/partner/bind-card/init`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ card_number: cardNumber, expiry }),
  });
  const data: any = await res.json();
  if (data.result?.code !== "OK") {
    throw new Error(data.result?.description || "Card bind init failed");
  }
  return data as { result: { code: string; description: string }; transaction_id: number; phone: string };
}

export async function atmosBindCardConfirm(transactionId: number, otp: string) {
  const token = await getAtmosToken();
  const res = await atmosFetch(`${ATMOS_BASE}/partner/bind-card/confirm`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ transaction_id: transactionId, otp }),
  });
  const data: any = await res.json();
  if (data.result?.code !== "OK") {
    throw new Error(data.result?.description || "Card bind confirm failed");
  }
  return data as {
    result: { code: string; description: string };
    data: {
      card_id: number;
      pan: string;
      expiry: string;
      card_holder: string;
      balance: number;
      phone: string;
      card_token: string;
    };
    transaction_id: number;
  };
}

export async function atmosRemoveCard(cardId: string) {
  const token = await getAtmosToken();
  const { storeId } = await getAtmosSettings();
  const res = await atmosFetch(`${ATMOS_BASE}/partner/remove-card`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ card_id: parseInt(cardId), store_id: storeId }),
  });
  const data: any = await res.json();
  return data;
}

export async function atmosCreateTransaction(amountTiyin: number, account: string) {
  const token = await getAtmosToken();
  const { storeId, terminalId } = await getAtmosSettings();
  const body: Record<string, any> = {
    amount: amountTiyin,
    account,
    store_id: storeId,
    lang: "ru",
  };
  if (terminalId) body.terminal_id = terminalId;
  const res = await atmosFetch(`${ATMOS_BASE}/merchant/pay/create`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (data.result?.code !== "OK") {
    throw new Error(data.result?.description || "Create transaction failed");
  }
  return data as { result: { code: string }; transaction_id: number; store_transaction: any };
}

export async function atmosPreApply(transactionId: number, cardToken: string) {
  const token = await getAtmosToken();
  const { storeId } = await getAtmosSettings();
  const res = await atmosFetch(`${ATMOS_BASE}/merchant/pay/pre-apply`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      card_token: cardToken,
      store_id: storeId,
      transaction_id: transactionId,
    }),
  });
  const data: any = await res.json();
  if (data.result?.code !== "OK") {
    throw new Error(data.result?.description || "Pre-apply failed");
  }
  return data as { result: { code: string }; transaction_id: number };
}

export async function atmosApply(transactionId: number, otp: string) {
  const token = await getAtmosToken();
  const { storeId } = await getAtmosSettings();
  const res = await atmosFetch(`${ATMOS_BASE}/merchant/pay/apply`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transaction_id: transactionId,
      otp,
      store_id: storeId,
    }),
  });
  const data: any = await res.json();
  if (data.result?.code !== "OK") {
    throw new Error(data.result?.description || "Apply failed");
  }
  return data as { result: { code: string }; store_transaction: any };
}
