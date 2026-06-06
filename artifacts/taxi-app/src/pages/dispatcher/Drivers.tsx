import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { useAuth } from "@/hooks/use-auth";
import { 
  Star, Phone, Car, Search, X, Plus, Loader2, RefreshCw,
  Crown, AlertTriangle, UserPlus, Shield, ChevronRight,
  ArrowLeft, MapPin, Calendar, Hash, Ban, Filter, Pencil,
  Zap, AlertCircle, Copy, Check, KeyRound,
  Settings, Lock, Unlock, PhoneCall, Wallet, CreditCard,
  Clock, TrendingUp, Activity, FileText, Trash2, Camera } from "lucide-react";
import { CardGridSkeleton, ErrorState } from "@/components/PageStates";
import { toast } from "sonner";
import DriverFormModal from "@/components/DriverFormModal";

const BASE_URL = import.meta.env.BASE_URL || "";

const STATUS_MAP: Record<string, { label: string; dot: string }> = {
  online:  { label: "Онлайн",  dot: "bg-emerald-500" },
  busy:    { label: "В пути",  dot: "bg-amber-500" },
  offline: { label: "Офлайн",  dot: "bg-zinc-400" },
};

const GROUP_MAP: Record<string, { label: string; cls: string; icon: any }> = {
  top:     { label: "TOP",        cls: "bg-amber-500/10 text-amber-700 border-amber-500/20",    icon: Crown },
  problem: { label: "Проблемный", cls: "bg-red-500/10 text-red-700 border-red-500/20",          icon: AlertTriangle },
  new:     { label: "Новый",      cls: "bg-violet-500/10 text-violet-700 border-violet-500/20", icon: UserPlus },
};

const CAR_CLASS_RU: Record<string, string> = { economy: "Эконом", comfort: "Комфорт", business: "Бизнес" };

const AUDIT_FIELD_RU: Record<string, string> = {
  phone: "Телефон", carBrand: "Марка", carModel: "Модель", carNumber: "Гос. номер",
  carColor: "Цвет авто", carClass: "Класс", carYear: "Год", seats: "Мест",
  city: "Город", firstName: "Имя", lastName: "Фамилия", balance: "Баланс",
  commissionRate: "Комиссия", password: "Пароль",
};

type CRMDriver = {
  id: number; name: string; phone: string; status: string;
  carModel: string | null; carNumber: string | null; carColor: string | null; carClass: string | null;
  seats: number | null; balance: string | null;
  rating: number | null; totalRides: number | null;
  acceptedOrders: number | null; cancelledOrders: number | null;
  activityScore: number | null; createdAt: string;
  callsign: string; ridesToday: number; ridesWeek: number;
  completedRides: number; cancelledRides: number;
  acceptanceRate: number; cancelRate: number; reliabilityScore: number;
  group: string; groupId: number | null; activityLevel: string;
  todayEarnings: number; totalEarnings: number;
  routeCities: string[];
  bannedUntil: string | null;
  carBrand: string | null;
};

type DriverProfile = CRMDriver & {
  finance: {
    balance: number; todayEarnings: number; weekEarnings: number;
    monthEarnings: number; totalEarnings: number;
    totalCommission: number; totalPenalties: number;
  };
  recentRides: any[];
};

function formatPhone998(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("998")) digits = digits;
  else if (digits.startsWith("8") && digits.length <= 10) digits = "998" + digits.slice(1);
  else if (!digits.startsWith("998")) digits = "998" + digits;
  digits = digits.slice(0, 12);

  let formatted = "+998";
  const rest = digits.slice(3);
  if (rest.length > 0) formatted += " " + rest.slice(0, 2);
  if (rest.length > 2) formatted += " " + rest.slice(2, 5);
  if (rest.length > 5) formatted += " " + rest.slice(5, 7);
  if (rest.length > 7) formatted += " " + rest.slice(7, 9);
  return formatted;
}

function getDriverFlags(d: CRMDriver): { isBlocked: boolean; hasDebt: boolean } {
  const isBlocked = d.bannedUntil ? new Date(d.bannedUntil) > new Date() : false;
  const hasDebt = parseFloat(d.balance || "0") < 0;
  return { isBlocked, hasDebt };
}

function useCRMDrivers(token: string | null) {
  const [data, setData] = useState<{ drivers: CRMDriver[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetch_ = useCallback(async () => {
    try {
      setError(false);
      const resp = await fetch(`${BASE_URL}api/drivers/crm`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error("fetch failed");
      setData(await resp.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetch_();
    const id = setInterval(fetch_, 15000);
    return () => clearInterval(id);
  }, [fetch_]);

  return { data, loading, error, refetch: fetch_ };
}

function useDriverProfile(id: number | null, token: string | null) {
  const [data, setData] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchProfile = useCallback(() => {
    if (!id) { setData(null); return; }
    setLoading(true);
    setError(false);
    fetch(`${BASE_URL}api/drivers/crm/${id}/profile`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => {
      if (!r.ok) throw new Error("fetch failed");
      return r.json();
    }).then(d => setData(d)).catch(() => { setData(null); setError(true); }).finally(() => setLoading(false));
  }, [id, token]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  return { data, loading, error, refetch: fetchProfile };
}

function QuickAddPanel({ token, onClose, onCreated }: { token: string | null; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+998 ");
  const [carBrand, setCarBrand] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ name: string; phone: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handlePhoneInput = (raw: string) => {
    if (raw.length < 4) { setPhone("+998 "); return; }
    setPhone(formatPhone998(raw));
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Укажите имя"); return; }
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 12) { toast.error("Введите полный номер (+998 XX XXX XX XX)"); return; }
    if (!carNumber.trim()) { toast.error("Укажите гос. номер машины"); return; }

    setSaving(true);
    try {
      const resp = await fetch(`${BASE_URL}api/drivers/admin/quick-create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: "+" + phoneDigits,
          carBrand: carBrand.trim() || undefined,
          carModel: carModel.trim() || undefined,
          carNumber: carNumber.trim() || undefined,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => null);
        throw new Error(err?.message || "Ошибка");
      }

      const data = await resp.json();
      setResult({ name: data.name, phone: data.phone, password: data.generatedPassword });
      toast.success("Водитель добавлен");
      onCreated();
    } catch (err: any) {
      toast.error(err.message || "Ошибка создания");
    } finally {
      setSaving(false);
    }
  };

  const copyCredentials = () => {
    if (!result) return;
    navigator.clipboard.writeText(`Логин: ${result.phone}\nПароль: ${result.password}`);
    setCopied(true);
    toast.success("Скопировано");
    setTimeout(() => setCopied(false), 2000);
  };

  if (result) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{result.name} добавлен</p>
              <p className="text-xs text-muted-foreground">Отправьте данные для входа водителю</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Логин: <span className="font-mono text-foreground">{result.phone}</span></p>
            <p className="text-xs text-muted-foreground">Пароль: <span className="font-mono text-foreground">{result.password}</span></p>
          </div>
          <button onClick={copyCredentials}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Готово" : "Скопировать"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium text-foreground">Быстрое добавление</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          placeholder="Имя Фамилия *"
          className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground outline-none focus:border-emerald-500 transition-colors placeholder:text-muted-foreground" />
        <input value={phone} onChange={e => handlePhoneInput(e.target.value)}
          placeholder="+998 XX XXX XX XX"
          className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground outline-none focus:border-emerald-500 transition-colors placeholder:text-muted-foreground font-mono" />
        <input value={carBrand} onChange={e => setCarBrand(e.target.value)}
          placeholder="Марка (Chevrolet)"
          className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground outline-none focus:border-emerald-500 transition-colors placeholder:text-muted-foreground" />
        <input value={carModel} onChange={e => setCarModel(e.target.value)}
          placeholder="Модель (Cobalt)"
          className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground outline-none focus:border-emerald-500 transition-colors placeholder:text-muted-foreground" />
        <div className="flex gap-2 col-span-2 sm:col-span-1">
          <input value={carNumber} onChange={e => setCarNumber(e.target.value)}
            placeholder="01 A 123 BB *"
            required
            className={`flex-1 border rounded-lg px-3 py-2 text-sm bg-card text-foreground outline-none focus:border-emerald-500 transition-colors placeholder:text-muted-foreground font-mono ${carNumber.trim() ? "border-border" : "border-amber-400 bg-amber-50/30"}`} />
          <button onClick={handleSave} disabled={saving}
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 transition-colors shrink-0 flex items-center gap-1">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">Пароль генерируется автоматически. Детали можно дополнить позже через редактирование.</p>
    </div>
  );
}

function GenerateLoginCode({ driverId, token }: { driverId: number; token: string | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expiresIn, setExpiresIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const handleGenerate = async () => {
    if (!token) return;
    setGenerating(true);
    try {
      const res = await fetch(`${BASE_URL}api/auth/driver-code/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ driverId }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.message || "Ошибка генерации кода"); return; }
      setCode(data.code);
      setExpiresIn(data.expiresInSeconds);
      setCopied(false);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setExpiresIn(prev => {
          if (prev <= 1) { if (timerRef.current) clearInterval(timerRef.current); setCode(null); return 0; }
          return prev - 1;
        });
      }, 1000);
      toast.success(`Код сгенерирован для ${data.driverName}`);
    } catch (e: any) {
      console.error("[generate-code] error:", e);
      toast.error(`Ошибка: ${e?.message || "сеть"}`);
    } finally { setGenerating(false); }
  };

  const handleCopy = () => {
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Код скопирован");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!code) {
    return (
      <button onClick={handleGenerate} disabled={generating}
        className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg bg-violet-500/10 hover:bg-violet-500/15 text-violet-700 border border-violet-500/20 transition-colors text-sm font-medium disabled:opacity-50">
        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        Сгенерировать код входа
      </button>
    );
  }

  return (
    <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">Код входа для водителя</span>
        <span className="text-[10px] text-violet-600 font-medium">{Math.floor(expiresIn / 60)}:{String(expiresIn % 60).padStart(2, "0")}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold tracking-[0.25em] text-violet-700 font-mono flex-1">{code}</span>
        <button onClick={handleCopy}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-violet-500 text-white hover:bg-violet-600 transition-colors">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">Продиктуйте код водителю. Код одноразовый, действует 2 мин.</p>
      <button onClick={handleGenerate} disabled={generating}
        className="text-[11px] text-violet-600 hover:text-violet-700 font-medium">
        {generating ? "Генерация..." : "Новый код"}
      </button>
    </div>
  );
}

function BlockDialog({ driverId, token, onDone, onCancel }: { driverId: number; token: string | null; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("24");
  const [blocking, setBlocking] = useState(false);

  const handleSubmit = async () => {
    if (!reason.trim()) { toast.error("Укажите причину блокировки"); return; }
    setBlocking(true);
    try {
      const resp = await fetch(`${BASE_URL}api/drivers/admin/block/${driverId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ reason: reason.trim(), hours: parseInt(hours) || 24 }),
      });
      if (!resp.ok) throw new Error();
      toast.success("Водитель заблокирован");
      onDone();
    } catch { toast.error("Ошибка блокировки"); } finally { setBlocking(false); }
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-4 h-4 text-red-600" />
        <span className="text-sm font-bold text-red-700">Блокировка водителя</span>
      </div>
      <div>
        <label className="text-xs text-zinc-500 mb-1 block font-medium">Причина *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Укажите причину блокировки..."
          rows={2}
          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white text-zinc-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-200 transition-colors placeholder:text-zinc-400 resize-none" />
      </div>
      <div>
        <label className="text-xs text-zinc-500 mb-1 block font-medium">Срок блокировки</label>
        <select value={hours} onChange={e => setHours(e.target.value)}
          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white text-zinc-900 outline-none focus:border-red-500 transition-colors">
          <option value="1">1 час</option>
          <option value="2">2 часа</option>
          <option value="4">4 часа</option>
          <option value="8">8 часов</option>
          <option value="12">12 часов</option>
          <option value="24">24 часа (1 день)</option>
          <option value="48">48 часов (2 дня)</option>
          <option value="72">72 часа (3 дня)</option>
          <option value="168">1 неделя</option>
          <option value="720">1 месяц</option>
          <option value="8760">1 год</option>
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 text-zinc-600 transition-colors">
          Отмена
        </button>
        <button onClick={handleSubmit} disabled={blocking}
          className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
          {blocking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
          Заблокировать
        </button>
      </div>
    </div>
  );
}

const TX_TYPE_MAP: Record<string, { label: string; color: string }> = {
  income: { label: "Доход", color: "text-emerald-600" },
  bonus: { label: "Бонус", color: "text-emerald-600" },
  commission: { label: "Комиссия", color: "text-red-600" },
  penalty: { label: "Штраф", color: "text-red-600" },
  withdraw: { label: "Вывод", color: "text-orange-600" },
  refund: { label: "Возврат", color: "text-blue-600" },
  adjust: { label: "Корректировка", color: "text-violet-600" },
};

function FinancePanel({ driverId, token, balance, refetch }: { driverId: number; token: string | null; balance: number; refetch: () => void }) {
  const fmt = (n: number) => n.toLocaleString("ru-RU");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustComment, setAdjustComment] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  const loadTx = useCallback(() => {
    if (!token) return;
    setTxLoading(true);
    fetch(`${BASE_URL}api/drivers/${driverId}/finance`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => { if (d.transactions) setTransactions(d.transactions); })
      .catch(() => {})
      .finally(() => setTxLoading(false));
  }, [driverId, token]);

  useEffect(() => { loadTx(); }, [loadTx]);

  const handleAdjust = async (isTopup: boolean) => {
    if (!token) return;
    const num = parseFloat(adjustAmount);
    if (!num || num <= 0) { toast.error("Укажите сумму больше 0"); return; }
    const commentText = adjustComment.trim();
    if (!isTopup && !window.confirm(`Списать ${fmt(num)} сум с баланса?${commentText ? `\nКомментарий: ${commentText}` : ""}`)) return;
    setAdjusting(true);
    try {
      const resp = await fetch(`${BASE_URL}api/drivers/${driverId}/finance/adjust`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: isTopup ? num : -num, reason: commentText }),
      });
      const text = await resp.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      if (!resp.ok) throw new Error(data.message || `Ошибка (${resp.status})`);
      toast.success(isTopup ? `Пополнено на ${fmt(num)} сум` : `Списано ${fmt(num)} сум`);
      setAdjustAmount(""); setAdjustComment("");
      refetch();
      loadTx();
    } catch (e: any) { toast.error(e.message || "Ошибка"); } finally { setAdjusting(false); }
  };

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    transactions.forEach(tx => {
      const d = new Date(tx.createdAt);
      const key = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    });
    return Object.entries(groups).map(([date, items]) => ({ date, items }));
  }, [transactions]);

  const isPositive = balance >= 0;

  return (
    <div className="space-y-4">
      <div className={`rounded-xl p-5 ${isPositive ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
        <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Баланс</span>
        <p className={`text-3xl font-extrabold tracking-tight mt-1 ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
          {fmt(balance)} <span className="text-sm font-medium text-zinc-400">сум</span>
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 p-4 space-y-3">
        <p className="text-sm font-extrabold text-zinc-700">Пополнение / Списание</p>
        <input type="number" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)}
          placeholder="Сумма" min="1"
          className="w-full px-4 py-3 rounded-xl border border-zinc-200 bg-white text-base font-bold text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent" />
        <div className="flex flex-wrap gap-1.5">
          {[10000, 50000, 100000, 200000, 500000, 1000000].map(v => (
            <button key={v} type="button" onClick={() => setAdjustAmount(String(v))}
              className="px-2.5 py-1 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-emerald-50 hover:border-emerald-300 text-xs font-bold text-zinc-700 transition-colors">
              {v.toLocaleString("ru-RU")}
            </button>
          ))}
        </div>
        <textarea value={adjustComment} onChange={e => setAdjustComment(e.target.value)}
          placeholder="Комментарий (необязательно)" rows={2}
          className="w-full px-4 py-3 rounded-xl border border-zinc-200 bg-white text-sm font-medium text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent resize-none" />
        <div className="flex flex-wrap gap-1.5">
          {["Пополнение","Бонус","Возврат","Штраф","Комиссия","Аренда"].map(t => (
            <button key={t} type="button" onClick={() => setAdjustComment(t)}
              className="px-2.5 py-1 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-emerald-50 hover:border-emerald-300 text-xs font-semibold text-zinc-600 transition-colors">
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleAdjust(true)} disabled={adjusting}
            className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm">
            {adjusting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "+ Пополнить"}
          </button>
          <button onClick={() => handleAdjust(false)} disabled={adjusting}
            className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm">
            {adjusting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "− Списать"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
          <p className="text-sm font-extrabold text-zinc-700">История операций</p>
        </div>
        {txLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
        ) : transactions.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-400">Нет операций</div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto">
            {grouped.map(group => (
              <div key={group.date}>
                <div className="px-4 py-2 bg-zinc-50/80 border-b border-zinc-100 sticky top-0">
                  <span className="text-xs font-bold text-zinc-400 uppercase">{group.date}</span>
                </div>
                {group.items.map((tx: any) => {
                  const info = TX_TYPE_MAP[tx.type] || { label: tx.type, color: "text-zinc-600" };
                  const amount = parseFloat(tx.amount || "0");
                  const isIncome = ["income", "bonus", "refund"].includes(tx.type);
                  const time = new Date(tx.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <div key={tx.id} className="px-4 py-3 border-b border-zinc-100 last:border-b-0 hover:bg-zinc-50/50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${info.color}`}>{info.label}</span>
                            <span className="text-xs text-zinc-400">{time}</span>
                          </div>
                          {tx.description && (
                            <p className="text-xs text-zinc-500 mt-0.5 truncate">{tx.description}</p>
                          )}
                        </div>
                        <span className={`text-base font-extrabold tabular-nums ${isIncome ? "text-emerald-600" : "text-red-600"}`}>
                          {isIncome ? "+" : "−"}{fmt(Math.round(amount))}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CashCarrierToggle({ driverId, token, initial, onChanged }: { driverId: number; token: string | null; initial: boolean; onChanged: () => void }) {
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setOn(initial); }, [initial]);
  const toggle = async () => {
    if (saving) return;
    const next = !on;
    setSaving(true);
    try {
      const resp = await fetch(`${BASE_URL}api/drivers/admin/${driverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ cashCarrier: next }),
      });
      if (!resp.ok) throw new Error("failed");
      setOn(next);
      toast.success(next ? "Доверенный для перевозки денег" : "Перевозка денег отключена");
      onChanged();
    } catch {
      toast.error("Не удалось сохранить");
    } finally { setSaving(false); }
  };
  return (
    <div className={`flex items-center gap-3 py-3 px-3 rounded-xl border ${on ? "bg-emerald-50 border-emerald-200" : "bg-zinc-50 border-zinc-200"}`}>
      <span className="text-2xl">💵</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-zinc-900">Перевозка денег</p>
        <p className="text-[11px] text-zinc-500">{on ? "Получает заказы с деньгами" : "Заказы с деньгами не получает"}</p>
      </div>
      <button onClick={toggle} disabled={saving}
        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-zinc-300"}`}>
        <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${on ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function DriverProfilePanel({ driverId, token, onClose, onDeleted }: { driverId: number; token: string | null; onClose: () => void; onDeleted?: () => void }) {
  const { data: profile, loading, error, refetch } = useDriverProfile(driverId, token);
  const [tab, setTab] = useState<"info" | "stats" | "history" | "finance">("info");
  const [showLoginCode, setShowLoginCode] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [photoControlSending, setPhotoControlSending] = useState(false);
  const [photoControlActive, setPhotoControlActive] = useState<boolean | null>(null);

  const fetchPhotoControlStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${BASE_URL}api/photo-control/request-driver/${driverId}/status`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      setPhotoControlActive(!!data.hasActive);
    } catch {}
  }, [driverId, token]);

  useEffect(() => { fetchPhotoControlStatus(); }, [fetchPhotoControlStatus]);

  const handlePhotoControl = async () => {
    if (photoControlSending) return;

    if (photoControlActive) {
      if (!window.confirm("Отменить запрос фотоконтроля у этого водителя?")) return;
      setPhotoControlSending(true);
      try {
        const resp = await fetch(`${BASE_URL}api/photo-control/request-driver/${driverId}`, {
          method: "DELETE",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || "Ошибка");
        toast.success("Запрос фотоконтроля отменён");
        setPhotoControlActive(false);
      } catch (err: any) {
        toast.error(err.message || "Не удалось отменить запрос");
      } finally {
        setPhotoControlSending(false);
      }
      return;
    }

    setPhotoControlSending(true);
    try {
      const resp = await fetch(`${BASE_URL}api/photo-control/request-driver/${driverId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || "Ошибка");
      if (data.created === false) {
        toast.info(data.message || "У водителя уже есть активный запрос");
      } else {
        toast.success("Запрос фотоконтроля отправлен");
      }
      setPhotoControlActive(true);
    } catch (err: any) {
      toast.error(err.message || "Не удалось отправить запрос");
    } finally {
      setPhotoControlSending(false);
    }
  };

  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") { if (editMode) setEditMode(false); else onClose(); } };
    document.addEventListener("keydown", keyHandler);
    return () => { document.removeEventListener("keydown", keyHandler); };
  }, [editMode]);

  useEffect(() => {
    if (tab === "history" && token && auditLogs.length === 0 && !auditLoading) {
      setAuditLoading(true);
      fetch(`${BASE_URL}api/drivers/admin/${driverId}/audit`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).then(data => {
        if (Array.isArray(data)) setAuditLogs(data);
      }).catch(() => {}).finally(() => setAuditLoading(false));
    }
  }, [tab, driverId, token]);

  const handleUnblock = async () => {
    if (!token) return;
    setBlocking(true);
    try {
      const resp = await fetch(`${BASE_URL}api/drivers/admin/unblock/${driverId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error();
      toast.success("Разблокирован");
      refetch();
    } catch { toast.error("Ошибка"); } finally { setBlocking(false); }
  };

  const handleCall = () => { if (profile) window.open(`tel:${profile.phone}`, "_self"); };

  const handleDelete = async () => {
    if (!token) return;
    setDeleting(true);
    try {
      const resp = await fetch(`${BASE_URL}api/drivers/admin/delete/${driverId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.message || "Ошибка");
      }
      toast.success("Водитель удалён");
      onClose();
      onDeleted?.();
    } catch (e: any) { toast.error(e.message || "Ошибка удаления"); } finally { setDeleting(false); }
  };

  const flags = profile ? getDriverFlags(profile) : null;

  const blockReason = useMemo(() => {
    if (!flags?.isBlocked || auditLogs.length === 0) return null;
    const blockLog = auditLogs.find((l: any) => l.action === "block");
    if (!blockLog) return null;
    const details = blockLog.details || "";
    const match = details.match(/Причина:\s*(.+)/);
    return match ? match[1] : details;
  }, [flags?.isBlocked, auditLogs]);

  useEffect(() => {
    if (flags?.isBlocked && token && auditLogs.length === 0 && !auditLoading) {
      setAuditLoading(true);
      fetch(`${BASE_URL}api/drivers/admin/${driverId}/audit`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).then(data => {
        if (Array.isArray(data)) setAuditLogs(data);
      }).catch(() => {}).finally(() => setAuditLoading(false));
    }
  }, [flags?.isBlocked, driverId, token]);

  if (loading || (!profile && !error)) {
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-[79]" onClick={onClose} />
        <div className="fixed inset-y-0 right-0 w-full sm:w-[540px] z-[80] flex items-center justify-center bg-white shadow-2xl border-l border-zinc-200">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        </div>
      </>
    );
  }

  if (error || !profile) {
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-[79]" onClick={onClose} />
        <div className="fixed inset-y-0 right-0 w-full sm:w-[540px] z-[80] flex flex-col items-center justify-center gap-3 bg-white shadow-2xl border-l border-zinc-200">
          <AlertCircle className="w-6 h-6 text-zinc-400" />
          <p className="text-sm text-zinc-400">Не удалось загрузить</p>
          <button onClick={refetch} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Повторить</button>
        </div>
      </>
    );
  }

  const st = STATUS_MAP[profile.status] || STATUS_MAP.offline;
  const grp = GROUP_MAP[profile.group];
  const fmt = (n: number) => n.toLocaleString("ru-RU");
  const balance = profile.finance?.balance ?? parseFloat(profile.balance || "0");
  const isPositive = balance >= 0;
  const canAssign = profile.status === "online" && !flags?.isBlocked && isPositive;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[79]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full sm:w-[540px] z-[80] bg-white shadow-2xl flex flex-col border-l border-zinc-200 animate-in slide-in-from-right duration-200">

        <div className="shrink-0 px-5 pt-4 pb-0">
          <div className="flex items-center justify-between mb-5">
            <button onClick={() => { if (editMode) setEditMode(false); else onClose(); }} aria-label={editMode ? "Назад" : "Закрыть"}
              className="p-2 -ml-2 rounded-xl text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            {!editMode && (
              <div className="flex items-center gap-1">
                <button onClick={() => setEditMode(true)} aria-label="Редактировать"
                  className="w-10 h-10 rounded-xl bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center transition-all shadow-sm active:scale-95" title="Редактировать">
                  <Pencil className="w-4.5 h-4.5" />
                </button>
                <button onClick={() => { setShowLoginCode(v => !v); setShowBlockDialog(false); setTab("info"); }} aria-label="Код входа"
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 ${
                    showLoginCode ? "bg-amber-500 text-white ring-2 ring-amber-300" : "bg-amber-400 hover:bg-amber-500 text-white"
                  }`} title="Код входа">
                  <KeyRound className="w-4.5 h-4.5" />
                </button>
                <button onClick={handlePhotoControl} disabled={photoControlSending}
                  aria-label={photoControlActive ? "Отменить фотоконтроль" : "Запросить фотоконтроль"}
                  title={photoControlActive ? "Запрос отправлен — нажмите чтобы отменить" : "Запросить фотоконтроль"}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 disabled:opacity-60 relative ${
                    photoControlActive
                      ? "bg-emerald-500 hover:bg-rose-500 text-white ring-2 ring-emerald-300 hover:ring-rose-300"
                      : "bg-sky-500 hover:bg-sky-600 text-white"
                  }`}>
                  {photoControlSending
                    ? <Loader2 className="w-4.5 h-4.5 animate-spin" />
                    : <Camera className="w-4.5 h-4.5" />}
                  {photoControlActive && !photoControlSending && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-zinc-900 animate-pulse" />
                  )}
                </button>
                {flags?.isBlocked ? (
                  <button onClick={handleUnblock} disabled={blocking} aria-label="Разблокировать"
                    className="w-10 h-10 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-all shadow-sm active:scale-95" title="Разблокировать">
                    {blocking ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Unlock className="w-4.5 h-4.5" />}
                  </button>
                ) : (
                  <button onClick={() => { setShowBlockDialog(v => !v); setShowLoginCode(false); setTab("info"); }} aria-label="Заблокировать"
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm active:scale-95 ${
                      showBlockDialog ? "bg-orange-500 text-white ring-2 ring-orange-300" : "bg-orange-400 hover:bg-orange-500 text-white"
                    }`} title="Заблокировать">
                    <Lock className="w-4.5 h-4.5" />
                  </button>
                )}
                <button onClick={() => setShowDeleteConfirm(true)} aria-label="Удалить"
                  className="w-10 h-10 rounded-xl bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all shadow-sm active:scale-95" title="Удалить водителя">
                  <Trash2 className="w-4.5 h-4.5" />
                </button>
              </div>
            )}
            {editMode && (
              <span className="text-xs text-zinc-400 font-medium">Редактирование</span>
            )}
          </div>

          <div className="flex items-center gap-4 mb-4">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${
              profile.status === "online" ? "bg-emerald-50" :
              profile.status === "busy" ? "bg-amber-50" :
              "bg-zinc-100"
            }`}>
              <span className={`text-2xl font-extrabold ${
                profile.status === "online" ? "text-emerald-600" :
                profile.status === "busy" ? "text-amber-600" :
                "text-zinc-400"
              }`}>{profile.name.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-extrabold text-zinc-900 truncate leading-tight">{profile.name}</h2>
              <div className="flex items-center gap-2.5 mt-1.5">
                <span className="text-sm font-mono font-bold text-zinc-400">{profile.callsign}</span>
                {grp && (
                  <span className={`text-xs px-2.5 py-0.5 rounded-lg font-semibold ${
                    profile.group === "top" ? "bg-amber-100 text-amber-700" :
                    profile.group === "problem" ? "bg-red-100 text-red-700" :
                    "bg-violet-100 text-violet-700"
                  }`}>{grp.label}</span>
                )}
              </div>
            </div>
          </div>

          <div className={`rounded-xl px-4 py-3 mb-4 ${
            flags?.isBlocked ? "bg-red-50 border border-red-200" :
            profile.status === "online" ? "bg-emerald-50 border border-emerald-200" :
            profile.status === "busy" ? "bg-amber-50 border border-amber-200" :
            "bg-zinc-50 border border-zinc-200"
          }`}>
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full shrink-0 ${
                flags?.isBlocked ? "bg-red-500" :
                profile.status === "online" ? "bg-emerald-500 animate-pulse" :
                profile.status === "busy" ? "bg-amber-500" :
                "bg-zinc-400"
              }`} />
              <div className="flex-1 min-w-0">
                <span className={`text-base font-bold ${
                  flags?.isBlocked ? "text-red-700" :
                  profile.status === "online" ? "text-emerald-700" :
                  profile.status === "busy" ? "text-amber-700" :
                  "text-zinc-500"
                }`}>
                  {flags?.isBlocked ? "Заблокирован" : st.label}
                </span>
                {flags?.isBlocked && profile.bannedUntil && (
                  <span className="text-[11px] text-red-500 ml-2 font-medium">
                    до {new Date(profile.bannedUntil).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                {flags?.hasDebt && !flags?.isBlocked && (
                  <span className="text-[11px] text-orange-600 ml-2 font-medium">· Долг</span>
                )}
              </div>
              {canAssign && (
                <span className="text-[11px] text-emerald-600 font-semibold">Можно назначить</span>
              )}
            </div>
            {flags?.isBlocked && blockReason && (
              <div className="mt-2 pt-2 border-t border-red-200">
                <p className="text-xs text-red-600">
                  <span className="text-zinc-500 font-medium">Причина:</span> {blockReason}
                </p>
              </div>
            )}
          </div>
        </div>

        {!editMode && (
          <div className="shrink-0 px-5 pb-3">
            <div className="flex gap-1.5 bg-zinc-100 rounded-xl p-1">
              {([["info", "Инфо"], ["stats", "Статистика"], ["history", "История"], ["finance", "Финансы"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all duration-150 ${
                    tab === key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {editMode ? (
          <DriverFormModal
            token={token}
            editDriver={profile}
            panelMode
            onClose={() => setEditMode(false)}
            onSaved={() => { setEditMode(false); refetch(); }}
          />
        ) : (
        <>
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {tab === "info" && (
            <div className="space-y-4">
              {showBlockDialog && (
                <BlockDialog driverId={driverId} token={token}
                  onDone={() => { setShowBlockDialog(false); refetch(); setAuditLogs([]); }}
                  onCancel={() => setShowBlockDialog(false)} />
              )}

              <div className={`rounded-xl p-5 ${isPositive ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Баланс</span>
                  <button onClick={() => setTab("finance")}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95 bg-white/70 hover:bg-white text-zinc-500 hover:text-zinc-700">
                    <Wallet className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />Изменить
                  </button>
                </div>
                <p className={`text-3xl font-extrabold tracking-tight mt-1 ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
                  {fmt(balance)} <span className="text-sm font-medium text-zinc-400">сум</span>
                </p>
              </div>

              <div className="flex items-center gap-3 py-3 border-b border-zinc-100">
                <Car className="w-5 h-5 text-zinc-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-zinc-900 truncate">
                    {profile.carBrand ? `${profile.carBrand} ` : ""}{profile.carModel || "—"}
                    {profile.carColor ? <span className="text-zinc-400 font-normal"> · {profile.carColor}</span> : null}
                  </p>
                </div>
                {profile.carNumber && (
                  <span className="text-sm font-mono font-bold text-zinc-800 bg-zinc-100 px-3 py-1.5 rounded-lg border border-zinc-200 shrink-0">
                    {profile.carNumber}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 py-3 border-b border-zinc-100">
                <Phone className="w-5 h-5 text-zinc-400 shrink-0" />
                <button onClick={handleCall} className="text-base font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                  {profile.phone}
                </button>
              </div>

              <div className="flex items-center gap-3 py-3">
                <Star className="w-5 h-5 text-amber-500 fill-amber-500 shrink-0" />
                <span className="text-base font-bold text-zinc-900">{profile.rating?.toFixed(1) || "5.0"}</span>
                <span className="text-sm font-medium text-zinc-500">{profile.totalRides || 0} поездок</span>
              </div>

              {/* cash_carrier_toggle */}
              <CashCarrierToggle driverId={driverId} token={token} initial={!!(profile as any).cashCarrier} onChanged={() => refetch()} />

              {profile.routeCities && profile.routeCities.length > 0 && (
                <div className="flex items-start gap-3 py-3">
                  <MapPin className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
                  <p className="text-base text-zinc-600 font-medium">{profile.routeCities.join(" · ")}</p>
                </div>
              )}

              {showLoginCode && (
                <div className="pt-2">
                  <GenerateLoginCode driverId={driverId} token={token} />
                </div>
              )}
            </div>
          )}

          {tab === "stats" && (
            <div className="space-y-4">
              {profile.finance && (
                <div className="space-y-2">
                  <p className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Заработок</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-100">
                      <p className="text-lg font-bold text-zinc-900">{fmt(profile.finance.todayEarnings)}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 font-medium">Сегодня</p>
                    </div>
                    <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-100">
                      <p className="text-lg font-bold text-zinc-900">{fmt(profile.finance.weekEarnings)}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 font-medium">Неделя</p>
                    </div>
                    <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-100">
                      <p className="text-lg font-bold text-zinc-900">{fmt(profile.finance.monthEarnings)}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 font-medium">Месяц</p>
                    </div>
                    <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                      <p className="text-lg font-bold text-red-600">−{fmt(profile.finance.totalCommission)}</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 font-medium">Комиссия</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Поездки</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-100">
                    <p className="text-lg font-bold text-zinc-900">{profile.ridesToday}</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 font-medium">Сегодня</p>
                  </div>
                  <div className="bg-zinc-50 rounded-xl p-3 border border-zinc-100">
                    <p className="text-lg font-bold text-zinc-900">{profile.ridesWeek}</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 font-medium">Неделя</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">Качество</p>
                <div className="space-y-1 bg-zinc-50 rounded-xl p-3 border border-zinc-100">
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-zinc-500 font-medium">Принятие</span>
                    <span className="text-sm font-bold text-zinc-900">{profile.acceptanceRate}%</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-zinc-500 font-medium">Отмены</span>
                    <span className={`text-sm font-bold ${profile.cancelRate > 20 ? "text-red-600" : "text-zinc-900"}`}>{profile.cancelRate}%</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-zinc-500 font-medium">Надёжность</span>
                    <span className="text-sm font-bold text-zinc-900">{profile.reliabilityScore}%</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 text-xs text-zinc-400 flex items-center gap-1.5 font-medium">
                <Calendar className="w-3.5 h-3.5" />
                С {new Date(profile.createdAt).toLocaleDateString("ru-RU")}
              </div>
            </div>
          )}

          {tab === "finance" && (
            <FinancePanel driverId={driverId} token={token} balance={balance} refetch={refetch} />
          )}

          {tab === "history" && (
            <div className="space-y-5">
              {auditLogs.length > 0 && (
                <div>
                  <p className="text-[11px] text-zinc-400 uppercase tracking-wider mb-2 font-semibold">Журнал изменений</p>
                  <div className="space-y-0.5">
                    {auditLogs.map((log: any) => (
                      <div key={log.id} className="flex items-start gap-2.5 py-2 px-2.5 rounded-lg hover:bg-zinc-50 transition-colors">
                        <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                          log.action === "create" ? "bg-emerald-500" :
                          log.action === "edit" ? "bg-blue-500" :
                          log.action === "block" ? "bg-red-500" :
                          log.action === "unblock" ? "bg-emerald-500" :
                          log.action === "generate_code" ? "bg-amber-500" :
                          "bg-zinc-400"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-800 font-medium">
                            {log.action === "create" ? "Создан" :
                             log.action === "edit" ? `${AUDIT_FIELD_RU[log.field] || log.field}: ${log.oldValue || "—"} → ${log.newValue || "—"}` :
                             log.action === "block" ? "Заблокирован" :
                             log.action === "unblock" ? "Разблокирован" :
                             log.action === "generate_code" ? "Код входа сгенерирован" :
                             log.details || log.action}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                            <span>{log.actorName || `#${log.actorId}`}</span>
                            <span>·</span>
                            <span>{new Date(log.createdAt).toLocaleDateString("ru-RU")} {new Date(log.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {auditLoading && (
                <div className="text-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-400 mx-auto" />
                </div>
              )}
              <div>
                <p className="text-[11px] text-zinc-400 uppercase tracking-wider mb-2 font-semibold">Последние поездки</p>
                {profile.recentRides.length === 0 ? (
                  <div className="text-center py-8">
                    <Clock className="w-5 h-5 text-zinc-300 mx-auto mb-1.5" />
                    <p className="text-xs text-zinc-400">Нет поездок</p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {profile.recentRides.map((ride: any) => (
                      <div key={ride.id} className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-zinc-50 transition-colors">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          ride.status === "completed" ? "bg-emerald-500" :
                          ride.status === "cancelled" ? "bg-red-500" :
                          ride.status === "in_progress" ? "bg-blue-500" : "bg-zinc-400"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 text-sm text-zinc-800 font-medium">
                            <span className="truncate">{ride.fromCity}</span>
                            <ChevronRight className="w-3 h-3 text-zinc-400 shrink-0" />
                            <span className="truncate">{ride.toCity}</span>
                          </div>
                          <span className="text-[11px] text-zinc-400">
                            {new Date(ride.createdAt).toLocaleDateString("ru-RU")} {new Date(ride.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {ride.price ? (
                          <span className="text-sm font-bold text-zinc-700 shrink-0">{fmt(Math.round(ride.price))}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {showDeleteConfirm && (
          <div className="shrink-0 mx-5 mb-3 p-4 rounded-xl bg-red-50 border border-red-200">
            <p className="text-sm text-red-700 font-bold mb-1">Удалить водителя?</p>
            <p className="text-xs text-zinc-500 mb-3">Водитель «{profile.name}» будет удалён без возможности восстановления.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 px-3 py-2.5 rounded-xl bg-zinc-100 text-zinc-600 text-xs font-semibold hover:bg-zinc-200 transition-colors">Отмена</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 px-3 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors disabled:opacity-50">
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Да, удалить"}
              </button>
            </div>
          </div>
        )}
        <div className="shrink-0 px-5 py-3 border-t border-zinc-200 flex gap-2">
          <button onClick={handleCall}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-sm font-semibold transition-colors border border-blue-200">
            <PhoneCall className="w-4 h-4" />Позвонить
          </button>
        </div>
        </>
        )}
      </div>
    </>
  );
}

export default function Drivers() {
  const { token } = useAuth();
  const { data, loading, error, refetch } = useCRMDrivers(token);
  const allDrivers = data?.drivers || [];

  const [showFormModal, setShowFormModal] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [search, setSearch] = useState(() => { try { return localStorage.getItem("disp_drivers_search") || ""; } catch { return ""; } });
  const [plateSearch, setPlateSearch] = useState(() => { try { return localStorage.getItem("disp_drivers_plate_search") || ""; } catch { return ""; } });
  useEffect(() => { try { localStorage.setItem("disp_drivers_search", search); } catch {} }, [search]);
  useEffect(() => { try { localStorage.setItem("disp_drivers_plate_search", plateSearch); } catch {} }, [plateSearch]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [ratingFilter, setRatingFilter] = useState<string | null>(null);
  const [missingPlateOnly, setMissingPlateOnly] = useState(false);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const cities = useMemo(() => {
    const s = new Set<string>();
    allDrivers.forEach(d => d.routeCities?.forEach(c => s.add(c)));
    return Array.from(s).sort();
  }, [allDrivers]);

  const drivers = useMemo(() => {
    let list = allDrivers;
    if (statusFilter) {
      if (statusFilter === "blocked") list = list.filter(d => getDriverFlags(d).isBlocked);
      else if (statusFilter === "debt") list = list.filter(d => getDriverFlags(d).hasDebt);
      else list = list.filter(d => d.status === statusFilter);
    }
    if (groupFilter) list = list.filter(d => d.group === groupFilter);
    if (activityFilter) list = list.filter(d => d.activityLevel === activityFilter);
    if (cityFilter) list = list.filter(d => d.routeCities?.includes(cityFilter));
    if (ratingFilter) {
      if (ratingFilter === "high") list = list.filter(d => (d.rating || 5) >= 4.5);
      else if (ratingFilter === "mid") list = list.filter(d => (d.rating || 5) >= 3.5 && (d.rating || 5) < 4.5);
      else list = list.filter(d => (d.rating || 5) < 3.5);
    }
    if (missingPlateOnly) list = list.filter(d => !d.carNumber || !d.carNumber.trim());
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.phone.includes(q) ||
        d.callsign.toLowerCase().includes(q)
      );
    }
    if (plateSearch.trim()) {
      const pq = plateSearch.toLowerCase().replace(/\s+/g, "");
      list = list.filter(d => (d.carNumber || "").toLowerCase().replace(/\s+/g, "").includes(pq));
    }
    return list;
  }, [allDrivers, statusFilter, groupFilter, activityFilter, cityFilter, ratingFilter, missingPlateOnly, search, plateSearch]);

  useEffect(() => { setPage(1); }, [statusFilter, groupFilter, activityFilter, cityFilter, ratingFilter, missingPlateOnly, search, plateSearch]);
  useEffect(() => { setPage(p => Math.min(p, Math.max(1, Math.ceil(drivers.length / PAGE_SIZE) || 1))); }, [drivers.length]);

  const totalPages = Math.max(1, Math.ceil(drivers.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const pagedDrivers = drivers.slice((effectivePage - 1) * PAGE_SIZE, effectivePage * PAGE_SIZE);

  const counts = useMemo(() => ({
    online: allDrivers.filter(d => d.status === "online").length,
    busy: allDrivers.filter(d => d.status === "busy").length,
    offline: allDrivers.filter(d => d.status === "offline").length,
    blocked: allDrivers.filter(d => getDriverFlags(d).isBlocked).length,
    debt: allDrivers.filter(d => getDriverFlags(d).hasDebt).length,
    missingPlate: allDrivers.filter(d => !d.carNumber || !d.carNumber.trim()).length,
  }), [allDrivers]);

  const hasFilters = statusFilter || groupFilter || activityFilter || ratingFilter || cityFilter || missingPlateOnly;

  return (
    <DispatcherLayout>
      {showFormModal && (
        <DriverFormModal
          token={token}
          onClose={() => setShowFormModal(false)}
          onSaved={() => refetch()}
        />
      )}
      {profileId && (
        <DriverProfilePanel
          driverId={profileId}
          token={token}
          onClose={() => setProfileId(null)}
          onDeleted={() => { setProfileId(null); refetch(); }}
        />
      )}

      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-2xl font-extrabold text-foreground">Водители</h2>
            <p className="text-sm text-muted-foreground font-medium mt-0.5">{allDrivers.length} всего · {counts.online} онлайн · {counts.busy} в пути</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input value={plateSearch} onChange={e => setPlateSearch(e.target.value)}
                placeholder="Гос. номер"
                className="bg-card border border-emerald-300 pl-3 pr-7 py-1.5 text-xs font-mono uppercase rounded-lg focus:outline-none focus:border-emerald-500 w-32 placeholder:normal-case placeholder:font-sans" />
              {plateSearch && (
                <button onClick={() => setPlateSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="bg-card border border-border pl-8 pr-7 py-1.5 text-xs rounded-lg focus:outline-none focus:border-emerald-500 w-44" />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button onClick={() => setMissingPlateOnly(v => !v)} title="Только водители без гос.номера"
              className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors flex items-center gap-1 ${missingPlateOnly ? "bg-amber-500 border-amber-500 text-white shadow-sm" : "bg-card border-amber-300 text-amber-600 hover:bg-amber-50"}`}>
              <span>Без №</span>
              <span className={`text-[10px] ${missingPlateOnly ? "text-white/90" : "text-amber-500"}`}>({counts.missingPlate})</span>
            </button>
            <button onClick={() => setShowFilters(!showFilters)}
              className={`p-1.5 rounded-lg border text-xs ${hasFilters ? "border-emerald-500/30 text-emerald-600" : "border-border text-muted-foreground hover:text-foreground"}`}>
              <Filter className="w-4 h-4" />
            </button>
            <button onClick={() => refetch()} className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowQuickAdd(v => !v)}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              title="Быстрое добавление">
              <Zap className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setShowFormModal(true)}
              className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
              <Plus className="w-3.5 h-3.5" />Добавить
            </button>
          </div>
        </div>

        {showQuickAdd && (
          <QuickAddPanel token={token} onClose={() => setShowQuickAdd(false)} onCreated={() => refetch()} />
        )}

        <div className="flex gap-2 mb-4 flex-wrap">
          {(["online", "busy", "offline"] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                statusFilter === s ? "bg-zinc-900 text-white shadow-md" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}>
              <span className={`w-2 h-2 rounded-full ${STATUS_MAP[s].dot}`} />
              {STATUS_MAP[s].label}
              <span className={`text-xs ${statusFilter === s ? "text-zinc-400" : "text-zinc-400"}`}>({counts[s]})</span>
            </button>
          ))}
          <span className="w-px h-8 bg-zinc-200 self-center mx-1" />
          <button onClick={() => setStatusFilter(statusFilter === "blocked" ? null : "blocked")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              statusFilter === "blocked" ? "bg-red-600 text-white shadow-md" : "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
            }`}>
            <Ban className="w-4 h-4" />Блокированные
            <span className={`text-xs ${statusFilter === "blocked" ? "text-red-200" : "text-red-400"}`}>({counts.blocked})</span>
          </button>
          {counts.debt > 0 && (
            <button onClick={() => setStatusFilter(statusFilter === "debt" ? null : "debt")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                statusFilter === "debt" ? "bg-orange-600 text-white shadow-md" : "bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-200"
              }`}>
              <AlertCircle className="w-4 h-4" />Долг
              <span className={`text-xs ${statusFilter === "debt" ? "text-orange-200" : "text-orange-400"}`}>({counts.debt})</span>
            </button>
          )}
          <span className="w-px h-8 bg-zinc-200 self-center mx-1" />
          {(["top", "problem", "new"] as const).map(g => {
            const info = GROUP_MAP[g];
            return (
              <button key={g} onClick={() => setGroupFilter(groupFilter === g ? null : g)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  groupFilter === g ? `${info.cls} shadow-md ring-1` : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}>
                <info.icon className="w-4 h-4" />{info.label}
              </button>
            );
          })}
        </div>

        {showFilters && (
          <div className="flex items-center gap-3 mb-3 bg-muted rounded-lg px-3 py-2 flex-wrap">
            <select value={activityFilter || ""} onChange={e => setActivityFilter(e.target.value || null)}
              className="text-xs border border-border rounded px-2 py-1 bg-card">
              <option value="">Активность: все</option>
              <option value="high">Активный</option>
              <option value="normal">Обычный</option>
              <option value="low">Низкий</option>
            </select>
            <select value={ratingFilter || ""} onChange={e => setRatingFilter(e.target.value || null)}
              className="text-xs border border-border rounded px-2 py-1 bg-card">
              <option value="">Рейтинг: все</option>
              <option value="high">4.5+</option>
              <option value="mid">3.5–4.5</option>
              <option value="low">&lt;3.5</option>
            </select>
            {cities.length > 0 && (
              <select value={cityFilter || ""} onChange={e => setCityFilter(e.target.value || null)}
                className="text-xs border border-border rounded px-2 py-1 bg-card">
                <option value="">Город: все</option>
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {hasFilters && (
              <button onClick={() => { setStatusFilter(null); setGroupFilter(null); setActivityFilter(null); setRatingFilter(null); setCityFilter(null); }}
                className="text-[11px] text-red-500 hover:text-red-600 ml-auto">Сбросить</button>
            )}
          </div>
        )}

        {loading ? (
          <CardGridSkeleton count={8} />
        ) : error ? (
          <ErrorState message="Не удалось загрузить" onRetry={() => refetch()} />
        ) : drivers.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <Car className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{search || hasFilters ? "Нет результатов" : "Нет водителей"}</p>
          </div>
        ) : (
          <>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground bg-zinc-50">
                  <th className="text-left py-3 px-4 font-semibold">Водитель</th>
                  <th className="text-left py-3 px-4 font-semibold hidden sm:table-cell">Авто</th>
                  <th className="text-center py-3 px-4 font-semibold w-28">Статус</th>
                  <th className="text-center py-3 px-4 font-semibold w-20">
                    <Star className="w-3.5 h-3.5 inline text-amber-500" />
                  </th>
                  <th className="text-right py-3 px-4 font-semibold w-28">Сегодня</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {pagedDrivers.map(d => {
                  const st = STATUS_MAP[d.status] || STATUS_MAP.offline;
                  const grp = GROUP_MAP[d.group];
                  const flags = getDriverFlags(d);
                  return (
                    <tr key={d.id} onClick={() => setProfileId(d.id)}
                      className="border-b border-border last:border-0 hover:bg-zinc-50 cursor-pointer transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono font-bold text-zinc-400 min-w-[3rem]">{d.callsign}</span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground text-[15px] truncate">{d.name}</span>
                              {grp && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md border font-semibold ${grp.cls}`}>
                                  <grp.icon className="w-2.5 h-2.5" />{grp.label}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground font-medium">{d.phone}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell">
                        <span className="text-sm font-bold text-foreground font-mono">{d.carNumber || "—"}</span>
                        <br />
                        <span className="text-xs text-muted-foreground font-medium">{d.carBrand ? `${d.carBrand} ` : ""}{d.carModel || ""}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                            <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                            {st.label}
                          </span>
                          {(flags?.isBlocked || flags?.hasDebt) && (
                            <div className="flex gap-1">
                              {flags?.isBlocked && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 font-bold">БЛОК</span>
                              )}
                              {flags?.hasDebt && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-700 font-bold">ДОЛГ</span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center text-sm font-bold text-foreground">
                        {d.rating?.toFixed(1) || "5.0"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="text-sm font-bold text-foreground">{d.todayEarnings.toLocaleString("ru-RU")}</span>
                        <span className="text-[11px] text-muted-foreground ml-1">сум</span>
                      </td>
                      <td className="py-3 px-2">
                        <ChevronRight className="w-4 h-4 text-zinc-400" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={effectivePage === 1}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors">
                ←
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || (p >= effectivePage - 2 && p <= effectivePage + 2))
                .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] ?? 0) > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === "..." ? (
                    <span key={`dots-${idx}`} className="px-2 text-zinc-400 text-sm">…</span>
                  ) : (
                    <button key={p} onClick={() => setPage(p as number)}
                      className={`w-10 h-10 rounded-lg text-sm font-bold transition-all ${
                        effectivePage === p ? "bg-zinc-900 text-white shadow-md" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                      }`}>
                      {p}
                    </button>
                  )
                )}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={effectivePage === totalPages}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors">
                →
              </button>
            </div>
          )}
        </>
        )}

        <p className="text-xs text-muted-foreground text-center mt-4 font-medium">
          {drivers.length} из {allDrivers.length} водителей{totalPages > 1 ? ` · Стр. ${effectivePage} из ${totalPages}` : ""} · Обновление каждые 15 сек
        </p>
      </div>
    </DispatcherLayout>
  );
}
