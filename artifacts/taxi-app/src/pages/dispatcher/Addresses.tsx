import { useState, useEffect, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import {
  Plus, Pencil, Trash2, X, Save, Loader2, AlertCircle,
  MapPin, Tag, Search, FolderOpen
} from "lucide-react";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface AddressGroup { id: number; name: string; cityId: number | null; }
interface Address {
  id: number; name: string; groupId: number | null; cityId: number | null;
  lat: number | null; lng: number | null; extraPrice: number; isActive: boolean;
}

function GroupModal({ onClose, onSaved, token }: { onClose: () => void; onSaved: () => void; token: string | null }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/addresses/groups`, { method: "POST", headers, body: JSON.stringify({ name: name.trim() }) });
      if (res.ok) { onSaved(); onClose(); }
    } catch {} setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-bold text-foreground">Новая группа</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Название группы" required
            className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <button type="submit" disabled={saving}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Добавить
          </button>
        </form>
      </div>
    </div>
  );
}

function AddressModal({ address, groups, onClose, onSaved, token }: {
  address: Address | null; groups: AddressGroup[]; onClose: () => void; onSaved: () => void; token: string | null;
}) {
  const isEdit = !!address;
  const [form, setForm] = useState({
    name: address?.name || "", groupId: address?.groupId ? String(address.groupId) : "",
    lat: address?.lat ? String(address.lat) : "", lng: address?.lng ? String(address.lng) : "",
    extraPrice: address?.extraPrice ? String(address.extraPrice) : "0",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!form.name.trim()) { setError("Название обязательно"); return; }
    setSaving(true);
    try {
      const url = isEdit ? `${BASE_URL}/api/addresses/${address!.id}` : `${BASE_URL}/api/addresses`;
      const body: any = { name: form.name.trim(), extraPrice: parseFloat(form.extraPrice) || 0 };
      if (form.groupId) body.groupId = parseInt(form.groupId);
      if (form.lat) body.lat = parseFloat(form.lat);
      if (form.lng) body.lng = parseFloat(form.lng);
      const res = await fetch(url, { method: isEdit ? "PATCH" : "POST", headers, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Ошибка"); setSaving(false); return; }
      onSaved(); onClose();
    } catch { setError("Ошибка сети"); } setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-bold text-foreground text-lg">{isEdit ? "Редактировать адрес" : "Новый адрес"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground active:scale-90 transition-all"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Название *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="Аэропорт Бухара" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Группа</label>
            <select value={form.groupId} onChange={e => setForm(f => ({ ...f, groupId: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500">
              <option value="">Без группы</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Широта</label>
              <input type="number" step="any" value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Долгота</label>
              <input type="number" step="any" value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Доп. стоимость (сум)</label>
            <input type="number" value={form.extraPrice} onChange={e => setForm(f => ({ ...f, extraPrice: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="5000" />
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

export default function Addresses() {
  const token = localStorage.getItem("authToken");
  const [groups, setGroups] = useState<AddressGroup[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [addrModal, setAddrModal] = useState<Address | null | "new">(null);
  const [filterGroup, setFilterGroup] = useState<string>("");
  const [search, setSearch] = useState("");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const [gRes, aRes] = await Promise.all([
        fetch(`${BASE_URL}/api/addresses/groups`, { headers }),
        fetch(`${BASE_URL}/api/addresses`, { headers }),
      ]);
      if (gRes.ok) { const d = await gRes.json(); setGroups(d.groups || []); }
      if (aRes.ok) { const d = await aRes.json(); setAddresses(d.addresses || []); }
      if (!gRes.ok && !aRes.ok) setFetchError(true);
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const deleteGroup = async (id: number) => {
    if (!confirm("Удалить группу?")) return;
    try {
      const res = await fetch(`${BASE_URL}/api/addresses/groups/${id}`, { method: "DELETE", headers });
      if (res.ok) setGroups(g => g.filter(x => x.id !== id));
    } catch {}
  };

  const deleteAddress = async (id: number) => {
    if (!confirm("Удалить адрес?")) return;
    try {
      const res = await fetch(`${BASE_URL}/api/addresses/${id}`, { method: "DELETE", headers });
      if (res.ok) setAddresses(a => a.filter(x => x.id !== id));
    } catch {}
  };

  const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const groupName = (id: number | null) => groups.find(g => g.id === id)?.name || "—";

  const filtered = addresses.filter(a => {
    if (filterGroup && a.groupId !== parseInt(filterGroup)) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <DispatcherLayout>
      {showGroupModal && <GroupModal onClose={() => setShowGroupModal(false)} onSaved={load} token={token} />}
      {addrModal !== null && (
        <AddressModal address={addrModal === "new" ? null : addrModal} groups={groups}
          onClose={() => setAddrModal(null)} onSaved={load} token={token} />
      )}
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-foreground">Адреса</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Управление адресами и группами</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowGroupModal(true)}
              className="flex items-center gap-2 border border-border text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted active:bg-accent transition-colors">
              <FolderOpen className="w-4 h-4" />Новая группа
            </button>
            <button onClick={() => setAddrModal("new")}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97] transition-all">
              <Plus className="w-4 h-4" />Добавить адрес
            </button>
          </div>
        </div>

        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {groups.map(g => (
              <div key={g.id} className="flex items-center gap-1.5 bg-background border border-border rounded-lg px-3 py-1.5">
                <Tag className="w-3 h-3 text-emerald-500" />
                <span className="text-sm text-foreground">{g.name}</span>
                <span className="text-xs text-muted-foreground ml-1">({addresses.filter(a => a.groupId === g.id).length})</span>
                <button onClick={() => deleteGroup(g.id)} className="ml-1 text-muted-foreground hover:text-red-500 active:scale-90 transition-all"><X className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск адреса..."
              className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg text-sm outline-none focus:border-emerald-500" />
          </div>
          <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
            className="border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-emerald-500">
            <option value="">Все группы</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="bg-card rounded-xl border border-border p-5 h-16 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
        ) : fetchError ? (
          <ErrorState message="Не удалось загрузить адреса" onRetry={load} />
        ) : filtered.length === 0 ? (
          <div className="bg-background rounded-xl border border-border text-center py-16">
            <MapPin className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">Нет адресов</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted border-b border-border text-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Адрес</th>
                  <th className="px-5 py-3 font-medium">Группа</th>
                  <th className="px-5 py-3 font-medium text-right">Доп. стоимость</th>
                  <th className="px-5 py-3 font-medium text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(a => (
                  <tr key={a.id} className="cursor-pointer hover:bg-primary/5 transition-colors">
                    <td className="px-5 py-3 font-medium text-foreground">{a.name}</td>
                    <td className="px-5 py-3 text-foreground">{groupName(a.groupId)}</td>
                    <td className="px-5 py-3 text-right text-foreground">
                      {a.extraPrice > 0 ? <span className="text-amber-600 font-medium">+{fmt(a.extraPrice)} сум</span> : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setAddrModal(a)} className="p-1.5 rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 active:scale-90 transition-all"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deleteAddress(a.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-500/10 active:scale-90 transition-all"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DispatcherLayout>
  );
}
