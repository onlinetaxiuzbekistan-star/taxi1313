import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Clock, Users, CheckCircle, X, Loader2, Navigation as NavigationIcon, Zap, MapPin, ArrowRight, Package, Banknote, Percent, ArrowDown, Phone } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { useAuth } from "@/hooks/use-auth";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

import { useCommissionRate } from "@/hooks/use-commission-rate";

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
  comment?: string | null;
  baggageType?: string | null;
  seatPassengers?: { seatNumber: number; gender?: string | null; baggageType?: string | null }[];
}

function seatLabel(n: number): string {
  if (n === 1) return "Передн.";
  if (n === 2) return "Зад. лев.";
  if (n === 3) return "Зад. центр";
  if (n === 4) return "Зад. прав.";
  return `Место ${n}`;
}

function baggageLabel(t: string | null | undefined): string {
  if (!t || t === "none") return "";
  if (t === "small") return "Маленький";
  if (t === "large") return "Большой";
  return t;
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

  useEffect(() => { setLeft(seconds); }, [seconds]);

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

export default function IncomingRidePage() {
  const [, navigate] = useLocation();
  const { token, user, refreshUser } = useAuth();
  const COMMISSION_RATE = useCommissionRate();
  const [ride, setRide] = useState<IncomingRide | null>(null);
  const [timeout, setTimeoutSec] = useState(30);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [noRoute, setNoRoute] = useState(false);
  const { startLoop: startOrderSound, stopLoop: stopOrderSound } = useNotificationSound();

  const rideRef = useRef(ride);
  rideRef.current = ride;
  const acceptingRef = useRef(accepting);
  acceptingRef.current = accepting;
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  const decliningRef = useRef(declining);
  decliningRef.current = declining;

  const headers = useRef<Record<string, string>>({});
  useEffect(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    headers.current = h;
  }, [token]);

  const lastOfferIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const fetchOffer = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/drivers/pending-offers`, { headers: headers.current });
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.noRoute) {
            setNoRoute(true);
          }
          if (data.offers && data.offers.length > 0) {
            const o = data.offers[0];
            const offerKey = o.offerId ?? o.id ?? null;
            if (offerKey != null) {
              if (lastOfferIdRef.current === offerKey) {
                console.log("[INCOMING] HTTP duplicate offerId ignored:", offerKey);
                return;
              }
              lastOfferIdRef.current = offerKey;
            }
            setRide(o.ride);
            setTimeoutSec(Math.max(5, Math.round(o.expiresIn / 1000)));
            stopOrderSound();
            startOrderSound("new_order", 2000);
          } else if (!data.noRoute) {
            navigate("/driver", { replace: true });
          }
        }
      } catch {} finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchOffer();
    return () => { cancelled = true; };
  }, [token]);


  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data.type === "new_order" && data.ride) {
        if (acceptedRef.current || acceptingRef.current) return;
        if (data.offerId && data.offerId === lastOfferIdRef.current) {
          console.log("[INCOMING] duplicate offerId ignored:", data.offerId);
          return;
        }
        if (data.offerId) lastOfferIdRef.current = data.offerId;
        setNoRoute(false);
        setRide(data.ride);
        setLoading(false);
        setTimeoutSec(data.expiresIn ? Math.round(data.expiresIn / 1000) : 30);
        stopOrderSound();
        startOrderSound("new_order", 2000);
      } else if (data.type === "order_expired") {
        const currentRideId = rideRef.current?.id;
        const sameRide = currentRideId != null && data.rideId === currentRideId;
        const sameOffer = data.offerId != null && lastOfferIdRef.current != null && data.offerId === lastOfferIdRef.current;
        if ((sameOffer || sameRide) && !acceptedRef.current && !acceptingRef.current) {
          stopOrderSound();
          setRide(null);
          navigate("/driver", { replace: true });
        }
      }
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => {
      stopOrderSound();
      window.removeEventListener("buxtaxi:ws", handler);
    };
  }, []);

  const handleAccept = useCallback(async () => {
    if (!rideRef.current || acceptingRef.current || decliningRef.current || acceptedRef.current) return;
    acceptingRef.current = true;
    stopOrderSound();
    setAccepting(true);
    const savedRideId = rideRef.current.id;
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/accept`, {
        method: "POST",
        headers: headers.current,
        body: JSON.stringify({ rideId: savedRideId }),
      });
      if (res.ok) {
        acceptedRef.current = true;
        setAccepted(true);
        refreshUser();
        window.dispatchEvent(new CustomEvent("buxtaxi:order_accepted", { detail: { rideId: savedRideId } }));
        setTimeout(() => {
          navigate("/driver", { replace: true });
        }, 2000);
      } else {
        stopOrderSound();
        setRide(null);
        navigate("/driver", { replace: true });
      }
    } catch {
      stopOrderSound();
      setRide(null);
      navigate("/driver", { replace: true });
    } finally {
      if (!acceptedRef.current) {
        acceptingRef.current = false;
        setAccepting(false);
      }
    }
  }, [refreshUser, navigate]);

  const handleDecline = useCallback(async () => {
    if (acceptingRef.current || decliningRef.current || acceptedRef.current) return;
    decliningRef.current = true;
    stopOrderSound();
    setDeclining(true);
    try {
      if (rideRef.current) {
        try {
          await fetch(`${BASE_URL}/api/drivers/reject`, {
            method: "POST",
            headers: headers.current,
            body: JSON.stringify({ rideId: rideRef.current.id }),
          });
        } catch {}
      }
      stopOrderSound();
      setRide(null);
      navigate("/driver", { replace: true });
    } finally {
      decliningRef.current = false;
      setDeclining(false);
    }
  }, [navigate]);

  const handleExpire = useCallback(() => {
    if (!acceptingRef.current) handleDecline();
  }, [handleDecline]);

  if (loading) {
    return (
      <div data-theme="dark" className="fixed inset-0 bg-background flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-foreground animate-spin" />
      </div>
    );
  }

  if (noRoute && !ride && !accepted) {
    return (
      <div data-theme="dark" className="fixed inset-0 bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center animate-in fade-in duration-500">
          <div className="bg-card rounded-3xl border border-border p-8">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-foreground/10 border border-border/80 flex items-center justify-center">
              <NavigationIcon className="w-8 h-8 text-foreground" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-3">Создайте рейс</h2>
            <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
              Чтобы получать заказы, сначала создайте рейс на нужный маршрут и время
            </p>
            <button
              onClick={() => navigate("/driver", { replace: true })}
              className="w-full py-3.5 rounded-xl bg-white text-black font-bold text-base active:scale-[0.97] transition-transform"
            >
              Создать рейс
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ride && !accepted) {
    return (
      <div data-theme="dark" className="fixed inset-0 bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground text-lg mb-4">Нет входящих заказов</p>
          <button onClick={() => navigate("/driver", { replace: true })} className="text-foreground font-bold">
            Вернуться
          </button>
        </div>
      </div>
    );
  }

  if (accepted && ride) {
    const totalPrice = ride.price || 0;
    const commission = Math.round(totalPrice * COMMISSION_RATE);
    const driverEarning = totalPrice - commission;
    return (
      <div data-theme="dark" className="fixed inset-0 bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md animate-in zoom-in-50 duration-500">
          <div className="bg-card rounded-3xl shadow-2xl overflow-hidden border border-border">
            <div className="bg-muted px-6 py-6 flex flex-col items-center gap-3">
              <div className="incoming-order-success-ring w-20 h-20 rounded-full bg-foreground/20 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-foreground incoming-order-success-check" />
              </div>
              <p className="text-xl font-black text-foreground">Заказ принят!</p>
              <p className="text-foreground text-lg font-bold">{formatCurrency(driverEarning)}</p>
            </div>
            {ride.riderPhone && (
              <div className="p-5">
                <a
                  href={`tel:${ride.riderPhone}`}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-white text-black font-bold text-base active:scale-[0.97] transition-transform"
                >
                  <Phone className="w-5 h-5" />
                  Позвонить {ride.riderPhone}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!ride) return null;

  const isHighValue = ride.price >= 200000;
  const totalPrice = ride.price || 0;
  const commission = Math.round(totalPrice * COMMISSION_RATE);
  const driverEarning = totalPrice - commission;
  const seatCount = ride.passengers || 0;

  return (
    <div data-theme="dark" className="fixed inset-0 bg-background overflow-y-auto">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -left-20 w-64 h-64 bg-muted/30 rounded-full blur-3xl incoming-page-glow-1" />
        <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-muted/30 rounded-full blur-3xl incoming-page-glow-2" />
      </div>

      <div className="relative min-h-full flex flex-col items-center justify-center p-4">
        <div className="text-center mb-6 animate-in fade-in duration-500">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground/10 border border-border/80 mb-3">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-foreground text-sm font-bold">Входящий заказ</span>
          </div>
        </div>

        <div className="w-full max-w-md animate-in slide-in-from-bottom-8 zoom-in-95 duration-500">
          <div className="bg-card rounded-3xl shadow-2xl overflow-hidden border border-border">

            <div className="relative px-6 pt-5 pb-5 bg-muted">
              <div className="absolute top-3 left-5">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${isHighValue ? "bg-white/25 text-foreground border border-white/30" : "bg-white/15 text-foreground border border-border/80"}`}>
                  <Zap className="w-3 h-3" />
                  {isHighValue ? "Высокий приоритет" : "Новый заказ"}
                </span>
              </div>

              <div className="flex items-end justify-between mt-7">
                <div>
                  <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-widest mb-1">Вы получите</p>
                  <p className="text-[38px] leading-none font-black text-foreground tracking-tight" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.2)" }}>
                    {formatCurrency(driverEarning)}
                  </p>
                  <p className="text-muted-foreground text-xs font-medium mt-1.5">
                    из {formatCurrency(totalPrice)} (−{Math.round(COMMISSION_RATE * 100)}%)
                  </p>
                </div>
                <CountdownTimer seconds={timeout} onExpire={handleExpire} />
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="bg-muted/60 rounded-2xl p-4 border border-border">
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
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-muted text-muted-foreground px-3 py-1.5 rounded-lg border border-border">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                  {seatCount} {seatWord(seatCount)}
                </span>
                {ride.carClass && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-muted text-muted-foreground px-3 py-1.5 rounded-lg border border-border">
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                    {ride.carClass}
                  </span>
                )}
                {ride.scheduledAt && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-muted text-muted-foreground px-3 py-1.5 rounded-lg border border-border">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(ride.scheduledAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                {ride.distance != null && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-muted text-muted-foreground px-3 py-1.5 rounded-lg border border-border">
                    <NavigationIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    {ride.distance} км
                  </span>
                )}
              </div>
            </div>

            {(ride.comment || baggageLabel(ride.baggageType) || (ride.seatPassengers && ride.seatPassengers.length > 0)) && (
              <div className="px-5 pb-3 space-y-2">
                {ride.seatPassengers && ride.seatPassengers.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ride.seatPassengers.map((p, idx) => {
                      const isFemale = p.gender === "female";
                      const isMale = p.gender === "male";
                      const cls = isFemale
                        ? "bg-pink-500/15 text-pink-700 border-pink-500/30"
                        : isMale
                        ? "bg-blue-500/15 text-blue-700 border-blue-500/30"
                        : "bg-muted text-muted-foreground border-border";
                      const icon = isFemale ? "♀" : isMale ? "♂" : "";
                      return (
                        <span key={`${p.seatNumber}-${idx}`} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${cls}`}>
                          {icon && <span>{icon}</span>}
                          {seatLabel(p.seatNumber)}
                        </span>
                      );
                    })}
                  </div>
                )}
                {baggageLabel(ride.baggageType) && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Багаж:</span>
                    <span className="font-bold text-foreground">{baggageLabel(ride.baggageType)}</span>
                  </div>
                )}
                {ride.comment && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
                    <p className="text-[10px] text-amber-700 font-bold uppercase tracking-wider mb-0.5">Комментарий клиента</p>
                    <p className="text-sm text-foreground italic">«{ride.comment}»</p>
                  </div>
                )}
              </div>
            )}

            <div className="px-5 pb-3">
              <div className="bg-muted/60 rounded-xl p-3 space-y-1.5 border border-border">
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
                <div className="border-t border-border pt-1.5 flex items-center justify-between">
                  <span className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <ArrowDown className="w-3.5 h-3.5 text-muted-foreground" />
                    Вы получите
                  </span>
                  <span className="text-lg font-extrabold text-foreground">{formatCurrency(driverEarning)}</span>
                </div>
              </div>
            </div>

            <div className="px-5 pb-5 space-y-2.5 mt-2">
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
                className="w-full py-3 rounded-2xl bg-muted hover:bg-white/[0.1] text-muted-foreground font-bold text-sm active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2 border border-border"
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
  );
}
