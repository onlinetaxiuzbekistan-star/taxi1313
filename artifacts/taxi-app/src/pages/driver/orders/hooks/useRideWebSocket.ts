import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadChat } from "@/hooks/use-unread-chat";
import { useToast } from "@/hooks/use-toast";
import type { DriverScreen, Ride, SeatPassenger } from "../types";
import { speakRu, playMp3ViaContext, playUrlViaPrimedAudio } from "@/lib/tts";

const _audioCache: Record<string, string | null | undefined> = {};
async function playCustomCue(kind: "cancel" | "unassign" | "seat-changed", fallbackText: string) {
  try {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    if (_audioCache[kind] === undefined) {
      const r = await fetch(`${base}/api/audio-files/${kind}`, { cache: "no-store" });
      const d = r.ok ? await r.json() : null;
      _audioCache[kind] = d?.url || null;
      console.log(`[playCustomCue] ${kind}: fetched url=`, _audioCache[kind]);
    }
    const url = _audioCache[kind];
    if (url) {
      const fullUrl = url.startsWith("http") ? url : (base + url);
      // Strategy 1: primed HTMLAudioElement (most reliable in WebView, supports any browser-decodable mp3)
      const primed = playUrlViaPrimedAudio(fullUrl, 1);
      if (primed) { console.log(`[playCustomCue] ${kind}: primed audio playing ${fullUrl}`); return; }
      // Strategy 2: AudioContext (fallback)
      const ctxOk = await playMp3ViaContext(fullUrl);
      if (ctxOk) { console.log(`[playCustomCue] ${kind}: AudioContext playing`); return; }
      console.warn(`[playCustomCue] ${kind}: both audio strategies failed, falling back to TTS`);
    } else {
      console.log(`[playCustomCue] ${kind}: no custom mp3 uploaded, using TTS`);
    }
  } catch (e) { console.warn("[playCustomCue] error:", e); }
  speakRu(fallbackText, kind);
}


interface WsRefs {
  activeRideRef: React.MutableRefObject<Ride | null>;
  isOnlineRef: React.MutableRefObject<boolean>;
  isProcessingRef: React.MutableRefObject<boolean>;
  pendingResyncRef: React.MutableRefObject<boolean>;
  completedAtRef: React.MutableRefObject<number>;
  stateVersionRef: React.MutableRefObject<number>;
  fullResyncRef: React.MutableRefObject<() => Promise<void>>;
  loadActiveRideRef: React.MutableRefObject<() => Promise<void>>;
}

interface WsSetters {
  setScreen: React.Dispatch<React.SetStateAction<DriverScreen>>;
  setActiveRide: React.Dispatch<React.SetStateAction<Ride | null>>;
  setActivePassengers: React.Dispatch<React.SetStateAction<SeatPassenger[]>>;
  setTripStops: React.Dispatch<React.SetStateAction<any[]>>;
  setPickupRoute: React.Dispatch<React.SetStateAction<any>>;
}

export function useRideWebSocket(refs: WsRefs, setters: WsSetters) {
  const [, navigate] = useLocation();
  const { refreshUser } = useAuth();
  const { toast } = useToast();
  const { setChatOpen, setRideId: setChatRideId } = useUnreadChat();

  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      console.log('[DRIVER ORDERS handler]', data?.type, data?.version != null ? `v=${data.version}` : '');
      if (data.type === "new_order" && data.ride) {
        if (Date.now() - refs.completedAtRef.current < 6000) {
          console.log("[AUTO NEXT] ignoring new_order — ride just completed, cooldown active");
          return;
        }
        console.log("[AUTO NEXT] new_order received via WS, navigating to incoming", data.ride.id, "offerId=", data.offerId);
        navigate("/driver/incoming");
        return;
      } else if (data.type === "trip_completed" && data.rideId === refs.activeRideRef.current?.id) {
        console.log("[TRIP] completed via WS — clearing state");
        refs.completedAtRef.current = Date.now();
        refs.stateVersionRef.current = 0;
        setters.setActiveRide(null);
        setters.setActivePassengers([]);
        setters.setTripStops([]);
        setters.setPickupRoute(null);
        refs.loadActiveRideRef.current();
      } else if (data.type === "route_updated") {
        console.log("[WS] route_updated → unconditional fullResync", data.rideId);
        refs.fullResyncRef.current();
      } else if (data.type === "ride_unassigned_by_dispatcher") {
        const eventRideId = data.rideId;
        const activeId = refs.activeRideRef.current?.id;
        console.log("[WS] ride_unassigned_by_dispatcher", { eventRideId, activeId });
        if (eventRideId != null && (activeId == null || activeId === eventRideId)) {
          refs.stateVersionRef.current = 0;
          setters.setActiveRide(null);
          setters.setActivePassengers([]);
          setters.setTripStops([]);
          setters.setPickupRoute(null);
          setters.setScreen("route_select");
        }
        toast({ variant: "destructive", title: data.message || "Диспетчер снял с вас заказ" });
        playCustomCue("unassign", "Заказ снят");
        refs.loadActiveRideRef.current();
        window.dispatchEvent(new Event("buxtaxi:rides_changed"));
        return;
      } else if (data.type === "new_ride" || data.type === "ride_updated" || data.type === "trip_updated") {
        const eventRideId = data.rideId ?? data.ride?.id;
        const isCurrentRide = eventRideId != null && eventRideId === refs.activeRideRef.current?.id;
        if (isCurrentRide && data.ride && data.ride.status === "cancelled") {
          console.log("[WS] ride cancelled by dispatcher, clearing state");
          refs.stateVersionRef.current = 0;
          setters.setActiveRide(null);
          setters.setActivePassengers([]);
          setters.setTripStops([]);
          setters.setPickupRoute(null);
          setters.setScreen("route_select");
          toast({ variant: "destructive", title: "Заказ отменён диспетчером" });
          playCustomCue("cancel", "Заказ отменён");
          return;
        }
        if (isCurrentRide && typeof data.version === "number" && data.version > 0 && data.version < refs.stateVersionRef.current) {
          console.log(`[WS] stale event ignored: ${data.type} v=${data.version} < current=${refs.stateVersionRef.current}`);
          return;
        }
        // Apply fresh seatPassengers from payload immediately so prices update without waiting for refetch
        if (isCurrentRide && data.ride?.seatPassengers && Array.isArray(data.ride.seatPassengers)) {
          console.log(`[WS] applying ${data.ride.seatPassengers.length} fresh seatPassengers from ${data.type} payload`);
          setters.setActivePassengers(data.ride.seatPassengers as any);
          setters.setActiveRide(prev => prev ? { ...prev, ...data.ride, seatPassengers: data.ride.seatPassengers } : data.ride);
          if (typeof data.version === "number" && data.version > refs.stateVersionRef.current) {
            refs.stateVersionRef.current = data.version;
          }
        }
        if (!refs.isProcessingRef.current) { refs.fullResyncRef.current(); }
        else { refs.pendingResyncRef.current = true; }
      } else if (data.type === "passenger_seat_changed") {
        const eventRideId = data.rideId;
        const isCurrentRide = eventRideId != null && eventRideId === refs.activeRideRef.current?.id;
        if (isCurrentRide) {
          const seatLabel = Number(data.seatNumber) === 1 ? "переднее" : `место ${data.seatNumber}`;
          playCustomCue("seat-changed", `Место изменено на ${seatLabel}`);
          // Always trigger fullResync to refetch fresh passengers (with new prices)
          refs.fullResyncRef.current();
          refs.pendingResyncRef.current = true;
        }
        return;
      } else if (data.type === "queue_update") {
        refs.loadActiveRideRef.current();
        window.dispatchEvent(new Event("buxtaxi:queue_update"));
      }
    };
    const acceptedHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log("[ACCEPT] order_accepted event", detail?.rideId);
      refs.loadActiveRideRef.current();
      refreshUser();
      toast({ title: "Заказ принят!" });
      window.dispatchEvent(new Event("buxtaxi:rides_changed"));
      if (detail?.rideId) {
        setChatRideId(detail.rideId);
        setTimeout(() => setChatOpen(true), 500);
      }
    };
    const declinedHandler = () => {
      const ar = refs.activeRideRef.current;
      const on = refs.isOnlineRef.current;
      setters.setScreen(ar ? "seat_view" : "route_select");
    };
    const errorHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      toast({ variant: "destructive", title: detail?.message || "Ошибка" });
    };
    window.addEventListener("buxtaxi:ws", handler);
    window.addEventListener("buxtaxi:order_accepted", acceptedHandler);
    window.addEventListener("buxtaxi:order_declined", declinedHandler);
    window.addEventListener("buxtaxi:order_error", errorHandler);
    return () => {
      window.removeEventListener("buxtaxi:ws", handler);
      window.removeEventListener("buxtaxi:order_accepted", acceptedHandler);
      window.removeEventListener("buxtaxi:order_declined", declinedHandler);
      window.removeEventListener("buxtaxi:order_error", errorHandler);
    };
  }, []);
}
