import { useState, useEffect, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import {
  Plus, Pencil, Trash2, X, Save, Loader2, AlertCircle,
  Building2, MapPin, Phone, Search, ToggleLeft, ToggleRight,
  WifiOff
} from "lucide-react";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Branch {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
}

interface City {
  id: number;
  nameRu: string;
  nameUz: string | null;
  branchId: number | null;
  lat: number | null;
  lng: number | null;
  isActive: boolean;
}

function BranchModal({ branch, onClose, onSaved, token }: {
  branch: Branch | null; onClose: () => void; onSaved: () => void; token: string | null;
}) {
  const isEdit = !!branch;
  const [form, setForm] = useState({ name: branch?.name || "", address: branch?.address || "", phone: branch?.phone || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!form.name.trim()) { setError("Название обязательно"); return; }
    setSaving(true);
    try {
      const url = isEdit ? `${BASE_URL}/api/branches/${branch!.id}` : `${BASE_URL}/api/branches`;
      const res = await fetch(url, { method: isEdit ? "PATCH" : "POST", headers, body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Ошибка"); setSaving(false); return; }
      onSaved(); onClose();
    } catch { setError("Ошибка сети"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-bold text-foreground text-lg">{isEdit ? "Редактировать филиал" : "Новый филиал"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Название *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="Бухарский филиал" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Адрес</label>
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="ул. Мустакиллик, 10" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Телефон</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="+998..." />
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

function CityModal({ city, branches, onClose, onSaved, token }: {
  city: City | null; branches: Branch[]; onClose: () => void; onSaved: () => void; token: string | null;
}) {
  const isEdit = !!city;
  const [form, setForm] = useState({
    nameRu: city?.nameRu || "", nameUz: city?.nameUz || "",
    branchId: city?.branchId ? String(city.branchId) : "",
    lat: city?.lat ? String(city.lat) : "", lng: city?.lng ? String(city.lng) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!form.nameRu.trim()) { setError("Название обязательно"); return; }
    setSaving(true);
    try {
      const url = isEdit ? `${BASE_URL}/api/cities/${city!.id}` : `${BASE_URL}/api/cities`;
      const body: any = { nameRu: form.nameRu.trim(), nameUz: form.nameUz || null };
      if (form.branchId) body.branchId = parseInt(form.branchId);
      if (form.lat) body.lat = parseFloat(form.lat);
      if (form.lng) body.lng = parseFloat(form.lng);
      const res = await fetch(url, { method: isEdit ? "PATCH" : "POST", headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Ошибка"); setSaving(false); return; }
      onSaved(); onClose();
    } catch { setError("Ошибка сети"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-bold text-foreground text-lg">{isEdit ? "Редактировать город" : "Новый город"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Название (рус) *</label>
              <input value={form.nameRu} onChange={e => setForm(f => ({ ...f, nameRu: e.target.value }))} required
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="Бухара" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Название (узб)</label>
              <input value={form.nameUz} onChange={e => setForm(f => ({ ...f, nameUz: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="Buxoro" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Филиал</label>
            <select value={form.branchId} onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500">
              <option value="">Без филиала</option>
              {branches.filter(b => b.isActive).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Широта</label>
              <input type="number" step="any" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="39.77" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Долгота</label>
              <input type="number" step="any" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="64.42" />
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

export default function Branches() {
  const token = localStorage.getItem("authToken");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [activeTab, setActiveTab] = useState<"branches" | "cities">("branches");
  const [branchModal, setBranchModal] = useState<Branch | null | "new">(null);
  const [cityModal, setCityModal] = useState<City | null | "new">(null);
  const [search, setSearch] = useState("");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const [bRes, cRes] = await Promise.all([
        fetch(`${BASE_URL}/api/branches`, { headers }),
        fetch(`${BASE_URL}/api/cities`, { headers }),
      ]);
      if (bRes.ok) { const d = await bRes.json(); setBranches(d.branches || []); }
      if (cRes.ok) { const d = await cRes.json(); setCities(d.cities || []); }
      if (!bRes.ok && !cRes.ok) setFetchError(true);
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const deleteBranch = async (id: number) => {
    if (!confirm("Удалить филиал?")) return;
    try {
      const res = await fetch(`${BASE_URL}/api/branches/${id}`, { method: "DELETE", headers });
      if (res.ok) setBranches(b => b.filter(x => x.id !== id));
    } catch {}
  };

  const deleteCity = async (id: number) => {
    if (!confirm("Удалить город?")) return;
    try {
      const res = await fetch(`${BASE_URL}/api/cities/${id}`, { method: "DELETE", headers });
      if (res.ok) setCities(c => c.filter(x => x.id !== id));
    } catch {}
  };

  const toggleCityActive = async (city: City) => {
    try {
      const res = await fetch(`${BASE_URL}/api/cities/${city.id}`, {
        method: "PATCH", headers, body: JSON.stringify({ isActive: !city.isActive }),
      });
      if (res.ok) { const data = await res.json(); setCities(c => c.map(x => x.id === city.id ? data : x)); }
    } catch {}
  };

  const branchName = (id: number | null) => branches.find(b => b.id === id)?.name || "—";

  return (
    <DispatcherLayout>
      {branchModal !== null && (
        <BranchModal branch={branchModal === "new" ? null : branchModal} onClose={() => setBranchModal(null)} onSaved={load} token={token} />
      )}
      {cityModal !== null && (
        <CityModal city={cityModal === "new" ? null : cityModal} branches={branches} onClose={() => setCityModal(null)} onSaved={load} token={token} />
      )}
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-foreground">Филиалы и города</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Управление структурой филиалов</p>
          </div>
          <button onClick={() => activeTab === "branches" ? setBranchModal("new") : setCityModal("new")}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97] transition-all">
            <Plus className="w-4 h-4" />{activeTab === "branches" ? "Добавить филиал" : "Добавить город"}
          </button>
        </div>

        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button onClick={() => setActiveTab("branches")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "branches" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}><Building2 className="w-4 h-4" />Филиалы ({branches.length})</button>
          <button onClick={() => setActiveTab("cities")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "cities" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}><MapPin className="w-4 h-4" />Города ({cities.length})</button>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="bg-card rounded-xl border border-border p-5 h-20 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
        ) : fetchError ? (
          <ErrorState message="Не удалось загрузить данные" onRetry={load} />
        ) : activeTab === "branches" ? (
          branches.length === 0 ? (
            <div className="bg-background rounded-xl border border-border text-center py-16">
              <Building2 className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">Нет филиалов</p>
              <p className="text-sm text-muted-foreground mt-1">Добавьте первый филиал</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {branches.map(b => (
                <div key={b.id} className={`bg-card border border-border rounded-xl p-5 ${!b.isActive ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{b.name}</p>
                        <p className="text-xs text-muted-foreground">{cities.filter(c => c.branchId === b.id).length} городов</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setBranchModal(b)} className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 active:scale-90 transition-all"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => deleteBranch(b.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 active:scale-90 transition-all"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  {b.address && <p className="text-sm text-muted-foreground flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{b.address}</p>}
                  {b.phone && <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1"><Phone className="w-3.5 h-3.5" />{b.phone}</p>}
                </div>
              ))}
            </div>
          )
        ) : (
          cities.length === 0 ? (
            <div className="bg-background rounded-xl border border-border text-center py-16">
              <MapPin className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">Нет городов</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted border-b border-border text-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Город</th>
                    <th className="px-5 py-3 font-medium">Узбекское название</th>
                    <th className="px-5 py-3 font-medium">Филиал</th>
                    <th className="px-5 py-3 font-medium text-center">Координаты</th>
                    <th className="px-5 py-3 font-medium text-center">Статус</th>
                    <th className="px-5 py-3 font-medium text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cities.map(c => (
                    <tr key={c.id} className={`cursor-pointer hover:bg-primary/5 transition-colors ${!c.isActive ? "opacity-50" : ""}`}>
                      <td className="px-5 py-3 font-medium text-foreground">{c.nameRu}</td>
                      <td className="px-5 py-3 text-foreground">{c.nameUz || "—"}</td>
                      <td className="px-5 py-3 text-foreground">{branchName(c.branchId)}</td>
                      <td className="px-5 py-3 text-center text-xs text-muted-foreground">
                        {c.lat && c.lng ? `${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <button onClick={() => toggleCityActive(c)}>
                          {c.isActive ? <ToggleRight className="w-6 h-6 text-emerald-500 mx-auto" /> : <ToggleLeft className="w-6 h-6 text-muted-foreground mx-auto" />}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setCityModal(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 active:scale-90 transition-all"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => deleteCity(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 active:scale-90 transition-all"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </DispatcherLayout>
  );
}
