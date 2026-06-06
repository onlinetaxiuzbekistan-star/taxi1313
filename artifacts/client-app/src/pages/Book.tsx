import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  MapPin,
  ArrowRight,
  Clock,
  Users,
  Car,
  Phone,
  User,
  Check,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Calendar,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { createRide } from "@/lib/api";

const CLASS_LABELS: Record<string, string> = {
  economy: "Эконом",
  comfort: "Комфорт",
  business: "Бизнес",
};

function formatPrice(p: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(p)) + " сум";
}

export default function Book() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { user } = useAuth();

  const params = new URLSearchParams(search);
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const date = params.get("date") || "";
  const passengers = Number(params.get("passengers") || "1");
  const carClass = params.get("carClass") || "economy";
  const price = Number(params.get("price") || "0");
  const distance = Number(params.get("distance") || "0");
  const duration = Number(params.get("duration") || "0");

  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [rideId, setRideId] = useState<number | null>(null);

  const dateObj = date ? new Date(date) : null;
  const formattedDate = dateObj
    ? dateObj.toLocaleDateString("ru-RU", {
        weekday: "short",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Заполните имя и телефон");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const ride = await createRide({
        fromCity: from,
        toCity: to,
        scheduledAt: new Date(date).toISOString(),
        passengers,
        carClass,
        riderName: name.trim(),
        riderPhone: phone.trim(),
        price,
        distance,
        duration,
      });
      setRideId(ride.id);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Не удалось создать бронирование");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-muted/30 pt-16 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Поездка забронирована!</h1>
          <p className="text-muted-foreground mb-6">
            Мы ищем для вас водителя. Вы получите уведомление, когда водитель
            примет заказ.
          </p>

          <div className="bg-muted/30 rounded-xl p-4 mb-6 text-left space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-primary shrink-0" />
              <span>
                {from} → {to}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
              <span>{formattedDate}</span>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-primary">{formatPrice(price)}</span>
            </div>
          </div>

          <div className="space-y-3">
            {rideId && user && (
              <button
                onClick={() => navigate("/my-trips")}
                className="w-full py-3 rounded-xl hero-gradient text-white font-semibold text-sm"
              >
                Мои поездки
              </button>
            )}
            <button
              onClick={() => navigate("/")}
              className="w-full py-3 rounded-xl bg-muted text-foreground font-semibold text-sm hover:bg-muted/80"
            >
              На главную
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 pt-16">
      <div className="bg-white border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Назад
          </button>
          <h1 className="text-xl font-bold">Подтверждение бронирования</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-xl border border-border/50 p-5">
          <h2 className="font-semibold mb-4">Детали поездки</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <div className="w-0.5 h-8 bg-border" />
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
              </div>
              <div className="space-y-5">
                <div>
                  <div className="font-medium">{from}</div>
                </div>
                <div>
                  <div className="font-medium">{to}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="w-4 h-4" />
                <span className="truncate">{formattedDate}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                {passengers} пасс.
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Car className="w-4 h-4" />
                {CLASS_LABELS[carClass]}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                ~{Math.round(duration)} мин
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border/50 p-5">
          <h2 className="font-semibold mb-4">Ваши данные</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                Имя
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ваше имя"
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                Телефон
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+998 90 123 45 67"
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-border/50">
              <div>
                <div className="text-sm text-muted-foreground">Итого</div>
                <div className="text-2xl font-bold text-primary">
                  {formatPrice(price)}
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="px-8 py-3 rounded-xl hero-gradient text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Забронировать
              </button>
            </div>
          </form>
        </div>

        {!user && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
            <strong>Совет:</strong>{" "}
            <button
              onClick={() => navigate("/login")}
              className="underline font-medium"
            >
              Войдите в аккаунт
            </button>
            , чтобы отслеживать статус поездки и историю бронирований.
          </div>
        )}
      </div>
    </div>
  );
}
