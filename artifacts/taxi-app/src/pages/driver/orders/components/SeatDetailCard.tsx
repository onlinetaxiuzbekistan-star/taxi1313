import { useState } from "react";
import { Phone, MapPin, Package, X, Loader2, Zap, XCircle } from "lucide-react";
import { PassengerAvatar } from "./PassengerAvatar";
import type { SeatPassenger } from "../types";
import { formatCurrency } from "@/lib/utils";
import { BAGGAGE_LABELS } from "../constants";

export function SeatDetailCard({ passenger, onClose, onReject, rejectLoading }: {
  passenger: SeatPassenger;
  onClose: () => void;
  onReject?: (passengerId: number) => void;
  rejectLoading?: boolean;
}) {
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const canReject = passenger.status === "waiting" && onReject;
  const isManual = passenger.source === "manual";
  const isFemale = passenger.gender === "female";
  const headerGradient = "from-zinc-800 to-zinc-900";

  return (
    <div className="mx-4 animate-in slide-in-from-bottom-3 duration-300">
      <div className="bg-card rounded-2xl border border-border shadow-xl overflow-hidden">
        <div className={`bg-gradient-to-r ${headerGradient} px-4 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-foreground/20 flex items-center justify-center backdrop-blur-sm">
              <PassengerAvatar gender={passenger.gender} size={22} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-bold text-white text-sm">{passenger.name}</p>
                <span className="text-[9px] font-bold bg-foreground/20 text-white/90 px-1.5 py-0.5 rounded-full">
                  {isFemale ? "👩" : "👨"}
                </span>
                {isManual && (
                  <span className="text-[9px] font-bold bg-foreground/20 text-white/90 px-1.5 py-0.5 rounded-full">ручной</span>
                )}
              </div>
              <p className="text-[13px] text-white/80">Место {passenger.seatNumber} • {formatCurrency(passenger.price)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-foreground/15 backdrop-blur-sm active:scale-90 transition-all">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {passenger.phone && (
            <a href={`tel:${passenger.phone}`}
              className="flex items-center gap-3 bg-muted border border-border rounded-xl px-4 py-3 active:scale-[0.97] transition-transform">
              <div className="w-9 h-9 rounded-full bg-zinc-900 dark:bg-zinc-700 flex items-center justify-center shrink-0">
                <Phone className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Позвонить</p>
                <p className="text-sm font-bold text-foreground">{passenger.phone}</p>
              </div>
            </a>
          )}

          {(passenger.pickupAddress || passenger.dropoffAddress) && (
            <div className="bg-muted rounded-xl p-3 space-y-2.5">
              {passenger.pickupAddress && (
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <div className="w-2 h-2 rounded-full bg-foreground" />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-muted-foreground uppercase">Откуда</p>
                    <p className="text-xs text-foreground font-medium">{passenger.pickupAddress}</p>
                  </div>
                </div>
              )}
              {passenger.dropoffAddress && (
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-muted-foreground uppercase">Куда</p>
                    <p className="text-xs text-foreground font-medium">{passenger.dropoffAddress}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {passenger.baggageType && passenger.baggageType !== "none" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2">
              <Package className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">{BAGGAGE_LABELS[passenger.baggageType] || passenger.baggageType}</span>
            </div>
          )}

          {canReject && !showRejectConfirm && (
            <button
              onClick={() => setShowRejectConfirm(true)}
              className="w-full py-3 rounded-xl bg-red-500/10 text-red-600 font-bold text-sm border border-red-500/20 active:scale-[0.97] transition-transform flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              Отклонить пассажира
            </button>
          )}

          {showRejectConfirm && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-2 animate-in fade-in duration-200">
              <p className="text-sm font-bold text-red-600 text-center">Отклонить {passenger.name}?</p>
              <p className="text-xs text-muted-foreground text-center">Пассажир будет удалён из рейса, место освободится</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRejectConfirm(false)}
                  className="flex-1 py-2.5 rounded-lg bg-muted text-foreground font-medium text-sm active:scale-[0.97] transition-transform"
                >
                  Отмена
                </button>
                <button
                  onClick={() => { onReject!(passenger.id); setShowRejectConfirm(false); }}
                  disabled={rejectLoading}
                  className="flex-1 py-2.5 rounded-lg bg-red-500 text-white font-bold text-sm active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {rejectLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  Отклонить
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

