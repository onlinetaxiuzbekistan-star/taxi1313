import { useEffect, useState, useCallback, useRef } from "react";
import { Phone, X, User, PhoneOff, MapPin, Users as UsersIcon, Clock, ChevronRight, Truck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface DriverRide {
  id: number;
  status: string;
  fromCity: string;
  toCity: string;
  fromAddress?: string;
  toAddress?: string;
  scheduledAt?: string;
  seatsTotal?: number;
  seatsTaken?: number;
  price?: number;
  riderName?: string;
  riderPhone?: string;
  seatPassengers?: Array<{
    id: number;
    name: string;
    phone: string;
    pickupAddress?: string;
    dropoffAddress?: string;
    seatNumber?: number;
  }>;
}

interface DriverInfo {
  id: number;
  name: string;
  phone: string;
}

export interface DriverCallEvent {
  driverId: number;
  driverName: string;
  offer?: RTCSessionDescriptionInit;
}

interface Props {
  event: DriverCallEvent | null;
  onAccept: () => void;
  onReject: () => void;
  onDismiss: () => void;
}

const statusLabels: Record<string, string> = {
  pending: "Ожидает",
  offered: "Предложен",
  accepted: "Принят",
  in_progress: "В пути",
};

export function DriverCallPopup({ event, onAccept, onReject, onDismiss }: Props) {
  const { token } = useAuth();
  const [visible, setVisible] = useState(false);
  const [rides, setRides] = useState<DriverRide[]>([]);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRides, setShowRides] = useState(false);
  const ringtoneCtxRef = useRef<AudioContext | null>(null);
  const ringtoneIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (event) {
      setVisible(true);
      setShowRides(false);
      setRides([]);
      setDriver(null);
      fetchDriverRides(event.driverId);
      playRingtone();
      timerRef.current = setTimeout(() => {
        stopRingtone();
        setVisible(false);
        setTimeout(onDismiss, 300);
      }, 45_000);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        stopRingtone();
      };
    }
  }, [event]);

  const playRingtone = () => {
    try {
      stopRingtone();
      if (!window.isSecureContext) return;
      const ctx = new AudioContext();
      ringtoneCtxRef.current = ctx;

      const playBurst = () => {
        if (ctx.state === "closed") return;
        const now = ctx.currentTime;
        for (let i = 0; i < 2; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = i === 0 ? 440 : 480;
          gain.gain.setValueAtTime(0.15, now);
          gain.gain.setValueAtTime(0.15, now + 0.8);
          gain.gain.linearRampToValueAtTime(0, now + 0.85);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.85);
        }
        setTimeout(() => {
          if (ctx.state === "closed") return;
          const now2 = ctx.currentTime;
          for (let i = 0; i < 2; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = i === 0 ? 440 : 480;
            gain.gain.setValueAtTime(0.15, now2);
            gain.gain.setValueAtTime(0.15, now2 + 0.8);
            gain.gain.linearRampToValueAtTime(0, now2 + 0.85);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now2);
            osc.stop(now2 + 0.85);
          }
        }, 1000);
      };

      playBurst();
      ringtoneIntervalRef.current = setInterval(playBurst, 4000);
    } catch {}
  };

  const stopRingtone = () => {
    try {
      if (ringtoneIntervalRef.current) {
        clearInterval(ringtoneIntervalRef.current);
        ringtoneIntervalRef.current = null;
      }
      if (ringtoneCtxRef.current && ringtoneCtxRef.current.state !== "closed") {
        ringtoneCtxRef.current.close();
        ringtoneCtxRef.current = null;
      }
    } catch {}
  };

  const fetchDriverRides = async (driverId: number) => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/${driverId}/active-rides`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRides(data.rides || []);
        setDriver(data.driver || null);
      }
    } catch {}
    setLoading(false);
  };

  const handleAccept = useCallback(() => {
    stopRingtone();
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowRides(true);
    onAccept();
  }, [onAccept]);

  const handleReject = useCallback(() => {
    stopRingtone();
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setTimeout(onReject, 300);
  }, [onReject]);

  const handleClose = useCallback(() => {
    stopRingtone();
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setTimeout(onDismiss, 300);
  }, [onDismiss]);

  if (!event) return null;

  const displayName = driver?.name || event.driverName || "Водитель";
  const driverPhone = driver?.phone;

  return (
    <div
      className={`fixed top-4 right-4 z-50 transition-all duration-300 ${
        showRides ? "w-96" : "w-80"
      } ${visible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}`}
    >
      <div className="absolute -inset-1 bg-zinc-500 rounded-2xl opacity-20 animate-ping pointer-events-none" />

      <div className="relative bg-card rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-white font-semibold">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center animate-pulse">
              <Phone className="w-4 h-4" />
            </div>
            {showRides ? "Звонок от водителя" : "Водитель звонит"}
          </div>
          <button onClick={handleClose} className="text-white/80 hover:text-white active:scale-90 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto flex-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center flex-shrink-0">
              <Truck className="w-5 h-5 text-zinc-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground text-sm truncate">{displayName}</p>
              </div>
              {driverPhone && (
                <p className="text-zinc-600 font-mono text-sm font-bold">{driverPhone}</p>
              )}
            </div>
          </div>

          {!showRides && (
            <div className="flex gap-2">
              <button
                onClick={handleReject}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold flex items-center justify-center gap-1 active:scale-[0.97] transition-all"
              >
                <PhoneOff className="w-4 h-4" />
                Отклонить
              </button>
              <button
                onClick={handleAccept}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-1 active:scale-[0.97] transition-all"
              >
                <Phone className="w-4 h-4" />
                Принять
              </button>
            </div>
          )}

          {showRides && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">
                  Активные рейсы ({rides.length})
                </h3>
              </div>

              {loading && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  Загрузка...
                </div>
              )}

              {!loading && rides.length === 0 && (
                <div className="bg-muted rounded-xl px-3 py-3 text-center text-sm text-muted-foreground">
                  Нет активных рейсов
                </div>
              )}

              {rides.map(ride => (
                <div key={ride.id} className="bg-muted rounded-xl px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-600">
                      #{ride.id}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      ride.status === "in_progress" ? "bg-emerald-100 text-emerald-700" :
                      ride.status === "accepted" ? "bg-zinc-100 text-zinc-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>
                      {statusLabels[ride.status] || ride.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-foreground">
                    <MapPin className="w-3 h-3 text-emerald-500 shrink-0" />
                    <span className="truncate">{ride.fromCity}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{ride.toCity}</span>
                  </div>

                  {ride.scheduledAt && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{new Date(ride.scheduledAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  )}

                  {(ride.seatsTotal || 0) > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UsersIcon className="w-3 h-3 shrink-0" />
                      <span>Мест: {ride.seatsTaken || 0}/{ride.seatsTotal}</span>
                    </div>
                  )}

                  {ride.seatPassengers && ride.seatPassengers.length > 0 && (
                    <div className="space-y-1 mt-1 border-t border-border/50 pt-1.5">
                      <p className="text-xs font-semibold text-foreground">Клиенты:</p>
                      {ride.seatPassengers.map((p, idx) => (
                        <div key={p.id || idx} className="flex items-center gap-2 text-xs bg-background rounded-lg px-2 py-1.5">
                          <User className="w-3 h-3 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{p.name || "Клиент"}</p>
                            <p className="text-muted-foreground font-mono">{p.phone}</p>
                            {p.pickupAddress && (
                              <p className="text-muted-foreground truncate">📍 {p.pickupAddress}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {ride.riderName && !ride.seatPassengers?.length && (
                    <div className="flex items-center gap-2 text-xs mt-1 border-t border-border/50 pt-1.5">
                      <User className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span>{ride.riderName}</span>
                      {ride.riderPhone && (
                        <span className="text-muted-foreground font-mono">{ride.riderPhone}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
