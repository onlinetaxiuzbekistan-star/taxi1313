import { useState, useMemo, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { useAuth } from "@/hooks/use-auth";
import {
  BarChart3, FileSpreadsheet, Calendar, Filter, Download,
  Car, Users, MapPin, Layers, TrendingUp, ChevronRight,
  ArrowUpDown, ChevronDown, Search, X,
} from "lucide-react";
import * as XLSX from "xlsx";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}
function fmtUzs(n: number) {
  return Math.round(n).toLocaleString("ru-RU") + " сум";
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const statusLabels: Record<string, string> = {
  pending: "Ожидает",
  offered: "Предложен",
  accepted: "Принят",
  in_progress: "В пути",
  completed: "Завершён",
  cancelled: "Отменён",
};

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  offered: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  in_progress: "bg-indigo-100 text-indigo-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

type ReportType = "orders" | "drivers" | "clients" | "cities" | "driver-groups" | "daily";

interface ReportMeta {
  key: ReportType;
  label: string;
  icon: any;
  desc: string;
}

const REPORTS: ReportMeta[] = [
  { key: "orders", label: "Отчёт по заказам", icon: Car, desc: "Все заказы с фильтрами по статусу, дате и маршруту" },
  { key: "drivers", label: "Отчёт по водителям", icon: Users, desc: "Статистика по каждому водителю за период" },
  { key: "clients", label: "Отчёт по клиентам", icon: Users, desc: "Статистика клиентов по количеству поездок и расходам" },
  { key: "cities", label: "Отчёт по городам", icon: MapPin, desc: "Популярные направления и маршруты" },
  { key: "driver-groups", label: "Отчёт по группам водителей", icon: Layers, desc: "Сводка по группам: заказы, выручка, водители" },
  { key: "daily", label: "Ежедневный отчёт", icon: TrendingUp, desc: "Разбивка по дням: заказы, выручка, клиенты" },
];

function getDefaultDates() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

function exportToExcel(data: any[], fileName: string) {
  if (!data.length) return;
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

function SortableHeader({ label, sortKey, sortState, onSort }: {
  label: string; sortKey: string;
  sortState: { key: string; dir: "asc" | "desc" };
  onSort: (key: string) => void;
}) {
  return (
    <th
      className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${sortState.key === sortKey ? "text-emerald-600" : "text-gray-300"}`} />
      </span>
    </th>
  );
}

function useSort<T>(data: T[], defaultKey: string) {
  const [sortState, setSortState] = useState({ key: defaultKey, dir: "desc" as "asc" | "desc" });
  const onSort = useCallback((key: string) => {
    setSortState(prev => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));
  }, []);
  const sorted = useMemo(() => {
    const arr = [...data];
    arr.sort((a: any, b: any) => {
      const av = a[sortState.key] ?? 0;
      const bv = b[sortState.key] ?? 0;
      if (typeof av === "string" && typeof bv === "string") return sortState.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortState.dir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    return arr;
  }, [data, sortState]);
  return { sorted, sortState, onSort };
}

function OrdersReport({ token, from, to }: { token: string; from: string; to: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { sorted, sortState, onSort } = useSort(data?.rides || [], "createdAt");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`${BASE_URL}/api/reports/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, [token, from, to, statusFilter]);

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const s = search.toLowerCase();
    return sorted.filter((r: any) =>
      r.riderName?.toLowerCase().includes(s) ||
      r.riderPhone?.includes(s) ||
      r.driverName?.toLowerCase().includes(s) ||
      r.fromCity?.toLowerCase().includes(s) ||
      r.toCity?.toLowerCase().includes(s) ||
      String(r.id).includes(s)
    );
  }, [sorted, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
          <option value="all">Все статусы</option>
          {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load} disabled={loading} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
          <Filter className="w-4 h-4" />{loading ? "Загрузка..." : "Сформировать"}
        </button>
        {data && (
          <button onClick={() => exportToExcel(filtered.map((r: any) => ({
            "ID": r.id, "Откуда": r.fromCity, "Куда": r.toCity, "Статус": statusLabels[r.status] || r.status,
            "Цена": r.price, "Комиссия": r.commission || 0, "Пассажиры": r.passengers, "Класс": r.carClass,
            "Оплата": r.paymentType, "Клиент": r.riderName, "Телефон": r.riderPhone,
            "Водитель": r.driverName, "Дата": fmtDateTime(r.createdAt),
          })), `orders_${from}_${to}`)} className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />Excel
          </button>
        )}
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Всего", value: fmt(data.summary.total), color: "blue" },
            { label: "Выполнено", value: fmt(data.summary.completed), color: "green" },
            { label: "Отменено", value: fmt(data.summary.cancelled), color: "red" },
            { label: "Выручка", value: fmtUzs(data.summary.totalRevenue), color: "emerald" },
            { label: "Комиссия", value: fmtUzs(data.summary.totalCommission), color: "amber" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border p-3">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по ID, имени, телефону, городу..." className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm bg-white" />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-400" /></button>}
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <SortableHeader label="ID" sortKey="id" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Маршрут" sortKey="fromCity" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Статус" sortKey="status" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Цена" sortKey="price" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Клиент" sortKey="riderName" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Водитель" sortKey="driverName" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Дата" sortKey="createdAt" sortState={sortState} onSort={onSort} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">#{r.id}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.fromCity} → {r.toCity}</td>
                    <td className="px-3 py-2"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[r.status] || ""}`}>{statusLabels[r.status] || r.status}</span></td>
                    <td className="px-3 py-2 font-medium">{fmtUzs(r.price)}</td>
                    <td className="px-3 py-2 text-xs">{r.riderName || "—"}<br/><span className="text-gray-400">{r.riderPhone || ""}</span></td>
                    <td className="px-3 py-2 text-xs">{r.driverName || "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmtDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">Нет данных</p>}
            <div className="border-t px-3 py-2 text-xs text-gray-500">Показано: {filtered.length} записей</div>
          </div>
        </>
      )}
    </div>
  );
}

function DriversReport({ token, from, to }: { token: string; from: string; to: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [groupFilter, setGroupFilter] = useState("");
  const [search, setSearch] = useState("");
  const { sorted, sortState, onSort } = useSort(
    (data?.drivers || []).map((d: any) => ({ ...d, ...d.periodStats })),
    "totalOrders"
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (groupFilter) params.set("groupId", groupFilter);
      const res = await fetch(`${BASE_URL}/api/reports/drivers?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, [token, from, to, groupFilter]);

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const s = search.toLowerCase();
    return sorted.filter((d: any) => d.name?.toLowerCase().includes(s) || d.phone?.includes(s) || d.carNumber?.toLowerCase().includes(s));
  }, [sorted, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {data?.groups && (
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">Все группы</option>
            {data.groups.map((g: any) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        )}
        <button onClick={load} disabled={loading} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
          <Filter className="w-4 h-4" />{loading ? "Загрузка..." : "Сформировать"}
        </button>
        {data && (
          <button onClick={() => exportToExcel(filtered.map((d: any) => ({
            "Имя": d.name, "Телефон": d.phone, "Статус": d.status, "Авто": `${d.carBrand || ""} ${d.carModel || ""}`.trim(),
            "Номер авто": d.carNumber, "Класс": d.carClass, "Группа": d.groupName || "—",
            "Баланс": d.balance, "Рейтинг": d.rating, "Всего заказов": d.totalOrders,
            "Выполнено": d.completedOrders, "Отменено": d.cancelledOrders,
            "Выручка": d.revenue, "Комиссия": d.commission, "Выплата": d.payout,
          })), `drivers_${from}_${to}`)} className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />Excel
          </button>
        )}
      </div>

      {data && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени, телефону, номеру авто..." className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm bg-white" />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-400" /></button>}
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <SortableHeader label="Водитель" sortKey="name" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Телефон" sortKey="phone" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Авто" sortKey="carBrand" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Группа" sortKey="groupName" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Заказы" sortKey="totalOrders" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Выполнено" sortKey="completedOrders" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Отменено" sortKey="cancelledOrders" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Выручка" sortKey="revenue" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Рейтинг" sortKey="rating" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Баланс" sortKey="balance" sortState={sortState} onSort={onSort} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((d: any) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{d.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{d.phone}</td>
                    <td className="px-3 py-2 text-xs">{d.carBrand} {d.carModel}<br/><span className="text-gray-400">{d.carNumber}</span></td>
                    <td className="px-3 py-2 text-xs">{d.groupName || "—"}</td>
                    <td className="px-3 py-2 font-medium">{d.totalOrders}</td>
                    <td className="px-3 py-2 text-green-600 font-medium">{d.completedOrders}</td>
                    <td className="px-3 py-2 text-red-600 font-medium">{d.cancelledOrders}</td>
                    <td className="px-3 py-2 font-medium">{fmtUzs(d.revenue)}</td>
                    <td className="px-3 py-2">{d.rating?.toFixed(1)}</td>
                    <td className="px-3 py-2 font-medium">{fmt(Number(d.balance))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">Нет данных</p>}
            <div className="border-t px-3 py-2 text-xs text-gray-500">Показано: {filtered.length} водителей</div>
          </div>
        </>
      )}
    </div>
  );
}

function ClientsReport({ token, from, to }: { token: string; from: string; to: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const { sorted, sortState, onSort } = useSort(data?.clients || [], "totalOrders");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/reports/clients?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, [token, from, to]);

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const s = search.toLowerCase();
    return sorted.filter((c: any) => c.name?.toLowerCase().includes(s) || c.phone?.includes(s));
  }, [sorted, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={load} disabled={loading} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
          <Filter className="w-4 h-4" />{loading ? "Загрузка..." : "Сформировать"}
        </button>
        {data && (
          <button onClick={() => exportToExcel(filtered.map((c: any) => ({
            "Телефон": c.phone, "Имя": c.name || "—", "Всего заказов": c.totalOrders,
            "Выполнено": c.completedOrders, "Отменено": c.cancelledOrders,
            "Потрачено": c.totalSpent, "Средний чек": Math.round(c.avgPrice),
            "Первый заказ": fmtDate(c.firstOrder), "Последний заказ": fmtDate(c.lastOrder),
          })), `clients_${from}_${to}`)} className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />Excel
          </button>
        )}
      </div>

      {data?.summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border p-3"><p className="text-xs text-gray-500">Клиентов</p><p className="text-lg font-bold">{fmt(data.summary.totalClients)}</p></div>
          <div className="bg-white rounded-xl border p-3"><p className="text-xs text-gray-500">Заказов</p><p className="text-lg font-bold">{fmt(data.summary.totalOrders)}</p></div>
          <div className="bg-white rounded-xl border p-3"><p className="text-xs text-gray-500">Выручка</p><p className="text-lg font-bold">{fmtUzs(data.summary.totalRevenue)}</p></div>
        </div>
      )}

      {data && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени, телефону..." className="w-full pl-9 pr-8 py-2 border rounded-lg text-sm bg-white" />
            {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-400" /></button>}
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <SortableHeader label="Клиент" sortKey="name" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Телефон" sortKey="phone" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Заказы" sortKey="totalOrders" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Выполнено" sortKey="completedOrders" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Отменено" sortKey="cancelledOrders" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Потрачено" sortKey="totalSpent" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Ср. чек" sortKey="avgPrice" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Первый заказ" sortKey="firstOrder" sortState={sortState} onSort={onSort} />
                  <SortableHeader label="Последний" sortKey="lastOrder" sortState={sortState} onSort={onSort} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{c.name || "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{c.phone}</td>
                    <td className="px-3 py-2 font-medium">{c.totalOrders}</td>
                    <td className="px-3 py-2 text-green-600">{c.completedOrders}</td>
                    <td className="px-3 py-2 text-red-600">{c.cancelledOrders}</td>
                    <td className="px-3 py-2 font-medium">{fmtUzs(c.totalSpent)}</td>
                    <td className="px-3 py-2">{fmtUzs(c.avgPrice)}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{fmtDate(c.firstOrder)}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{fmtDate(c.lastOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">Нет данных</p>}
            <div className="border-t px-3 py-2 text-xs text-gray-500">Показано: {filtered.length} клиентов</div>
          </div>
        </>
      )}
    </div>
  );
}

function CitiesReport({ token, from, to }: { token: string; from: string; to: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"departures" | "arrivals" | "routes">("routes");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/reports/cities?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, [token, from, to]);

  const currentData = data ? (tab === "routes" ? data.routes : tab === "departures" ? data.departures : data.arrivals) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={load} disabled={loading} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
          <Filter className="w-4 h-4" />{loading ? "Загрузка..." : "Сформировать"}
        </button>
        {data && (
          <button onClick={() => exportToExcel(currentData.map((r: any) => tab === "routes"
            ? { "Откуда": r.fromCity, "Куда": r.toCity, "Заказов": r.total, "Выполнено": r.completed, "Выручка": r.revenue, "Ср. цена": Math.round(r.avgPrice) }
            : { "Город": r.city, "Заказов": r.total, "Выполнено": r.completed, "Отменено": r.cancelled, "Выручка": r.revenue }
          ), `cities_${tab}_${from}_${to}`)} className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />Excel
          </button>
        )}
      </div>

      {data && (
        <>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {([["routes", "Маршруты"], ["departures", "Отправления"], ["arrivals", "Прибытия"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === k ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>{l}</button>
            ))}
          </div>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {tab === "routes" ? (
                    <>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Маршрут</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Заказов</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Выполнено</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Выручка</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Ср. цена</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Город</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Заказов</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Выполнено</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Отменено</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Выручка</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {currentData.map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {tab === "routes" ? (
                      <>
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{r.fromCity} → {r.toCity}</td>
                        <td className="px-3 py-2">{r.total}</td>
                        <td className="px-3 py-2 text-green-600">{r.completed}</td>
                        <td className="px-3 py-2 font-medium">{fmtUzs(r.revenue)}</td>
                        <td className="px-3 py-2">{fmtUzs(r.avgPrice)}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-medium">{r.city}</td>
                        <td className="px-3 py-2">{r.total}</td>
                        <td className="px-3 py-2 text-green-600">{r.completed}</td>
                        <td className="px-3 py-2 text-red-600">{r.cancelled}</td>
                        <td className="px-3 py-2 font-medium">{fmtUzs(r.revenue)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {currentData.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">Нет данных</p>}
          </div>
        </>
      )}
    </div>
  );
}

function DriverGroupsReport({ token, from, to }: { token: string; from: string; to: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/reports/driver-groups?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, [token, from, to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={load} disabled={loading} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
          <Filter className="w-4 h-4" />{loading ? "Загрузка..." : "Сформировать"}
        </button>
        {data && (
          <button onClick={() => exportToExcel((data.groups || []).map((g: any) => ({
            "Группа": g.label, "Уровень": g.level, "Водителей": g.driverCount,
            "Онлайн": g.onlineCount, "Заняты": g.busyCount,
            "Заказов": g.totalOrders, "Выполнено": g.completedOrders, "Отменено": g.cancelledOrders,
            "Выручка": g.revenue, "Комиссия": g.commission,
          })), `driver_groups_${from}_${to}`)} className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />Excel
          </button>
        )}
      </div>

      {data && (
        <div className="grid gap-4">
          {(data.groups || []).map((g: any) => (
            <div key={g.id} className="bg-white rounded-xl border p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-bold text-gray-900">{g.label}</h3>
                  <p className="text-xs text-gray-500">Уровень {g.level} &middot; {g.driverCount} водителей ({g.onlineCount} онлайн, {g.busyCount} заняты)</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div><p className="text-xs text-gray-400">Заказов</p><p className="font-bold text-gray-900">{fmt(g.totalOrders)}</p></div>
                <div><p className="text-xs text-gray-400">Выполнено</p><p className="font-bold text-green-600">{fmt(g.completedOrders)}</p></div>
                <div><p className="text-xs text-gray-400">Отменено</p><p className="font-bold text-red-600">{fmt(g.cancelledOrders)}</p></div>
                <div><p className="text-xs text-gray-400">Выручка</p><p className="font-bold text-gray-900">{fmtUzs(g.revenue)}</p></div>
                <div><p className="text-xs text-gray-400">Комиссия</p><p className="font-bold text-amber-600">{fmtUzs(g.commission)}</p></div>
              </div>
            </div>
          ))}
          {(data.groups || []).length === 0 && <p className="text-center text-gray-400 py-8 text-sm">Нет групп водителей</p>}
        </div>
      )}
    </div>
  );
}

function DailyReport({ token, from, to }: { token: string; from: string; to: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { sorted, sortState, onSort } = useSort(data?.daily || [], "date");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/reports/daily?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${token}` } });
      setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, [token, from, to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={load} disabled={loading} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
          <Filter className="w-4 h-4" />{loading ? "Загрузка..." : "Сформировать"}
        </button>
        {data && (
          <button onClick={() => exportToExcel(sorted.map((d: any) => ({
            "Дата": fmtDate(d.date), "Всего заказов": d.total, "Выполнено": d.completed,
            "Отменено": d.cancelled, "В ожидании": d.pending, "Выручка": d.revenue,
            "Комиссия": d.commission, "Ср. цена": Math.round(d.avgPrice),
            "Клиентов": d.uniqueClients, "Водителей": d.uniqueDrivers,
          })), `daily_${from}_${to}`)} className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <Download className="w-4 h-4" />Excel
          </button>
        )}
      </div>

      {data && (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <SortableHeader label="Дата" sortKey="date" sortState={sortState} onSort={onSort} />
                <SortableHeader label="Всего" sortKey="total" sortState={sortState} onSort={onSort} />
                <SortableHeader label="Выполнено" sortKey="completed" sortState={sortState} onSort={onSort} />
                <SortableHeader label="Отменено" sortKey="cancelled" sortState={sortState} onSort={onSort} />
                <SortableHeader label="Выручка" sortKey="revenue" sortState={sortState} onSort={onSort} />
                <SortableHeader label="Комиссия" sortKey="commission" sortState={sortState} onSort={onSort} />
                <SortableHeader label="Ср. цена" sortKey="avgPrice" sortState={sortState} onSort={onSort} />
                <SortableHeader label="Клиентов" sortKey="uniqueClients" sortState={sortState} onSort={onSort} />
                <SortableHeader label="Водителей" sortKey="uniqueDrivers" sortState={sortState} onSort={onSort} />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((d: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{fmtDate(d.date)}</td>
                  <td className="px-3 py-2 font-bold">{d.total}</td>
                  <td className="px-3 py-2 text-green-600 font-medium">{d.completed}</td>
                  <td className="px-3 py-2 text-red-600 font-medium">{d.cancelled}</td>
                  <td className="px-3 py-2 font-medium">{fmtUzs(d.revenue)}</td>
                  <td className="px-3 py-2">{fmtUzs(d.commission)}</td>
                  <td className="px-3 py-2">{fmtUzs(d.avgPrice)}</td>
                  <td className="px-3 py-2">{d.uniqueClients}</td>
                  <td className="px-3 py-2">{d.uniqueDrivers}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">Нет данных за период</p>}
          <div className="border-t px-3 py-2 text-xs text-gray-500">
            Итого: {sorted.reduce((s: number, d: any) => s + d.total, 0)} заказов, {fmtUzs(sorted.reduce((s: number, d: any) => s + d.revenue, 0))} выручка
          </div>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const { token } = useAuth();
  const [activeReport, setActiveReport] = useState<ReportType | null>(null);
  const [dates, setDates] = useState(getDefaultDates);

  return (
    <DispatcherLayout>
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Отчёты</h1>
            <p className="text-sm text-gray-500">Формирование и экспорт отчётов</p>
          </div>
        </div>

        {!activeReport ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {REPORTS.map(r => {
              const Icon = r.icon;
              return (
                <button
                  key={r.key}
                  onClick={() => setActiveReport(r.key)}
                  className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-emerald-300 hover:shadow-md transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                      <Icon className="w-4.5 h-4.5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 text-sm group-hover:text-emerald-700 transition-colors">{r.label}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{r.desc}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 mt-1 transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button
                onClick={() => setActiveReport(null)}
                className="text-sm text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />Назад
              </button>
              <div className="w-px h-5 bg-gray-200" />
              <h2 className="font-bold text-gray-900">{REPORTS.find(r => r.key === activeReport)?.label}</h2>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <input type="date" value={dates.from} onChange={e => setDates(d => ({ ...d, from: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm bg-white" />
                <span className="text-gray-400">—</span>
                <input type="date" value={dates.to} onChange={e => setDates(d => ({ ...d, to: e.target.value }))} className="border rounded-lg px-3 py-1.5 text-sm bg-white" />
              </div>
            </div>

            {activeReport === "orders" && <OrdersReport token={token!} from={dates.from} to={dates.to} />}
            {activeReport === "drivers" && <DriversReport token={token!} from={dates.from} to={dates.to} />}
            {activeReport === "clients" && <ClientsReport token={token!} from={dates.from} to={dates.to} />}
            {activeReport === "cities" && <CitiesReport token={token!} from={dates.from} to={dates.to} />}
            {activeReport === "driver-groups" && <DriverGroupsReport token={token!} from={dates.from} to={dates.to} />}
            {activeReport === "daily" && <DailyReport token={token!} from={dates.from} to={dates.to} />}
          </>
        )}
      </div>
    </DispatcherLayout>
  );
}
