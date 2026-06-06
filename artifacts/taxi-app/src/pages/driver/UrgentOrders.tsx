import { useState, useEffect, useCallback, useRef } from "react";
import DriverLayout from "./DriverLayout";
import { useAuth } from "@/hooks/use-auth";
import {
  Zap, Clock, Users, Package, Loader2, RefreshCw, Phone,
  CheckCircle, ShoppingBag, MapPin, Banknote, Percent, ArrowDown, Car, Plus
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useCommissionRate } from "@/hooks/use-commission-rate";
import { useLocation } from "wouter";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface CityInfo {
  id: string;
  name: string;
  nameRu: string;
  lat: number;
  lng: number;
}

interface MarketplaceListing {
  id: number;
  rideId?: number | null;
  price: number;
  comment?: string | null;
  fromCity: string;
  toCity: string;
  fromDistrictName?: string | null;
  toDistrictName?: string | null;
  scheduledAt: string;
  passengers?: number;
  seatsCount?: number;
  clientName?: string | null;
  clientPhone?: string | null;
  carClass?: string;
  sellerName?: string;
  sellerCar?: string;
  sellerRating?: string | null;
}

function seatWord(n: number) {
  if (n === 1) return "место";
  if (n >= 2 && n <= 4) return "места";
  return "мест";
}

function formatTimeRange(scheduledAt: string) {
  const d = new Date(scheduledAt);
  const h = d.getHours();
  const m = d.getMinutes();
  const pad = (v: number) => String(v).padStart(2, "0");
  const from = `${pad(h)}:${pad(m)}`;
  const end = new Date(d.getTime() + 30 * 60000);
  const to = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${from} – ${to}`;
}

export default function UrgentOrders() {
  const { token, refreshUser } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const COMMISSION_RATE = useCommissionRate();
  const [orders, setOrders] = useState<any[]>([]);
  const [marketListings, setMarketListings] = useState<MarketplaceListing[]>([]);
  const [cities, setCities] = useState<CityInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [acceptedIds, setAcceptedIds] = useState<Set<number>>(new Set());
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [hasActiveRide, setHasActiveRide] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${BASE_URL}/api/rides/cities`).then(r => r.json()).then(d => setCities(d.cities || [])).catch(() => {});
    if (token) {
      fetch(`${BASE_URL}/api/drivers/my-active-ride`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setHasActiveRide(!!(d.ride && d.ride.id)))
        .catch(() => setHasActiveRide(false));
    }
  }, [token]);

  const initialLoadDone = useRef(false);
  const loadOrders = useCallback(async (showRefresh = false) => {
    if (!token) return;
    if (showRefresh) setRefreshing(true);
    else if (!initialLoadDone.current) setLoading(true);
    try {
      const [urgentRes, mpRes] = await Promise.all([
        fetch(`${BASE_URL}/api/rides/urgent`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BASE_URL}/api/marketplace/listings`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (urgentRes.ok) {
        const data = await urgentRes.json();
        const sorted = (data.rides || []).sort((a: any, b: any) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        );
        setOrders(sorted);
      }
      if (mpRes.ok) {
        const data = await mpRes.json();
        setMarketListings(data.listings || []);
      }
    } catch {}
    initialLoadDone.current = true;
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  const loadOrdersRef = useRef(loadOrders);
  loadOrdersRef.current = loadOrders;

  useEffect(() => { loadOrders(); const iv = setInterval(() => loadOrdersRef.current(), 30000); return () => clearInterval(iv); }, [loadOrders]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (!msg) return;
      if (msg.type === "new_ride" || msg.type === "ride_updated" || msg.type === "ride_accepted" ||
          msg.type === "marketplace_listing_sold" || msg.type === "marketplace_new_listing" ||
          msg.type === "offer_expired" || msg.type === "ride_cancelled") {
        loadOrdersRef.current();
      }
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, []);

  const handleAccept = async (orderId: number) => {
    if (acceptingId) return;
    setAcceptingId(orderId);
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rideId: orderId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Заказ принят!" });
        setAcceptedIds(prev => new Set(prev).add(orderId));
        refreshUser();
        loadOrders(true);
      } else {
        toast({ variant: "destructive", title: data.message || "Не удалось принять заказ" });
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети" });
    }
    setAcceptingId(null);
  };

  const handleBuyListing = async (listingId: number) => {
    if (buyingId) return;
    setBuyingId(listingId);
    try {
      const res = await fetch(`${BASE_URL}/api/marketplace/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Заказ куплен!" });
        refreshUser();
        loadOrders(true);
      } else {
        toast({ variant: "destructive", title: data.message || "Ошибка покупки" });
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети" });
    }
    setBuyingId(null);
  };

  const fromCityName = (id: string) => cities.find(c => c.id === id)?.nameRu || id;
  const cityWithDistrict = (city: string, district?: string | null) => district ? `${district} (${fromCityName(city)})` : fromCityName(city);

  const [activeTab, setActiveTab] = useState<"urgent" | "market">("urgent");

  return (
    <DriverLayout>
      <div className="px-4 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-foreground">Срочные и Маркет</h1>
              <p className="text-[11px] text-muted-foreground">Заказы и предложения от водителей</p>
            </div>
          </div>
          <button
            onClick={() => loadOrders(true)}
            disabled={refreshing}
            className="w-9 h-9 rounded-full bg-muted flex items-center justify-center active:scale-90 transition-all"
          >
            <RefreshCw className={`w-4 h-4 text-foreground ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="flex gap-1 bg-muted rounded-xl p-1">
          <button
            onClick={() => setActiveTab("urgent")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "urgent"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Срочные
            {orders.length > 0 && (
              <span className={`min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 ${
                activeTab === "urgent" ? "bg-red-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
              }`}>
                {orders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("market")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "market"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            Маркет
            {marketListings.length > 0 && (
              <span className={`min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 ${
                activeTab === "market" ? "bg-primary text-white" : "bg-muted-foreground/20 text-muted-foreground"
              }`}>
                {marketListings.length}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-10 h-10 text-muted-foreground animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          </div>
        ) : activeTab === "urgent" ? (
          hasActiveRide === false ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Car className="w-8 h-8 text-primary" />
              </div>
              <p className="text-base font-bold text-foreground mb-2">Сначала создайте рейс</p>
              <p className="text-sm text-muted-foreground mb-6 px-4">
                Чтобы видеть срочные заказы, нужно сначала создать рейс
              </p>
              <button
                onClick={() => navigate("/driver")}
                className="px-6 py-3 rounded-xl bg-primary text-white font-bold text-sm active:scale-95 transition-transform"
              >
                Создать рейс
              </button>
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="text-base font-bold text-foreground mb-1">Нет срочных заказов</p>
              <p className="text-sm text-muted-foreground">
                Заказы с выездом в ближайший час появятся здесь
              </p>
            </div>
          ) : (
          <div className="space-y-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {orders.length} {orders.length === 1 ? "заказ" : orders.length < 5 ? "заказа" : "заказов"}
                </p>
                {orders.map(order => {
                  const passengers = order.seatPassengers || [];
                  const seatCount = passengers.length || order.passengers || 0;
                  const minutesUntil = Math.max(0, Math.round((new Date(order.scheduledAt).getTime() - Date.now()) / 60000));
                  const isAccepting = acceptingId === order.id;
                  const isAccepted = acceptedIds.has(order.id);
                  const totalPrice = order.price || 0;
                  const commission = Math.round(totalPrice * COMMISSION_RATE);
                  const driverEarning = totalPrice - commission;

                  return (
                    <div key={order.id} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                      <div className={`${minutesUntil <= 10 ? "bg-red-500/15 border-b border-red-500/25" : "bg-red-500/10 border-b border-red-500/20"} px-4 py-2 flex items-center justify-between`}>
                        <div className="flex items-center gap-2">
                          <Zap className="w-3.5 h-3.5 text-red-600" />
                          <span className="text-xs font-bold text-red-700">СРОЧНЫЙ #{order.id}</span>
                        </div>
                        <div className={`text-sm font-extrabold ${minutesUntil <= 10 ? "text-red-600 animate-pulse" : "text-zinc-600"}`}>
                          {minutesUntil > 0 ? `через ${minutesUntil} мин` : "СЕЙЧАС"}
                        </div>
                      </div>

                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="w-3 h-3 rounded-full bg-zinc-900 ring-2 ring-zinc-300" />
                            <div className="w-px h-6 border-l-2 border-dashed border-border" />
                            <div className="w-3 h-3 rounded-full bg-red-500 ring-2 ring-red-500/20" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div>
                              <p className="text-sm font-bold text-foreground">{cityWithDistrict(order.fromCity, order.fromDistrictName)}</p>
                              {order.fromAddress && <p className="text-[11px] text-muted-foreground truncate">{order.fromAddress}</p>}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-foreground">{cityWithDistrict(order.toCity, order.toDistrictName)}</p>
                              {order.toAddress && <p className="text-[11px] text-muted-foreground truncate">{order.toAddress}</p>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-lg">
                            <Users className="w-3.5 h-3.5" />
                            {seatCount} {seatWord(seatCount)}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-lg">
                            <Package className="w-3.5 h-3.5" />
                            {order.carClass || "economy"}
                          </span>
                          {order.scheduledAt && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-lg">
                              <Clock className="w-3.5 h-3.5" />
                              {formatTimeRange(order.scheduledAt)}
                            </span>
                          )}
                        </div>

                        <div className="bg-muted/50 rounded-xl p-3 space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                              <Banknote className="w-3.5 h-3.5" />
                              Стоимость
                            </span>
                            <span className="font-bold text-foreground">{formatCurrency(totalPrice)}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                              <Percent className="w-3.5 h-3.5" />
                              Комиссия ({Math.round(COMMISSION_RATE * 100)}%)
                            </span>
                            <span className="font-medium text-red-500">−{formatCurrency(commission)}</span>
                          </div>
                          <div className="border-t border-border/50 pt-1.5 flex items-center justify-between">
                            <span className="text-sm font-bold text-foreground flex items-center gap-1.5">
                              <ArrowDown className="w-3.5 h-3.5 text-zinc-700" />
                              Вы получите
                            </span>
                            <span className="text-lg font-extrabold text-zinc-900">{formatCurrency(driverEarning)}</span>
                          </div>
                        </div>

                        {isAccepted && order.riderName && (
                          <div className="flex items-center gap-2 text-xs bg-zinc-100 border border-zinc-200 rounded-xl px-3 py-2.5">
                            <MapPin className="w-3.5 h-3.5 text-zinc-600" />
                            <span className="font-semibold text-foreground">{order.riderName}</span>
                            {order.riderPhone && (
                              <a href={`tel:${order.riderPhone}`} className="ml-auto text-zinc-700 font-bold flex items-center gap-1 bg-zinc-200 px-2.5 py-1 rounded-lg">
                                <Phone className="w-3.5 h-3.5" />
                                {order.riderPhone}
                              </a>
                            )}
                          </div>
                        )}
                        {!isAccepted && order.riderName && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-xl px-3 py-2.5">
                            <MapPin className="w-3.5 h-3.5" />
                            <span>{order.riderName}</span>
                            <span className="ml-auto text-xs text-muted-foreground/60 italic">Номер скрыт</span>
                          </div>
                        )}

                        {isAccepted ? (
                          <div className="w-full py-3.5 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-700 font-bold text-base flex items-center justify-center gap-2">
                            <CheckCircle className="w-5 h-5" />
                            Заказ принят
                          </div>
                        ) : (
                          <button
                            onClick={() => handleAccept(order.id)}
                            disabled={isAccepting || isAccepted}
                            className="w-full py-4 rounded-xl bg-zinc-900 text-white font-bold text-base shadow-lg active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {isAccepting ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Принимаю...
                              </>
                            ) : (
                              <>
                                <CheckCircle className="w-5 h-5" />
                                Принять • {formatCurrency(driverEarning)}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
          </div>
          )
        ) : activeTab === "market" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => navigate("/driver/marketplace?tab=create")}
                className="flex flex-col items-center gap-2 py-5 rounded-2xl bg-card border border-border shadow-sm active:scale-[0.97] transition-transform"
              >
                <div className="w-11 h-11 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-emerald-600" />
                </div>
                <span className="text-sm font-bold text-foreground">Создать заказ</span>
              </button>
              <button
                onClick={() => navigate("/driver/marketplace?tab=history")}
                className="flex flex-col items-center gap-2 py-5 rounded-2xl bg-card border border-border shadow-sm active:scale-[0.97] transition-transform"
              >
                <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-blue-600" />
                </div>
                <span className="text-sm font-bold text-foreground">История заказов</span>
              </button>
            </div>

            {marketListings.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <ShoppingBag className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-bold text-foreground mb-1">Нет предложений</p>
                <p className="text-xs text-muted-foreground">
                  Заказы от других водителей появятся здесь
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {marketListings.length} {marketListings.length === 1 ? "предложение" : marketListings.length < 5 ? "предложения" : "предложений"}
                </p>
                {marketListings.map(listing => (
                  <MarketplaceCard
                    key={`mp-${listing.id}`}
                    listing={listing}
                    cityName={fromCityName}
                    onBuy={() => handleBuyListing(listing.id)}
                    buying={buyingId === listing.id}
                    disabled={!!buyingId}
                  />
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
    </DriverLayout>
  );
}

function MarketplaceCard({
  listing, cityName, onBuy, buying, disabled,
}: {
  listing: MarketplaceListing;
  cityName: (id: string) => string;
  onBuy: () => void;
  buying: boolean;
  disabled: boolean;
}) {
  const seatCount = listing.seatsCount || listing.passengers || 0;
  return (
    <div className="bg-card rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="bg-zinc-100 border-b border-zinc-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-3.5 h-3.5 text-zinc-600" />
          <span className="text-xs font-bold text-zinc-700">В ПРОДАЖЕ</span>
        </div>
        {listing.sellerName && (
          <span className="text-[11px] text-zinc-600 font-medium">{listing.sellerName}</span>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-3 h-3 rounded-full bg-zinc-900" />
            <div className="w-px h-5 bg-border" />
            <div className="w-3 h-3 rounded-full bg-red-500" />
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="text-sm font-bold text-foreground">{cityName(listing.fromCity)}</p>
            <p className="text-sm font-bold text-foreground">{cityName(listing.toCity)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-lg">
            <Users className="w-3.5 h-3.5" />
            {seatCount} {seatWord(seatCount)}
          </span>
          {listing.carClass && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-zinc-100 text-zinc-700 px-2.5 py-1 rounded-lg">
              <Package className="w-3.5 h-3.5" />
              {listing.carClass}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="text-xs text-muted-foreground">Цена</div>
          <p className="text-lg font-extrabold text-foreground">{formatCurrency(listing.price)}</p>
        </div>

        {listing.comment && (
          <p className="text-xs text-muted-foreground italic">«{listing.comment}»</p>
        )}

        <button
          onClick={onBuy}
          disabled={disabled}
          className="w-full py-3.5 rounded-xl bg-zinc-900 text-white font-bold text-base shadow-lg active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {buying ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Покупаю...
            </>
          ) : (
            <>
              <ShoppingBag className="w-5 h-5" />
              Взять за {formatCurrency(listing.price)}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
