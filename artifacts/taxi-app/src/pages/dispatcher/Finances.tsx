import { useState, useEffect, useCallback } from "react";
import DispatcherLayout from "./DispatcherLayout";
import {
  DollarSign, TrendingUp, ArrowDownLeft, ArrowUpRight, Gift,
  AlertTriangle, Search, Filter
} from "lucide-react";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

function fmtUzs(n: number) {
  return fmt(n) + " сум";
}

type TransactionType = "income" | "commission" | "bonus" | "penalty" | "withdraw" | "refund";

interface Transaction {
  id: number;
  userId: number;
  type: TransactionType;
  amount: string;
  balanceBefore?: string;
  balanceAfter?: string;
  description: string;
  createdAt: string;
  rideId?: number;
  userName?: string;
}

const typeConfig: Record<TransactionType, { icon: any; label: string; color: string; bgColor: string }> = {
  income:     { icon: ArrowDownLeft,  label: "Доход",    color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
  commission: { icon: DollarSign,     label: "Комиссия", bgColor: "bg-blue-500/10",     color: "text-blue-600" },
  bonus:      { icon: Gift,           label: "Бонус",    bgColor: "bg-amber-500/10",    color: "text-amber-600" },
  penalty:    { icon: AlertTriangle,  label: "Штраф",    bgColor: "bg-red-500/10",      color: "text-red-600" },
  withdraw:   { icon: ArrowUpRight,   label: "Вывод",    bgColor: "bg-orange-500/10",   color: "text-orange-600" },
  refund:     { icon: ArrowDownLeft,  label: "Возврат",  bgColor: "bg-cyan-500/10",     color: "text-cyan-600" },
};

interface FinancialSummary {
  totalCommission: number;
  totalBonuses: number;
  totalPenalties: number;
  revenueToday: number;
  commissionToday: number;
}

export default function Finances() {
  const token = localStorage.getItem("authToken");
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [filterType, setFilterType] = useState("all");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const [sRes, tRes] = await Promise.all([
        fetch(`${BASE_URL}/api/analytics/summary`, { headers }),
        fetch(`${BASE_URL}/api/payments/transactions?limit=100${filterType !== "all" ? `&type=${filterType}` : ""}`, { headers }),
      ]);
      if (sRes.ok) {
        const data = await sRes.json();
        setSummary(data);
      }
      if (tRes.ok) {
        const data = await tRes.json();
        setTransactions(data.transactions || []);
      }
      if (!sRes.ok && !tRes.ok) setFetchError(true);
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token, filterType]);

  useEffect(() => { load(); }, [load]);

  const filters = [
    { key: "all", label: "Все" },
    { key: "commission", label: "Комиссии" },
    { key: "income", label: "Доходы" },
    { key: "bonus", label: "Бонусы" },
    { key: "penalty", label: "Штрафы" },
  ];

  return (
    <DispatcherLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Финансы</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Финансовый обзор платформы</p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg active:scale-[0.97] transition-all"
          >
            <TrendingUp className="w-4 h-4" />
            Обновить
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-5 h-24 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        ) : fetchError ? (
          <ErrorState message="Не удалось загрузить финансовые данные" onRetry={load} />
        ) : summary ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-card rounded-xl border border-border shadow-sm p-5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-3">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Выручка сегодня</p>
                <p className="text-2xl font-bold text-foreground mt-1">{fmtUzs(summary.revenueToday)}</p>
              </div>
              <div className="bg-card rounded-xl border border-border shadow-sm p-5">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center mb-3">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Комиссия (всего)</p>
                <p className="text-2xl font-bold text-foreground mt-1">{fmtUzs(summary.totalCommission)}</p>
              </div>
              <div className="bg-card rounded-xl border border-border shadow-sm p-5">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center mb-3">
                  <Gift className="w-5 h-5 text-amber-600" />
                </div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Бонусы выплачено</p>
                <p className="text-2xl font-bold text-foreground mt-1">{fmtUzs(summary.totalBonuses)}</p>
              </div>
              <div className="bg-card rounded-xl border border-border shadow-sm p-5">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center mb-3">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Штрафы взыскано</p>
                <p className="text-2xl font-bold text-foreground mt-1">{fmtUzs(summary.totalPenalties)}</p>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-sm">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Журнал транзакций</h3>
                <div className="flex gap-1.5">
                  {filters.map(f => (
                    <button
                      key={f.key}
                      onClick={() => setFilterType(f.key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        filterType === f.key
                          ? "bg-emerald-500 text-white"
                          : "bg-muted text-foreground hover:bg-muted/80 active:bg-accent transition-colors"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-border">
                {transactions.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">Нет транзакций</div>
                ) : (
                  transactions.map(tx => {
                    const cfg = typeConfig[tx.type] || typeConfig.income;
                    const Icon = cfg.icon;
                    const amount = parseFloat(tx.amount);
                    return (
                      <div key={tx.id} className="px-5 py-3 flex items-center gap-3 hover:bg-muted active:bg-accent transition-colors">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cfg.bgColor}`}>
                          <Icon className={`w-4 h-4 ${cfg.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground font-medium truncate">{tx.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground">
                              {new Date(tx.createdAt).toLocaleDateString("ru-RU", {
                                day: "numeric", month: "short", year: "numeric",
                                hour: "2-digit", minute: "2-digit"
                              })}
                              {tx.rideId ? ` · Рейс #${tx.rideId}` : ""}
                              {tx.userName ? ` · ${tx.userName}` : ""}
                            </span>
                          </div>
                          {tx.balanceBefore && tx.balanceAfter && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Баланс: {fmt(parseFloat(tx.balanceBefore))} → {fmt(parseFloat(tx.balanceAfter))} сум
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cfg.bgColor} ${cfg.color}`}>
                            {cfg.label}
                          </span>
                          <p className={`text-sm font-semibold mt-0.5 ${
                            tx.type === "income" || tx.type === "bonus" || tx.type === "refund"
                              ? "text-emerald-600" : "text-red-600"
                          }`}>
                            {tx.type === "income" || tx.type === "bonus" || tx.type === "refund" ? "+" : "-"}{fmt(amount)} сум
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </DispatcherLayout>
  );
}
