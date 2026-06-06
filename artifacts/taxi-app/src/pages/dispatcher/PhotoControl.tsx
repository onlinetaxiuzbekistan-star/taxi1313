import { useState, useEffect, useCallback, useRef } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { useAuth } from "@/hooks/use-auth";
import {
  Camera, Plus, Send, Check, X, Loader2, RefreshCw,
  Users, Clock, CheckCircle,
  XCircle, Image, Trash2, Search, ChevronLeft, ChevronRight,
  ZoomIn, Bot, ShieldAlert,
  Unlock, Eye,
} from "lucide-react";
import { toast } from "sonner";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type PhotoTask = {
  id: number; name: string; groupId: number | null; groupLabel: string | null;
  scheduleType: string; isActive: boolean; createdAt: string;
};
type DriverInfo = {
  id: number; name: string; phone: string;
  carBrand: string | null; carModel: string | null; carNumber: string | null;
  groupId: number | null; city: string | null; groupLabel: string | null;
  lastSelfieUrl: string | null; lastCarFrontUrl: string | null;
  lastCarBackUrl: string | null; lastInteriorUrl: string | null;
};
type AIPhotoResult = {
  photoType: string;
  aiStatus: "ok" | "warning" | "fail";
  aiComment: string;
};
type PhotoRequest = {
  id: number; driverId: number; taskId: number | null;
  status: string; selfieUrl: string | null; carFrontUrl: string | null;
  carBackUrl: string | null; interiorUrl: string | null;
  comment: string | null; rejectReason: string | null; reviewedBy: number | null; reviewedAt: string | null;
  retryCount: number; aiResults: { overallStatus: string; photos: AIPhotoResult[] } | null; aiStatus: string | null;
  createdAt: string; updatedAt: string; driver: DriverInfo | null;
};
type Stats = { total: number; pending: number; underReview: number; approved: number; rejected: number; rejectedAuto: number; rejectedFinal: number; withPhotos: number };
type DriverGroup = { id: number; name: string; label: string; level: number };

const SCHEDULE_LABELS: Record<string, string> = { manual: "Вручную", daily: "Ежедневно", weekly: "Еженедельно" };

function resolvePhotoUrl(url: string | null): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${window.location.origin}${BASE_URL}${url}`;
}

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  pending:        { label: "Ожидает",      color: "text-amber-600",   bg: "bg-amber-100" },
  under_review:   { label: "Проверка",     color: "text-violet-600",  bg: "bg-violet-100" },
  approved:       { label: "Одобрено",     color: "text-emerald-600", bg: "bg-emerald-100" },
  rejected:       { label: "Отклонено",    color: "text-red-600",     bg: "bg-red-100" },
  rejected_auto:  { label: "AI откл.",     color: "text-orange-600",  bg: "bg-orange-100" },
  rejected_final: { label: "Заблокирован", color: "text-red-700",     bg: "bg-red-200" },
};

function StatusIcon({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.pending;
  let icon;
  if (status === "approved") icon = <CheckCircle className="w-4 h-4" />;
  else if (status === "rejected" || status === "rejected_final") icon = <XCircle className="w-4 h-4" />;
  else if (status === "rejected_auto") icon = <Bot className="w-4 h-4" />;
  else if (status === "under_review") icon = <Eye className="w-4 h-4" />;
  else icon = <Clock className="w-4 h-4" />;
  return <span className={cfg.color} title={cfg.label}>{icon}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

export default function PhotoControl() {
  const { token } = useAuth();
  const [tab, setTab] = useState<"requests" | "tasks">("requests");
  const [requests, setRequests] = useState<PhotoRequest[]>([]);
  const [tasks, setTasks] = useState<PhotoTask[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [groups, setGroups] = useState<DriverGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [page, setPage] = useState(1);
  const [totalRequests, setTotalRequests] = useState(0);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTask, setNewTask] = useState({ name: "", groupId: "", scheduleType: "manual" });
  const [sending, setSending] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const searchRef = useRef<NodeJS.Timeout | null>(null);
  const rejectInputRef = useRef<HTMLInputElement>(null);
  const perPage = 50;

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  const loadRequests = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (searchQuery) params.set("search", searchQuery);
      if (filterGroup) params.set("groupId", filterGroup);
      params.set("page", String(page));
      params.set("limit", String(perPage));
      const res = await fetch(`${BASE_URL}/api/photo-control/requests?${params}`, { headers: headers() });
      if (res.ok) {
        const d = await res.json();
        setRequests(d.requests || []);
        setTotalRequests(d.total || 0);
      }
    } catch { toast.error("Ошибка загрузки"); }
  }, [token, filterStatus, searchQuery, filterGroup, page]);

  const loadMeta = useCallback(async () => {
    try {
      const [statsRes, taskRes, groupsRes] = await Promise.all([
        fetch(`${BASE_URL}/api/photo-control/stats`, { headers: headers() }),
        fetch(`${BASE_URL}/api/photo-control/tasks`, { headers: headers() }),
        fetch(`${BASE_URL}/api/driver-groups`, { headers: headers() }),
      ]);
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d.stats || null); }
      if (taskRes.ok) { const d = await taskRes.json(); setTasks(d.tasks || []); }
      if (groupsRes.ok) { const d = await groupsRes.json(); setGroups(d.groups || []); }
    } catch {}
  }, [token]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadRequests(), loadMeta()]);
    setLoading(false);
  }, [loadRequests, loadMeta]);

  const initialRef = useRef(false);
  useEffect(() => {
    if (!token) return;
    if (!initialRef.current) {
      initialRef.current = true;
      loadAll();
    } else {
      setLoading(true);
      loadRequests().finally(() => setLoading(false));
    }
  }, [token, filterStatus, searchQuery, filterGroup, page]);

  useEffect(() => {
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, []);

  const handleSearch = (val: string) => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => { setSearchQuery(val); setPage(1); }, 400);
  };

  const reviewRequest = useCallback(async (requestId: number, status: "approved" | "rejected", comment?: string) => {
    setReviewing(requestId);
    try {
      const res = await fetch(`${BASE_URL}/api/photo-control/requests/${requestId}/review`, {
        method: "PATCH", headers: headers(),
        body: JSON.stringify({ status, comment: comment || "" }),
      });
      if (res.ok) {
        toast.success(status === "approved" ? "Одобрено" : "Отклонено");
        setRejectMode(false);
        setRejectReason("");
        await loadRequests();
        loadMeta();
      } else { toast.error("Ошибка"); }
    } catch { toast.error("Ошибка сети"); }
    setReviewing(null);
  }, [headers, loadRequests, loadMeta]);

  const unblockRequest = useCallback(async (requestId: number) => {
    setReviewing(requestId);
    try {
      const res = await fetch(`${BASE_URL}/api/photo-control/requests/${requestId}/unblock`, {
        method: "POST", headers: headers(),
      });
      if (res.ok) {
        toast.success("Водитель разблокирован");
        await loadRequests();
        loadMeta();
      } else { toast.error("Ошибка разблокировки"); }
    } catch { toast.error("Ошибка сети"); }
    setReviewing(null);
  }, [headers, loadRequests, loadMeta]);

  const totalPages = Math.ceil(totalRequests / perPage);
  const selected = requests.find(r => r.id === selectedId) || null;

  const createTask = async () => {
    if (!newTask.name.trim()) { toast.error("Укажите название"); return; }
    try {
      const res = await fetch(`${BASE_URL}/api/photo-control/tasks`, {
        method: "POST", headers: headers(),
        body: JSON.stringify(newTask),
      });
      if (res.ok) { toast.success("Задача создана"); setShowCreateTask(false); setNewTask({ name: "", groupId: "", scheduleType: "manual" }); loadMeta(); }
      else { toast.error("Ошибка создания"); }
    } catch { toast.error("Ошибка сети"); }
  };

  const sendTask = async (taskId: number) => {
    setSending(taskId);
    try {
      const res = await fetch(`${BASE_URL}/api/photo-control/tasks/${taskId}/send`, { method: "POST", headers: headers() });
      if (res.ok) { const d = await res.json(); toast.success(`Отправлено ${d.created} водителям`); loadAll(); }
      else { toast.error("Ошибка отправки"); }
    } catch { toast.error("Ошибка сети"); }
    setSending(null);
  };

  const deleteTask = async (taskId: number) => {
    try {
      const res = await fetch(`${BASE_URL}/api/photo-control/tasks/${taskId}`, { method: "DELETE", headers: headers() });
      if (res.ok) { toast.success("Задача удалена"); loadMeta(); }
      else { toast.error("Ошибка удаления"); }
    } catch { toast.error("Ошибка сети"); }
  };

  const toggleTaskActive = async (task: PhotoTask) => {
    try {
      const res = await fetch(`${BASE_URL}/api/photo-control/tasks/${task.id}`, {
        method: "PATCH", headers: headers(),
        body: JSON.stringify({ isActive: !task.isActive }),
      });
      if (res.ok) { loadMeta(); }
    } catch { toast.error("Ошибка сети"); }
  };

  const fmtTime = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  };

  return (
    <DispatcherLayout>
      <div className="flex flex-col h-[calc(100vh-56px)]">
        <div className="px-4 pt-3 pb-2 border-b border-gray-200 bg-white space-y-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-bold text-gray-900">Фотоконтроль</h1>
              <p className="text-[11px] text-gray-500">Модерация фото водителей</p>
            </div>
            <button onClick={loadAll} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {stats && (
            <div className="flex flex-wrap gap-1">
              {[
                { key: "all", label: "Все", value: stats.total },
                { key: "pending", label: "Ожидают", value: stats.pending },
                { key: "under_review", label: "На проверке", value: stats.underReview },
                { key: "approved", label: "Одобрено", value: stats.approved },
                { key: "rejected", label: "Отклонено", value: stats.rejected },
                { key: "rejected_auto", label: "AI откл.", value: stats.rejectedAuto },
                { key: "rejected_final", label: "Заблокир.", value: stats.rejectedFinal },
              ].map(f => (
                <button key={f.key} onClick={() => { setFilterStatus(f.key); setPage(1); setSelectedId(null); }}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    filterStatus === f.key
                      ? "bg-amber-500 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}>
                  {f.label} {f.value}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-center">
            <div className="flex gap-1 border-b border-gray-200">
              <button onClick={() => setTab("requests")}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${tab === "requests" ? "border-amber-500 text-amber-600" : "border-transparent text-gray-400 hover:text-gray-700"}`}>
                Запросы ({totalRequests})
              </button>
              <button onClick={() => setTab("tasks")}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${tab === "tasks" ? "border-amber-500 text-amber-600" : "border-transparent text-gray-400 hover:text-gray-700"}`}>
                Задачи ({tasks.length})
              </button>
            </div>
            <div className="flex-1" />
            {tab === "requests" && (
              <>
                <div className="relative w-52">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input type="text" placeholder="Поиск..." onChange={e => handleSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500" />
                </div>
                <select value={filterGroup} onChange={e => { setFilterGroup(e.target.value); setPage(1); }}
                  className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                  <option value="">Все группы</option>
                  {groups.map(g => <option key={g.id} value={String(g.id)}>{g.label}</option>)}
                </select>
              </>
            )}
          </div>
        </div>

        {tab === "requests" ? (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 border-r border-gray-200">
              <div className="bg-gray-50 border-b border-gray-200 px-2">
                <div className="grid grid-cols-[60px_1fr_120px_120px_60px_60px] items-center h-8 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  <span className="px-2">Время</span>
                  <span className="px-2">Водитель</span>
                  <span className="px-2">Госномер</span>
                  <span className="px-2">Группа</span>
                  <span className="px-2 text-center">Фото</span>
                  <span className="px-2 text-center">Статус</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : requests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                    <Camera className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-xs">Нет запросов</p>
                  </div>
                ) : (
                  requests.map(r => {
                    const isSelected = selectedId === r.id;
                    const photoCount = [r.selfieUrl, r.carFrontUrl, r.carBackUrl, r.interiorUrl].filter(Boolean).length;
                    return (
                      <div
                        key={r.id}
                        onClick={() => { setSelectedId(r.id); setRejectMode(false); setRejectReason(""); }}
                        className={`grid grid-cols-[60px_1fr_120px_120px_60px_60px] items-center h-10 border-b border-gray-100 cursor-pointer text-xs transition-colors ${
                          isSelected ? "bg-amber-50 border-l-2 border-l-amber-500" : "hover:bg-gray-50 border-l-2 border-l-transparent"
                        }`}
                      >
                        <span className="px-2 text-[11px] text-gray-500 tabular-nums">{fmtTime(r.createdAt)}</span>
                        <span className="px-2 font-medium text-gray-900 truncate">{r.driver?.name || `#${r.driverId}`}</span>
                        <span className="px-2 font-mono text-[11px] text-gray-700">{r.driver?.carNumber || "—"}</span>
                        <span className="px-2 text-gray-500 truncate">{r.driver?.groupLabel || "—"}</span>
                        <span className="px-2 text-center">
                          <span className={`text-[10px] font-semibold ${photoCount === 4 ? "text-emerald-600" : "text-amber-600"}`}>
                            {photoCount}/4
                          </span>
                        </span>
                        <span className="px-2 flex justify-center"><StatusIcon status={r.status} /></span>
                      </div>
                    );
                  })
                )}

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-100">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                      className="p-1 rounded bg-gray-100 disabled:opacity-30 hover:bg-gray-200 text-xs">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] text-gray-500">{page} / {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      className="p-1 rounded bg-gray-100 disabled:opacity-30 hover:bg-gray-200 text-xs">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <span className="text-[10px] text-gray-400 ml-2">Найдено: {totalRequests}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="w-[420px] flex-shrink-0 overflow-y-auto bg-white">
              {selected ? (
                <DetailPanel
                  request={selected}
                  reviewing={reviewing === selected.id}
                  headers={headers}
                  rejectMode={rejectMode}
                  rejectReason={rejectReason}
                  rejectInputRef={rejectInputRef}
                  onApprove={() => reviewRequest(selected.id, "approved")}
                  onStartReject={() => { setRejectMode(true); setRejectReason(""); setTimeout(() => rejectInputRef.current?.focus(), 50); }}
                  onSubmitReject={(reason) => reviewRequest(selected.id, "rejected", reason)}
                  onCancelReject={() => { setRejectMode(false); setRejectReason(""); }}
                  onSetRejectReason={setRejectReason}
                  onUnblock={() => unblockRequest(selected.id)}
                  onOpenLightbox={(urls, idx) => setLightbox({ urls, index: idx })}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Camera className="w-10 h-10 mb-3 opacity-20" />
                  <p className="text-sm font-medium text-gray-500">Выберите запрос</p>
                  <p className="text-xs text-gray-400 mt-1">Нажмите на строку слева</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <TasksTab
              tasks={tasks} groups={groups}
              showCreateTask={showCreateTask} setShowCreateTask={setShowCreateTask}
              newTask={newTask} setNewTask={setNewTask}
              createTask={createTask} sendTask={sendTask} deleteTask={deleteTask}
              sending={sending} toggleTaskActive={toggleTaskActive}
            />
          </div>
        )}
      </div>

      {lightbox && (
        <Lightbox urls={lightbox.urls} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </DispatcherLayout>
  );
}

function DetailPanel({
  request: r, reviewing, rejectMode, rejectReason, rejectInputRef, headers,
  onApprove, onStartReject, onSubmitReject, onCancelReject, onSetRejectReason,
  onUnblock, onOpenLightbox,
}: {
  request: PhotoRequest; reviewing: boolean;
  rejectMode: boolean; rejectReason: string;
  rejectInputRef: React.RefObject<HTMLInputElement | null>;
  headers: () => Record<string, string>;
  onApprove: () => void; onStartReject: () => void;
  onSubmitReject: (reason: string) => void; onCancelReject: () => void;
  onSetRejectReason: (v: string) => void;
  onUnblock: () => void;
  onOpenLightbox: (urls: string[], index: number) => void;
}) {
  const [photoHistoryRecords, setPhotoHistoryRecords] = useState<PhotoRequest[]>([]);
  const [activeHistoryIdx, setActiveHistoryIdx] = useState<number>(-1); // -1 = current request

  useEffect(() => {
    setActiveHistoryIdx(-1);
    setPhotoHistoryRecords([]);
    if (!r.driverId) return;
    const ctrl = new AbortController();
    fetch(`${BASE_URL}/api/photo-control/history/${r.driverId}?limit=5&excludeId=${r.id}`, {
      headers: headers(),
      signal: ctrl.signal,
    })
      .then(res => res.ok ? res.json() : null)
      .then(d => {
        if (ctrl.signal.aborted) return;
        if (d?.history) setPhotoHistoryRecords(d.history);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [r.driverId, r.id, headers]);

  const activeRecord: PhotoRequest =
    activeHistoryIdx === -1 ? r : (photoHistoryRecords[activeHistoryIdx] ?? r);

  const photoEntries = [
    { label: "Селфи", url: activeRecord.selfieUrl, key: "selfie" },
    { label: "Авто спереди", url: activeRecord.carFrontUrl, key: "car_front" },
    { label: "Авто сзади", url: activeRecord.carBackUrl, key: "car_back" },
    { label: "Салон", url: activeRecord.interiorUrl, key: "interior" },
  ];

  const aiMap: Record<string, AIPhotoResult> = {};
  (activeRecord.aiResults?.photos || []).forEach(p => { aiMap[p.photoType] = p; });

  const allPhotos = [r.selfieUrl, r.carFrontUrl, r.carBackUrl, r.interiorUrl].every(Boolean);
  const allPhotoUrls = photoEntries.map(p => resolvePhotoUrl(p.url)).filter(Boolean);
  const isViewingCurrent = activeHistoryIdx === -1;
  const canReview = isViewingCurrent && (r.status === "pending" || r.status === "under_review") && allPhotos;
  const canUnblock = isViewingCurrent && ["rejected_final", "rejected_auto", "rejected"].includes(r.status);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <StatusBadge status={r.status} />
          {r.retryCount > 0 && (
            <span className="ml-2 text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-semibold">
              попытка {r.retryCount + 1}
            </span>
          )}
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-3">
        <p className="text-sm font-bold text-gray-900">{r.driver?.name || `Водитель #${r.driverId}`}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
          {r.driver?.phone && <span>{r.driver.phone}</span>}
          {r.driver?.carNumber && (
            <span className="font-mono font-semibold text-gray-800 bg-white px-1.5 py-0.5 rounded border border-gray-200 text-[11px]">
              {r.driver.carNumber}
            </span>
          )}
          {r.driver?.carBrand && <span>{r.driver.carBrand} {r.driver.carModel}</span>}
          {r.driver?.groupLabel && <span className="text-blue-600 font-medium">{r.driver.groupLabel}</span>}
        </div>
      </div>

      {photoHistoryRecords.length > 0 && (
        <div className="border-b border-gray-200 -mx-4 px-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-thin pb-px">
            <button
              onClick={() => setActiveHistoryIdx(-1)}
              className={`px-2.5 py-1.5 text-xs whitespace-nowrap border-b-2 transition-colors ${
                activeHistoryIdx === -1
                  ? "border-blue-500 text-blue-600 font-bold"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              Текущий
            </button>
            {photoHistoryRecords.map((h, idx) => (
              <button
                key={h.id}
                onClick={() => setActiveHistoryIdx(idx)}
                className={`px-2.5 py-1.5 text-xs whitespace-nowrap border-b-2 transition-colors ${
                  activeHistoryIdx === idx
                    ? "border-blue-500 text-blue-600 font-bold"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                {new Date(h.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Фотографии</p>
          {activeHistoryIdx !== -1 && (
            <span className="text-[10px] text-gray-400">
              {STATUS_CFG[activeRecord.status]?.label || activeRecord.status}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {photoEntries.map((p, idx) => (
            <DetailPhoto
              key={p.key}
              label={p.label}
              url={p.url}
              aiResult={aiMap[p.key]}
              onClick={() => {
                if (p.url) onOpenLightbox(allPhotoUrls, allPhotoUrls.indexOf(resolvePhotoUrl(p.url)));
              }}
            />
          ))}
        </div>
      </div>

      {r.aiResults && r.aiResults.photos.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Bot className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-[11px] font-semibold text-gray-700">AI-проверка</span>
            <span className={`text-[11px] font-bold ${
              r.aiStatus === "ok" ? "text-emerald-600" : r.aiStatus === "warning" ? "text-yellow-600" : "text-red-600"
            }`}>
              {r.aiStatus === "ok" ? "Пройдена" : r.aiStatus === "warning" ? "Предупреждения" : "Не пройдена"}
            </span>
          </div>
          {r.aiResults.photos.filter(p => p.aiStatus !== "ok").map((p, i) => (
            <p key={i} className="text-[11px] text-gray-600">
              <span className="font-medium">{p.photoType}:</span> {p.aiComment}
            </p>
          ))}
        </div>
      )}

      {r.rejectReason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs text-red-700">
            <span className="font-bold">Причина отклонения:</span> {r.rejectReason}
          </p>
        </div>
      )}

      {r.status === "rejected_final" && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
          <ShieldAlert className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span className="text-xs font-semibold text-red-700">Водитель заблокирован</span>
        </div>
      )}

      <div className="text-[11px] text-gray-400">
        {new Date(activeRecord.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
        {" · "}Время отправки фото
      </div>

      {rejectMode && (
        <div className="flex gap-1.5">
          <input
            ref={rejectInputRef}
            type="text"
            value={rejectReason}
            onChange={e => onSetRejectReason(e.target.value)}
            placeholder="Причина отклонения..."
            className="flex-1 border border-red-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
            autoFocus
            onKeyDown={e => {
              if (e.key === "Enter" && rejectReason.trim()) onSubmitReject(rejectReason);
              if (e.key === "Escape") onCancelReject();
            }}
          />
          <button
            onClick={() => { if (rejectReason.trim()) onSubmitReject(rejectReason); }}
            disabled={!rejectReason.trim() || reviewing}
            className="px-3 py-2 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 disabled:opacity-50">
            Откл.
          </button>
          <button onClick={onCancelReject}
            className="px-2 py-2 bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {canReview && !rejectMode && (
          <>
            <button
              onClick={onStartReject}
              disabled={reviewing}
              className="flex-1 flex items-center justify-center gap-1.5 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-xs font-bold hover:bg-gray-50 disabled:opacity-50 transition-all active:scale-[0.98]">
              Отклонить
            </button>
            <button
              onClick={onApprove}
              disabled={reviewing}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 text-white rounded-lg py-2.5 text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-all active:scale-[0.98]">
              {reviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Одобрить
            </button>
          </>
        )}
        {canUnblock && (
          <button
            onClick={onUnblock}
            disabled={reviewing}
            className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 text-white rounded-lg py-2.5 text-xs font-bold hover:bg-blue-700 disabled:opacity-50 transition-all active:scale-[0.98]">
            {reviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
            Разблокировать
          </button>
        )}
      </div>
    </div>
  );
}

function DetailPhoto({ label, url, aiResult, onClick }: {
  label: string; url: string | null; aiResult?: AIPhotoResult; onClick: () => void;
}) {
  const [error, setError] = useState(false);
  const src = resolvePhotoUrl(url);

  if (!url) {
    return (
      <div className="aspect-[4/3] rounded-lg bg-gray-100 border border-dashed border-gray-300 flex flex-col items-center justify-center gap-1">
        <Camera className="w-5 h-5 text-gray-300" />
        <span className="text-[10px] text-gray-400">{label}</span>
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] rounded-lg overflow-hidden border border-gray-200 cursor-pointer relative group" onClick={onClick}>
      {error ? (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
          <Image className="w-6 h-6 text-gray-300" />
        </div>
      ) : (
        <img src={src} alt={label} loading="lazy" onError={() => setError(true)}
          className="w-full h-full object-cover transition-transform group-hover:scale-105" />
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
        <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
      </div>
      <span className="absolute bottom-0 left-0 right-0 text-[10px] bg-black/50 text-white px-1.5 py-0.5 text-center font-medium">{label}</span>
      {aiResult && (
        <div className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow ${
          aiResult.aiStatus === "ok" ? "bg-emerald-500" : aiResult.aiStatus === "warning" ? "bg-yellow-500" : "bg-red-500"
        }`}>
          {aiResult.aiStatus === "ok" ? "✓" : aiResult.aiStatus === "warning" ? "!" : "✗"}
        </div>
      )}
    </div>
  );
}

function Lightbox({ urls, initialIndex, onClose }: { urls: string[]; initialIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex < 0 ? 0 : initialIndex);
  const [error, setError] = useState(false);
  const labels = ["Селфи", "Авто спереди", "Авто сзади", "Салон"];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex(i => Math.min(urls.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [urls.length, onClose]);

  useEffect(() => setError(false), [index]);

  let startX = 0;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center"
      onClick={onClose}
      onTouchStart={(e) => { startX = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        const diff = e.changedTouches[0].clientX - startX;
        if (Math.abs(diff) > 60) {
          if (diff < 0 && index < urls.length - 1) setIndex(index + 1);
          if (diff > 0 && index > 0) setIndex(index - 1);
        }
      }}>
      <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
        <X className="w-6 h-6 text-white" />
      </button>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1">
        {urls.map((_, i) => (
          <button key={i} onClick={(e) => { e.stopPropagation(); setIndex(i); }}
            className={`w-2 h-2 rounded-full transition-all ${i === index ? "bg-white w-6" : "bg-white/30 hover:bg-white/50"}`} />
        ))}
      </div>

      {index > 0 && (
        <button onClick={(e) => { e.stopPropagation(); setIndex(index - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
      )}
      {index < urls.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); setIndex(index + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
          <ChevronRight className="w-6 h-6 text-white" />
        </button>
      )}

      <div className="max-w-4xl max-h-[85vh] p-4" onClick={e => e.stopPropagation()}>
        {error ? (
          <div className="w-64 h-64 bg-white/5 rounded-2xl flex flex-col items-center justify-center gap-2">
            <Image className="w-10 h-10 text-white/30" />
            <span className="text-sm text-white/50">Не удалось загрузить</span>
          </div>
        ) : (
          <img src={urls[index]} alt={labels[index] || "Photo"} onError={() => setError(true)}
            className="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl" />
        )}
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white text-sm px-4 py-2 rounded-full">
        {labels[index] || `Фото ${index + 1}`} · {index + 1}/{urls.length}
      </div>
    </div>
  );
}

function TasksTab({ tasks, groups, showCreateTask, setShowCreateTask, newTask, setNewTask, createTask, sendTask, deleteTask, sending, toggleTaskActive }: any) {
  return (
    <div className="space-y-3 max-w-3xl">
      <button onClick={() => setShowCreateTask(!showCreateTask)}
        className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors">
        <Plus className="w-4 h-4" /> Новая задача
      </button>

      {showCreateTask && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <input value={newTask.name} onChange={(e: any) => setNewTask({ ...newTask, name: e.target.value })}
            placeholder="Название (напр. Утренний фотоконтроль)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Группа водителей</label>
              <select value={newTask.groupId} onChange={(e: any) => setNewTask({ ...newTask, groupId: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm">
                <option value="">Все водители</option>
                {groups.map((g: DriverGroup) => <option key={g.id} value={String(g.id)}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Расписание</label>
              <select value={newTask.scheduleType} onChange={(e: any) => setNewTask({ ...newTask, scheduleType: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm">
                <option value="manual">Вручную</option>
                <option value="daily">Ежедневно</option>
                <option value="weekly">Еженедельно</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createTask} className="px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700">Создать</button>
            <button onClick={() => setShowCreateTask(false)} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm hover:text-gray-900">Отмена</button>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Camera className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">Нет задач</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t: PhotoTask) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between hover:shadow-sm transition-shadow">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${t.isActive ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-500"}`}>
                    {t.isActive ? "Активна" : "Неактивна"}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1"><Users className="w-3 h-3" /> {t.groupLabel || "Все водители"}</span>
                  <span className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {SCHEDULE_LABELS[t.scheduleType]}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => sendTask(t.id)} disabled={sending === t.id}
                  className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors" title="Отправить">
                  {sending === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
                <button onClick={() => toggleTaskActive(t)}
                  className={`p-2 rounded-lg transition-colors ${t.isActive ? "bg-amber-50 text-amber-600 hover:bg-amber-100" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"}`}
                  title={t.isActive ? "Деактивировать" : "Активировать"}>
                  {t.isActive ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                </button>
                <button onClick={() => deleteTask(t.id)} className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors" title="Удалить">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
