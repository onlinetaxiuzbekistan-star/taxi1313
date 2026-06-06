import { useState } from "react";
import { CheckCircle, TrendingUp, Users } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Ride } from "../types";
import { formatRoutePoint } from "../utils";
import { ConfettiOverlay } from "./ConfettiOverlay";

export function CompletionScreen({ ride, onClose, commissionRate = 0.15 }: { ride: Ride; onClose: () => void; commissionRate?: number }) {
  const seatPassengers = ride.seatPassengers || [];
  const seatSum = seatPassengers.reduce((sum, p) => sum + (p.price || 0), 0);
  const totalEarnings = (ride.price && ride.price > 0) ? ride.price : seatSum;
  const commission = (ride as any).commission ?? Math.round(totalEarnings * commissionRate);
  const driverIncome = totalEarnings - commission;

  return (
    <div className="fixed top-0 left-0 right-0 bottom-[68px] z-30 bg-background flex flex-col">
      <div className="bg-zinc-900 pt-12 pb-8 px-6 text-center text-white">
        <div className="w-20 h-20 rounded-full bg-white/20 mx-auto mb-4 flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-xl font-extrabold">Рейс завершён!</h2>
        <p className="text-zinc-300 text-sm mt-1">{formatRoutePoint(ride.fromDistrictName, ride.fromCity)} → {formatRoutePoint(ride.toDistrictName, ride.toCity)}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 -mt-4">
        <div className="bg-card rounded-2xl shadow-lg border border-border p-5 mb-4">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Стоимость рейса</span>
              <span className="text-base font-bold text-foreground">{formatCurrency(totalEarnings)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Комиссия платформы ({Math.round(commissionRate * 100)}%)</span>
              <span className="text-base font-semibold text-red-500">−{formatCurrency(commission)}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex justify-between items-center">
              <span className="text-base font-bold text-foreground">Ваш доход</span>
              <span className="text-xl font-extrabold text-foreground">{formatCurrency(driverIncome)}</span>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border p-4 mb-4">
          <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Детали рейса</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-bold text-foreground">{ride.distance || "—"}</p>
              <p className="text-[12px] text-muted-foreground">км</p>
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{ride.duration || "—"}</p>
              <p className="text-[12px] text-muted-foreground">минут</p>
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{seatPassengers.length || ride.passengers}</p>
              <p className="text-[12px] text-muted-foreground">пассажиров</p>
            </div>
          </div>
        </div>

        {seatPassengers.length > 0 && (
          <div className="bg-card rounded-2xl shadow-sm border border-border p-4 mb-4">
            <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-wider mb-3">Пассажиры</p>
            <div className="space-y-2">
              {seatPassengers.map(p => (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted text-foreground flex items-center justify-center text-xs font-bold shrink-0">
                    {p.seatNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{formatCurrency(p.price)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 pb-6 pt-2">
        <button onClick={onClose}
          className="w-full h-14 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold text-base shadow-lg active:scale-[0.97] transition-transform">
          Готово
        </button>
      </div>
    </div>
  );
}


