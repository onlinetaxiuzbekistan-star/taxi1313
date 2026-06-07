import { useState, useEffect, useRef, useCallback } from "react";
import { Alert } from "react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { wsEvents } from "@/lib/ws-events";
import type { City, RouteOption, Ride, SeatPassenger, DriverScreen } from "./types";

// Ported/condensed from web useOrderActions + OrdersMain. CP1 scope: cities,
// routes, create-ride, load-active-ride, go-online + screen derivation. The full
// passenger/start/complete action set lands in CP3.
export function useOrders() {
  const { token, user, refreshUser } = useAuth();

  const [cities, setCities] = useState<City[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [passengers, setPassengers] = useState<SeatPassenger[]>([]);
  const [screen, setScreen] = useState<DriverScreen>("loading");
  const [actionLoading, setActionLoading] = useState(false);
  const [passengerActionLoading, setPassengerActionLoading] = useState<number | null>(null);
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
    const cityQ = (user as any)?.city ? `?city=${encodeURIComponent((user as any).city)}` : "";
    fetch(`${API_BASE_URL}/api/routes${cityQ}`)
      .then((r) => r.json())
      .then((d) => setRoutes((d.routes || []).filter((r: any) => r.isActive !== false)))
      .catch(() => {});
    fetch(`${API_BASE_URL}/api/rides/pricing-info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.commission?.percent != null) setCommissionRate(d.commission.percent / 100);
      })
      .catch(() => {});
  }, [token, user]);

  // ---- active ride ----
  const loadActiveRide = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/drivers/my-active-ride`, { headers: headers() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ride) {
        setActiveRide(data.ride);
        setPassengers(data.passengers || []);
      } else {
        setActiveRide(null);
        setPassengers([]);
      }
    } catch {
      // offline / network — keep last state
    }
  }, [token, headers]);

  useEffect(() => {
    if (!token) {
      setScreen("idle");
      return;
    }
    let cancelled = false;
    (async () => {
      await loadActiveRide();
      if (!cancelled) setScreen((s) => (s === "loading" ? "idle" : s));
    })();
    const iv = setInterval(loadActiveRide, 8000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token, loadActiveRide]);

  // Reload on ride-related WS pushes.
  useEffect(() => {
    return wsEvents.on((d) => {
      if (["ride_updated", "new_ride", "ride_completed", "ride_cancelled", "passenger_update"].includes(d.type)) {
        loadActiveRide();
      }
    });
  }, [loadActiveRide]);

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
        Alert.alert("Ошибка", e?.message || e?.error || "Не удалось выйти на линию");
      }
    } catch {
      Alert.alert("Ошибка сети", "Проверьте подключение");
    } finally {
      setActionLoading(false);
    }
  }, [token, headers, refreshUser]);

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
          Alert.alert("Ошибка", data?.message || "Не удалось создать рейс");
        }
      } catch {
        Alert.alert("Ошибка сети", "Проверьте подключение");
      } finally {
        setActionLoading(false);
      }
    },
    [token, headers, refreshUser],
  );

  // ---- ride lifecycle actions ----
  const post = useCallback(
    async (path: string, body?: unknown) => {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}) as any);
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
        refreshUser();
      } else {
        Alert.alert("Ошибка", data?.message || "Не удалось начать поездку");
      }
    } catch {
      Alert.alert("Ошибка сети", "Проверьте подключение");
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
        Alert.alert("Ошибка", data?.message || "Не удалось завершить рейс");
      }
    } catch {
      Alert.alert("Ошибка сети", "Проверьте подключение");
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
        Alert.alert("Ошибка", data?.message || "Не удалось отменить рейс");
      }
    } catch {
      Alert.alert("Ошибка сети", "Проверьте подключение");
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
          Alert.alert("Ошибка", data?.message || "Не удалось подобрать пассажира");
        }
      } catch {
        Alert.alert("Ошибка сети", "Проверьте подключение");
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
          Alert.alert("Ошибка", data?.message || "Не удалось высадить пассажира");
        }
      } catch {
        Alert.alert("Ошибка сети", "Проверьте подключение");
      } finally {
        setPassengerActionLoading(null);
        loadActiveRide();
      }
    },
    [passengerActionLoading, post, refreshUser, loadActiveRide, activeRide, passengers],
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
    activeRide,
    passengers,
    completedRide,
    commissionRate,
    screen,
    isOnline,
    actionLoading,
    passengerActionLoading,
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
