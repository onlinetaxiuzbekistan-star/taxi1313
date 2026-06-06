import { useState, useEffect, useCallback } from "react";
import { ShieldBan, Plus, Trash2, ToggleLeft, ToggleRight, Pencil, X, Save, Package } from "lucide-react";
import { SettingsPageLayout } from "./SettingsPageLayout";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface BlockedApp {
  id: number;
  name: string;
  packageName: string;
  urlScheme: string | null;
  enabled: boolean;
  createdAt: string;
}

export default function BlockedAppsSettings() {
  const [apps, setApps] = useState<BlockedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", packageName: "", urlScheme: "" });
  const { toast } = useToast();

  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/blocked-apps`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setApps(data.apps || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchApps(); }, [fetchApps]);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.packageName.trim()) {
      toast({ variant: "destructive", title: "Заполните название и пакетное имя" });
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/blocked-apps`, {
        method: "POST", headers,
        body: JSON.stringify({ name: form.name, packageName: form.packageName, urlScheme: form.urlScheme || null }),
      });
      if (res.ok) {
        toast({ title: "Приложение добавлено в чёрный список" });
        setForm({ name: "", packageName: "", urlScheme: "" });
        setAdding(false);
        fetchApps();
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка" });
    }
  };

  const handleUpdate = async (id: number) => {
    try {
      const res = await fetch(`${BASE_URL}/api/blocked-apps/${id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ name: form.name, packageName: form.packageName, urlScheme: form.urlScheme || null }),
      });
      if (res.ok) {
        toast({ title: "Обновлено" });
        setEditId(null);
        fetchApps();
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка" });
    }
  };

  const handleToggle = async (app: BlockedApp) => {
    try {
      const res = await fetch(`${BASE_URL}/api/blocked-apps/${app.id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ enabled: !app.enabled }),
      });
      if (res.ok) {
        fetchApps();
      } else {
        toast({ variant: "destructive", title: "Не удалось обновить" });
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`${BASE_URL}/api/blocked-apps/${id}`, { method: "DELETE", headers });
      if (res.ok) {
        toast({ title: "Удалено" });
        fetchApps();
      } else {
        toast({ variant: "destructive", title: "Не удалось удалить" });
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети" });
    }
  };

  const startEdit = (app: BlockedApp) => {
    setEditId(app.id);
    setForm({ name: app.name, packageName: app.packageName, urlScheme: app.urlScheme || "" });
    setAdding(false);
  };

  return (
    <SettingsPageLayout
      title="Блокировка приложений"
      subtitle="Запрет конкурентных приложений у водителей"
      icon={<ShieldBan className="w-5 h-5" />}
      hasChanges={false}
      saving={false}
      onSave={() => {}}
      saved={false}
      hideSaveButton
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Водитель не сможет выйти на линию, если на его устройстве обнаружено запрещённое приложение.
          </p>
          {!adding && (
            <button
              onClick={() => { setAdding(true); setEditId(null); setForm({ name: "", packageName: "", urlScheme: "" }); }}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Добавить
            </button>
          )}
        </div>

        {adding && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Название приложения</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Например: Yandex Go"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Пакетное имя (Android)</label>
                <input
                  value={form.packageName}
                  onChange={e => setForm(f => ({ ...f, packageName: e.target.value }))}
                  placeholder="ru.yandex.taxi"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">URL-схема (опционально)</label>
              <input
                value={form.urlScheme}
                onChange={e => setForm(f => ({ ...f, urlScheme: e.target.value }))}
                placeholder="yandextaxi://"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAdding(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted"
              >
                Отмена
              </button>
              <button
                onClick={handleAdd}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90"
              >
                Добавить
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-20 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : apps.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <ShieldBan className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Список пуст</p>
            <p className="text-xs mt-1">Добавьте приложения-конкуренты для блокировки</p>
          </div>
        ) : (
          <div className="space-y-2">
            {apps.map(app => (
              <div
                key={app.id}
                className={`bg-card border rounded-xl p-4 transition-all ${app.enabled ? "border-border" : "border-border/50 opacity-60"}`}
              >
                {editId === app.id ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                      <input
                        value={form.packageName}
                        onChange={e => setForm(f => ({ ...f, packageName: e.target.value }))}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <input
                      value={form.urlScheme}
                      onChange={e => setForm(f => ({ ...f, urlScheme: e.target.value }))}
                      placeholder="URL-схема"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditId(null)} className="p-1.5 rounded-lg hover:bg-muted">
                        <X className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleUpdate(app.id)} className="p-1.5 rounded-lg bg-primary text-primary-foreground">
                        <Save className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${app.enabled ? "bg-red-500/10 text-red-500" : "bg-muted text-muted-foreground"}`}>
                      <Package className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{app.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{app.packageName}</p>
                      {app.urlScheme && (
                        <p className="text-xs text-muted-foreground/70 font-mono">{app.urlScheme}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => handleToggle(app)} className="p-1.5 rounded-lg hover:bg-muted" title={app.enabled ? "Отключить" : "Включить"}>
                        {app.enabled ? (
                          <ToggleRight className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                        )}
                      </button>
                      <button onClick={() => startEdit(app)} className="p-1.5 rounded-lg hover:bg-muted">
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={() => handleDelete(app.id)} className="p-1.5 rounded-lg hover:bg-muted">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsPageLayout>
  );
}
