import { useState, useEffect, useRef, useCallback } from "react";
import { Clock, Users, CheckCircle, X, Loader2, Navigation as NavigationIcon, Zap, MapPin, ArrowRight, Package, Banknote, Percent, ArrowDown, Phone } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { useAuth } from "@/hooks/use-auth";
import { useCommissionRate } from "@/hooks/use-commission-rate";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function formatRoutePoint(districtName: string | null | undefined, cityName: string): string {
  if (districtName) return `${districtName} (${cityName})`;
  return cityName;
}

interface IncomingRide {
  id: number;
  fromCity: string;
  toCity: string;
  fromAddress?: string;
  toAddress?: string;
  fromDistrictName?: string | null;
  toDistrictName?: string | null;
  price: number;
  passengers: number;
  distance?: number;
  duration?: number;
  carClass?: string;
  scheduledAt?: string;
  riderName?: string;
  riderPhone?: string;
}

function seatWord(n: number) {
  if (n === 1) return "место";
  if (n >= 2 && n <= 4) return "места";
  return "мест";
}

function CountdownTimer({ seconds, onExpire }: { seconds: number; onExpire: () => void }) {
  const [left, setLeft] = useState(seconds);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    setLeft(seconds);
  }, [seconds]);

  useEffect(() => {
    if (left <= 0) { onExpireRef.current(); return; }
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const pct = seconds > 0 ? (left / seconds) * 100 : 0;
  const urgent = left <= 5;
  const circumference = 2 * Math.PI * 44;

  return (
    <div className="relative w-24 h-24">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 104 104">
        <circle cx="52" cy="52" r="44" fill="none" className="stroke-border" strokeWidth="5" opacity={0.3} />
        <circle
          cx="52" cy="52" r="44" fill="none"
          stroke={urgent ? "#ef4444" : "#ffffff"}
          strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          className="transition-all duration-1000 ease-linear"
          style={{ filter: urgent ? "drop-shadow(0 0 8px rgba(239,68,68,0.5))" : "drop-shadow(0 0 6px rgba(16,185,129,0.4))" }}
        />
        {urgent && (
          <circle
            cx="52" cy="52" r="44" fill="none"
            stroke="#ef4444"
            strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct / 100)}
            className="animate-pulse"
            opacity={0.4}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-black tabular-nums ${urgent ? "text-red-500 animate-pulse" : "text-foreground"}`}>{left}</span>
        <span className="text-[10px] text-muted-foreground font-semibold -mt-0.5">сек</span>
      </div>
    </div>
  );
}

export default function IncomingOrderModal() {
  const { token, refreshUser } = useAuth();
  const COMMISSION_RATE = useCommissionRate();
  const [ride, setRide] = useState<IncomingRide | null>(null);
  const [timeout, setTimeoutSec] = useState(30);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const { startLoop: startOrderSound, stopLoop: stopOrderSound } = useNotificationSound();

  const rideRef = useRef(ride);
  rideRef.current = ride;
  const acceptingRef = useRef(accepting);
  acceptingRef.current = accepting;
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  const acceptedRideIdRef = useRef<number | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const headers = useRef<Record<string, string>>({});
  useEffect(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    headers.current = h;
  }, [token]);

  useEffect(() => {
    if (!ride) return;
    shakeTimerRef.current = setTimeout(() => {
      setShaking(true);
      setTimeout(() => setShaking(false), 600);
    }, 5000);
    return () => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    };
  }, [ride?.id]);

  useEffect(() => {
    if (!token) return;
    const poll = async () => {
      if (acceptingRef.current || acceptedRef.current || rideRef.current) return;
      try {
        const res = await fetch(`${BASE_URL}/api/drivers/pending-offers`, { headers: headers.current });
        if (res.ok) {
          const data = await res.json();
          if (data.offers && data.offers.length > 0) {
            const o = data.offers[0];
            setRide(o.ride);
            setTimeoutSec(Math.max(5, Math.round(o.expiresIn / 1000)));
            startOrderSound("new_order", 2000);
          }
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [token]);

  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data.type === "new_order" && data.ride) {
        console.log("[RECEIVED OFFER]", data.ride.id, data.ride.fromCity, "→", data.ride.toCity, "expiresIn=", data.expiresIn);
        if (acceptedRef.current || acceptingRef.current) return;
        setRide(data.ride);
        setTimeoutSec(data.expiresIn ? Math.round(data.expiresIn / 1000) : 30);
        startOrderSound("new_order", 2000);
      } else if (data.type === "order_expired") {
        if (rideRef.current && rideRef.current.id === data.rideId && !acceptedRef.current && !acceptingRef.current) {
          stopOrderSound();
          setRide(null);
        }
      }
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => {
      stopOrderSound();
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      window.removeEventListener("buxtaxi:ws", handler);
    };
  }, []);

  const handleAccept = useCallback(async () => {
    if (!rideRef.current || acceptingRef.current) return;
    stopOrderSound();
    const savedRideId = rideRef.current.id;
    setAccepting(true);
    setAccepted(true);
    acceptedRideIdRef.current = savedRideId;
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/accept`, {
        method: "POST",
        headers: headers.current,
        body: JSON.stringify({ rideId: savedRideId }),
      });
      setAccepting(false);
      if (res.ok) {
        window.dispatchEvent(new CustomEvent("buxtaxi:order_accepted", { detail: { rideId: savedRideId } }));
        refreshUser();
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => {
          if (acceptedRideIdRef.current === savedRideId) {
            setRide(null);
            setAccepted(false);
            acceptedRideIdRef.current = null;
          }
        }, 2000);
      } else {
        const err = await res.json().catch(() => ({}));
        window.dispatchEvent(new CustomEvent("buxtaxi:order_error", { detail: { message: err.message || "Ошибка" } }));
        setRide(null);
        setAccepted(false);
        acceptedRideIdRef.current = null;
      }
    } catch {
      window.dispatchEvent(new CustomEvent("buxtaxi:order_error", { detail: { message: "Ошибка сети" } }));
      setRide(null);
      setAccepted(false);
      setAccepting(false);
      acceptedRideIdRef.current = null;
    }
  }, [refreshUser]);

  const handleDecline = useCallback(async () => {
    if (acceptingRef.current) return;
    stopOrderSound();
    setDeclining(true);
    if (rideRef.current) {
      try {
        await fetch(`${BASE_URL}/api/drivers/reject`, {
          method: "POST",
          headers: headers.current,
          body: JSON.stringify({ rideId: rideRef.current.id }),
        });
      } catch {}
    }
    setRide(null);
    setDeclining(false);
    window.dispatchEvent(new Event("buxtaxi:order_declined"));
  }, []);

  const handleExpire = useCallback(() => {
    if (!acceptingRef.current) {
      handleDecline();
    }
  }, [handleDecline]);

  if (!ride) return null;

  const isHighValue = ride.price >= 200000;
  const priorityLabel = isHighValue ? "Высокий приоритет" : "Ближайший заказ";
  const totalPrice = ride.price || 0;
  const commission = Math.round(totalPrice * COMMISSION_RATE);
  const driverEarning = totalPrice - commission;
  const seatCount = ride.passengers || 0;

  if (accepted) {
    return (
      <div className="fixed inset-0 z-[9999]" onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
        <div className="relative z-[10000] flex flex-col h-full">
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-md animate-in zoom-in-50 duration-500">
              <div className="bg-card rounded-3xl shadow-2xl overflow-hidden border border-primary/20">
                <div className="bg-zinc-900 px-6 py-6 flex flex-col items-center gap-3">
                  <div className="incoming-order-success-ring w-20 h-20 rounded-full bg-white/20 flex items-center justify-center">
                    <CheckCircle className="w-10 h-10 text-white incoming-order-success-check" />
                  </div>
                  <p className="text-xl font-black text-white">Заказ принят!</p>
                </div>

                {ride.riderName && (
                  <div className="p-5">
                    <div className="bg-primary/8 border border-primary/15 rounded-xl p-4 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Контакт клиента</p>
                      <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                        {ride.riderName}
                        {ride.riderName === "Женщина" && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-bold">👩</span>}
                        {ride.riderName === "Мужчина" && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-bold">👨</span>}
                      </p>
                      {ride.riderPhone && (
                        <a
                          href={`tel:${ride.riderPhone}`}
                          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-white text-black font-bold text-base active:scale-[0.97] transition-transform"
                        >
                          <Phone className="w-5 h-5" />
                          Позвонить {ride.riderPhone}
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {!ride.riderName && (
                  <div className="p-5 text-center">
                    <p className="text-sm text-muted-foreground">Переход к поездке...</p>
                  </div>
                )}

                <div className="px-5 pb-5">
                  <button
                    onClick={() => {
                      if (successTimerRef.current) clearTimeout(successTimerRef.current);
                      setRide(null);
                      setAccepted(false);
                      acceptedRideIdRef.current = null;
                    }}
                    className="w-full py-3 rounded-2xl bg-primary/10 hover:bg-primary/20 text-primary font-bold text-sm active:scale-[0.97] transition-all flex items-center justify-center gap-2 border border-primary/15"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Закрыть
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999]" onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

      <div className="relative z-[10000] flex flex-col h-full overflow-y-auto">
        <div className="flex-1 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md animate-in slide-in-from-bottom-8 zoom-in-95 duration-300 ${shaking ? "incoming-order-shake" : ""}`}
          >
            <div className="bg-card rounded-3xl shadow-2xl shadow-black/40 overflow-hidden border border-white/[0.06]">

              <div className="relative px-6 pt-5 pb-5 bg-zinc-900">
                <div className="absolute top-3 left-5">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${isHighValue ? "bg-white/25 text-white border border-white/30" : "bg-white/15 text-white/90 border border-white/20"}`}>
                    <Zap className="w-3 h-3" />
                    {priorityLabel}
                  </span>
                </div>

                <div className="flex items-end justify-between mt-7">
                  <div>
                    <p className="text-white/60 text-[11px] font-semibold uppercase tracking-widest mb-1">Вы получите</p>
                    <p className="text-[38px] leading-none font-black text-white tracking-tight" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.2)" }}>
                      {formatCurrency(driverEarning)}
                    </p>
                    <p className="text-white/50 text-xs font-medium mt-1.5">
                      из {formatCurrency(totalPrice)} (−{Math.round(COMMISSION_RATE * 100)}%)
                    </p>
                  </div>
                  <CountdownTimer seconds={timeout} onExpire={handleExpire} />
                </div>
              </div>

              <div className="px-5 py-4">
                <div className="bg-secondary/40 rounded-2xl p-4 border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Маршрут</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-3 h-3 rounded-full bg-white ring-[3px] ring-white/20" />
                      <div className="w-px h-6 border-l-2 border-dashed border-border" />
                      <div className="w-3 h-3 rounded-full bg-red-400 ring-[3px] ring-red-400/20" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div>
                        <p className="text-sm font-bold text-foreground leading-tight">{formatRoutePoint(ride.fromDistrictName, ride.fromCity)}</p>
                        {ride.fromAddress && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{ride.fromAddress}</p>}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground leading-tight">{formatRoutePoint(ride.toDistrictName, ride.toCity)}</p>
                        {ride.toAddress && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{ride.toAddress}</p>}
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground/40 shrink-0" />
                  </div>
                </div>
              </div>

              <div className="px-5 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-secondary/50 text-foreground/80 px-3 py-1.5 rounded-lg border border-white/[0.06]">
                    <Users className="w-3.5 h-3.5 text-primary" />
                    {seatCount} {seatWord(seatCount)}
                  </span>
                  {ride.carClass && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-secondary/50 text-foreground/80 px-3 py-1.5 rounded-lg border border-white/[0.06]">
                      <Package className="w-3.5 h-3.5 text-primary" />
                      {ride.carClass}
                    </span>
                  )}
                  {ride.scheduledAt && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 text-white/80 px-3 py-1.5 rounded-lg border border-white/15">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(ride.scheduledAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  {ride.distance != null && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-secondary/50 text-foreground/80 px-3 py-1.5 rounded-lg border border-white/[0.06]">
                      <NavigationIcon className="w-3.5 h-3.5 text-primary" />
                      {ride.distance} км
                    </span>
                  )}
                </div>
              </div>

              <div className="px-5 pb-3">
                <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5 border border-white/[0.06]">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Banknote className="w-3.5 h-3.5" />
                      Стоимость
                    </span>
                    <span className="font-bold text-foreground">{formatCurrency(totalPrice)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5" />
                      Комиссия ({Math.round(COMMISSION_RATE * 100)}%)
                    </span>
                    <span className="font-medium text-red-400">−{formatCurrency(commission)}</span>
                  </div>
                  <div className="border-t border-white/[0.06] pt-1.5 flex items-center justify-between">
                    <span className="text-sm font-bold text-foreground flex items-center gap-1.5">
                      <ArrowDown className="w-3.5 h-3.5 text-primary" />
                      Вы получите
                    </span>
                    <span className="text-lg font-extrabold text-foreground">{formatCurrency(driverEarning)}</span>
                  </div>
                </div>
              </div>

              <div className="px-5 pb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 rounded-xl px-3 py-2.5 border border-white/[0.06]">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {ride.riderName ? (
                    <span>{ride.riderName}</span>
                  ) : (
                    <span className="text-muted-foreground/80">Клиент</span>
                  )}
                  <span className="ml-auto text-muted-foreground/60 italic">Номер скрыт</span>
                </div>
              </div>

              <div className="px-5 pb-5 space-y-2.5">
                <button
                  onClick={handleAccept}
                  disabled={accepting || declining}
                  className="w-full py-4 rounded-2xl bg-white text-black font-extrabold text-lg shadow-lg shadow-white/20 active:scale-[0.95] transition-all disabled:opacity-60 flex items-center justify-center gap-3"
                >
                  {accepting ? (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin" />
                      Принимаю...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-6 h-6" />
                      Принять • {formatCurrency(driverEarning)}
                    </>
                  )}
                </button>

                <button
                  onClick={handleDecline}
                  disabled={accepting || declining}
                  className="w-full py-3 rounded-2xl bg-white/[0.06] hover:bg-white/[0.1] text-muted-foreground font-bold text-sm active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2 border border-white/[0.06]"
                >
                  {declining ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      Отклонить
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
