import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getCached, setCached } from "@/lib/api-cache";
import { X, AlertTriangle } from "lucide-react";

import type { DriverScreen, Ride, SeatPassenger, TripStop, PickupRouteData } from "./types";
import { BASE_URL } from "./constants";
import { useDriverGPS } from "./hooks/useDriverGPS";
import { useWakeLock } from "./hooks/useWakeLock";
import { useRideWebSocket } from "./hooks/useRideWebSocket";
import { useOrderActions } from "./hooks/useOrderActions";
import { RideStateRouter } from "./components/RideStateRouter";

export default function Orders() {
  const { token, user } = useAuth();
  const [screen, setScreen] = useState<DriverScreen>("loading" as any);
  useEffect(() => { console.log("[SCREEN-DBG]", screen); }, [screen]);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [activePassengers, setActivePassengers] = useState<SeatPassenger[]>([]);
  const [completedRide, setCompletedRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const completedAtRef = useRef(0);
  const [pickupRoute, setPickupRoute] = useState<PickupRouteData | null>(null);
  const [tripStops, setTripStops] = useState<TripStop[]>([]);
  const [commissionRate, setCommissionRate] = useState(0.15);
  const abortRef = useRef<AbortController | null>(null);
  const isProcessingRef = useRef(false);
  const pendingResyncRef = useRef(false);
  const stateVersionRef = useRef(0);
  const routeRebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOnline = user?.status === "online" || user?.status === "busy";
  const isRideActive = screen === "pickup" || screen === "active";
  const driverGPS = useDriverGPS(token, user?.id, isRideActive || screen === "seat_view");
  useWakeLock(isRideActive);

  const activeRideRef = useRef<Ride | null>(null);
  activeRideRef.current = activeRide;
  const activePassengersRef = useRef<SeatPassenger[]>([]);
  activePassengersRef.current = activePassengers;
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const headersRef = useRef<Record<string, string>>({});
  headersRef.current = { "Content-Type": "application/json" };
  if (token) headersRef.current.Authorization = `Bearer ${token}`;

  const actionRefs = {
    activeRideRef, isOnlineRef, isProcessingRef, pendingResyncRef,
    completedAtRef, stateVersionRef, headersRef, abortRef, routeRebuildTimer,
    activePassengersRef,
    fullResyncRef: useRef(async () => {}),
  };

  const actionSetters = {
    setScreen, setActiveRide, setActivePassengers,
    setTripStops, setPickupRoute, setCompletedRide, setLoading,
  };

  const actions = useOrderActions(actionRefs, actionSetters);

  const fetchPickupRoute = useCallback(async () => {
    if (!token || !activeRideRef.current || actions.isCompletingRef.current || isProcessingRef.current) return;
    const gps = driverGPS.posRef.current;
    const ride = activeRideRef.current;
    const lat = gps?.lat ?? ride?.fromLat;
    const lng = gps?.lng ?? ride?.fromLng;
    if (!lat || !lng) return;
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/pickup-route?lat=${lat}&lng=${lng}`, {
        headers: headersRef.current, signal: abortRef.current?.signal,
      });
      if (!activeRideRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (!activeRideRef.current) return;
        setPickupRoute(data.stops?.length > 0 ? data : null);
      }
    } catch {}
  }, [token, driverGPS.posRef, activeRide]);

  const fetchTripStops = useCallback(async () => {
    if (!token || !activeRideRef.current || actions.isCompletingRef.current || isProcessingRef.current) return;
    const gps = driverGPS.posRef.current;
    const ride = activeRideRef.current;
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/trip-stops?lat=${gps?.lat ?? ride.fromLat ?? 0}&lng=${gps?.lng ?? ride.fromLng ?? 0}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: abortRef.current?.signal,
      });
      if (!activeRideRef.current) return;
      if (res.ok) {
        const data = await res.json();
        if (!activeRideRef.current) return;
        setTripStops(data.stops || []);
        if (data.passengers) setActivePassengers(data.passengers);
      }
    } catch {}
  }, [token, activeRide?.id, driverGPS.posRef]);

  const loadActiveRideRef = useRef(actions.loadActiveRide);
  loadActiveRideRef.current = actions.loadActiveRide;
  const fetchPickupRouteRef = useRef(fetchPickupRoute);
  fetchPickupRouteRef.current = fetchPickupRoute;
  const fetchTripStopsRef = useRef(fetchTripStops);
  fetchTripStopsRef.current = fetchTripStops;

  const fullResync = useCallback(async () => {
    if (!token || actions.isCompletingRef.current) return;
    await loadActiveRideRef.current();
    if (!activeRideRef.current) return;
    fetchTripStopsRef.current();
    fetchPickupRouteRef.current();
  }, [token]);
  const fullResyncRef = useRef(fullResync);
  fullResyncRef.current = fullResync;
  actionRefs.fullResyncRef.current = fullResync;
  const lastResyncTsRef = useRef(0);

  useRideWebSocket(
    { activeRideRef, isOnlineRef, isProcessingRef, pendingResyncRef, completedAtRef, stateVersionRef, fullResyncRef, loadActiveRideRef },
    { setScreen, setActiveRide, setActivePassengers, setTripStops, setPickupRoute },
  );

  useEffect(() => {
    const cachedPricing = getCached<any>("pricing_info");
    if (cachedPricing?.commission?.percent != null) setCommissionRate(cachedPricing.commission.percent / 100);
    fetch(`${BASE_URL}/api/rides/pricing-info`).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.commission?.percent != null) { setCommissionRate(d.commission.percent / 100); setCached("pricing_info", d, 30 * 60 * 1000); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const cachedCities = getCached<any>("cities");
    if (cachedCities?.cities) actions.setCities(cachedCities.cities);
    const cachedRoutes = getCached<any>("routes");
    if (cachedRoutes?.routes) {
      const routes = cachedRoutes.routes.filter((r: any) => r.isActive !== false);
      actions.setAvailableRoutes(routes.map((r: any) => ({ fromCity: r.fromCity, toCity: r.toCity })));
    }
    fetch(`${BASE_URL}/api/rides/cities`).then(r => r.json()).then(d => { actions.setCities(d.cities || []); setCached("cities", d, 60 * 60 * 1000); }).catch(() => {});
    fetch(`${BASE_URL}/api/routes${(user as any)?.city ? `?city=${encodeURIComponent((user as any).city)}` : ""}`).then(r => r.json()).then(d => {
      setCached("routes", d, 60 * 60 * 1000);
      const routes = (d.routes || []).filter((r: any) => r.isActive !== false);
      actions.setAvailableRoutes(routes.map((r: any) => ({ fromCity: r.fromCity, toCity: r.toCity })));
    }).catch(() => {});
  }, [token]);

  useEffect(() => { actions.loadMarketListings(); }, [actions.loadMarketListings]);
  useEffect(() => { const iv = setInterval(actions.loadMarketListings, 15000); return () => clearInterval(iv); }, [actions.loadMarketListings]);

  useEffect(() => {
    actions.loadActiveRide();
    const intv = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (actions.isCompletingRef.current || isProcessingRef.current || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastResyncTsRef.current < 3000) return;
      lastResyncTsRef.current = now;
      fullResyncRef.current();
    }, 8000);
    return () => clearInterval(intv);
  }, [actions.loadActiveRide]);

  useEffect(() => {
    if (actions.connection.online && actions.connection.queueCount > 0) {
      actions.connection.doSync(
        () => {},
        () => {},
      ).then((synced: number) => { if (synced > 0) fullResyncRef.current(); });
    }
  }, [actions.connection.online]);

  useEffect(() => {
    if (activeRide && activePassengers.length > 0) { fetchPickupRoute(); fetchTripStops(); }
  }, [activeRide?.id, activePassengers.length]);

  useEffect(() => {
    if (screen === ("loading" as any)) return;
    if (isOnline && !activeRide && screen === "idle") setScreen("route_select");

  }, [isOnline, activeRide, screen]);

  useEffect(() => { if (activeRide && screen === "idle") setScreen("seat_view"); }, [activeRide]);

  const missedCount = user?.consecutiveIgnores ?? 0;
  const shouldWarn = missedCount >= 2;
  const [warnVisible, setWarnVisible] = useState(false);
  const [warnCollapsed, setWarnCollapsed] = useState(false);
  const warnLastCountRef = useRef(0);
  const warnHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priorityShownRef = useRef(false);

  const scheduleHide = useCallback(() => {
    if (warnHideTimerRef.current) clearTimeout(warnHideTimerRef.current);
    warnHideTimerRef.current = setTimeout(() => { setWarnVisible(false); setWarnCollapsed(true); warnHideTimerRef.current = null; }, 60_000);
  }, []);
  const cancelHideTimer = useCallback(() => { if (warnHideTimerRef.current) { clearTimeout(warnHideTimerRef.current); warnHideTimerRef.current = null; } }, []);

  useEffect(() => {
    if (!shouldWarn) { cancelHideTimer(); setWarnVisible(false); setWarnCollapsed(false); priorityShownRef.current = false; warnLastCountRef.current = 0; return; }
    if (priorityShownRef.current && missedCount <= warnLastCountRef.current) return;
    try {
      const da = localStorage.getItem("priority_warning_dismissed");
      const dc = Number(localStorage.getItem("priority_warning_count") || "0");
      if (da && Date.now() - Number(da) < 600000 && dc >= missedCount) { setWarnCollapsed(true); priorityShownRef.current = true; return; }
      if (da) localStorage.removeItem("priority_warning_dismissed");
    } catch {}
    if (missedCount > warnLastCountRef.current) { warnLastCountRef.current = missedCount; priorityShownRef.current = true; setWarnVisible(true); setWarnCollapsed(false); scheduleHide(); }
    return cancelHideTimer;
  }, [shouldWarn, missedCount]);

  const dismissWarning = useCallback(() => {
    cancelHideTimer(); setWarnVisible(false); setWarnCollapsed(true); priorityShownRef.current = true;
    try { localStorage.setItem("priority_warning_dismissed", String(Date.now())); localStorage.setItem("priority_warning_count", String(missedCount)); } catch {}
  }, [cancelHideTimer, missedCount]);
  const reopenWarning = useCallback(() => { setWarnVisible(true); setWarnCollapsed(false); try { localStorage.removeItem("priority_warning_dismissed"); } catch {} scheduleHide(); }, [scheduleHide]);

  return (
    <>
      {warnVisible && (
        <div className="fixed top-3 left-3 right-3 z-[100] animate-in slide-in-from-top-2 fade-in duration-300">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 backdrop-blur-md shadow-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-500">Вы пропускаете заказы — приоритет снижен</p>
              <p className="text-xs text-amber-400/80 mt-0.5">Пропущено: {missedCount}. Принимайте заказы для восстановления</p>
            </div>
            <button onClick={dismissWarning} className="p-1 rounded-lg hover:bg-amber-500/20 transition-colors shrink-0"><X className="w-4 h-4 text-amber-500" /></button>
          </div>
        </div>
      )}
      {warnCollapsed && shouldWarn && !warnVisible && (
        <button onClick={reopenWarning} className="fixed top-3 right-3 z-[100] p-2 rounded-full bg-amber-500/10 border border-amber-500/20 backdrop-blur-md shadow-md hover:bg-amber-500/20 transition-colors animate-in fade-in duration-200">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
        </button>
      )}
      <RideStateRouter
        screen={screen} loading={loading} activeRide={activeRide} activePassengers={activePassengers}
        completedRide={completedRide} cities={actions.cities} availableRoutes={actions.availableRoutes}
        tripStops={tripStops} pickupRoute={pickupRoute} marketListings={actions.marketListings}
        buyingId={actions.buyingId} actionLoading={actions.actionLoading}
        passengerActionLoading={actions.passengerActionLoading} clientActionLoading={actions.clientActionLoading}
        commissionRate={commissionRate} isOnline={isOnline} driverGPS={driverGPS} token={token}
        onCreateRide={actions.handleCreateRide} onStartRide={actions.handleStartRide}
        onComplete={actions.handleComplete} onCancelViaDispatcher={() => actions.handleCancel()}
        onPassengerPickup={actions.handlePassengerPickup} onPassengerDropoff={actions.handlePassengerDropoff}
        onBatchPickup={actions.handleBatchPickup} onBatchDropoff={actions.handleBatchDropoff}
        onBuyListing={actions.handleBuyListing} onManualClient={actions.handleManualClient}
        onRejectClient={actions.handlePassengerReject} onGoOnline={actions.handleGoOnline}
        onCompletionClose={actions.handleCompletionClose} onRefresh={actions.loadActiveRide}
      />
    </>
  );
}
