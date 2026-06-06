import { useState, useEffect, useRef, useCallback } from "react";
import { Navigation as NavigationIcon, XCircle, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import type { Ride, SeatPassenger, PickupRouteData, CityInfo, QueueInfoData } from "../types";
import { BASE_URL } from "../constants";
import { formatRoutePoint, buildYandexNavUrl } from "../utils";
import { CarSeatLayout } from "./CarSeatLayout";
import { QueueWidget } from "./QueueWidget";
import { ConfettiOverlay } from "./ConfettiOverlay";
import { SeatPassengerCard } from "./SeatPassengerCard";
import { ManualClientForm } from "./ManualClientForm";
import { PickupRoutePanel } from "./PickupRoutePanel";
import { ExpiredRideModal } from "./ExpiredRideModal";
import { useUnreadChat } from "@/hooks/use-unread-chat";

export function SeatViewScreen({
  ride, passengers, cities, onEndRide, onStartRide, loading, onRefresh, pickupRoute, token, driverPos,
  onOpenChat: _onOpenChat, dispatcherId: _dispatcherId, dispatcherName: _dispatcherName,
  onRejectClient, onManualClient, clientActionLoading, onCancelDirect,
}: {
  ride: Ride;
  passengers: SeatPassenger[];
  cities: CityInfo[];
  onEndRide: () => void;
  onStartRide: () => void;
  loading: boolean;
  onRefresh: () => void;
  pickupRoute?: PickupRouteData | null;
  token?: string | null;
  driverPos?: { lat: number; lng: number } | null;
  onOpenChat?: (peer: { id: number; name: string; role: string }) => void;
  dispatcherId: number;
  dispatcherName: string;
  onRejectClient?: (passengerId: number) => void;
  onManualClient?: (seatNumber: number, gender: string, phone: string) => void;
  clientActionLoading?: boolean;
  onCancelDirect?: () => void;
}) {
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [showManualModal, setShowManualModal] = useState<number | null>(null);
  const { toast } = useToast();
  const { openChatWithPeer, setRideId } = useUnreadChat();

  useEffect(() => { setRideId(ride.id); }, [ride.id, setRideId]);

  const selectedPassenger = selectedSeat !== null ? passengers.find(p => p.seatNumber === selectedSeat) : null;
  const filledSeats = passengers.length;
  const hasExternalPassenger = passengers.some(p => p.source !== "manual" && p.source !== "driver");
  const totalSeats = ride.seatsTotal || 4;
  const totalEarnings = passengers.reduce((sum, p) => sum + (p.price || 0), 0);
  const isFull = filledSeats >= totalSeats;

  const fromCityRaw = cities.find(c => c.id === ride.fromCity)?.nameRu || ride.fromCity;
  const toCityRaw = cities.find(c => c.id === ride.toCity)?.nameRu || ride.toCity;
  const fromCityName = formatRoutePoint(ride.fromDistrictName, fromCityRaw);
  const toCityName = formatRoutePoint(ride.toDistrictName, toCityRaw);

  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationEarnings, setCelebrationEarnings] = useState(0);
  const celebratedRef = useRef(false);
  const [mountReady, setMountReady] = useState(false);

  useEffect(() => {
    const key = `buxtaxi_celebrated_${ride.id}`;
    celebratedRef.current = !!localStorage.getItem(key);
    setMountReady(false);
    const t = setTimeout(() => setMountReady(true), 1500);
    return () => clearTimeout(t);
  }, [ride.id]);

  useEffect(() => {
    if (!mountReady || filledSeats < totalSeats || celebratedRef.current) return;
    celebratedRef.current = true;
    localStorage.setItem(`buxtaxi_celebrated_${ride.id}`, "1");
    setCelebrationEarnings(totalEarnings);
    setShowCelebration(true);

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playTone = (freq: number, start: number, dur: number, vol: number) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur);
      };
      playTone(523, 0, 0.15, 0.4); playTone(659, 0.12, 0.15, 0.4); playTone(784, 0.24, 0.15, 0.4);
      playTone(1047, 0.36, 0.4, 0.35); playTone(1319, 0.6, 0.15, 0.3); playTone(1568, 0.72, 0.15, 0.3);
      playTone(2093, 0.84, 0.5, 0.25);
    } catch {}
    try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch {}
    setTimeout(() => setShowCelebration(false), 4500);
  }, [filledSeats, ride.id, totalEarnings, mountReady]);

  const [queueInfo, setQueueInfo] = useState<QueueInfoData | null>(null);
  const prevPositionRef = useRef<number | null>(null);
  const [showExpiredModal, setShowExpiredModal] = useState(false);
  const expiredShownRef = useRef(false);
  const [extending, setExtending] = useState(false);
  const [newlyBookedSeats, setNewlyBookedSeats] = useState<number[]>([]);
  const prevPassengerIdsRef = useRef<number[]>([]);

  useEffect(() => {
    const curIds = passengers.map(p => p.id);
    const prevIds = prevPassengerIdsRef.current;
    if (prevIds.length > 0) {
      const newSeats = passengers.filter(p => !prevIds.includes(p.id)).map(p => p.seatNumber);
      if (newSeats.length > 0) { setNewlyBookedSeats(newSeats); setTimeout(() => setNewlyBookedSeats([]), 800); }
    }
    prevPassengerIdsRef.current = curIds;
  }, [passengers]);

  const fetchQueue = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/queue-info`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data: QueueInfoData = await res.json();
        if (prevPositionRef.current !== null && data.position < prevPositionRef.current && data.position > 0)
          toast({ title: `Очередь: ${data.position} из ${data.total}`, description: "Вы продвинулись в очереди!" });
        prevPositionRef.current = data.position;
        setQueueInfo(data);
        if (data.isExpired && !expiredShownRef.current) { expiredShownRef.current = true; setShowExpiredModal(true); }
      }
    } catch {}
  }, [token, toast]);

  useEffect(() => {
    fetchQueue();
    const iv = setInterval(fetchQueue, 10000);
    const handler = () => fetchQueue();
    window.addEventListener("buxtaxi:queue_update", handler);
    return () => { clearInterval(iv); window.removeEventListener("buxtaxi:queue_update", handler); };
  }, [fetchQueue]);

  const handleExtendRide = async () => {
    if (!token || !queueInfo?.rideId) return;
    setExtending(true);
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/extend-ride`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rideId: queueInfo.rideId }),
      });
      if (res.ok) { toast({ title: "Рейс продлён", description: "+30 минут добавлено" }); expiredShownRef.current = false; setShowExpiredModal(false); fetchQueue(); onRefresh(); }
    } catch {}
    setExtending(false);
  };

  useEffect(() => { const intv = setInterval(onRefresh, 10000); return () => clearInterval(intv); }, [onRefresh]);

  const navUrl = pickupRoute && pickupRoute.stops.length > 0
    ? buildYandexNavUrl(driverPos || (ride.fromLat && ride.fromLng ? { lat: ride.fromLat, lng: ride.fromLng } : null), pickupRoute.stops.map(s => ({ lat: s.lat, lng: s.lng })), ride.toLat && ride.toLng ? { lat: ride.toLat, lng: ride.toLng } : null)
    : (ride.fromLat && ride.fromLng && ride.toLat && ride.toLng) ? buildYandexNavUrl(driverPos || { lat: ride.fromLat, lng: ride.fromLng }, [], { lat: ride.toLat, lng: ride.toLng }) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 relative overflow-hidden">
      {showCelebration && <ConfettiOverlay />}
      {showCelebration && (
        <div className="absolute inset-x-0 top-16 z-50 flex flex-col items-center pointer-events-none animate-in zoom-in-75 fade-in duration-500">
          <div className="bg-gradient-to-b from-amber-500 to-amber-600 text-white rounded-3xl px-8 py-5 shadow-2xl text-center ring-4 ring-amber-400/30">
            <p className="text-4xl mb-1">&#127881;</p>
            <p className="text-xl font-black tracking-wide">УРА! ПОЛНЫЙ САЛОН!</p>
            <p className="text-3xl font-extrabold mt-2">+{formatCurrency(celebrationEarnings)}</p>
            <p className="text-sm font-semibold mt-1 text-white/80">Все места заняты — отличная работа!</p>
          </div>
        </div>
      )}

      <div className={`mx-3 mt-2 rounded-2xl px-3 py-3 text-white shadow-lg transition-all duration-500 ${isFull ? "bg-zinc-900 ring-2 ring-zinc-500/40" : "bg-zinc-900"} ${isFull && !showCelebration ? "animate-pulse-subtle" : ""}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">{isFull ? "Машина заполнена" : "Ваш рейс"}</p>
            <p className="text-base font-extrabold truncate">{fromCityName} → {toCityName}</p>
          </div>
          {ride.scheduledAt && (() => {
            const dep = new Date(ride.scheduledAt);
            const arr = new Date(dep.getTime() + 2 * 60 * 60000);
            return (
              <div className="bg-white/10 rounded-lg px-2 py-1 text-center shrink-0 ml-2">
                <p className="text-xs font-bold whitespace-nowrap">
                  {format(dep, "HH:mm")}{arr ? ` — ${format(arr, "HH:mm")}` : ""}
                </p>
                <p className="text-[7px] uppercase text-zinc-400">{format(dep, "d MMM", { locale: ru })}</p>
              </div>
            );
          })()}
        </div>
        <div className="flex gap-1.5">
          <div className="flex-1 bg-white/10 rounded-lg px-2 py-1.5 text-center">
            <p className="text-lg font-extrabold">{filledSeats}<span className="text-sm text-zinc-400">/{totalSeats}</span></p>
            <p className="text-[8px] uppercase tracking-wider text-zinc-400">Мест</p>
          </div>
          <div className="flex-1 bg-white/10 rounded-lg px-2 py-1.5 text-center">
            <p className="text-lg font-extrabold">{formatCurrency(totalEarnings)}</p>
            <p className="text-[8px] uppercase tracking-wider text-zinc-400">Заработок</p>
          </div>
          <div className="flex-1 bg-white/10 rounded-lg px-2 py-1.5 text-center">
            <p className="text-lg font-extrabold">{ride.distance || "—"}</p>
            <p className="text-[8px] uppercase tracking-wider text-zinc-400">км</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        <CarSeatLayout
          passengers={passengers}
          onSeatClick={(n) => {
            const p = passengers.find(pp => pp.seatNumber === n);
            if (p) { setSelectedSeat(selectedSeat === n ? null : n); setShowManualModal(null); }
            else { setSelectedSeat(null); setShowManualModal(showManualModal === n ? null : n); }
          }}
          selectedSeat={selectedSeat || showManualModal}
          newlyBookedSeats={newlyBookedSeats}
          totalSeats={totalSeats}
        />

        {selectedPassenger && (
          <SeatPassengerCard passenger={selectedPassenger} onClose={() => setSelectedSeat(null)}
            onRejectClient={onRejectClient} clientActionLoading={clientActionLoading} />
        )}

        {showManualModal !== null && !selectedPassenger && onManualClient && (
          <ManualClientForm seatNumber={showManualModal}
            onClose={() => setShowManualModal(null)}
            onSubmit={onManualClient} loading={clientActionLoading} />
        )}

        {!selectedPassenger && showManualModal === null && !isFull && (
          <QueueWidget queueInfo={queueInfo} filledSeats={filledSeats} since={ride.scheduledAt || ride.createdAt} totalSeats={totalSeats} />
        )}

        {pickupRoute && pickupRoute.stops.length > 0 && (
          <PickupRoutePanel ride={ride} passengers={passengers} pickupRoute={pickupRoute} toCityName={toCityName} token={token} />
        )}
      </div>

      <div className="shrink-0 bg-card border-t border-border px-3 py-3 space-y-2">
        <div className="flex gap-2">
          {navUrl && (
            <a href={navUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 py-3 rounded-xl bg-muted text-foreground font-bold text-sm border border-border active:scale-[0.97] transition-transform flex items-center justify-center gap-1.5">
              <NavigationIcon className="w-4 h-4" /> Навигатор
            </a>
          )}
          <button onClick={() => { console.log("[cancel-btn SVS]", { hasExt: hasExternalPassenger, hasDirect: !!onCancelDirect, paxCount: passengers.length }); if (hasExternalPassenger) onEndRide(); else if (onCancelDirect) onCancelDirect(); else onEndRide(); }} disabled={loading}
            className="flex-1 py-3 rounded-xl bg-red-500/10 text-red-500 font-bold text-sm border border-red-500/20 active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-1.5">
            <XCircle className="w-4 h-4" /> Отменить
          </button>
        </div>
        {ride.status === "accepted" && filledSeats > 0 && (
          <button onClick={onStartRide} disabled={loading}
            className="w-full h-14 rounded-2xl bg-zinc-900 text-white font-bold text-sm shadow-lg active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <NavigationIcon className="w-4 h-4" />}
            {loading ? "Начинаю..." : "Начать поездку"}
          </button>
        )}
      </div>

      {showExpiredModal && (
        <ExpiredRideModal extending={extending} filledSeats={filledSeats}
          onExtend={handleExtendRide} onStartRide={onStartRide} onEndRide={onEndRide}
          onClose={() => setShowExpiredModal(false)} />
      )}
    </div>
  );
}
