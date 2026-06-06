import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import DriverLayout from "./DriverLayout";
import { useAuth } from "@/hooks/use-auth";
import { Button, Input } from "@/components/ui/core";
import {
  Wallet as WalletIcon, Plus, ArrowDownLeft, ArrowUpRight, Gift,
  AlertTriangle, Copy, Share2, CreditCard, CheckCircle, WifiOff, ArrowLeft,
  Trash2, CreditCard as CardIcon, Loader2, ShieldCheck
} from "lucide-react";
import { ErrorState } from "@/components/PageStates";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

type TransactionType = "income" | "commission" | "bonus" | "penalty" | "withdraw" | "refund";

interface Transaction {
  id: number;
  type: TransactionType;
  amount: string;
  balanceBefore?: string;
  balanceAfter?: string;
  description: string;
  createdAt: string;
  rideId?: number;
}

interface DriverCard {
  id: number;
  pan: string;
  expiry?: string;
  cardHolder?: string;
}

const typeConfig: Record<TransactionType, { icon: any; label: string; color: string; bg: string; sign: string }> = {
  income:     { icon: ArrowDownLeft,  label: "Доход",    color: "text-zinc-700", bg: "bg-zinc-100",  sign: "+" },
  commission: { icon: ArrowUpRight,   label: "Комиссия", color: "text-zinc-600",    bg: "bg-zinc-100",    sign: "-" },
  bonus:      { icon: Gift,           label: "Бонус",    color: "text-zinc-700",   bg: "bg-zinc-100",   sign: "+" },
  penalty:    { icon: AlertTriangle,  label: "Штраф",    color: "text-red-600",     bg: "bg-red-500/10",     sign: "-" },
  withdraw:   { icon: ArrowUpRight,   label: "Вывод",    color: "text-zinc-600",  bg: "bg-zinc-100",  sign: "-" },
  refund:     { icon: ArrowDownLeft,  label: "Возврат",  color: "text-zinc-700",    bg: "bg-zinc-100",    sign: "+" },
};

type WalletTab = "history" | "deposit" | "referral";

export default function Wallet() {
  const { user, token, refreshUser } = useAuth();
  const [, navigate] = useLocation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalTx, setTotalTx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [tab, setTab] = useState<WalletTab>("history");
  const [filterType, setFilterType] = useState<string>("all");

  const [cards, setCards] = useState<DriverCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [depositAmount, setDepositAmount] = useState("");

  const [showAddCard, setShowAddCard] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [bindStep, setBindStep] = useState<"input" | "otp">("input");
  const [bindTxId, setBindTxId] = useState<number | null>(null);
  const [bindPhone, setBindPhone] = useState("");
  const [bindOtp, setBindOtp] = useState("");
  const [bindLoading, setBindLoading] = useState(false);
  const [bindError, setBindError] = useState("");

  const [depositStep, setDepositStep] = useState<"amount" | "otp">("amount");
  const [depositPaymentId, setDepositPaymentId] = useState<number | null>(null);
  const [depositAtmosTxId, setDepositAtmosTxId] = useState<number | null>(null);
  const [depositOtp, setDepositOtp] = useState("");
  const [depositing, setDepositing] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState(false);
  const [depositError, setDepositError] = useState("");

  const [copied, setCopied] = useState(false);

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["Content-Type"] = "application/json";

  const loadCards = useCallback(async () => {
    setCardsLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/payments/cards`, { headers });
      if (res.ok) {
        const data = await res.json();
        setCards(data.cards || []);
        if (data.cards?.length > 0 && !selectedCardId) {
          setSelectedCardId(data.cards[0].id);
        }
      }
    } catch {}
    setCardsLoading(false);
  }, [token]);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const url = filterType === "all"
        ? `${BASE_URL}/api/payments/transactions?limit=50`
        : `${BASE_URL}/api/payments/transactions?limit=50&type=${filterType}`;
      const res = await fetch(url, { headers });
      if (!res.ok) { setFetchError(true); setLoading(false); return; }
      const data = await res.json();
      setTransactions(data.transactions || []);
      setTotalTx(data.total || 0);
    } catch { setFetchError(true); }
    setLoading(false);
  }, [token, filterType]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);
  useEffect(() => { loadCards(); }, [loadCards]);

  const handleBindInit = async () => {
    setBindLoading(true);
    setBindError("");
    try {
      const cleanNumber = cardNumber.replace(/\s/g, "");
      const res = await fetch(`${BASE_URL}/api/payments/cards/bind-init`, {
        method: "POST", headers,
        body: JSON.stringify({ cardNumber: cleanNumber, expiry: cardExpiry }),
      });
      const data = await res.json();
      if (!res.ok) { setBindError(data.message || "Ошибка"); setBindLoading(false); return; }
      setBindTxId(data.transactionId);
      setBindPhone(data.phone);
      setBindStep("otp");
    } catch { setBindError("Ошибка соединения"); }
    setBindLoading(false);
  };

  const handleBindConfirm = async () => {
    setBindLoading(true);
    setBindError("");
    try {
      const res = await fetch(`${BASE_URL}/api/payments/cards/bind-confirm`, {
        method: "POST", headers,
        body: JSON.stringify({ transactionId: bindTxId, otp: bindOtp }),
      });
      const data = await res.json();
      if (!res.ok) { setBindError(data.message || "Неверный код"); setBindLoading(false); return; }
      setShowAddCard(false);
      setCardNumber("");
      setCardExpiry("");
      setBindOtp("");
      setBindStep("input");
      loadCards();
    } catch { setBindError("Ошибка соединения"); }
    setBindLoading(false);
  };

  const handleRemoveCard = async (id: number) => {
    try {
      await fetch(`${BASE_URL}/api/payments/cards/remove`, {
        method: "POST", headers,
        body: JSON.stringify({ cardId: id }),
      });
      setCards(c => c.filter(cc => cc.id !== id));
      if (selectedCardId === id) setSelectedCardId(null);
    } catch {}
  };

  const handleDepositInit = async () => {
    const amount = parseInt(depositAmount);
    if (!amount || amount < 1000 || !selectedCardId) return;
    setDepositing(true);
    setDepositError("");
    try {
      const res = await fetch(`${BASE_URL}/api/payments/deposit/init`, {
        method: "POST", headers,
        body: JSON.stringify({ amount, cardDbId: selectedCardId }),
      });
      const data = await res.json();
      if (!res.ok) { setDepositError(data.message || "Ошибка"); setDepositing(false); return; }
      setDepositPaymentId(data.paymentId);
      setDepositAtmosTxId(data.atmosTransactionId);
      setDepositStep("otp");
    } catch { setDepositError("Ошибка соединения"); }
    setDepositing(false);
  };

  const handleDepositConfirm = async () => {
    if (!depositPaymentId || !depositOtp) return;
    setDepositing(true);
    setDepositError("");
    try {
      const res = await fetch(`${BASE_URL}/api/payments/deposit/confirm`, {
        method: "POST", headers,
        body: JSON.stringify({ paymentId: depositPaymentId, otp: depositOtp }),
      });
      const data = await res.json();
      if (!res.ok) { setDepositError(data.message || "Неверный код"); setDepositing(false); return; }
      setDepositSuccess(true);
      setDepositStep("amount");
      setDepositAmount("");
      setDepositOtp("");
      setDepositPaymentId(null);
      loadTransactions();
      refreshUser();
      setTimeout(() => setDepositSuccess(false), 3000);
    } catch { setDepositError("Ошибка соединения"); }
    setDepositing(false);
  };

  const copyReferral = () => {
    if (user?.referralCode) {
      navigator.clipboard.writeText(user.referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const balance = parseFloat(String(user?.balance || "0"));

  const formatCardNumber = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(.{4})/g, "$1 ").trim();
  };

  const formatExpiry = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    return digits;
  };

  return (
    <DriverLayout>
      <div className="px-4 pt-20 pb-28 space-y-4">
        <button onClick={() => navigate("/driver/profile")}
          className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-muted/60 hover:bg-muted active:scale-[0.97] transition-all mb-3 border border-border/50">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-primary" />
          </div>
          <span className="text-sm font-bold text-foreground">Назад</span>
        </button>

        <div className="bg-primary rounded-2xl p-5 shadow-lg shadow-primary/20">
          <div className="flex items-center gap-2 text-white/70 text-xs mb-1">
            <WalletIcon className="w-4 h-4" />
            Баланс
          </div>
          <div className="text-3xl font-bold text-white">{fmt(balance)} <span className="text-lg text-white/60">сум</span></div>
          {/* Removed hard-coded balance<=0 banner — min_driver_balance setting allows negative balances */}
        </div>

        <div className="flex gap-2">
          {([
            { key: "history" as WalletTab, label: "История" },
            { key: "deposit" as WalletTab, label: "Пополнить" },
            { key: "referral" as WalletTab, label: "Реферал" },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                tab === t.key
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "bg-card border border-border text-muted-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "deposit" && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-foreground font-semibold flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" />
                  Мои карты
                </h3>
                <button
                  onClick={() => { setShowAddCard(!showAddCard); setBindStep("input"); setBindError(""); }}
                  className="text-xs font-medium text-primary flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Добавить
                </button>
              </div>

              {cardsLoading ? (
                <div className="text-center py-4 text-muted-foreground text-sm">Загрузка...</div>
              ) : cards.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Нет привязанных карт</p>
                  <p className="text-xs mt-1">Добавьте карту для пополнения баланса</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cards.map(card => (
                    <div
                      key={card.id}
                      onClick={() => setSelectedCardId(card.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedCardId === card.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30"
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        selectedCardId === card.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}>
                        <CreditCard className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{card.pan}</p>
                        {card.cardHolder && <p className="text-xs text-muted-foreground">{card.cardHolder}</p>}
                      </div>
                      {selectedCardId === card.id && (
                        <ShieldCheck className="w-4 h-4 text-primary" />
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveCard(card.id); }}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAddCard && (
                <div className="bg-muted/30 border border-border rounded-xl p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Привязать карту</h4>
                  {bindStep === "input" ? (
                    <>
                      <Input
                        placeholder="0000 0000 0000 0000"
                        value={cardNumber}
                        onChange={e => setCardNumber(formatCardNumber(e.target.value))}
                        className="bg-background text-lg tracking-wider"
                        maxLength={19}
                      />
                      <Input
                        placeholder="YYMM (напр. 2601)"
                        value={cardExpiry}
                        onChange={e => setCardExpiry(formatExpiry(e.target.value))}
                        className="bg-background"
                        maxLength={4}
                      />
                      {bindError && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {bindError}
                        </p>
                      )}
                      <button
                        onClick={handleBindInit}
                        disabled={bindLoading || cardNumber.replace(/\s/g, "").length !== 16 || cardExpiry.length !== 4}
                        className="w-full bg-primary text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {bindLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {bindLoading ? "Отправка..." : "Привязать"}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        SMS-код отправлен на номер <span className="font-medium text-foreground">{bindPhone}</span>
                      </p>
                      <Input
                        placeholder="Код из SMS"
                        value={bindOtp}
                        onChange={e => setBindOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="bg-background text-center text-lg tracking-widest"
                        maxLength={6}
                      />
                      {bindError && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {bindError}
                        </p>
                      )}
                      <button
                        onClick={handleBindConfirm}
                        disabled={bindLoading || bindOtp.length < 4}
                        className="w-full bg-primary text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {bindLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        {bindLoading ? "Проверка..." : "Подтвердить"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {cards.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-4 space-y-4 shadow-sm">
                <h3 className="text-foreground font-semibold">Пополнение баланса</h3>

                {depositStep === "amount" ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {[10000, 50000, 100000].map(amt => (
                        <button
                          key={amt}
                          onClick={() => setDepositAmount(String(amt))}
                          className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                            depositAmount === String(amt)
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border bg-card text-muted-foreground"
                          }`}
                        >
                          {fmt(amt)}
                        </button>
                      ))}
                    </div>
                    <Input
                      type="number"
                      placeholder="Или введите сумму"
                      value={depositAmount}
                      onChange={e => setDepositAmount(e.target.value)}
                      className="bg-background"
                    />
                    {selectedCardId && (
                      <div className="flex items-center gap-2 bg-muted/30 rounded-xl px-3 py-2">
                        <CreditCard className="w-4 h-4 text-primary" />
                        <span className="text-sm text-foreground">
                          {cards.find(c => c.id === selectedCardId)?.pan || ""}
                        </span>
                      </div>
                    )}
                    {depositError && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {depositError}
                      </p>
                    )}
                    {depositSuccess && (
                      <div className="bg-zinc-100 border border-zinc-200 rounded-xl p-3 text-zinc-700 text-sm flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        Баланс пополнен!
                      </div>
                    )}
                    <button
                      className="w-full bg-primary text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 shadow-md shadow-primary/20 disabled:opacity-50"
                      disabled={!depositAmount || parseInt(depositAmount) < 1000 || !selectedCardId || depositing}
                      onClick={handleDepositInit}
                    >
                      {depositing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {depositing ? "Обработка..." : `Пополнить ${depositAmount ? fmt(parseInt(depositAmount)) + " сум" : ""}`}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Введите SMS-код для подтверждения списания <span className="font-bold text-foreground">{depositAmount ? fmt(parseInt(depositAmount)) : ""} сум</span>
                    </p>
                    <Input
                      placeholder="Код из SMS"
                      value={depositOtp}
                      onChange={e => setDepositOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="bg-background text-center text-lg tracking-widest"
                      maxLength={6}
                      autoFocus
                    />
                    {depositError && (
                      <p className="text-xs text-red-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {depositError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setDepositStep("amount"); setDepositOtp(""); setDepositError(""); }}
                        className="flex-1 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={handleDepositConfirm}
                        disabled={depositing || depositOtp.length < 4}
                        className="flex-1 bg-primary text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {depositing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        {depositing ? "Проверка..." : "Подтвердить"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "referral" && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4 shadow-sm">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Gift className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-foreground font-semibold text-lg">Пригласи друга — получи бонус!</h3>
              <p className="text-muted-foreground text-sm mt-1">
                Вы получите <span className="text-primary font-semibold">30 000 сум</span>, а ваш друг — <span className="text-primary font-semibold">20 000 сум</span>
              </p>
            </div>
            {user?.referralCode && (
              <div className="bg-background rounded-xl p-4 border border-border">
                <p className="text-xs text-muted-foreground mb-2">Ваш реферальный код</p>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-primary tracking-wider flex-1">{user.referralCode}</span>
                  <button
                    onClick={copyReferral}
                    className="p-2 rounded-lg bg-primary/10 text-primary"
                  >
                    {copied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
                {copied && <p className="text-xs text-zinc-600 mt-1">Скопировано!</p>}
              </div>
            )}
            <button
              className="w-full py-3 rounded-xl text-sm font-medium border border-border text-foreground flex items-center justify-center gap-2"
              onClick={() => {
                if (navigator.share && user?.referralCode) {
                  navigator.share({
                    title: "Такси 1313 — приглашение",
                    text: `Регистрируйся в Такси 1313 с моим кодом ${user.referralCode} и получи 20 000 сум бонус!`,
                  });
                } else {
                  copyReferral();
                }
              }}
            >
              <Share2 className="w-4 h-4" />
              Поделиться кодом
            </button>
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-3">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {[
                { key: "all", label: "Все" },
                { key: "income", label: "Доход" },
                { key: "bonus", label: "Бонусы" },
                { key: "penalty", label: "Штрафы" },
                { key: "commission", label: "Комиссия" },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilterType(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                    filterType === f.key
                      ? "bg-primary text-white"
                      : "bg-card border border-border text-muted-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Всего операций: {totalTx}</p>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : fetchError ? (
              <ErrorState message="Не удалось загрузить историю" onRetry={loadTransactions} />
            ) : transactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Нет операций</div>
            ) : (
              <div className="space-y-2">
                {transactions.map(tx => {
                  const cfg = typeConfig[tx.type] || typeConfig.income;
                  const Icon = cfg.icon;
                  const amount = parseFloat(tx.amount);
                  return (
                    <div key={tx.id} className="bg-card border border-border rounded-xl p-3 flex items-center gap-3 shadow-sm">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cfg.bg} ${cfg.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground font-medium truncate">{tx.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] font-medium px-1.5 py-0 rounded ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(tx.createdAt).toLocaleDateString("ru-RU", {
                              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                            })}
                          </span>
                        </div>
                        {tx.balanceBefore && tx.balanceAfter && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {fmt(parseFloat(tx.balanceBefore))} → {fmt(parseFloat(tx.balanceAfter))} сум
                          </p>
                        )}
                      </div>
                      <div className={`text-sm font-semibold ${cfg.color}`}>
                        {cfg.sign}{fmt(amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </DriverLayout>
  );
}
