import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import DispatcherLayout from "./DispatcherLayout";
import CreateOrderDrawer from "./CreateOrderDrawer";
import { useGetRides, useGetDrivers } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { PlusCircle, Search, X, MapPin, Phone, Car, Loader2, RefreshCw, UserCheck, AlertTriangle, Edit3, Clock, Radio, Play, CheckCircle, XCircle, History, ChevronRight, User, CreditCard, MessageSquare, ArrowRight, Zap, PhoneCall, ChevronDown, Plus, Filter, ClipboardList, ShoppingBag, Route, Package, RotateCcw} from "lucide-react";
import { TableSkeleton, ErrorState } from "@/components/PageStates";
import { toast } from "sonner";

const BASE_URL = import.meta.env.BASE_URL || "";

const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
const WAITING_THRESHOLD_MS = 2 * 60 * 1000;

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  pending:     { label: "Новый",     color: "text-amber-700",   bg: "bg-amber-100",   border: "border-amber-300", dot: "bg-amber-500" },
  offered:     { label: "Предложен", color: "text-indigo-700",  bg: "bg-indigo-100",  border: "border-indigo-300", dot: "bg-indigo-500" },
  accepted:    { label: "Принят",    color: "text-emerald-700", bg: "bg-emerald-100", border: "border-emerald-300", dot: "bg-emerald-500" },
  merged:      { label: "Принят",    color: "text-emerald-700", bg: "bg-emerald-100", border: "border-emerald-300", dot: "bg-emerald-500" },
  in_progress: { label: "В пути",    color: "text-blue-700",    bg: "bg-blue-100",    border: "border-blue-300", dot: "bg-blue-500" },
  completed:   { label: "Завершён",  color: "text-gray-600",    bg: "bg-gray-100",    border: "border-gray-300", dot: "bg-gray-400" },
  cancelled:   { label: "Отменён",   color: "text-rose-700",    bg: "bg-rose-100",    border: "border-rose-300", dot: "bg-rose-500" },
};

const TARIFF_LABEL: Record<string, string> = { economy: "Эконом", comfort: "Комфорт", business: "Бизнес" };
const PAYMENT_LABEL: Record<string, string> = { cash: "Наличные", card: "Карта", transfer: "Перевод" };

function cityName(id: string) {
  const map: Record<string, string> = {
    tashkent: "Ташкент", fergana: "Фергана", andijan: "Андижан", samarkand: "Самарканд",
    bukhara: "Бухара", namangan: "Наманган", nukus: "Нукус", urgench: "Ургенч",
    qarshi: "Карши", termez: "Термез", jizzakh: "Джиззах", navoiy: "Навои",
    kokand: "Коканд", margilan: "Маргилан", gulistan: "Гулистан",
  };
  return map[id] || id;
}

type ViewMode = "orders" | "marketplace" | "trips";

function isDriverTrip(ride: any): boolean {
  if (ride.source === "driver") return true;
  return !ride.riderPhone && ride.driverId && ride.seatsTotal > 0 && !ride.tripId;
}

function isMarketplace(ride: any): boolean {
  return ride.source === "marketplace";
}

function isDispatcherOrder(ride: any): boolean {
  return !isDriverTrip(ride) && !isMarketplace(ride);
}

function isStuck(ride: any): boolean {
  if (ride.status !== "pending" && ride.status !== "offered") return false;
  return (Date.now() - new Date(ride.createdAt).getTime()) > STUCK_THRESHOLD_MS;
}

function waitingMin(ride: any): number {
  return Math.floor((Date.now() - new Date(ride.createdAt).getTime()) / 60000);
}

function ridePriority(ride: any): number {
  if (isStuck(ride)) return 0;
  if (ride.status === "pending") return Date.now() - new Date(ride.createdAt).getTime() > WAITING_THRESHOLD_MS ? 1 : 2;
  if (ride.status === "offered") return 3;
  if (ride.status === "accepted") return 4;
  if (ride.status === "in_progress") return 5;
  return 6;
}

function fmtTime(d: string) {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function fmtPrice(p: number) {
  return p ? p.toLocaleString("ru-RU") : "—";
}

function AssignModal({ rideId, onClose, headers, onAssigned }: {
  rideId: number; onClose: () => void;
  headers: Record<string, string>;
  onAssigned: () => void;
}) {
  const [assigning, setAssigning] = useState<number | null>(null);
  // Assignable = idle online drivers (free) + drivers already on a matching route
  // with spare seats (onRoute). In the intercity model most working drivers are
  // "busy" on a route but still ready to take more passengers, so listing only
  // online drivers left this dialog empty even when cars were available.
  const [free, setFree] = useState<any[]>([]);
  const [onRoute, setOnRoute] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${BASE_URL}api/dispatcher/assignable-drivers?rideId=${rideId}`, { headers });
        if (res.ok) {
          const d = await res.json();
          if (!cancelled) { setFree(d.free || []); setOnRoute(d.onRoute || []); }
        }
      } catch { /* keep last */ } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const iv = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [rideId]);

  const handleAssign = async (driverId: number) => {
    setAssigning(driverId);
    try {
      const resp = await fetch(`${BASE_URL}api/dispatcher/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ rideId, driverId }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({} as any));
        toast.error(body.message || "Ошибка назначения");
        return;
      }
      toast.success("Заказ отправлен водителю");
      onAssigned();
      onClose();
    } catch {
      toast.error("Ошибка назначения");
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[80] flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md max-h-[85vh] md:max-h-[80vh] flex flex-col" role="dialog" aria-modal="true" aria-label="Назначить водителя" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 md:p-5 border-b border-gray-200">
          <h3 className="font-bold text-gray-900 text-lg">Назначить водителя</h3>
          <button onClick={onClose} aria-label="Закрыть" className="text-gray-400 hover:text-gray-700 p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2">
          {(() => {
            const renderRow = (d: any, route?: any) => (
              <div key={d.id} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3 hover:bg-gray-50 active:bg-gray-100 transition-colors">
                <div className={`w-10 h-10 md:w-9 md:h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${route ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {(d.name || "?").charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">
                    {d.name}
                    {typeof d.distanceKm === "number" && (
                      <span className="ml-2 text-xs font-medium text-gray-400">{d.distanceKm} км</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{d.carModel} · {d.carNumber}</p>
                  {route && (
                    <p className="text-xs text-amber-600 truncate">
                      На рейсе {route.fromCity} → {route.toCity} · {route.freeSeats} мест
                    </p>
                  )}
                </div>
                <button disabled={assigning !== null} onClick={() => handleAssign(d.id)}
                  className="px-4 py-2 md:px-3.5 md:py-1.5 text-xs font-semibold text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5">
                  {assigning === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Назначить
                </button>
              </div>
            );

            if (loading && free.length === 0 && onRoute.length === 0) {
              return <div className="text-center py-10 text-gray-400"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>;
            }
            if (free.length === 0 && onRoute.length === 0) {
              return (
                <div className="text-center py-10 text-gray-400">
                  <Car className="w-10 h-10 mx-auto mb-2" />
                  <p>Нет доступных водителей</p>
                </div>
              );
            }
            return (
              <>
                {free.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-gray-400 uppercase px-1 pt-1">Свободны ({free.length})</p>
                    {free.map((d: any) => renderRow(d))}
                  </>
                )}
                {onRoute.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-amber-500 uppercase px-1 pt-3">На рейсе, есть места ({onRoute.length})</p>
                    {onRoute.map((d: any) => renderRow(d, d.route))}
                  </>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function EditModal({ ride, onClose, headers, onSaved }: {
  ride: any; onClose: () => void;
  headers: Record<string, string>;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fromAddress: ride.fromAddress || "",
    toAddress: ride.toAddress || "",
    passengers: ride.passengers || 1,
    carClass: ride.carClass || "economy",
    price: ride.price || 0,
    riderName: ride.riderName || "",
    riderPhone: ride.riderPhone || "",
    comment: ride.comment || "",
    paymentType: ride.paymentType || "cash",
  });
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [optionsModalOpen, setOptionsModalOpen] = useState(false);
  const [seatPassengers, setSeatPassengers] = useState<any[]>([]);
  const [matchedRoute, setMatchedRoute] = useState<any | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [cities, setCities] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [fromDistrictId, setFromDistrictId] = useState<number | null>(ride.fromDistrictId ?? ride.from_district_id ?? null);
  const [toDistrictId, setToDistrictId] = useState<number | null>(ride.toDistrictId ?? ride.to_district_id ?? null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, dRes] = await Promise.all([
          fetch(`${BASE_URL}api/rides/cities`, { headers }),
          fetch(`${BASE_URL}api/districts`, { headers }),
        ]);
        if (cRes.ok) { const d = await cRes.json(); if (!cancelled) setCities(d.cities || []); }
        if (dRes.ok) { const d = await dRes.json(); if (!cancelled) setDistricts(d.districts || []); }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  const cityNameToSlug = (name: string): string | null => {
    if (!name) return null;
    const lc = name.toLowerCase();
    const c = cities.find(x =>
      String(x.id).toLowerCase() === lc ||
      String(x.nameRu || "").toLowerCase() === lc ||
      String(x.nameUz || "").toLowerCase() === lc ||
      String(x.slug || "").toLowerCase() === lc);
    return c ? String(c.id) : null;
  };
  const fromCitySlug = cityNameToSlug(ride.fromCity || ride.from_city);
  const toCitySlug = cityNameToSlug(ride.toCity || ride.to_city);
  const fromDistricts = districts.filter(d => d.isActive && d.cityId === fromCitySlug);
  const toDistricts = districts.filter(d => d.isActive && d.cityId === toCitySlug);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${BASE_URL}api/routes`, { headers });
        if (!resp.ok) return;
        const data = await resp.json();
        const fc = String(ride.fromCity || ride.from_city || "").toLowerCase();
        const tc = String(ride.toCity || ride.to_city || "").toLowerCase();
        const r = (data.routes || []).find((x: any) =>
          x.isActive && String(x.fromCity).toLowerCase() === fc && String(x.toCity).toLowerCase() === tc);
        if (!cancelled) setMatchedRoute(r || null);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [ride.id]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BASE_URL}api/rides/${ride.id}/passengers`, { headers });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setSeatPassengers(Array.isArray(d.passengers) ? d.passengers : (Array.isArray(d) ? d : []));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [ride.id]);
  const originalPriceRef = useRef<number>(ride.price || 0);
  const optsTouchedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!matchedRoute) return;
    if (selectedOptions.length === 0) {
      // user removed all options after touching — revert to original price
      if (optsTouchedRef.current) setForm(p => ({ ...p, price: originalPriceRef.current }));
      return;
    }
    optsTouchedRef.current = true;
    let cancelled = false;
    setPriceLoading(true);
    (async () => {
      try {
        const fc = String(ride.fromCity || ride.from_city || "");
        const tc = String(ride.toCity || ride.to_city || "");
        const resp = await fetch(`${BASE_URL}api/pricing/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            fromCity: fc, toCity: tc, carClass: form.carClass,
            fromDistrictId: fromDistrictId,
            toDistrictId: toDistrictId,
            roundTrip: false,
            selectedOptions,
          }),
        });
        if (resp.ok) {
          const d = await resp.json();
          if (!cancelled && typeof d.total === "number") setForm(p => ({ ...p, price: d.total }));
        }
      } catch {} finally { if (!cancelled) setPriceLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [JSON.stringify(selectedOptions), form.carClass, matchedRoute?.id]);
  const update = (key: string, val: any) => setForm(p => ({ ...p, [key]: val }));
  const handleSave = async () => {
    setSaving(true);
    try {
      const optsCommentParts: string[] = [];
      if (selectedOptions.length > 0 && matchedRoute) {
        const tariffOpts = matchedRoute.tariffOptions?.[form.carClass] || [];
        for (const k of selectedOptions) {
          const o = tariffOpts.find((x: any) => x.optionKey === k);
          if (o?.label) optsCommentParts.push(o.label);
        }
      }
      const finalComment = optsCommentParts.length > 0
        ? (form.comment ? `${form.comment} | Допы: ${optsCommentParts.join(", ")}` : `Допы: ${optsCommentParts.join(", ")}`)
        : form.comment;
      const resp = await fetch(`${BASE_URL}api/rides/${ride.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ ...form, comment: finalComment, fromDistrictId, toDistrictId }),
      });
      if (!resp.ok) throw new Error();
      toast.success("Заказ обновлён");
      onSaved();
      onClose();
    } catch {
      toast.error("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2.5 md:py-2 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20";

  return (
    <div className="fixed inset-0 bg-black/40 z-[80] flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-lg max-h-[90vh] flex flex-col" role="dialog" aria-modal="true" aria-label="Редактирование заказа" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 md:p-5 border-b border-gray-200">
          <h3 className="font-bold text-gray-900 text-lg">Заказ #{ride.id}</h3>
          <button onClick={onClose} aria-label="Закрыть" className="text-gray-400 hover:text-gray-700 p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">Маршрут</div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <Route className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{ride.from_city || ride.fromCity || "—"}</span>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
              <span>{ride.to_city || ride.toCity || "—"}</span>
              {(ride.distance || ride.route_distance) ? (
                <span className="text-xs text-gray-500 font-normal ml-1">· {Math.round(Number(ride.distance || ride.route_distance))} км</span>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3 text-emerald-600" />Район отправления</label>
              <select value={fromDistrictId ?? ""} onChange={e => setFromDistrictId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                <option value="">— без района —</option>
                {fromDistricts.map(d => (
                  <option key={d.id} value={d.id}>{d.name}{d.extraCharge ? ` (+${Math.round(d.extraCharge/1000)}т)` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3 text-rose-600" />Район назначения</label>
              <select value={toDistrictId ?? ""} onChange={e => setToDistrictId(e.target.value ? parseInt(e.target.value) : null)} className={inputCls}>
                <option value="">— без района —</option>
                {toDistricts.map(d => (
                  <option key={d.id} value={d.id}>{d.name}{d.extraCharge ? ` (+${Math.round(d.extraCharge/1000)}т)` : ""}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Адрес отправления</label>
              <input value={form.fromAddress} onChange={e => update("fromAddress", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Адрес назначения</label>
              <input value={form.toAddress} onChange={e => update("toAddress", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Имя</label>
              <input value={form.riderName} onChange={e => update("riderName", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Телефон</label>
              <input value={form.riderPhone} onChange={e => update("riderPhone", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Пассажиры</label>
              <input type="number" min={1} max={8} value={form.passengers}
                onChange={e => update("passengers", parseInt(e.target.value) || 1)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Класс</label>
              <select value={form.carClass} onChange={e => update("carClass", e.target.value)} className={inputCls}>
                <option value="economy">Эконом</option>
                <option value="comfort">Комфорт</option>
                <option value="business">Бизнес</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Оплата</label>
              <select value={form.paymentType} onChange={e => update("paymentType", e.target.value)} className={inputCls}>
                <option value="cash">Наличные</option>
                <option value="card">Карта</option>
                <option value="transfer">Перевод</option>
              </select>
            </div>
          </div>
          {seatPassengers.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Места пассажиров ({seatPassengers.length})</label>
              <div className="space-y-2">
                {seatPassengers.map((sp: any) => {
                  const cur = sp.seatNumber ?? sp.seat_number ?? sp.seat ?? null;
                  const occupied = new Set<number>(seatPassengers.filter((x: any) => x.id !== sp.id).map((x: any) => x.seatNumber ?? x.seat_number ?? x.seat).filter((n: any) => n != null));
                  const changeSeat = async (newSeat: number) => {
                    if (newSeat === cur) return;
                    if (occupied.has(newSeat)) { toast.error(`Место ${newSeat} занято другим пассажиром`); return; }
                    try {
                      const r = await fetch(`${BASE_URL}api/rides/${ride.id}/passengers/${sp.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json", ...headers },
                        body: JSON.stringify({ seatNumber: newSeat }),
                      });
                      if (!r.ok) {
                        const e = await r.json().catch(() => ({} as any));
                        toast.error(e.message || "Ошибка смены места");
                        return;
                      }
                      const upd = await r.json();
                      setSeatPassengers(prev => prev.map((x: any) => x.id === sp.id ? { ...x, seatNumber: upd.seatNumber } : x));
                      if (upd.ride && typeof upd.ride.price === "number") {
                        setForm(f => ({ ...f, price: upd.ride.price }));
                        ride.price = upd.ride.price;
                        toast.success(`Место изменено · новая сумма ${Number(upd.ride.price).toLocaleString("ru-RU")} сум`);
                        try { window.dispatchEvent(new Event("buxtaxi:rides_changed")); } catch {}
                      } else {
                        toast.success(newSeat === 1 ? "Пересажен на переднее место" : `Пересажен на место ${newSeat}`);
                      }
                    } catch { toast.error("Ошибка сети"); }
                  };
                  return (
                    <div key={sp.id} className="border border-gray-200 rounded-xl p-2.5 bg-gray-50/50">
                      <div className="text-[11px] text-gray-600 mb-1.5 truncate">{sp.name || "Пассажир"}</div>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4].map(n => {
                          const isCur = n === cur;
                          const isTaken = occupied.has(n);
                          const isFront = n === 1;
                          const cls = isCur
                            ? "bg-blue-500 border-blue-500 text-white shadow-md"
                            : isTaken
                              ? "bg-rose-50 border-rose-200 text-rose-300 cursor-not-allowed"
                              : "bg-white border-gray-300 text-gray-600 hover:border-blue-400 hover:bg-blue-50";
                          return (
                            <button key={n} type="button" onClick={() => !isTaken && changeSeat(n)} disabled={isTaken}
                              className={`flex-1 h-12 rounded-lg border-2 flex flex-col items-center justify-center gap-0.5 transition-all ${cls}`}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                {isFront ? (<><path d="M7 18v-2a5 5 0 0 1 10 0v2"/><circle cx="12" cy="8" r="4"/></>) : (<><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 19v-4a4 4 0 0 1 8 0v4"/></>)}
                              </svg>
                              <span className="text-[10px] font-bold leading-none">{isFront ? "Перед" : n}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-500 mt-1.5">Нажмите место чтобы пересадить пассажира. Занятые места — красные. Если в машине водителя есть свободные места, изменение применится сразу.</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Цена (сум) {priceLoading && <span className="text-blue-500">пересчёт…</span>}</label>
            <input type="number" value={form.price} onChange={e => update("price", parseFloat(e.target.value) || 0)} className={inputCls} />
            {(() => {
              const tariffOpts = matchedRoute?.tariffOptions?.[form.carClass] || [];
              const activeOpts = tariffOpts.filter((o: any) => o.isActive);
              const hasOpts = matchedRoute && activeOpts.length > 0;
              return (
                <button type="button" onClick={() => hasOpts && setOptionsModalOpen(true)} disabled={!hasOpts}
                  title={hasOpts ? "Добавить дополнительные опции" : "Для этого маршрута опции не настроены"}
                  className={`mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border ${hasOpts ? (selectedOptions.length > 0 ? "border-blue-500 text-blue-600 bg-blue-50" : "border-gray-300 text-gray-600 hover:bg-gray-50") : "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"}`}>
                  <Package className="w-3.5 h-3.5" />
                  Допы{selectedOptions.length > 0 ? ` (${selectedOptions.length})` : ""}{!hasOpts ? " · нет" : ""}
                </button>
              );
            })()}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Комментарий</label>
            <textarea value={form.comment} onChange={e => update("comment", e.target.value)} rows={2}
              className={`${inputCls} resize-none`} />
          </div>
        </div>
        <div className="p-4 md:p-5 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2.5 md:py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Отмена</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 md:py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>
    
      {optionsModalOpen && (() => {
        const tariffOpts = matchedRoute?.tariffOptions?.[form.carClass] || [];
        const activeOpts = tariffOpts.filter((o: any) => o.isActive);
        return (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50" onClick={() => setOptionsModalOpen(false)}>
            <div className="bg-white border border-gray-200 rounded-2xl shadow-2xl w-[340px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <h3 className="text-base font-bold text-gray-900">Доп. опции</h3>
                <button onClick={() => setOptionsModalOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-3 space-y-1 max-h-[60vh] overflow-y-auto">
                {activeOpts.map((opt: any) => {
                  const isOn = selectedOptions.includes(opt.optionKey);
                  return (
                    <div key={opt.optionKey} onClick={() => { if (isOn) setSelectedOptions(p => p.filter(k => k !== opt.optionKey)); else setSelectedOptions(p => [...p, opt.optionKey]); }}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all ${isOn ? "bg-blue-50 border border-blue-300" : "border border-transparent hover:bg-gray-50"}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{opt.label}</p>
                        <p className="text-xs text-gray-500">+{Math.round((opt.price || 0) / 1000).toLocaleString()} тыс.</p>
                      </div>
                      <div className={`w-11 h-6 rounded-full p-0.5 transition-colors ${isOn ? "bg-blue-500" : "bg-gray-300"}`}>
                        <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${isOn ? "translate-x-5" : "translate-x-0"}`} />
                      </div>
                    </div>
                  );
                })}
                {activeOpts.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Нет доступных опций</p>}
              </div>
              <div className="px-5 py-3 border-t border-gray-200">
                <button onClick={() => setOptionsModalOpen(false)} className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-700">Готово</button>
              </div>
            </div>
          </div>
        );
      })()}
</div>
  );
}

interface DispatchInfo {
  rideId: number;
  offeredTo: { id: number; name: string; distance: number }[];
  groupIndex: number;
  totalGroups: number;
  expiresAt: string;
}

function DetailPanel({ ride, dispatchInfo, onAssign, onStatusChange, onEdit, onCancel, onClose, updating, isMobile }: {
  ride: any;
  dispatchInfo?: DispatchInfo;
  onAssign: () => void;
  onStatusChange: (status: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onClose: () => void;
  updating: boolean;
  isMobile?: boolean;
}) {
  const st = STATUS_MAP[ride.status] || STATUS_MAP.pending;
  const stuck = isStuck(ride);
  const isActive = !["completed", "cancelled"].includes(ride.status);
  const [tab, setTab] = useState<"details" | "history">("details");

  const timeline = useMemo(() => {
    const items: { time: string; label: string; icon: React.ReactNode; color: string }[] = [];
    items.push({ time: fmtTime(ride.createdAt), label: ride.createdByUserName ? `Заказ создан · ${ride.createdByUserName}` : "Заказ создан", icon: <PlusCircle className="w-3.5 h-3.5" />, color: "text-emerald-500" });
    if (["offered", "accepted", "in_progress", "completed"].includes(ride.status)) {
      items.push({ time: ride.offeredAt ? fmtTime(ride.offeredAt) : fmtTime(ride.updatedAt), label: "Предложен водителю", icon: <Radio className="w-3.5 h-3.5" />, color: "text-indigo-500" });
    }
    if (["accepted", "in_progress", "completed"].includes(ride.status)) {
      items.push({ time: ride.acceptedAt ? fmtTime(ride.acceptedAt) : fmtTime(ride.updatedAt), label: `Принят: ${ride.driverName || "—"}`, icon: <UserCheck className="w-3.5 h-3.5" />, color: "text-blue-500" });
    }
    if (["in_progress", "completed"].includes(ride.status)) {
      items.push({ time: ride.startedAt ? fmtTime(ride.startedAt) : fmtTime(ride.updatedAt), label: "Поездка начата", icon: <Play className="w-3.5 h-3.5" />, color: "text-sky-500" });
    }
    if (ride.status === "completed") {
      items.push({ time: ride.completedAt ? fmtTime(ride.completedAt) : fmtTime(ride.updatedAt), label: "Завершён", icon: <CheckCircle className="w-3.5 h-3.5" />, color: "text-emerald-500" });
    }
    if (ride.status === "cancelled") {
      items.push({ time: fmtTime(ride.updatedAt), label: "Отменён", icon: <XCircle className="w-3.5 h-3.5" />, color: "text-rose-500" });
    }
    return items;
  }, [ride]);

  const content = (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-gray-900">#{ride.id}</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.bg} ${st.color}`}>
            {st.label}
          </span>
          {stuck && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700 animate-pulse flex items-center gap-1">
              <Zap className="w-3 h-3" /> {waitingMin(ride)} мин
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 active:bg-gray-200">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex border-b border-gray-200">
        <button onClick={() => setTab("details")}
          className={`flex-1 text-xs font-semibold py-3 md:py-2.5 transition-colors ${tab === "details" ? "text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50/50" : "text-gray-500 hover:text-gray-700"}`}>
          ПОДРОБНОСТИ
        </button>
        <button onClick={() => setTab("history")}
          className={`flex-1 text-xs font-semibold py-3 md:py-2.5 transition-colors ${tab === "history" ? "text-emerald-600 border-b-2 border-emerald-500 bg-emerald-50/50" : "text-gray-500 hover:text-gray-700"}`}>
          ИСТОРИЯ
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "details" ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-gray-50 border border-gray-100">
              <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                  {cityName(ride.fromCity)}
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                  {cityName(ride.toCity)}
                </div>
                {(ride.fromAddress || ride.toAddress) && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {ride.fromAddress}{ride.fromAddress && ride.toAddress ? " → " : ""}{ride.toAddress}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">{ride.distance} км · {ride.duration} мин</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-3 p-3 md:p-2.5 rounded-lg bg-gray-50/70">
                <User className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-800 truncate">
                    {ride.riderName || "—"}
                    {ride.riderName === "Женщина" ? " ♀" : ride.riderName === "Мужчина" ? " ♂" : ""}
                  </p>
                  {ride.riderPhone && (
                    <a href={`tel:${ride.riderPhone}`} className="text-xs text-emerald-600 hover:underline flex items-center gap-0.5 mt-0.5">
                      <Phone className="w-3 h-3" />{ride.riderPhone}
                    </a>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2.5 p-3 md:p-2.5 rounded-lg bg-gray-50/70">
                  <CreditCard className="w-4 h-4 text-gray-400 shrink-0" />
                  <div>
                    <p className="text-[13px] font-bold text-gray-900">{ride.price ? `${fmtPrice(ride.price)} сум` : "—"}</p>
                    <p className="text-[11px] text-gray-500">{PAYMENT_LABEL[ride.paymentType] || ride.paymentType}</p>
                  </div>
                </div>
                <div className={`flex items-center gap-2.5 p-3 md:p-2.5 rounded-lg ${ride.requiredCarModel ? "bg-purple-50 border border-purple-200" : "bg-gray-50/70"}`}>
                  <Car className={`w-4 h-4 shrink-0 ${ride.requiredCarModel ? "text-purple-600" : "text-gray-400"}`} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-gray-800 truncate">
                      {ride.requiredCarModel ? ride.requiredCarModel : (TARIFF_LABEL[ride.carClass] || ride.carClass)}
                    </p>
                    <p className="text-[11px] text-gray-500">{ride.isMail ? "Почта/багаж" : `${ride.passengers} пас.`}</p>
                  </div>
                  {ride.isUrgent && (
                    <span className="ml-auto text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded">⚡</span>
                  )}
                </div>
              </div>

              {ride.driverName ? (
                <div className="flex items-center gap-2.5 p-3 md:p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                  <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-900 truncate">{ride.driverName}</p>
                    <p className="text-[11px] text-gray-500 truncate">{ride.driverCar} {ride.driverCarNumber}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 md:p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700 font-medium">Водитель не назначен</p>
                </div>
              )}

              {ride.comment && (
                <div className="flex items-start gap-2 p-3 md:p-2.5 rounded-lg bg-blue-50 border border-blue-100">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-700">{ride.comment}</p>
                </div>
              )}

              {dispatchInfo && (
                <div className="p-3 md:p-2.5 rounded-lg bg-indigo-50 border border-indigo-200">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 mb-1">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    Автодиспетчер — группа {dispatchInfo.groupIndex}/{dispatchInfo.totalGroups}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {dispatchInfo.offeredTo.map(d => (
                      <span key={d.id} className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-700 border border-indigo-200">
                        {d.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="relative pl-5">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gray-200" />
              {timeline.map((item, i) => (
                <div key={i} className="relative mb-4 last:mb-0">
                  <div className={`absolute -left-5 top-0.5 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center ${item.color} bg-white z-10`}>
                    {item.icon}
                  </div>
                  <div className="ml-1">
                    <p className="text-xs font-semibold text-gray-800">{item.label}</p>
                    <p className="text-[11px] text-gray-400">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {isActive && (
        <div className="p-3 border-t border-gray-200 flex items-center gap-2 flex-wrap bg-gray-50">
          {ride.status === "pending" && (
            <button onClick={onAssign}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 md:py-2 text-sm md:text-xs font-semibold text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 active:bg-emerald-700 shadow-sm">
              <UserCheck className="w-4 h-4 md:w-3.5 md:h-3.5" /> Назначить
            </button>
          )}
          {(ride.status === "offered" || ride.status === "accepted") && (
            <button onClick={() => onStatusChange("in_progress")}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 md:py-2 text-sm md:text-xs font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 active:bg-blue-700 shadow-sm">
              <Play className="w-4 h-4 md:w-3.5 md:h-3.5" /> В пути
            </button>
          )}
          {ride.status === "in_progress" && (
            <button onClick={() => onStatusChange("completed")}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 md:py-2 text-sm md:text-xs font-semibold text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 active:bg-emerald-700 shadow-sm">
              <CheckCircle className="w-4 h-4 md:w-3.5 md:h-3.5" /> Завершить
            </button>
          )}
          <button onClick={onEdit}
            className="px-3 py-2.5 md:py-2 text-sm md:text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-white active:bg-gray-100 flex items-center gap-1.5 shadow-sm">
            <Edit3 className="w-4 h-4 md:w-3.5 md:h-3.5" /> Изменить
          </button>
          <button onClick={onCancel} disabled={updating}
            className="px-3 py-2.5 md:py-2 text-sm md:text-xs font-medium text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50 active:bg-rose-100 flex items-center gap-1.5">
            {updating ? <Loader2 className="w-4 h-4 md:w-3.5 md:h-3.5 animate-spin" /> : <XCircle className="w-4 h-4 md:w-3.5 md:h-3.5" />}
            Отмена
          </button>
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[90vh] rounded-t-2xl overflow-hidden shadow-2xl animate-slide-up">
          {content}
        </div>
      </>
    );
  }

  return <div className="h-full">{content}</div>;
}

function MobileOrderCard({ ride, dispatchMap, onSelect, onAssign, onStatusChange, onEdit, onCancel, onInlineAssign, onlineDrivers }: {
  ride: any;
  dispatchMap: Record<number, DispatchInfo>;
  onSelect: () => void;
  onAssign: () => void;
  onStatusChange: (status: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onInlineAssign: (driverId: number) => void;
  onlineDrivers: any[];
}) {
  const st = STATUS_MAP[ride.status] || STATUS_MAP.pending;
  const stuck = isStuck(ride);
  const wMin = waitingMin(ride);

  return (
    <div
      onClick={onSelect}
      className={`p-3.5 border-b border-gray-200 active:bg-gray-50 transition-colors ${
        stuck ? "bg-rose-50/50 border-l-[3px] border-l-rose-400" : "border-l-[3px] border-l-transparent"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.bg} ${st.color}`}>
            {st.label}
          </span>
          {stuck && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 animate-pulse flex items-center gap-0.5">
              <Zap className="w-3 h-3" /> {wMin}м
            </span>
          )}
          {dispatchMap[ride.id] && (
            <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-600 flex items-center gap-0.5">
              <Radio className="w-2.5 h-2.5 animate-pulse" />{dispatchMap[ride.id].offeredTo.length}
            </span>
          )}
        </div>
        <div className="text-right">
          {ride.source === "driver" && ride.scheduledAt ? (
            <>
              <p className="text-sm font-bold text-blue-700">{fmtTime(ride.scheduledAt)}</p>
              <p className="text-[10px] text-gray-400">{fmtDate(ride.scheduledAt)}</p>
              <p className="text-[9px] text-gray-400">создан {fmtTime(ride.createdAt)}</p>
            </>
          ) : ride.timeSlot ? (
            <>
              <p className={`text-sm font-bold ${ride.isUrgent ? "text-red-600" : "text-blue-700"}`}>{ride.timeSlot.replace("-", "–")}</p>
              <p className="text-[10px] text-gray-400">{fmtDate(ride.scheduledAt || ride.createdAt)}</p>
              <p className="text-[9px] text-gray-400">создан {fmtTime(ride.createdAt)}</p>
            </>
          ) : ride.isUrgent ? (
            <>
              <p className="text-sm font-bold text-red-600">Срочно</p>
              <p className="text-[10px] text-gray-400">{fmtDate(ride.createdAt)}</p>
              <p className="text-[9px] text-gray-400">создан {fmtTime(ride.createdAt)}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-gray-900">{fmtTime(ride.createdAt)}</p>
              <p className="text-[10px] text-gray-400">{fmtDate(ride.createdAt)}</p>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-1.5">
        <MapPin className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        <span className="font-semibold text-gray-900 text-sm truncate">
          {cityName(ride.fromCity)} → {cityName(ride.toCity)}
        </span>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-600 truncate">
            {ride.riderName || "Клиент"}
            {ride.riderName === "Женщина" ? " ♀" : ride.riderName === "Мужчина" ? " ♂" : ""}
          </span>
          {ride.riderPhone && (
            <span className="text-[11px] text-gray-400 shrink-0">{ride.riderPhone}</span>
          )}
        </div>
        <span className="text-sm font-bold text-gray-900 shrink-0">
          {ride.price ? `${fmtPrice(ride.price)} сум` : "—"}
        </span>
      </div>

      {ride.driverName ? (
        <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
          <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span className="truncate">{ride.driverName} · {ride.driverCar}</span>
        </div>
      ) : null}

      <div className="flex items-center gap-2 mt-2">
        {ride.status === "pending" && !ride.driverName && (
          <button onClick={e => { e.stopPropagation(); onAssign(); }}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg active:bg-emerald-100">
            <UserCheck className="w-3.5 h-3.5" /> Назначить
          </button>
        )}
        {(ride.status === "offered" || ride.status === "accepted") && (
          <button onClick={e => { e.stopPropagation(); onStatusChange("in_progress"); }}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg active:bg-blue-100">
            <Play className="w-3.5 h-3.5" /> В пути
          </button>
        )}
        {ride.status === "in_progress" && (
          <button onClick={e => { e.stopPropagation(); onStatusChange("completed"); }}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg active:bg-emerald-100">
            <CheckCircle className="w-3.5 h-3.5" /> Завершить
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onEdit(); }}
          className="p-2 rounded-lg text-gray-400 hover:text-blue-600 active:bg-blue-50 border border-gray-200">
          <Edit3 className="w-4 h-4" />
        </button>
        <button onClick={e => { e.stopPropagation(); onCancel(); }}
          className="p-2 rounded-lg text-gray-400 hover:text-rose-600 active:bg-rose-50 border border-gray-200">
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function Orders() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const pending = sessionStorage.getItem("pendingCallClient");
    if (pending) {
      setDrawerOpen(true);
    }
    const handler = () => setDrawerOpen(true);
    window.addEventListener("buxtaxi:open-create-drawer", handler);
    return () => window.removeEventListener("buxtaxi:open-create-drawer", handler);
  }, []);

  const [viewMode, setViewMode] = useState<ViewMode>("orders");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [assigningRideId, setAssigningRideId] = useState<number | null>(null);
  const [editingRide, setEditingRide] = useState<any | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [dispatchMap, setDispatchMap] = useState<Record<number, DispatchInfo>>({});
  const [selectedRideId, setSelectedRideId] = useState<number | null>(null);
  const [newRideIds, setNewRideIds] = useState<Set<number>>(new Set());
  const prevIdsRef = useRef<Set<number>>(new Set());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchRef = useRef<(() => void) | null>(null);
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [driverFilter, setDriverFilter] = useState<string>("all");
  const [callingDriverId, setCallingDriverId] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem("buxtaxi:driver-call-ctx");
      if (stored) {
        const ctx = JSON.parse(stored);
        if (Date.now() - ctx.ts < 10000) return ctx.driverId;
        sessionStorage.removeItem("buxtaxi:driver-call-ctx");
      }
    } catch {}
    return null;
  });
  const [callingDriverName, setCallingDriverName] = useState<string>(() => {
    try {
      const stored = sessionStorage.getItem("buxtaxi:driver-call-ctx");
      if (stored) {
        const ctx = JSON.parse(stored);
        if (Date.now() - ctx.ts < 10000) return ctx.driverName || "";
      }
    } catch {}
    return "";
  });
  const callViewAppliedRef = useRef(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.driverId) return;
      const dId = Number(detail.driverId);
      setCallingDriverId(dId);
      setCallingDriverName(detail.driverName || "");
      setActiveFilter("all");
      callViewAppliedRef.current = false;
      refetchRef.current?.();
    };
    window.addEventListener("buxtaxi:driver-calling", handler);
    return () => window.removeEventListener("buxtaxi:driver-calling", handler);
  }, []);

  const ridesDataRef = useRef<any>(null);

  useEffect(() => {
    if (!token) return;
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (!data) return;
      if (data.type === "dispatch_offers_sent" && data.rideId) {
        setDispatchMap(prev => ({
          ...prev,
          [data.rideId]: {
            rideId: data.rideId,
            offeredTo: data.offeredTo || [],
            groupIndex: data.groupIndex || 1,
            totalGroups: data.totalGroups || 1,
            expiresAt: data.expiresAt || "",
          },
        }));
      }
      if (data.type === "dispatch_group_expired" && data.rideId) {
        setDispatchMap(prev => { const copy = { ...prev }; if (!data.nextGroup) delete copy[data.rideId]; return copy; });
      }
      if (data.type === "dispatch_failed" && data.rideId) {
        setDispatchMap(prev => { const copy = { ...prev }; delete copy[data.rideId]; return copy; });
        if (data.reason === "no_eligible_drivers") toast.error(`#${data.rideId}: нет доступных водителей`);
        else if (data.reason === "all_declined") toast.error(`#${data.rideId}: все отклонили`);
      }
      if (data.type === "ride_updated" || data.type === "new_ride") {
        refetchRef.current?.();
      }
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, [token]);

  const { data: ridesData, refetch, isFetching, isLoading, isError } = useGetRides(
    {} as any,
    { request: { headers }, query: { refetchInterval: 5000 } }
  );

  const { data: onlineDriversData } = useGetDrivers({ status: "online" as any }, { request: { headers }, query: { refetchInterval: 10000 } });
  const onlineDrivers = onlineDriversData?.drivers || [];

  refetchRef.current = refetch;
  ridesDataRef.current = ridesData;

  const allRides = useMemo(() => {
    return (ridesData?.rides || []).filter((r: any) => r.status !== "cancelled");
  }, [ridesData]);

  useEffect(() => {
    if (!callingDriverId || callViewAppliedRef.current) return;
    const driverRides = (allRides || []).filter((r: any) => r.driverId === callingDriverId && r.status !== "completed" && r.status !== "cancelled");
    if (driverRides.length === 0) return;
    callViewAppliedRef.current = true;
    try { sessionStorage.removeItem("buxtaxi:driver-call-ctx"); } catch {}
    const driverTrip = driverRides.find((r: any) => isDriverTrip(r));
    const hasPassengers = driverRides.some((r: any) => !isDriverTrip(r));
    if (driverTrip && !hasPassengers) {
      setViewMode("trips");
      setSelectedRideId(driverTrip.id);
    } else if (hasPassengers) {
      setViewMode("orders");
    } else if (driverTrip) {
      setViewMode("trips");
      setSelectedRideId(driverTrip.id);
    }
  }, [callingDriverId, allRides]);

  useEffect(() => {
    if (!allRides.length) return;
    const currentIds = new Set(allRides.map((r: any) => r.id));
    if (prevIdsRef.current.size > 0) {
      const fresh = new Set<number>();
      currentIds.forEach(id => { if (!prevIdsRef.current.has(id)) fresh.add(id); });
      if (fresh.size > 0) {
        setNewRideIds(prev => { const m = new Set(prev); fresh.forEach(id => m.add(id)); return m; });
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => { setNewRideIds(new Set()); highlightTimerRef.current = null; }, 3000);
      }
    }
    prevIdsRef.current = currentIds;
    return () => { if (highlightTimerRef.current) { clearTimeout(highlightTimerRef.current); highlightTimerRef.current = null; } };
  }, [allRides]);

  const activeRides = useMemo(() => allRides.filter((r: any) => r.status !== "completed" && r.status !== "cancelled"), [allRides]);

  const viewFilteredRides = useMemo(() => {
    if (viewMode === "trips") return activeRides.filter(isDriverTrip);
    if (viewMode === "marketplace") return activeRides.filter(isMarketplace);
    return activeRides.filter(isDispatcherOrder);
  }, [activeRides, viewMode]);

  const viewModeCounts = useMemo(() => ({
    orders: activeRides.filter(isDispatcherOrder).length,
    marketplace: activeRides.filter(isMarketplace).length,
    trips: activeRides.filter(isDriverTrip).length,
  }), [activeRides]);

  const counts = useMemo(() => {
    return {
      all: viewFilteredRides.length,
      pending: viewFilteredRides.filter((r: any) => r.status === "pending").length,
      // "В пути" = только реально едущие (in_progress). Принятые/в рейсе (accepted,
      // merged) — водитель ещё не везёт клиента, поэтому они идут в «Ожидают».
      in_progress: viewFilteredRides.filter((r: any) => r.status === "in_progress").length,
      waiting: viewFilteredRides.filter((r: any) => (["pending", "offered", "accepted", "merged"].includes(r.status)) && !isStuck(r)).length,
      urgent: viewFilteredRides.filter((r: any) => isStuck(r)).length,
    };
  }, [viewFilteredRides]);

  const rides = useMemo(() => {
    let list = callingDriverId
      ? activeRides.filter((r: any) => r.driverId === callingDriverId)
      : viewFilteredRides;
    if (activeFilter === "pending") list = list.filter((r: any) => r.status === "pending");
    else if (activeFilter === "in_progress") list = list.filter((r: any) => r.status === "in_progress");
    else if (activeFilter === "waiting") list = list.filter((r: any) => (["pending", "offered", "accepted", "merged"].includes(r.status)) && !isStuck(r));
    else if (activeFilter === "urgent") list = list.filter(isStuck);
    if (!callingDriverId) {
      if (cityFilter !== "all") {
        list = list.filter((r: any) => r.fromCity === cityFilter || r.toCity === cityFilter);
      }
      if (driverFilter === "none") {
        list = list.filter((r: any) => !r.driverName);
      } else if (driverFilter !== "all") {
        list = list.filter((r: any) => r.driverName === driverFilter);
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        list = list.filter((r: any) =>
          r.riderName?.toLowerCase().includes(q) ||
          r.riderPhone?.toLowerCase().includes(q) ||
          r.fromCity?.toLowerCase().includes(q) ||
          r.toCity?.toLowerCase().includes(q) ||
          r.driverName?.toLowerCase().includes(q) ||
          String(r.id).includes(q)
        );
      }
    }
    return [...list].sort((a: any, b: any) => ridePriority(a) - ridePriority(b));
  }, [viewFilteredRides, activeRides, search, activeFilter, cityFilter, driverFilter, callingDriverId]);

  const selectedRide = useMemo(() => rides.find((r: any) => r.id === selectedRideId) || null, [rides, selectedRideId]);

  const uniqueCities = useMemo(() => {
    const cities = new Set<string>();
    allRides.forEach((r: any) => { if (r.fromCity) cities.add(r.fromCity); if (r.toCity) cities.add(r.toCity); });
    return Array.from(cities).sort();
  }, [allRides]);

  const uniqueDrivers = useMemo(() => {
    const names = new Set<string>();
    allRides.forEach((r: any) => { if (r.driverName) names.add(r.driverName); });
    return Array.from(names).sort();
  }, [allRides]);

  const [cancellingRideId, setCancellingRideId] = useState<number | null>(null);

  const cancelRide = useCallback((rideId: number) => {
    setCancellingRideId(rideId);
  }, []);

  const performCancel = useCallback(async (rideId: number, reason: string) => {
    setUpdatingId(rideId);
    try {
      const res = await fetch(`${BASE_URL}api/rides/${rideId}/cancel`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({ message: "Ошибка" })); toast.error(b.message || "Ошибка отмены"); return; }
      toast.success("Заказ отменён");
      setCancellingRideId(null);
      refetch();
    } catch { toast.error("Ошибка сети"); } finally { setUpdatingId(null); }
  }, [headers, refetch]);

  const unassignDriver = useCallback(async (rideId: number) => {
    if (!window.confirm("Снять водителя и вернуть заказ в эфир?")) return;
    setUpdatingId(rideId);
    try {
      const res = await fetch(`${BASE_URL}api/rides/${rideId}/unassign-driver`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      });
      if (!res.ok) { const b = await res.json().catch(() => ({ message: "Ошибка" })); toast.error(b.message || "Не удалось снять водителя"); return; }
      toast.success("Водитель снят, заказ снова в эфире");
      refetch();
    } catch { toast.error("Ошибка сети"); } finally { setUpdatingId(null); }
  }, [headers, refetch]);

  const handleStatusChange = async (rideId: number, newStatus: string) => {
    setUpdatingId(rideId);
    try {
      const resp = await fetch(`${BASE_URL}api/dispatcher/rides/${rideId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!resp.ok) { const b = await resp.json().catch(() => ({} as any)); toast.error(b.message || "Ошибка"); return; }
      toast.success("Статус обновлён");
      refetch();
    } catch { toast.error("Ошибка"); } finally { setUpdatingId(null); }
  };

  const inlineSaveDriver = async (rideId: number, driverId: number) => {
    try {
      const resp = await fetch(`${BASE_URL}api/dispatcher/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ rideId, driverId }),
      });
      if (!resp.ok) { const b = await resp.json().catch(() => ({} as any)); toast.error(b.message || "Ошибка"); return; }
      toast.success("Отправлено водителю");
      refetch();
    } catch { toast.error("Ошибка"); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Insert") { e.preventDefault(); setDrawerOpen(true); return; }
      if (e.key === "Escape") { e.preventDefault(); setDrawerOpen(false); setSelectedRideId(null); return; }
      if (!selectedRideId) return;
      const ride = rides.find((r: any) => r.id === selectedRideId);
      if (!ride) return;
      if (e.key === "ArrowDown") { e.preventDefault(); const idx = rides.findIndex((r: any) => r.id === selectedRideId); if (idx < rides.length - 1) setSelectedRideId(rides[idx + 1].id); }
      else if (e.key === "ArrowUp") { e.preventDefault(); const idx = rides.findIndex((r: any) => r.id === selectedRideId); if (idx > 0) setSelectedRideId(rides[idx - 1].id); }
      else if (e.key === "Enter") { e.preventDefault(); setEditingRide(ride); }
      else if (e.key === "a" || e.key === "A" || e.key === "ф" || e.key === "Ф") {
        e.preventDefault();
        if (ride.status === "pending") setAssigningRideId(ride.id);
        else if (ride.status === "offered" || ride.status === "accepted") handleStatusChange(ride.id, "in_progress");
        else if (ride.status === "in_progress") handleStatusChange(ride.id, "completed");
      }
      else if (e.key === "c" || e.key === "C" || e.key === "с" || e.key === "С") {
        e.preventDefault();
        cancelRide(ride.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRideId, rides]);

  const filterTabs = [
    { key: "all",         label: "Все",         count: counts.all,         active: "bg-gray-800 text-white" },
    { key: "pending",     label: "Новые",       count: counts.pending,     active: "bg-amber-500 text-white" },
    { key: "in_progress", label: "В пути",      count: counts.in_progress, active: "bg-blue-500 text-white" },
    { key: "waiting",     label: "Ожидают",     count: counts.waiting,     active: "bg-orange-500 text-white" },
    { key: "urgent",      label: "Срочные",     count: counts.urgent,      active: "bg-rose-500 text-white" },
  ];

  return (
    <DispatcherLayout>
      {assigningRideId !== null && (
        <AssignModal rideId={assigningRideId} headers={headers}
          onClose={() => setAssigningRideId(null)} onAssigned={() => refetch()} />
      )}
      {editingRide !== null && (
        <EditModal ride={editingRide} headers={headers}
          onClose={() => setEditingRide(null)} onSaved={() => refetch()} />
      )}
      {cancellingRideId !== null && (
        <CancelReasonModal
          rideId={cancellingRideId}
          onClose={() => setCancellingRideId(null)}
          onConfirm={(reason) => performCancel(cancellingRideId, reason)}
          loading={updatingId === cancellingRideId}
        />
      )}

      <div className="flex flex-col h-full relative">
        <div className="bg-white border-b border-gray-200 px-3 md:px-4 py-2 space-y-2">
          <div className="flex items-center gap-1 border-b border-gray-100 pb-2">
            {([
              { key: "orders" as ViewMode, label: "Заказы", icon: ClipboardList, color: "emerald" },
              { key: "marketplace" as ViewMode, label: "Маркетплейс", icon: ShoppingBag, color: "violet" },
              { key: "trips" as ViewMode, label: "Рейсы", icon: Route, color: "blue" },
            ]).map(tab => {
              const active = viewMode === tab.key;
              const count = viewModeCounts[tab.key];
              return (
                <button key={tab.key} onClick={() => { setViewMode(tab.key); setActiveFilter("all"); }}
                  className={`flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${
                    active
                      ? tab.color === "emerald" ? "bg-emerald-500 text-white shadow-sm" : tab.color === "violet" ? "bg-violet-500 text-white shadow-sm" : "bg-blue-500 text-white shadow-sm"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}>
                  <tab.icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {count > 0 && (
                    <span className={`text-xs font-extrabold px-1.5 py-0.5 rounded-full ${
                      active ? "bg-white/20" : "bg-gray-200 text-gray-600"
                    }`}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 md:gap-4 overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-1 shrink-0">
              {filterTabs.map(tab => (
                <button key={tab.key} onClick={() => setActiveFilter(activeFilter === tab.key ? "all" : tab.key)}
                  className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap ${
                    activeFilter === tab.key
                      ? tab.active
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>
                  <span className="text-sm font-extrabold">{tab.count}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label.slice(0, 3)}</span>
                </button>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-2 ml-auto shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Поиск..."
                  className="bg-gray-50 border border-gray-200 pl-9 pr-8 py-2 text-sm rounded-lg focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 w-44" />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <select value={cityFilter} onChange={e => setCityFilter(e.target.value)}
                className="bg-gray-50 border border-gray-200 px-3 py-2 text-sm font-medium rounded-lg focus:outline-none focus:border-emerald-500 min-w-[120px]">
                <option value="all">Все города</option>
                {uniqueCities.map(c => <option key={c} value={c}>{cityName(c)}</option>)}
              </select>
              <select value={driverFilter} onChange={e => setDriverFilter(e.target.value)}
                className="bg-gray-50 border border-gray-200 px-3 py-2 text-sm font-medium rounded-lg focus:outline-none focus:border-emerald-500 min-w-[120px]">
                <option value="all">Все водители</option>
                <option value="none">Без водителя</option>
                {uniqueDrivers.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <button onClick={() => refetch()} className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 border border-gray-200">
                <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin text-emerald-500" : "text-gray-500"}`} />
              </button>
            </div>

            <div className="flex md:hidden items-center gap-1.5 ml-auto shrink-0">
              <button onClick={() => setSearchOpen(!searchOpen)}
                className="p-2 rounded-lg bg-gray-100 active:bg-gray-200 border border-gray-200">
                <Search className="w-4 h-4 text-gray-500" />
              </button>
              <button onClick={() => refetch()}
                className="p-2 rounded-lg bg-gray-100 active:bg-gray-200 border border-gray-200">
                <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin text-emerald-500" : "text-gray-500"}`} />
              </button>
            </div>
          </div>

          {searchOpen && (
            <div className="md:hidden mt-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Поиск по имени, телефону, городу..."
                  autoFocus
                  className="w-full bg-gray-50 border border-gray-200 pl-9 pr-8 py-2.5 text-sm rounded-lg focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20" />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button onClick={() => { setSearchOpen(false); setSearch(""); }}
                className="px-3 py-2 text-sm font-medium text-gray-600 active:bg-gray-100 rounded-lg">
                Отмена
              </button>
            </div>
          )}
        </div>

        {callingDriverId && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between animate-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-amber-600 animate-pulse" />
              <span className="text-sm font-bold text-amber-800">
                Звонок: {callingDriverName || `Водитель #${callingDriverId}`}
              </span>
              <span className="text-xs text-amber-600">— показаны только его заказы и рейсы</span>
            </div>
            <button onClick={() => { setCallingDriverId(null); setCallingDriverName(""); }}
              className="px-3 py-1 text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg border border-amber-300 transition-colors">
              Показать все
            </button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {isLoading ? (
              <div className="flex-1 overflow-auto"><TableSkeleton rows={10} cols={7} /></div>
            ) : isError ? (
              <div className="flex-1 overflow-auto"><ErrorState message="Не удалось загрузить заказы" onRetry={() => refetch()} /></div>
            ) : rides.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 px-4">
                {viewMode === "trips" ? (
                  <>
                    <Route className="w-12 h-12 text-gray-300 mb-3" />
                    <p className="text-sm font-medium">Рейсов нет</p>
                    <p className="text-xs text-gray-400 mt-1">Водители ещё не создали рейсы</p>
                  </>
                ) : viewMode === "marketplace" ? (
                  <>
                    <ShoppingBag className="w-12 h-12 text-gray-300 mb-3" />
                    <p className="text-sm font-medium">Маркетплейс пуст</p>
                    <p className="text-xs text-gray-400 mt-1">Нет заказов из маркетплейса</p>
                  </>
                ) : (
                  <>
                    <Car className="w-12 h-12 text-gray-300 mb-3" />
                    <p className="text-sm font-medium">Заказов не найдено</p>
                    {viewModeCounts.trips > 0 && (
                      <p className="text-xs text-gray-500 mt-1">Есть {viewModeCounts.trips} активных рейсов водителей — откройте вкладку «Рейсы»</p>
                    )}
                    <div className="flex gap-2 mt-3">
                      {viewModeCounts.trips > 0 && (
                        <button onClick={() => { setViewMode("trips"); setActiveFilter("all"); }}
                          className="bg-blue-500 text-white px-5 py-2.5 md:px-4 md:py-1.5 rounded-lg text-sm font-medium hover:bg-blue-600">
                          Открыть Рейсы ({viewModeCounts.trips})
                        </button>
                      )}
                      <button onClick={() => setDrawerOpen(true)}
                        className="bg-emerald-500 text-white px-5 py-2.5 md:px-4 md:py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-600 active:bg-emerald-700">
                        + Новый заказ
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="hidden md:flex bg-gray-50 border-b border-gray-200 items-center text-xs font-bold text-gray-500 uppercase tracking-wider select-none px-3">
                  <div className="w-[90px] py-2.5">ВРЕМЯ</div>
                  <div className="w-[100px] py-2.5">СТАТУС</div>
                  <div className="flex-1 py-2.5 min-w-0">МАРШРУТ</div>
                  <div className="w-[200px] py-2.5">КЛИЕНТ</div>
                  <div className="w-[180px] py-2.5">ВОДИТЕЛЬ</div>
                  <div className="w-[120px] text-right py-2.5 pr-2">ЦЕНА</div>
                  <div className="w-[200px] text-center py-2.5">ДЕЙСТВИЯ</div>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain">
                  <div className="md:hidden">
                    {rides.map((ride: any) => (
                      <MobileOrderCard
                        key={ride.id}
                        ride={ride}
                        dispatchMap={dispatchMap}
                        onSelect={() => setSelectedRideId(ride.id)}
                        onAssign={() => setAssigningRideId(ride.id)}
                        onStatusChange={(s) => handleStatusChange(ride.id, s)}
                        onEdit={() => setEditingRide(ride)}
                        onCancel={() => cancelRide(ride.id)}
                        onInlineAssign={(dId) => inlineSaveDriver(ride.id, dId)}
                        onlineDrivers={onlineDrivers}
                      />
                    ))}
                  </div>

                  <div className="hidden md:block">
                    {rides.map((ride: any, idx: number) => {
                      const st = STATUS_MAP[ride.status] || STATUS_MAP.pending;
                      const stuck = isStuck(ride);
                      const isSelected = selectedRideId === ride.id;
                      const isNew = newRideIds.has(ride.id);
                      const wMin = waitingMin(ride);

                      return (
                        <div
                          key={ride.id}
                          onClick={() => setSelectedRideId(isSelected ? null : ride.id)}
                          className={`flex items-center border-b border-gray-200 cursor-pointer transition-colors text-sm px-3 group ${
                            isSelected
                              ? "bg-emerald-50 border-l-[3px] border-l-emerald-500"
                              : stuck
                                ? "bg-rose-50/50 border-l-[3px] border-l-rose-400 hover:bg-rose-50"
                                : isNew
                                  ? "bg-blue-50/50 border-l-[3px] border-l-blue-400"
                                  : idx % 2 === 0
                                    ? "border-l-[3px] border-l-transparent hover:bg-gray-50 bg-white"
                                    : "border-l-[3px] border-l-transparent hover:bg-gray-50 bg-gray-50/40"
                          }`}
                        >
                          <div className="w-[90px] py-3.5 shrink-0">
                            {viewMode === "trips" && ride.scheduledAt ? (
                              <>
                                <p className="text-sm font-extrabold text-blue-700 leading-tight">{fmtTime(ride.scheduledAt)}</p>
                                <p className="text-xs text-gray-400">{fmtDate(ride.scheduledAt)}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">создан {fmtTime(ride.createdAt)}</p>
                              </>
                            ) : ride.timeSlot ? (
                              <>
                                <p className={`text-sm font-extrabold leading-tight ${ride.isUrgent ? "text-red-600" : "text-blue-700"}`}>{ride.timeSlot.replace("-", "–")}</p>
                                <p className="text-xs text-gray-400">{fmtDate(ride.scheduledAt || ride.createdAt)}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">создан {fmtTime(ride.createdAt)}</p>
                              </>
                            ) : ride.isUrgent ? (
                              <>
                                <p className="text-sm font-extrabold text-red-600 leading-tight">Срочно</p>
                                <p className="text-xs text-gray-400">{fmtDate(ride.createdAt)}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">создан {fmtTime(ride.createdAt)}</p>
                              </>
                            ) : (
                              <>
                                <p className="text-sm font-extrabold text-gray-900 leading-tight">{fmtTime(ride.createdAt)}</p>
                                <p className="text-xs text-gray-400">{fmtDate(ride.createdAt)}</p>
                              </>
                            )}
                          </div>

                          <div className="w-[100px] py-3.5 shrink-0">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${st.bg} ${st.color}`}>
                              {st.label}
                            </span>
                            {stuck && (
                              <div className="flex items-center gap-0.5 mt-1 text-rose-600">
                                <Zap className="w-3.5 h-3.5 animate-pulse" />
                                <span className="text-xs font-bold">{wMin}м</span>
                              </div>
                            )}
                          </div>

                          <div className="flex-1 py-3.5 min-w-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
                              <span className="font-bold text-gray-900 text-sm truncate">
                                {cityName(ride.fromCity)} → {cityName(ride.toCity)}
                              </span>
                              {dispatchMap[ride.id] && (
                                <span className="shrink-0 ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-600 flex items-center gap-0.5">
                                  <Radio className="w-3 h-3 animate-pulse" />{dispatchMap[ride.id].offeredTo.length}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate mt-0.5">
                              {ride.fromAddress || ""}{ride.fromAddress && ride.toAddress ? " → " : ""}{ride.toAddress || ""}
                              {ride.distance ? ` · ${ride.distance} км` : ""}
                            </p>
                          </div>

                          <div className="w-[200px] py-3.5 shrink-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-gray-800 text-sm truncate">
                                {ride.riderName || "Клиент"}
                                {ride.riderName === "Женщина" ? " ♀" : ride.riderName === "Мужчина" ? " ♂" : ""}
                              </span>
                            </div>
                            {ride.riderPhone && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <Phone className="w-3.5 h-3.5 text-gray-400" />
                                <span className="text-xs text-gray-500">{ride.riderPhone}</span>
                              </div>
                            )}
                            <p className="text-xs text-gray-400 mt-0.5">{ride.passengers} пас. · {TARIFF_LABEL[ride.carClass] || "economy"}</p>
                          </div>

                          <div className="w-[180px] py-3.5 shrink-0 pr-2">
                            {ride.driverName ? (
                              <div>
                                <p className="font-semibold text-gray-800 text-sm truncate">{ride.driverName}</p>
                                <p className="text-xs text-gray-400 truncate">{ride.driverCar}</p>
                              </div>
                            ) : (
                              <button
                                onClick={e => { e.stopPropagation(); setAssigningRideId(ride.id); }}
                                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
                              >
                                <UserCheck className="w-4 h-4" /> Назначить
                              </button>
                            )}
                          </div>

                          <div className="w-[120px] text-right py-3.5 shrink-0 pr-2">
                            <p className="text-sm font-extrabold text-gray-900 whitespace-nowrap tabular-nums">
                              {ride.price ? `${fmtPrice(ride.price)}` : "—"}
                            </p>
                            <p className="text-xs text-gray-400">сум</p>
                          </div>

                          <div className="w-[200px] py-3.5 shrink-0 flex items-center justify-end gap-1.5 pr-2">
                            {ride.status === "pending" && !ride.driverName && (
                              <select
                                defaultValue=""
                                onClick={e => e.stopPropagation()}
                                onChange={e => { if (e.target.value) inlineSaveDriver(ride.id, Number(e.target.value)); e.target.value = ""; }}
                                className="w-full text-xs font-semibold border border-gray-200 rounded-lg px-2.5 py-2 bg-white text-gray-600 focus:outline-none focus:border-emerald-500 cursor-pointer"
                              >
                                <option value="">Быстро →</option>
                                {onlineDrivers.map((d: any) => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>
                            )}
                            {(ride.status === "offered" || ride.status === "accepted") && (
                              <button onClick={e => { e.stopPropagation(); handleStatusChange(ride.id, "in_progress"); }}
                                className="px-2.5 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap shrink-0">
                                В пути
                              </button>
                            )}
                            {ride.status === "in_progress" && (
                              <button onClick={e => { e.stopPropagation(); handleStatusChange(ride.id, "completed"); }}
                                className="px-2.5 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 whitespace-nowrap shrink-0">
                                Завершить
                              </button>
                            )}
                            {(ride.status === "offered" || ride.status === "accepted" || ride.status === "merged") && ride.driverId && (
                              <button onClick={e => { e.stopPropagation(); unassignDriver(ride.id); }}
                                className="p-1.5 rounded-lg shrink-0 text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                title="Снять водителя — вернуть заказ в эфир">
                                <RotateCcw className="w-4.5 h-4.5" />
                              </button>
                            )}
                            <button onClick={e => { e.stopPropagation(); setEditingRide(ride); }}
                              className="p-1.5 rounded-lg shrink-0 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="Редактировать">
                              <Edit3 className="w-4.5 h-4.5" />
                            </button>
                            <button onClick={e => { e.stopPropagation(); cancelRide(ride.id); }}
                              className="p-1.5 rounded-lg shrink-0 text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              title="Отменить">
                              <XCircle className="w-4.5 h-4.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {selectedRide && (
            <>
              <div className="hidden md:block w-[360px] shrink-0 border-l border-gray-200 overflow-hidden">
                <DetailPanel
                  ride={selectedRide}
                  dispatchInfo={dispatchMap[selectedRide.id]}
                  onAssign={() => setAssigningRideId(selectedRide.id)}
                  onStatusChange={(s) => handleStatusChange(selectedRide.id, s)}
                  onEdit={() => setEditingRide(selectedRide)}
                  onCancel={() => cancelRide(selectedRide.id)}
                  onClose={() => setSelectedRideId(null)}
                  updating={updatingId === selectedRide.id}
                />
              </div>
              <div className="md:hidden">
                <DetailPanel
                  ride={selectedRide}
                  dispatchInfo={dispatchMap[selectedRide.id]}
                  onAssign={() => setAssigningRideId(selectedRide.id)}
                  onStatusChange={(s) => handleStatusChange(selectedRide.id, s)}
                  onEdit={() => setEditingRide(selectedRide)}
                  onCancel={() => cancelRide(selectedRide.id)}
                  onClose={() => setSelectedRideId(null)}
                  updating={updatingId === selectedRide.id}
                  isMobile
                />
              </div>
            </>
          )}
        </div>

        <div className="hidden md:flex bg-white border-t border-gray-200 px-4 py-2 items-center justify-between text-sm text-gray-500 shrink-0">
          <span className="flex items-center gap-2 font-medium">
            Показано {rides.length} из {viewFilteredRides.length} {viewMode === "trips" ? "рейсов" : "заказов"}
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
              <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span></span>
              Live
            </span>
          </span>
          <span className="text-gray-400">↑↓ — навигация &nbsp; Enter — изменить &nbsp; A — действие &nbsp; C — отмена &nbsp; Esc — закрыть</span>
        </div>

        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Новый заказ"
          className="md:hidden fixed bottom-6 right-5 w-14 h-14 bg-emerald-500 text-white rounded-full shadow-lg shadow-emerald-500/30 flex items-center justify-center active:bg-emerald-600 active:scale-95 transition-transform z-30"
        >
          <Plus className="w-7 h-7" />
        </button>
      </div>
      <CreateOrderDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} onCreated={() => refetch()} />

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.25s ease-out;
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </DispatcherLayout>
  );
}

const CANCEL_REASONS = [
  "Клиент передумал",
  "Клиент не отвечает",
  "Нет водителя на маршрут",
  "Дубликат заказа",
  "Ошибка оператора",
  "Клиент уехал другим транспортом",
  "Не нашли клиента на месте",
];

function CancelReasonModal({ rideId, onClose, onConfirm, loading }: { rideId: number; onClose: () => void; onConfirm: (reason: string) => void; loading: boolean }) {
  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState<string>("");
  const reason = selected === "__custom__" ? custom.trim() : selected;
  const canSubmit = reason.length > 0 && !loading;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-gray-900">Отмена заказа №{rideId}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Выберите причину отмены</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => { setSelected(r); setCustom(""); }}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                selected === r
                  ? "bg-rose-50 border-rose-400 text-rose-700"
                  : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
              }`}
            >
              {r}
            </button>
          ))}
          <button
            onClick={() => setSelected("__custom__")}
            className={`w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
              selected === "__custom__"
                ? "bg-rose-50 border-rose-400 text-rose-700"
                : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
            }`}
          >
            Другая причина...
          </button>
          {selected === "__custom__" && (
            <textarea
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Опишите причину отмены"
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-gray-200 focus:border-rose-400 focus:outline-none text-sm resize-none"
            />
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40">
            Закрыть
          </button>
          <button onClick={() => canSubmit && onConfirm(reason)} disabled={!canSubmit}
            className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Отменяем..." : "Отменить заказ"}
          </button>
        </div>
      </div>
    </div>
  );
}

