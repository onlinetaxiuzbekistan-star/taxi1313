import { loadPreferencesFromServer } from "@/stores/settings";
import { ReactNode, useEffect, useState, useCallback, useRef } from "react";
import { Link, useLocation, Redirect } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useSipPhone, loadSipConfig, saveSipConfig } from "@/hooks/use-sip-phone";
import { Car, Users, Map as MapIcon, LogOut, BookOpen, BarChart2, BarChart3, Phone, Wallet, MessageSquare, Building2, MapPin, Shield, ShieldCheck, Settings, Activity, Zap, Archive, Camera, Monitor, PlusCircle, Menu, X, Newspaper, Bell } from "lucide-react";
import { CallPopup, type CallEvent } from "@/components/CallPopup";
import { SipSettingsModal, loadSipFromServer } from "@/components/SoftPhone";
import UnifiedSoftphone from "@/components/UnifiedSoftphone";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export default function DispatcherLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, token, logout } = useAuth();
  const [callEvent, setCallEvent] = useState<CallEvent | null>(null);
  const [missedCalls, setMissedCalls] = useState(0);
  const [sipSettingsOpen, setSipSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingPhotoCount, setPendingPhotoCount] = useState(0);

  const sip = useSipPhone();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape" && callEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (inInput) (e.target as HTMLElement).blur();
        setCallEvent(null);
        return;
      }

      if (e.key === "*" && sip.callInfo) {
        e.preventDefault();
        e.stopPropagation();
        if (inInput) (e.target as HTMLElement).blur();
        sip.hangup();
        return;
      }

      if (inInput) return;

      if (e.code === "Space" && sip.callInfo?.state === "ringing" && sip.callInfo?.direction === "incoming") {
        e.preventDefault();
        e.stopPropagation();
        sip.answerCall();
        return;
      }

      if (e.code === "KeyM" && sip.callInfo?.state === "active") {
        e.preventDefault();
        e.stopPropagation();
        sip.toggleMute();
        return;
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [callEvent, sip.callInfo, sip.hangup, sip.answerCall, sip.toggleMute]);

  useEffect(() => {
    if (sip.callInfo?.direction === "incoming" && sip.callInfo.state === "ringing") {
      const phone = sip.callInfo.remoteNumber;
      lookupClientForPopup(phone);
    }
  }, [sip.callInfo?.direction, sip.callInfo?.state, sip.callInfo?.remoteNumber]);

  const lookupClientForPopup = async (phone: string) => {
    try {
      const normalized = phone.replace(/[^\d+]/g, "");
      const res = await fetch(`${BASE_URL}/api/calls/lookup-client?phone=${encodeURIComponent(normalized)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.client) {
          setCallEvent({ callLogId: 0, client: data.client });
          setMissedCalls(c => c + 1);
        }
      }
    } catch {}
  };

  useEffect(() => {
    if (!user || (user.role !== "dispatcher" && user.role !== "admin") || !token) return;
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === "incoming_call") {
        setCallEvent({ callLogId: msg.call?.id, client: msg.client });
        setMissedCalls(c => c + 1);
      }
      if (msg?.type === "call_offer" && msg.fromUserId) {
        const callCtx = { driverId: msg.fromUserId, driverName: msg.fromUserName || "", ts: Date.now() };
        try { sessionStorage.setItem("buxtaxi:driver-call-ctx", JSON.stringify(callCtx)); } catch {}
        window.dispatchEvent(new CustomEvent("buxtaxi:driver-calling", {
          detail: { driverId: msg.fromUserId, driverName: msg.fromUserName || "" },
        }));
        if (!location.startsWith("/management/orders")) {
          setLocation("/management/orders");
        }
      }
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, [user, token, location, setLocation]);

  useEffect(() => {
    if (!token) return;
    const fetchUnread = () => {
      fetch(`${BASE_URL}/api/chat/unread-total`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setUnreadMessages(d.total || 0); })
        .catch(() => {});
    };
    fetchUnread();
    const iv = setInterval(fetchUnread, 15000);
    return () => clearInterval(iv);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const fetchPending = () => {
      fetch(`${BASE_URL}/api/photo-control/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.stats) setPendingPhotoCount(d.stats.underReview || 0); })
        .catch(() => {});
    };
    fetchPending();
    const iv = setInterval(fetchPending, 15000);
    return () => clearInterval(iv);
  }, [token]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  const dismissCall = useCallback(() => setCallEvent(null), []);

  useEffect(() => {
    if (user && token) {
      loadPreferencesFromServer();
    }
  }, [user, token]);

  const sipInitRef = useRef(false);

  useEffect(() => {
    if (!user || !token) return;
    if (sipInitRef.current) return;
    sipInitRef.current = true;
    loadSipFromServer().then(cfg => {
      if (cfg && cfg.server && cfg.login && cfg.password) {
        saveSipConfig(cfg);
        sip.connect(cfg);
      }
    });
  }, [user, token]);

  const handleSipSaveAndConnect = useCallback((cfg: { server: string; domain: string; login: string; password: string }) => {
    sip.disconnect();
    sip.connect(cfg);
  }, [sip.connect, sip.disconnect]);

  const isIncomingRinging = (sip.callInfo?.state === "ringing" && sip.callInfo?.direction === "incoming") || (sip.waitingCalls && sip.waitingCalls.length > 0);
  if (!user) return <Redirect to="/management-login" />;

  if (user.role !== "dispatcher" && user.role !== "admin") {
    return <Redirect to="/management-login" />;
  }

  const menu = [
    { path: "/management",            icon: Car,           label: "Заказы" },
    { path: "/management/archive",    icon: Archive,       label: "Архив заказов" },
    { path: "/management/drivers",    icon: Users,         label: "Водители" },
    { path: "/management/map",        icon: MapIcon,       label: "Карта" },
    { path: "/management/chat",       icon: MessageSquare, label: "Сообщения" },
    { path: "/management/analytics",  icon: BarChart2,     label: "Аналитика" },
    { path: "/management/finances",   icon: Wallet,        label: "Финансы" },
    { path: "/management/reports",    icon: BarChart3,     label: "Отчёты" },
    { path: "/management/references", icon: BookOpen,      label: "Справочники" },
    { path: "/management/branches",   icon: Building2,     label: "Филиалы и города" },
    { path: "/management/addresses",  icon: MapPin,        label: "Адреса" },
    { path: "/management/districts",  icon: MapPin,        label: "Районы" },
    { path: "/management/staff",      icon: Shield,        label: "Сотрудники" },
    { path: "/management/roles",      icon: ShieldCheck,   label: "Роли и права" },
    { path: "/management/news",        icon: Newspaper,     label: "Новости" },
    { path: "/management/push",        icon: Bell,          label: "Пуш-уведомления" },
    { path: "/management/photo-control", icon: Camera,     label: "Фотоконтроль" },
    { path: "/management/settings",   icon: Settings,      label: "Настройки" },
    { path: "/management/stress-monitor", icon: Zap,       label: "Стресс-тест" },
    { path: "/management/system",     icon: Monitor,       label: "Мониторинг" },
    { path: "/management/activity-logs", icon: Activity,   label: "Журнал действий" },
  ];

  const sidebarContent = (
    <>
      <div className="h-[56px] flex items-center px-4 border-b border-gray-200 shrink-0 justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/logo-1313.png" alt="Такси 1313" className="w-8 h-8 rounded-lg object-cover" />
          <span className="font-extrabold text-xl tracking-tight text-gray-900">
            Такси <span className="text-emerald-500">1313</span>
          </span>
        </div>
        <button onClick={() => setSidebarOpen(false)} className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <button
          onClick={() => { window.dispatchEvent(new Event("buxtaxi:open-create-drawer")); setSidebarOpen(false); }}
          className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl text-sm transition-colors shadow-sm"
        >
          <PlusCircle className="w-4.5 h-4.5" />
          Добавить заказ
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2.5">
        {menu.map(item => {
          const isActive = item.path === "/management"
            ? (location === "/management" || location === "/management/orders")
            : location === item.path || location.startsWith(item.path + "/");
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-lg text-sm transition-colors mb-0.5 ${
                isActive
                  ? "bg-emerald-50 text-emerald-700 font-bold"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
              }`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span className="truncate leading-tight">{item.label}</span>
              {item.path === "/management/chat" && unreadMessages > 0 && (
                <span className="ml-auto bg-emerald-500 text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </span>
              )}
              {item.path === "/management/photo-control" && pendingPhotoCount > 0 && (
                <span className="ml-auto bg-amber-500 text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 animate-pulse">
                  {pendingPhotoCount > 99 ? "99+" : pendingPhotoCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {missedCalls > 0 && (
        <div className="mx-2.5 mb-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-xs text-emerald-700 font-semibold">
            {missedCalls} звонк{missedCalls === 1 ? "" : missedCalls < 5 ? "а" : "ов"}
          </span>
        </div>
      )}

      <div className="border-t border-gray-200 p-2.5 shrink-0">
        <div className="px-2.5 py-2 mb-1">
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Диспетчер</p>
          <p className="text-sm font-bold text-gray-800 truncate">{user.name}</p>
          {(user as any).login && <p className="text-xs text-gray-400 truncate">Логин: {(user as any).login}</p>}
        </div>
        <button
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors text-sm font-medium"
          onClick={logout}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Выход</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex bg-[#f7f7f5] font-sans overflow-hidden">
      <CallPopup event={callEvent} onDismiss={dismissCall} />
      {user?.role === "admin" && <SipSettingsModal isOpen={sipSettingsOpen} onClose={() => setSipSettingsOpen(false)}
        config={sip.config} onSave={handleSipSaveAndConnect} status={sip.status} />}

      <aside className="hidden md:flex w-[210px] bg-white border-r border-gray-200 flex-col shrink-0 h-screen">
        {sidebarContent}
      </aside>

      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[60] md:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-[280px] bg-white z-[70] flex flex-col md:hidden shadow-2xl animate-slide-in-left">
            {sidebarContent}
          </aside>
        </>
      )}

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className={`h-[52px] md:h-[46px] border-b flex items-center px-3 md:px-4 shrink-0 gap-3 relative z-[55] transition-colors ${isIncomingRinging ? "bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 border-amber-400 animate-header-flash" : "bg-white border-gray-200"}`}>
          <button onClick={() => setSidebarOpen(true)} aria-label="Открыть меню" className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-100 active:bg-gray-200">
            <Menu className="w-5 h-5" />
          </button>
          <span className="md:hidden font-extrabold text-[16px] tracking-tight text-gray-900">
            Такси <span className="text-amber-400">1313</span>
          </span>
          {user && token && (
            <div className="flex-1 min-w-0">
              <UnifiedSoftphone
                sipStatus={sip.status}
                sipCallInfo={sip.callInfo}
                waitingCalls={sip.waitingCalls}
                onSipAnswer={sip.answerCall}
                onSipReject={sip.rejectCall}
                onSipHangup={sip.hangup}
                onSipToggleMute={sip.toggleMute}
                onSipToggleHold={sip.toggleHold}
                onSipConnect={() => { const cfg = loadSipConfig(); if (cfg) sip.connect(cfg); else setSipSettingsOpen(true); }}
                onSipMakeCall={sip.makeCall}
                onSipSendDtmf={sip.sendDtmf}
                onSipTransfer={sip.transferCall}
                onOpenSipSettings={() => setSipSettingsOpen(true)}
                isAdmin={user?.role === "admin"}
                onCallAnswered={(phone: string) => {
                  const normalizedPhone = phone.replace(/[^\d]/g, "");
                  const phoneWithPlus = normalizedPhone.startsWith("+") ? normalizedPhone : "+" + normalizedPhone;
                  const client = { phone: phoneWithPlus };
                  sessionStorage.setItem("pendingCallClient", JSON.stringify(client));
                  window.dispatchEvent(new CustomEvent("buxtaxi:open-create-drawer", { detail: client }));
                  if (!location.startsWith("/management/orders")) {
                    setLocation("/management/orders");
                  }
                }}
              />
            </div>
          )}
        </header>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>

      <style>{`
        @keyframes slide-in-left {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes header-flash {          0%, 100% { background-color: rgb(252, 211, 77); }          50% { background-color: rgb(254, 249, 195); }        }        .animate-header-flash {          animation: header-flash 0.8s ease-in-out infinite;        }        .animate-slide-in-left {
          animation: slide-in-left 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
