import { useEffect, useState } from "react";
import { Package, Plus, Trash2, ChevronRight, Check, Loader2, Save, Search } from "lucide-react";
import { SettingsPageLayout } from "./SettingsPageLayout";

const BASE_URL = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

const TARIFF_LABELS: Record<string, string> = {
  economy: "Эконом",
  comfort: "Комфорт",
  business: "Бизнес",
};
const TARIFF_CLASSES = ["economy", "comfort", "business"] as const;

interface RouteOption {
  id: number;
  routeId: number;
  tariffClass: string;
  optionKey: string;
  label: string;
  price: number;
  commission: number;
  isActive: boolean;
  sortOrder: number;
}

interface RouteWithOptions {
  id: number;
  fromCity: string;
  toCity: string;
  isActive: boolean;
  options: RouteOption[];
}

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n || 0));

export default function OptionsSettings() {
  const [routes, setRoutes] = useState<RouteWithOptions[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRouteId, setOpenRouteId] = useState<number | null>(null);
  const [openTariff, setOpenTariff] = useState<string>("economy");
  const [edits, setEdits] = useState<Record<number, Partial<RouteOption>>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState<{ routeId: number; tariffClass: string } | null>(null);
  const [newOpt, setNewOpt] = useState({ optionKey: "", label: "", price: "0", commission: "0" });
  const [filter, setFilter] = useState("");

  const authHeaders = (): Record<string, string> => {
    const t = localStorage.getItem("authToken");
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/routes`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setRoutes((data.routes || []).map((rt: any) => ({
        id: rt.id,
        fromCity: rt.fromCity,
        toCity: rt.toCity,
        isActive: rt.isActive,
        options: (rt.options || []).map((o: any) => ({
          ...o,
          commission: o.commission || 0,
        })),
      })));
    } catch (err) {
      console.error("load routes", err);
      alert("Не удалось загрузить маршруты");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const editField = (id: number, field: keyof RouteOption, value: any) => {
    setEdits(e => ({ ...e, [id]: { ...e[id], [field]: value } }));
  };

  const saveOption = async (opt: RouteOption) => {
    const edit = edits[opt.id] || {};
    setSavingId(opt.id);
    try {
      const r = await fetch(`${BASE_URL}/api/route-options/${opt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          label: edit.label ?? opt.label,
          price: edit.price ?? opt.price,
          commission: edit.commission ?? opt.commission,
          isActive: edit.isActive ?? opt.isActive,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const updated = await r.json();
      setRoutes(rs => rs.map(rt => rt.id === opt.routeId
        ? { ...rt, options: rt.options.map(o => o.id === opt.id ? { ...updated, commission: updated.commission || 0 } : o) }
        : rt));
      setEdits(e => { const n = { ...e }; delete n[opt.id]; return n; });
      setSavedIds(s => new Set([...s, opt.id]));
      setTimeout(() => setSavedIds(s => { const n = new Set(s); n.delete(opt.id); return n; }), 1500);
    } catch (err) {
      console.error("save", err);
      alert("Ошибка сохранения");
    } finally {
      setSavingId(null);
    }
  };

  const deleteOption = async (opt: RouteOption) => {
    if (!confirm(`Удалить опцию «${opt.label}» (${TARIFF_LABELS[opt.tariffClass]})?`)) return;
    try {
      const r = await fetch(`${BASE_URL}/api/route-options/${opt.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error(await r.text());
      setRoutes(rs => rs.map(rt => rt.id === opt.routeId
        ? { ...rt, options: rt.options.filter(o => o.id !== opt.id) }
        : rt));
    } catch (err) {
      console.error("delete", err);
      alert("Ошибка удаления");
    }
  };

  const createOption = async () => {
    if (!creating) return;
    const key = newOpt.optionKey.trim();
    const label = newOpt.label.trim();
    if (!key || !label) {
      alert("Заполните «Ключ» и «Название»");
      return;
    }
    try {
      const r = await fetch(`${BASE_URL}/api/route-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          routeId: creating.routeId,
          tariffClass: creating.tariffClass,
          optionKey: key,
          label,
          price: Number(newOpt.price) || 0,
          commission: Number(newOpt.commission) || 0,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        alert("Ошибка создания: " + txt);
        return;
      }
      const created = await r.json();
      setRoutes(rs => rs.map(rt => rt.id === creating.routeId
        ? { ...rt, options: [...rt.options, { ...created, commission: created.commission || 0 }] }
        : rt));
      setNewOpt({ optionKey: "", label: "", price: "0", commission: "0" });
      setCreating(null);
    } catch (err) {
      console.error("create", err);
      alert("Ошибка");
    }
  };

  const filtered = routes.filter(rt => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase().trim();
    return rt.fromCity.toLowerCase().includes(q) || rt.toCity.toLowerCase().includes(q);
  });

  return (
    <SettingsPageLayout
      title="Опции маршрутов"
      subtitle="Цена для пассажира + фикс. комиссия с водителя за каждую опцию"
      icon={<Package className="w-5 h-5" />}
      hasChanges={false}
      saving={false}
      onSave={() => {}}
      hideSaveButton
    >
      <div className="bg-card border border-border rounded-xl p-3 flex items-center gap-2">
        <Search className="w-4 h-4 text-muted-foreground ml-2" />
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Поиск по городу (например: Ташкент)"
          className="flex-1 bg-transparent outline-none text-sm py-1"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">Маршрутов не найдено</div>
          )}
          {filtered.map(rt => {
            const isOpen = openRouteId === rt.id;
            const tariffOptions = rt.options
              .filter(o => o.tariffClass === openTariff)
              .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
            return (
              <div key={rt.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenRouteId(isOpen ? null : rt.id)}
                  className="w-full px-5 py-4 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600">
                    <Package className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{rt.fromCity} → {rt.toCity}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {rt.options.length} опций · {rt.isActive ? "активен" : "выключен"}
                    </p>
                  </div>
                  <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>
                {isOpen && (
                  <div className="border-t border-border bg-muted/20">
                    <div className="px-5 py-3 flex items-center gap-2 border-b border-border flex-wrap">
                      {TARIFF_CLASSES.map(tc => {
                        const cnt = rt.options.filter(o => o.tariffClass === tc).length;
                        return (
                          <button
                            key={tc}
                            onClick={() => setOpenTariff(tc)}
                            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                              openTariff === tc
                                ? "bg-primary text-primary-foreground"
                                : "bg-card text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {TARIFF_LABELS[tc]} <span className="opacity-60">({cnt})</span>
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setCreating({ routeId: rt.id, tariffClass: openTariff })}
                        className="ml-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Добавить опцию
                      </button>
                    </div>
                    {creating && creating.routeId === rt.id && creating.tariffClass === openTariff && (
                      <div className="px-5 py-4 border-b border-border bg-emerald-500/5 space-y-2.5">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-muted-foreground font-medium">Ключ (англ., уникальный)</label>
                            <input
                              placeholder="например: baggage_xl"
                              value={newOpt.optionKey}
                              onChange={e => setNewOpt(n => ({ ...n, optionKey: e.target.value }))}
                              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background outline-none focus:border-primary font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground font-medium">Название</label>
                            <input
                              placeholder="Большой багаж"
                              value={newOpt.label}
                              onChange={e => setNewOpt(n => ({ ...n, label: e.target.value }))}
                              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background outline-none focus:border-primary"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-muted-foreground font-medium">Цена для пассажира, сум</label>
                            <input
                              type="number" min="0" placeholder="0"
                              value={newOpt.price}
                              onChange={e => setNewOpt(n => ({ ...n, price: e.target.value }))}
                              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background outline-none focus:border-primary text-right"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground font-medium">Комиссия с водителя, сум</label>
                            <input
                              type="number" min="0" placeholder="0"
                              value={newOpt.commission}
                              onChange={e => setNewOpt(n => ({ ...n, commission: e.target.value }))}
                              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background outline-none focus:border-primary text-right"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button onClick={() => { setCreating(null); setNewOpt({ optionKey: "", label: "", price: "0", commission: "0" }); }} className="text-xs px-3 py-1.5 rounded-lg text-muted-foreground hover:bg-muted">Отмена</button>
                          <button onClick={createOption} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600">Создать</button>
                        </div>
                      </div>
                    )}
                    {tariffOptions.length === 0 ? (
                      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                        Опций для тарифа «{TARIFF_LABELS[openTariff]}» нет
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        <div className="px-5 py-2 grid grid-cols-[40px_1fr_120px_120px_72px] gap-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                          <div>Вкл</div>
                          <div>Название / ключ</div>
                          <div className="text-right">Цена</div>
                          <div className="text-right">Комиссия</div>
                          <div className="text-right">Действия</div>
                        </div>
                        {tariffOptions.map(opt => {
                          const edit = edits[opt.id] || {};
                          const dirty = Object.keys(edit).length > 0;
                          const saved = savedIds.has(opt.id);
                          const curActive = edit.isActive ?? opt.isActive;
                          return (
                            <div key={opt.id} className={`px-5 py-3 grid grid-cols-[40px_1fr_120px_120px_72px] gap-2 items-center transition-colors ${saved ? "bg-emerald-500/5" : dirty ? "bg-amber-500/5" : ""}`}>
                              <button
                                onClick={() => editField(opt.id, "isActive", !curActive)}
                                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${curActive ? "bg-emerald-500" : "bg-muted"}`}
                                title={curActive ? "включена" : "выключена"}
                              >
                                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${curActive ? "left-[18px]" : "left-0.5"}`} />
                              </button>
                              <div className="min-w-0">
                                <input
                                  type="text"
                                  value={edit.label ?? opt.label}
                                  onChange={e => editField(opt.id, "label", e.target.value)}
                                  className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background outline-none focus:border-primary"
                                />
                                <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">{opt.optionKey}</p>
                              </div>
                              <input
                                type="number" min="0"
                                value={edit.price ?? opt.price}
                                onChange={e => editField(opt.id, "price", Number(e.target.value))}
                                className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background outline-none focus:border-primary text-right"
                              />
                              <input
                                type="number" min="0"
                                value={edit.commission ?? opt.commission}
                                onChange={e => editField(opt.id, "commission", Number(e.target.value))}
                                className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background outline-none focus:border-primary text-right"
                              />
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => saveOption(opt)}
                                  disabled={!dirty || savingId === opt.id}
                                  className={`p-2 rounded-lg transition-colors ${
                                    saved ? "bg-emerald-500 text-white"
                                      : dirty ? "bg-primary text-primary-foreground hover:opacity-90"
                                        : "bg-muted text-muted-foreground cursor-not-allowed"
                                  }`}
                                  title="Сохранить"
                                >
                                  {savingId === opt.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                                   saved ? <Check className="w-3.5 h-3.5" /> :
                                   <Save className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={() => deleteOption(opt)}
                                  className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors"
                                  title="Удалить"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SettingsPageLayout>
  );
}
