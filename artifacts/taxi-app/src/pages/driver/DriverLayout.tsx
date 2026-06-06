import { ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, Redirect } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Briefcase, User, Bell, Power, Loader2, MessageCircle, Zap, ShoppingBag, ShieldBan, AlertTriangle, Wallet, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUnreadChat, UnreadChatContext, useUnreadChatProvider } from "@/hooks/use-unread-chat";
import { useDriverWsConnection, DriverWsContext } from "@/hooks/use-driver-ws";
import { useDriverNotifications } from "@/hooks/use-driver-notifications";
import { initAudioOnInteraction } from "@/hooks/use-notification-sound";
import DriverChatModal from "@/components/DriverChatModal";
import DriverIncomingCall from "@/components/DriverIncomingCall";
import DriverNotificationPopup from "@/components/DriverNotificationPopup";
import DriverOnboarding from "@/components/DriverOnboarding";
import DriverTutorial from "@/components/DriverTutorial";
import LocationGate from "@/components/LocationGate";
import IncomingOrderModal from "@/components/IncomingOrderModal";
import PhotoControlModal from "@/components/PhotoControlModal";
import { useSettingsStore } from "@/stores/settings";
import { useConnection } from "@/hooks/use-connection";

function useBanCountdown(bannedUntil: string | Date | null | undefined, onExpired?: () => void) {
  const [remaining, setRemaining] = useState(() => {
    if (!bannedUntil) return 0;
    const diff = new Date(bannedUntil).getTime() - Date.now();
    return diff > 0 ? diff : 0;
  });
  const wasBannedRef = { current: false };

  useEffect(() => {
    if (!bannedUntil) { setRemaining(0); return; }
    const initial = new Date(bannedUntil).getTime() - Date.now();
    if (initial <= 0) { setRemaining(0); return; }

    setRemaining(initial);
    wasBannedRef.current = true;

    const interval = setInterval(() => {
      const diff = new Date(bannedUntil).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining(0);
        clearInterval(interval);
        if (wasBannedRef.current) {
          wasBannedRef.current = false;
          onExpired?.();
        }
      } else {
        setRemaining(diff);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [bannedUntil, onExpired]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const display = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return { remaining, display, isBanned: remaining > 0 };
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const CITY_PREFIX: Record<string, string> = {
  "Ташкент": "TAS", "Самарканд": "SAM", "Бухара": "BUX", "Фергана": "FER",
  "Андижан": "AND", "Наманган": "NAM", "Нукус": "NUK", "Карши": "KAR",
  "Навои": "NAV", "Термез": "TER", "Гулистан": "GUL", "Джиззак": "JIZ", "Ургенч": "URG",
};

function getCallsign(user: any): string {
  const pfx = user?.city ? (CITY_PREFIX[user.city] || "BT") : "BT";
  return `${pfx}-${String(user?.id || 0).padStart(3, "0")}`;
}

function getPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const base = (import.meta.env.BASE_URL || "").replace(/\/$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}

export default function DriverLayout({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const wsRef = useDriverWsConnection(token);
  const chatState = useUnreadChatProvider(token, user?.id, wsRef);
  const [onboardingDone, setOnboardingDone] = useState(() =>
    localStorage.getItem("buxtaxi_onboarding_completed") === "true"
  );
  const [tutorialDone, setTutorialDone] = useState(() =>
    localStorage.getItem("buxtaxi_tutorial_completed") === "true"
  );

  useEffect(() => {
    initAudioOnInteraction();
  }, []);

  if (!user) return <Redirect to="/driver-login" />;

  if (user.role !== "driver") {
    return (
      <DriverWsContext.Provider value={{ wsRef }}>
        <UnreadChatContext.Provider value={chatState}>
          <DriverLayoutInner wsRef={wsRef}>{children}</DriverLayoutInner>
        </UnreadChatContext.Provider>
      </DriverWsContext.Provider>
    );
  }

  if (!onboardingDone) {
    return <DriverOnboarding onComplete={() => setOnboardingDone(true)} />;
  }

  if (!tutorialDone) {
    return <DriverTutorial onComplete={() => setTutorialDone(true)} />;
  }

  return (
    <LocationGate>
      <DriverWsContext.Provider value={{ wsRef }}>
        <UnreadChatContext.Provider value={chatState}>
          <DriverLayoutInner wsRef={wsRef}>{children}</DriverLayoutInner>
        </UnreadChatContext.Provider>
      </DriverWsContext.Provider>
    </LocationGate>
  );
}

function DriverLayoutInner({ children, wsRef }: { children: ReactNode; wsRef: React.MutableRefObject<WebSocket | null> }) {
  const [location, navigate] = useLocation();
  const { user, token, refreshUser } = useAuth();
  const { toast } = useToast();
  const [toggling, setToggling] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const handleBanExpired = useCallback(() => { refreshUser(); }, [refreshUser]);
  const { isBanned, display: banCountdown } = useBanCountdown(user?.bannedUntil, handleBanExpired);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [blockUntil, setBlockUntil] = useState<string | null>(user?.bannedUntil || null);
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, permission: pushPermission, subscribe: subscribePush } = usePushNotifications();
  const [showPushBanner, setShowPushBanner] = useState(false);
  const { unreadCount, chatOpen, setChatOpen, rideId, setRideId, dispatcherId, dispatcherName, chatPeer } = useUnreadChat();
  const lang = useSettingsStore(s => s.language);

  const connection = useConnection();
  const [hasPhotoRequest, setHasPhotoRequest] = useState(false);
  const [photoCheckDone, setPhotoCheckDone] = useState(false);
  const [photoRejectReason, setPhotoRejectReason] = useState<string | null>(null);

  const [blockedAppsDetected, setBlockedAppsDetected] = useState<{ name: string; packageName: string }[]>([]);
  const [showBlockedAppsModal, setShowBlockedAppsModal] = useState(false);
  const blockedAppsListRef = useRef<{ name: string; packageName: string; urlScheme: string | null; enabled: boolean }[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/api/blocked-apps`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { apps: [] })
      .then(d => { blockedAppsListRef.current = (d.apps || []).filter((a: any) => a.enabled); })
      .catch(() => {});
  }, [token]);

  const checkBlockedApps = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${BASE_URL}/api/blocked-apps`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        blockedAppsListRef.current = (data.apps || []).filter((a: any) => a.enabled);
      }
    } catch {}

    const list = blockedAppsListRef.current;
    if (list.length === 0) return true;

    const native = (window as any).__buxtaxiNative;
    if (native?.getInstalledPackages) {
      try {
        const installed: string[] = JSON.parse(native.getInstalledPackages() || "[]");
        const found = list.filter(a => installed.includes(a.packageName));
        if (found.length > 0) {
          setBlockedAppsDetected(found.map(a => ({ name: a.name, packageName: a.packageName })));
          setShowBlockedAppsModal(true);
          return false;
        }
      } catch {}
      return true;
    }

    if (native?.isPackageInstalled) {
      const found: { name: string; packageName: string }[] = [];
      for (const app of list) {
        try {
          const result = native.isPackageInstalled(app.packageName);
          if (result === true || result === "true") {
            found.push({ name: app.name, packageName: app.packageName });
          }
        } catch {}
      }
      if (found.length > 0) {
        setBlockedAppsDetected(found);
        setShowBlockedAppsModal(true);
        return false;
      }
      return true;
    }

    return true;
  }, []);

  const checkPhotoStatus = useCallback(() => {
    if (!token) return;
    const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    fetch(`${BASE}/api/photo-control/my-pending`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setHasPhotoRequest(!!d.blocked);
        setPhotoRejectReason(d.request?.rejectReason || null);
        setPhotoCheckDone(true);
      })
      .catch(() => setPhotoCheckDone(true));
  }, [token]);

  useEffect(() => { checkPhotoStatus(); }, [checkPhotoStatus]);

  useEffect(() => {
    if (isBanned && !blockReason && token) {
      const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      fetch(`${BASE}/api/drivers/my-block-reason`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.ok ? r.json() : null).then(data => {
        if (data?.reason) setBlockReason(data.reason);
        if (data?.bannedUntil) setBlockUntil(data.bannedUntil);
      }).catch(() => {});
    }
  }, [isBanned, blockReason, token]);

  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data?.type === "photo_control_required") {
        setHasPhotoRequest(true);
        setPhotoRejectReason(null);
      } else if (data?.type === "photo_control_rejected") {
        if (data.blocked) {
          setHasPhotoRequest(true);
        } else {
          checkPhotoStatus();
        }
        if (data.reason) setPhotoRejectReason(data.reason);
      } else if (data?.type === "photo_control_approved") {
        setHasPhotoRequest(false);
        setPhotoRejectReason(null);
      } else if (data?.type === "driver_blocked") {
        setBlockReason(data.reason || null);
        setBlockUntil(data.bannedUntil || null);
        refreshUser();
      } else if (data?.type === "driver_unblocked") {
        setBlockReason(null);
        setBlockUntil(null);
        refreshUser();
      }
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, [checkPhotoStatus, refreshUser]);

  const isDriver = user?.role === "driver";
  const callsign = getCallsign(user);
  const driverPhotoSrc = getPhotoUrl((user as any)?.driverPhoto);
  const {
    currentPopup,
    dismissPopup,
    marketplaceUpdates,
    clearMarketplaceBadge,
  } = useDriverNotifications(wsRef, isDriver);

  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      const base = import.meta.env.BASE_URL || "/";
      navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});

      const handleSWMessage = (event: MessageEvent) => {
        if (event.data?.type === "navigate_incoming") {
          navigate("/driver/incoming");
        } else if (event.data?.type === "navigate_news") {
          navigate("/driver/news");
        } else if (event.data?.type === "open_chat") {
          if (event.data.rideId && event.data.rideId > 0) {
            setRideId(event.data.rideId);
          }
          setChatOpen(true);
        }
      };
      navigator.serviceWorker.addEventListener("message", handleSWMessage);
      return () => {
        navigator.serviceWorker.removeEventListener("message", handleSWMessage);
      };
    }
  }, [setChatOpen, setRideId]);

  useEffect(() => {
    if (pushSupported && pushPermission === "default" && !pushSubscribed && user?.role === "driver") {
      const dismissed = sessionStorage.getItem("push_banner_dismissed");
      if (!dismissed) setShowPushBanner(true);
    }
  }, [pushSupported, pushPermission, pushSubscribed, user]);

  const handleEnablePush = async () => {
    const ok = await subscribePush();
    if (ok) {
      toast({ title: "Уведомления включены!" });
    } else {
      toast({ variant: "destructive", title: "Не удалось включить уведомления" });
    }
    setShowPushBanner(false);
  };

  if (!user) return <Redirect to="/driver-login" />;

  if (user.role !== "driver") {
    return <Redirect to="/driver-login" />;
  }

  const isOnline = user.status === "online" || user.status === "busy";

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator && !wakeLockRef.current) {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
          wakeLockRef.current?.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        }
      } catch {}
      try { (window as any).__buxtaxiNative?.keepScreenOn?.(true); } catch {}
    };

    requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  const doExitApp = async () => {
    setShowExitConfirm(false);
    const w = window as any;
    const cap = w.Capacitor;

    // Try every known way to close, in priority order. Don't gate on isNativePlatform()
    // — in some Capacitor remote-URL builds it returns false even when Plugins.App exists.

    // 1. Native Android JS-interface (truly closes activity, removes from recents)
    if (w.AndroidExit?.exitApp) {
      try { w.AndroidExit.exitApp(); return; } catch (e) { console.warn("[exit] AndroidExit.exitApp:", e); }
    }
    // 2. Capacitor Plugins.App.exitApp
    if (cap?.Plugins?.App?.exitApp) {
      try { await cap.Plugins.App.exitApp(); return; } catch (e) { console.warn("[exit] Plugins.App.exitApp:", e); }
    }
    // 2. Bridge call directly (some Capacitor builds expose it this way)
    if (cap?.nativeCallback) {
      try { cap.nativeCallback("App", "exitApp", {}); return; } catch (e) { console.warn("[exit] nativeCallback:", e); }
    }
    if (cap?.Plugins?.App?.minimizeApp) {
      try { await cap.Plugins.App.minimizeApp(); return; } catch (e) { console.warn("[exit] minimizeApp:", e); }
    }

    // Diagnostic toast — show what's actually available so we can debug
    const diag = `Capacitor=${!!cap} isNative=${cap?.isNativePlatform?.()} Plugins=${cap?.Plugins ? Object.keys(cap.Plugins).join(",") : "none"}`;
    console.warn("[exit] no exit method available. " + diag);
    toast({
      title: lang === "uz" ? "Chiqib bolmadi" : "Не удалось закрыть",
      description: diag.length > 120 ? diag.slice(0, 120) : diag,
      variant: "destructive",
    });
  };

  const toggleStatus = async () => {
    if (!isOnline) {
      const appsOk = await checkBlockedApps();
      if (!appsOk) return;
    }
    // Balance check is enforced server-side via min_driver_balance setting.
    // Server returns 403 with insufficient_balance if blocked — error handler below shows the toast.
    const newStatus = isOnline ? "offline" : "online";
    setToggling(true);
    try {
      const res = await fetch(`${BASE_URL}/api/drivers/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast({ title: newStatus === "online" ? "Вы на линии!" : "Вы офлайн" });
        refreshUser();
      } else {
        const err = await res.json().catch(() => ({}));
        if (err.error === "driver_banned") {
          toast({ variant: "destructive", title: "Вы заблокированы", description: err.message });
          refreshUser();
        } else if (err.error === "photo_required") {
          setHasPhotoRequest(true);
          toast({ variant: "destructive", title: "Фотоконтроль", description: err.message });
        } else {
          toast({ variant: "destructive", title: err.message || err.error || "Ошибка" });
        }
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети" });
    } finally {
      setToggling(false);
    }
  };

  const navs = [
    { path: "/driver", icon: Briefcase, label: lang === "uz" ? "Buyurtmalar" : "Заказы", badge: 0 },
    { path: "/driver/urgent", icon: Zap, label: lang === "uz" ? "Shoshilinch" : "Срочные", badge: marketplaceUpdates },
    { path: "/driver/chat", icon: MessageCircle, label: lang === "uz" ? "Chat" : "Чат", badge: unreadCount },
    { path: "/driver/profile", icon: User, label: lang === "uz" ? "Profil" : "Профиль", badge: 0 },
  ];

  return (
    <div className="driver-theme min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-lg border-b border-white/[0.06]">
        <div className="flex items-center justify-between px-3 h-14">
          <div className="flex items-center gap-2">
            <Link
              href="/driver/profile"
              className="flex items-center gap-1.5 bg-white/[0.06] px-2.5 py-1.5 rounded-lg active:scale-95 transition-all no-underline"
            >
              {driverPhotoSrc ? (
                <img src={`${driverPhotoSrc}${driverPhotoSrc.includes("?") ? "&" : "?"}v=${user?.updatedAt || ""}`} alt="" className="w-6 h-6 rounded-full object-cover border border-white/10" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                  <User className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <span className="text-sm font-extrabold font-mono text-foreground tracking-wide">{callsign}</span>
            </Link>
            {(() => {
              const bal = Number((user as any)?.balance || 0);
              const neg = bal < 0;
              return (
                <Link href="/driver/wallet"
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg active:scale-95 transition-all no-underline border ${neg ? "bg-red-500/10 border-red-500/30 text-red-400" : "bg-zinc-900 border-zinc-700 text-white"}`}
                  title={lang === "uz" ? "Balans" : "Баланс"}>
                  <Wallet className="w-3.5 h-3.5" />
                  <span className="text-sm font-extrabold tracking-tight tabular-nums">
                    {bal.toLocaleString("ru-RU")}
                  </span>
                  <span className="text-[10px] font-bold opacity-70">сум</span>
                </Link>
              );
            })()}
          </div>

          <button
            onClick={toggleStatus}
            disabled={toggling}
            className={`flex items-center gap-1.5 h-9 pl-3 pr-2 rounded-full transition-all ${
              isOnline
                ? "bg-zinc-900 text-white shadow-md shadow-zinc-900/30 border border-zinc-700"
                : "bg-secondary text-muted-foreground"
            } disabled:opacity-50`}
          >
            <div className={`w-2 h-2 rounded-full ${isOnline ? "bg-white animate-pulse" : "bg-muted-foreground"}`} />
            <span className="text-xs font-bold">{user.status === "busy" ? (lang === "uz" ? "Reysda" : "В рейсе") : isOnline ? "Online" : "Offline"}</span>
            {toggling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setShowExitConfirm(true)}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-red-500/10 border border-red-500/30 text-red-500 active:scale-95 transition-all"
            title={lang === "uz" ? "Chiqish" : "Закрыть приложение"}
            aria-label={lang === "uz" ? "Chiqish" : "Закрыть приложение"}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {showExitConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6" onClick={() => setShowExitConfirm(false)}>
          <div className="w-full max-w-xs bg-card rounded-2xl p-6 shadow-2xl border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-center w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/30">
              <LogOut className="w-7 h-7 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-foreground text-center mb-2">{lang === "uz" ? "Dasturdan chiqasizmi?" : "Закрыть приложение?"}</h3>
            <p className="text-sm text-muted-foreground text-center mb-6">{lang === "uz" ? "Dastur yopiladi" : "Приложение будет закрыто"}</p>
            <div className="flex gap-3">
              <button onClick={() => setShowExitConfirm(false)} className="flex-1 py-3 rounded-xl bg-secondary text-foreground font-semibold active:scale-95 transition-all">
                {lang === "uz" ? "Bekor qilish" : "Отмена"}
              </button>
              <button onClick={doExitApp} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold active:scale-95 transition-all">
                {lang === "uz" ? "Chiqish" : "Закрыть"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isBanned && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="mx-6 w-full max-w-sm bg-card rounded-2xl p-8 text-center shadow-2xl border border-border">
            <div className="text-5xl mb-4">⛔</div>
            <h2 className="text-xl font-bold text-foreground mb-3">{lang === "uz" ? "Siz vaqtincha bloklangansiz" : "Вы временно заблокированы"}</h2>
            {blockReason ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4 mb-5">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">{lang === "uz" ? "Bloklash sababi" : "Причина блокировки"}</p>
                <p className="text-base text-foreground font-semibold leading-snug">{blockReason}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-4">{lang === "uz" ? "Aniqlashtirish uchun dispetcherga murojaat qiling" : "Обратитесь к диспетчеру для уточнения"}</p>
            )}
            {(blockUntil || user?.bannedUntil) && (
              <p className="text-[11px] text-muted-foreground mb-1">
                {lang === "uz" ? "Gacha" : "До"}: {new Date(blockUntil || user!.bannedUntil!).toLocaleDateString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{lang === "uz" ? "Blokdan chiqish" : "Разблокировка через"}</p>
            <div className="inline-block bg-red-500 text-white font-mono text-3xl font-bold px-6 py-3 rounded-xl tabular-nums shadow-lg shadow-red-500/30 mb-6">
              {banCountdown}
            </div>
            <div>
              <button
                onClick={() => {}}
                className="w-full bg-muted text-muted-foreground font-semibold py-3 rounded-xl text-sm"
              >
                {lang === "uz" ? "Tushundim" : "Понятно"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBlockedAppsModal && blockedAppsDetected.length > 0 && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="mx-6 w-full max-w-sm bg-card rounded-2xl p-8 text-center shadow-2xl border border-border">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <ShieldBan className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              {lang === "uz" ? "Taqiqlangan ilovalar topildi" : "Обнаружены запрещённые приложения"}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {lang === "uz"
                ? "Ishni boshlash uchun quyidagi ilovalarni o'chiring"
                : "Для начала работы удалите следующие приложения с устройства"}
            </p>
            <div className="space-y-2 mb-6">
              {blockedAppsDetected.map((app, i) => (
                <div key={i} className="bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                  <div className="text-left">
                    <p className="text-sm font-semibold text-foreground">{app.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{app.packageName}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {lang === "uz"
                ? "Ilovalarni o'chirib, qayta urinib ko'ring"
                : "Удалите приложения и попробуйте снова"}
            </p>
            <button
              onClick={() => {
                setShowBlockedAppsModal(false);
                setBlockedAppsDetected([]);
              }}
              className="w-full bg-muted text-muted-foreground font-semibold py-3 rounded-xl text-sm hover:bg-muted/80 active:scale-95 transition-all"
            >
              {lang === "uz" ? "Tushundim" : "Понятно"}
            </button>
          </div>
        </div>
      )}

      <main className="pt-14 pb-[calc(72px+env(safe-area-inset-bottom)+24px)] flex flex-col h-screen">
        {showPushBanner && !isBanned && (
          <div className="bg-primary/8 border-b border-primary/15 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Bell className="w-4 h-4 text-primary shrink-0" />
              <span className="text-foreground">{lang === "uz" ? "Buyurtmalarni o'tkazib yubormaslik uchun bildirishnomalarni yoqing" : "Включите уведомления, чтобы не пропускать заказы"}</span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={handleEnablePush} className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-primary/90 active:scale-95 transition-all">
                {lang === "uz" ? "Yoqish" : "Включить"}
              </button>
              <button
                onClick={() => { setShowPushBanner(false); sessionStorage.setItem("push_banner_dismissed", "1"); }}
                className="text-muted-foreground text-xs px-2 py-1.5"
              >
                {lang === "uz" ? "Keyinroq" : "Позже"}
              </button>
            </div>
          </div>
        )}
        {!connection.online && (
          <div className="px-3 py-1.5 bg-red-600 text-white text-center shrink-0">
            <p className="text-xs font-bold">
              Нет интернета{connection.queueCount > 0 ? ` · ${connection.queueCount} действий ожидают отправки` : ""}
            </p>
          </div>
        )}
        {connection.online && connection.syncing && connection.queueCount > 0 && (
          <div className="px-3 py-1 bg-amber-500 text-white text-center shrink-0">
            <p className="text-xs font-bold flex items-center justify-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Синхронизация ({connection.queueCount})...
            </p>
          </div>
        )}
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-lg border-t border-white/[0.06]">
        <div className="flex justify-around items-center h-[68px] px-1">
          {navs.map(nav => {
            const isChat = nav.path === "/driver/chat";
            const isActive = isChat
              ? chatOpen
              : nav.path === "/driver"
              ? location === "/driver"
              : nav.path === "/driver/profile"
              ? location.startsWith("/driver/profile") || location.startsWith("/driver/earnings") || location.startsWith("/driver/wallet")
              : location.startsWith(nav.path);
            const Icon = nav.icon;

            if (isChat) {
              return (
                <button
                  key={nav.path}
                  onClick={() => setChatOpen(true)}
                  className={`flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors rounded-lg ${
                    isActive ? "text-primary" : "text-muted-foreground/70"
                  }`}
                >
                  <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                    isActive ? "bg-primary/12" : ""
                  }`}>
                    <Icon className={`w-5 h-5 ${isActive ? "drop-shadow-[0_0_6px_hsl(189,74%,48%,0.4)]" : ""}`} />
                    {nav.badge > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                        {nav.badge > 9 ? "9+" : nav.badge}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] font-semibold ${isActive ? "text-primary" : ""}`}>{nav.label}</span>
                </button>
              );
            }

            return (
              <Link
                key={nav.path}
                href={nav.path}
                onClick={() => {
                  if (nav.path === "/driver/urgent" && marketplaceUpdates > 0) {
                    clearMarketplaceBadge();
                  }
                }}
                className={`flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors rounded-lg ${
                  isActive ? "text-primary" : "text-muted-foreground/70"
                }`}
              >
                <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                  isActive ? "bg-primary/12" : ""
                }`}>
                  <Icon className={`w-5 h-5 ${isActive ? "drop-shadow-[0_0_6px_hsl(189,74%,48%,0.4)]" : ""}`} />
                  {nav.badge > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
                      {nav.badge > 9 ? "9+" : nav.badge}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-semibold ${isActive ? "text-primary" : ""}`}>{nav.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {hasPhotoRequest && photoCheckDone && token && (
        <PhotoControlModal token={token} rejectReason={photoRejectReason} onComplete={() => { setHasPhotoRequest(false); setPhotoRejectReason(null); }} />
      )}

      {user && (
        <DriverIncomingCall myUserId={user.id} myName={user.name || "Водитель"} />
      )}

      <IncomingOrderModal />

      {currentPopup && (
        <DriverNotificationPopup
          notification={currentPopup}
          onDismiss={dismissPopup}
        />
      )}

      {chatOpen && (
        <DriverChatModal
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          token={token}
          myUserId={user?.id}
          initialPeerId={chatPeer?.id}
          initialPeerName={chatPeer?.name}
          initialPeerRole={chatPeer?.role}
          rideId={rideId || undefined}
        />
      )}
    </div>
  );
}
