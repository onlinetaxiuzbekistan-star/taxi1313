import { useState, useEffect, useRef, useCallback } from "react";
import { Alert } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { wsEvents } from "@/lib/ws-events";
import { playRemoved, playTripStart } from "@/lib/sounds";
import { markUnassigned } from "@/lib/unassigned-guard";
import { setRideActive } from "@/lib/ride-lock";
import { useT } from "@/lib/i18n";
import type { City, RouteOption, Ride, SeatPassenger, DriverScreen } from "./types";

// A route is ENABLED unless explicitly disabled. Tolerant of API shape variance
// (isActive / is_active / active / enabled as bool, 0/1, or "true"/"false").
function isRouteEnabled(r: any): boolean {
  const flag = r?.isActive ?? r?.is_active ?? r?.active ?? r?.enabled;
  if (flag === undefined || flag === null) return true; // absent → treat as active
  return flag !== false && flag !== 0 && flag !== "false" && flag !== "0" && flag !== "f";
}

// Ported/condensed from web useOrderActions + OrdersMain. CP1 scope: cities,
// routes, create-ride, load-active-ride, go-online + screen derivation. The full
// passenger/start/complete action set lands in CP3.
export function useOrders() {
  const { t } = useT();
  const { token, user, refreshUser } = useAuth();

  const [cities, setCities] = useState<City[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const activeRideRef = useRef<Ride | null>(null);
  activeRideRef.current = activeRide;
  const myIdRef = useRef<number | null>(null);
  myIdRef.current = (user as any)?.id ?? null;
  // Lock app-exit while a ride is active (read by the layout's back handler).
  setRideActive(!!activeRide);
  // De-dupes the operator-unassign double event (targeted + broadcastToAll).
  const lastClearedRef = useRef<{ id: number | null; at: number }>({ id: null, at: 0 });
  const [passengers, setPassengers] = useState<SeatPassenger[]>([]);
  const [screen, setScreen] = useState<DriverScreen>("loading");
  const [actionLoading, setActionLoading] = useState(false);
  const [passengerActionLoading, setPassengerActionLoading] = useState<number | null>(null);
  const [clientActionLoading, setClientActionLoading] = useState(false);
  const [sellLoading, setSellLoading] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);
  const [completedRide, setCompletedRide] = useState<Ride | null>(null);
  const [commissionRate, setCommissionRate] = useState(0.15);

  const isOnline = user?.status === "online" || user?.status === "busy";
  const headers = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token],
  );

  // ---- reference data ----
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE_URL}/api/rides/cities`)
      .then((r) => r.json())
      .then((d) => setCities(d.cities || []))
      .catch(() => {});
    // Load ALL routes (same endpoint the dispatcher panel uses) and keep only
    // ENABLED ones (isActive !== false). The destination list is then filtered
    // per-origin in RouteSelectScreen, so disabled routes never appear at all.
    fetch(`${API_BASE_URL}/api/routes`)
      .then((r) => r.json())
      .then((d) => setRoutes((d.routes || []).filter(isRouteEnabled)))
      .catch(() => {});
    fetch(`${API_BASE_URL}/api/rides/pricing-info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.commission?.percent != null) setCommissionRate(d.commission.percent / 100);
      })
      .catch(() => {});
    // Depend on `token` ONLY. Cities/routes/pricing don't change per-user, and
    // `user` is a fresh object on every refresh/status tick — keying on it re-ran
    // these three fetches constantly and helped trip the per-IP rate limit.
  }, [token]);

  // Immediately drop the active ride (dispatcher cancel/unassign/complete). Nulls
  // the ref synchronously too, so the derived screen + exit-guard flip THIS tick.
  const clearActive = useCallback(() => {
    setActiveRide(null);
    activeRideRef.current = null;
    setPassengers([]);
    setScreen((prev) => (prev === "completed" ? prev : "route_select"));
  }, []);

  // Clear + notify ONCE, deduped by rideId within a short window. The operator
  // unassign emits a targeted event AND a broadcast, AND the 5s poll may detect
  // the same disappearance — dedupe so we never double-alert/sound, but ANY of
  // the three paths clears the screen instantly.
  const clearAndNotify = useCallback(
    (rideId: number | null, title: string, sub: string) => {
      const lc = lastClearedRef.current;
      if (rideId != null && lc.id === rideId && Date.now() - lc.at < 5000) return;
      lastClearedRef.current = { id: rideId ?? null, at: Date.now() };
      markUnassigned(rideId); // suppress same-ride re-offers on this device for 2 min
      clearActive();
      playRemoved();
      Alert.alert(title, sub);
    },
    [clearActive],
  );

  // ---- active ride ----
  // When the server returns 429, hold off until this timestamp (the poll widens
  // its interval accordingly) so we don't keep hammering a rate-limited endpoint.
  const rateLimitedUntilRef = useRef(0);
  const loadActiveRide = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/my-active-ride`, { headers: headers() });
      if (res.status === 429) {
        const ra = Number(res.headers.get("Retry-After")) || 30;
        rateLimitedUntilRef.current = Date.now() + Math.min(120, Math.max(15, ra)) * 1000;
        return; // keep last state; do NOT treat as "no ride"
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.ride) {
        setActiveRide(data.ride);
        setPassengers(data.passengers || []);
      } else if (activeRideRef.current) {
        // Server says this driver has NO active ride, but we were showing one →
        // it was cancelled / unassigned / reassigned. Force-clear INSTANTLY here —
        // do NOT wait for the WS event (it may have been missed while the app was
        // backgrounded or the socket was reconnecting). This poll is the safety net.
        clearAndNotify(activeRideRef.current.id ?? null, t("order_removed"), t("order_removed_sub"));
      } else {
        setActiveRide(null);
        setPassengers([]);
      }
    } catch {
      // offline / network — keep last state
    }
  }, [token, headers, clearAndNotify, t]);

  useEffect(() => {
    if (!token) {
      setScreen("idle");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Adaptive cadence: poll fast (5s) ONLY while a ride is active, so a
    // dispatcher cancel/unassign still clears within ~5s. When idle there is
    // nothing to clear, so poll slowly (15s) — this slashes baseline request
    // volume and keeps well under the per-IP rate limit. After a 429, wait out
    // the back-off window before the next call.
    const nextDelay = () => {
      const base = activeRideRef.current ? 5000 : 15000;
      const wait = rateLimitedUntilRef.current - Date.now();
      return wait > 0 ? Math.max(base, wait) : base;
    };
    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        await loadActiveRide();
        schedule();
      }, nextDelay());
    };

    (async () => {
      await loadActiveRide();
      if (cancelled) return;
      setScreen((s) => (s === "loading" ? "idle" : s));
      schedule();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, loadActiveRide]);

  // React to ride WS pushes — mirrors web orders/hooks/useRideWebSocket so
  // dispatcher cancellation/unassignment/completion clears the ride in real time
  // (not just via the 8s poll). broadcastToAll reaches this driver's socket.
  useEffect(() => {
    return wsEvents.on((d) => {
      const activeId = activeRideRef.current?.id;
      const eventRideId = (d as any).rideId ?? (d as any).ride?.id;
      const isCurrent = eventRideId != null && eventRideId === activeId;
      const ride = (d as any).ride;
      if (["ride_unassigned_by_dispatcher", "ride_updated", "trip_updated", "new_ride", "trip_completed", "ride_completed"].includes(d.type)) {
        console.log("[WS]", d.type, { eventRideId, activeId, isCurrent, rideDriverId: ride?.driverId, rideStatus: ride?.status });
      }

      // (clearAndNotify is defined at hook scope above — shared with the 5s poll
      // so either path clears the screen, deduped by rideId.)

      // Operator pulled the order back to the efir (targeted event).
      if (d.type === "ride_unassigned_by_dispatcher") {
        if (eventRideId == null || activeId == null || isCurrent) {
          clearAndNotify(eventRideId, t("order_removed"), (d as any).message || t("order_removed_sub"));
        }
        loadActiveRide();
        return;
      }
      if (d.type === "trip_completed" || d.type === "ride_completed") {
        if (isCurrent || activeId == null) clearActive();
        loadActiveRide();
        return;
      }
      if (d.type === "ride_updated" || d.type === "trip_updated" || d.type === "new_ride") {
        if (isCurrent && ride) {
          const myId = myIdRef.current;
          // Dispatcher full-cancel → status "cancelled". Operator unassign /
          // reassign → driverId becomes null (or a different driver). Either way
          // the ride is no longer THIS driver's → clear. Guard on driverId only,
          // never on status:"pending" (the driver's OWN created ride is
          // accepted/pending with driverId:me and must NOT be cleared).
          const noLongerMine =
            ride.driverId == null || (myId != null && ride.driverId != null && ride.driverId !== myId);
          if (ride.status === "cancelled") {
            clearAndNotify(eventRideId, t("order_cancelled"), t("order_cancelled_sub"));
            return;
          }
          if (noLongerMine) {
            clearAndNotify(eventRideId, t("order_removed"), t("order_removed_sub"));
            return;
          }
        }
        loadActiveRide();
        return;
      }
      // Passenger-level changes (operator added/removed/reassigned a seat client,
      // queue shuffle, route edit). Re-fetch so a passenger the operator pulled
      // back disappears from the seat map immediately, not just on the next poll.
      if (
        [
          "route_updated",
          "passenger_update",
          "passenger_updated",
          "passenger_seat_changed",
          "passenger_removed",
          "passenger_cancelled",
          "passenger_deleted",
          "passenger_unassigned",
          "seat_cleared",
          "seat_updated",
          "ride_passenger_removed",
          "ride_passengers_updated",
          "order_updated",
          "queue_update",
          "queue_updated",
          "new_order",
        ].includes(d.type)
      ) {
        loadActiveRide();
      }
    });
  }, [loadActiveRide, clearActive, clearAndNotify]);

  // ---- screen derivation (mirrors OrdersMain) ----
  useEffect(() => {
    setScreen((prev) => {
      if (prev === "loading") return prev; // wait for first active-ride load
      if (prev === "completed") return prev; // hold until the driver dismisses it
      if (activeRide) return activeRide.status === "in_progress" ? "active" : "seat_view";
      if (!isOnline) return "idle";
      return "route_select";
    });
  }, [isOnline, activeRide]);

  // ---- actions ----
  const goOnline = useCallback(async () => {
    if (!token) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/status`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status: "online" }),
      });
      if (res.ok) refreshUser();
      else {
        const e = await res.json().catch(() => ({}) as any);
        Alert.alert(t("err"), e?.message || e?.error || t("err"));
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setActionLoading(false);
    }
  }, [token, headers, refreshUser, t]);

  const createRide = useCallback(
    async (fromCity: string, toCity: string, departureTime: string, urgent = false, timeSlot?: string) => {
      if (!token) return;
      setActionLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/drivers/create-ride`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ fromCity, toCity, departureTime, urgent, timeSlot }),
        });
        const data = await res.json().catch(() => ({}) as any);
        if (res.ok && data?.id) {
          setActiveRide(data);
          setPassengers([]);
          setScreen("seat_view");
          refreshUser();
        } else {
          Alert.alert(t("err"), data?.message || t("rs_create_failed"));
        }
      } catch {
        Alert.alert(t("err_network"), t("err_network_sub"));
      } finally {
        setActionLoading(false);
      }
    },
    [token, headers, refreshUser, t],
  );

  // ---- ride lifecycle actions ----
  const post = useCallback(
    async (path: string, body?: unknown) => {
      // ALWAYS send a valid JSON body. RN/OkHttp sends an empty stream when body
      // is undefined, and with Content-Type: application/json that makes Express's
      // JSON parser throw a non-JSON 400 (browsers send Content-Length:0 and avoid
      // this). Body-less actions (pickup/dropoff) therefore POST "{}".
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body ?? {}),
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      console.log("[ACTION]", path, "->", res.status, res.ok ? "ok" : text.slice(0, 200));
      return { ok: res.ok, data };
    },
    [headers],
  );

  const startRide = useCallback(async () => {
    if (!activeRide || actionLoading) return;
    setActionLoading(true);
    try {
      const { ok, data } = await post("/api/drivers/start", { rideId: activeRide.id });
      if (ok) {
        setActiveRide((r) => (r ? { ...r, status: "in_progress" } : r));
        setScreen("active");
        playTripStart(); // taxometer / trip-start cue
        refreshUser();
      } else {
        Alert.alert(t("err"), data?.message || t("err"));
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setActionLoading(false);
    }
  }, [activeRide, actionLoading, post, refreshUser]);

  const completeRide = useCallback(async () => {
    if (!activeRide || actionLoading) return;
    setActionLoading(true);
    try {
      const { ok, data } = await post("/api/drivers/complete", { rideId: activeRide.id });
      if (ok) {
        setCompletedRide({ ...activeRide, seatPassengers: passengers });
        setActiveRide(null);
        setPassengers([]);
        setScreen("completed");
        refreshUser();
      } else {
        Alert.alert(t("err"), data?.message || t("err"));
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setActionLoading(false);
    }
  }, [activeRide, passengers, actionLoading, post, refreshUser]);

  const cancelRide = useCallback(async () => {
    if (!activeRide || actionLoading) return;
    setActionLoading(true);
    try {
      const { ok, data } = await post("/api/drivers/cancel", { rideId: activeRide.id });
      if (ok) {
        setActiveRide(null);
        setPassengers([]);
        setScreen("route_select");
        refreshUser();
      } else {
        Alert.alert(t("err"), data?.message || t("err"));
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setActionLoading(false);
    }
  }, [activeRide, actionLoading, post, refreshUser]);

  const passengerPickup = useCallback(
    async (id: number) => {
      if (passengerActionLoading) return;
      setPassengerActionLoading(id);
      try {
        const { ok, data } = await post(`/api/drivers/passenger/${id}/pickup`);
        if (ok) {
          setPassengers((prev) => prev.map((p) => (p.id === id ? { ...p, status: "picked_up" } : p)));
        } else {
          Alert.alert(t("err"), data?.message || t("err"));
        }
      } catch {
        Alert.alert(t("err_network"), t("err_network_sub"));
      } finally {
        setPassengerActionLoading(null);
        loadActiveRide();
      }
    },
    [passengerActionLoading, post, loadActiveRide],
  );

  const passengerDropoff = useCallback(
    async (id: number) => {
      if (passengerActionLoading) return;
      setPassengerActionLoading(id);
      try {
        const { ok, data } = await post(`/api/drivers/passenger/${id}/dropoff`);
        if (ok) {
          const updated = passengers.map((p) => (p.id === id ? { ...p, status: "dropped_off" } : p));
          setPassengers(updated);
          if (data?.autoCompleted) {
            if (activeRide) setCompletedRide({ ...activeRide, seatPassengers: updated });
            setActiveRide(null);
            setPassengers([]);
            setScreen("completed");
            refreshUser();
          }
        } else {
          Alert.alert(t("err"), data?.message || t("err"));
        }
      } catch {
        Alert.alert(t("err_network"), t("err_network_sub"));
      } finally {
        setPassengerActionLoading(null);
        loadActiveRide();
      }
    },
    [passengerActionLoading, post, refreshUser, loadActiveRide, activeRide, passengers],
  );

  // Manually book a seat with a driver-entered client (web handleManualClient).
  const manualClient = useCallback(
    async (seatNumber: number, gender: string, phone: string) => {
      if (!activeRide || clientActionLoading) return;
      setClientActionLoading(true);
      try {
        const { ok, data } = await post("/api/drivers/manual-client", {
          orderId: activeRide.id,
          seatNumber,
          gender,
          phone: phone || undefined,
        });
        if (ok) await loadActiveRide();
        else Alert.alert(t("err"), data?.message || t("err"));
      } catch {
        Alert.alert(t("err_network"), t("err_network_sub"));
      } finally {
        setClientActionLoading(false);
      }
    },
    [activeRide, clientActionLoading, post, loadActiveRide],
  );

  // Remove a (manually-added) client from a seat (web handlePassengerReject).
  const rejectPassenger = useCallback(
    async (id: number) => {
      if (passengerActionLoading) return;
      setPassengerActionLoading(id);
      try {
        const { ok, data } = await post(`/api/drivers/passenger/${id}/reject`);
        if (ok) {
          setPassengers((prev) => prev.filter((p) => p.id !== id));
          loadActiveRide();
        } else {
          Alert.alert(t("err"), data?.message || t("err"));
        }
      } catch {
        Alert.alert(t("err_network"), t("err_network_sub"));
      } finally {
        setPassengerActionLoading(null);
      }
    },
    [passengerActionLoading, post, loadActiveRide],
  );

  // Create a standalone order and sell it to the operator (efir). Mirrors the
  // web Marketplace sell form → POST /api/marketplace/sell-order. The created
  // ride has driverId:null and is auto-dispatched, so it NEVER occupies the
  // seller's screen.
  const createSellOrder = useCallback(
    async (params: {
      routeId: number;
      clientPhone: string;
      seatsCount: number[];
      price: number;
      comment?: string;
      genders?: (string | null)[];
    }): Promise<boolean> => {
      if (sellLoading) return false;
      setSellLoading(true);
      setSellError(null);
      // Phone is optional in the UI; the backend still needs one, so fall back to
      // the driver's own number (buyer can reach the seller) when left blank.
      const phone = (params.clientPhone || "").replace(/\s/g, "");
      const clientPhone = phone.replace(/\D/g, "").length >= 9 ? phone : ((user as any)?.phone || phone);
      const body = {
        routeId: params.routeId,
        fromDistrictId: null,
        toDistrictId: null,
        scheduledAt: new Date().toISOString(),
        clientPhone,
        seatsCount: params.seatsCount,
        baggageType: null,
        price: params.price,
        comment: params.comment || null,
        genders: params.genders ?? params.seatsCount.map(() => "male"),
      };
      console.log("[SELL] POST /api/marketplace/sell-order", body);
      try {
        const { ok, data } = await post("/api/marketplace/sell-order", body);
        console.log("[SELL] result", { ok, data });
        if (ok) {
          refreshUser();
          return true;
        }
        setSellError(
          data?.message || (data?.minPrice ? `${t("sell_min")}: ${data.minPrice}` : t("sell_failed")),
        );
        return false;
      } catch (e) {
        console.log("[SELL] network error", String(e));
        setSellError(`${t("err_network")}. ${t("err_network_sub")}`);
        return false;
      } finally {
        setSellLoading(false);
      }
    },
    [sellLoading, post, refreshUser, t],
  );

  const handleCompletionClose = useCallback(() => {
    setCompletedRide(null);
    setScreen("route_select");
    loadActiveRide();
  }, [loadActiveRide]);

  const batchPickup = useCallback(
    async (ids: number[]) => {
      for (const id of ids) await passengerPickup(id);
    },
    [passengerPickup],
  );
  const batchDropoff = useCallback(
    async (ids: number[]) => {
      for (const id of ids) await passengerDropoff(id);
    },
    [passengerDropoff],
  );

  return {
    cities,
    routes,
    userCity: (user as any)?.city ?? null,
    activeRide,
    passengers,
    completedRide,
    commissionRate,
    screen,
    isOnline,
    actionLoading,
    passengerActionLoading,
    clientActionLoading,
    manualClient,
    rejectPassenger,
    sellLoading,
    sellError,
    clearSellError: () => setSellError(null),
    createSellOrder,
    goOnline,
    createRide,
    startRide,
    completeRide,
    cancelRide,
    passengerPickup,
    passengerDropoff,
    batchPickup,
    batchDropoff,
    handleCompletionClose,
    reload: loadActiveRide,
  };
}
