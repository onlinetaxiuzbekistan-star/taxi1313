import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { validateBody } from "./validate.js";

function mockRes() {
  const res = {} as Response & { _status?: number; _json?: unknown };
  res.status = vi.fn((code: number) => {
    (res as any)._status = code;
    return res;
  }) as any;
  res.json = vi.fn((body: unknown) => {
    (res as any)._json = body;
    return res;
  }) as any;
  return res;
}

describe("validateBody", () => {
  const schema = z.object({ name: z.string().min(1) }).passthrough();

  it("calls next() and does not respond when the body is valid", () => {
    const req = { body: { name: "ok", extra: 1 } } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 with field issues and does not call next() when invalid", () => {
    const req = { body: { name: "" } } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res as any)._json;
    expect(payload.error).toBe("validation_error");
    expect(Array.isArray(payload.details)).toBe(true);
    expect(payload.details[0].path).toBe("name");
  });

  it("rejects a non-object body", () => {
    const req = { body: "not-an-object" } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    validateBody(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not mutate/replace req.body on success", () => {
    const body = { name: "keep", extra: "me" };
    const req = { body } as Request;
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    validateBody(schema)(req, res, next);

    expect(req.body).toBe(body);
    expect(req.body.extra).toBe("me");
  });
});
