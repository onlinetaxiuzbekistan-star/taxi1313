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

  return {
    cities,
    routes,
    activeRide,
    passengers,
    screen,
    isOnline,
    actionLoading,
    goOnline,
    createRide,
    reload: loadActiveRide,
  };
}
