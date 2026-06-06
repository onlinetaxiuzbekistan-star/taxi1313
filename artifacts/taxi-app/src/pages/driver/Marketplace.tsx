import { useState, useEffect, useCallback, useMemo } from "react";
import DriverLayout from "./DriverLayout";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  ShoppingBag, Tag, Clock, Users, Loader2, RefreshCw, ArrowLeft,
  Phone, User, XCircle, Plus, Minus, ChevronDown, MapPin, AlertCircle, Car, Rocket, Check, History, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import SeatSelector from "@/components/SeatSelector";
import { ManualClientForm } from "./orders/components/ManualClientForm";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const BAGGAGE_OPTIONS = [
  { value: "", label: "Нет" },
  { value: "small", label: "Маленький" },
  { value: "large", label: "Большой" },
];

interface Listing {
  id: number;
  rideId?: number | null;
  sellerId: number;
  buyerId?: number | null;
  price: number;
  comment?: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
  fromCity: string;
  toCity: string;
  scheduledAt: string;
  passengers?: number;
  seatsCount?: number;
  clientName?: string | null;
  clientPhone?: string | null;
  baggageType?: string | null;
  carClass?: string;
  ridePrice?: number;
  rideStatus?: string;
  sellerName?: string;
  sellerPhone?: string;
  sellerCar?: string;
  sellerCarNumber?: string;
  sellerRating?: string | null;
  buyerName?: string | null;
  buyerPhone?: string | null;
  basePrice?: number | null;
  sellerCity?: string | null;
  sellerCarBrand?: string | null;
  sellerCarColor?: string | null;
  sellerCarNumber?: string | null;
  buyerCity?: string | null;
  buyerCarBrand?: string | null;
  buyerCarColor?: string | null;
  buyerCarNumber?: string | null;
}

interface CityInfo {
  id: string;
  name: string;
  nameRu: string;
}

interface RouteInfo {
  id: number;
  fromCity: string;
  toCity: string;
  priceEconomy: number;
  priceComfort: number;
  priceBusiness: number;
  distanceKm: number;
  durationMin: number;
  sortOrder: number;
  isActive: boolean;
}

interface District {
  id: number;
  name: string;
  cityId: string;
  extraCharge: number;
  isActive: boolean;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "В продаже", color: "text-zinc-700", bg: "bg-zinc-100" },
  sold: { label: "Продан", color: "text-zinc-700", bg: "bg-zinc-100" },
  in_progress: { label: "В пути", color: "text-zinc-700", bg: "bg-zinc-100" },
  completed: { label: "Завершён", color: "text-zinc-700", bg: "bg-zinc-100" },
  cancelled: { label: "Отменён", color: "text-foreground", bg: "bg-muted" },
};

const CITY_PREFIX: Record<string, string> = {
  "Ташкент": "TAS", "Самарканд": "SAM", "Бухара": "BUX", "Фергана": "FER",
  "Андижан": "AND", "Наманган": "NAM", "Нукус": "NUK", "Карши": "KAR",
  "Навои": "NAV", "Термез": "TER", "Гулистан": "GUL", "Джиззак": "JIZ", "Ургенч": "URG",
};
function getCallsign(city: string | null | undefined, id: number | null | undefined): string {
  const pfx = city ? (CITY_PREFIX[city] || "BT") : "BT";
  return `${pfx}-${String(id || 0).padStart(3, "0")}`;
}

function generateTimeSlots(): { value: string; label: string }[] {
  const slots: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h += 2) {
    const from = `${String(h).padStart(2, "0")}:00`;
    const to = `${String((h + 2) % 24).padStart(2, "0")}:00`;
    slots.push({ value: from, label: `${from} – ${to}` });
  }
  return slots;
}

function getNearestSlot(): string {
  const now = new Date();
  const h = now.getHours();
  const nextSlot = (h % 2 === 0 ? h : h - 1) + 2;
  return `${String(nextSlot >= 24 ? 0 : nextSlot).padStart(2, "0")}:00`;
}

const TIME_SLOTS = generateTimeSlots();

export default function Marketplace() {
  const { user: _authUser } = useAuth();
  const myCity = (_authUser as any)?.city as string | undefined;
  const { token } = useAuth();
  const { toast } = useToast();
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [availableListings, setAvailableListings] = useState<any[]>([]);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [cities, setCities] = useState<CityInfo[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const urlTab = new URLSearchParams(window.location.search).get("tab");
  const [activeTab, setActiveTab] = useState<"sales" | "history">(urlTab === "history" ? "history" : "sales");
  const [historyListings, setHistoryListings] = useState<(Listing & { role?: string; sellerName?: string; buyerName?: string })[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [showForm, setShowForm] = useState(urlTab === "create");
  const [sellRouteId, setSellRouteId] = useState<number | null>(null);
  const [sellFromDistrictId, setSellFromDistrictId] = useState<number | null>(null);
  const [sellToDistrictId, setSellToDistrictId] = useState<number | null>(null);
  const [sellTimeSlot, setSellTimeSlot] = useState(getNearestSlot());
  const [sellClientPhone, setSellClientPhone] = useState("+998");
  const [sellSelectedSeats, setSellSelectedSeats] = useState<number[]>([]);
  const [wholeCar, setWholeCar] = useState(false);
  const [sellBaggage, setSellBaggage] = useState("");
  const [sellGenders, setSellGenders] = useState<Record<number, "male" | "female">>({});
  const [manualFormSeat, setManualFormSeat] = useState<number | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [sellComment, setSellComment] = useState("");
  const [sellLoading, setSellLoading] = useState(false);

  const [fromDistricts, setFromDistricts] = useState<District[]>([]);
  const [toDistricts, setToDistricts] = useState<District[]>([]);
  const [loadingDistricts, setLoadingDistricts] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => {
    fetch(`${BASE_URL}/api/rides/cities`).then(r => r.json()).then(d => setCities(d.cities || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!myCity) { setRoutes([]); return; }
    fetch(`${BASE_URL}/api/routes?city=${encodeURIComponent(myCity)}`).then(r => r.json()).then(d => setRoutes((d.routes || []).filter((r: RouteInfo) => r.isActive))).catch(() => {});
  }, [myCity]);

  const activeRoutes = useMemo(() => routes.filter(r => r.isActive), [routes]);
  const selectedRoute = useMemo(() => routes.find(r => r.id === sellRouteId) || null, [routes, sellRouteId]);

  const cityName = (id: string) => cities.find(c => c.id === id || c.nameRu === id)?.nameRu || id;

  const resolveCityId = useCallback((ruName: string) => {
    const city = cities.find(c => c.nameRu === ruName || c.id === ruName);
    return city?.id || ruName.toLowerCase();
  }, [cities]);

  useEffect(() => {
    if (!selectedRoute) {
      setFromDistricts([]);
      setToDistricts([]);
      setSellFromDistrictId(null);
      setSellToDistrictId(null);
      return;
    }
    setLoadingDistricts(true);
    setSellFromDistrictId(null);
    setSellToDistrictId(null);
    const fromCityId = resolveCityId(selectedRoute.fromCity);
    const toCityId = resolveCityId(selectedRoute.toCity);
    Promise.all([
      fetch(`${BASE_URL}/api/districts?cityId=${fromCityId}`).then(r => r.json()).then(d => setFromDistricts((d.districts || []).filter((dd: District) => dd.isActive))),
      fetch(`${BASE_URL}/api/districts?cityId=${toCityId}`).then(r => r.json()).then(d => setToDistricts((d.districts || []).filter((dd: District) => dd.isActive))),
    ]).catch(() => {}).finally(() => setLoadingDistricts(false));
  }, [selectedRoute?.id, resolveCityId]);

  const perSeatPrice = useMemo(() => {
    if (!selectedRoute) return 0;
    let p = selectedRoute.priceEconomy || 0;
    if (sellFromDistrictId) {
      const d = fromDistricts.find(dd => dd.id === sellFromDistrictId);
      if (d) p += d.extraCharge;
    }
    if (sellToDistrictId) {
      const d = toDistricts.find(dd => dd.id === sellToDistrictId);
      if (d) p += d.extraCharge;
    }
    return p;
  }, [selectedRoute, sellFromDistrictId, sellToDistrictId, fromDistricts, toDistricts]);

  const minPrice = useMemo(() => perSeatPrice * sellSelectedSeats.length, [perSeatPrice, sellSelectedSeats]);

  useEffect(() => {
    setSellPrice(minPrice > 0 ? String(minPrice) : "");
  }, [minPrice]);

  const loadMyListings = useCallback(async (showRefresh = false) => {
    if (!token) return;
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/marketplace/my-sales`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setMyListings(data.listings || []);
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  const loadHistory = useCallback(async () => {
    if (!token) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/marketplace/history`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setHistoryListings(data.listings || []);
      }
    } catch {}
    setHistoryLoading(false);
  }, [token]);

  const loadAvailableListings = useCallback(async () => {
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("authToken");
      const res = await fetch(`${BASE_URL}/api/marketplace/listings`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setAvailableListings(data.listings || []);
      }
    } catch {}
  }, []);
  const handleBuyAvailable = useCallback(async (listingId: number) => {
    if (buyingId) return;
    setBuyingId(listingId);
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("authToken");
      const res = await fetch(`${BASE_URL}/api/marketplace/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listingId }),
      });
      if (res.ok) {
        toast.success("Заказ принят");
        loadAvailableListings();
        loadMyListings();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.message || "Не удалось купить");
      }
    } catch (e: any) {
      toast.error(e.message || "Ошибка сети");
    } finally {
      setBuyingId(null);
    }
  }, [buyingId, loadMyListings, loadAvailableListings]);
  useEffect(() => { loadAvailableListings(); }, [loadAvailableListings]);
  useEffect(() => { const iv = setInterval(() => loadAvailableListings(), 15000); return () => clearInterval(iv); }, [loadAvailableListings]);
  useEffect(() => { loadMyListings(); }, [loadMyListings]);
  useEffect(() => { if (activeTab === "history") loadHistory(); }, [activeTab, loadHistory]);
  useEffect(() => { const iv = setInterval(() => loadMyListings(), 15000); return () => clearInterval(iv); }, [loadMyListings]);

  const resetSellForm = () => {
    setSellRouteId(null);
    setSellFromDistrictId(null);
    setSellToDistrictId(null);
    setSellTimeSlot(getNearestSlot());
    setSellClientPhone("+998");
    setSellSelectedSeats([]);
    setWholeCar(false);
    setSellBaggage("");
    setSellGenders({});
    setManualFormSeat(null);
    setSellPrice("");
    setSellComment("");
  };

  const handleOpenForm = () => {
    resetSellForm();
    setShowForm(true);
  };

  const toggleSeat = (n: number) => {
    if (wholeCar) return;
    if (sellSelectedSeats.includes(n)) {
      setSellSelectedSeats(prev => prev.filter(s => s !== n));
      setSellGenders(g => {
        const next = { ...g };
        delete next[n];
        return next;
      });
      if (manualFormSeat === n) setManualFormSeat(null);
      return;
    }
    setManualFormSeat(prev => (prev === n ? null : n));
  };

  const handleManualSubmit = (seat: number, gender: string) => {
    setSellSelectedSeats(prev => (prev.includes(seat) ? prev : [...prev, seat].sort()));
    if (gender === "male" || gender === "female") {
      setSellGenders(prev => ({ ...prev, [seat]: gender }));
    }
    setManualFormSeat(null);
  };

  const toggleWholeCar = () => {
    if (wholeCar) {
      setWholeCar(false);
      setSellSelectedSeats([]);
      setSellGenders({});
    } else {
      setWholeCar(true);
      setSellSelectedSeats([1, 2, 3, 4]);
      setSellGenders({});
    }
    setManualFormSeat(null);
  };

  const handleSellOrder = async () => {
    if (sellLoading) return;
    if (!sellRouteId) {
      toast({ variant: "destructive", title: "Выберите маршрут" });
      return;
    }
    if (!sellClientPhone || sellClientPhone.replace(/\D/g, "").length < 12) {
      toast({ variant: "destructive", title: "Укажите номер телефона клиента" });
      return;
    }
    const price = parseFloat(sellPrice);
    if (!price || price < minPrice) {
      toast({ variant: "destructive", title: `Минимальная цена: ${formatCurrency(minPrice)}` });
      return;
    }

    // Срочный заказ: scheduledAt = "сейчас", без выбора интервала
    const slotDate = new Date();

    setSellLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/marketplace/sell-order`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          routeId: sellRouteId,
          fromDistrictId: sellFromDistrictId,
          toDistrictId: sellToDistrictId,
          scheduledAt: slotDate.toISOString(),
          clientPhone: sellClientPhone.trim(),
          seatsCount: sellSelectedSeats,
          baggageType: sellBaggage || null,
          price,
          comment: sellComment || null,
          genders: sellSelectedSeats.map(s => sellGenders[s] || null),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Заказ выставлен на продажу!" });
        setShowForm(false);
        loadMyListings(true);
      } else {
        toast({ variant: "destructive", title: data.message || "Ошибка" });
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети" });
    }
    setSellLoading(false);
  };

  const handleCancel = async (listingId: number) => {
    if (cancellingId) return;
    setCancellingId(listingId);
    try {
      const res = await fetch(`${BASE_URL}/api/marketplace/cancel/${listingId}`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Объявление отменено" });
        loadMyListings(true);
        setSelectedListing(null);
      } else {
        toast({ variant: "destructive", title: data.message || "Ошибка" });
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети" });
    }
    setCancellingId(null);
  };

  // ── Single-Screen Create Order Form ──
  if (showForm) {
    const phoneValid = sellClientPhone.replace(/\D/g, "").length >= 12;
    const priceValid = parseFloat(sellPrice) >= minPrice && minPrice > 0;
    const canSubmit = !!sellRouteId && phoneValid && sellSelectedSeats.length > 0 && priceValid;

    return (
      <DriverLayout>
        <div className="px-4 py-4 space-y-3 pb-28">
          <button onClick={() => setShowForm(false)} className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 active:scale-95 transition-all">
            <ArrowLeft className="w-4 h-4" /> Назад к продажам
          </button>

          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
              <Tag className="w-4 h-4 text-zinc-600" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-foreground">Создать заказ</h1>
              <p className="text-[11px] text-muted-foreground">Передайте клиента другому водителю</p>
            </div>
          </div>

          {/* 1. ROUTE — Dropdown */}
          <div className="bg-card rounded-2xl border border-border p-4 space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Маршрут
            </label>
            <div className="relative">
              <select
                value={sellRouteId ?? ""}
                onChange={e => setSellRouteId(e.target.value ? Number(e.target.value) : null)}
                className={`w-full px-3 py-2.5 rounded-xl border-2 bg-background text-foreground text-sm font-semibold appearance-none pr-8 transition-colors ${
                  sellRouteId ? "border-zinc-400" : "border-border"
                }`}
              >
                <option value="">Выберите маршрут</option>
                {activeRoutes.map(r => (
                  <option key={r.id} value={r.id}>
                    {cityName(r.fromCity)} → {cityName(r.toCity)} ({formatCurrency(r.priceEconomy)}/место)
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* 2. TIME — Скрыто: срочный заказ создаётся "сейчас", интервал не требуется */}
          {false && (
          <div className="bg-card rounded-2xl border border-border p-4 space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3" /> Время
            </label>
            <div className="relative">
              <select
                value={sellTimeSlot}
                onChange={e => setSellTimeSlot(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-semibold appearance-none pr-8"
              >
                {TIME_SLOTS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          )}

          {/* 3. DISTRICTS — Dropdowns (shown when route selected) */}
          {selectedRoute && loadingDistricts && (
            <div className="bg-card rounded-2xl border border-border p-4">
              <div className="flex justify-center py-2"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            </div>
          )}
          {selectedRoute && !loadingDistricts && (fromDistricts.length > 0 || toDistricts.length > 0) && (
            <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Районы
              </label>
              {fromDistricts.length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">Откуда ({cityName(selectedRoute.fromCity)})</p>
                  <div className="relative">
                    <select
                      value={sellFromDistrictId ?? ""}
                      onChange={e => setSellFromDistrictId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-semibold appearance-none pr-8"
                    >
                      <option value="">Центр</option>
                      {fromDistricts.filter(d => d.extraCharge > 0).map(d => (
                        <option key={d.id} value={d.id}>{d.name} (+{formatCurrency(d.extraCharge)})</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              )}
              {toDistricts.length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium mb-1">Куда ({cityName(selectedRoute.toCity)})</p>
                  <div className="relative">
                    <select
                      value={sellToDistrictId ?? ""}
                      onChange={e => setSellToDistrictId(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-semibold appearance-none pr-8"
                    >
                      <option value="">Центр</option>
                      {toDistricts.filter(d => d.extraCharge > 0).map(d => (
                        <option key={d.id} value={d.id}>{d.name} (+{formatCurrency(d.extraCharge)})</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4. SEATS + Whole Car */}
          <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Users className="w-3 h-3" /> Места ({sellSelectedSeats.length} выбрано)
            </label>
            <SeatSelector
              selectedSeats={sellSelectedSeats}
              onToggleSeat={toggleSeat}
              wholeCar={wholeCar}
              onToggleWholeCar={toggleWholeCar}
              showWholeCarToggle
              seatGenders={sellGenders}
            />
            {manualFormSeat !== null && !wholeCar && (
              <ManualClientForm
                seatNumber={manualFormSeat}
                onClose={() => setManualFormSeat(null)}
                onSubmit={handleManualSubmit}
              />
            )}
          </div>

          {/* 5. BAGGAGE */}
          <div className="bg-card rounded-2xl border border-border p-4 space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Багаж</label>
            <div className="relative">
              <select
                value={sellBaggage}
                onChange={e => setSellBaggage(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-semibold appearance-none pr-8"
              >
                {BAGGAGE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* CLIENT PHONE */}
          <div className="bg-card rounded-2xl border border-border p-4 space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Phone className="w-3 h-3" /> Телефон клиента
            </label>
            <input
              type="tel"
              value={sellClientPhone}
              onChange={e => setSellClientPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
              className={`w-full px-3 py-2.5 rounded-xl border-2 bg-background text-foreground text-sm font-semibold ${
                sellClientPhone.length > 4 && !phoneValid ? "border-red-500/40" : "border-border"
              }`}
            />
            {sellClientPhone.length > 4 && !phoneValid && (
              <p className="text-[11px] text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Введите полный номер</p>
            )}
          </div>

          {/* 6. PRICE STEPPER */}
          {selectedRoute && (
            <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Цена</label>
              {minPrice > 0 && (
                <div className="bg-zinc-100 border border-zinc-200 rounded-xl px-3 py-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-zinc-600 shrink-0" />
                  <p className="text-xs font-semibold text-zinc-700">
                    Минимальная цена: {formatCurrency(minPrice)}
                    <span className="font-normal text-zinc-500 ml-1">
                      ({formatCurrency(perSeatPrice)} x {sellSelectedSeats.length})
                    </span>
                  </p>
                </div>
              )}
              {parseFloat(sellPrice) >= minPrice && minPrice > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <Wallet className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Если заказ выкупят</p>
                    <p className="text-base font-extrabold text-emerald-700">+{formatCurrency(parseFloat(sellPrice))} на ваш баланс</p>
                    <p className="text-[11px] text-emerald-600/80 mt-0.5">
                      {sellSelectedSeats.length > 1 ? `${formatCurrency(Math.round(parseFloat(sellPrice)/sellSelectedSeats.length))} × ${sellSelectedSeats.length} мест` : "За 1 место"}
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    const cur = parseFloat(sellPrice) || minPrice;
                    const next = cur - 10000;
                    if (next >= minPrice) setSellPrice(String(next));
                  }}
                  disabled={!sellPrice || parseFloat(sellPrice) <= minPrice}
                  className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-foreground font-bold text-xl active:scale-90 transition-all disabled:opacity-30"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <div className="flex-1 text-center">
                  <p className="text-2xl font-extrabold text-foreground">{formatCurrency(parseFloat(sellPrice) || minPrice)}</p>
                  <p className="text-[10px] text-muted-foreground">сум</p>
                </div>
                <button
                  onClick={() => {
                    const cur = parseFloat(sellPrice) || minPrice;
                    setSellPrice(String(cur + 10000));
                  }}
                  className="w-12 h-12 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-700 font-bold text-xl active:scale-90 transition-all"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <div className="flex gap-2">
                {[10000, 20000, 50000].map(amount => (
                  <button
                    key={amount}
                    onClick={() => {
                      const cur = parseFloat(sellPrice) || minPrice;
                      setSellPrice(String(cur + amount));
                    }}
                    className="flex-1 py-2 rounded-xl border border-zinc-200 bg-zinc-100 text-zinc-700 text-xs font-bold active:scale-95 transition-all"
                  >
                    +{formatCurrency(amount)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* COMMENT */}
          <div className="bg-card rounded-2xl border border-border p-4 space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Комментарий</label>
            <textarea
              value={sellComment}
              onChange={e => setSellComment(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm resize-none"
              placeholder="Необязательно"
            />
          </div>

          {/* SUBMIT */}
          <button
            onClick={handleSellOrder}
            disabled={sellLoading || !canSubmit}
            className="w-full py-4 rounded-2xl bg-zinc-900 text-white font-extrabold text-lg shadow-lg shadow-zinc-900/20 active:scale-[0.95] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sellLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Публикация...
              </>
            ) : (
              <>
                <Rocket className="w-5 h-5" />
                Опубликовать заказ
              </>
            )}
          </button>
        </div>
      </DriverLayout>
    );
  }

  // ── Listing Detail View ──
  if (selectedListing) {
    const l = selectedListing;
    const st = STATUS_MAP[l.status] || STATUS_MAP.active;
    const seats = l.seatsCount ?? l.passengers ?? 0;

    return (
      <DriverLayout>
        <div className="px-4 py-4 space-y-4">
          <button onClick={() => setSelectedListing(null)} className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 active:scale-95 transition-all">
            <ArrowLeft className="w-4 h-4" /> Назад
          </button>

          <div className="bg-card rounded-2xl border border-border shadow-sm p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-foreground">
                {l.rideId ? `Заказ #${l.rideId}` : "Заказ (клиент)"}
              </h2>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-0.5">
                <div className="w-3 h-3 rounded-full bg-zinc-900" />
                <div className="w-px h-5 bg-border" />
                <div className="w-3 h-3 rounded-full bg-red-500" />
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-sm font-bold">{cityName(l.fromCity)}</p>
                <p className="text-sm font-bold">{cityName(l.toCity)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted rounded-xl p-3 text-center">
                <p className="text-xs text-muted-foreground">Цена продажи</p>
                <p className="text-lg font-extrabold text-foreground">{formatCurrency(l.price)}</p>
              </div>
              <div className="bg-muted rounded-xl p-3 text-center">
                <p className="text-xs text-muted-foreground">Мест</p>
                <p className="text-lg font-extrabold text-foreground">{seats}</p>
              </div>
            </div>

            {l.basePrice != null && l.basePrice > 0 && (
              <div className="bg-zinc-100 rounded-xl p-3 text-center border border-zinc-200">
                <p className="text-xs text-zinc-600">Базовая цена</p>
                <p className="text-base font-bold text-zinc-700">{formatCurrency(l.basePrice)}</p>
              </div>
            )}

            <div className="space-y-2 text-sm">
              {l.scheduledAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Отправление</span>
                  <span className="font-semibold">{format(new Date(l.scheduledAt), "d MMM, HH:mm", { locale: ru })}</span>
                </div>
              )}
              {l.clientPhone && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Телефон клиента</span>
                  <a href={`tel:${l.clientPhone}`} className="font-semibold text-primary">{l.clientPhone}</a>
                </div>
              )}
              {l.baggageType && l.baggageType !== "none" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Багаж</span>
                  <span className="font-semibold">{BAGGAGE_OPTIONS.find(o => o.value === l.baggageType)?.label || l.baggageType}</span>
                </div>
              )}
              {l.comment && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Комментарий</span>
                  <span className="font-semibold text-right max-w-[60%]">{l.comment}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Создано</span>
                <span className="font-semibold">{format(new Date(l.createdAt), "d MMM, HH:mm", { locale: ru })}</span>
              </div>
            </div>

            {l.buyerName && (
              <div className="bg-zinc-100 rounded-xl p-3 space-y-2 border border-zinc-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-200 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-zinc-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">{l.buyerName}</p>
                    <p className="text-xs text-muted-foreground">Покупатель</p>
                  </div>
                  {l.buyerPhone && (
                    <a href={`tel:${l.buyerPhone}`} className="text-primary">
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                </div>
                {((l as any).buyerCar || (l as any).buyerCarNumber) && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pl-[52px]">
                    <Car className="w-3.5 h-3.5" />
                    <span>{(l as any).buyerCar || ""} {(l as any).buyerCarNumber || ""}</span>
                  </div>
                )}
              </div>
            )}

            {l.status === "active" && !l.buyerId && (
              <button
                onClick={() => handleCancel(l.id)}
                disabled={!!cancellingId}
                className="w-full py-3.5 rounded-xl bg-red-500/10 text-red-600 font-bold text-sm border border-red-500/20 active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cancellingId === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Снять с продажи
              </button>
            )}
          </div>
        </div>
      </DriverLayout>
    );
  }

  // ── Main: Tabs + List ──
  return (
    <DriverLayout>
      <div className="px-4 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-zinc-600" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-foreground">Маркетплейс</h1>
              <p className="text-[11px] text-muted-foreground">Продажа и история заказов</p>
            </div>
          </div>
          <button
            onClick={() => activeTab === "sales" ? loadMyListings(true) : loadHistory()}
            disabled={refreshing || historyLoading}
            className="w-9 h-9 rounded-full bg-muted flex items-center justify-center active:scale-90 transition-all"
          >
            <RefreshCw className={`w-4 h-4 text-foreground ${refreshing || historyLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="flex rounded-xl bg-muted p-1 gap-1">
          <button
            onClick={() => setActiveTab("sales")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === "sales" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            Продажи
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === "history" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            История
          </button>
        </div>

        {activeTab === "sales" && (
          <>
            {availableListings.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-bold text-foreground uppercase tracking-wider">
                    {availableListings.length} {availableListings.length === 1 ? "доступный" : "доступных"} от водителей
                  </p>
                </div>
                {availableListings.map((l: any) => {
                  const fromName = cities.find((c: any) => c.id === l.fromCity)?.nameRu || l.fromCity;
                  const toName = cities.find((c: any) => c.id === l.toCity)?.nameRu || l.toCity;
                  const scheduledIso = l.scheduledAt || l.rideScheduledAt;
                  const timeSlot = l.timeSlot || l.rideTimeSlot;
                  const fmtSched = scheduledIso ? new Date(scheduledIso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
                  const createdAgo = l.createdAt ? (() => { const m = Math.floor((Date.now() - new Date(l.createdAt).getTime()) / 60000); if (m < 1) return "только что"; if (m < 60) return m + " мин назад"; const h = Math.floor(m/60); if (h<24) return h + " ч назад"; return Math.floor(h/24) + " дн назад"; })() : "";
                  return (
                    <div key={"avail-" + l.id} className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                      <div className="bg-muted border-b border-border px-4 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-bold text-foreground">В ПРОДАЖЕ</span>
                        </div>
                        {l.sellerName && (<span className="text-[13px] text-muted-foreground font-medium">{l.sellerName}</span>)}
                      </div>
                      <div className="p-4 space-y-3">
                        <p className="text-sm font-bold text-foreground">{fromName} → {toName}</p>
                        {(timeSlot || fmtSched || createdAgo) && (
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            {(timeSlot || fmtSched) && (<div className="text-foreground/80"><span className="text-muted-foreground">Рейс:</span> {timeSlot || fmtSched}</div>)}
                            {createdAgo && (<div className="text-muted-foreground"><span>Создан:</span> {createdAgo}</div>)}
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-2 border-t border-border/50">
                          <span className="text-xs text-muted-foreground">{l.seatsCount || 0} мест</span>
                          <p className="text-lg font-extrabold text-foreground">{(l.price || 0).toLocaleString("ru-RU")} UZS</p>
                        </div>
                        <button onClick={() => handleBuyAvailable(l.id)} disabled={buyingId === l.id} className="w-full py-3.5 rounded-xl bg-zinc-900 text-white font-bold text-base shadow-lg active:scale-[0.97] transition-transform disabled:opacity-50">
                          {buyingId === l.id ? "Покупаю..." : "Взять за " + (l.price || 0).toLocaleString("ru-RU") + " UZS"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              onClick={handleOpenForm}
              className="w-full py-4 rounded-2xl bg-zinc-900 text-white font-extrabold text-base shadow-lg shadow-zinc-900/20 active:scale-[0.95] transition-transform flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Создать заказ
            </button>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-10 h-10 text-muted-foreground animate-spin mb-3" />
                <p className="text-sm text-muted-foreground">Загрузка...</p>
              </div>
            ) : myListings.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Tag className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-semibold text-muted-foreground mb-1">У вас пока нет продаж</p>
                <p className="text-xs text-muted-foreground/80">Нажмите кнопку выше, чтобы создать заказ</p>
              </div>
            ) : (
              <div className="space-y-3">
                {myListings.map(l => {
                  const st = STATUS_MAP[l.status] || STATUS_MAP.active;
                  const seats = l.seatsCount ?? l.passengers ?? 0;
                  return (
                    <button
                      key={l.id}
                      onClick={() => setSelectedListing(l)}
                      className="w-full bg-card rounded-2xl border border-border shadow-sm p-4 text-left active:scale-[0.98] transition-all"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="w-2 h-2 rounded-full bg-zinc-900" />
                            <div className="w-px h-3 bg-border" />
                            <div className="w-2 h-2 rounded-full bg-red-500" />
                          </div>
                          <p className="text-sm font-bold truncate">{cityName(l.fromCity)} → {cityName(l.toCity)}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.bg} ${st.color} shrink-0`}>{st.label}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="font-bold text-foreground text-sm">{formatCurrency(l.price)}</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{seats} мест</span>
                        {l.scheduledAt && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(l.scheduledAt), "HH:mm")}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "history" && (
          <>
            {historyLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-10 h-10 text-muted-foreground animate-spin mb-3" />
                <p className="text-sm text-muted-foreground">Загрузка...</p>
              </div>
            ) : historyListings.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <History className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-semibold text-muted-foreground mb-1">История пуста</p>
                <p className="text-xs text-muted-foreground/80">Завершённые и проданные заказы появятся здесь</p>
              </div>
            ) : (
              <div className="space-y-3">
                {historyListings.map(l => {
                  const st = STATUS_MAP[l.status] || STATUS_MAP.active;
                  const seats = l.seatsCount ?? l.passengers ?? 0;
                  const isSeller = l.role === "seller";
                  return (
                    <div
                      key={l.id}
                      className="w-full bg-card rounded-2xl border border-border shadow-sm p-4 text-left"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="w-2 h-2 rounded-full bg-zinc-900" />
                            <div className="w-px h-3 bg-border" />
                            <div className="w-2 h-2 rounded-full bg-red-500" />
                          </div>
                          <p className="text-sm font-bold truncate">{cityName(l.fromCity)} → {cityName(l.toCity)}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isSeller ? "bg-zinc-100 text-zinc-700" : "bg-zinc-100 text-zinc-700"}`}>
                            {isSeller ? "Продавец" : "Покупатель"}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{seats} {seats === 1 ? "место" : "мест"}</span>
                        {l.updatedAt && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(l.updatedAt), "d MMM, HH:mm", { locale: ru })}</span>
                        )}
                      </div>

                      {/* Раскладка денег */}
                      <div className={`rounded-lg px-3 py-2 mb-2 border ${
                        l.status === "cancelled" ? "bg-zinc-50 border-zinc-200"
                        : isSeller ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
                      }`}>
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {l.status === "cancelled" ? "Цена сделки" : isSeller ? "Получено на баланс" : "Списано со счёта"}
                          </span>
                          {seats > 1 && (
                            <span className="text-[10px] text-muted-foreground">
                              {formatCurrency(Math.round(l.price/seats))} × {seats}
                            </span>
                          )}
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className={`text-lg font-extrabold ${
                            l.status === "cancelled" ? "text-foreground"
                            : isSeller ? "text-emerald-700" : "text-amber-700"
                          }`}>
                            {l.status === "cancelled" ? "" : isSeller ? "+" : "−"}{formatCurrency(l.price)}
                          </span>
                          {!isSeller && l.basePrice && l.basePrice > 0 && l.status !== "cancelled" && (
                            <span className="text-[11px] font-bold text-emerald-700">
                              ↑ от пассажиров {formatCurrency(l.basePrice)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Карточка контрагента: имя + позывной + авто */}
                      {(isSeller ? l.buyerName : l.sellerName) && (
                        <div className="bg-zinc-50 rounded-lg px-3 py-2.5 border border-zinc-200">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                              {isSeller ? "Заказ выкупил" : "Заказ продал"}
                            </span>
                            <span className="text-[10px] font-extrabold font-mono text-zinc-700 bg-white px-1.5 py-0.5 rounded border border-zinc-300">
                              {getCallsign(isSeller ? l.buyerCity : l.sellerCity, isSeller ? l.buyerId : l.sellerId)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-white border border-zinc-200 flex items-center justify-center shrink-0">
                              <User className="w-3.5 h-3.5 text-zinc-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-foreground truncate">{isSeller ? l.buyerName : l.sellerName}</p>
                              {((isSeller && l.buyerCarBrand) || (!isSeller && l.sellerCarBrand)) && (
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {isSeller ? l.buyerCarBrand : l.sellerCarBrand}
                                  {(isSeller ? l.buyerCarColor : l.sellerCarColor) && ` • ${isSeller ? l.buyerCarColor : l.sellerCarColor}`}
                                  {(isSeller ? l.buyerCarNumber : l.sellerCarNumber) && ` • ${isSeller ? l.buyerCarNumber : l.sellerCarNumber}`}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </DriverLayout>
  );
}
