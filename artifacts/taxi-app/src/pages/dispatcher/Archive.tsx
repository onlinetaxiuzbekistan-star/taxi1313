import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import DispatcherLayout from "./DispatcherLayout";
import { useAuth } from "@/hooks/use-auth";
import {
  Search, X, Download, ChevronLeft, ChevronRight, Filter,
  Calendar, Phone, Car, MapPin, Hash, Clock, User, ArrowUpDown,
  ArrowUp, ArrowDown, ExternalLink, Copy, Check, Loader2,
  FileText, DollarSign, Route, History, ChevronDown, AlertCircle,
  PhoneCall, UserCircle, RefreshCw, UserX, AlertTriangle, Timer,
  TrendingUp, CheckCircle2, XCircle, Navigation as NavigationIcon, Edit2,
  Plus, Send, ChevronUp
} from "lucide-react";
import { toast } from "sonner";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const STATUS_MAP: Record<string, { label: string; cls: string; dot: string }> = {
  pending:     { label: "Ожидает",    cls: "bg-amber-500/10 text-amber-700 border-amber-500/20",   dot: "bg-amber-500" },
  offered:     { label: "Предложен",  cls: "bg-indigo-500/10 text-indigo-700 border-indigo-500/20", dot: "bg-indigo-500" },
  accepted:    { label: "Принят",     cls: "bg-blue-500/10 text-blue-700 border-blue-500/20",      dot: "bg-blue-500" },
  in_progress: { label: "В пути",     cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20", dot: "bg-emerald-500" },
  completed:   { label: "Завершён",   cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20", dot: "bg-emerald-500" },
  cancelled:   { label: "Отменён",    cls: "bg-rose-500/10 text-rose-600 border-rose-500/20",      dot: "bg-rose-500" },
  merged:     { label: "Объединён",   cls: "bg-violet-500/10 text-violet-700 border-violet-500/20",  dot: "bg-violet-500" },
};

const CITY_OPTIONS = [
  "Ташкент", "Самарканд", "Бухара", "Фергана", "Наманган",
  "Андижан", "Нукус", "Ургенч", "Карши", "Термез", "Джиззак", "Навои", "Гулистан",
];

const CAR_CLASSES = [
  { id: "economy", label: "Эконом" },
  { id: "comfort", label: "Комфорт" },
  { id: "business", label: "Бизнес" },
];

const CITY_PREFIX: Record<string, string> = {
  "Ташкент": "TAS", "Самарканд": "SAM", "Бухара": "BUX", "Фергана": "FER",
  "Андижан": "AND", "Наманган": "NAM", "Нукус": "NUK", "Карши": "KAR",
  "Навои": "NAV", "Термез": "TER", "Гулистан": "GUL", "Джиззак": "JIZ", "Ургенч": "URG",
};

function fmt(n: number) { return Math.round(n).toLocaleString("ru-RU"); }

function fmtDate(d: string | Date | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) +
    " " + dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function fmtTime(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function getCallsign(driverId: number | null, city?: string | null): string {
  if (!driverId) return "—";
  const pfx = city ? (CITY_PREFIX[city] || "BT") : "BT";
  return `${pfx}-${String(driverId).padStart(3, "0")}`;
}

function diffMinutes(a: string | Date | null, b: string | Date | null): string {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1 мин";
  if (mins < 60) return `${mins} мин`;
  return `${Math.floor(mins / 60)}ч ${mins % 60}м`;
}

interface Filters {
  search: string;
  status: string;
  fromCity: string;
  toCity: string;
  carClass: string;
  source: string;
  dateFrom: string;
  dateTo: string;
  clientPhone: string;
  driverName: string;
  driverCarNumber: string;
  orderId: string;
  noDriver: boolean;
  problemOrders: boolean;
}

const emptyFilters: Filters = {
  search: "", status: "", fromCity: "", toCity: "", carClass: "",
  source: "", dateFrom: "", dateTo: "", clientPhone: "",
  driverName: "", driverCarNumber: "", orderId: "", noDriver: false, problemOrders: false,
};

function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }
function getToday() { return toDateStr(new Date()); }
function getYesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return toDateStr(d); }
function get7DaysAgo() { const d = new Date(); d.setDate(d.getDate() - 7); return toDateStr(d); }

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

interface ArchiveStats {
  completed: number;
  cancelled: number;
  revenue: number;
  problemCount: number;
  avgDurationMin: number;
}

export default function Archive() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage] = useState(30);
  const [sort, setSort] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [rides, setRides] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ArchiveStats>({ completed: 0, cancelled: 0, revenue: 0, problemCount: 0, avgDurationMin: 0 });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedRide, setSelectedRide] = useState<any | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "history" | "finance" | "timing" | "accounting">("details");
  const tableRef = useRef<HTMLDivElement>(null);

  const debouncedSearch = useDebounce(filters.search, 300);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (filters.status) c++;
    if (filters.fromCity) c++;
    if (filters.toCity) c++;
    if (filters.carClass) c++;
    if (filters.source) c++;
    if (filters.dateFrom) c++;
    if (filters.dateTo) c++;
    if (filters.clientPhone) c++;
    if (filters.driverName) c++;
    if (filters.driverCarNumber) c++;
    if (filters.orderId) c++;
    if (filters.noDriver) c++;
    if (filters.problemOrders) c++;
    return c;
  }, [filters]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filters.status) params.set("status", filters.status);
    if (filters.fromCity) params.set("fromCity", filters.fromCity);
    if (filters.toCity) params.set("toCity", filters.toCity);
    if (filters.carClass) params.set("carClass", filters.carClass);
    if (filters.source) params.set("source", filters.source);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.clientPhone) params.set("clientPhone", filters.clientPhone);
    if (filters.driverName) params.set("driverName", filters.driverName);
    if (filters.driverCarNumber) params.set("driverCarNumber", filters.driverCarNumber);
    if (filters.orderId) params.set("orderId", filters.orderId);
    if (filters.noDriver) params.set("noDriver", "true");
    if (filters.problemOrders) params.set("problemOrders", "true");
    return params;
  }, [debouncedSearch, filters]);

  const fetchRides = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      params.set("page", String(page));
      params.set("perPage", String(perPage));
      params.set("sort", sort);
      params.set("sortDir", sortDir);

      const res = await fetch(`${BASE_URL}/api/rides/archive?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setRides(data.rides || []);
      setTotal(data.total || 0);
      setStats({
        completed: data.completed || 0,
        cancelled: data.cancelled || 0,
        revenue: data.revenue || 0,
        problemCount: data.problemCount || 0,
        avgDurationMin: data.avgDurationMin || 0,
      });
    } catch {
      toast.error("Ошибка загрузки архива");
    }
    setLoading(false);
  }, [token, page, perPage, sort, sortDir, buildParams]);

  useEffect(() => { fetchRides(); }, [fetchRides]);
  useEffect(() => { setPage(1); }, [debouncedSearch, filters.status, filters.fromCity, filters.toCity, filters.carClass, filters.source, filters.dateFrom, filters.dateTo, filters.clientPhone, filters.driverName, filters.driverCarNumber, filters.orderId, filters.noDriver, filters.problemOrders]);

  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { if (!loadingRef.current) fetchRides(); }, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchRides]);

  const totalPages = Math.ceil(total / perPage);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = buildParams();
      const res = await fetch(`${BASE_URL}/api/rides/archive/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `archive_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Файл экспортирован");
    } catch {
      toast.error("Ошибка экспорта");
    }
    setExporting(false);
  };

  const toggleSort = (field: string) => {
    if (sort === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSort(field); setSortDir("desc"); }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sort !== field) return <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />;
  };

  const clearFilters = () => { setFilters(emptyFilters); setPage(1); };

  return (
    <DispatcherLayout>
      <div className="flex flex-col h-[calc(100vh-56px)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/50 px-4 lg:px-6 py-3 space-y-3">
          <div className="flex items-center justify-between gap-4 max-w-[1600px] mx-auto">
            <div>
              <h1 className="text-xl font-extrabold text-foreground">Архив заказов</h1>
              <p className="text-xs text-muted-foreground mt-0.5">{fmt(total)} записей</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchRides}
                disabled={loading}
                className="w-9 h-9 rounded-xl flex items-center justify-center bg-card border border-border hover:bg-muted transition-all disabled:opacity-50"
                title="Обновить"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={() => setAutoRefresh(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${autoRefresh ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" : "bg-card text-muted-foreground border-border hover:bg-muted"}`}
                title={autoRefresh ? "Выключить авто-обновление" : "Авто-обновление (10с)"}
              >
                <div className={`w-2 h-2 rounded-full ${autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`} />
                Авто
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || total === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span className="hidden sm:inline">Экспорт</span>
              </button>
            </div>
          </div>

          <div className="max-w-[1600px] mx-auto grid grid-cols-2 lg:grid-cols-5 gap-2">
            <StatCard label="Всего" value={fmt(total)} icon={FileText} color="text-foreground" bg="bg-muted/50" />
            <StatCard label="Завершено" value={fmt(stats.completed)} icon={CheckCircle2} color="text-emerald-600" bg="bg-emerald-500/10" />
            <StatCard label="Отменено" value={fmt(stats.cancelled)} icon={XCircle} color="text-rose-600" bg="bg-rose-500/10" />
            <StatCard label="Выручка" value={`${fmt(stats.revenue)} сум`} icon={TrendingUp} color="text-blue-600" bg="bg-blue-500/10" />
            <StatCard label="Ср. время" value={stats.avgDurationMin > 0 ? `${stats.avgDurationMin} мин` : "—"} icon={Timer} color="text-violet-600" bg="bg-violet-500/10" />
          </div>

          <div className="max-w-[1600px] mx-auto space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                  placeholder="Телефон, позывной, номер авто..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {filters.search && (
                  <button onClick={() => setFilters(f => ({ ...f, search: "" }))} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all ${
                  activeFilterCount > 0
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-card border-border text-foreground hover:bg-muted"
                }`}
              >
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline">Фильтры</span>
                {activeFilterCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">{activeFilterCount}</span>
                )}
              </button>

              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground underline">
                  Сбросить
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {([
                { label: "Сегодня", key: "today", from: getToday(), to: getToday() },
                { label: "Вчера", key: "yesterday", from: getYesterday(), to: getYesterday() },
                { label: "7 дней", key: "week", from: get7DaysAgo(), to: getToday() },
              ] as const).map(({ label, key, from, to }) => {
                const active = filters.dateFrom === from && filters.dateTo === to;
                return (
                  <button
                    key={key}
                    onClick={() => setFilters(f => active ? { ...f, dateFrom: "", dateTo: "" } : { ...f, dateFrom: from, dateTo: to })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 ${
                      active ? "bg-blue-500/20 text-blue-600 border border-blue-500/30" : "bg-card border border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Calendar className="w-3 h-3" />
                    {label}
                  </button>
                );
              })}

              <span className="w-px h-4 bg-border mx-0.5" />

              {["", "completed", "cancelled"].map((s, i) => {
                const labels = ["Все", "Завершённые", "Отменённые"];
                const active = filters.status === s && !filters.noDriver && !filters.problemOrders;
                return (
                  <button
                    key={`status-${s}`}
                    onClick={() => setFilters(f => ({ ...f, status: active ? "" : s, noDriver: false, problemOrders: false }))}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                      active ? "bg-primary text-white shadow-sm" : "bg-card border border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {labels[i]}
                  </button>
                );
              })}

              <span className="w-px h-4 bg-border mx-0.5" />

              <button
                onClick={() => setFilters(f => ({ ...f, noDriver: !f.noDriver, status: "", problemOrders: false }))}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 ${
                  filters.noDriver ? "bg-rose-500/20 text-rose-600 border border-rose-500/30" : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <UserX className="w-3 h-3" />
                Без водителя
              </button>

              <button
                onClick={() => setFilters(f => ({ ...f, problemOrders: !f.problemOrders, status: "", noDriver: false }))}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 ${
                  filters.problemOrders ? "bg-amber-500/20 text-amber-600 border border-amber-500/30" : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
                Проблемные
                {stats.problemCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">{stats.problemCount > 99 ? "99+" : stats.problemCount}</span>
                )}
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="max-w-[1600px] mx-auto bg-card border border-border rounded-2xl p-4 shadow-sm">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                <FilterInput label="ID заказа" icon={Hash} value={filters.orderId} onChange={v => setFilters(f => ({ ...f, orderId: v }))} placeholder="12345" type="number" />
                <FilterInput label="Телефон клиента" icon={Phone} value={filters.clientPhone} onChange={v => setFilters(f => ({ ...f, clientPhone: v }))} placeholder="+998..." />
                <FilterInput label="Водитель" icon={User} value={filters.driverName} onChange={v => setFilters(f => ({ ...f, driverName: v }))} placeholder="Имя водителя" />
                <FilterInput label="Гос. номер" icon={Car} value={filters.driverCarNumber} onChange={v => setFilters(f => ({ ...f, driverCarNumber: v }))} placeholder="01A001AA" />
                <FilterSelect label="Откуда" value={filters.fromCity} onChange={v => setFilters(f => ({ ...f, fromCity: v }))} options={CITY_OPTIONS.map(c => ({ value: c, label: c }))} />
                <FilterSelect label="Куда" value={filters.toCity} onChange={v => setFilters(f => ({ ...f, toCity: v }))} options={CITY_OPTIONS.map(c => ({ value: c, label: c }))} />
                <FilterSelect label="Тариф" value={filters.carClass} onChange={v => setFilters(f => ({ ...f, carClass: v }))} options={CAR_CLASSES.map(c => ({ value: c.id, label: c.label }))} />
                <FilterSelect label="Источник" value={filters.source} onChange={v => setFilters(f => ({ ...f, source: v }))} options={[{ value: "dispatch", label: "Оператор" }, { value: "app", label: "Приложение" }, { value: "marketplace", label: "Маркетплейс" }]} />
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Дата от</label>
                  <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Дата до</label>
                  <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div ref={tableRef} className={`flex-1 overflow-auto transition-all ${selectedRide ? "lg:w-[calc(100%-380px)]" : "w-full"}`}>
          <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-3">
            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <Th field="createdAt" label="Время" sort={sort} onClick={toggleSort}><SortIcon field="createdAt" /></Th>
                      <Th field="id" label="ID" sort={sort} onClick={toggleSort}><SortIcon field="id" /></Th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Клиент</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Маршрут</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Водитель</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Авто</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Тариф</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Статус</th>
                      <Th field="price" label="Цена" sort={sort} onClick={toggleSort}><SortIcon field="price" /></Th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold text-muted-foreground uppercase tracking-wider w-[130px]">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {loading ? (
                      <tr><td colSpan={10} className="px-6 py-16 text-center">
                        <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">Загрузка...</p>
                      </td></tr>
                    ) : rides.length === 0 ? (
                      <tr><td colSpan={10} className="px-6 py-16 text-center">
                        <AlertCircle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-sm font-semibold text-muted-foreground">Нет записей</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">Попробуйте изменить фильтры</p>
                      </td></tr>
                    ) : rides.map(r => {
                      const st = STATUS_MAP[r.status] || STATUS_MAP.pending;
                      const tariffLabel = CAR_CLASSES.find(c => c.id === r.carClass)?.label || r.carClass;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelectedRide(r)}
                          onDoubleClick={() => { setSelectedRide(r); setDetailTab("accounting"); }}
                          className={`hover:bg-primary/5 cursor-pointer transition-colors group ${selectedRide?.id === r.id ? "bg-primary/10 ring-1 ring-primary/20" : ""}`}
                        >
                          <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                          <td className="px-3 py-2.5 font-mono text-xs font-bold text-primary">#{r.id}</td>
                          <td className="px-3 py-2.5">
                            <div className="text-xs font-semibold text-foreground truncate max-w-[120px]">{r.riderName || "—"}</div>
                            {r.riderPhone && <div className="text-[10px] text-muted-foreground">{r.riderPhone}</div>}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-xs font-medium text-foreground truncate max-w-[200px]">
                              {r.fromCity} → {r.toCity}
                            </div>
                            {(r.fromAddress || r.toAddress) && (
                              <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                                {r.fromAddress || ""} → {r.toAddress || ""}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="text-xs font-semibold text-foreground truncate max-w-[120px]">{r.driverName || "—"}</div>
                            {r.driverId && (
                              <div className="text-[10px] font-mono text-primary/70">{getCallsign(r.driverId, r.fromCity)}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{r.driverCarNumber || "—"}</td>
                          <td className="px-3 py-2.5">
                            <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-bold text-muted-foreground">{tariffLabel}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${st.cls}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                              {st.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs font-bold text-foreground whitespace-nowrap">{r.price ? fmt(r.price) + " сум" : "—"}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1 justify-end opacity-50 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                              {r.riderPhone && (
                                <a
                                  href={`tel:${r.riderPhone}`}
                                  title="Позвонить клиенту"
                                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-blue-500/10 text-muted-foreground hover:text-blue-600 transition-colors"
                                >
                                  <PhoneCall className="w-3.5 h-3.5" />
                                </a>
                              )}
                              {r.driverId && (
                                <button
                                  onClick={() => navigate(`/management/drivers?highlight=${r.driverId}`)}
                                  title="Профиль водителя"
                                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600 transition-colors"
                                >
                                  <UserCircle className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => navigate(`/management?repeat=${r.id}`)}
                                title="Повторить заказ"
                                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-amber-500/10 text-muted-foreground hover:text-amber-600 transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedRide(r); setDetailTab("accounting"); }}
                                title="Детали"
                                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-600 transition-colors"
                              >
                                <NavigationIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
                  <p className="text-xs text-muted-foreground">
                    {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)} из {fmt(total)}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setPage(p => Math.max(1, p - 1)); tableRef.current?.scrollTo(0, 0); }}
                      disabled={page <= 1}
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-card border border-border hover:bg-muted disabled:opacity-30 transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    {getPaginationRange(page, totalPages).map((p, i) =>
                      p === "..." ? (
                        <span key={`dots-${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-muted-foreground">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => { setPage(p as number); tableRef.current?.scrollTo(0, 0); }}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold transition-all ${
                            page === p ? "bg-primary text-white shadow-sm" : "bg-card border border-border hover:bg-muted"
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )}
                    <button
                      onClick={() => { setPage(p => Math.min(totalPages, p + 1)); tableRef.current?.scrollTo(0, 0); }}
                      disabled={page >= totalPages}
                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-card border border-border hover:bg-muted disabled:opacity-30 transition-all"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

          {selectedRide && (
            <RightPanel
              ride={selectedRide}
              token={token || ""}
              onClose={() => setSelectedRide(null)}
              onDriverClick={(id: number) => navigate(`/management/drivers?highlight=${id}`)}
              onRepeat={(id: number) => navigate(`/management?repeat=${id}`)}
              onRideUpdated={(updated: any) => {
                setSelectedRide((prev: any) => prev ? { ...prev, ...updated } : prev);
                setRides(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
              }}
              onRefreshList={fetchRides}
            />
          )}
        </div>

      {selectedRide && detailTab !== "details" && (
        <OrderDetailModal
          ride={selectedRide}
          tab={detailTab}
          setTab={setDetailTab}
          onClose={() => setDetailTab("details")}
          onDriverClick={(id: number) => { navigate(`/management/drivers?highlight=${id}`); }}
          onClientClick={(phone: string) => {
            setFilters(f => ({ ...f, clientPhone: phone }));
          }}
        />
      )}
      </div>
    </DispatcherLayout>
  );
}

function StatCard({ label, value, icon: Icon, color, bg }: {
  label: string; value: string; icon: any; color: string; bg: string;
}) {
  return (
    <div className={`${bg} rounded-xl px-3 py-2 border border-border/50 flex items-center gap-2.5`}>
      <Icon className={`w-4 h-4 ${color} shrink-0`} />
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider truncate">{label}</p>
        <p className={`text-sm font-extrabold ${color} truncate`}>{value}</p>
      </div>
    </div>
  );
}

function FilterInput({ label, icon: Icon, value, onChange, placeholder, type = "text" }: {
  label: string; icon: any; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      <div className="relative">
        <Icon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {value && (
          <button onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2">
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
      >
        <option value="">Все</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Th({ field, label, sort, onClick, children }: {
  field: string; label: string; sort: string; onClick: (f: string) => void; children: React.ReactNode;
}) {
  return (
    <th
      className="px-3 py-2.5 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
      onClick={() => onClick(field)}
    >
      <span className="inline-flex items-center gap-1">{label} {children}</span>
    </th>
  );
}

function getPaginationRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | "...")[] = [1];
  if (current > 3) items.push("...");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) items.push(i);
  if (current < total - 2) items.push("...");
  items.push(total);
  return items;
}

function OrderDetailModal({ ride, tab, setTab, onClose, onDriverClick, onClientClick }: {
  ride: any;
  tab: "details" | "history" | "finance" | "timing" | "accounting";
  setTab: (t: "details" | "history" | "finance" | "timing" | "accounting") => void;
  onClose: () => void;
  onDriverClick: (id: number) => void;
  onClientClick: (phone: string) => void;
}) {
  const st = STATUS_MAP[ride.status] || STATUS_MAP.pending;
  const tariffLabel = CAR_CLASSES.find(c => c.id === ride.carClass)?.label || ride.carClass;

  const tabs = [
    { id: "details" as const, label: "Детали", icon: FileText },
    { id: "history" as const, label: "Хронология", icon: History },
    { id: "finance" as const, label: "Финансы", icon: DollarSign },
    { id: "timing" as const, label: "Тайминг", icon: Timer },
    { id: "accounting" as const, label: "Бухгалтерия", icon: Hash },
  ];

  const [commRate, setCommRate] = useState(15);
  useEffect(() => {
    const token = localStorage.getItem("authToken");
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/settings?category=finance`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          const cp = data.settings?.find((s: any) => s.key === "commission_percent");
          if (cp) setCommRate(parseFloat(cp.value) || 15);
        }
      } catch {}
    })();
  }, []);
  const computedComm = ride.price ? Math.round(ride.price * commRate / 100) : 0;
  const commission = ride.commission != null ? ride.commission : computedComm;
  const driverPayout = ride.driverPayout != null ? ride.driverPayout : (ride.price ? ride.price - commission : 0);

  const events = [
    { time: ride.createdAt, label: "Заказ создан", status: "pending" },
    ride.status !== "pending" && ride.status !== "cancelled" && { time: ride.createdAt, label: "Предложен водителю", status: "offered" },
    (ride.status === "accepted" || ride.status === "in_progress" || ride.status === "completed") && { time: ride.updatedAt, label: `Принят: ${ride.driverName || "Водитель"}`, status: "accepted" },
    ride.status === "in_progress" && { time: ride.updatedAt, label: "В пути", status: "in_progress" },
    ride.status === "completed" && { time: ride.updatedAt, label: "Завершён", status: "completed" },
    ride.status === "cancelled" && { time: ride.updatedAt, label: "Отменён", status: "cancelled" },
  ].filter(Boolean) as { time: string; label: string; status: string }[];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="text-lg font-extrabold text-foreground font-mono">#{ride.id}</span>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold ${st.cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
              {st.label}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-bold text-muted-foreground">{tariffLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            {ride.riderPhone && (
              <a href={`tel:${ride.riderPhone}`} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-blue-500/10 text-muted-foreground hover:text-blue-600 transition-colors" title="Позвонить">
                <PhoneCall className="w-4 h-4" />
              </a>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-border">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-bold transition-colors ${
                  tab === t.id
                    ? "text-primary border-b-2 border-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-5 overflow-y-auto max-h-[60vh]">
          {tab === "details" && (
            <div className="space-y-4">
              <DetailSection title="Маршрут">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center mt-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-emerald-200" />
                    <div className="w-0.5 h-8 bg-border" />
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-rose-200" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{ride.fromCity}</p>
                      {ride.fromAddress && <p className="text-xs text-muted-foreground">{ride.fromAddress}</p>}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{ride.toCity}</p>
                      {ride.toAddress && <p className="text-xs text-muted-foreground">{ride.toAddress}</p>}
                    </div>
                  </div>
                </div>
              </DetailSection>

              <div className="grid grid-cols-2 gap-4">
                <DetailSection title="Клиент">
                  {ride.riderName && <p className="text-sm font-semibold text-foreground">{ride.riderName}</p>}
                  {ride.riderPhone && (
                    <button
                      onClick={() => onClientClick(ride.riderPhone)}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Phone className="w-3 h-3" />
                      {ride.riderPhone}
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">Пассажиров: {ride.passengers || 1}</p>
                </DetailSection>

                <DetailSection title="Водитель">
                  {ride.driverName ? (
                    <>
                      <button
                        onClick={() => ride.driverId && onDriverClick(ride.driverId)}
                        className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"
                      >
                        {ride.driverName}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                      {ride.driverPhone && <p className="text-xs text-muted-foreground">{ride.driverPhone}</p>}
                      <p className="text-xs font-mono text-primary/70 mt-0.5">{getCallsign(ride.driverId, ride.fromCity)}</p>
                      {ride.driverCar && <p className="text-xs text-muted-foreground">{ride.driverCar} {ride.driverCarNumber}</p>}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Не назначен</p>
                  )}
                </DetailSection>
              </div>

              <DetailSection title="Информация">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <InfoRow label="Создан" value={fmtDate(ride.createdAt)} />
                  <InfoRow label="Обновлён" value={fmtDate(ride.updatedAt)} />
                  <InfoRow label="Назначен на" value={fmtDate(ride.scheduledAt)} />
                  <InfoRow label="Оплата" value={ride.paymentType === "cash" ? "Наличные" : ride.paymentType === "card" ? "Карта" : "Перевод"} />
                  <InfoRow label="Источник" value={ride.source === "app" ? "Приложение" : ride.source === "marketplace" ? "Маркетплейс" : "Оператор"} />
                  {ride.isUrgent && <InfoRow label="Срочный" value="Да" />}
                  {ride.roundTrip && <InfoRow label="Туда-обратно" value="Да" />}
                  {ride.comment && <div className="col-span-2"><InfoRow label="Комментарий" value={ride.comment} /></div>}
                </div>
              </DetailSection>
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-0">
              {events.map((ev, i) => {
                const evSt = STATUS_MAP[ev.status] || STATUS_MAP.pending;
                return (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full ${evSt.dot} ring-4 ring-card`} />
                      {i < events.length - 1 && <div className="w-0.5 flex-1 bg-border min-h-[32px]" />}
                    </div>
                    <div className="pb-4">
                      <p className="text-sm font-semibold text-foreground">{ev.label}</p>
                      <p className="text-[10px] text-muted-foreground">{fmtDate(ev.time)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "finance" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FinanceCard label="Цена поездки" value={`${fmt(ride.price || 0)} сум`} icon={DollarSign} color="text-foreground" bg="bg-muted" />
                <FinanceCard label="Базовая цена" value={`${fmt(ride.basePrice || ride.price || 0)} сум`} icon={FileText} color="text-blue-600" bg="bg-blue-500/10" />
                <FinanceCard label="Выплата водителю" value={`${fmt(driverPayout)} сум`} icon={User} color="text-emerald-600" bg="bg-emerald-500/10" />
                <FinanceCard label={`Комиссия (${commRate}%)`} value={`${fmt(commission)} сум`} icon={DollarSign} color="text-amber-600" bg="bg-amber-500/10" />
              </div>

              <DetailSection title="Доп. информация">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <InfoRow label="Способ оплаты" value={ride.paymentType === "cash" ? "Наличные" : ride.paymentType === "card" ? "Карта" : "Перевод"} />
                  {ride.distance && <InfoRow label="Дистанция" value={`${ride.distance} км`} />}
                  {ride.duration && <InfoRow label="Время пути" value={`${ride.duration} мин`} />}
                  {ride.fromDistrictCharge > 0 && <InfoRow label="Доплата (р-н отправления)" value={`${fmt(ride.fromDistrictCharge)} сум`} />}
                  {ride.toDistrictCharge > 0 && <InfoRow label="Доплата (р-н прибытия)" value={`${fmt(ride.toDistrictCharge)} сум`} />}
                </div>
              </DetailSection>
            </div>
          )}

          {tab === "timing" && (
            <div className="space-y-4">
              <DetailSection title="Длительности статусов">
                <div className="space-y-3">
                  <TimingRow label="Создание → Назначение" value={diffMinutes(ride.createdAt, ride.acceptedAt || ride.updatedAt)} status="pending" />
                  {(ride.status === "in_progress" || ride.status === "completed") && (
                    <TimingRow label="Назначение → В пути" value={diffMinutes(ride.acceptedAt || ride.createdAt, ride.startedAt || ride.updatedAt)} status="accepted" />
                  )}
                  {ride.status === "completed" && (
                    <TimingRow label="В пути → Завершение" value={diffMinutes(ride.startedAt || ride.createdAt, ride.completedAt || ride.updatedAt)} status="in_progress" />
                  )}
                  <div className="border-t border-border pt-3 mt-3">
                    <TimingRow label="Общее время" value={diffMinutes(ride.createdAt, ride.completedAt || ride.updatedAt)} status="completed" bold />
                  </div>
                </div>
              </DetailSection>

              <DetailSection title="Метки времени">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <InfoRow label="Создан" value={fmtDate(ride.createdAt)} />
                  {ride.acceptedAt && <InfoRow label="Принят" value={fmtDate(ride.acceptedAt)} />}
                  {ride.startedAt && <InfoRow label="Выехал" value={fmtDate(ride.startedAt)} />}
                  {ride.completedAt && <InfoRow label="Завершён" value={fmtDate(ride.completedAt)} />}
                  <InfoRow label="Обновлён" value={fmtDate(ride.updatedAt)} />
                  {ride.scheduledAt && <InfoRow label="Запланирован" value={fmtDate(ride.scheduledAt)} />}
                </div>
              </DetailSection>
            </div>
          )}

          {tab === "accounting" && (
            <AccountingTab rideId={ride.id} />
          )}
        </div>
      </div>
    </div>
  );
}

function RightPanel({ ride, token, onClose, onDriverClick, onRepeat, onRideUpdated, onRefreshList }: {
  ride: any;
  token: string;
  onClose: () => void;
  onDriverClick: (id: number) => void;
  onRepeat: (id: number) => void;
  onRideUpdated: (updated: any) => void;
  onRefreshList: () => void;
}) {
  const st = STATUS_MAP[ride.status] || STATUS_MAP.pending;
  const tariffLabel = CAR_CLASSES.find(c => c.id === ride.carClass)?.label || ride.carClass;

  const [commissionPercent, setCommissionPercent] = useState(15);
  const [txs, setTxs] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [showAddTx, setShowAddTx] = useState(false);
  const [txType, setTxType] = useState("adjust");
  const [txAmount, setTxAmount] = useState("");
  const [txComment, setTxComment] = useState("");
  const [txSaving, setTxSaving] = useState(false);
  const [editPrice, setEditPrice] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [priceSaving, setPriceSaving] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [availableDrivers, setAvailableDrivers] = useState<any[]>([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [assigningDriver, setAssigningDriver] = useState<number | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);
  const [corrNewPrice, setCorrNewPrice] = useState("");
  const [corrNewComm, setCorrNewComm] = useState("");
  const [corrComment, setCorrComment] = useState("");
  const [corrSaving, setCorrSaving] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setPanelVisible(true)); }, []);

  const computedCommission = ride.price ? Math.round(ride.price * commissionPercent / 100) : 0;
  const commission = ride.commission != null ? ride.commission : computedCommission;
  const driverPayout = ride.driverPayout != null ? ride.driverPayout : (ride.price ? ride.price - commission : 0);

  const isCompleted = ride.status === "completed";
  const isCancelled = ride.status === "cancelled";
  const isFinished = isCompleted || isCancelled;
  const canEditPrice = !isFinished;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/settings?category=finance`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const cp = data.settings?.find((s: any) => s.key === "commission_percent");
          if (cp) setCommissionPercent(parseFloat(cp.value) || 15);
        }
      } catch {}
    })();
  }, [token]);

  const fetchTxs = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/rides/${ride.id}/transactions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTxs(data.transactions || []);
      }
    } catch { toast.error("Ошибка загрузки проводок"); }
    setTxLoading(false);
  }, [ride.id, token]);

  useEffect(() => { setTxLoading(true); fetchTxs(); }, [fetchTxs]);

  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (!data) return;
      if (data.type === "ride_updated" && data.ride?.id === ride.id) {
        onRideUpdated(data.ride);
      }
      if (data.type === "transaction_added" && data.rideId === ride.id) {
        fetchTxs();
      }
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, [ride.id, fetchTxs, onRideUpdated]);

  const handleAddTx = async () => {
    if (!txAmount) return;
    setTxSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/rides/${ride.id}/transactions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: txType, amount: parseFloat(txAmount), comment: txComment }),
      });
      if (res.ok) {
        toast.success("Проводка добавлена");
        setShowAddTx(false);
        setTxAmount("");
        setTxComment("");
        fetchTxs();
      } else {
        const data = await res.json();
        toast.error(data.message || "Ошибка");
      }
    } catch { toast.error("Ошибка сети"); }
    setTxSaving(false);
  };

  const handleEditPrice = async () => {
    if (!newPrice || isFinished) return;
    setPriceSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/rides/${ride.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ price: parseFloat(newPrice) }),
      });
      if (res.ok) {
        const updated = await res.json();
        onRideUpdated({ id: ride.id, price: parseFloat(newPrice) });
        toast.success("Цена обновлена");
        setEditPrice(false);
        setNewPrice("");
      } else {
        const data = await res.json();
        toast.error(data.message || "Ошибка");
      }
    } catch { toast.error("Ошибка сети"); }
    setPriceSaving(false);
  };

  const handleCorrection = async () => {
    if (!corrNewPrice && !corrNewComm) return;
    const parsedPrice = corrNewPrice ? parseFloat(corrNewPrice) : NaN;
    const parsedComm = corrNewComm ? parseFloat(corrNewComm) : NaN;
    if (corrNewPrice && (isNaN(parsedPrice) || parsedPrice < 0)) { toast.error("Некорректная цена"); return; }
    if (corrNewComm && (isNaN(parsedComm) || parsedComm < 0)) { toast.error("Некорректная комиссия"); return; }
    setCorrSaving(true);
    try {
      const corrections: Promise<Response>[] = [];
      const desc = corrComment || "Корректировка";
      if (corrNewPrice && !isNaN(parsedPrice)) {
        const priceDiff = parsedPrice - (ride.price || 0);
        if (priceDiff !== 0) {
          corrections.push(fetch(`${BASE_URL}/api/rides/${ride.id}/transactions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ type: "adjust", amount: priceDiff, comment: `${desc}: цена ${fmt(ride.price || 0)} → ${fmt(parsedPrice)}` }),
          }));
        }
      }
      if (corrNewComm && !isNaN(parsedComm)) {
        const oldComm = commission;
        const newCommVal = parsedComm;
        const commDiff = -(newCommVal - oldComm);
        if (commDiff !== 0) {
          corrections.push(fetch(`${BASE_URL}/api/rides/${ride.id}/transactions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ type: "adjust", amount: commDiff, comment: `${desc}: комиссия ${fmt(oldComm)} → ${fmt(newCommVal)}` }),
          }));
        }
      }
      if (corrections.length > 0) {
        const results = await Promise.all(corrections);
        const allOk = results.every(r => r.ok);
        if (!allOk) {
          toast.error("Часть корректировок не сохранена");
        } else {
          toast.success("Корректировка создана");
        }
        setShowCorrection(false);
        setCorrNewPrice("");
        setCorrNewComm("");
        setCorrComment("");
        fetchTxs();
      } else {
        toast.info("Нет изменений для корректировки");
      }
    } catch { toast.error("Ошибка сети"); }
    setCorrSaving(false);
  };

  const loadDrivers = async () => {
    setDriversLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/by-route?fromCity=${encodeURIComponent(ride.fromCity)}&toCity=${encodeURIComponent(ride.toCity)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.drivers || []).map((item: any) => ({
          id: item.driver?.id,
          name: item.driver?.name || "—",
          phone: item.driver?.phone,
          carModel: item.driver?.carModel || "",
          carNumber: item.driver?.carNumber || "",
          carClass: item.driver?.carClass,
          seatsFree: item.seatsFree ?? 4,
          ride: item.ride,
        }));
        setAvailableDrivers(mapped);
      }
    } catch { toast.error("Ошибка загрузки водителей"); }
    setDriversLoading(false);
  };

  const handleAssignDriver = async (driverId: number) => {
    setAssigningDriver(driverId);
    try {
      const res = await fetch(`${BASE_URL}/api/dispatcher/assign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rideId: ride.id, driverId }),
      });
      if (res.ok) {
        const updated = await res.json();
        toast.success("Заказ отправлен водителю");
        setShowAssign(false);
        onRideUpdated({ id: ride.id, ...updated });
        onRefreshList();
      } else {
        const data = await res.json();
        toast.error(data.message || "Ошибка назначения");
      }
    } catch { toast.error("Ошибка сети"); }
    setAssigningDriver(null);
  };

  const isNoDriver = !ride.driverId;
  const isLongWait = ride.status === "pending" && (Date.now() - new Date(ride.createdAt).getTime()) > 30 * 60000;
  const hasProblem = isNoDriver || isCancelled || isLongWait;

  const assignTime = ride.acceptedAt ? diffMinutes(ride.createdAt, ride.acceptedAt) : null;
  const rideTime = ride.startedAt && (ride.completedAt || ride.status === "in_progress")
    ? diffMinutes(ride.startedAt, ride.completedAt || new Date().toISOString()) : null;
  const totalTime = diffMinutes(ride.createdAt, ride.completedAt || ride.updatedAt);

  const txTotal = txs.reduce((s, t) => s + parseFloat(t.amount || "0"), 0);

  const handleClose = () => {
    setPanelVisible(false);
    setTimeout(onClose, 200);
  };

  return (
    <div className={`hidden lg:flex w-[380px] shrink-0 border-l border-border bg-background flex-col overflow-hidden transition-all duration-200 ${panelVisible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}`}>
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 backdrop-blur-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base font-extrabold font-mono text-foreground">#{ride.id}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${st.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
            {st.label}
          </span>
          <span className="px-1.5 py-0.5 rounded-md bg-muted text-[9px] font-bold text-muted-foreground">{tariffLabel}</span>
        </div>
        <button onClick={handleClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {hasProblem && (
          <div className={`rounded-xl px-3 py-2 border flex items-center gap-2 ${isCancelled ? "bg-rose-500/10 border-rose-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
            <AlertTriangle className={`w-4 h-4 shrink-0 ${isCancelled ? "text-rose-500" : "text-amber-500"}`} />
            <span className={`text-xs font-bold ${isCancelled ? "text-rose-600" : "text-amber-600"}`}>
              {isCancelled ? "Отменён" : isNoDriver ? "Водитель не назначен" : "Долгое ожидание (>30 мин)"}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {ride.riderPhone && (
            <a href={`tel:${ride.riderPhone}`} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 text-[11px] font-bold hover:bg-blue-500/20 transition-colors">
              <PhoneCall className="w-3.5 h-3.5" /> Клиент
            </a>
          )}
          {ride.driverId && (
            <button onClick={() => onDriverClick(ride.driverId)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 text-[11px] font-bold hover:bg-emerald-500/20 transition-colors">
              <UserCircle className="w-3.5 h-3.5" /> Водитель
            </button>
          )}
          <button onClick={() => onRepeat(ride.id)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 text-[11px] font-bold hover:bg-amber-500/20 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Повторить
          </button>
          {canEditPrice && (
            <button onClick={() => setEditPrice(!editPrice)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-500/10 text-violet-600 text-[11px] font-bold hover:bg-violet-500/20 transition-colors">
              <Edit2 className="w-3.5 h-3.5" /> Цена
            </button>
          )}
          <button onClick={() => { setShowCorrection(!showCorrection); setShowAssign(false); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 text-[11px] font-bold hover:bg-indigo-500/20 transition-colors">
            <DollarSign className="w-3.5 h-3.5" /> Корректировка
          </button>
          {!ride.driverId && (ride.status === "pending" || ride.status === "offered") && (
            <button onClick={() => { setShowAssign(!showAssign); setShowCorrection(false); if (!showAssign) loadDrivers(); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/10 text-sky-600 text-[11px] font-bold hover:bg-sky-500/20 transition-colors">
              <Send className="w-3.5 h-3.5" /> Назначить
            </button>
          )}
        </div>

        {editPrice && canEditPrice && (
          <div className="flex items-center gap-2 animate-in slide-in-from-top-2">
            <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder={String(ride.price || 0)} className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <button onClick={handleEditPrice} disabled={priceSaving || !newPrice} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50">
              {priceSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "OK"}
            </button>
          </div>
        )}

        {showCorrection && (
          <div className="bg-indigo-500/5 rounded-xl p-3 border border-indigo-500/20 space-y-2">
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Корректировка (создаёт проводку)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground block mb-0.5">Новая цена</label>
                <input type="number" value={corrNewPrice} onChange={e => setCorrNewPrice(e.target.value)} placeholder={String(ride.price || 0)} className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground block mb-0.5">Новая комиссия</label>
                <input type="number" value={corrNewComm} onChange={e => setCorrNewComm(e.target.value)} placeholder={String(commission)} className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </div>
            </div>
            <input type="text" value={corrComment} onChange={e => setCorrComment(e.target.value)} placeholder="Причина корректировки..." className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
            <div className="flex gap-2">
              <button onClick={handleCorrection} disabled={corrSaving || (!corrNewPrice && !corrNewComm)} className="flex-1 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold disabled:opacity-50 hover:bg-indigo-700 transition-colors">
                {corrSaving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Применить"}
              </button>
              <button onClick={() => setShowCorrection(false)} className="px-3 py-1.5 rounded-lg bg-muted text-[11px] font-bold hover:bg-muted/80 transition-colors">Отмена</button>
            </div>
          </div>
        )}

        {showAssign && (
          <div className="bg-sky-500/5 rounded-xl p-3 border border-sky-500/20 space-y-2">
            <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Назначить водителя</p>
            {driversLoading ? (
              <div className="py-3 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-sky-500" /></div>
            ) : availableDrivers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">Нет доступных водителей на маршрут</p>
            ) : (
              <div className="space-y-1 max-h-[180px] overflow-y-auto">
                {availableDrivers.map(d => (
                  <div key={d.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-sky-500/10 transition-colors">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{d.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {d.carModel} · {d.carNumber || "—"}
                        {d.seatsFree !== undefined && <span className="ml-1">· {d.seatsFree} мест</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAssignDriver(d.id)}
                      disabled={assigningDriver !== null}
                      className="px-2.5 py-1 rounded-lg bg-sky-600 text-white text-[10px] font-bold hover:bg-sky-700 disabled:opacity-50 transition-colors shrink-0"
                    >
                      {assigningDriver === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="bg-muted/30 rounded-xl p-3 border border-border/50 space-y-1.5">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Маршрут</p>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <div className="w-0.5 h-4 bg-border" />
              <div className="w-2 h-2 rounded-full bg-rose-500" />
            </div>
            <div className="text-xs">
              <p className="font-semibold text-foreground">{ride.fromCity}</p>
              <p className="font-semibold text-foreground">{ride.toCity}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mt-1.5">
            <div><span className="text-muted-foreground">Клиент: </span><span className="font-semibold">{ride.riderName || "—"}</span></div>
            <div><span className="text-muted-foreground">Тел: </span><span className="font-semibold">{ride.riderPhone || "—"}</span></div>
            <div><span className="text-muted-foreground">Водитель: </span><span className="font-semibold">{ride.driverName || "—"}</span></div>
            {ride.driverCarNumber && <div><span className="text-muted-foreground">Авто: </span><span className="font-semibold">{ride.driverCarNumber}</span></div>}
          </div>
        </div>

        <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Финансы</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-[9px] text-muted-foreground">Цена клиента</p>
              <p className="text-sm font-extrabold text-foreground">{fmt(ride.price || 0)}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground">Комиссия{ride.commission == null ? ` (${commissionPercent}%)` : ""}</p>
              <p className="text-sm font-extrabold text-rose-600">−{fmt(commission)}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground">Водителю</p>
              <p className="text-sm font-extrabold text-emerald-600">{fmt(driverPayout)}</p>
            </div>
          </div>
        </div>

        <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Тайминг</p>
          <div className="space-y-1">
            {assignTime && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">До назначения</span>
                <span className="font-bold text-foreground">{assignTime}</span>
              </div>
            )}
            {ride.startedAt && assignTime && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Ожидание</span>
                <span className="font-bold text-foreground">{diffMinutes(ride.acceptedAt || ride.createdAt, ride.startedAt)}</span>
              </div>
            )}
            {rideTime && (
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Поездка</span>
                <span className="font-bold text-foreground">{rideTime}</span>
              </div>
            )}
            <div className="flex justify-between text-[11px] border-t border-border pt-1">
              <span className="font-bold text-muted-foreground">Общее</span>
              <span className="font-extrabold text-foreground">{totalTime}</span>
            </div>
          </div>
        </div>

        <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Проводки</p>
              {txs.length > 0 && (
                <span className={`text-[10px] font-extrabold ${txTotal >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {txTotal >= 0 ? "+" : ""}{fmt(txTotal)}
                </span>
              )}
            </div>
            <button onClick={() => setShowAddTx(!showAddTx)} className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold hover:bg-primary/20 transition-colors">
              {showAddTx ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
              {showAddTx ? "Отмена" : "Добавить"}
            </button>
          </div>

          {showAddTx && (
            <div className="space-y-1.5 mb-2 p-2 rounded-lg bg-background border border-border">
              <div className="grid grid-cols-2 gap-1.5">
                <select value={txType} onChange={e => setTxType(e.target.value)} className="px-2 py-1 rounded-md border border-border bg-background text-[11px] focus:outline-none">
                  <option value="income">Оплата</option>
                  <option value="commission">Комиссия</option>
                  <option value="withdraw">Выплата</option>
                  <option value="bonus">Бонус</option>
                  <option value="adjust">Корректировка</option>
                  <option value="penalty">Штраф</option>
                  <option value="refund">Возврат</option>
                </select>
                <input type="number" value={txAmount} onChange={e => setTxAmount(e.target.value)} placeholder="Сумма" className="px-2 py-1 rounded-md border border-border bg-background text-[11px] focus:outline-none" />
              </div>
              <input type="text" value={txComment} onChange={e => setTxComment(e.target.value)} placeholder="Комментарий..." className="w-full px-2 py-1 rounded-md border border-border bg-background text-[11px] focus:outline-none" />
              <button onClick={handleAddTx} disabled={txSaving || !txAmount} className="w-full py-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-50">
                {txSaving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Создать"}
              </button>
            </div>
          )}

          {txLoading ? (
            <div className="py-3 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-muted-foreground" /></div>
          ) : txs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-2">Нет проводок</p>
          ) : (
            <div className="space-y-1">
              {txs.slice(0, 10).map(tx => {
                const tInfo = TX_TYPE_MAP_MINI[tx.type] || { label: tx.type, cls: "text-foreground bg-muted" };
                const amt = parseFloat(tx.amount);
                return (
                  <div key={tx.id} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${tInfo.cls}`}>{tInfo.label}</span>
                      {tx.description && <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{tx.description}</span>}
                    </div>
                    <span className={`text-[11px] font-bold shrink-0 ${amt >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {amt >= 0 ? "+" : ""}{fmt(amt)}
                    </span>
                  </div>
                );
              })}
              {txs.length > 10 && <p className="text-[10px] text-muted-foreground text-center">ещё {txs.length - 10}...</p>}
            </div>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground text-center">
          Создан: {fmtDate(ride.createdAt)}
        </div>
      </div>
    </div>
  );
}

const TX_TYPE_MAP_MINI: Record<string, { label: string; cls: string }> = {
  income: { label: "Оплата", cls: "text-emerald-600 bg-emerald-500/10" },
  commission: { label: "Ком.", cls: "text-amber-600 bg-amber-500/10" },
  bonus: { label: "Бонус", cls: "text-blue-600 bg-blue-500/10" },
  penalty: { label: "Штраф", cls: "text-rose-600 bg-rose-500/10" },
  adjust: { label: "Корр.", cls: "text-violet-600 bg-violet-500/10" },
  refund: { label: "Возвр.", cls: "text-indigo-600 bg-indigo-500/10" },
  withdraw: { label: "Выплата", cls: "text-orange-600 bg-orange-500/10" },
};

const TX_TYPE_MAP: Record<string, { label: string; cls: string }> = {
  income: { label: "Доход", cls: "text-emerald-600 bg-emerald-500/10" },
  commission: { label: "Комиссия", cls: "text-amber-600 bg-amber-500/10" },
  bonus: { label: "Бонус", cls: "text-blue-600 bg-blue-500/10" },
  penalty: { label: "Штраф", cls: "text-rose-600 bg-rose-500/10" },
  adjust: { label: "Проводка", cls: "text-violet-600 bg-violet-500/10" },
  refund: { label: "Возврат", cls: "text-indigo-600 bg-indigo-500/10" },
  withdraw: { label: "Вывод", cls: "text-orange-600 bg-orange-500/10" },
};

function AccountingTab({ rideId }: { rideId: number }) {
  const { token } = useAuth();
  const [txs, setTxs] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newType, setNewType] = useState("adjust");
  const [newAmount, setNewAmount] = useState("");
  const [newComment, setNewComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editComment, setEditComment] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const fetchTxs = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/rides/${rideId}/transactions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTxs(data.transactions || []);
      }
    } catch {}
    setTxLoading(false);
  }, [rideId, token]);

  useEffect(() => { fetchTxs(); }, [fetchTxs]);

  const handleCreate = async () => {
    if (!newAmount) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/rides/${rideId}/transactions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: newType, amount: parseFloat(newAmount), comment: newComment }),
      });
      if (res.ok) {
        toast.success("Проводка создана");
        setShowForm(false);
        setNewAmount("");
        setNewComment("");
        fetchTxs();
      } else { toast.error("Ошибка создания"); }
    } catch { toast.error("Ошибка сети"); }
    setSaving(false);
  };

  const handleSaveEdit = async (txId: number) => {
    setEditSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/api/rides/${rideId}/transactions/${txId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(editAmount), comment: editComment }),
      });
      if (res.ok) {
        toast.success("Обновлено");
        setEditId(null);
        fetchTxs();
      } else { toast.error("Ошибка обновления"); }
    } catch { toast.error("Ошибка сети"); }
    setEditSaving(false);
  };

  const totalSum = txs.reduce((sum, t) => sum + parseFloat(t.amount || "0"), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Итого по проводкам</p>
          <p className={`text-lg font-extrabold ${totalSum >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{totalSum >= 0 ? "+" : ""}{fmt(totalSum)} сум</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-all"
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <DollarSign className="w-3.5 h-3.5" />}
          {showForm ? "Отмена" : "Добавить проводку"}
        </button>
      </div>

      {showForm && (
        <div className="bg-muted/30 rounded-xl p-3 border border-border/50 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Тип</label>
              <select value={newType} onChange={e => setNewType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="adjust">Проводка</option>
                <option value="income">Доход</option>
                <option value="commission">Комиссия</option>
                <option value="bonus">Бонус</option>
                <option value="penalty">Штраф</option>
                <option value="refund">Возврат</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Сумма</label>
              <input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="10000" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Комментарий</label>
            <input type="text" value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Причина проводки..." className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <button onClick={handleCreate} disabled={saving || !newAmount} className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-all disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Создать проводку"}
          </button>
        </div>
      )}

      {txLoading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : txs.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Нет проводок по заказу</div>
      ) : (
        <div className="space-y-1.5">
          {txs.map(tx => {
            const tInfo = TX_TYPE_MAP[tx.type] || { label: tx.type, cls: "text-foreground bg-muted" };
            const isEditing = editId === tx.id;
            return (
              <div key={tx.id} className="bg-muted/30 rounded-xl p-3 border border-border/50">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase mb-0.5 block">Сумма</label>
                        <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase mb-0.5 block">Комментарий</label>
                        <input type="text" value={editComment} onChange={e => setEditComment(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveEdit(tx.id)} disabled={editSaving} className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                        {editSaving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Сохранить"}
                      </button>
                      <button onClick={() => setEditId(null)} className="px-3 py-1.5 rounded-lg bg-muted text-xs font-bold hover:bg-muted/80">Отмена</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${tInfo.cls}`}>{tInfo.label}</span>
                      <div className="min-w-0">
                        <p className={`text-sm font-extrabold ${parseFloat(tx.amount) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {parseFloat(tx.amount) >= 0 ? "+" : ""}{fmt(parseFloat(tx.amount))} сум
                        </p>
                        {tx.description && <p className="text-[10px] text-muted-foreground truncate">{tx.description}</p>}
                        <p className="text-[9px] text-muted-foreground/60">{fmtDate(tx.createdAt)}{tx.updatedAt ? ` · изм. ${fmtDate(tx.updatedAt)}` : ""}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setEditId(tx.id); setEditAmount(tx.amount); setEditComment(tx.description || ""); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted transition-colors shrink-0"
                      title="Редактировать"
                    >
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimingRow({ label, value, status, bold }: { label: string; value: string; status: string; bold?: boolean }) {
  const st = STATUS_MAP[status] || STATUS_MAP.pending;
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${st.dot}`} />
        <span className={`text-xs ${bold ? "font-bold text-foreground" : "text-muted-foreground"}`}>{label}</span>
      </div>
      <span className={`text-xs font-mono ${bold ? "font-extrabold text-foreground" : "font-bold text-foreground"}`}>{value}</span>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 rounded-xl p-4 border border-border/50">
      <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2.5">{title}</h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function FinanceCard({ label, value, icon: Icon, color, bg }: {
  label: string; value: string; icon: any; color: string; bg: string;
}) {
  return (
    <div className={`${bg} rounded-xl p-4 border border-border/50`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-lg font-extrabold ${color}`}>{value}</p>
    </div>
  );
}

function RouteStop({ label, city, address, type }: { label: string; city: string; address?: string | null; type: "start" | "stop" | "end" }) {
  const dotColor = type === "start" ? "bg-emerald-500" : type === "end" ? "bg-rose-500" : "bg-blue-500";
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full ${dotColor} ring-4 ring-card shrink-0`} />
        {type !== "end" && <div className="w-0.5 flex-1 bg-border min-h-[24px]" />}
      </div>
      <div className="pb-3">
        <p className="text-xs font-bold text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{city}</p>
        {address && <p className="text-xs text-muted-foreground">{address}</p>}
      </div>
    </div>
  );
}
