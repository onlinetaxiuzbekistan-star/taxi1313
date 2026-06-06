import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Phone, Navigation as NavigationIcon, CheckCircle, XCircle, Users, User, Clock, Loader2, ArrowRight, ExternalLink, X } from "lucide-react";
import type { Ride, TripStop, SeatPassenger, CityInfo } from "../types";
import type { useDriverGPS } from "../hooks/useDriverGPS";
import { BASE_URL } from "../constants";
import { formatCurrency } from "@/lib/utils";
import { CarSeatLayout } from "./CarSeatLayout";
import { formatRoutePoint, buildYandexNavUrl, haversineKm } from "../utils";
import { FullScreenMap } from "./FullScreenMap";
import { FloatingChatButton } from "./FloatingChatButton";
import { ElapsedTimer } from "./ElapsedTimer";

export function ActiveRideScreen({ ride, onComplete, onCancel, onCancelDirect, loading, driverGPS, tripStops, onPassengerPickup, onPassengerDropoff, passengerActionLoading, onBatchPickup, onBatchDropoff, cities = [] }: {
  ride: Ride; onComplete: () => void; onCancel: () => void; onCancelDirect?: () => void; loading: boolean;
  driverGPS: ReturnType<typeof useDriverGPS>;
  tripStops: TripStop[];
  onPassengerPickup: (passengerId: number) => void;
  onPassengerDropoff: (passengerId: number) => void;
  passengerActionLoading: number | null;
  onBatchPickup: (ids: number[]) => Promise<void>;
  onBatchDropoff: (ids: number[]) => Promise<void>;
  cities?: CityInfo[];
}) {
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  const seatPassengers = ride.seatPassengers || [];
  const hasExternalPassenger = seatPassengers.some(p => p.source !== "manual" && p.source !== "driver");
  const selectedPassenger = selectedSeat !== null ? seatPassengers.find(p => p.seatNumber === selectedSeat) : null;
  const filledSeats = seatPassengers.length;
  const totalSeats = ride.seatsTotal || 4;
  const totalEarnings = seatPassengers.reduce((sum, p) => sum + (p.price || 0), 0);

  const sortByTripOrder = (passengers: SeatPassenger[]) => {
    if (tripStops.length === 0) return passengers;
    return [...passengers].sort((a, b) => {
      const aIdx = tripStops.findIndex(s => s.passengerId === a.id);
      const bIdx = tripStops.findIndex(s => s.passengerId === b.id);
      if (aIdx === -1 && bIdx === -1) return a.seatNumber - b.seatNumber;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  };

  const waitingPassengers = sortByTripOrder(seatPassengers.filter(p => p.status === "waiting"));
  const pickedUpPassengers = sortByTripOrder(seatPassengers.filter(p => p.status === "picked_up"));
  const droppedOffCount = seatPassengers.filter(p => p.status === "dropped_off").length;
  const pickedCount = seatPassengers.filter(p => p.status === "picked_up" || p.status === "dropped_off").length;
  const allDroppedOff = filledSeats > 0 && droppedOffCount === filledSeats;

  const nextStop = tripStops.length > 0 ? tripStops[0] : null;

  const handleBatchPickupClick = async () => {
    setBatchLoading(true);
    await onBatchPickup(waitingPassengers.map(p => p.id));
    setBatchLoading(false);
  };

  const handleBatchDropoffClick = async () => {
    setBatchLoading(true);
    await onBatchDropoff(pickedUpPassengers.map(p => p.id));
    setBatchLoading(false);
  };

  const launchFullRouteNav = useCallback(() => {
    if (driverGPS.gpsStatus === "denied" || !ride.fromLat || !ride.fromLng || !ride.toLat || !ride.toLng) return;
    const stopPoints = tripStops.map(s => ({ lat: s.lat, lng: s.lng }));
    const url = buildYandexNavUrl(
      driverGPS.posRef.current || { lat: ride.fromLat, lng: ride.fromLng },
      stopPoints,
      { lat: ride.toLat, lng: ride.toLng },
    );
    window.open(url, "_blank", "noopener,noreferrer");
  }, [driverGPS, ride, tripStops]);

  return (
    <div className="fixed top-0 left-0 right-0 bottom-[68px] z-30 flex flex-col bg-background overflow-y-auto">
      <div className="bg-zinc-900 pt-20 pb-4 px-5 text-white">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wider text-zinc-400">{filledSeats === 0 ? "Принят" : allDroppedOff ? "Все доставлены" : pickedCount < filledSeats ? "Собирает клиентов" : "В пути"}</p>
            <p className="text-lg font-extrabold">{formatRoutePoint(ride.fromDistrictName, cities.find(c => c.id === ride.fromCity)?.nameRu || ride.fromCity)} → {formatRoutePoint(ride.toDistrictName, cities.find(c => c.id === ride.toCity)?.nameRu || ride.toCity)}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-extrabold">{formatCurrency(totalEarnings || ride.price)}</p>
            <p className="text-[12px] text-zinc-400">{ride.distance || "—"} км • ~{ride.duration || "—"} мин</p>
          </div>
        </div>

        {filledSeats > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider">
                {allDroppedOff ? "Все доставлены" : `${droppedOffCount} из ${filledSeats} доставлены`}
              </span>
            </div>
            <div className="h-2 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${filledSeats > 0 ? (droppedOffCount / filledSeats) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 px-4 py-3 space-y-3 -mt-2">

        {allDroppedOff && (
          <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-5 text-center animate-in zoom-in-95 duration-500">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/50 mx-auto mb-3 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-base font-extrabold text-foreground">Все клиенты доставлены</p>
            <p className="text-xs text-muted-foreground mt-1">Нажмите «Завершить рейс» чтобы закрыть заказ</p>
            <div className="mt-3 bg-card rounded-xl px-4 py-2 border border-emerald-200 dark:border-emerald-800">
              <p className="text-lg font-extrabold text-foreground">{formatCurrency(totalEarnings || ride.price)}</p>
              <p className="text-[12px] text-muted-foreground">Итого за рейс</p>
            </div>
          </div>
        )}

        {nextStop && !allDroppedOff && (
          <div className={`rounded-2xl px-4 py-2.5 flex items-center gap-3 animate-in fade-in duration-500 border ${
            nextStop.type === "pickup" ? "bg-emerald-500/10 border-emerald-500/20" : "bg-blue-500/10 border-blue-500/20"
          }`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              nextStop.type === "pickup" ? "bg-emerald-500" : "bg-blue-500"
            }`}>
              {nextStop.type === "pickup" ? <Users className="w-4 h-4 text-white" /> : <MapPin className="w-4 h-4 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider">
                {nextStop.type === "pickup" ? "Следующий подбор" : "Следующая высадка"}
              </p>
              <p className="text-sm font-bold text-foreground truncate">{nextStop.name}</p>
              {nextStop.address && <p className="text-[13px] text-muted-foreground truncate">{nextStop.address}</p>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {nextStop.phone && (
                <a href={`tel:${nextStop.phone}`} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center active:scale-90 transition-transform">
                  <Phone className="w-3.5 h-3.5 text-foreground" />
                </a>
              )}
              <button onClick={() => {
                const url = buildYandexNavUrl(driverGPS.posRef.current, [{ lat: nextStop.lat, lng: nextStop.lng }], null);
                window.open(url, "_blank", "noopener,noreferrer");
              }} className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center active:scale-90 transition-transform">
                <NavigationIcon className="w-3.5 h-3.5 text-foreground" />
              </button>
            </div>
          </div>
        )}

        {!allDroppedOff && waitingPassengers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider px-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Заберите пассажиров
            </p>
            {waitingPassengers.map((wp, idx) => {
              const isNext = idx === 0;
              return (
                <button
                  key={wp.id}
                  onClick={() => onPassengerPickup(wp.id)}
                  disabled={!isNext || batchLoading || passengerActionLoading !== null}
                  className={`w-full py-4 rounded-2xl font-bold text-base active:scale-[0.97] transition-all disabled:opacity-40 flex items-center justify-center gap-3 ${
                    isNext
                      ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400/30"
                      : "bg-muted/60 text-muted-foreground border border-border"
                  }`}
                >
                  {isNext && passengerActionLoading === wp.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <CheckCircle className="w-5 h-5" />
                  )}
                  {isNext
                    ? `Забрал — ${wp.name.split(" ")[0]} (${pickedCount + 1}/${filledSeats})`
                    : `${wp.name.split(" ")[0]} — место ${wp.seatNumber}`
                  }
                </button>
              );
            })}
          </div>
        )}

        {!allDroppedOff && waitingPassengers.length === 0 && pickedUpPassengers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold text-blue-400 uppercase tracking-wider px-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              Высадите пассажиров
            </p>
            {pickedUpPassengers.map((pp, idx) => {
              const isNext = idx === 0;
              return (
                <button
                  key={pp.id}
                  onClick={() => onPassengerDropoff(pp.id)}
                  disabled={!isNext || batchLoading || passengerActionLoading !== null}
                  className={`w-full py-4 rounded-2xl font-bold text-base active:scale-[0.97] transition-all disabled:opacity-40 flex items-center justify-center gap-3 ${
                    isNext
                      ? "bg-blue-500 text-white shadow-lg shadow-blue-500/30 ring-2 ring-blue-400/30"
                      : "bg-muted/60 text-muted-foreground border border-border"
                  }`}
                >
                  {isNext && passengerActionLoading === pp.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <MapPin className="w-5 h-5" />
                  )}
                  {isNext
                    ? `Высадить — ${pp.name.split(" ")[0]} (${droppedOffCount + 1}/${filledSeats})`
                    : `${pp.name.split(" ")[0]} — место ${pp.seatNumber}`
                  }
                </button>
              );
            })}
          </div>
        )}

        <CarSeatLayout
          passengers={seatPassengers}
          onSeatClick={(n) => setSelectedSeat(selectedSeat === n ? null : n)}
          selectedSeat={selectedSeat}
          totalSeats={totalSeats}
        />

        {selectedPassenger && (
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
            <div className="px-4 py-3 flex items-center justify-between border-b border-border">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                  selectedPassenger.status === "picked_up" ? "bg-emerald-100 dark:bg-emerald-900/40" : selectedPassenger.status === "dropped_off" ? "bg-zinc-100 dark:bg-zinc-800" : "bg-amber-100 dark:bg-amber-900/40"
                }`}>
                  <User className={`w-4 h-4 ${
                    selectedPassenger.status === "picked_up" ? "text-emerald-600 dark:text-emerald-400" : selectedPassenger.status === "dropped_off" ? "text-zinc-400" : "text-amber-600 dark:text-amber-400"
                  }`} />
                </div>
                <div>
                  <p className="text-sm font-bold">{selectedPassenger.name}</p>
                  <p className="text-[12px] text-muted-foreground">Место {selectedPassenger.seatNumber} • {formatCurrency(selectedPassenger.price)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedPassenger.phone && (
                  <a href={`tel:${selectedPassenger.phone}`} className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center active:scale-90 transition-transform">
                    <Phone className="w-4 h-4 text-foreground" />
                  </a>
                )}
                <button onClick={() => setSelectedSeat(null)} className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center active:scale-90 transition-transform">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
            {(selectedPassenger.pickupAddress || selectedPassenger.dropoffAddress) && (
              <div className="px-4 py-2.5 space-y-1.5">
                {selectedPassenger.pickupAddress && (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                    <span className="text-muted-foreground truncate">{selectedPassenger.pickupAddress}</span>
                  </div>
                )}
                {selectedPassenger.dropoffAddress && (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                    <span className="text-muted-foreground truncate">{selectedPassenger.dropoffAddress}</span>
                  </div>
                )}
              </div>
            )}
            <div className="px-4 py-2.5 border-t border-border flex gap-2">
              {selectedPassenger.status === "waiting" && (() => {
                const isNextPickup = waitingPassengers.length > 0 && waitingPassengers[0].id === selectedPassenger.id;
                return (
                  <button
                    onClick={() => onPassengerPickup(selectedPassenger.id)}
                    disabled={!isNextPickup || passengerActionLoading === selectedPassenger.id}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                      isNextPickup ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {passengerActionLoading === selectedPassenger.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    {isNextPickup ? "Забрал" : "Ожидает очереди"}
                  </button>
                );
              })()}
              {selectedPassenger.status === "picked_up" && (() => {
                const isNextDropoff = waitingPassengers.length === 0 && pickedUpPassengers.length > 0 && pickedUpPassengers[0].id === selectedPassenger.id;
                return (
                  <button
                    onClick={() => onPassengerDropoff(selectedPassenger.id)}
                    disabled={!isNextDropoff || passengerActionLoading === selectedPassenger.id}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                      isNextDropoff ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {passengerActionLoading === selectedPassenger.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                    {isNextDropoff ? "Высадил" : "Ожидает очереди"}
                  </button>
                );
              })()}
            </div>
          </div>
        )}

        {driverGPS.gpsStatus === "denied" && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-center">
            <p className="text-sm font-medium text-red-600">GPS отключён</p>
            <p className="text-xs text-red-500 mt-1">Разрешите доступ к геолокации в настройках браузера</p>
          </div>
        )}

        {ride.fromLat && ride.fromLng && ride.toLat && ride.toLng && !allDroppedOff && tripStops.length > 0 && (
          <button
            onClick={launchFullRouteNav}
            disabled={driverGPS.gpsStatus === "denied"}
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl bg-muted text-foreground font-bold text-sm border border-border active:scale-[0.97] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <NavigationIcon className="w-5 h-5" />
            Навигатор
            <ExternalLink className="w-3.5 h-3.5 opacity-60" />
          </button>
        )}
      </div>

      <div className="sticky bottom-0 bg-card border-t border-border px-5 py-4 flex gap-3">
        <button onClick={() => { console.log("[cancel-btn ARS]", { hasExt: hasExternalPassenger, hasDirect: !!onCancelDirect, paxCount: seatPassengers.length }); if (hasExternalPassenger) onCancel(); else if (onCancelDirect) onCancelDirect(); else onCancel(); }} disabled={loading}
          className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20 shrink-0 active:scale-95 transition-transform disabled:opacity-50">
          <XCircle className="w-6 h-6" />
        </button>
        {(allDroppedOff || filledSeats === 0) && (
          <button onClick={onComplete} disabled={loading}
            className="flex-1 h-14 rounded-2xl font-bold text-base shadow-lg flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-50 bg-emerald-500 text-white animate-in zoom-in-95 duration-500">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
            {loading ? "Завершаю..." : "Завершить рейс"}
          </button>
        )}
      </div>
    </div>
  );
}

