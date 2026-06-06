import { memo } from "react";
import { ShoppingBag, Loader2, Users, Package, Clock, Calendar } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CityInfo } from "../types";

function fmtScheduled(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function fmtRelative(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso); if (isNaN(d.getTime())) return "";
    const diff = Math.max(0, Date.now() - d.getTime());
    const m = Math.floor(diff / 60000);
    if (m < 1) return "только что";
    if (m < 60) return `${m} мин назад`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ч назад`;
    const days = Math.floor(h / 24);
    return `${days} дн назад`;
  } catch { return ""; }
}

export const MarketListingCard = memo(function MarketListingCard({ listing, cities, onBuyListing, isBuying }: {
  listing: any;
  cities: CityInfo[];
  onBuyListing?: (id: number) => void;
  isBuying: boolean;
}) {
  const fromName = cities.find(c => c.id === listing.fromCity)?.nameRu || listing.fromCity;
  const toName = cities.find(c => c.id === listing.toCity)?.nameRu || listing.toCity;
  const scheduledIso = listing.scheduledAt || listing.rideScheduledAt;
  const createdIso = listing.createdAt;
  const timeSlot = listing.timeSlot || listing.rideTimeSlot;
  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="bg-muted border-b border-border px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-bold text-foreground">В ПРОДАЖЕ</span>
        </div>
        {listing.sellerName && (
          <span className="text-[13px] text-muted-foreground font-medium">{listing.sellerName}</span>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-3 h-3 rounded-full bg-zinc-900" />
            <div className="w-px h-5 bg-border" />
            <div className="w-3 h-3 rounded-full bg-zinc-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">{fromName} → {toName}</p>
          </div>
        </div>

        {(timeSlot || scheduledIso || createdIso) && (
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
            {(timeSlot || scheduledIso) && (
              <div className="flex items-center gap-1.5 text-foreground/80">
                <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="truncate"><span className="text-muted-foreground">Рейс:</span> {timeSlot || fmtScheduled(scheduledIso)}</span>
              </div>
            )}
            {createdIso && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="w-3 h-3 shrink-0" />
                <span className="truncate"><span>Создан:</span> {fmtRelative(createdIso)}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{listing.seatsCount || listing.passengers || 0} мест</span>
            {listing.carClass && (
              <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" />{listing.carClass}</span>
            )}
          </div>
          <p className="text-lg font-extrabold text-foreground">{formatCurrency(listing.price)}</p>
        </div>
        {listing.comment && (
          <p className="text-xs text-muted-foreground italic">«{listing.comment}»</p>
        )}
        <button
          onClick={() => onBuyListing?.(listing.id)}
          disabled={isBuying}
          className="w-full py-3.5 rounded-xl bg-zinc-900 text-white font-bold text-base shadow-lg active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isBuying ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Покупаю...</>
          ) : (
            <><ShoppingBag className="w-5 h-5" /> Взять за {formatCurrency(listing.price)}</>
          )}
        </button>
      </div>
    </div>
  );
});
