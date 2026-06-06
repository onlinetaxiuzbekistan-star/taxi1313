import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import {
  MapPin,
  ArrowRight,
  Clock,
  Users,
  Car,
  Loader2,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";
import { estimatePrice, type PriceEstimate } from "@/lib/api";

const CLASS_LABELS: Record<string, string> = {
  economy: "Эконом",
  comfort: "Комфорт",
  business: "Бизнес",
};

const CLASS_ICONS: Record<string, string> = {
  economy: "🚗",
  comfort: "🚙",
  business: "🚘",
};

function formatPrice(p: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(p)) + " сум";
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} мин`;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

function formatDistance(km: number) {
  return `${Math.round(km)} км`;
}

export default function Search() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const date = params.get("date") || "";
  const passengers = Number(params.get("passengers") || "1");
  const carClass = params.get("carClass") || "economy";

  const [estimates, setEstimates] = useState<
    { carClass: string; estimate: PriceEstimate }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!from || !to) {
      setLoading(false);
      if (!from && !to) setError("Укажите маршрут для поиска");
      return;
    }
    setLoading(true);
    setError("");

    Promise.all(
      ["economy", "comfort", "business"].map((cls) =>
        estimatePrice({ fromCity: from, toCity: to, passengers, carClass: cls })
          .then((est) => ({ carClass: cls, estimate: est }))
          .catch(() => null),
      ),
    )
      .then((results) => {
        const valid = results.filter(Boolean) as {
          carClass: string;
          estimate: PriceEstimate;
        }[];
        if (valid.length === 0) {
          setError("Не удалось получить цены для данного маршрута");
        }
        setEstimates(valid);
      })
      .finally(() => setLoading(false));
  }, [from, to, passengers]);

  function handleBook(cls: string, price: number, distance: number, duration: number) {
    const p = new URLSearchParams({
      from,
      to,
      date,
      passengers: String(passengers),
      carClass: cls,
      price: String(price),
      distance: String(distance),
      duration: String(duration),
    });
    navigate(`/book?${p}`);
  }

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

  return (
    <div className="min-h-screen bg-muted/30 pt-16">
      <div className="bg-white border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Изменить поиск
          </button>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <MapPin className="w-4 h-4 text-primary" />
              {from}
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <MapPin className="w-4 h-4 text-emerald-500" />
              {to}
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formattedDate}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {passengers} пасс.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <span className="text-sm">Ищем лучшие варианты...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <AlertCircle className="w-8 h-8 mb-3 text-destructive" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {!loading && estimates.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Доступные варианты</h2>

            {estimates.map(({ carClass: cls, estimate }) => {
              const isSelected = cls === carClass;
              return (
                <div
                  key={cls}
                  className={`bg-white rounded-xl border-2 transition-all overflow-hidden ${
                    isSelected
                      ? "border-primary shadow-md"
                      : "border-border/50 hover:border-primary/30 hover:shadow-sm"
                  }`}
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{CLASS_ICONS[cls]}</span>
                        <div>
                          <h3 className="font-semibold text-lg">
                            {CLASS_LABELS[cls]}
                          </h3>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Car className="w-3.5 h-3.5" />
                              {formatDistance(estimate.distance)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {formatDuration(estimate.duration)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">
                          {formatPrice(estimate.price)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          за {passengers} пасс.
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        handleBook(
                          cls,
                          estimate.price,
                          estimate.distance,
                          estimate.duration,
                        )
                      }
                      className={`w-full mt-4 py-3 rounded-xl font-semibold text-sm transition-all ${
                        isSelected
                          ? "hero-gradient text-white hover:opacity-90"
                          : "bg-muted text-foreground hover:bg-muted/80"
                      }`}
                    >
                      Забронировать
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
