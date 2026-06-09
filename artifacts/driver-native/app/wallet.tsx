import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  AlertTriangle,
  Wallet as WalletIcon,
  type LucideIcon,
} from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { colors } from "@/lib/theme";
import { formatCurrency } from "@/features/orders/utils";
import { useT, type TKey } from "@/lib/i18n";

type TxType = "income" | "commission" | "bonus" | "penalty" | "withdraw" | "refund";
interface Transaction {
  id: number;
  type: TxType;
  amount: string;
  description: string;
  createdAt: string;
  status: string;
}

const TYPE: Record<TxType, { icon: LucideIcon; labelKey: TKey; positive: boolean }> = {
  income: { icon: ArrowDownLeft, labelKey: "tx_income", positive: true },
  commission: { icon: ArrowUpRight, labelKey: "tx_commission", positive: false },
  bonus: { icon: Gift, labelKey: "tx_bonus", positive: true },
  penalty: { icon: AlertTriangle, labelKey: "tx_penalty", positive: false },
  withdraw: { icon: ArrowUpRight, labelKey: "tx_withdraw", positive: false },
  refund: { icon: ArrowDownLeft, labelKey: "tx_refund", positive: true },
};

const FILTERS: { key: string; labelKey: TKey }[] = [
  { key: "", labelKey: "filter_all" },
  { key: "income", labelKey: "tx_income" },
  { key: "commission", labelKey: "tx_commission" },
  { key: "penalty", labelKey: "tx_penalties" },
  { key: "bonus", labelKey: "tx_bonuses" },
];

function dateOf(iso: string) {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return `${day} · ${time}`;
  } catch {
    return "";
  }
}

export default function WalletScreen() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user, refreshUser } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [deposit, setDeposit] = useState(false);

  const balance = Number((user as any)?.balance || 0);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const url = `${API_BASE_URL}/api/payments/transactions?limit=50${filter ? `&type=${filter}` : ""}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setTransactions(d.transactions || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* header */}
      <View className="flex-row items-center px-2 py-2" style={{ gap: 4 }}>
        <Pressable onPress={() => router.back()} className="w-10 h-10 items-center justify-center active:opacity-70">
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="font-display text-foreground text-lg">{t("wallet_title")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        {/* balance card */}
        <View className="mx-4 mt-1 rounded-3xl bg-zinc-900 p-5">
          <Text className="font-sans text-zinc-400 text-[12px] uppercase" style={{ letterSpacing: 0.5 }}>
            {t("balance_title")}
          </Text>
          <Text className={`font-display text-3xl mt-1 ${balance < 0 ? "text-red-400" : "text-white"}`}>
            {formatCurrency(balance)}
          </Text>
          <Pressable
            onPress={() => setDeposit(true)}
            className="mt-4 rounded-2xl bg-primary py-3 flex-row items-center justify-center active:opacity-90"
            style={{ gap: 8 }}
          >
            <Plus size={18} color={colors.primaryForeground} />
            <Text className="font-sans-bold text-primary-foreground text-sm">{t("topup")}</Text>
          </Pressable>
        </View>

        {/* filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-4 py-3" style={{ flexGrow: 0 }}>
          <View className="flex-row" style={{ gap: 8 }}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  className={`px-3.5 py-1.5 rounded-full border ${active ? "bg-primary border-primary" : "bg-card border-border"}`}
                >
                  <Text className={`font-sans-semibold text-[13px] ${active ? "text-primary-foreground" : "text-foreground"}`}>
                    {t(f.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {/* transactions */}
        {loading ? (
          <ActivityIndicator color={colors.primary} className="mt-6" />
        ) : transactions.length === 0 ? (
          <Text className="font-sans text-muted-foreground text-sm text-center mt-8">{t("no_tx")}</Text>
        ) : (
          <View className="px-4" style={{ gap: 8 }}>
            {transactions.map((tx) => {
              const cfg = TYPE[tx.type] || TYPE.income;
              const Icon = cfg.icon;
              const amount = parseFloat(tx.amount);
              return (
                <View key={tx.id} className="flex-row items-center bg-card border border-border rounded-2xl p-3" style={{ gap: 12 }}>
                  <View
                    className={`w-10 h-10 rounded-xl items-center justify-center ${cfg.positive ? "bg-emerald-500/15" : "bg-red-500/10"}`}
                  >
                    <Icon size={18} color={cfg.positive ? colors.emerald : colors.red} />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <Text className="font-sans-bold text-foreground text-[13px]">{t(cfg.labelKey)}</Text>
                    </View>
                    <Text className="font-sans text-muted-foreground text-[12px] mt-0.5" numberOfLines={2}>
                      {tx.description}
                    </Text>
                    <Text className="font-sans text-muted-foreground text-[11px] mt-0.5">{dateOf(tx.createdAt)}</Text>
                  </View>
                  <Text className={`font-sans-bold text-sm ${cfg.positive ? "text-emerald-400" : "text-red-400"}`}>
                    {cfg.positive ? "+" : "−"}
                    {formatCurrency(Math.abs(amount))}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <DepositModal visible={deposit} onClose={() => setDeposit(false)} onDone={() => { refreshUser(); load(); }} />
    </View>
  );
}

function DepositModal({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const { token } = useAuth();
  const [cards, setCards] = useState<{ id: number; maskedPan?: string }[]>([]);
  const [cardId, setCardId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"amount" | "otp">("amount");
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || !token) return;
    setStep("amount");
    setAmount("");
    setOtp("");
    fetch(`${API_BASE_URL}/api/payments/cards`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const cs = d.cards || [];
        setCards(cs);
        if (cs[0]) setCardId(cs[0].id);
      })
      .catch(() => {});
  }, [visible, token]);

  const init = async () => {
    const amt = parseInt(amount, 10);
    if (!amt || amt < 1000 || !cardId) {
      Alert.alert(t("err"), t("topup_min"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/payments/deposit/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: amt, cardDbId: cardId }),
      });
      const d = await res.json().catch(() => ({}) as any);
      if (res.ok && (d.paymentId || d.id)) {
        setPaymentId(d.paymentId || d.id);
        setStep("otp");
      } else {
        Alert.alert(t("err"), d.message || t("topup_failed"));
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!paymentId || otp.length < 4) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/payments/deposit/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paymentId, otp }),
      });
      const d = await res.json().catch(() => ({}) as any);
      if (res.ok) {
        Alert.alert(t("done"), t("topup_done"));
        onDone();
        onClose();
      } else {
        Alert.alert(t("err"), d.message || t("wrong_code"));
      }
    } catch {
      Alert.alert(t("err_network"), t("err_network_sub"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60 justify-end" onPress={onClose}>
        <Pressable className="bg-card rounded-t-3xl border-t border-border px-5 pt-4 pb-8" onPress={() => {}}>
          <Text className="font-display text-foreground text-base mb-4">{t("topup_title")}</Text>

          {cards.length === 0 ? (
            <View className="items-center py-6">
              <WalletIcon size={32} color={colors.mutedForeground} />
              <Text className="font-sans text-muted-foreground text-sm mt-2 text-center">
                {t("no_cards")}
              </Text>
            </View>
          ) : step === "amount" ? (
            <>
              <View className="flex-row mb-3" style={{ gap: 8 }}>
                {[10000, 50000, 100000].map((a) => (
                  <Pressable
                    key={a}
                    onPress={() => setAmount(String(a))}
                    className={`flex-1 py-2.5 rounded-xl border items-center ${
                      amount === String(a) ? "bg-primary border-primary" : "bg-secondary border-border"
                    }`}
                  >
                    <Text className={`font-sans-bold text-[13px] ${amount === String(a) ? "text-primary-foreground" : "text-foreground"}`}>
                      {formatCurrency(a)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={amount}
                onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder={t("amount_sum")}
                placeholderTextColor={colors.mutedForeground}
                className="bg-secondary border border-border rounded-2xl px-4 py-3.5 text-foreground font-sans-bold text-base text-center mb-3"
              />
              <Pressable onPress={init} disabled={busy} className="rounded-2xl bg-primary py-4 items-center active:opacity-90">
                {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text className="font-sans-bold text-primary-foreground text-base">{t("get_code")}</Text>}
              </Pressable>
            </>
          ) : (
            <>
              <Text className="font-sans text-muted-foreground text-sm mb-2 text-center">{t("enter_sms")}</Text>
              <TextInput
                value={otp}
                onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="• • • • • •"
                placeholderTextColor={colors.mutedForeground}
                className="bg-secondary border border-border rounded-2xl px-4 py-3.5 text-foreground font-sans-bold text-xl text-center mb-3"
                style={{ letterSpacing: 6 }}
              />
              <Pressable onPress={confirm} disabled={busy} className="rounded-2xl bg-emerald-500 py-4 items-center active:opacity-90">
                {busy ? <ActivityIndicator color="#fff" /> : <Text className="font-sans-bold text-white text-base">{t("confirm")}</Text>}
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
