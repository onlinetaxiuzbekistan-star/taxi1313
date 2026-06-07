import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Clock, ArrowRight, Loader2, Car, ShoppingBag, Zap, TrendingUp, Users, Navigation as NavigationIcon, ChevronDown, X, Check } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CityInfo, Ride, QueueInfoData } from "../types";
import { BASE_URL } from "../constants";
import { haversineKm } from "../utils";
import { QueueWidget } from "./QueueWidget";
import { MarketListingCard } from "./MarketListingCard";
import { useAuth } from "@/hooks/use-auth";
import { useSettingsStore } from "@/stores/settings";

export function RouteSelectScreen({ cities, routes, onCreateRide, creating, marketListings, onBuyListing, buyingId }: {
  cities: CityInfo[];
  routes: { fromCity: string; toCity: string }[];
  onCreateRide: (fromCity: string, toCity: string, departureTime: string, urgent?: boolean, timeSlotLabel?: string) => void;
  creating: boolean;
  marketListings?: any[];
  onBuyListing?: (listingId: number) => void;
  buyingId?: number | null;
}) {
  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [urgentMode, setUrgentMode] = useState(false);
  const [gpsDetecting, setGpsDetecting] = useState(true);
  const [gpsCity, setGpsCity] = useState<string | null>(null);
  const gpsAttempted = useRef(false);

  useEffect(() => {
    if (gpsAttempted.current || cities.length === 0 || routes.length === 0) return;
    gpsAttempted.current = true;

    if (!navigator.geolocation) { setGpsDetecting(false); return; }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        let nearestCity: CityInfo | null = null;
        let nearestDist = Infinity;
        for (const c of cities) {
          if (!c.lat || !c.lng) continue;
          const d = haversineKm(latitude, longitude, c.lat, c.lng);
          if (d < nearestDist) { nearestDist = d; nearestCity = c; }
        }
        if (nearestCity && nearestDist <= 30) {
          const hasRoute = routes.some(r =>
            r.fromCity === nearestCity!.nameRu || r.fromCity === nearestCity!.id ||
            r.fromCity.toLowerCase() === nearestCity!.nameRu.toLowerCase()
          );
          if (hasRoute) {
            setFromCity(nearestCity.id);
            setGpsCity(nearestCity.id);
          } else {
            let bestRouteCity: CityInfo | null = null;
            let bestRouteDist = Infinity;
            for (const c of cities) {
              if (c.id === nearestCity.id || !c.lat || !c.lng) continue;
              const cHasRoute = routes.some(r =>
                r.fromCity === c.nameRu || r.fromCity === c.id || r.fromCity.toLowerCase() === c.nameRu.toLowerCase()
              );
              if (!cHasRoute) continue;
              const d = haversineKm(latitude, longitude, c.lat, c.lng);
              if (d < bestRouteDist) { bestRouteDist = d; bestRouteCity = c; }
            }
            if (bestRouteCity && bestRouteDist <= 50) {
              setFromCity(bestRouteCity.id);
              setGpsCity(bestRouteCity.id);
            } else {
              setFromCity(nearestCity.id);
              setGpsCity(nearestCity.id);
            }
          }
        }
        setGpsDetecting(false);
      },
      () => { setGpsDetecting(false); },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );

    const fallback = setTimeout(() => setGpsDetecting(false), 9000);
    return () => clearTimeout(fallback);
  }, [cities, routes]);

  const fromCityObj = cities.find(c => c.id === fromCity);
  const fromCityNameRu = fromCityObj?.nameRu || "";

  const matchesFromCity = (routeFrom: string) =>
    routeFrom === fromCityNameRu || routeFrom === fromCity || routeFrom.toLowerCase() === fromCityNameRu.toLowerCase();

  const matchesCityTo = (routeTo: string, city: CityInfo) =>
    routeTo === city.nameRu || routeTo === city.id || routeTo.toLowerCase() === city.nameRu.toLowerCase();

  const destinationCities = (() => {
    if (!fromCity || routes.length === 0) return cities.filter(c => c.id !== fromCity);
    const matchingRoutes = routes.filter(r => matchesFromCity(r.fromCity));
    if (matchingRoutes.length === 0) return cities.filter(c => c.id !== fromCity);
    return cities.filter(c => matchingRoutes.some(r => matchesCityTo(r.toCity, c)));
  })();

  useEffect(() => {
    if (!fromCity || routes.length === 0) return;
    const matchingRoutes = routes.filter(r => matchesFromCity(r.fromCity));
    const destCityObjs = cities.filter(c => matchingRoutes.some(r => matchesCityTo(r.toCity, c)));
    if (destCityObjs.length === 1) {
      setToCity(destCityObjs[0].id);
    } else if (toCity) {
      const toCityObj = cities.find(c => c.id === toCity);
      if (toCityObj && !matchingRoutes.some(r => matchesCityTo(r.toCity, toCityObj)) && destCityObjs.length > 0) {
        setToCity("");
      }
    }
  }, [fromCity, routes]);

  const timeSlotsData = (() => {
    const items: { label: string; dep: Date }[] = [];
    const now = new Date();
    const baseStartHour = now.getHours() - (now.getHours() % 2);
    const base = new Date(now);
    base.setHours(baseStartHour, 0, 0, 0);
    for (let i = 0; i < 12; i++) {
      const dep = new Date(base.getTime() + i * 2 * 60 * 60 * 1000);
      const h = dep.getHours();
      const end = (h + 2) % 24;
      const label = `${String(h).padStart(2, "0")}:00–${String(end).padStart(2, "0")}:00`;
      items.push({ label, dep });
    }
    return items;
  })();
  const timeSlots = timeSlotsData.map(x => x.label);

  const canCreate = fromCity && toCity && fromCity !== toCity && (urgentMode || !!timeSlot);

  const handleCreate = () => {
    if (!canCreate) return;
    if (urgentMode) {
      onCreateRide(fromCity, toCity, "", true);
      return;
    }
    if (!timeSlot) return;
    const slotLabel = timeSlot.replace("–", "-");
    const found = timeSlotsData.find(x => x.label === timeSlot);
    const depTime = (found ? found.dep : new Date()).toISOString();
    onCreateRide(fromCity, toCity, depTime, false, slotLabel);
  };

  const fromCityName = fromCityNameRu;
  const toCityName = cities.find(c => c.id === toCity)?.nameRu;

  return (
    <div className="px-4 pt-4 pb-32 space-y-5">
      <div className="text-center py-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 mx-auto mb-3 flex items-center justify-center">
          <Car className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-lg font-extrabold text-foreground">Создать рейс</h2>
        {gpsDetecting ? (
          <div className="flex items-center justify-center gap-2 mt-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Определяем ваш город...</p>
          </div>
        ) : fromCity && toCity ? (
          <p className="text-sm text-muted-foreground mt-1">Маршрут определён автоматически</p>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">Выберите маршрут и время отправления</p>
        )}
      </div>

      {gpsDetecting ? (
        <div className="flex flex-col items-center py-8">
          <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center mb-4 animate-pulse">
            <NavigationIcon className="w-10 h-10 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">Определяем местоположение...</p>
        </div>
      ) : (
        <>
          {fromCity && toCity && gpsCity === fromCity && (
            <div className="bg-zinc-900 rounded-2xl p-4 text-white">
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center">
                    <NavigationIcon className="w-2.5 h-2.5 text-zinc-900" />
                  </div>
                  <div className="w-px h-6 bg-zinc-600" />
                  <div className="w-4 h-4 rounded-full bg-zinc-500" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-zinc-400 font-medium">Ваш город</p>
                  <p className="text-lg font-extrabold text-white">{fromCityName}</p>
                  <div className="h-2" />
                  <p className="text-xs text-zinc-400 font-medium">Направление</p>
                  <p className="text-lg font-extrabold text-white">{toCityName}</p>
                </div>
                <button onClick={() => { setFromCity(""); setToCity(""); setGpsCity(null); }}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/15 transition-colors">
                  <X className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
            </div>
          )}

          {(!fromCity || !toCity || gpsCity !== fromCity) && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Откуда</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-foreground" />
                  {gpsCity === fromCity && fromCity ? (
                    <div className="w-full pl-8 pr-3 py-3 rounded-xl border border-border bg-muted text-sm font-medium flex items-center gap-2">
                      <span className="flex-1">{fromCityName}</span>
                      <span className="text-[12px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full font-bold">GPS</span>
                    </div>
                  ) : (
                    <>
                      <select value={fromCity} onChange={e => { setFromCity(e.target.value); setToCity(""); }}
                        className="w-full pl-8 pr-3 py-3 rounded-xl border border-border bg-background text-sm font-medium appearance-none">
                        <option value="">Выберите город</option>
                        {cities.map(c => <option key={c.id} value={c.id}>{c.nameRu}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </>
                  )}
                </div>
              </div>

              <div className="flex justify-center">
                <ArrowRight className="w-5 h-5 text-muted-foreground/40" />
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Куда {destinationCities.length > 0 && fromCity && routes.length > 0 && (
                    <span className="text-primary/60 normal-case">({destinationCities.length} {destinationCities.length === 1 ? "направление" : "направлений"})</span>
                  )}
                </label>
                {fromCity && destinationCities.length <= 4 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {destinationCities.map(c => (
                      <button key={c.id} onClick={() => setToCity(toCity === c.id ? "" : c.id)}
                        className={`py-3 px-3 rounded-xl text-sm font-bold border-2 transition-all active:scale-95 text-left ${
                          toCity === c.id
                            ? "bg-red-500 text-white border-red-500 shadow-lg shadow-red-500/20"
                            : "bg-card text-foreground border-border hover:border-red-500/30"
                        }`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${toCity === c.id ? "bg-white" : "bg-red-500"}`} />
                          {c.nameRu}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-red-500" />
                    <select value={toCity} onChange={e => setToCity(e.target.value)}
                      className="w-full pl-8 pr-3 py-3 rounded-xl border border-border bg-background text-sm font-medium appearance-none">
                      <option value="">Выберите город</option>
                      {destinationCities.map(c => <option key={c.id} value={c.id}>{c.nameRu}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Тип рейса: обычный с интервалом или только срочные */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setUrgentMode(false)}
              className={`py-2.5 rounded-xl text-xs font-bold border-2 transition-all active:scale-95 ${
                !urgentMode ? "bg-primary text-white border-primary" : "bg-card text-foreground border-border"
              }`}>
              По времени
            </button>
            <button onClick={() => { setUrgentMode(true); setTimeSlot(""); }}
              className={`py-2.5 rounded-xl text-xs font-bold border-2 transition-all active:scale-95 flex items-center justify-center gap-1 ${
                urgentMode ? "bg-amber-500 text-white border-amber-500" : "bg-card text-foreground border-border"
              }`}>
              <Zap className="w-3.5 h-3.5" /> Только срочные
            </button>
          </div>

          {!urgentMode && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <Clock className="w-4 h-4 text-primary" />
                <label className="text-sm font-bold text-foreground">Время отправления</label>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {timeSlots.map(slot => {
                  const selected = timeSlot === slot;
                  const [start, end] = slot.split("–");
                  return (
                    <button key={slot} onClick={() => setTimeSlot(selected ? "" : slot)}
                      className={`relative flex items-center gap-2.5 py-3 pl-2.5 pr-3 rounded-2xl border transition-all active:scale-95 ${
                        selected
                          ? "bg-emerald-500/15 border-emerald-500 ring-1 ring-emerald-500/40"
                          : "bg-card border-border hover:border-emerald-500/40"
                      }`}>
                      <div className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-colors ${selected ? "bg-emerald-500 text-white" : "bg-secondary text-muted-foreground"}`}>
                        <Clock className="w-4 h-4" />
                      </div>
                      <div className="flex items-center gap-1 leading-tight">
                        <span className={`text-[15px] font-extrabold tabular-nums ${selected ? "text-emerald-400" : "text-foreground"}`}>{start}</span>
                        <span className={`text-[13px] font-bold ${selected ? "text-emerald-400/50" : "text-muted-foreground"}`}>–</span>
                        <span className={`text-[15px] font-extrabold tabular-nums ${selected ? "text-emerald-400" : "text-foreground"}`}>{end}</span>
                      </div>
                      {selected && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {!timeSlot && (
                <p className="text-[12px] text-amber-500 mt-2.5 text-center font-medium flex items-center justify-center gap-1">
                  <Clock className="w-3 h-3" /> Выберите время отправления
                </p>
              )}
            </div>
          )}

          {urgentMode && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3">
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium leading-relaxed">
                Получаете только срочные заказы (без интервала времени) на выбранный маршрут. Время отправления — сейчас.
              </p>
            </div>
          )}

          <button onClick={handleCreate} disabled={(!fromCity || !toCity || (!urgentMode && !timeSlot)) || creating}
            className={`w-full py-4 rounded-2xl text-white font-bold text-base shadow-lg active:scale-[0.97] transition-transform disabled:opacity-40 flex items-center justify-center gap-2 ${
              urgentMode ? "bg-amber-500 shadow-amber-500/30" : "bg-emerald-500 shadow-emerald-500/30"
            }`}>
            {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : (urgentMode ? <Zap className="w-5 h-5" /> : <Car className="w-5 h-5" />)}
            {creating ? "Создаём рейс..." : (urgentMode ? "Принимать срочные" : "Начать рейс")}
          </button>
        </>
      )}

      {/* Маркетплейс перенесён во вкладку «Маркет» — здесь показываем только обычные рейсы */}
      {false && marketListings && marketListings.length > 0 && (null)}

    </div>
  );
}

