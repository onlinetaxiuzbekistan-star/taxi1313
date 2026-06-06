// @ts-nocheck
import { describe, it, expect } from "vitest";
import * as S from "./request-schemas.js";

describe("request-schemas", () => {
  describe("loginBodySchema", () => {
    it("accepts a body with phone + password", () => {
      expect(S.loginBodySchema.safeParse({ phone: "+998901234567", password: "x" }).success).toBe(true);
    });
    it("accepts a body with login + password", () => {
      expect(S.loginBodySchema.safeParse({ login: "dispatcher1", password: "x" }).success).toBe(true);
    });
    it("rejects when neither phone nor login is present (refine)", () => {
      expect(S.loginBodySchema.safeParse({ password: "x" }).success).toBe(false);
    });
    it("rejects when password missing", () => {
      expect(S.loginBodySchema.safeParse({ phone: "1" }).success).toBe(false);
    });
  });

  describe("registerBodySchema", () => {
    it("accepts a valid driver registration", () => {
      const r = S.registerBodySchema.safeParse({ phone: "1", name: "A", password: "secret6", role: "driver" });
      expect(r.success).toBe(true);
    });
    it("rejects a short password", () => {
      expect(S.registerBodySchema.safeParse({ phone: "1", name: "A", password: "123", role: "client" }).success).toBe(false);
    });
    it("rejects an unknown role", () => {
      expect(S.registerBodySchema.safeParse({ phone: "1", name: "A", password: "secret6", role: "wizard" }).success).toBe(false);
    });
  });

  describe("createRideBodySchema", () => {
    it("requires fromCity and toCity", () => {
      expect(S.createRideBodySchema.safeParse({ fromCity: "A", toCity: "B" }).success).toBe(true);
      expect(S.createRideBodySchema.safeParse({ fromCity: "A" }).success).toBe(false);
    });
    it("passes through extra fields", () => {
      const r = S.createRideBodySchema.safeParse({ fromCity: "A", toCity: "B", passengers: 3 });
      expect(r.success && (r.data as any).passengers).toBe(3);
    });
  });

  describe("numeric-id schemas accept number or string", () => {
    it("marketplaceSellBodySchema", () => {
      expect(S.marketplaceSellBodySchema.safeParse({ rideId: 1, price: 100 }).success).toBe(true);
      expect(S.marketplaceSellBodySchema.safeParse({ rideId: "1", price: "100" }).success).toBe(true);
    });
    it("districtCreateBodySchema requires name + cityId", () => {
      expect(S.districtCreateBodySchema.safeParse({ name: "D", cityId: "5" }).success).toBe(true);
      expect(S.districtCreateBodySchema.safeParse({ name: "D" }).success).toBe(false);
    });
  });

  describe("auth helper schemas", () => {
    it("emptyBodySchema accepts {} and rejects non-objects", () => {
      expect(S.emptyBodySchema.safeParse({}).success).toBe(true);
      expect(S.emptyBodySchema.safeParse("x").success).toBe(false);
    });
    it("deviceTokenBodySchema requires a non-empty token", () => {
      expect(S.deviceTokenBodySchema.safeParse({ token: "abc" }).success).toBe(true);
      expect(S.deviceTokenBodySchema.safeParse({ token: "" }).success).toBe(false);
      expect(S.deviceTokenBodySchema.safeParse({}).success).toBe(false);
    });
    it("driverCodeVerifyBodySchema requires phone + code", () => {
      expect(S.driverCodeVerifyBodySchema.safeParse({ phone: "1", code: 1234 }).success).toBe(true);
      expect(S.driverCodeVerifyBodySchema.safeParse({ phone: "1" }).success).toBe(false);
    });
    it("pushSubscribeBodySchema requires a subscription object", () => {
      expect(S.pushSubscribeBodySchema.safeParse({ subscription: { endpoint: "e" } }).success).toBe(true);
      expect(S.pushSubscribeBodySchema.safeParse({}).success).toBe(false);
    });
  });

  describe("admin CRUD schemas", () => {
    it("cityCreateBodySchema requires nameRu", () => {
      expect(S.cityCreateBodySchema.safeParse({ nameRu: "Бухара" }).success).toBe(true);
      expect(S.cityCreateBodySchema.safeParse({}).success).toBe(false);
    });
    it("groupChatMessageBodySchema requires a message", () => {
      expect(S.groupChatMessageBodySchema.safeParse({ message: "hi" }).success).toBe(true);
      expect(S.groupChatMessageBodySchema.safeParse({ message: "" }).success).toBe(false);
    });
    it("adminUpdateBodySchema accepts any object (partial PATCH)", () => {
      expect(S.adminUpdateBodySchema.safeParse({ anything: true }).success).toBe(true);
    });
  });
});
