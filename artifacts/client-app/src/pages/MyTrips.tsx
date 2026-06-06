import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  MapPin,
  ArrowRight,
  Clock,
  Users,
  Car,
  Loader2,
  Calendar,
  Phone,
  PhoneCall,
  XCircle,
  CheckCircle,
  AlertCircle,
  Navigation,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyRides, type Ride } from "@/lib/api";
import CallDispatcherModal from "@/components/CallDispatcherModal";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: "Ожидание", color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock },
  accepted: { label: "Принят", color: "bg-blue-50 text-blue-700 border-blue-200", icon: CheckCircle },
  in_progress: { label: "В пути", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Navigation },
  completed: { label: "Завершён", color: "bg-gray-50 text-gray-600 border-gray-200", icon: CheckCircle },
  cancelled: { label: "Отменён", color: "bg-red-50 text-red-600 border-red-200", icon: XCircle },
};

const CLASS_LABELS: Record<string, string> = {
  economy: "Эконом",
  comfort: "Комфорт",
  business: "Бизнес",
};

function formatPrice(p: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(p)) + " сум";
}

export default function MyTrips() {
  const [, navigate] = useLocation();
  const { user, token } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCancelDialog, setShowCancelDialog] = useState<number | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);

  const { isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login");
      return;
    }
    loadRides();
  }, [user, authLoading]);

  const [loadError, setLoadError] = useState("");

  async function loadRides() {
    setLoadError("");
    try {
      const data = await getMyRides();
      setRides(data.rides);
    } catch (err: any) {
      setLoadError(err.message || "Не удалось загрузить поездки");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30 pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 pt-16">
      <div className="bg-white border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <h1 className="text-xl font-bold">Мои поездки</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rides.length > 0
              ? `${rides.length} поездок`
              : "У вас пока нет поездок"}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {loadError && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {loadError}
          </div>
        )}

        {rides.length === 0 && !loadError && (
          <div className="text-center py-16">
            <Car className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Поездок пока нет</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Забронируйте первую поездку прямо сейчас
            </p>
            <button
              onClick={() => navigate("/")}
              className="px-6 py-3 rounded-xl hero-gradient text-white font-semibold text-sm"
            >
              Найти поездку
            </button>
          </div>
        )}

        <div className="space-y-4">
          {rides.map((ride) => {
            const status = STATUS_CONFIG[ride.status] || STATUS_CONFIG.pending;
            const StatusIcon = status.icon;
            const dateObj = ride.scheduledAt
              ? new Date(ride.scheduledAt)
              : new Date(ride.createdAt);
            const canCancel = ride.status === "pending" || ride.status === "accepted";

            return (
              <div
                key={ride.id}
                className="bg-white rounded-xl border border-border/50 overflow-hidden hover:shadow-sm transition-shadow"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                      <span>{ride.fromCity}</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <span>{ride.toCity}</span>
                    </div>
                    <div
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${status.color}`}
                    >
                      <StatusIcon className="w-3.5 h-3.5" />
                      {status.label}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground mb-3">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {dateObj.toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {ride.passengers} пасс.
                    </span>
                    <span className="flex items-center gap-1">
                      <Car className="w-3.5 h-3.5" />
                      {CLASS_LABELS[ride.carClass] || ride.carClass}
                    </span>
                  </div>

                  {ride.driverName && (
                    <div className="bg-muted/30 rounded-lg p-3 mb-3">
                      <div className="text-xs text-muted-foreground mb-1">
                        Водитель
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {ride.driverName}
                        </span>
                        {ride.driverPhone && (
                          <a
                            href={`tel:${ride.driverPhone}`}
                            className="flex items-center gap-1 text-sm text-primary"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            Позвонить
                          </a>
                        )}
                      </div>
                      {ride.driverCar && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {ride.driverCar}{" "}
                          {ride.driverCarNumber && `• ${ride.driverCarNumber}`}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-primary">
                      {formatPrice(ride.price)}
                    </span>
                    {canCancel && (
                      <button
                        onClick={() => setShowCancelDialog(ride.id)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                        Отменить
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showCancelDialog !== null && (
        <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-50 mx-auto mb-4 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                Отмена невозможна
              </h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-1">
                Самостоятельно отменить заказ невозможно.
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                Для отмены или переноса поездки позвоните диспетчеру через интернет.
              </p>
            </div>

            <div className="px-6 pb-6 space-y-2">
              <button
                onClick={() => {
                  setShowCancelDialog(null);
                  setShowCallModal(true);
                }}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 text-white rounded-xl font-semibold text-sm hover:bg-emerald-700 transition-colors"
              >
                <PhoneCall className="w-5 h-5" />
                Позвонить диспетчеру (через интернет)
              </button>

              <button
                onClick={() => setShowCancelDialog(null)}
                className="w-full py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm hover:bg-gray-200 transition-colors"
              >
                Назад
              </button>
            </div>
          </div>
        </div>
      )}

      {showCallModal && user && token && (
        <CallDispatcherModal
          open={showCallModal}
          onClose={() => { setShowCallModal(false); loadRides(); }}
          token={token}
          userId={user.id}
          userName={user.name}
        />
      )}
    </div>
  );
}
