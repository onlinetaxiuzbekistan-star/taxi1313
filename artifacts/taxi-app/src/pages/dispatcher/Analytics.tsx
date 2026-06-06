import { useEffect, useState } from "react";
import DispatcherLayout from "./DispatcherLayout";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { TrendingUp, Car, Users, DollarSign, CheckCircle, XCircle, PhoneCall } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

function fmt(n: number) {
  return n.toLocaleString("ru-RU");
}

function fmtUzs(n: number) {
  return n.toLocaleString("ru-RU") + " сум";
}

interface Summary {
  totalOrdersToday: number;
  completedToday: number;
  cancelledToday: number;
  revenueToday: number;
  commissionToday: number;
  activeOrders: number;
  driversOnline: number;
  driversBusy: number;
  driversOffline: number;
  totalDrivers: number;
  totalOrders: number;
  completed: number;
  avgCheckToday: number;
  avgCheckAllTime: number;
  totalCommission: number;
  totalBonuses: number;
  totalPenalties: number;
}

interface DailyRow {
  date: string;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  revenue: string;
  commission: string;
  avgOrderPrice: number | null;
  activeDrivers: number;
  newClients: number;
}

function StatCard({ icon: Icon, label, value, sub, color = "emerald" }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  const colors: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-600",
    blue: "bg-blue-500/10 text-blue-600",
    amber: "bg-amber-500/10 text-amber-600",
    red: "bg-red-500/10 text-red-600",
    purple: "bg-purple-500/10 text-purple-600",
  };
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

const CustomTooltipRevenue = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {fmt(p.value)} сум</p>
      ))}
    </div>
  );
};

export default function Analytics() {
  const token = localStorage.getItem("authToken");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const [sRes, dRes] = await Promise.all([
        fetch(`${BASE_URL}/api/analytics/summary`, { headers }),
        fetch(`${BASE_URL}/api/analytics/daily?days=14`, { headers }),
      ]);

      if (!sRes.ok || !dRes.ok) throw new Error("Ошибка загрузки аналитики");

      const [sData, dData] = await Promise.all([sRes.json(), dRes.json()]);
      setSummary(sData);
      setDaily((dData.days || []).reverse()); // oldest → newest for chart
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const driverPie = summary ? [
    { name: "Онлайн",  value: summary.driversOnline },
    { name: "Занят",   value: summary.driversBusy },
    { name: "Оффлайн", value: summary.driversOffline },
  ] : [];

  const completionRate = summary && summary.totalOrders > 0
    ? Math.round((summary.completed / summary.totalOrders) * 100)
    : 0;

  return (
    <DispatcherLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Аналитика</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Статистика платформы в реальном времени</p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg active:scale-[0.97] transition-all"
          >
            <TrendingUp className="w-4 h-4" />
            Обновить
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-700 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5 h-24 animate-pulse" />
            ))}
          </div>
        ) : summary ? (
          <>
            {/* KPI Today */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Сегодня</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Car} label="Заказов сегодня" value={fmt(summary.totalOrdersToday)} color="blue" />
                <StatCard icon={CheckCircle} label="Выполнено" value={fmt(summary.completedToday)}
                  sub={summary.totalOrdersToday > 0 ? `${Math.round(summary.completedToday / summary.totalOrdersToday * 100)}% выполнение` : undefined} color="emerald" />
                <StatCard icon={DollarSign} label="Выручка сегодня" value={fmtUzs(summary.revenueToday)} color="amber" />
                <StatCard icon={TrendingUp} label="Комиссия" value={fmtUzs(summary.commissionToday)}
                  sub="10% от выручки" color="purple" />
              </div>
            </div>

            {/* Financial stats */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Финансы</p>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard icon={DollarSign} label="Средний чек (сегодня)" value={fmtUzs(summary.avgCheckToday || 0)} color="amber" />
                <StatCard icon={DollarSign} label="Средний чек (всё время)" value={fmtUzs(summary.avgCheckAllTime || 0)} color="blue" />
                <StatCard icon={TrendingUp} label="Комиссия (всего)" value={fmtUzs(summary.totalCommission || 0)} color="purple" />
                <StatCard icon={CheckCircle} label="Бонусы выплачено" value={fmtUzs(summary.totalBonuses || 0)} color="emerald" />
                <StatCard icon={XCircle} label="Штрафы взыскано" value={fmtUzs(summary.totalPenalties || 0)} color="red" />
              </div>
            </div>

            {/* Live status */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Прямо сейчас</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={PhoneCall} label="Активных заказов" value={fmt(summary.activeOrders)} color="blue" />
                <StatCard icon={Users} label="Онлайн водителей" value={fmt(summary.driversOnline)} color="emerald" />
                <StatCard icon={Car} label="Водителей в рейсе" value={fmt(summary.driversBusy)} color="amber" />
                <StatCard icon={XCircle} label="% выполнения всего" value={`${completionRate}%`}
                  sub={`${fmt(summary.completed)} из ${fmt(summary.totalOrders)}`} color="emerald" />
              </div>
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Revenue + Commission chart */}
              <div className="lg:col-span-2 bg-card rounded-xl border border-border shadow-sm p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Выручка и комиссия (14 дней)</h3>
                {daily.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                    Нет данных за последние 14 дней
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={daily} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}к`} />
                      <Tooltip content={<CustomTooltipRevenue />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar name="Выручка" dataKey={(d: DailyRow) => parseFloat(d.revenue)} fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar name="Комиссия" dataKey={(d: DailyRow) => parseFloat(d.commission)} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Driver status pie */}
              <div className="bg-card rounded-xl border border-border shadow-sm p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">
                  Водители ({fmt(summary.totalDrivers)} всего)
                </h3>
                {summary.totalDrivers === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                    Нет водителей
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={driverPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, value }) => value > 0 ? `${name}: ${value}` : ""} labelLine={false}>
                        {driverPie.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Orders trend */}
            {daily.length > 0 && (
              <div className="bg-card rounded-xl border border-border shadow-sm p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Заказы по дням</h3>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={daily} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" name="Всего"      dataKey="totalOrders"     stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" name="Выполнено"  dataKey="completedOrders" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" name="Отменено"   dataKey="cancelledOrders" stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        ) : null}
      </div>
    </DispatcherLayout>
  );
}
