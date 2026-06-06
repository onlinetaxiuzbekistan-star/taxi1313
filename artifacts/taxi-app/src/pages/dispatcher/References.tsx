import { useState, useEffect, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import {
  Plus, Pencil, Trash2, X, Save, MapPin, Clock, ArrowRight, ArrowUp, ArrowDown,
  ToggleLeft, ToggleRight, Loader2, AlertCircle, DollarSign, WifiOff,
  Settings2, ChevronRight
} from "lucide-react";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

interface RouteOptionItem {
  id: number;
  routeId: number;
  tariffClass: string;
  optionKey: string;
  label: string;
  price: number;
  isActive: boolean;
  sortOrder: number;
}

interface TariffOptionsMap {
  economy: RouteOptionItem[];
  comfort: RouteOptionItem[];
  business: RouteOptionItem[];
}

interface Route {
  id: number;
  fromCity: string;
  toCity: string;
  distanceKm: number;
  durationMin: number;
  priceEconomy: number;
  priceComfort: number;
  priceBusiness: number;
  priceMail: number;
  priceFrontEconomy: number;
  priceFrontComfort: number;
  priceFrontBusiness: number;
  roundTripDiscountPercent: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  options: RouteOptionItem[];
  tariffOptions: TariffOptionsMap;
}

interface RouteForm {
  fromCity: string;
  toCity: string;
  distanceKm: string;
  durationMin: string;
  priceEconomy: string;
  priceComfort: string;
  priceBusiness: string;
  priceMail: string;
  priceFrontEconomy: string;
  priceFrontComfort: string;
  priceFrontBusiness: string;
  roundTripDiscountPercent: string;
  sortOrder: string;
  isActive: boolean;
  tariffOptions: Record<string, { id: number; optionKey: string; label: string; price: string; isActive: boolean }[]>;
}

const emptyForm: RouteForm = {
  fromCity: "", toCity: "", distanceKm: "", durationMin: "",
  priceEconomy: "", priceComfort: "", priceBusiness: "", priceMail: "",
  priceFrontEconomy: "", priceFrontComfort: "", priceFrontBusiness: "",
  roundTripDiscountPercent: "10", sortOrder: "0", isActive: true,
  tariffOptions: { economy: [], comfort: [], business: [] },
};

const TARIFF_LABELS: Record<string, string> = { economy: "Эконом", comfort: "Комфорт", business: "Бизнес" };
const TARIFF_COLORS: Record<string, string> = {
  economy: "emerald",
  comfort: "blue",
  business: "amber",
};

function TariffConfigModal({ tariffClass, form, setForm, onClose, priceBackKey, priceFrontKey }: {
  tariffClass: string;
  form: RouteForm;
  setForm: React.Dispatch<React.SetStateAction<RouteForm>>;
  onClose: () => void;
  priceBackKey: keyof RouteForm;
  priceFrontKey: keyof RouteForm;
}) {
  const opts = form.tariffOptions[tariffClass] || [];
  const color = TARIFF_COLORS[tariffClass] || "emerald";

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between p-5 border-b border-border`}>
          <div className="flex items-center gap-2">
            <Settings2 className={`w-5 h-5 text-${color}-500`} />
            <h3 className="font-bold text-foreground text-lg">
              {TARIFF_LABELS[tariffClass]}
            </h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Цена за место (сум)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Переднее сиденье</label>
                <input type="number" value={form[priceFrontKey] as string}
                  onChange={e => setForm(f => ({ ...f, [priceFrontKey]: e.target.value }))}
                  placeholder="150000"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Заднее сиденье</label>
                <input type="number" value={form[priceBackKey] as string}
                  onChange={e => setForm(f => ({ ...f, [priceBackKey]: e.target.value }))}
                  placeholder="120000"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
            </div>
          </div>

          {opts.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Дополнительные услуги</p>
              <div className="space-y-2">
                {opts.map((opt, i) => (
                  <div key={opt.optionKey} className="flex items-center gap-2 py-1">
                    <button type="button" onClick={() => setForm(f => ({
                      ...f,
                      tariffOptions: {
                        ...f.tariffOptions,
                        [tariffClass]: (f.tariffOptions[tariffClass] || []).map((o, j) =>
                          j === i ? { ...o, isActive: !o.isActive } : o
                        ),
                      },
                    }))} className="shrink-0">
                      {opt.isActive
                        ? <ToggleRight className="w-6 h-6 text-emerald-500" />
                        : <ToggleLeft className="w-6 h-6 text-muted-foreground" />}
                    </button>
                    <span className={`text-sm flex-1 truncate ${opt.isActive ? "text-foreground" : "text-muted-foreground"}`}>{opt.label}</span>
                    <div className="flex items-center gap-1">
                      <input type="number" value={opt.price}
                        onChange={e => setForm(f => ({
                          ...f,
                          tariffOptions: {
                            ...f.tariffOptions,
                            [tariffClass]: (f.tariffOptions[tariffClass] || []).map((o, j) =>
                              j === i ? { ...o, price: e.target.value } : o
                            ),
                          },
                        }))}
                        className="w-24 border border-border rounded-lg px-2 py-1.5 text-sm text-right outline-none focus:border-emerald-500" />
                      <span className="text-xs text-muted-foreground">сум</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border">
          <button onClick={onClose}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium active:scale-[0.97] transition-all">
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

function RouteModal({ route, onClose, onSaved, token }: {
  route: Route | null;
  onClose: () => void;
  onSaved: () => void;
  token: string | null;
}) {
  const isEdit = !!route;
  const [form, setForm] = useState<RouteForm>(
    route
      ? {
          fromCity: route.fromCity,
          toCity: route.toCity,
          distanceKm: String(route.distanceKm),
          durationMin: String(route.durationMin),
          priceEconomy: String(route.priceEconomy),
          priceComfort: String(route.priceComfort),
          priceBusiness: String(route.priceBusiness),
          priceMail: String(route.priceMail ?? 0),
          priceFrontEconomy: String(route.priceFrontEconomy),
          priceFrontComfort: String(route.priceFrontComfort),
          priceFrontBusiness: String(route.priceFrontBusiness),
          roundTripDiscountPercent: String(route.roundTripDiscountPercent ?? 10),
          sortOrder: String(route.sortOrder ?? 0),
          isActive: route.isActive,
          tariffOptions: {
            economy: (route.tariffOptions?.economy || []).map(o => ({
              id: o.id, optionKey: o.optionKey, label: o.label,
              price: String(o.price), isActive: o.isActive,
            })),
            comfort: (route.tariffOptions?.comfort || []).map(o => ({
              id: o.id, optionKey: o.optionKey, label: o.label,
              price: String(o.price), isActive: o.isActive,
            })),
            business: (route.tariffOptions?.business || []).map(o => ({
              id: o.id, optionKey: o.optionKey, label: o.label,
              price: String(o.price), isActive: o.isActive,
            })),
          },
        }
      : { ...emptyForm }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTariffConfig, setActiveTariffConfig] = useState<string | null>(null);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const set = (k: keyof RouteForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.fromCity.trim() || !form.toCity.trim()) {
      setError("Укажите оба города");
      return;
    }
    if (!form.distanceKm || parseFloat(form.distanceKm) <= 0) {
      setError("Укажите расстояние");
      return;
    }
    if (!form.durationMin || parseInt(form.durationMin) <= 0) {
      setError("Укажите время в пути");
      return;
    }

    setSaving(true);
    try {
      const url = isEdit
        ? `${BASE_URL}/api/routes/${route!.id}`
        : `${BASE_URL}/api/routes`;
      const method = isEdit ? "PATCH" : "POST";

      const tariffOptionsPayload: Record<string, any[]> = {};
      for (const [tc, opts] of Object.entries(form.tariffOptions)) {
        tariffOptionsPayload[tc] = opts.map(o => ({
          id: o.id, label: o.label, price: o.price, isActive: o.isActive,
        }));
      }

      const res = await fetch(url, {
        method, headers,
        body: JSON.stringify({
          fromCity: form.fromCity.trim(),
          toCity: form.toCity.trim(),
          distanceKm: form.distanceKm,
          durationMin: form.durationMin,
          priceEconomy: form.priceEconomy || "0",
          priceComfort: form.priceComfort || "0",
          priceBusiness: form.priceBusiness || "0",
          priceMail: form.priceMail || "0",
          priceFrontEconomy: form.priceFrontEconomy || form.priceEconomy || "0",
          priceFrontComfort: form.priceFrontComfort || form.priceComfort || "0",
          priceFrontBusiness: form.priceFrontBusiness || form.priceBusiness || "0",
          roundTripDiscountPercent: form.roundTripDiscountPercent || "10",
          sortOrder: form.sortOrder || "0",
          isActive: form.isActive,
          tariffOptions: tariffOptionsPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Ошибка сохранения");
        setSaving(false);
        return;
      }

      onSaved();
      onClose();
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  };

  const tariffConfigs: { key: string; label: string; priceBackKey: keyof RouteForm; priceFrontKey: keyof RouteForm; color: string; icon: string }[] = [
    { key: "economy", label: "Эконом", priceBackKey: "priceEconomy", priceFrontKey: "priceFrontEconomy", color: "emerald", icon: "🟢" },
    { key: "comfort", label: "Комфорт", priceBackKey: "priceComfort", priceFrontKey: "priceFrontComfort", color: "blue", icon: "🔵" },
    { key: "business", label: "Бизнес", priceBackKey: "priceBusiness", priceFrontKey: "priceFrontBusiness", color: "amber", icon: "🟡" },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-border">
            <h3 className="font-bold text-foreground text-lg">
              {isEdit ? "Редактировать направление" : "Новое направление"}
            </h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all">
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Откуда *</label>
                <input value={form.fromCity} onChange={set("fromCity")} required placeholder="Бухара"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Куда *</label>
                <input value={form.toCity} onChange={set("toCity")} required placeholder="Ташкент"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Расстояние (км) *</label>
                <input type="number" value={form.distanceKm} onChange={set("distanceKm")} required placeholder="580"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Время в пути (мин) *</label>
                <input type="number" value={form.durationMin} onChange={set("durationMin")} required placeholder="420"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Тарифы</p>
              <div className="space-y-2">
                {tariffConfigs.map(tc => {
                  const backPrice = parseFloat(form[tc.priceBackKey] as string) || 0;
                  const frontPrice = parseFloat(form[tc.priceFrontKey] as string) || 0;
                  const opts = form.tariffOptions[tc.key] || [];
                  const activeOpts = opts.filter(o => o.isActive).length;
                  const totalOpts = opts.length;

                  return (
                    <button
                      key={tc.key}
                      type="button"
                      onClick={() => setActiveTariffConfig(tc.key)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all text-left group"
                    >
                      <span className="text-lg">{tc.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{tc.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {backPrice > 0 || frontPrice > 0
                            ? `Зад: ${fmt(backPrice)} · Перед: ${fmt(frontPrice)} сум`
                            : "Цены не настроены"}
                          {totalOpts > 0 && ` · ${activeOpts}/${totalOpts} услуг`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground group-hover:text-emerald-500 transition-colors">
                        <Settings2 className="w-4 h-4" />
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Скидка туда-обратно %</label>
                <input type="number" value={form.priceMail} onChange={set("priceMail")} placeholder="30000"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 outline-none focus:border-emerald-500 bg-background mb-2" />
              <p className="text-[10px] font-medium text-muted-foreground -mt-1 mb-2">Цена за почту/багаж (без пассажира)</p>
              <input type="number" value={form.roundTripDiscountPercent} onChange={set("roundTripDiscountPercent")} placeholder="10"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">Сортировка</label>
                <input type="number" value={form.sortOrder} onChange={set("sortOrder")} placeholder="0"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
                <p className="text-[10px] text-muted-foreground mt-0.5">Меньше = выше</p>
              </div>
              <div className="flex items-center gap-3 pt-5">
                <button type="button" onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}
                  className="text-foreground">
                  {form.isActive
                    ? <ToggleRight className="w-8 h-8 text-emerald-500" />
                    : <ToggleLeft className="w-8 h-8 text-muted-foreground" />}
                </button>
                <span className="text-sm text-foreground">{form.isActive ? "Вкл" : "Выкл"}</span>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-700 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted active:bg-accent transition-colors">
                Отмена
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isEdit ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {activeTariffConfig && (
        <TariffConfigModal
          tariffClass={activeTariffConfig}
          form={form}
          setForm={setForm}
          onClose={() => setActiveTariffConfig(null)}
          priceBackKey={tariffConfigs.find(t => t.key === activeTariffConfig)!.priceBackKey}
          priceFrontKey={tariffConfigs.find(t => t.key === activeTariffConfig)!.priceFrontKey}
        />
      )}
    </>
  );
}

interface Tariff {
  id: number;
  carClass: string;
  baseRate: number;
  perKmRate: number;
  intercityFee: number;
  minPrice: number;
}

function TariffRow({ tariff, token, onSaved }: { tariff: Tariff; token: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    baseRate: String(tariff.baseRate),
    perKmRate: String(tariff.perKmRate),
    intercityFee: String(tariff.intercityFee),
    minPrice: String(tariff.minPrice),
  });
  const [saving, setSaving] = useState(false);

  const classLabels: Record<string, string> = { economy: "Эконом", comfort: "Комфорт", business: "Бизнес" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/tariffs/${tariff.id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({
          baseRate: parseFloat(form.baseRate) || 0,
          perKmRate: parseFloat(form.perKmRate) || 0,
          intercityFee: parseFloat(form.intercityFee) || 0,
          minPrice: parseInt(form.minPrice) || 0,
        }),
      });
      if (res.ok) {
        onSaved();
        setEditing(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || "Ошибка сохранения тарифа");
      }
    } catch {
      alert("Ошибка сети");
    }
    setSaving(false);
  };

  if (editing) {
    return (
      <tr className="bg-emerald-500/10">
        <td className="px-5 py-3 font-medium text-foreground">{classLabels[tariff.carClass] || tariff.carClass}</td>
        <td className="px-5 py-3">
          <input type="number" value={form.baseRate} onChange={e => setForm(f => ({ ...f, baseRate: e.target.value }))}
            className="w-full border border-border rounded px-2 py-1 text-sm text-right" />
        </td>
        <td className="px-5 py-3">
          <input type="number" value={form.perKmRate} onChange={e => setForm(f => ({ ...f, perKmRate: e.target.value }))}
            className="w-full border border-border rounded px-2 py-1 text-sm text-right" />
        </td>
        <td className="px-5 py-3">
          <input type="number" value={form.intercityFee} onChange={e => setForm(f => ({ ...f, intercityFee: e.target.value }))}
            className="w-full border border-border rounded px-2 py-1 text-sm text-right" />
        </td>
        <td className="px-5 py-3">
          <input type="number" value={form.minPrice} onChange={e => setForm(f => ({ ...f, minPrice: e.target.value }))}
            className="w-full border border-border rounded px-2 py-1 text-sm text-right" />
        </td>
        <td className="px-5 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={handleSave} disabled={saving}
              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            </button>
            <button onClick={() => setEditing(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-muted/50">
      <td className="px-5 py-3 font-medium text-foreground">{classLabels[tariff.carClass] || tariff.carClass}</td>
      <td className="px-5 py-3 text-right text-foreground">{fmt(tariff.baseRate)} сум</td>
      <td className="px-5 py-3 text-right text-foreground">{fmt(tariff.perKmRate)} сум/км</td>
      <td className="px-5 py-3 text-right text-foreground">{fmt(tariff.intercityFee)} сум</td>
      <td className="px-5 py-3 text-right text-foreground">{fmt(tariff.minPrice)} сум</td>
      <td className="px-5 py-3 text-right">
        <button onClick={() => setEditing(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors">
          <Pencil className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

export default function References() {
  const token = localStorage.getItem("authToken");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [modalRoute, setModalRoute] = useState<Route | null | "new">(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"routes" | "tariffs">("routes");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const [routesRes, tariffsRes] = await Promise.all([
        fetch(`${BASE_URL}/api/routes`, { headers }),
        fetch(`${BASE_URL}/api/tariffs`, { headers }),
      ]);
      if (routesRes.ok) {
        const data = await routesRes.json();
        setRoutes(data.routes || []);
      }
      if (tariffsRes.ok) {
        const data = await tariffsRes.json();
        setTariffs(data.tariffs || []);
      }
      if (!routesRes.ok && !tariffsRes.ok) setFetchError(true);
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить это направление?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`${BASE_URL}/api/routes/${id}`, {
        method: "DELETE", headers,
      });
      if (res.ok) {
        setRoutes(r => r.filter(x => x.id !== id));
      }
    } catch {}
    setDeleting(null);
  };

  const toggleActive = async (route: Route) => {
    try {
      const res = await fetch(`${BASE_URL}/api/routes/${route.id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ isActive: !route.isActive }),
      });
      if (res.ok) {
        const data = await res.json();
        setRoutes(r => r.map(x => x.id === route.id ? data : x));
      }
    } catch {}
  };

  const [movingId, setMovingId] = useState<number | null>(null);
  const sortedRoutes = [...routes].sort((a, b) => {
    const aOrd = a.sortOrder === 0 ? 9999 : a.sortOrder;
    const bOrd = b.sortOrder === 0 ? 9999 : b.sortOrder;
    if (aOrd !== bOrd) return aOrd - bOrd;
    return a.id - b.id;
  });

  const moveRoute = async (route: Route, direction: -1 | 1) => {
    const idx = sortedRoutes.findIndex(r => r.id === route.id);
    const neighborIdx = idx + direction;
    if (neighborIdx < 0 || neighborIdx >= sortedRoutes.length) return;

    // Reorder array: swap with neighbor, then renumber 1..N (handles duplicates + zeros).
    const reordered = [...sortedRoutes];
    [reordered[idx], reordered[neighborIdx]] = [reordered[neighborIdx], reordered[idx]];

    const updates: Array<{ id: number; sortOrder: number }> = reordered
      .map((r, i) => ({ id: r.id, sortOrder: i + 1 }))
      .filter(u => {
        const cur = routes.find(x => x.id === u.id);
        return !cur || cur.sortOrder !== u.sortOrder;
      });

    setMovingId(route.id);
    try {
      await Promise.all(updates.map(u =>
        fetch(`${BASE_URL}/api/routes/${u.id}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: u.sortOrder }),
        })
      ));
      setRoutes(prev => prev.map(r => {
        const u = updates.find(x => x.id === r.id);
        return u ? { ...r, sortOrder: u.sortOrder } : r;
      }));
    } catch {} finally {
      setMovingId(null);
    }
  };

  return (
    <DispatcherLayout>
      {modalRoute !== null && (
        <RouteModal
          route={modalRoute === "new" ? null : modalRoute}
          onClose={() => setModalRoute(null)}
          onSaved={load}
          token={token}
        />
      )}

      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-foreground">Справочники</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Управление маршрутами и тарифами</p>
          </div>
          {activeTab === "routes" && (
            <button
              onClick={() => setModalRoute("new")}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97] transition-all"
            >
              <Plus className="w-4 h-4" />
              Добавить направление
            </button>
          )}
        </div>

        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button onClick={() => setActiveTab("routes")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "routes" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <MapPin className="w-4 h-4" />
            Направления ({routes.length})
          </button>
          <button onClick={() => setActiveTab("tariffs")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "tariffs" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            <DollarSign className="w-4 h-4" />
            Тарифы ({tariffs.length})
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5 h-24 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        ) : fetchError ? (
          <ErrorState message="Не удалось загрузить справочники" onRetry={load} />
        ) : activeTab === "tariffs" ? (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted border-b border-border text-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Класс</th>
                    <th className="px-5 py-3 font-medium text-right">Базовая ставка</th>
                    <th className="px-5 py-3 font-medium text-right">За км</th>
                    <th className="px-5 py-3 font-medium text-right">Межгородской сбор</th>
                    <th className="px-5 py-3 font-medium text-right">Мин. цена</th>
                    <th className="px-5 py-3 font-medium text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tariffs.map(t => (
                    <TariffRow key={t.id} tariff={t} token={token} onSaved={load} />
                  ))}
                </tbody>
              </table>
            </div>
            {tariffs.length === 0 && (
              <div className="text-center py-12">
                <DollarSign className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">Нет тарифов</p>
                <p className="text-sm text-muted-foreground mt-1">Тарифы создаются автоматически при запуске</p>
              </div>
            )}
          </div>
        ) : routes.length === 0 ? (
          <div className="bg-background rounded-xl border border-border text-center py-16">
            <MapPin className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">Нет направлений</p>
            <p className="text-sm text-muted-foreground mt-1">Добавьте первое направление</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left min-w-[980px]">
                <thead className="bg-muted border-b border-border text-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium w-12 text-center">#</th>
                    <th className="px-5 py-3 font-medium">Направление</th>
                    <th className="px-5 py-3 font-medium text-center">Расстояние</th>
                    <th className="px-5 py-3 font-medium text-center">Время</th>
                    <th className="px-5 py-3 font-medium text-right">Эконом</th>
                    <th className="px-5 py-3 font-medium text-right">Комфорт</th>
                    <th className="px-5 py-3 font-medium text-right">Бизнес</th>
                    <th className="px-5 py-3 font-medium text-right">Почта</th>
                    <th className="px-5 py-3 font-medium text-center">Статус</th>
                    <th className="px-5 py-3 font-medium text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedRoutes.map((route, rowIdx) => (
                    <tr key={route.id} className={`cursor-pointer hover:bg-primary/5 transition-colors ${!route.isActive ? "opacity-50" : ""}`}>
                      <td className="px-5 py-3 text-center text-muted-foreground text-xs font-mono">
                        {route.sortOrder}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-emerald-600">{route.fromCity}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="font-medium text-emerald-600">{route.toCity}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-center text-foreground">
                        {fmt(route.distanceKm)} км
                      </td>
                      <td className="px-5 py-3 text-center text-foreground">
                        <span className="flex items-center justify-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {Math.floor(route.durationMin / 60)}ч {route.durationMin % 60}м
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-foreground font-medium">
                        {route.priceEconomy > 0 ? `${fmt(route.priceEconomy)} сум` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-foreground font-medium">
                        {route.priceComfort > 0 ? `${fmt(route.priceComfort)} сум` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-foreground font-medium">
                        {route.priceBusiness > 0 ? `${fmt(route.priceBusiness)} сум` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-foreground font-medium">
                        {route.priceMail > 0 ? `${fmt(route.priceMail)} сум` : "—"}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <button onClick={() => toggleActive(route)} title={route.isActive ? "Деактивировать" : "Активировать"}>
                          {route.isActive
                            ? <ToggleRight className="w-6 h-6 text-emerald-500 mx-auto" />
                            : <ToggleLeft className="w-6 h-6 text-muted-foreground mx-auto" />}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => moveRoute(route, -1)}
                            disabled={rowIdx === 0 || movingId === route.id}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-600 hover:bg-blue-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Поднять выше"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => moveRoute(route, 1)}
                            disabled={rowIdx === sortedRoutes.length - 1 || movingId === route.id}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-600 hover:bg-blue-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Опустить ниже"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setModalRoute(route)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                            title="Редактировать"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(route.id)}
                            disabled={deleting === route.id}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                            title="Удалить"
                          >
                            {deleting === route.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Всего направлений: {routes.length} · Активных: {routes.filter(r => r.isActive).length}
        </p>
      </div>
    </DispatcherLayout>
  );
}
