import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import DriverLayout from "./DriverLayout";
import { useAuth } from "@/hooks/use-auth";
import {
  TrendingUp, CheckCircle, Car, Calendar, Clock, MapPin,
  Users, ArrowLeft, Phone, Filter, WifiOff
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface SeatPassenger {
  id: number;
  seatNumber: number;
  name: string;
  phone?: string;
  price: number;
  pickupAddress?: string;
  dropoffAddress?: string;
}

interface Ride {
  id: number;
  fromCity: string;
  toCity: string;
  fromDistrictName?: string | null;
  toDistrictName?: string | null;
  price: number;
  status: string;
  passengers: number;
  createdAt: string;
  distance?: number;
  duration?: number;
  seatPassengers?: SeatPassenger[];
}

function formatRoutePoint(districtName: string | null | undefined, cityName: string): string {
  if (districtName) return `${districtName} (${cityName})`;
  return cityName;
}

interface EarningsData {
  today: number;
  thisWeek: number;
  thisMonth: number;
  completedRides: number;
}

type FilterPeriod = "all" | "today" | "week" | "month" | "custom";

export default function Earnings() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [filter, setFilter] = useState<FilterPeriod>("all");
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [detailPassengers, setDetailPassengers] = useState<SeatPassenger[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const [eRes, rRes] = await Promise.all([
        fetch(`${BASE_URL}/api/drivers/earnings`, { headers }),
        fetch(`${BASE_URL}/api/drivers/my-rides`, { headers }),
      ]);
      if (eRes.ok) setEarnings(await eRes.json());
      if (rRes.ok) {
        const data = await rRes.json();
        setRides(data.rides || []);
      }
      if (!eRes.ok && !rRes.ok) setFetchError(true);
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onFocus = () => { load(); };
    const onRidesChanged = () => { load(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("buxtaxi:rides_changed", onRidesChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("buxtaxi:rides_changed", onRidesChanged);
    };
  }, [load]);

  const openDetail = async (ride: Ride) => {
    setSelectedRide(ride);
    setDetailPassengers([]);
    if (ride.seatPassengers && ride.seatPassengers.length > 0) {
      setDetailPassengers(ride.seatPassengers);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await fetch(`${BASE_URL}/api/rides/${ride.id}/passengers`, { headers });
      if (res.ok) {
        const data = await res.json();
        setDetailPassengers(data.passengers || []);
      }
    } catch {}
    setLoadingDetail(false);
  };

  const filteredRides = rides.filter(ride => {
    if (filter === "all") return true;
    const d = new Date(ride.createdAt);
    const now = new Date();
    if (filter === "today") {
      return d.toDateString() === now.toDateString();
    }
    if (filter === "week") {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d >= weekAgo;
    }
    if (filter === "month") {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    if (filter === "custom" && customFrom && customTo) {
      const from = new Date(customFrom);
      const to = new Date(customTo);
      to.setHours(23, 59, 59, 999);
      return d >= from && d <= to;
    }
    return true;
  });

  const statusLabels: Record<string, { label: string; color: string }> = {
    completed: { label: "Завершён", color: "bg-zinc-100 text-zinc-700" },
    accepted: { label: "Принят", color: "bg-zinc-100 text-zinc-700" },
    in_progress: { label: "В пути", color: "bg-zinc-100 text-zinc-700" },
    cancelled: { label: "Отменён", color: "bg-red-500/10 text-red-600" },
    pending: { label: "Ожидает", color: "bg-muted text-foreground" },
  };

  if (selectedRide) {
    const st = statusLabels[selectedRide.status] || statusLabels.pending;
    return (
      <DriverLayout>
        <div className="p-4 space-y-4">
          <button onClick={() => { setSelectedRide(null); setDetailPassengers([]); }}
            className="flex items-center gap-2 text-sm text-muted-foreground mb-2 hover:text-foreground active:scale-95 transition-all">
            <ArrowLeft className="w-4 h-4" /> Назад
          </button>

          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${st.color}`}>{st.label}</span>
              <span className="text-xs text-muted-foreground">#{selectedRide.id}</span>
            </div>

            <div className="flex items-center gap-2 mb-4">
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-3 h-3 rounded-full bg-zinc-900" />
                <div className="w-px h-5 bg-border" />
                <div className="w-3 h-3 rounded-full bg-red-500" />
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm font-bold text-foreground">{selectedRide.fromCity}</p>
                <p className="text-sm font-bold text-foreground">{selectedRide.toCity}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center bg-muted/50 rounded-xl p-3">
              <div>
                <p className="text-lg font-bold text-foreground">{selectedRide.distance || "—"}</p>
                <p className="text-[10px] text-muted-foreground">км</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">{selectedRide.duration || "—"}</p>
                <p className="text-[10px] text-muted-foreground">минут</p>
              </div>
              <div>
                <p className="text-lg font-bold text-primary">{formatCurrency(selectedRide.price)}</p>
                <p className="text-[10px] text-muted-foreground">цена</p>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {new Date(selectedRide.createdAt).toLocaleDateString("ru-RU", {
                day: "numeric", month: "long", year: "numeric",
                hour: "2-digit", minute: "2-digit"
              })}
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-bold text-foreground">
                  Пассажиры ({detailPassengers.length || selectedRide.passengers})
                </span>
              </div>
            </div>

            {loadingDetail ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Загрузка...</div>
            ) : detailPassengers.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Нет данных о пассажирах</div>
            ) : (
              <div className="divide-y divide-border">
                {detailPassengers.map(p => (
                  <div key={p.id} className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                        {p.seatNumber}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">Место {p.seatNumber}</p>
                      </div>
                      <span className="text-sm font-bold text-primary">{formatCurrency(p.price)}</span>
                    </div>

                    {p.phone && (
                      <a href={`tel:${p.phone}`}
                        className="flex items-center gap-2 text-xs text-zinc-700 bg-zinc-100 rounded-lg px-3 py-2 mb-2">
                        <Phone className="w-3.5 h-3.5" />
                        {p.phone}
                      </a>
                    )}

                    {(p.pickupAddress || p.dropoffAddress) && (
                      <div className="bg-muted rounded-lg p-2.5 space-y-1.5 text-xs">
                        {p.pickupAddress && (
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-zinc-900 shrink-0" />
                            <span className="text-muted-foreground">{p.pickupAddress}</span>
                          </div>
                        )}
                        {p.dropoffAddress && (
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                            <span className="text-muted-foreground">{p.dropoffAddress}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedRide.status === "completed" && (
            <div className="bg-zinc-100 border border-zinc-200 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-700">Ваш заработок</span>
                <span className="text-lg font-extrabold text-zinc-900">
                  +{formatCurrency(Math.round(selectedRide.price * 0.9))}
                </span>
              </div>
            </div>
          )}
        </div>
      </DriverLayout>
    );
  }

  return (
    <DriverLayout>
      <div className="p-4 space-y-4">
        <button onClick={() => navigate("/driver/profile")}
          className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-muted/60 hover:bg-muted active:scale-[0.97] transition-all mb-3 border border-border/50">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-primary" />
          </div>
          <span className="text-sm font-bold text-foreground">Назад</span>
        </button>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-foreground">Мои рейсы</h1>
          <span className="text-xs text-muted-foreground">{filteredRides.length} рейсов</span>
        </div>

        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            Загрузка...
          </div>
        ) : fetchError ? (
          <ErrorState message="Не удалось загрузить данные" onRetry={load} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                  <Calendar className="w-3.5 h-3.5" />
                  Сегодня
                </div>
                <div className="text-xl font-bold text-primary">{formatCurrency(earnings?.today || 0)}</div>
              </div>
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Эта неделя
                </div>
                <div className="text-xl font-bold text-foreground">{formatCurrency(earnings?.thisWeek || 0)}</div>
              </div>
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Этот месяц
                </div>
                <div className="text-xl font-bold text-foreground">{formatCurrency(earnings?.thisMonth || 0)}</div>
              </div>
              <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Завершено
                </div>
                <div className="text-xl font-bold text-primary">{earnings?.completedRides || 0}</div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Фильтр</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {([
                  { key: "all", label: "Все" },
                  { key: "today", label: "Сегодня" },
                  { key: "week", label: "Неделя" },
                  { key: "month", label: "Месяц" },
                  { key: "custom", label: "Период" },
                ] as const).map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                      filter === f.key
                        ? "bg-primary text-white shadow-sm"
                        : "bg-card border border-border text-muted-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {filter === "custom" && (
                <div className="flex gap-2 mt-2">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-xs"
                  />
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-xs"
                  />
                </div>
              )}
            </div>

            <div>
              <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
                История рейсов
              </h2>
              {filteredRides.length === 0 ? (
                <div className="text-center py-12 bg-background rounded-2xl border border-border shadow-sm">
                  <Car className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">Нет рейсов</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRides.map(ride => {
                    const st = statusLabels[ride.status] || statusLabels.pending;
                    return (
                      <button
                        key={ride.id}
                        onClick={() => openDetail(ride)}
                        className="w-full bg-card border border-border rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-all"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-primary" />
                            <p className="text-foreground text-sm font-semibold">{formatRoutePoint(ride.fromDistrictName, ride.fromCity)} → {formatRoutePoint(ride.toDistrictName, ride.toCity)}</p>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${st.color}`}>
                            {st.label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(ride.createdAt).toLocaleDateString("ru-RU", {
                                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                              })}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {ride.passengers}
                            </span>
                          </div>
                          <div className={`font-bold text-sm ${ride.status === "completed" ? "text-primary" : "text-muted-foreground"}`}>
                            {ride.status === "completed" ? `+${formatCurrency(Math.round(ride.price * 0.9))}` : formatCurrency(ride.price)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DriverLayout>
  );
}
