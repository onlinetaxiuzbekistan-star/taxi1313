import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Phone, Check, X, Loader2, UserPlus, User, Car, Users, MessageCircle, Clock, MapPin, Hash, ChevronDown, Package } from "lucide-react";
import ChatModal from "@/components/ChatModal";
import { toast } from "sonner";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const BASE_URL = import.meta.env.BASE_URL || "";

function generateTimeSlots(): { value: string; label: string; isUrgent: boolean }[] {
  const slots: { value: string; label: string; isUrgent: boolean }[] = [];
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (let h = 0; h < 24; h++) {
    const startH = String(h).padStart(2, "0");
    const endH = String((h + 2) % 24).padStart(2, "0");
    const value = `${startH}:00-${endH}:00`;
    const label = `${startH}:00 – ${endH}:00`;
    const slotStartTime = h * 60;
    const isUrgent = slotStartTime >= nowMinutes - 30 && slotStartTime <= nowMinutes + 60;
    slots.push({ value, label, isUrgent });
  }
  return slots;
}

function getAutoTimeSlot(slots: { value: string; isUrgent: boolean }[]): string {
  const now = new Date();
  const nowH = now.getHours();
  const match = slots.find(s => {
    const h = parseInt(s.value.split(":")[0]);
    return h === nowH || h === nowH - 1;
  });
  if (match) return match.value;
  return slots[0]?.value || "";
}


interface RouteOptionItem {
  id: number;
  routeId: number;
  tariffClass?: string;
  optionKey: string;
  label: string;
  price: number;
  isActive: boolean;
  sortOrder: number;
}

interface RouteOption {
  id: number;
  fromCity: string;
  toCity: string;
  distanceKm: number;
  durationMin: number;
  priceEconomy: number;
  priceComfort: number;
  priceBusiness: number;
  priceFrontEconomy: number;
  priceFrontComfort: number;
  priceFrontBusiness: number;
  isActive: boolean;
  options: RouteOptionItem[];
  tariffOptions?: Record<string, RouteOptionItem[]>;
}

interface District {
  id: number;
  name: string;
  cityId: string;
  extraCharge: number;
  lat: number | null;
  lng: number | null;
}

interface PriceEstimate {
  price: number;
  priceFront: number;
  priceBack: number;
}


function isPhoneComplete(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 12;
}

function getSlotStartHour(slot: string): number {
  return parseInt(slot.split("-")[0].split(":")[0]);
}

function rideMatchesTimeSlot(scheduledAt: string, slot: string): boolean {
  const rideTime = new Date(scheduledAt).getTime();
  const slotStart = getSlotStartHour(slot);
  const now = new Date();
  const slotDate = new Date(now);
  slotDate.setHours(slotStart, 0, 0, 0);
  if (slotDate.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
    slotDate.setDate(slotDate.getDate() + 1);
  }
  const tolerance = 60 * 60 * 1000;
  return Math.abs(rideTime - slotDate.getTime()) <= tolerance;
}

const SELECT_ARROW_STYLE = {
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat" as const,
  backgroundPosition: "right 12px center",
};

export default function Overview() {
  const { token, user } = useAuth();
  const [, navigate] = useLocation();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const phoneRef = useRef<HTMLInputElement>(null);
  const routeRef = useRef<HTMLSelectElement>(null);

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

  const [fromDistrictId, setFromDistrictId] = useState<number | null>(null);
  const [toDistrictId, setToDistrictId] = useState<number | null>(null);
  const [fromDistricts, setFromDistricts] = useState<District[]>([]);
  const [toDistricts, setToDistricts] = useState<District[]>([]);

  const [roundTrip, setRoundTrip] = useState(false);
  const [carClass, setCarClass] = useState<"economy" | "comfort" | "business">("economy");
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [payment, setPayment] = useState("cash");

  const [selectedSeats, setSelectedSeats] = useState<Set<number>>(new Set());
  const seatCount = selectedSeats.size;
  const hasFrontSeat = selectedSeats.has(1);

  const [osrmInfo, setOsrmInfo] = useState<{ distanceKm: number; durationMin: number } | null>(null);

  const [chatPeer, setChatPeer] = useState<{ id: number; name: string; role: string; rideId?: number } | null>(null);
  const [preselectedDriver, setPreselectedDriver] = useState<{ id: number; name: string; assign: "force" | "offer" } | null>(null);
  const [saving, setSaving] = useState(false);

  const [cities, setCities] = useState<any[]>([]);

  const [priceData, setPriceData] = useState<PriceEstimate | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const priceAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { phoneRef.current?.focus(); }, []);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("pendingCallClient");
      if (pending) {
        const client = JSON.parse(pending);
        if (client.phone) setCustomerPhone(client.phone);
        sessionStorage.removeItem("pendingCallClient");
      }
    } catch {}
  }, []);

  useEffect(() => {
    async function loadCities() {
      try {
        const resp = await fetch(`${BASE_URL}api/cities`, { headers });
        if (resp.ok) { const data = await resp.json(); setCities(data.cities || []); }
      } catch {}
    }
    loadCities();
  }, [token]);

  useEffect(() => {
    async function loadRoutes() {
      try {
        const resp = await fetch(`${BASE_URL}api/routes`, { headers });
        if (resp.ok) {
          const data = await resp.json();
          setRoutes((data.routes || []).filter((r: RouteOption) => r.isActive));
        }
      } catch {}
    }
    loadRoutes();
  }, [token]);

  useEffect(() => {
    setFromDistrictId(null);
    setToDistrictId(null);
    setSelectedSeats(new Set());
    setPreselectedDriver(null);
    setSelectedOptions([]);
    setTimeSlot(getAutoTimeSlot(timeSlots));
  }, [selectedRouteId]);

  useEffect(() => {
    if (roundTrip) setSelectedSeats(new Set([1, 2, 3, 4]));
  }, [roundTrip]);

  const prevPhoneCompleteRef = useRef(false);
  useEffect(() => {
    if (phoneComplete && !prevPhoneCompleteRef.current) {
      setTimeout(() => routeRef.current?.focus(), 50);
    }
    prevPhoneCompleteRef.current = phoneComplete;
  }, [phoneComplete]);

  const [allDistricts, setAllDistricts] = useState<District[]>([]);

  useEffect(() => {
    async function loadAll() {
      try {
        const resp = await fetch(`${BASE_URL}api/districts`, { headers });
        if (resp.ok) { const data = await resp.json(); setAllDistricts(data.districts || []); }
      } catch {}
    }
    loadAll();
  }, [token]);

  const resolveCitySlug = useCallback((cityRef: string): string => {
    if (!cityRef) return "";
    const cityObj = cities.find((c: any) => c.slug === cityRef || c.nameRu === cityRef || c.nameUz === cityRef);
    if (cityObj?.slug) return cityObj.slug;
    return cityRef.toLowerCase();
  }, [cities]);

  useEffect(() => {
    if (!fromCity || allDistricts.length === 0) { setFromDistricts([]); return; }
    const slug = resolveCitySlug(fromCity);
    setFromDistricts(allDistricts.filter(d => String(d.cityId).toLowerCase() === slug));
  }, [fromCity, allDistricts, cities]);

  useEffect(() => {
    if (!toCity || allDistricts.length === 0) { setToDistricts([]); return; }
    const slug = resolveCitySlug(toCity);
    setToDistricts(allDistricts.filter(d => String(d.cityId).toLowerCase() === slug));
  }, [toCity, allDistricts, cities]);

  const frontSeats = hasFrontSeat ? 1 : 0;
  const backSeats = Array.from(selectedSeats).filter(s => s !== 1).length;
  const fullCar = seatCount === 4 || roundTrip;

  const fetchPrice = useCallback(async (fc: string, tc: string, fdId: number | null, tdId: number | null, cc: string, fSeats: number, bSeats: number, opts: string[]) => {
    if (!fc || !tc || fc === tc) { setPriceData(null); return; }
    if (fSeats === 0 && bSeats === 0) { setPriceData(null); return; }
    priceAbortRef.current?.abort();
    const ctrl = new AbortController();
    priceAbortRef.current = ctrl;
    setPriceLoading(true);
    try {
      const resp = await fetch(`${BASE_URL}api/rides/price-estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          fromCity: fc, toCity: tc, carClass: cc,
          fromDistrictId: fdId, toDistrictId: tdId, roundTrip,
          frontSeats: fSeats, backSeats: bSeats,
          selectedOptions: opts.length > 0 ? opts : undefined,
        }),
        signal: ctrl.signal,
      });
      if (resp.ok) {
        const data = await resp.json();
        setPriceData(data);
        console.log("PRICE:", data.price, "SEATS:", { front: fSeats, back: bSeats });
      }
    } catch (e: any) {
      if (e.name !== "AbortError") console.error(e);
    } finally { setPriceLoading(false); }
  }, [token, roundTrip]);

  useEffect(() => {
    fetchPrice(fromCity, toCity, fromDistrictId, toDistrictId, carClass, frontSeats, backSeats, selectedOptions);
  }, [fromCity, toCity, fromDistrictId, toDistrictId, roundTrip, carClass, frontSeats, backSeats, selectedOptions]);

  interface RouteDriver {
    driver: { id: number; name: string; phone: string; carModel: string; carNumber: string; rating: number | string };
    ride?: { id: number; fromCity: string; toCity: string; scheduledAt: string; status: string; carClass?: string } | null;
    seatsTaken: number; seatsTotal: number; seatsFree: number; totalEarnings: number;
  }
  const [routeDrivers, setRouteDrivers] = useState<RouteDriver[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);

  useEffect(() => {
    if (!fromCity || !toCity) { setRouteDrivers([]); return; }
    let cancelled = false;
    async function load() {
      setDriversLoading(true);
      try {
        const params = new URLSearchParams(); params.set("fromCity", fromCity); params.set("toCity", toCity);
        const resp = await fetch(`${BASE_URL}api/drivers/by-route?${params}`, { headers });
        if (resp.ok && !cancelled) setRouteDrivers((await resp.json()).drivers || []);
      } catch {}
      if (!cancelled) setDriversLoading(false);
    }
    load();
    const intv = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(intv); };
  }, [fromCity, toCity, token]);

  const filteredDrivers = useMemo(() => {
    if (!selectedRoute || !timeSlot) return [];
    const result = routeDrivers.filter(rd => {
      if (!rd.ride) return true;
      if (rd.ride.carClass && rd.ride.carClass !== carClass) return false;
      if (!rideMatchesTimeSlot(rd.ride.scheduledAt, timeSlot)) return false;
      return true;
    });
    console.log("VISIBLE DRIVERS:", result.length);
    return result;
  }, [routeDrivers, selectedRoute, timeSlot, carClass]);

  const showDrivers = !!selectedRoute && !!timeSlot;

  const queuePositions = useMemo(() => {
    const sorted = [...filteredDrivers].sort((a, b) => {
      const aTime = a.ride ? new Date(a.ride.scheduledAt).getTime() : Infinity;
      const bTime = b.ride ? new Date(b.ride.scheduledAt).getTime() : Infinity;
      return aTime - bTime;
    });
    const map: Record<number, number> = {};
    sorted.forEach((rd, i) => { map[rd.driver.id] = i + 1; });
    return map;
  }, [filteredDrivers]);

  const selectedFromDistrict = fromDistricts.find(d => d.id === fromDistrictId) || null;
  const selectedToDistrict = toDistricts.find(d => d.id === toDistrictId) || null;
  const totalPrice = priceData?.price || 0;

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (leafletMapRef.current) { leafletMapRef.current.remove(); leafletMapRef.current = null; }
    const map = L.map(mapRef.current, { zoomControl: false }).setView([40.5, 68], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; OSM', maxZoom: 18 }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    leafletMapRef.current = map;
    return () => { map.remove(); leafletMapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;
    let disposed = false;
    const safeMap = () => (!disposed && leafletMapRef.current && mapRef.current) ? leafletMapRef.current : null;
    map.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Polyline) map.removeLayer(l); });
    const fromC = cities.find((c: any) => c.slug === fromCity || c.nameRu === fromCity || c.nameUz === fromCity);
    const toC = cities.find((c: any) => c.slug === toCity || c.nameRu === toCity || c.nameUz === toCity);
    if (!fromC || !toC || fromCity === toCity) return;
    const fLat = selectedFromDistrict?.lat || fromC.lat;
    const fLng = selectedFromDistrict?.lng || fromC.lng;
    const tLat = selectedToDistrict?.lat || toC.lat;
    const tLng = selectedToDistrict?.lng || toC.lng;
    const greenIcon = L.divIcon({ html: `<div style="width:24px;height:24px;border-radius:50%;background:#10b981;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:11px">A</div>`, className: "", iconSize: [24, 24], iconAnchor: [12, 12] });
    const redIcon = L.divIcon({ html: `<div style="width:24px;height:24px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:11px">B</div>`, className: "", iconSize: [24, 24], iconAnchor: [12, 12] });
    const fromLatLng: L.LatLngExpression = [fLat, fLng];
    const toLatLng: L.LatLngExpression = [tLat, tLng];
    L.marker(fromLatLng, { icon: greenIcon }).addTo(map).bindPopup(`<b>${selectedFromDistrict ? `${fromC.nameRu}, ${selectedFromDistrict.name}` : fromC.nameRu}</b>`);
    L.marker(toLatLng, { icon: redIcon }).addTo(map).bindPopup(`<b>${selectedToDistrict ? `${toC.nameRu}, ${selectedToDistrict.name}` : toC.nameRu}</b>`);
    setOsrmInfo(null);
    const ctrl = new AbortController();
    fetch(`https://router.project-osrm.org/route/v1/driving/${fLng},${fLat};${tLng},${tLat}?overview=full&geometries=geojson`, { signal: ctrl.signal })
      .then(r => r.json()).then(data => {
        if (ctrl.signal.aborted || disposed) return;
        const m = safeMap();
        if (!m) return;
        if (data.code === "Ok" && data.routes?.[0]) {
          const route = data.routes[0];
          const distKm = Math.round(route.distance / 1000);
          const durMin = Math.round(route.duration / 60);
          setOsrmInfo({ distanceKm: distKm, durationMin: durMin });
          if (route.geometry?.coordinates) {
            const coords: L.LatLngExpression[] = route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as L.LatLngExpression);
            L.polyline(coords, { color: "#16a34a", weight: 5, opacity: 0.9 }).addTo(m);
            try { m.fitBounds(L.latLngBounds(coords), { padding: [40, 40], animate: false }); } catch {}
          }
        } else {
          L.polyline([fromLatLng, toLatLng], { color: "#16a34a", weight: 3, dashArray: "10 8", opacity: 0.7 }).addTo(m);
          try { m.fitBounds([fromLatLng, toLatLng], { padding: [40, 40], animate: false }); } catch {}
        }
      }).catch(() => {
        if (ctrl.signal.aborted || disposed) return;
        const m = safeMap();
        if (!m) return;
        L.polyline([fromLatLng, toLatLng], { color: "#16a34a", weight: 3, dashArray: "10 8", opacity: 0.7 }).addTo(m);
        try { m.fitBounds([fromLatLng, toLatLng], { padding: [40, 40], animate: false }); } catch {}
      });
    return () => { disposed = true; ctrl.abort(); };
  }, [fromCity, toCity, cities, selectedFromDistrict, selectedToDistrict]);

  const clickAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    clickAudioRef.current = new Audio("data:audio/wav;base64,UklGRl4CAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YToCAAB/AH8AfwB+AHwAeAByAGoAYABUAEYANgAlABQAAwDz/+P/0v/C/7P/pf+Y/43/g/97/3X/cf9v/2//cf91/3v/g/+N/5j/pf+z/8L/0v/j//P/AwAUACUANgBGAFQAYABqAHIAeAB8AH4AfwB/AH8AfgB8AHgAcgBqAGAAVABGADYAJQAUAAMA8//j/9L/wv+z/6X/mP+N/4P/e/91/3H/b/9v/3H/df97/4P/jf+Y/6X/s//C/9L/4//z/wMAFAAlADYARgBUAGAAagByAHgAfAB+AH8AfwA=");
    clickAudioRef.current.volume = 0.3;
  }, []);

  const [pressedSeat, setPressedSeat] = useState<number | null>(null);
  const [rippleSeat, setRippleSeat] = useState<number | null>(null);
  const [fullCarCelebration, setFullCarCelebration] = useState(false);
  const [optionsModalOpen, setOptionsModalOpen] = useState(false);

  const successAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    successAudioRef.current = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YVYGAACAgICAgICAgICAgICBgYKDhIaIi4+SlpmcoKOmqa2ws7a5u72/wMLDxMXFxcTDwb67uLWyr6yppqOgnZqXlJGOi4iGhIKBgH9/f39/f4CAgIGChIaJjJCTl5qeoaWor7O3u7/Dx8rN0NLU1dbX19bV09HOwcnFwb24s6+sqKSgnJmVko+Mi4mHhoWEg4OCgoKCgoOEhYeJjI+SlpqeoqausbW5vcHFyc3Q09bY2drb29va2NXS0MzIxMC8t7OvrKikoJ2amJWTkY+NjIuKiomJiYmKi4yOkJOWmZ2hpamusre7v8PHy87R1NfZ29zd3d3c29nX1NHOysbCvru3s7CsqaWioJ2bmZeVk5GQj46Ojo6Oj5CRk5WYm56ipqqusbW5vMDEyMvO0dTW2Nnb29va2djV0s/MyMXBvru3tLGvrKqopaOhoJ+enp6en5+goqSmqauusbS3ur3Aw8bJzM7R09XX2Nra2trZ2NbU0c/MysjFw8C+vLq4trWzs7KysrKztLW3uLu9wMLFx8rMz9HS1NbX2Nra2trZ2NfV09HQzsvJx8XDwcC+vby7uru6urq7vL2+wMHDxcfJy83P0NLU1dbX2NjY2NjX1tXU0tHPzsxLS0rJyMfGxcXExMTExcXGx8jJy8zOz9HS09TV1tfX2NjY2NfX1tXU09LR0M/Ozc3MzMvLy8vLy8zMzc3Oz9DR0tPU1dbX19jY2NjY19fW1dTT0tHQz87OzczMy8vLy8vLy8vLzMzNzc7P0NHR0tPU1NXW1tbX19fX19bW1dXU09LR0dDQz87Ozc3NzMzMzMzMzM3Nzs7P0NDR0dLS09TU1dXW1tbW1tbW1tXV1NTT0tLR0dDQz8/Ozs7Nzc3Nzc3Nzs7Oz9DQ0dHS0tPT1NTU1dXV1dXV1dXV1dTU09PS0tHR0NDQz8/Pzs7Ozs7Ozs7Pz8/Q0NDR0dLS0tPT09TU1NTU1NTU1NTU09PT0tLS0dHR0NDQz8/Pz8/Pz8/Pz9DQ0NDR0dHR0tLS09PT09TU1NTU1NTU1NTT09PS0tLR0dHR0NDQ0NDQz8/Pz9DQ0NDQ0dHR0dLS0tLS09PT09PT1NTU1NTU09PT09PS0tLS0dHR0dHR0dDQ0NDQ0NDQ0NDQ0dHR0dHR0tLS0tLS09PT09PT09PT09PT0tLS0tLS0dHR0dHR0dHR0NDQ0NDQ0NDR0dHR0dHR0tLS0tLS0tLS0tPT09PT09PT09PT09LS0tLS0tLR0dHR0dHR0dHR0dHR0dHR0dHR0tLS0tLS0tLS0tPT09PT09PT09PT09PT0tLS0tLS0tLS");
    successAudioRef.current.volume = 0.4;
  }, []);

  const flashRouteHighlight = () => {
    const map = leafletMapRef.current;
    if (!map) return;
    map.eachLayer((l: any) => {
      if (l instanceof L.Polyline && !(l instanceof L.Polygon)) {
        l.setStyle({ color: "#22c55e", weight: 7, opacity: 1 });
        setTimeout(() => l.setStyle({ color: "#16a34a", weight: 5, opacity: 0.9 }), 1000);
      }
    });
  };

  const prevFullCarRef = useRef(false);
  useEffect(() => {
    if (fullCar && !prevFullCarRef.current) {
      try { successAudioRef.current?.play().catch(() => {}); } catch {}
      if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      setFullCarCelebration(true);
      setTimeout(() => setFullCarCelebration(false), 1200);
    }
    prevFullCarRef.current = fullCar;
  }, [fullCar]);

  useEffect(() => {
    if (roundTrip) {
      setSelectedSeats(new Set([1, 2, 3, 4]));
    }
  }, [roundTrip]);

  const toggleSeat = (n: number) => {
    if (roundTrip) return;
    try { clickAudioRef.current?.play().catch(() => {}); } catch {}
    if (navigator.vibrate) navigator.vibrate(10);
    setPressedSeat(n);
    setTimeout(() => setPressedSeat(null), 200);
    setRippleSeat(n);
    setTimeout(() => setRippleSeat(null), 500);
    flashRouteHighlight();
    setSelectedSeats(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      console.log("SEATS:", Array.from(next), "FULL CAR:", next.size === 4);
      return next;
    });
  };

  const handleSave = async () => {
    if (!isPhoneComplete(customerPhone)) { toast.error("Введите полный телефон"); phoneRef.current?.focus(); return; }
    if (!selectedRoute) { toast.error("Выберите направление"); return; }
    if (!timeSlot) { toast.error("Выберите время"); return; }
    if (seatCount === 0) { toast.error("Выберите место"); return; }

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
          scheduledAt: (() => {
            const startHour = getSlotStartHour(timeSlot);
            const d = new Date(); d.setHours(startHour, 0, 0, 0);
            if (d.getTime() < Date.now()) d.setTime(Date.now());
            return d.toISOString();
          })(),
          timeSlot,
          isUrgent: timeSlots.find(s => s.value === timeSlot)?.isUrgent || false,
          passengers: 1,
          carClass,
          riderName: gender === "female" ? "Женщина" : "Мужчина",
          riderPhone: customerPhone,
          gender,
          paymentType: payment,
          comment: selectedOptions.length > 0 ? selectedOptions.map(k => (selectedRoute?.tariffOptions?.[carClass] || []).find((o: any) => o.optionKey === k)?.label).filter(Boolean).join(", ") : undefined,
          roundTrip,
          selectedOptions: selectedOptions.length > 0 ? selectedOptions : undefined,
          fromDistrictId: fromDistrictId || undefined,
          toDistrictId: toDistrictId || undefined,
          seats: seatNums.map(n => ({
            name: "",
            phone: customerPhone,
            seatNumber: n,
            price: n === 1 ? frontPrice : seatPrice,
            baggageType: "none",
            pickupLat: fromDist?.lat ?? fromCityObj?.lat ?? null,
            pickupLng: fromDist?.lng ?? fromCityObj?.lng ?? null,
            dropoffLat: toDist?.lat ?? null,
            dropoffLng: toDist?.lng ?? null,
          })),
        }),
      });
      if (!rideResp.ok) {
        const err = await rideResp.json().catch(() => ({}));
        throw new Error(err.message || "Ошибка создания заказа");
      }
      const ride = await rideResp.json();
      toast.success(`Заказ #${ride.id} создан (${seatCount} мест)`);

      if (preselectedDriver) {
        const endpoint = preselectedDriver.assign === "force" ? "assign" : "offer";
        const assignResp = await fetch(`${BASE_URL}api/dispatcher/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ rideId: ride.id, driverId: preselectedDriver.id }),
        });
        if (assignResp.ok) toast.success(preselectedDriver.assign === "force" ? `Водитель ${preselectedDriver.name} назначен` : `Предложен ${preselectedDriver.name}`);
        else toast.error("Водителя назначить не удалось");
      }

      setCustomerPhone("+998"); setGender("male"); setSelectedRouteId(null);
      setSelectedSeats(new Set());
      setRoundTrip(false); setPreselectedDriver(null);
      setSelectedOptions([]);
      setCarClass("economy");
      setFromDistrictId(null); setToDistrictId(null);
      phoneRef.current?.focus();
      navigate("/management/orders");
    } catch (err: any) {
      toast.error(err.message || "Ошибка");
    } finally { setSaving(false); }
  };

  const fromCityName = cities.find((c: any) => c.slug === fromCity || c.nameRu === fromCity)?.nameRu || fromCity;
  const toCityName = cities.find((c: any) => c.slug === toCity || c.nameRu === toCity)?.nameRu || toCity;

  return (
    <DispatcherLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden">

        <div className="w-[380px] bg-card border-r border-border flex flex-col h-full shrink-0">

          <div className="flex-1 overflow-y-auto">

            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Клиент</p>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${phoneComplete ? "bg-emerald-500/10" : "bg-muted"}`}>
                  <User className={`w-4 h-4 ${phoneComplete ? "text-emerald-600" : "text-muted-foreground"}`} />
                </div>
                <input ref={phoneRef} type="tel" value={customerPhone}
                  onChange={e => {
                    let v = e.target.value;
                    if (!v.startsWith("+998")) v = "+998";
                    setCustomerPhone(v);
                  }}
                  autoFocus
                  className={`flex-1 text-sm font-medium border rounded-lg px-3 py-2 outline-none bg-card placeholder:text-muted-foreground transition-colors ${phoneComplete ? "border-emerald-500 text-foreground" : "border-border focus:border-emerald-500"}`}
                  placeholder="+998 __ ___ __ __" />
                {phoneComplete && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0">Пол:</p>
                <button type="button" onClick={() => setGender("male")}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    gender === "male" ? "bg-blue-500/15 text-blue-600 border border-blue-500/30" : "bg-muted text-muted-foreground border border-transparent"
                  }`}>
                  👨 Мужчина
                </button>
                <button type="button" onClick={() => setGender("female")}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    gender === "female" ? "bg-pink-500/15 text-pink-600 border border-pink-500/30" : "bg-muted text-muted-foreground border border-transparent"
                  }`}>
                  👩 Женщина
                </button>
              </div>
            </div>

            <div className="px-3 pt-2 pb-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Маршрут</p>
              <select ref={routeRef} value={selectedRouteId ?? ""} onChange={e => setSelectedRouteId(e.target.value ? Number(e.target.value) : null)}
                className="w-full text-sm font-medium border border-border rounded-lg px-3 py-2 outline-none focus:border-emerald-500 bg-background appearance-none"
                style={SELECT_ARROW_STYLE}>
                <option value="">Выберите направление</option>
                {routes.map(r => {
                  const f = cities.find((c: any) => c.slug === r.fromCity || c.nameRu === r.fromCity)?.nameRu || r.fromCity;
                  const t = cities.find((c: any) => c.slug === r.toCity || c.nameRu === r.toCity)?.nameRu || r.toCity;
                  return <option key={r.id} value={r.id}>{f} → {t} ({r.distanceKm} км)</option>;
                })}
              </select>
            </div>

            <div className="px-3 pt-2 pb-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Время</p>
              <select value={timeSlot} onChange={e => { setTimeSlot(e.target.value); setPreselectedDriver(null); }}
                className={`w-full text-sm font-medium border rounded-lg px-3 py-2 outline-none focus:border-emerald-500 bg-background appearance-none ${
                  timeSlots.find(s => s.value === timeSlot)?.isUrgent ? "border-red-500/40 text-red-500" : "border-border"
                }`}
                style={SELECT_ARROW_STYLE}>
                {timeSlots.map(s => (
                  <option key={s.value} value={s.value}>{s.label}{s.isUrgent ? " ⚡" : ""}</option>
                ))}
              </select>
            </div>

            <div className="px-3 pt-2 pb-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Район отправления</p>
                  <select value={fromDistrictId ?? ""} onChange={e => setFromDistrictId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-2 outline-none focus:border-emerald-500 bg-background appearance-none truncate"
                    style={{ ...SELECT_ARROW_STYLE, backgroundPosition: "right 8px center" }}>
                    <option value="">Выберите район</option>
                    {fromDistricts.map(d => (
                      <option key={d.id} value={d.id}>{d.name}{d.extraCharge > 0 ? ` +${Math.round(d.extraCharge / 1000)}т` : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Район назначения</p>
                  <select value={toDistrictId ?? ""} onChange={e => setToDistrictId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-2 outline-none focus:border-emerald-500 bg-background appearance-none truncate"
                    style={{ ...SELECT_ARROW_STYLE, backgroundPosition: "right 8px center" }}>
                    <option value="">Выберите район</option>
                    {toDistricts.map(d => (
                      <option key={d.id} value={d.id}>{d.name}{d.extraCharge > 0 ? ` +${Math.round(d.extraCharge / 1000)}т` : ""}</option>
                    ))}
                  </select>
                </div>
              </div>
              {((selectedFromDistrict?.extraCharge || 0) > 0 || (selectedToDistrict?.extraCharge || 0) > 0) && (
                <div className="mt-1.5 flex gap-2">
                  {selectedFromDistrict && selectedFromDistrict.extraCharge > 0 && (
                    <span className="text-[11px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      +{selectedFromDistrict.extraCharge.toLocaleString("ru-RU")}
                    </span>
                  )}
                  {selectedToDistrict && selectedToDistrict.extraCharge > 0 && (
                    <span className="text-[11px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      +{selectedToDistrict.extraCharge.toLocaleString("ru-RU")}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="px-3 pt-2 pb-1 space-y-3">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  {fullCar ? "Полный салон" : `Места (${seatCount})`}
                </p>
                <div className="flex justify-center gap-2.5" style={{
                  animation: fullCarCelebration ? "seatCelebrate 0.6s ease" : "none",
                }}>
                  {[1, 2, 3, 4].map(n => {
                    const active = selectedSeats.has(n);
                    const pressed = pressedSeat === n;
                    const showRipple = rippleSeat === n;
                    const isFront = n === 1;
                    return (
                      <button key={n} type="button" onClick={() => toggleSeat(n)}
                        disabled={roundTrip}
                        className="relative outline-none select-none overflow-hidden"
                        style={{
                          width: 80, height: 80,
                          borderRadius: 20,
                          border: `2.5px solid ${active ? "#3b82f6" : "var(--border, #334155)"}`,
                          transition: "all 0.2s ease",
                          transform: pressed ? "scale(0.92)" : fullCarCelebration && active ? "scale(1.08)" : "translateY(0)",
                          background: active
                            ? "linear-gradient(135deg, #3b82f6, #2563eb)"
                            : "var(--background, #1e293b)",
                          color: active ? "#fff" : "var(--muted-foreground, #94a3b8)",
                          boxShadow: active
                            ? fullCarCelebration
                              ? "0 0 40px rgba(59,130,246,0.7), 0 0 80px rgba(59,130,246,0.3)"
                              : "0 10px 30px rgba(59,130,246,0.5), 0 0 15px rgba(59,130,246,0.3)"
                            : "0 2px 4px rgba(0,0,0,0.15)",
                          opacity: roundTrip ? 0.65 : 1,
                          cursor: roundTrip ? "not-allowed" : "pointer",
                        }}
                        onMouseEnter={e => { if (!roundTrip) { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = active ? "0 14px 36px rgba(59,130,246,0.55), 0 0 20px rgba(59,130,246,0.35)" : "0 6px 16px rgba(0,0,0,0.25)"; }}}
                        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = active ? "0 10px 30px rgba(59,130,246,0.5), 0 0 15px rgba(59,130,246,0.3)" : "0 2px 4px rgba(0,0,0,0.15)"; }}>
                        <div className="flex flex-col items-center justify-center h-full gap-1">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {isFront ? (<>
                              <path d="M7 18v-2a5 5 0 0 1 10 0v2"/>
                              <circle cx="12" cy="8" r="4"/>
                            </>) : (<>
                              <rect x="4" y="5" width="16" height="14" rx="3"/>
                              <path d="M8 19v-4a4 4 0 0 1 8 0v4"/>
                            </>)}
                          </svg>
                          <span className="text-xs font-bold leading-none">{isFront ? "Перед" : n}</span>
                        </div>
                        {showRipple && (
                          <span className="absolute inset-0 pointer-events-none" style={{
                            background: "radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)",
                            animation: "seatRipple 0.5s ease-out forwards",
                          }}/>
                        )}
                      </button>
                    );
                  })}
                </div>
                {fullCarCelebration && (
                  <p className="text-center text-xs font-bold text-blue-400 mt-2 animate-pulse">Полный салон!</p>
                )}
                <style>{`
                  @keyframes seatRipple { 0% { transform: scale(0); opacity: 1; } 100% { transform: scale(2.5); opacity: 0; } }
                  @keyframes seatCelebrate { 0% { transform: scale(1); } 30% { transform: scale(1.06); } 60% { transform: scale(0.98); } 100% { transform: scale(1); } }
                `}</style>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Тариф</p>
                  <select value={carClass} onChange={e => { setCarClass(e.target.value as "economy" | "comfort" | "business"); setSelectedOptions([]); flashRouteHighlight(); }}
                    className="w-full text-sm font-medium border border-border rounded-lg px-2.5 py-2 outline-none focus:border-emerald-500 bg-background appearance-none"
                    style={{ ...SELECT_ARROW_STYLE, backgroundPosition: "right 8px center" }}>
                    <option value="economy">Эконом</option>
                    <option value="comfort">Комфорт</option>
                    <option value="business">Бизнес</option>
                  </select>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Оплата</p>
                  <select value={payment} onChange={e => setPayment(e.target.value)}
                    className="w-full text-sm border border-border rounded-lg px-2.5 py-2 outline-none focus:border-emerald-500 bg-background appearance-none"
                    style={{ ...SELECT_ARROW_STYLE, backgroundPosition: "right 8px center" }}>
                    <option value="cash">Наличные</option>
                    <option value="card">Карта</option>
                    <option value="transfer">Перевод</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={roundTrip} onChange={e => setRoundTrip(e.target.checked)}
                    className="w-3.5 h-3.5 accent-emerald-500 rounded" />
                  <span>Туда и обратно</span>
                </label>
                {(() => {
                  const tariffOpts = selectedRoute?.tariffOptions?.[carClass] || [];
                  const activeOpts = tariffOpts.filter((o: any) => o.isActive);
                  if (!selectedRoute || activeOpts.length === 0) return null;
                  const OPTION_ICONS: Record<string, string> = {
                    trunk_small: "🧳", trunk_large: "📦", roof: "🔝",
                    parcel_s: "📨", parcel_m: "📬", parcel_l: "📫",
                  };
                  return (
                    <>
                      <button type="button" onClick={() => setOptionsModalOpen(true)}
                        className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ml-auto ${selectedOptions.length > 0 ? "border-blue-500 text-blue-500 bg-blue-500/10" : "border-border text-muted-foreground hover:bg-muted"}`}>
                        <Package className="w-4 h-4" />
                        <span>Дополнительно{selectedOptions.length > 0 ? ` (${selectedOptions.length})` : ""}</span>
                      </button>
                      {optionsModalOpen && (
                        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setOptionsModalOpen(false)}>
                          <div className="bg-card border border-border rounded-2xl shadow-2xl w-[340px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                              <h3 className="text-base font-bold text-foreground">Доп. опции</h3>
                              <button type="button" onClick={() => setOptionsModalOpen(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="p-3 space-y-1 max-h-[60vh] overflow-y-auto">
                              {activeOpts.map((opt: any) => {
                                const isOn = selectedOptions.includes(opt.optionKey);
                                return (
                                  <div key={opt.optionKey}
                                    onClick={() => {
                                      if (isOn) setSelectedOptions(p => p.filter(k => k !== opt.optionKey));
                                      else setSelectedOptions(p => [...p, opt.optionKey]);
                                    }}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all ${isOn ? "bg-blue-500/10 border border-blue-500/30" : "border border-transparent hover:bg-muted"}`}>
                                    <span className="text-lg">{OPTION_ICONS[opt.optionKey] || "📎"}</span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-foreground truncate">{opt.label}</p>
                                      <p className="text-xs text-muted-foreground">+{Math.round(opt.price / 1000).toLocaleString()} тыс. сум</p>
                                    </div>
                                    <div className={`w-11 h-6 rounded-full p-0.5 transition-colors ${isOn ? "bg-blue-500" : "bg-muted-foreground/30"}`}>
                                      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${isOn ? "translate-x-5" : "translate-x-0"}`} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="px-5 py-3 border-t border-border">
                              <button type="button" onClick={() => setOptionsModalOpen(false)}
                                className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition-colors">
                                Готово
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="mx-3 mt-2 mb-2 bg-muted rounded-lg p-3 border border-border">
              {priceLoading ? (
                <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground py-1"><Loader2 className="w-3 h-3 animate-spin" />Расчёт цены...</div>
              ) : priceData ? (
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-lg font-bold text-emerald-600">{priceData.price.toLocaleString("ru-RU")} сум</p>
                    <p className="text-[11px] text-muted-foreground">
                      {fromCityName} → {toCityName}
                      {roundTrip && " • туда-обратно"}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <p>{timeSlot.replace("-", " – ")}</p>
                    {seatCount > 0 && <p>{seatCount} мест</p>}
                    <p className="capitalize">{carClass === "economy" ? "Эконом" : carClass === "comfort" ? "Комфорт" : "Бизнес"}</p>
                  </div>
                </div>
              ) : selectedRoute ? (
                <p className="text-sm text-muted-foreground text-center py-1">Тариф не настроен</p>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-1">Выберите маршрут</p>
              )}
            </div>

          </div>

          <div className="sticky bottom-0 bg-card border-t border-border p-3">
            <button onClick={handleSave} disabled={saving || !phoneComplete || !selectedRoute || !timeSlot || seatCount === 0}
              className="w-full py-3 text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? "Создаём..." : `Создать заказ${seatCount > 0 ? ` (${seatCount} мест${seatCount === 1 ? "о" : seatCount < 5 ? "а" : ""})` : ""}`}
            </button>
          </div>
        </div>

        <div className="w-[280px] bg-muted border-r border-border flex flex-col h-full shrink-0">
          <div className="p-3 border-b border-border bg-card">
            <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5 text-emerald-600" />
              Водители на маршруте
            </p>
            {showDrivers && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {driversLoading ? (
                  <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Загрузка...</span>
                ) : filteredDrivers.length > 0 ? (
                  <span className="text-emerald-600 font-semibold">{filteredDrivers.length} водител{filteredDrivers.length === 1 ? "ь" : filteredDrivers.length < 5 ? "я" : "ей"}</span>
                ) : (
                  <span>Нет подходящих</span>
                )}
              </p>
            )}
            {!showDrivers && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {!selectedRoute ? "Выберите маршрут" : "Выберите время"}
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {!showDrivers && (
              <div className="text-center text-muted-foreground py-10">
                <MapPin className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-xs">{!selectedRoute ? "Сначала выберите маршрут" : "Выберите время отправления"}</p>
              </div>
            )}
            {showDrivers && filteredDrivers.length === 0 && !driversLoading && (
              <div className="text-center text-muted-foreground py-10">
                <UserPlus className="w-8 h-8 mx-auto mb-1.5 text-muted-foreground/50" />
                <p className="text-xs">Нет водителей</p>
                <p className="text-[10px] mt-1">на этот маршрут и время</p>
              </div>
            )}
            {showDrivers && filteredDrivers.map(rd => {
              const isP = preselectedDriver?.id === rd.driver.id;
              const queuePos = queuePositions[rd.driver.id] || 0;
              const hasRide = !!rd.ride;
              const timeStr = hasRide ? (() => { const t = new Date(rd.ride.scheduledAt); return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; })() : "";
              const fName = hasRide ? (cities.find((c: any) => c.slug === rd.ride.fromCity || c.nameRu === rd.ride.fromCity)?.nameRu || rd.ride.fromCity) : "";
              const tName = hasRide ? (cities.find((c: any) => c.slug === rd.ride.toCity || c.nameRu === rd.ride.toCity)?.nameRu || rd.ride.toCity) : "";
              console.log("DRIVER ONLINE:", rd.driver.id);

              return (
                <div key={`d${rd.driver.id}-${rd.ride?.id || "free"}`} className={`bg-card rounded-lg border shadow-sm text-xs transition-all ${isP ? "border-emerald-400 ring-1 ring-emerald-400/30" : "border-emerald-500/20"}`}>
                  <div className="p-2.5 pb-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-emerald-500/10 text-emerald-600 font-bold text-[11px] shrink-0">
                          {rd.driver.id}
                        </span>
                        <span className="font-semibold text-foreground truncate">{rd.driver.carModel}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setChatPeer({ id: rd.driver.id, name: rd.driver.name, role: "driver", rideId: rd.ride?.id })}
                          className="w-5 h-5 bg-muted hover:bg-blue-500/10 text-muted-foreground hover:text-blue-600 rounded flex items-center justify-center active:scale-90 transition-all"><MessageCircle className="w-2.5 h-2.5" /></button>
                        <button onClick={() => { navigator.clipboard.writeText(rd.driver.phone); toast.success("Скопировано"); }}
                          className="w-5 h-5 bg-muted hover:bg-blue-500/10 text-muted-foreground hover:text-blue-600 rounded flex items-center justify-center active:scale-90 transition-all"><Phone className="w-2.5 h-2.5" /></button>
                      </div>
                    </div>

                    <p className="text-[11px] font-mono font-bold text-foreground tracking-wider mb-1.5">{rd.driver.carNumber}</p>

                    {hasRide ? (
                      <>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                          <MapPin className="w-2.5 h-2.5 text-emerald-500 shrink-0" />
                          <span className="truncate">{fName} → {tName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-2">
                          <Clock className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                          <span>{timeStr}</span>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1">
                            <Users className="w-3 h-3 text-muted-foreground" />
                            <span className="text-[10px]">
                              <span className="font-bold text-foreground">{rd.seatsTaken}/{rd.seatsTotal}</span>
                              <span className={`ml-1 font-semibold ${rd.seatsFree > 0 ? "text-emerald-600" : "text-red-500"}`}>
                                ({rd.seatsFree} св.)
                              </span>
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px]">
                            <Hash className="w-2.5 h-2.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Очередь:</span>
                            <span className="font-bold text-foreground">#{queuePos}</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[10px] mb-2">
                        <Car className="w-3 h-3 text-emerald-500" />
                        <span className="text-emerald-600 font-medium">Свободен</span>
                        <span className="ml-auto text-muted-foreground">#{queuePos}</span>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border/50 px-2.5 py-2">
                    {isP ? (
                      <div className="flex items-center justify-between bg-emerald-500/10 rounded px-2 py-1 border border-emerald-500/20">
                        <span className="text-emerald-700 font-medium flex items-center gap-1"><Check className="w-3 h-3" />{preselectedDriver?.assign === "force" ? "Назн." : "Предл."}</span>
                        <button onClick={() => setPreselectedDriver(null)} className="text-muted-foreground hover:text-red-500 active:scale-90 transition-all"><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <button onClick={() => setPreselectedDriver({ id: rd.driver.id, name: rd.driver.name, assign: "force" })}
                          className="flex-1 py-1 font-medium text-foreground border border-border rounded hover:bg-muted active:bg-accent transition-colors">Назначить</button>
                        <button onClick={() => setPreselectedDriver({ id: rd.driver.id, name: rd.driver.name, assign: "offer" })}
                          className="flex-1 py-1 font-medium text-white bg-emerald-500 rounded hover:bg-emerald-600 active:scale-[0.97] transition-all">Предложить</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 relative">
          <div ref={mapRef} className="absolute inset-0 z-0" />
          {fromCity && toCity && fromCity !== toCity && (
            <div className="absolute top-3 left-3 bg-foreground/95 backdrop-blur rounded-lg shadow-lg border border-border px-3 py-2 z-[1000]">
              <p className="text-sm font-bold text-foreground">
                {fromCityName}{selectedFromDistrict ? ` (${selectedFromDistrict.name})` : ""}
                {" → "}
                {toCityName}{selectedToDistrict ? ` (${selectedToDistrict.name})` : ""}
              </p>
              {osrmInfo ? (
                <p className="text-xs text-emerald-600 font-semibold mt-0.5">
                  {osrmInfo.distanceKm} км
                  {" • "}
                  {osrmInfo.durationMin >= 60
                    ? `${Math.floor(osrmInfo.durationMin / 60)}ч ${osrmInfo.durationMin % 60 > 0 ? `${osrmInfo.durationMin % 60} мин` : ""}`
                    : `${osrmInfo.durationMin} мин`}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">Построение маршрута...</p>
              )}
              {totalPrice > 0 && (
                <p className="text-base font-bold text-emerald-600 mt-0.5">{totalPrice.toLocaleString("ru-RU")} сум</p>
              )}
            </div>
          )}
        </div>
      </div>
      {chatPeer && (
        <ChatModal open={!!chatPeer} onClose={() => setChatPeer(null)} token={token} myUserId={user?.id} myRole={user?.role || "dispatcher"}
          peerId={chatPeer.id} peerName={chatPeer.name} peerRole={chatPeer.role} rideId={chatPeer.rideId} />
      )}
    </DispatcherLayout>
  );
}
