// @ts-nocheck
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
    password: z.string().min(6, "password must be at least 6 characters"),
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

// ── Marketplace ──
export const marketplaceSellBodySchema = z.object({ rideId: numeric, price: numeric }).passthrough();
export const marketplaceSellOrderBodySchema = z.object({ routeId: numeric, clientPhone: z.string().min(1) }).passthrough();
export const marketplaceBuyBodySchema = z.object({ listingId: numeric }).passthrough();

// ── Chat ──
export const chatJoinBodySchema = z.object({ rideId: numeric }).passthrough();
export const chatSendBodySchema = z.object({ message: z.string().min(1) }).passthrough();

// ── Push notifications (multipart; validated after multer) ──
export const pushSendBodySchema = z.object({ title: z.string().min(1) }).passthrough();

// ── Drivers ──
export const driverStatusBodySchema = z.object({ status: z.string().min(1) }).passthrough();
export const driverLocationBodySchema = z.object({ lat: numeric, lng: numeric }).passthrough();

// ── Auth (remaining mutating routes) ──
// Bodies are validated leniently; identity always comes from the verified JWT,
// never the body. Only fields the handler genuinely requires are enforced.
export const emptyBodySchema = z.object({}).passthrough();
export const pushSubscribeBodySchema = z.object({ subscription: z.object({}).passthrough() }).passthrough();
export const deviceTokenBodySchema = z.object({ token: z.string().min(1) }).passthrough();
export const driverCodeSendSmsBodySchema = z.object({ phone: numeric }).passthrough();
export const driverCodeVerifyBodySchema = z.object({ phone: numeric, code: numeric }).passthrough();
export const driverCodeVerifyCodeOnlyBodySchema = z.object({ code: numeric }).passthrough();

// ── Admin CRUD (cities / districts / branches / tariffs / group-chats) ──
export const cityCreateBodySchema = z.object({ nameRu: z.string().min(1) }).passthrough();
export const districtCreateBodySchema = z.object({ name: z.string().min(1), cityId: numeric }).passthrough();
export const branchCreateBodySchema = z.object({ name: z.string().min(1) }).passthrough();
export const tariffCreateBodySchema = z.object({ carClass: z.string().min(1) }).passthrough();
export const adminUpdateBodySchema = z.object({}).passthrough(); // partial PATCH; field checks stay in handler
export const groupChatCreateBodySchema = z.object({ name: z.string().min(1) }).passthrough();
export const groupChatMembersBodySchema = z.object({ userIds: z.array(z.union([z.number(), z.string()])) }).passthrough();
export const groupChatMessageBodySchema = z.object({ message: z.string().min(1) }).passthrough();
