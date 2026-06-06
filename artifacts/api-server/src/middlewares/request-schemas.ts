import { z } from "zod";

/**
 * Route-accurate request schemas.
 *
 * NOTE: @workspace/api-zod ships generated schemas (LoginUserBody, RegisterUserBody,
 * CreateRideBody, ...) but they diverge from the live API — e.g. register accepts
 * role "client" (the generated enum is rider/driver/dispatcher), login accepts
 * `login` OR `phone`, and create-ride only hard-requires fromCity/toCity. Applying
 * the generated schemas verbatim would reject valid traffic, so these mirror what
 * the handlers actually require. They are deliberately lenient (.passthrough(),
 * minimal required fields) to add a safety net without breaking existing clients.
 */

const numeric = z.union([z.number(), z.string()]);

export const loginBodySchema = z
  .object({
    phone: z.string().optional(),
    login: z.string().optional(),
    password: z.string().min(1),
    deviceId: z.string().optional(),
    deviceName: z.string().optional(),
  })
  .passthrough()
  .refine((b) => Boolean(b.phone || b.login), {
    message: "phone or login is required",
  });

export const registerBodySchema = z
  .object({
    phone: z.string().min(1),
    name: z.string().min(1),
    password: z.string().min(1),
    role: z.enum(["driver", "client"]),
    carModel: z.string().optional(),
    carNumber: z.string().optional(),
    carClass: z.string().optional(),
    referralCode: z.string().optional(),
  })
  .passthrough();

export const createRideBodySchema = z
  .object({
    fromCity: z.string().min(1),
    toCity: z.string().min(1),
  })
  .passthrough();

// PATCH is a partial update — validate that the body is an object; field-level
// checks stay in the handler.
export const updateRideBodySchema = z.object({}).passthrough();

export const createStaffBodySchema = z
  .object({
    name: z.string().min(1),
    password: z.string().min(1),
    role: z.enum(["dispatcher", "admin"]),
  })
  .passthrough();

export const updateStaffBodySchema = z.object({}).passthrough();

export const depositInitBodySchema = z
  .object({
    amount: numeric,
    cardDbId: numeric,
  })
  .passthrough();

export const depositConfirmBodySchema = z
  .object({
    paymentId: numeric,
    otp: z.union([z.string(), z.number()]),
  })
  .passthrough();
