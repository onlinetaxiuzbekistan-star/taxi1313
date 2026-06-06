import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Phone, Navigation as NavigationIcon, CheckCircle, Loader2, ExternalLink, User, XCircle } from "lucide-react";
import type { Ride, SeatPassenger } from "../types";
import type { useDriverGPS } from "../hooks/useDriverGPS";
import { BASE_URL } from "../constants";
import { buildYandexNavUrl, formatRoutePoint } from "../utils";
import { FullScreenMap } from "./FullScreenMap";
import { FloatingChatButton } from "./FloatingChatButton";
import { ElapsedTimer } from "./ElapsedTimer";

export function PickupScreen({ ride, onArrived, onCancel, onCancelDirect, loading, driverGPS }: {
  ride: Ride; onArrived: () => void; onCancel: () => void; onCancelDirect?: () => void; loading: boolean;
  driverGPS: ReturnType<typeof useDriverGPS>;
}) {
  const passenger = ride.seatPassengers?.[0];
  return (
    <div className="fixed top-0 left-0 right-0 bottom-[68px] z-30 flex flex-col bg-background">
      <FullScreenMap ride={ride} className="flex-1" driverGPS={driverGPS} />
      <div className="absolute top-4 left-4 right-4 z-[1000] space-y-2">
        {driverGPS.gpsStatus === "denied" && (
          <div className="bg-red-500/95 backdrop-blur-md rounded-xl px-4 py-2 text-white text-xs font-medium text-center">
            GPS отключён — разрешите доступ к геолокации в настройках
          </div>
        )}
        {driverGPS.gpsStatus === "unavailable" && (
          <div className="bg-amber-500/95 backdrop-blur-md rounded-xl px-4 py-2 text-white text-xs font-medium text-center">
            GPS недоступен — проверьте настройки устройства
          </div>
        )}
        <div className="bg-card/95 backdrop-blur-md rounded-2xl shadow-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${driverGPS.gpsStatus === "active" ? "bg-emerald-500 animate-pulse" : driverGPS.gpsStatus === "waiting" ? "bg-amber-400 animate-pulse" : "bg-red-500"}`} />
            <div>
              <p className="text-xs text-muted-foreground">Едете к пассажиру</p>
              <p className="text-sm font-bold text-foreground">{formatRoutePoint(ride.fromDistrictName, ride.fromCity)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ride.fromLat && ride.fromLng && driverGPS.gpsStatus !== "denied" && (
              <a
                href={buildYandexNavUrl(
                  driverGPS.posRef.current || (ride.fromLat && ride.fromLng ? { lat: ride.fromLat, lng: ride.fromLng } : null),
                  [],
                  ride.toLat && ride.toLng ? { lat: ride.toLat, lng: ride.toLng } : null,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center shadow-md active:scale-95 transition-transform"
              >
                <NavigationIcon className="w-5 h-5" />
              </a>
            )}
            {passenger?.phone && (
              <a href={`tel:${passenger.phone}`}
                className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center shadow-md active:scale-95 transition-transform">
                <Phone className="w-5 h-5" />
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 z-[1000]">
        <div className="bg-card rounded-t-3xl shadow-[0_-4px_30px_rgba(0,0,0,.15)]">
          <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3" />
          <div className="px-5 pt-4 pb-2">
            {passenger && (
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground text-base">{passenger.name}</p>
                  <p className="text-sm text-muted-foreground">{passenger.pickupAddress || ride.fromAddress || ride.fromCity}</p>
                </div>
                {passenger.phone && (
                  <a href={`tel:${passenger.phone}`}
                    className="w-10 h-10 rounded-full bg-muted text-foreground flex items-center justify-center border border-border active:scale-95 transition-transform">
                    <Phone className="w-4 h-4" />
                  </a>
                )}
              </div>
            )}
            {(ride.seatPassengers?.length || 0) > 1 && (
              <div className="flex gap-1.5 mb-4">
                {Array.from({ length: ride.seatsTotal || 4 }, (_, i) => i + 1).map(n => {
                  const p = ride.seatPassengers?.find(s => s.seatNumber === n);
                  return (
                    <div key={n} className={`flex-1 py-2 rounded-xl text-center text-xs font-bold ${
                      p ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground/40"
                    }`}>
                      {p ? p.name.split(" ")[0] : "—"}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex gap-3 px-5 pb-6">
            <button onClick={() => { console.log("[cancel-btn PS]", { hasExt: hasExternalPassenger, hasDirect: !!onCancelDirect }); if (hasExternalPassenger) onCancel(); else if (onCancelDirect) onCancelDirect(); else onCancel(); }} disabled={loading}
              className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20 shrink-0 active:scale-95 transition-transform disabled:opacity-50">
              <XCircle className="w-6 h-6" />
            </button>
            <button onClick={onArrived} disabled={loading}
              className="flex-1 h-14 rounded-2xl bg-emerald-500 text-white font-bold text-base shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
              {loading ? "Начинаю..." : "Я на месте — начать"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

