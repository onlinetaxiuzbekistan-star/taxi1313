import { useState, useEffect, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import {
  Plus, Pencil, Trash2, X, Save, Loader2, AlertCircle,
  MapPin, Search, DollarSign, Filter, WifiOff
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface District {
  id: number;
  name: string;
  cityId: string;
  extraCharge: number;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
  createdAt: string;
}

interface City {
  id: number;
  slug: string;
  nameRu: string;
}

function DistrictModal({ district, cities, onClose, onSaved, token }: {
  district: District | null; cities: City[]; onClose: () => void; onSaved: () => void; token: string | null;
}) {
  const isEdit = !!district;
  const [form, setForm] = useState({
    name: district?.name || "",
    cityId: district?.cityId || (cities[0]?.slug || ""),
    extraCharge: String(district?.extraCharge || 0),
    lat: district?.lat ? String(district.lat) : "",
    lng: district?.lng ? String(district.lng) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) { setError("Название обязательно"); return; }
    if (!form.cityId) { setError("Выберите город"); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        cityId: form.cityId,
        extraCharge: parseFloat(form.extraCharge) || 0,
        lat: form.lat ? parseFloat(form.lat) : null,
        lng: form.lng ? parseFloat(form.lng) : null,
      };
      const url = isEdit ? `${BASE_URL}/api/districts/${district!.id}` : `${BASE_URL}/api/districts`;
      const res = await fetch(url, { method: isEdit ? "PATCH" : "POST", headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Ошибка"); setSaving(false); return; }
      onSaved();
      onClose();
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-bold text-foreground text-lg">{isEdit ? "Редактировать район" : "Новый район"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Название *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="Центральный район" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Город *</label>
            <select value={form.cityId} onChange={e => setForm(f => ({ ...f, cityId: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500 bg-card">
              <option value="">— Выберите город —</option>
              {cities.map(c => <option key={c.slug} value={c.slug}>{c.nameRu}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Доплата (сум)</label>
            <input type="number" value={form.extraCharge} onChange={e => setForm(f => ({ ...f, extraCharge: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500"
              placeholder="0" min="0" step="1000" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Широта (lat)</label>
              <input type="number" step="any" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500"
                placeholder="39.7747" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Долгота (lng)</label>
              <input type="number" step="any" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500"
                placeholder="64.4286" />
            </div>
          </div>
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-700 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted active:bg-accent transition-colors">Отмена</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? "Сохранить" : "Добавить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Districts() {
  const { token } = useAuth();
  const [districts, setDistricts] = useState<District[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCity, setFilterCity] = useState<string>("");
  const [modal, setModal] = useState<{ open: boolean; district: District | null }>({ open: false, district: null });
  const [deleting, setDeleting] = useState<number | null>(null);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const loadCities = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/cities`, { headers });
      if (res.ok) {
        const data = await res.json();
        setCities((data.cities || []).map((c: any) => ({ id: c.id, slug: c.slug || "", nameRu: c.nameRu })));
      }
    } catch {}
  }, [token]);

  const loadDistricts = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const params = filterCity ? `?cityId=${filterCity}` : "";
      const res = await fetch(`${BASE_URL}/api/districts${params}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setDistricts(data.districts || []);
      } else { setFetchError(true); }
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token, filterCity]);

  useEffect(() => { loadCities(); }, [loadCities]);
  useEffect(() => { loadDistricts(); }, [loadDistricts]);

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить район?")) return;
    setDeleting(id);
    try {
      await fetch(`${BASE_URL}/api/districts/${id}`, { method: "DELETE", headers });
      loadDistricts();
    } catch {}
    setDeleting(null);
  };

  const handleToggle = async (d: District) => {
    try {
      await fetch(`${BASE_URL}/api/districts/${d.id}`, {
        method: "PATCH", headers, body: JSON.stringify({ isActive: !d.isActive }),
      });
      loadDistricts();
    } catch {}
  };

  const getCityName = (cityId: string) => cities.find(c => c.slug === cityId)?.nameRu || cityId;

  const filtered = districts.filter(d => {
    if (search) {
      const s = search.toLowerCase();
      if (!d.name.toLowerCase().includes(s) && !getCityName(d.cityId).toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

  return (
    <DispatcherLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Районы</h2>
            <p className="text-sm text-muted-foreground mt-1">Управление районами и доплатами за подачу</p>
          </div>
          <button onClick={() => setModal({ open: true, district: null })}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.97] transition-all">
            <Plus className="w-4 h-4" /> Добавить район
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-border rounded-xl text-sm outline-none focus:border-emerald-500 bg-card"
              placeholder="Поиск по названию..." />
          </div>
          <div className="relative">
            <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
              className="pl-10 pr-8 py-2.5 border border-border rounded-xl text-sm outline-none focus:border-emerald-500 bg-background appearance-none min-w-[180px]">
              <option value="">Все города</option>
              {cities.map(c => <option key={c.slug} value={c.slug}>{c.nameRu}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            </div>
          ) : fetchError ? (
            <ErrorState message="Не удалось загрузить районы" onRetry={loadDistricts} />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <MapPin className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground">Нет районов</p>
              <p className="text-xs text-muted-foreground mt-1">Добавьте первый район для города</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-foreground text-xs uppercase tracking-wide">Район</th>
                    <th className="text-left py-3 px-4 font-semibold text-foreground text-xs uppercase tracking-wide">Город</th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground text-xs uppercase tracking-wide">Доплата</th>
                    <th className="text-center py-3 px-4 font-semibold text-foreground text-xs uppercase tracking-wide">Координаты</th>
                    <th className="text-center py-3 px-4 font-semibold text-foreground text-xs uppercase tracking-wide">Статус</th>
                    <th className="text-right py-3 px-4 font-semibold text-foreground text-xs uppercase tracking-wide">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(d => (
                    <tr key={d.id} className="border-b border-border cursor-pointer hover:bg-primary/5 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                            <MapPin className="w-4 h-4 text-emerald-600" />
                          </div>
                          <span className="font-medium text-foreground">{d.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-foreground">{getCityName(d.cityId)}</td>
                      <td className="py-3 px-4 text-right">
                        {d.extraCharge > 0 ? (
                          <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-700 px-2.5 py-1 rounded-full text-xs font-semibold">
                            <DollarSign className="w-3 h-3" />
                            +{fmt(d.extraCharge)} сум
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {d.lat && d.lng ? (
                          <span className="text-xs text-muted-foreground font-mono">{d.lat.toFixed(4)}, {d.lng.toFixed(4)}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button onClick={() => handleToggle(d)} className="transition-colors">
                          {d.isActive ? (
                            <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-700 px-2.5 py-1 rounded-full text-xs font-medium">Активен</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-muted text-muted-foreground px-2.5 py-1 rounded-full text-xs font-medium">Неактивен</span>
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setModal({ open: true, district: d })}
                            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-emerald-600 transition-colors"
                            title="Редактировать">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(d.id)} disabled={deleting === d.id}
                            className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-40"
                            title="Удалить">
                            {deleting === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-border bg-muted/50 text-xs text-muted-foreground">
              Всего: {filtered.length} район{filtered.length === 1 ? "" : filtered.length < 5 ? "а" : "ов"}
              {filterCity && ` в городе ${getCityName(filterCity)}`}
            </div>
          )}
        </div>
      </div>

      {modal.open && (
        <DistrictModal
          district={modal.district}
          cities={cities}
          onClose={() => setModal({ open: false, district: null })}
          onSaved={loadDistricts}
          token={token}
        />
      )}
    </DispatcherLayout>
  );
}
