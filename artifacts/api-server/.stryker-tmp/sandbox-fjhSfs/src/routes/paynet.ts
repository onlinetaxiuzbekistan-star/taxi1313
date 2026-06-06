// @ts-nocheck
import { Router, type IRouter, type Request, type Response } from "express";
import {
  PaynetCode,
  PaynetMessages,
  PaynetError,
  getPaynetSettings,
  authenticatePaynet,
  paynetGetInformation,
  paynetPerformTransaction,
  paynetCheckTransaction,
  paynetCancelTransaction,
  paynetGetStatement,
  paynetChangePassword,
} from "../lib/paynet.js";
import { validateBody } from "../middlewares/validate.js";
import { z } from "zod";

const router: IRouter = Router();

// Paynet posts JSON-RPC 2.0 envelopes. Validate the shape leniently (a JSON
// object with a string `method`); per-method validation and JSON-RPC error
// replies remain in the handler so the gateway contract is preserved.
const paynetRpcBodySchema = z.object({ method: z.string().min(1) }).passthrough();

function rpcResult(id: any, result: any) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: any, code: number, message?: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message: message || PaynetMessages[code] || "Error" } };
}

router.post("/jsonrpc", validateBody(paynetRpcBodySchema), async (req: Request, res: Response) => {
  const settings = await getPaynetSettings().catch(() => null);

  if (!settings || !settings.enabled) {
    return res.status(200).json(rpcError(null, PaynetCode.ServiceUnavailable));
  }

  if (!authenticatePaynet(req.headers.authorization, settings)) {
    res.set("WWW-Authenticate", 'Basic realm="paynet"');
    return res.status(401).json(rpcError(null, PaynetCode.AuthError));
  }

  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(200).json(rpcError(null, PaynetCode.ParseError));
  }
  const { id, method, params } = body;
  if (!method || typeof method !== "string") {
    return res.status(200).json(rpcError(id, PaynetCode.InvalidRequest, "method is required"));
  }

  try {
    let result: any;
    switch (method) {
      case "GetInformation":
        result = await paynetGetInformation(params);
        break;
      case "PerformTransaction":
        result = await paynetPerformTransaction(params);
        break;
      case "CheckTransaction":
        result = await paynetCheckTransaction(params);
        break;
      case "CancelTransaction":
        result = await paynetCancelTransaction(params);
        break;
      case "GetStatement":
        result = await paynetGetStatement(params);
        break;
      case "ChangePassword":
        result = await paynetChangePassword(params);
        break;
      default:
        return res.status(200).json(rpcError(id, PaynetCode.MethodNotFound));
    }
    res.status(200).json(rpcResult(id, result));
  } catch (err: any) {
    if (err instanceof PaynetError) {
      return res.status(200).json(rpcError(id, err.code, err.message));
    }
    (req as any).log?.error({ err }, "Paynet handler error");
    return res.status(200).json(rpcError(id, PaynetCode.InternalError, err?.message || "internal error"));
  }
});

router.all("/jsonrpc", (_req, res) => {
  res.status(200).json(rpcError(null, PaynetCode.WrongHttpMethod, "Only POST is allowed"));
});

export default router;
