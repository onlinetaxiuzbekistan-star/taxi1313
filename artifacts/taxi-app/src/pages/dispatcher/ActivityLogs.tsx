import { useState, useEffect, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { Activity, Loader2, RefreshCw, Filter } from "lucide-react";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Log {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: number | null;
  details: string | null;
  createdAt: string;
}

const actionColors: Record<string, string> = {
  create: "bg-emerald-500/10 text-emerald-700",
  update: "bg-blue-500/10 text-blue-700",
  delete: "bg-red-500/10 text-red-700",
};

const actionLabels: Record<string, string> = {
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
};

export default function ActivityLogs() {
  const token = localStorage.getItem("authToken");
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const res = await fetch(`${BASE_URL}/api/activity-logs?limit=200`, { headers });
      if (res.ok) { const data = await res.json(); setLogs(data.logs || []); }
      else setFetchError(true);
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const entities = [...new Set(logs.map(l => l.entity))];

  const filtered = logs.filter(l => {
    if (filterAction && l.action !== filterAction) return false;
    if (filterEntity && l.entity !== filterEntity) return false;
    return true;
  });

  return (
    <DispatcherLayout>
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-foreground">Журнал действий</h2>
            <p className="text-sm text-muted-foreground mt-0.5">История всех операций в системе</p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 border border-border text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted active:bg-accent transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />Обновить
          </button>
        </div>

        <div className="flex gap-3">
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
            className="border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-emerald-500">
            <option value="">Все действия</option>
            <option value="create">Создание</option>
            <option value="update">Изменение</option>
            <option value="delete">Удаление</option>
          </select>
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)}
            className="border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-emerald-500">
            <option value="">Все объекты</option>
            {entities.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="bg-card rounded-xl border border-border p-4 h-14 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
        ) : fetchError ? (
          <ErrorState message="Не удалось загрузить журнал" onRetry={load} />
        ) : filtered.length === 0 ? (
          <div className="bg-card rounded-xl border border-border text-center py-16">
            <Activity className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">Нет записей</p>
            <p className="text-sm text-muted-foreground mt-1">Действия будут записываться автоматически</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="divide-y divide-border">
              {filtered.map(l => (
                <div key={l.id} className="px-5 py-3 flex items-center gap-4">
                  <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center shrink-0">
                    <Activity className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${actionColors[l.action] || "bg-muted text-foreground"}`}>
                        {actionLabels[l.action] || l.action}
                      </span>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{l.entity}</span>
                      {l.userName && <span className="text-xs text-muted-foreground">{l.userName}</span>}
                    </div>
                    {l.details && <p className="text-sm text-foreground mt-0.5 truncate">{l.details}</p>}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleDateString("ru-RU")} {new Date(l.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DispatcherLayout>
  );
}
