import { Phone, XCircle, X } from "lucide-react";
import { PassengerAvatar } from "./PassengerAvatar";
import { formatCurrency } from "@/lib/utils";
import type { SeatPassenger } from "../types";

interface SeatPassengerCardProps {
  passenger: SeatPassenger;
  onClose: () => void;
  onRejectClient?: (id: number) => void;
  clientActionLoading?: boolean;
}

export function SeatPassengerCard({ passenger, onClose, onRejectClient, clientActionLoading }: SeatPassengerCardProps) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            passenger.gender === "female"
              ? "bg-pink-100 dark:bg-pink-900/40"
              : "bg-blue-100 dark:bg-blue-900/40"
          }`}>
            <PassengerAvatar
              gender={passenger.gender}
              size={18}
              className={
                passenger.gender === "female"
                  ? "text-pink-600 dark:text-pink-400"
                  : "text-blue-600 dark:text-blue-400"
              }
            />
          </div>
          <div>
            <p className="text-sm font-bold">{passenger.name}</p>
            <p className="text-[12px] text-muted-foreground">Место {passenger.seatNumber} • {formatCurrency(passenger.price)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {passenger.phone && (
            <a href={`tel:${passenger.phone}`} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center active:scale-90">
              <Phone className="w-3.5 h-3.5 text-foreground" />
            </a>
          )}
          {onRejectClient && passenger.status === "waiting" && (
            <button onClick={() => { onRejectClient(passenger.id); onClose(); }}
              disabled={clientActionLoading}
              className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center active:scale-90 disabled:opacity-50">
              <XCircle className="w-3.5 h-3.5 text-red-500" />
            </button>
          )}
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center active:scale-90">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
      {(passenger.pickupAddress || passenger.dropoffAddress) && (
        <div className="px-3 py-2 space-y-1">
          {passenger.pickupAddress && (
            <div className="flex items-center gap-2 text-[13px]">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              <span className="text-muted-foreground truncate">{passenger.pickupAddress}</span>
            </div>
          )}
          {passenger.dropoffAddress && (
            <div className="flex items-center gap-2 text-[13px]">
              <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              <span className="text-muted-foreground truncate">{passenger.dropoffAddress}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
