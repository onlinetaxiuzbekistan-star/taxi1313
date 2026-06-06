import { useState, useCallback, useRef, useTransition, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useConnection } from "@/hooks/use-connection";
import { enqueueAction } from "@/lib/offline-queue";
import { getCached, setCached } from "@/lib/api-cache";
import type { DriverScreen, Ride, SeatPassenger, TripStop, CityInfo, PickupRouteData } from "../types";
import { BASE_URL } from "../constants";

let _tripStartedUrlCache: string | null = null;
let _tripStartedFetching = false;

async function fetchTripStartedUrl(authHeader: string): Promise<string | null> {
  if (_tripStartedUrlCache !== null) return _tripStartedUrlCache;
  if (_tripStartedFetching) return null;
  _tripStartedFetching = true;
  try {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const r = await fetch(`${base}/api/audio-files/trip-started`, { headers: { Authorization: authHeader } });
    if (!r.ok) return null;
    const d = await r.json();
    _tripStartedUrlCache = d?.url || null;
    return _tripStartedUrlCache;
  } catch { return null; }
  finally { _tripStartedFetching = false; }
}

function playTripStartedAudioSync(url: string | null) {
  if (!url) return;
  try {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const fullUrl = url.startsWith("http") ? url : (base + url);
    const a = new Audio(fullUrl);
    a.volume = 1;
    const playPromise = a.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => { console.warn("[trip-audio] autoplay blocked:", err?.message || err); });
    }
  } catch (e) { console.warn("[trip-audio] play error:", e); }
}

interface ActionRefs {
  activeRideRef: React.MutableRefObject<Ride | null>;
  isOnlineRef: React.MutableRefObject<boolean>;
  isProcessingRef: React.MutableRefObject<boolean>;
  pendingResyncRef: React.MutableRefObject<boolean>;
  completedAtRef: React.MutableRefObject<number>;
  stateVersionRef: React.MutableRefObject<number>;
  headersRef: React.MutableRefObject<Record<string, string>>;
  abortRef: React.MutableRefObject<AbortController | null>;
  routeRebuildTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  activePassengersRef: React.MutableRefObject<SeatPassenger[]>;
  fullResyncRef: React.MutableRefObject<() => Promise<void>>;
}

interface ActionSetters {
  setScreen: React.Dispatch<React.SetStateAction<DriverScreen>>;
  setActiveRide: React.Dispatch<React.SetStateAction<Ride | null>>;
  setActivePassengers: React.Dispatch<React.SetStateAction<SeatPassenger[]>>;
  setTripStops: React.Dispatch<React.SetStateAction<TripStop[]>>;
  setPickupRoute: React.Dispatch<React.SetStateAction<PickupRouteData | null>>;
  setCompletedRide: React.Dispatch<React.SetStateAction<Ride | null>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useOrderActions(refs: ActionRefs, setters: ActionSetters) {
  function finishProcessing(resyncDelayMs = 0) {
    const shouldResync = refs.pendingResyncRef.current;
    refs.isProcessingRef.current = false;
    refs.pendingResyncRef.current = false;
    if (shouldResync && navigator.onLine) {
      setTimeout(() => {
        refs.fullResyncRef.current().catch(() => {});
      }, resyncDelayMs);
    }
  }

  const { token, user, refreshUser } = useAuth();
  const { toast } = useToast();
  const connection = useConnection();

  const [actionLoading, setActionLoading] = useState(false);
  const [passengerActionLoading, setPassengerActionLoading] = useState<number | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [clientActionLoading, setClientActionLoading] = useState(false);
  const [marketListings, setMarketListings] = useState<any[]>([]);
  const [, startListTransition] = useTransition();
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [cities, setCities] = useState<CityInfo[]>([]);
  const [availableRoutes, setAvailableRoutes] = useState<{ fromCity: string; toCity: string }[]>([]);

  const isCompletingRef = useRef(false);
  // _tripStartedPrefetchEffect: при первой возможности подгружаем URL аудио
  useEffect(() => {
    if (_tripStartedUrlCache !== null) return;
    const ah = (refs.headersRef.current?.Authorization as string) || `Bearer ${localStorage.getItem("authToken") || ""}`;
    if (ah) fetchTripStartedUrl(ah).then(u => { if (u) _tripStartedUrlCache = u; });
  }, []);

  isCompletingRef.current = isCompleting;

  const loadActiveRide = useCallback(async () => {
    if (!token) return;
    const cacheKey = `active_ride_${user?.id || ""}`;
    const cachedRide = getCached<any>(cacheKey);
    if (cachedRide?.ride) {
      setters.setActiveRide(cachedRide.ride);
      setters.setActivePassengers(cachedRide.passengers || []);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/my-active-ride`, { headers: refs.headersRef.current });
      if (!res.ok) return;
      const data = await res.json();
      const serverVersion = data.version || 0;
      if (data.ride && serverVersion > 0 && serverVersion < refs.stateVersionRef.current) return;
      refs.stateVersionRef.current = serverVersion;
      if (data.ride) {
        setCached(cacheKey, data, 10 * 60 * 1000);
        setters.setActiveRide(data.ride);
        setters.setActivePassengers(data.passengers || []);
        if (data.ride.status === "in_progress") setters.setScreen(prev => prev !== "active" ? "active" : prev);
        else if (data.ride.status === "accepted") setters.setScreen(prev => (prev === "idle" || prev === "route_select" || prev === ("loading" as any)) ? "seat_view" : prev);
      } else {
        setCached(cacheKey, null, 1000);
        setters.setScreen(prev => {
          if (prev === "seat_view" || prev === "active" || prev === "pickup" || prev === ("loading" as any)) {
            refs.stateVersionRef.current = 0;
            setters.setActiveRide(null);
            setters.setActivePassengers([]);
            setters.setPickupRoute(null);
            setters.setTripStops([]);
            return "route_select";
          }
          return prev;
        });
      }
    } catch {}
    setters.setLoading(false);
  }, [token]);

  const loadMarketListings = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BASE_URL}/api/marketplace/listings`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        const newListings = data.listings || [];
        startListTransition(() => {
          setMarketListings(prev => JSON.stringify(prev) === JSON.stringify(newListings) ? prev : newListings);
        });
      }
    } catch {}
  }, [token]);

  const handleBuyListing = async (listingId: number) => {
    if (buyingId) return;
    setBuyingId(listingId);
    try {
      const res = await fetch(`${BASE_URL}/api/marketplace/buy`, {
        method: "POST", headers: refs.headersRef.current, body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Заказ куплен!" });
        refreshUser();
        loadMarketListings();
        loadActiveRide();
      } else {
        toast({ variant: "destructive", title: data.message || "Ошибка покупки" });
      }
    } catch { toast({ variant: "destructive", title: "Ошибка сети" }); }
    setBuyingId(null);
  };

  const handleCreateRide = async (fromCity: string, toCity: string, departureTime: string, urgent: boolean = false, timeSlotLabel?: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/create-ride`, {
        method: "POST", headers: refs.headersRef.current, body: JSON.stringify({ fromCity, toCity, departureTime, urgent, timeSlot: timeSlotLabel }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Рейс создан!" });
        setters.setActiveRide(data);
        setters.setActivePassengers([]);
        setters.setScreen("seat_view");
        refreshUser();
      } else {
        toast({ variant: "destructive", title: data.message || "Ошибка создания рейса" });
      }
    } catch { toast({ variant: "destructive", title: "Ошибка сети" }); }
    finally { setActionLoading(false); }
  };

  const handleStartRide = async (retry = false, actionId?: string) => {
    const ride = refs.activeRideRef.current;
    if (!ride || actionLoading) return;
    setActionLoading(true);
    const aid = actionId || crypto.randomUUID();
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/start`, {
        signal: AbortSignal.timeout(15000),
        method: "POST",
        headers: { ...refs.headersRef.current, "X-Action-Id": aid },
        body: JSON.stringify({ rideId: ride.id }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data._replayed && typeof data._rideVersion === "number" && data._rideVersion < refs.stateVersionRef.current) {
          await refs.fullResyncRef.current(); return;
        }
        toast({ title: "Поездка начата!" });
        setters.setActiveRide({ ...ride, status: "in_progress" });
        setters.setScreen("active");
        refreshUser();
      } else if (data.error === "version_conflict" && !retry) {
        setActionLoading(false);
        await refs.fullResyncRef.current();
        await handleStartRide(true, crypto.randomUUID()); return;
      } else { toast({ variant: "destructive", title: data.message || "Ошибка" }); }
    } catch {
      if (!navigator.onLine) {
        enqueueAction({ type: "start", endpoint: `${BASE_URL}/api/drivers/start`, method: "POST",
          headers: { ...refs.headersRef.current, "X-Action-Id": aid },
          body: JSON.stringify({ rideId: ride.id }), rideId: ride.id, localLabel: "Начать поездку" });
        setters.setActiveRide({ ...ride, status: "in_progress" });
        setters.setScreen("active");
        toast({ title: "Поездка начата (офлайн) — синхронизируется при подключении" });
      } else { toast({ variant: "destructive", title: "Ошибка сети" }); }
    } finally { setActionLoading(false); }
  };

  const handleComplete = async () => {
    const ride = refs.activeRideRef.current;
    if (!ride || actionLoading || isCompleting || refs.isProcessingRef.current) return;
    const passengersSnapshot = [...refs.activePassengersRef.current];

    refs.isProcessingRef.current = true;
    refs.abortRef.current?.abort();
    refs.abortRef.current = new AbortController();
    if (refs.routeRebuildTimer.current) { clearTimeout(refs.routeRebuildTimer.current); refs.routeRebuildTimer.current = null; }

    setIsCompleting(true);
    setActionLoading(true);
    refs.stateVersionRef.current = 0;
    refs.completedAtRef.current = Date.now();
    setters.setActiveRide(null);
    setters.setActivePassengers([]);
    setters.setTripStops([]);
    setters.setPickupRoute(null);
    setters.setCompletedRide({ ...ride, seatPassengers: passengersSnapshot });
    setters.setScreen("completed");

    try {
      const res = await fetch(`${BASE_URL}/api/drivers/complete`, {
        method: "POST", headers: refs.headersRef.current, body: JSON.stringify({ rideId: ride.id }),
      });
      const data = await res.json();
      if (res.ok) { toast({ title: "Рейс завершён!" }); refreshUser(); }
      else {
        const errMsg = data.error === "no_driver" ? "Водитель не назначен" : data.error === "no_price" ? "Ошибка расчёта" : data.message || "Ошибка завершения";
        toast({ variant: "destructive", title: errMsg });
        setters.setActiveRide(ride);
        setters.setActivePassengers(passengersSnapshot);
        setters.setScreen("active");
        setters.setCompletedRide(null);
      }
    } catch {
      if (!navigator.onLine) {
        enqueueAction({ type: "complete", endpoint: `${BASE_URL}/api/drivers/complete`, method: "POST",
          headers: refs.headersRef.current, body: JSON.stringify({ rideId: ride.id }), rideId: ride.id, localLabel: "Завершить рейс" });
        toast({ title: "Рейс завершён (офлайн)" });
      } else {
        toast({ variant: "destructive", title: "Ошибка сети" });
        setters.setActiveRide(ride);
        setters.setActivePassengers(passengersSnapshot);
        setters.setScreen("active");
        setters.setCompletedRide(null);
      }
    } finally {
      finishProcessing(200);
      setActionLoading(false);
      setIsCompleting(false);
      refs.abortRef.current = null;
    }
  };

  const handleCancel = async (retry = false, actionId?: string) => {
    const ride = refs.activeRideRef.current;
    console.log("[handleCancel ENTRY]", { rideId: ride?.id, retry, actionLoading, isProcessing: refs.isProcessingRef.current });
    if (!ride) { console.warn("[handleCancel] no active ride"); return; }
    if (actionLoading || refs.isProcessingRef.current) { console.warn("[handleCancel] busy", { actionLoading, isProcessing: refs.isProcessingRef.current }); return; }
    // confirm уже сделан в UI кнопке; здесь только проверка retry
    void retry;
    refs.isProcessingRef.current = true;
    refs.abortRef.current?.abort();
    refs.abortRef.current = new AbortController();
    if (refs.routeRebuildTimer.current) { clearTimeout(refs.routeRebuildTimer.current); refs.routeRebuildTimer.current = null; }
    setActionLoading(true);
    const aid = actionId || crypto.randomUUID();
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/cancel`, {
        method: "POST", headers: { ...refs.headersRef.current, "X-Action-Id": aid },
        body: JSON.stringify({ rideId: ride.id }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data._replayed && typeof data._rideVersion === "number" && data._rideVersion < refs.stateVersionRef.current) {
          await refs.fullResyncRef.current(); return;
        }
        toast({ title: "Рейс отменён" });
        refs.stateVersionRef.current = 0;
        setters.setActiveRide(null); setters.setActivePassengers([]); setters.setTripStops([]); setters.setPickupRoute(null);
        setters.setScreen("route_select");
        refreshUser();
      } else if (data.error === "version_conflict" && !retry) {
        finishProcessing(200); setActionLoading(false);
        await refs.fullResyncRef.current();
        await handleCancel(true, crypto.randomUUID()); return;
      } else { toast({ variant: "destructive", title: data.message || "Ошибка" }); }
    } catch (e: any) {
      if (e?.name === "AbortError") {}
      else if (!navigator.onLine) {
        enqueueAction({ type: "cancel", endpoint: `${BASE_URL}/api/drivers/cancel`, method: "POST",
          headers: { ...refs.headersRef.current, "X-Action-Id": aid },
          body: JSON.stringify({ rideId: ride.id }), rideId: ride.id, localLabel: "Отменить рейс" });
        refs.stateVersionRef.current = 0;
        setters.setActiveRide(null); setters.setActivePassengers([]); setters.setTripStops([]); setters.setPickupRoute(null);
        setters.setScreen("route_select");
        toast({ title: "Рейс отменён (офлайн)" });
      } else { toast({ variant: "destructive", title: "Ошибка сети" }); }
    } finally {
      finishProcessing(200); setActionLoading(false);
    }
  };

  const handlePassengerPickup = async (passengerId: number, retry = false, actionId?: string) => {
    if (passengerActionLoading || refs.isProcessingRef.current) return;
    // СИНХРОННО (до await): если этот пассажир — последний waiting → играем "поездка началась"
    // Используем gesture от клика "Забрать клиента", иначе autoplay будет заблокирован.
    if (!retry) {
      try {
        const _waiting = (refs.activePassengersRef?.current || []).filter((p: any) => p.status === "waiting");
        const _isLast = _waiting.length === 1 && _waiting[0]?.id === passengerId;
        if (_isLast) {
          playTripStartedAudioSync(_tripStartedUrlCache);
        }
        // Lazy-prefetch URL для следующего раза (если ещё не загружали)
        if (_tripStartedUrlCache === null) {
          const ah = (refs.headersRef.current?.Authorization as string) || `Bearer ${localStorage.getItem("authToken") || ""}`;
          fetchTripStartedUrl(ah).then(u => { if (u) _tripStartedUrlCache = u; });
        }
      } catch {}
    }
    refs.isProcessingRef.current = true;
    setPassengerActionLoading(passengerId);
    refs.abortRef.current?.abort();
    refs.abortRef.current = new AbortController();
    const aid = actionId || crypto.randomUUID();
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/passenger/${passengerId}/pickup`, {
        method: "POST", headers: { ...refs.headersRef.current, "X-Action-Id": aid },
      });
      const data = await res.json();
      if (res.ok) {
        if (data._replayed && typeof data._rideVersion === "number" && data._rideVersion < refs.stateVersionRef.current) {
          await refs.fullResyncRef.current(); return;
        }
        toast({ title: data.message || "Пассажир подобран!" });
        setters.setActivePassengers(prev => prev.map(p => p.id === passengerId ? { ...p, status: "picked_up" } : p));
      } else if (data.error === "version_conflict" && !retry) {
        finishProcessing(200); setPassengerActionLoading(null);
        await refs.fullResyncRef.current();
        await handlePassengerPickup(passengerId, true, crypto.randomUUID()); return;
      } else { toast({ variant: "destructive", title: data.message || "Ошибка" }); }
    } catch (e: any) {
      if (e?.name === "AbortError") {}
      else if (!navigator.onLine) {
        enqueueAction({ type: "pickup", endpoint: `${BASE_URL}/api/drivers/passenger/${passengerId}/pickup`, method: "POST",
          headers: { ...refs.headersRef.current, "X-Action-Id": aid }, passengerId, rideId: refs.activeRideRef.current?.id, localLabel: "Забрать пассажира" });
        setters.setActivePassengers(prev => prev.map(p => p.id === passengerId ? { ...p, status: "picked_up" } : p));
        toast({ title: "Сохранено офлайн" });
      } else { toast({ variant: "destructive", title: "Ошибка сети" }); }
    } finally {
      finishProcessing(200); setPassengerActionLoading(null);
      if (refs.routeRebuildTimer.current) clearTimeout(refs.routeRebuildTimer.current);
      if (navigator.onLine) refs.routeRebuildTimer.current = setTimeout(() => refs.fullResyncRef.current(), 300);
    }
  };

  const handlePassengerDropoff = async (passengerId: number, retry = false, actionId?: string) => {
    if (passengerActionLoading || refs.isProcessingRef.current) return;
    refs.isProcessingRef.current = true;
    setPassengerActionLoading(passengerId);
    refs.abortRef.current?.abort();
    refs.abortRef.current = new AbortController();
    const aid = actionId || crypto.randomUUID();
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/passenger/${passengerId}/dropoff`, {
        method: "POST", headers: { ...refs.headersRef.current, "X-Action-Id": aid },
      });
      const data = await res.json();
      if (res.ok) {
        if (data._replayed && typeof data._rideVersion === "number" && data._rideVersion < refs.stateVersionRef.current) {
          await refs.fullResyncRef.current(); return;
        }
        toast({ title: data.message || "Пассажир высажен!" });
        setters.setActivePassengers(prev => prev.map(p => p.id === passengerId ? { ...p, status: "dropped_off" } : p));
        if (data.autoCompleted) {
          refs.completedAtRef.current = Date.now();
          setters.setCompletedRide({ ...refs.activeRideRef.current!, seatPassengers: [...refs.activePassengersRef.current] });
          setters.setScreen("completed");
          refs.stateVersionRef.current = 0;
          setters.setActiveRide(null); setters.setActivePassengers([]); setters.setTripStops([]); setters.setPickupRoute(null);
          refreshUser();
          finishProcessing(200); setPassengerActionLoading(null);
          return;
        }
      } else if (data.error === "version_conflict" && !retry) {
        finishProcessing(200); setPassengerActionLoading(null);
        await refs.fullResyncRef.current();
        await handlePassengerDropoff(passengerId, true, crypto.randomUUID()); return;
      } else { toast({ variant: "destructive", title: data.message || "Ошибка" }); }
    } catch (e: any) {
      if (e?.name === "AbortError") {}
      else if (!navigator.onLine) {
        enqueueAction({ type: "dropoff", endpoint: `${BASE_URL}/api/drivers/passenger/${passengerId}/dropoff`, method: "POST",
          headers: { ...refs.headersRef.current, "X-Action-Id": aid }, passengerId, rideId: refs.activeRideRef.current?.id, localLabel: "Высадить пассажира" });
        setters.setActivePassengers(prev => prev.map(p => p.id === passengerId ? { ...p, status: "dropped_off" } : p));
        toast({ title: "Сохранено офлайн" });
      } else { toast({ variant: "destructive", title: "Ошибка сети" }); }
    } finally {
      finishProcessing(200); setPassengerActionLoading(null);
      if (refs.routeRebuildTimer.current) clearTimeout(refs.routeRebuildTimer.current);
      if (navigator.onLine) refs.routeRebuildTimer.current = setTimeout(() => refs.fullResyncRef.current(), 300);
    }
  };

  const handleBatchPickup = async (ids: number[]) => {
    // Синхронно (до await) — если batch заберёт всех оставшихся waiting → играем сейчас, пока есть user gesture
    try {
      const _waiting = (refs.activePassengersRef?.current || []).filter((p: any) => p.status === "waiting");
      const _waitingIds = new Set(_waiting.map((p: any) => p.id));
      const _willPickAllWaiting = _waiting.length > 0 && _waiting.every((p: any) => ids.includes(p.id));
      if (_willPickAllWaiting) {
        playTripStartedAudioSync(_tripStartedUrlCache);
      }
      if (_tripStartedUrlCache === null) {
        const ah = (refs.headersRef.current?.Authorization as string) || `Bearer ${localStorage.getItem("authToken") || ""}`;
        fetchTripStartedUrl(ah).then(u => { if (u) _tripStartedUrlCache = u; });
      }
      void _waitingIds;
    } catch {}
    for (const id of ids) {
      if (refs.isProcessingRef.current) await new Promise<void>(r => { const iv = setInterval(() => { if (!refs.isProcessingRef.current) { clearInterval(iv); r(); } }, 100); });
      // передаём retry=true, чтобы внутри handlePassengerPickup НЕ дублировать аудио (мы уже сыграли синхронно)
      await handlePassengerPickup(id, true);
    }
  };

  const handleBatchDropoff = async (ids: number[]) => {
    for (const id of ids) {
      if (refs.isProcessingRef.current) await new Promise<void>(r => { const iv = setInterval(() => { if (!refs.isProcessingRef.current) { clearInterval(iv); r(); } }, 100); });
      await handlePassengerDropoff(id);
    }
  };

  const handleManualClient = async (seatNumber: number, gender: string, phone: string) => {
    const ride = refs.activeRideRef.current;
    if (!token || !ride || clientActionLoading) return;
    setClientActionLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/manual-client`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: ride.id, seatNumber, gender, phone: phone || undefined }),
      });
      const data = await res.json();
      if (res.ok) { toast({ title: data.message || "Пассажир добавлен" }); await loadActiveRide(); }
      else { toast({ variant: "destructive", title: data.message || "Ошибка" }); }
    } catch { toast({ variant: "destructive", title: "Ошибка сети" }); }
    finally { setClientActionLoading(false); }
  };

  const handleGoOnline = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/status`, {
        method: "PATCH", headers: refs.headersRef.current, body: JSON.stringify({ status: "online" }),
      });
      if (res.ok) { toast({ title: "Вы на линии!" }); refreshUser(); }
      else { const err = await res.json().catch(() => ({})); toast({ variant: "destructive", title: err.message || "Ошибка" }); }
    } catch { toast({ variant: "destructive", title: "Ошибка сети" }); }
  };

  const handleCompletionClose = () => {
    setters.setCompletedRide(null);
    setters.setScreen("route_select");
    loadActiveRide();
  };

  const handlePassengerReject = async (passengerId: number) => {
    if (passengerActionLoading || refs.isProcessingRef.current) return;
    if (!confirm("Снять этого клиента с рейса?")) return;
    setPassengerActionLoading(passengerId);
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/passenger/${passengerId}/reject`, {
        method: "POST", headers: refs.headersRef.current,
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Клиент снят" });
        setters.setActivePassengers(prev => prev.filter(p => p.id !== passengerId));
        await refs.fullResyncRef.current();
      } else {
        toast({ variant: "destructive", title: data.message || "Не удалось снять клиента" });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Ошибка сети" });
    } finally {
      setPassengerActionLoading(null);
    }
  };

  return {
    actionLoading, passengerActionLoading, isCompleting, clientActionLoading,
    marketListings, buyingId, cities, availableRoutes, setCities, setAvailableRoutes,
    connection, isCompletingRef,
    loadActiveRide, loadMarketListings, handleBuyListing,
    handleCreateRide, handleStartRide, handleComplete, handleCancel,
    handlePassengerPickup, handlePassengerDropoff, handlePassengerReject,
    handleBatchPickup, handleBatchDropoff,
    handleManualClient, handleGoOnline, handleCompletionClose,
  };
}
