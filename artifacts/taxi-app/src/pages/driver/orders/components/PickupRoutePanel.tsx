import { useState } from "react";
import { MapPin, Phone, Navigation as NavigationIcon, ChevronDown } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Ride, SeatPassenger, PickupRouteData } from "../types";
import { FullScreenMap } from "./FullScreenMap";

interface PickupRoutePanelProps {
  ride: Ride;
  passengers: SeatPassenger[];
  pickupRoute: PickupRouteData;
  toCityName: string;
  token?: string | null;
}

export function PickupRoutePanel({ ride, passengers, pickupRoute, toCityName, token }: PickupRoutePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [showMap, setShowMap] = useState(false);

  return (
    <>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-muted border border-border active:bg-secondary transition-colors">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-bold text-foreground">Маршрут подбора</span>
          <span className="text-[12px] text-muted-foreground">{pickupRoute.totalDistance} км • ~{pickupRoute.totalDuration} мин</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="bg-card rounded-xl border border-border p-3 animate-in slide-in-from-top-2 duration-200">
          {pickupRoute.stops.map((stop, idx) => {
            const matchedPassenger = passengers.find(p => p.id === stop.passengerId);
            const isLast = idx === pickupRoute.stops.length - 1;
            return (
              <div key={stop.passengerId} className="flex gap-2.5">
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-zinc-900 dark:bg-zinc-200 flex items-center justify-center text-white dark:text-zinc-900 text-[12px] font-bold shrink-0">
                    {stop.order}
                  </div>
                  {!isLast && <div className="w-0.5 flex-1 min-h-[12px] bg-border my-0.5" />}
                </div>
                <div className={`flex-1 min-w-0 ${!isLast ? "pb-2" : ""}`}>
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-bold text-foreground truncate">{stop.name || `Место ${stop.seatNumber}`}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      {matchedPassenger?.price ? <span className="text-[12px] font-bold text-muted-foreground">{formatCurrency(matchedPassenger.price)}</span> : null}
                      {stop.phone && (
                        <a href={`tel:${stop.phone}`} className="w-6 h-6 rounded bg-muted flex items-center justify-center active:scale-90">
                          <Phone className="w-3 h-3 text-foreground" />
                        </a>
                      )}
                    </div>
                  </div>
                  <p className="text-[12px] text-muted-foreground truncate">{stop.pickupAddress || `Место ${stop.seatNumber}`}</p>
                </div>
              </div>
            );
          })}
          <div className="flex gap-2.5 mt-1">
            <div className="flex flex-col items-center">
              <div className="w-0.5 h-2 bg-red-300" />
              <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white shrink-0">
                <NavigationIcon className="w-3 h-3" />
              </div>
            </div>
            <div className="flex-1 min-w-0 pt-2">
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Назначение</p>
              <p className="text-xs font-bold text-foreground">{toCityName}</p>
            </div>
          </div>

          {showMap && (
            <div className="rounded-lg overflow-hidden border border-border mt-2" style={{ height: 160 }}>
              <FullScreenMap ride={ride} className="h-full" pickupRoute={pickupRoute} token={token} />
            </div>
          )}
          <button onClick={() => setShowMap(!showMap)}
            className="w-full mt-2 text-[12px] text-muted-foreground font-bold py-1.5 rounded-lg bg-muted border border-border active:bg-secondary">
            {showMap ? "Скрыть карту" : "Показать карту"}
          </button>
        </div>
      )}
    </>
  );
}
