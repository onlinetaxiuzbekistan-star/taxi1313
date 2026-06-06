import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Phone, Check, X, Loader2, UserPlus, User, Car, Users, MessageCircle, Clock, MapPin, Hash, Package } from "lucide-react";
import { toast } from "sonner";
import type { Map as LMap } from "leaflet";

const BASE_URL = import.meta.env.BASE_URL || "";

interface TimeSlot { value: string; label: string; isUrgent: boolean; dep: Date; isTomorrow: boolean }

function generateTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const now = new Date();
  const baseStartHour = now.getHours() - (now.getHours() % 2);
  const base = new Date(now);
  base.setHours(baseStartHour, 0, 0, 0);
  const todayDate = now.getDate();
  for (let i = 0; i < 12; i++) {
    const dep = new Date(base.getTime() + i * 2 * 60 * 60 * 1000);
    const startH = dep.getHours();
    const endH = (startH + 2) % 24;
    const value = `${String(startH).padStart(2, "0")}:00-${String(endH).padStart(2, "0")}:00`;
    const isTomorrow = dep.getDate() !== todayDate;
    const dayMark = isTomorrow ? " (завтра)" : "";
    const label = `${String(startH).padStart(2, "0")}:00 – ${String(endH).padStart(2, "0")}:00${dayMark}`;
    const isUrgent = i === 0;
    slots.push({ value, label, isUrgent, dep, isTomorrow });
  }
  return slots;
}

function getAutoTimeSlot(slots: { value: string }[]): string {
  return slots[0]?.value || "";
}

interface RouteOptionItem {
  id: number; routeId: number; tariffClass?: string; optionKey: string;
  label: string; price: number; isActive: boolean; sortOrder: number;
}

interface RouteOption {
  id: number; fromCity: string; toCity: string; distanceKm: number; durationMin: number;
  priceEconomy: number; priceComfort: number; priceBusiness: number;
  priceFrontEconomy: number; priceFrontComfort: number; priceFrontBusiness: number;
  isActive: boolean; options: RouteOptionItem[];
  tariffOptions?: Record<string, RouteOptionItem[]>;
  priceMail?: number;
}

interface District {
  id: number; name: string; cityId: string; extraCharge: number;
  lat: number | null; lng: number | null;
}

interface PriceEstimate { price: number; priceFront: number; priceBack: number; }

function isPhoneComplete(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 12;
}

function getSlotStartHour(slot: string): number {
  return parseInt(slot.split("-")[0].split(":")[0]);
}

const SELECT_STYLE = {
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat" as const,
  backgroundPosition: "right 10px center",
};

const CITY_COORDS: Record<string, [number, number]> = {
  "Ташкент": [41.2995, 69.2401],
  "Фергана": [40.3842, 71.7893],
  "Андижан": [40.7821, 72.3442],
  "Наманган": [40.9983, 71.6726],
  "Самарканд": [39.6542, 66.9597],
  "Бухара": [39.7745, 64.4286],
  "Нукус": [42.4628, 59.6003],
  "Карши": [38.8610, 65.7983],
  "Навои": [40.1003, 65.3790],
  "Ургенч": [41.5500, 60.6333],
  "Термез": [37.2242, 67.2783],
  "Джизак": [40.1158, 67.8422],
  "Гулистан": [40.4897, 68.7842],
  "Коканд": [40.5286, 70.9425],
  "Маргилан": [40.4703, 71.7147],
  "tashkent": [41.2995, 69.2401],
  "fergana": [40.3842, 71.7893],
  "andijan": [40.7821, 72.3442],
  "namangan": [40.9983, 71.6726],
  "samarkand": [39.6542, 66.9597],
  "bukhara": [39.7745, 64.4286],
  "nukus": [42.4628, 59.6003],
  "karshi": [38.8610, 65.7983],
  "navoi": [40.1003, 65.3790],
  "urgench": [41.5500, 60.6333],
  "termez": [37.2242, 67.2783],
  "jizzakh": [40.1158, 67.8422],
  "gulistan": [40.4897, 68.7842],
  "kokand": [40.5286, 70.9425],
  "margilan": [40.4703, 71.7147],
};

function RouteMapPanel({ fromCity, toCity, selectedRoute }: {
  fromCity: string; toCity: string; selectedRoute: RouteOption | null;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const leafletRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !mapContainerRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapContainerRef.current, {
        center: [41.0, 69.0],
        zoom: 6,
        zoomControl: true,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
      }).addTo(map);
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !leafletRef.current) return;
    const L = leafletRef.current;

    if (layerRef.current) {
      mapRef.current.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    const fromCoords = CITY_COORDS[fromCity];
    const toCoords = CITY_COORDS[toCity];

    if (!fromCoords || !toCoords || fromCity === toCity || !selectedRoute) {
      mapRef.current.setView([41.0, 69.0], 6);
      return;
    }

    const group = L.featureGroup();

    const greenIcon = L.divIcon({
      className: "",
      html: `<div style="width:28px;height:28px;background:#10b981;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">A</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const redIcon = L.divIcon({
      className: "",
      html: `<div style="width:28px;height:28px;background:#ef4444;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">B</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    L.marker(fromCoords, { icon: greenIcon }).addTo(group)
      .bindTooltip(fromCity, { permanent: true, direction: "top", offset: [0, -16], className: "route-tooltip" });
    L.marker(toCoords, { icon: redIcon }).addTo(group)
      .bindTooltip(toCity, { permanent: true, direction: "top", offset: [0, -16], className: "route-tooltip" });

    L.polyline([fromCoords, toCoords], {
      color: "#10b981",
      weight: 4,
      opacity: 0.8,
      dashArray: "10, 8",
    }).addTo(group);

    const midLat = (fromCoords[0] + toCoords[0]) / 2;
    const midLng = (fromCoords[1] + toCoords[1]) / 2;
    if (selectedRoute) {
      L.marker([midLat, midLng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="background:#fff;border:2px solid #10b981;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:700;color:#059669;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.15)">${selectedRoute.distanceKm} км · ${selectedRoute.durationMin} мин</div>`,
          iconAnchor: [50, 14],
        }),
      }).addTo(group);
    }

    group.addTo(mapRef.current);
    layerRef.current = group;

    try {
      mapRef.current.fitBounds(group.getBounds().pad(0.15), { animate: false });
    } catch {}
  }, [fromCity, toCity, selectedRoute]);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="h-10 bg-white border-b border-gray-200 flex items-center px-4 shrink-0">
        <MapPin className="w-4 h-4 text-emerald-500 mr-2" />
        <span className="text-sm font-semibold text-gray-700">
          {fromCity && toCity && fromCity !== toCity
            ? `${fromCity} → ${toCity}`
            : "Карта маршрута"
          }
        </span>
        {selectedRoute && (
          <span className="ml-auto text-xs text-gray-500">
            {selectedRoute.distanceKm} км · {selectedRoute.durationMin} мин
          </span>
        )}
      </div>
      <div ref={mapContainerRef} className="flex-1" />
      <style>{`
        .route-tooltip {
          background: white !important;
          border: 2px solid #10b981 !important;
          border-radius: 8px !important;
          padding: 3px 8px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          color: #065f46 !important;
          box-shadow: 0 2px 8px rgba(0,0,0,.15) !important;
        }
        .route-tooltip::before { border-top-color: #10b981 !important; }
      `}</style>
    </div>
  );
}

export default function CreateOrderDrawer({ isOpen, onClose, onCreated }: {
  isOpen: boolean; onClose: () => void; onCreated: () => void;
}) {
  const { token, user } = useAuth();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const phoneRef = useRef<HTMLInputElement>(null);

  const [customerPhone, setCustomerPhone] = useState("+998");
  const phoneComplete = isPhoneComplete(customerPhone);
  const [gender, setGender] = useState<"male" | "female">("male");

  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const selectedRoute = routes.find(r => r.id === selectedRouteId) || null;
  const fromCity = selectedRoute?.fromCity || "";
  const toCity = selectedRoute?.toCity || "";

  const timeSlots = generateTimeSlots();
  const [timeSlot, setTimeSlot] = useState(() => getAutoTimeSlot(timeSlots));
  const [urgentMode, setUrgentMode] = useState(false);

  const [fromDistrictId, setFromDistrictId] = useState<number | null>(null);
  const [toDistrictId, setToDistrictId] = useState<number | null>(null);
  const [fromDistricts, setFromDistricts] = useState<District[]>([]);
  const [toDistricts, setToDistricts] = useState<District[]>([]);

  const [roundTrip, setRoundTrip] = useState(false);
  const [mailMode, setMailMode] = useState(false);
  const [isMoneyMode, setIsMoneyMode] = useState(false);
  const [carModels, setCarModels] = useState<string[]>([]);
  const [requiredCarModel, setRequiredCarModel] = useState<string>("");
  const [carClass, setCarClass] = useState<"economy" | "comfort" | "business">("economy");
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [payment, setPayment] = useState("cash");

  const [selectedSeats, setSelectedSeats] = useState<Set<number>>(new Set());
  const seatCount = selectedSeats.size;
  const hasFrontSeat = selectedSeats.has(1);

  const [saving, setSaving] = useState(false);
  const [cities, setCities] = useState<any[]>([]);
  const [priceData, setPriceData] = useState<PriceEstimate | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const priceAbortRef = useRef<AbortController | null>(null);
  const [optionsModalOpen, setOptionsModalOpen] = useState(false);

  const [routeDrivers, setRouteDrivers] = useState<any[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [preselectedDriver, setPreselectedDriver] = useState<{ id: number; name: string; assign: "force" | "offer" } | null>(null);

  useEffect(() => {
    if (isOpen) {
      try {
        const pending = sessionStorage.getItem("pendingCallClient");
        if (pending) {
          const client = JSON.parse(pending);
          if (client.phone) setCustomerPhone(client.phone);
          sessionStorage.removeItem("pendingCallClient");
        }
      } catch {}
      phoneRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`${BASE_URL}api/cities`, { headers });
        if (resp.ok) { const data = await resp.json(); setCities(data.cities || []); }
      } catch {}
    }
    load();
  }, [token]);

  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`${BASE_URL}api/routes`, { headers });
        if (resp.ok) { const data = await resp.json(); setRoutes((data.routes || []).filter((r: RouteOption) => r.isActive)); }
      } catch {}
    }
    load();
  }, [token]);

  const [allDistricts, setAllDistricts] = useState<District[]>([]);
  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`${BASE_URL}api/districts`, { headers });
        if (resp.ok) { const data = await resp.json(); setAllDistricts(data.districts || []); }
      } catch {}
    }
    load();
  }, [token]);

  useEffect(() => {
    setFromDistrictId(null); setToDistrictId(null);
    setSelectedSeats(new Set()); setPreselectedDriver(null);
    setSelectedOptions([]); setTimeSlot(getAutoTimeSlot(timeSlots)); setUrgentMode(false);
  }, [selectedRouteId]);

  useEffect(() => { if (roundTrip) setSelectedSeats(new Set([1, 2, 3, 4])); }, [roundTrip]);

  const resolveCitySlug = useCallback((cityRef: string): string => {
    if (!cityRef) return "";
    const cityObj = cities.find((c: any) => c.slug === cityRef || c.nameRu === cityRef || c.nameUz === cityRef);
    return cityObj?.slug || cityRef.toLowerCase();
  }, [cities]);

  useEffect(() => {
    if (!fromCity || allDistricts.length === 0 || cities.length === 0) { setFromDistricts([]); return; }
    const slug = resolveCitySlug(fromCity);
    setFromDistricts(allDistricts.filter(d => String(d.cityId).toLowerCase() === slug));
  }, [fromCity, allDistricts, resolveCitySlug, cities]);

  useEffect(() => {
    if (!toCity || allDistricts.length === 0 || cities.length === 0) { setToDistricts([]); return; }
    const slug = resolveCitySlug(toCity);
    setToDistricts(allDistricts.filter(d => String(d.cityId).toLowerCase() === slug));
  }, [toCity, allDistricts, resolveCitySlug, cities]);

  const frontSeats = hasFrontSeat ? 1 : 0;
  const backSeats = Array.from(selectedSeats).filter(s => s !== 1).length;
  const fullCar = seatCount === 4 || roundTrip;

  const fetchPrice = useCallback(async (fc: string, tc: string, fdId: number | null, tdId: number | null, cc: string, fSeats: number, bSeats: number, opts: string[]) => {
    if (!fc || !tc || fc === tc || (fSeats === 0 && bSeats === 0)) { setPriceData(null); return; }
    priceAbortRef.current?.abort();
    const ctrl = new AbortController();
    priceAbortRef.current = ctrl;
    setPriceLoading(true);
    try {
      const resp = await fetch(`${BASE_URL}api/rides/price-estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ fromCity: fc, toCity: tc, carClass: cc, fromDistrictId: fdId, toDistrictId: tdId, roundTrip, frontSeats: fSeats, backSeats: bSeats, selectedOptions: opts.length > 0 ? opts : undefined }),
        signal: ctrl.signal,
      });
      if (resp.ok) setPriceData(await resp.json());
    } catch (e: any) { if (e.name !== "AbortError") console.error(e); }
    finally { setPriceLoading(false); }
  }, [token, roundTrip]);

  useEffect(() => {
    fetchPrice(fromCity, toCity, fromDistrictId, toDistrictId, carClass, frontSeats, backSeats, selectedOptions);
  }, [fromCity, toCity, fromDistrictId, toDistrictId, roundTrip, carClass, frontSeats, backSeats, selectedOptions]);

  useEffect(() => {
    if (!fromCity || !toCity) { setRouteDrivers([]); return; }
    let cancelled = false;
    async function load() {
      setDriversLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("fromCity", fromCity);
        params.set("toCity", toCity);
        // Filter driver list by selected time interval (skip filter for urgent orders)
        if (!urgentMode && timeSlot) params.set("timeSlot", timeSlot);
        const resp = await fetch(`${BASE_URL}api/drivers/by-route?${params}`, { headers });
        if (resp.ok && !cancelled) setRouteDrivers((await resp.json()).drivers || []);
      } catch {}
      if (!cancelled) setDriversLoading(false);
    }
    load();
    const intv = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(intv); };
  }, [fromCity, toCity, token, timeSlot, urgentMode]);

  const toggleSeat = (n: number) => {
    if (roundTrip) return;
    setSelectedSeats(prev => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  };

  const handleSave = async () => {
    if (!isPhoneComplete(customerPhone)) { toast.error("Введите полный телефон"); return; }
    if (!selectedRoute) { toast.error("Выберите направление"); return; }
    if (!urgentMode && !timeSlot) { toast.error("Выберите время"); return; }
    if (!mailMode && seatCount === 0) { toast.error("Выберите место"); return; }

    setSaving(true);
    try {
      const fromDist = fromDistricts.find(d => d.id === fromDistrictId);
      const toDist = toDistricts.find(d => d.id === toDistrictId);
      const fromCityObj = cities.find((c: any) => c.slug === fromCity || c.nameRu === fromCity);
      const seatNums = Array.from(selectedSeats).sort();
      const seatPrice = priceData?.priceBack || priceData?.price || 0;
      const frontPrice = priceData?.priceFront || seatPrice;

      const rideResp = await fetch(`${BASE_URL}api/rides`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          fromCity, toCity,
          scheduledAt: urgentMode ? new Date().toISOString() : (() => {
            const slot = timeSlots.find(s => s.value === timeSlot);
            return (slot ? slot.dep : new Date()).toISOString();
          })(),
          timeSlot: urgentMode ? null : timeSlot,
          isUrgent: urgentMode || (timeSlots.find(s => s.value === timeSlot)?.isUrgent || false),
          isMail: mailMode,
          isMoney: mailMode && isMoneyMode,
          requiredCarModel: requiredCarModel || null,
          passengers: mailMode ? 0 : 1, carClass,
          riderName: gender === "female" ? "Женщина" : "Мужчина",
          riderPhone: customerPhone, gender, paymentType: payment,
          comment: selectedOptions.length > 0 ? selectedOptions.map(k => (selectedRoute?.tariffOptions?.[carClass] || []).find((o: any) => o.optionKey === k)?.label).filter(Boolean).join(", ") : undefined,
          roundTrip,
          selectedOptions: selectedOptions.length > 0 ? selectedOptions : undefined,
          fromDistrictId: fromDistrictId || undefined,
          toDistrictId: toDistrictId || undefined,
          seats: mailMode ? [] : seatNums.map(n => ({
            name: "", phone: customerPhone, seatNumber: n,
            price: n === 1 ? frontPrice : seatPrice, baggageType: "none",
            pickupLat: fromDist?.lat ?? fromCityObj?.lat ?? null,
            pickupLng: fromDist?.lng ?? fromCityObj?.lng ?? null,
            dropoffLat: toDist?.lat ?? null, dropoffLng: toDist?.lng ?? null,
          })),
        }),
      });
      if (!rideResp.ok) { const err = await rideResp.json().catch(() => ({})); throw new Error(err.message || "Ошибка"); }
      const ride = await rideResp.json();
      toast.success(mailMode ? `Заказ-почта #${ride.id} создан` : `Заказ #${ride.id} создан (${seatCount} мест)`);

      if (preselectedDriver) {
        const endpoint = preselectedDriver.assign === "force" ? "assign" : "offer";
        const r2 = await fetch(`${BASE_URL}api/dispatcher/${endpoint}`, {
          method: "POST", headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ rideId: ride.id, driverId: preselectedDriver.id }),
        });
        if (r2.ok) toast.success(preselectedDriver.assign === "force" ? `Назначен ${preselectedDriver.name}` : `Предложен ${preselectedDriver.name}`);
        else toast.error("Водителя назначить не удалось");
      }

      resetForm();
      onCreated();
      onClose();
    } catch (err: any) { toast.error(err.message || "Ошибка"); } finally { setSaving(false); }
  };

  const resetForm = () => {
    setCustomerPhone("+998"); setGender("male"); setSelectedRouteId(null);
    setSelectedSeats(new Set()); setRoundTrip(false); setMailMode(false); setPreselectedDriver(null);
    setSelectedOptions([]); setCarClass("economy"); setRequiredCarModel("");
    setFromDistrictId(null); setToDistrictId(null);
  };

  const fromCityName = cities.find((c: any) => c.slug === fromCity || c.nameRu === fromCity)?.nameRu || fromCity;
  const toCityName = cities.find((c: any) => c.slug === toCity || c.nameRu === toCity)?.nameRu || toCity;
  const totalPrice = priceData?.price || 0;
  const selectedFromDistrict = fromDistricts.find(d => d.id === fromDistrictId) || null;
  const selectedToDistrict = toDistricts.find(d => d.id === toDistrictId) || null;

  const OPTION_ICONS: Record<string, string> = {
    trunk_small: "🧳", trunk_large: "📦", roof: "🔝",
    parcel_s: "📨", parcel_m: "📬", parcel_l: "📫",
  };

  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    fetch(`${BASE_URL}api/drivers/car-models`, { headers })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (!cancel && Array.isArray(d)) setCarModels(d); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [isOpen]);

    if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 top-[52px] md:top-[46px] bg-black/30 z-40 hidden md:block" onClick={onClose} />
      <div className="fixed inset-0 top-[52px] md:top-[46px] z-50 flex flex-col md:flex-row animate-slide-in-right">
        <div className="w-full md:w-[420px] bg-card md:border-r border-border shadow-2xl flex flex-col shrink-0 h-full">
          <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
            <h2 className="font-bold text-foreground text-lg">Новый заказ</h2>
            <button onClick={() => { onClose(); resetForm(); }}
              className="w-9 h-9 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted active:bg-gray-200 hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Клиент</p>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${phoneComplete ? "bg-emerald-500/10" : "bg-muted"}`}>
                <User className={`w-4 h-4 ${phoneComplete ? "text-emerald-600" : "text-muted-foreground"}`} />
              </div>
              <input ref={phoneRef} type="tel" value={customerPhone}
                onChange={e => { let v = e.target.value.replace(/[^\d+]/g, ""); if (!v.startsWith("+998")) v = "+998"; if (v.length > 13) v = v.slice(0, 13); setCustomerPhone(v); }}
                maxLength={13}
                className={`flex-1 text-sm font-medium border rounded-lg px-3 py-2.5 md:py-2 outline-none bg-background ${phoneComplete ? "border-emerald-500" : "border-border focus:border-emerald-500"}`}
                placeholder="+998 __ ___ __ __" />
              {phoneComplete && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button type="button" onClick={() => setGender("male")}
                className={`flex items-center gap-1 px-4 md:px-3 py-2 md:py-1.5 rounded-lg text-sm md:text-xs font-bold transition-all ${gender === "male" ? "bg-blue-500/15 text-blue-600 border border-blue-500/30" : "bg-muted text-muted-foreground border border-transparent"}`}>
                👨 Муж
              </button>
              <button type="button" onClick={() => setGender("female")}
                className={`flex items-center gap-1 px-4 md:px-3 py-2 md:py-1.5 rounded-lg text-sm md:text-xs font-bold transition-all ${gender === "female" ? "bg-pink-500/15 text-pink-600 border border-pink-500/30" : "bg-muted text-muted-foreground border border-transparent"}`}>
                👩 Жен
              </button>
            </div>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button type="button" onClick={() => { setMailMode(false); setIsMoneyMode(false); }}
                className={`py-3 rounded-xl text-sm font-bold border-2 transition-all ${!mailMode ? "bg-emerald-500 text-white border-emerald-500 shadow-md" : "bg-background text-muted-foreground border-border hover:border-emerald-400"}`}>
                Пассажир
              </button>
              <button type="button" onClick={() => { setMailMode(true); setSelectedSeats(new Set()); setRoundTrip(false); }}
                className={`py-3 rounded-xl text-sm font-bold border-2 transition-all ${mailMode ? "bg-amber-500 text-white border-amber-500 shadow-md" : "bg-background text-muted-foreground border-border hover:border-amber-400"}`}>
                Почта/багаж
              </button>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Маршрут</p>
            <select value={selectedRouteId ?? ""} onChange={e => setSelectedRouteId(e.target.value ? Number(e.target.value) : null)}
              className="w-full text-sm font-medium border border-border rounded-lg px-3 py-2.5 md:py-2 outline-none focus:border-emerald-500 bg-background appearance-none"
              style={SELECT_STYLE}>
              <option value="">Выберите направление</option>
              {routes.map(r => {
                const f = cities.find((c: any) => c.slug === r.fromCity || c.nameRu === r.fromCity)?.nameRu || r.fromCity;
                const t = cities.find((c: any) => c.slug === r.toCity || c.nameRu === r.toCity)?.nameRu || r.toCity;
                return <option key={r.id} value={r.id}>{f} → {t} ({r.distanceKm} км)</option>;
              })}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Время</p>
              <button type="button" onClick={() => setUrgentMode(v => !v)}
                className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border transition-colors ${
                  urgentMode ? "bg-red-500 text-white border-red-500" : "bg-background text-muted-foreground border-border"
                }`}>
                ⚡ Срочный
              </button>
            </div>
            {urgentMode ? (
              <div className="w-full text-sm font-medium border border-red-500/40 rounded-lg px-3 py-2.5 md:py-2 bg-red-500/5 text-red-500">
                Срочный заказ — отправление сейчас
              </div>
            ) : (
              <select value={timeSlot} onChange={e => { setTimeSlot(e.target.value); setPreselectedDriver(null); }}
                className={`w-full text-sm font-medium border rounded-lg px-3 py-2.5 md:py-2 outline-none focus:border-emerald-500 bg-background appearance-none ${
                  timeSlots.find(s => s.value === timeSlot)?.isUrgent ? "border-red-500/40 text-red-500" : "border-border"
                }`} style={SELECT_STYLE}>
                {timeSlots.map(s => <option key={s.value} value={s.value}>{s.label}{s.isUrgent ? " ⚡" : ""}</option>)}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Район отпр.</p>
              <select value={fromDistrictId ?? ""} onChange={e => setFromDistrictId(e.target.value ? Number(e.target.value) : null)}
                className="w-full text-sm border border-border rounded-lg px-2.5 py-2 outline-none focus:border-emerald-500 bg-background appearance-none"
                style={{ ...SELECT_STYLE, backgroundPosition: "right 8px center" }}>
                <option value="">Район</option>
                {fromDistricts.map(d => <option key={d.id} value={d.id}>{d.name}{d.extraCharge > 0 ? ` +${Math.round(d.extraCharge / 1000)}т` : ""}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Район назн.</p>
              <select value={toDistrictId ?? ""} onChange={e => setToDistrictId(e.target.value ? Number(e.target.value) : null)}
                className="w-full text-sm border border-border rounded-lg px-2.5 py-2 outline-none focus:border-emerald-500 bg-background appearance-none"
                style={{ ...SELECT_STYLE, backgroundPosition: "right 8px center" }}>
                <option value="">Район</option>
                {toDistricts.map(d => <option key={d.id} value={d.id}>{d.name}{d.extraCharge > 0 ? ` +${Math.round(d.extraCharge / 1000)}т` : ""}</option>)}
              </select>
            </div>
          </div>
          {((selectedFromDistrict?.extraCharge || 0) > 0 || (selectedToDistrict?.extraCharge || 0) > 0) && (
            <div className="flex gap-2 -mt-2">
              {selectedFromDistrict && selectedFromDistrict.extraCharge > 0 && (
                <span className="text-[11px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">+{selectedFromDistrict.extraCharge.toLocaleString("ru-RU")}</span>
              )}
              {selectedToDistrict && selectedToDistrict.extraCharge > 0 && (
                <span className="text-[11px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">+{selectedToDistrict.extraCharge.toLocaleString("ru-RU")}</span>
              )}
            </div>
          )}

          {!mailMode && (
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
              {fullCar ? "Полный салон" : `Места (${seatCount})`}
            </p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4].map(n => {
                const active = selectedSeats.has(n);
                const isFront = n === 1;
                return (
                  <button key={n} type="button" onClick={() => toggleSeat(n)} disabled={roundTrip}
                    className={`w-16 h-16 rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all ${
                      active
                        ? "bg-blue-500 border-blue-500 text-white shadow-lg shadow-blue-500/30"
                        : "bg-background border-border text-muted-foreground hover:border-blue-400"
                    } ${roundTrip ? "opacity-60 cursor-not-allowed" : "cursor-pointer active:scale-95"}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {isFront ? (<><path d="M7 18v-2a5 5 0 0 1 10 0v2"/><circle cx="12" cy="8" r="4"/></>) : (<><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 19v-4a4 4 0 0 1 8 0v4"/></>)}
                    </svg>
                    <span className="text-[10px] font-bold leading-none">{isFront ? "Перед" : n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {mailMode && selectedRoute && (() => {
            const tariffOpts = selectedRoute?.tariffOptions?.[carClass] || [];
            const activeOpts = tariffOpts.filter((o: any) => o.isActive);
            return (
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Тип почты / багажа</p>
                <button type="button" onClick={() => setIsMoneyMode(v => !v)}
                  className={`w-full mb-2 flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${isMoneyMode ? "bg-emerald-500/15 border-emerald-500 text-foreground" : "bg-background border-border text-muted-foreground hover:border-emerald-400"}`}>
                  <span className="text-xl">💵</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold">Деньги</p>
                    <p className="text-[10px]">Только проверенным водителям</p>
                  </div>
                  {isMoneyMode && <span className="text-emerald-600 font-bold text-xs">✓ ВКЛ</span>}
                </button>
                {activeOpts.length === 0 ? (
                  <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 border border-border">
                    Для этого маршрута не настроены опции багажа. Откройте Справочники → Направления → выберите маршрут и добавьте опции.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {activeOpts.map((opt: any) => {
                      const isOn = selectedOptions.includes(opt.optionKey);
                      return (
                        <button key={opt.optionKey} type="button"
                          onClick={() => { if (isOn) setSelectedOptions(p => p.filter(k => k !== opt.optionKey)); else setSelectedOptions(p => [...p, opt.optionKey]); }}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${isOn ? "bg-amber-500/15 border-amber-500 text-foreground" : "bg-background border-border text-muted-foreground hover:border-amber-400"}`}>
                          <span className="text-lg">{OPTION_ICONS[opt.optionKey] || "📦"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold truncate">{opt.label}</p>
                            <p className="text-[10px]">+{Math.round(opt.price / 1000).toLocaleString()} тыс.</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Модель авто (необязательно)</p>
            <select value={requiredCarModel} onChange={e => setRequiredCarModel(e.target.value)}
              className={`w-full text-sm font-medium border rounded-lg px-3 py-2.5 md:py-2 outline-none bg-background appearance-none ${requiredCarModel ? "border-purple-500 text-purple-600 font-bold" : "border-border"}`}
              style={SELECT_STYLE}>
              <option value="">Любая модель — отправить любому водителю</option>
              {carModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {requiredCarModel && (
              <p className="text-[11px] text-purple-600 mt-1">Заказ получат только водители с авто «{requiredCarModel}»</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Тариф</p>
              <select value={carClass} onChange={e => { setCarClass(e.target.value as any); setSelectedOptions([]); }}
                className="w-full text-sm font-medium border border-border rounded-lg px-2.5 py-2 outline-none focus:border-emerald-500 bg-background appearance-none"
                style={{ ...SELECT_STYLE, backgroundPosition: "right 8px center" }}>
                <option value="economy">Эконом</option>
                <option value="comfort">Комфорт</option>
                <option value="business">Бизнес</option>
              </select>
            </div>
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Оплата</p>
              <select value={payment} onChange={e => setPayment(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-2.5 py-2 outline-none focus:border-emerald-500 bg-background appearance-none"
                style={{ ...SELECT_STYLE, backgroundPosition: "right 8px center" }}>
                <option value="cash">Наличные</option>
                <option value="card">Карта</option>
                <option value="transfer">Перевод</option>
              </select>
            </div>
          </div>

          {!mailMode && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={roundTrip} onChange={e => setRoundTrip(e.target.checked)} className="w-3.5 h-3.5 accent-emerald-500 rounded" />
              Туда и обратно
            </label>
            {(() => {
              const tariffOpts = selectedRoute?.tariffOptions?.[carClass] || [];
              const activeOpts = tariffOpts.filter((o: any) => o.isActive);
              if (!selectedRoute || activeOpts.length === 0) return null;
              return (
                <button type="button" onClick={() => setOptionsModalOpen(true)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border ml-auto ${selectedOptions.length > 0 ? "border-blue-500 text-blue-500 bg-blue-500/10" : "border-border text-muted-foreground hover:bg-muted"}`}>
                  <Package className="w-3.5 h-3.5" />
                  Допы{selectedOptions.length > 0 ? ` (${selectedOptions.length})` : ""}
                </button>
              );
            })()}
          </div>
          )}

          {selectedRoute && routeDrivers.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 flex items-center gap-1">
                <Car className="w-3 h-3 text-emerald-500" />
                Водители ({routeDrivers.length})
              </p>
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                {routeDrivers.slice(0, 8).map((rd: any) => {
                  const isP = preselectedDriver?.id === rd.driver.id;
                  const seatsTotal = rd.seatsTotal || 4;
                  const occupiedSeats: number[] = rd.occupiedSeats || [];
                  const seatsFree = rd.seatsFree ?? seatsTotal;
                  return (
                    <div key={rd.driver.id} className={`flex items-center gap-2 p-2 rounded-lg border text-xs transition-all ${isP ? "border-emerald-500 bg-emerald-500/5" : "border-border hover:bg-muted/50"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {rd.queuePosition && (
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold flex-shrink-0">
                              {rd.queuePosition}
                            </span>
                          )}
                          <p className="font-semibold text-foreground truncate">{rd.driver.carModel} <span className="font-mono text-muted-foreground">{rd.driver.carNumber}</span></p>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${rd.driver.carClass === "business" ? "bg-amber-500/15 text-amber-600" : rd.driver.carClass === "comfort" ? "bg-blue-500/15 text-blue-600" : "bg-emerald-500/15 text-emerald-600"}`}>
                            {rd.driver.carClass === "business" ? "Бизнес" : rd.driver.carClass === "comfort" ? "Комфорт" : "Эконом"}
                          </span>
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: seatsTotal }, (_, i) => {
                              const seatNum = i + 1;
                              const isOccupied = occupiedSeats.includes(seatNum);
                              const isFront = seatNum === 1;
                              return (
                                <span key={i} className={`inline-flex items-center justify-center w-4 h-4 rounded text-[8px] font-bold border ${isOccupied ? "bg-red-500 text-white border-red-600" : "bg-emerald-100 text-emerald-700 border-emerald-300"}`}
                                  title={`${isFront ? "Перед" : "Зад"} ${seatNum} — ${isOccupied ? "занято" : "свободно"}`}>
                                  {isFront ? "П" : seatNum}
                                </span>
                              );
                            })}
                          </div>
                          <span className={`text-[10px] font-medium ${seatsFree === 0 ? "text-red-500" : seatsFree <= 1 ? "text-amber-500" : "text-emerald-600"}`}>
                            {seatsFree === 0 ? "Нет мест" : `${seatsFree} св.`}
                          </span>
                        </div>
                      </div>
                      {isP ? (
                        <button onClick={() => setPreselectedDriver(null)} className="text-xs text-rose-500 hover:text-rose-600 px-2 py-1 rounded border border-rose-500/20"><X className="w-3 h-3" /></button>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={() => setPreselectedDriver({ id: rd.driver.id, name: rd.driver.name, assign: "force" })}
                            className="text-[10px] font-medium text-foreground border border-border px-2 py-1 rounded hover:bg-muted">Назн.</button>
                          <button onClick={() => setPreselectedDriver({ id: rd.driver.id, name: rd.driver.name, assign: "offer" })}
                            className="text-[10px] font-medium text-white bg-emerald-500 px-2 py-1 rounded hover:bg-emerald-600">Предл.</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-muted rounded-lg p-3 border border-border">
            {priceLoading ? (
              <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground py-1"><Loader2 className="w-3 h-3 animate-spin" />Расчёт...</div>
            ) : priceData ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold text-emerald-600">{priceData.price.toLocaleString("ru-RU")} сум</p>
                  <p className="text-[11px] text-muted-foreground">{fromCityName} → {toCityName}{roundTrip ? " • туда-обратно" : ""}</p>
                </div>
                <div className="text-right text-[11px] text-muted-foreground">
                  <p>{timeSlot.replace("-", " – ")}</p>
                  {seatCount > 0 && <p>{seatCount} мест</p>}
                  <p>{carClass === "economy" ? "Эконом" : carClass === "comfort" ? "Комфорт" : "Бизнес"}</p>
                </div>
              </div>
            ) : selectedRoute ? (
              <p className="text-sm text-muted-foreground text-center py-1">Тариф не настроен</p>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-1">Выберите маршрут</p>
            )}
          </div>
        </div>

          <div className="border-t border-border p-4 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button onClick={handleSave} disabled={saving || !phoneComplete || !selectedRoute || (!urgentMode && !timeSlot) || (!mailMode && seatCount === 0)}
              className={`w-full py-3.5 md:py-3 text-sm font-bold text-white rounded-xl transition-colors disabled:opacity-40 flex items-center justify-center gap-2 ${mailMode ? "bg-amber-500 hover:bg-amber-600 active:bg-amber-700" : "bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700"}`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? "Создаём..." : mailMode ? `Создать почту${selectedRoute?.priceMail ? ` (${Math.round(selectedRoute.priceMail).toLocaleString("ru-RU")} сум)` : ""}` : `Создать заказ${seatCount > 0 ? ` (${seatCount} мест)` : ""}`}
            </button>
          </div>
        </div>

        <div className="hidden md:block flex-1 relative bg-gray-100">
          <RouteMapPanel
            fromCity={fromCityName}
            toCity={toCityName}
            selectedRoute={selectedRoute}
          />
        </div>
      </div>

      {optionsModalOpen && (() => {
        const tariffOpts = selectedRoute?.tariffOptions?.[carClass] || [];
        const activeOpts = tariffOpts.filter((o: any) => o.isActive);
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setOptionsModalOpen(false)}>
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-[340px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h3 className="text-base font-bold text-foreground">Доп. опции</h3>
                <button onClick={() => setOptionsModalOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-3 space-y-1 max-h-[60vh] overflow-y-auto">
                {activeOpts.map((opt: any) => {
                  const isOn = selectedOptions.includes(opt.optionKey);
                  return (
                    <div key={opt.optionKey} onClick={() => { if (isOn) setSelectedOptions(p => p.filter(k => k !== opt.optionKey)); else setSelectedOptions(p => [...p, opt.optionKey]); }}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all ${isOn ? "bg-blue-500/10 border border-blue-500/30" : "border border-transparent hover:bg-muted"}`}>
                      <span className="text-lg">{OPTION_ICONS[opt.optionKey] || "📎"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">+{Math.round(opt.price / 1000).toLocaleString()} тыс.</p>
                      </div>
                      <div className={`w-11 h-6 rounded-full p-0.5 transition-colors ${isOn ? "bg-blue-500" : "bg-muted-foreground/30"}`}>
                        <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${isOn ? "translate-x-5" : "translate-x-0"}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-5 py-3 border-t border-border">
                <button onClick={() => setOptionsModalOpen(false)} className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700">Готово</button>
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in-right { animation: slideInRight 0.25s cubic-bezier(0.4,0,0.2,1); }
      `}</style>
    </>
  );
}
