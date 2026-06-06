import { Component, ReactNode, lazy, Suspense, useEffect } from "react";

import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useWebSocket } from "@/hooks/use-websocket";
import { useSettingsStore, forceTheme } from "@/stores/settings";

interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: string;
  stack: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: "", stack: "" };

  static getDerivedStateFromError(error: Error) {
    const debugStack = (window as any).__DEBUG_COMPONENT_STACK__?.slice(-30)?.join(" > ") || "";
    const trace = String(error?.stack || "") + " COMPONENT_TRACE: " + debugStack;
    return { hasError: true, error: error?.message || "Неизвестная ошибка", stack: trace };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("[ErrorBoundary]", error);
    console.error("[ErrorBoundary] componentStack:", errorInfo?.componentStack);
    console.error("[ErrorBoundary] DEBUG_STACK:", (window as any).__DEBUG_COMPONENT_STACK__?.slice(-30));
    this.props.onError?.();

    // Auto-recover from stale-chunk errors after a new deploy:
    // when the bundle on the server has new hashed filenames and the page is still
    // running an older bundle, dynamic imports 404. Clear caches and reload once.
    const msg = String(error?.message || "");
    const isChunkError =
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /Loading chunk \d+ failed/i.test(msg) ||
      /Importing a module script failed/i.test(msg) ||
      /ChunkLoadError/i.test(msg);
    if (isChunkError) {
      const KEY = "buxtaxi_chunk_reload_at";
      const last = Number(sessionStorage.getItem(KEY) || "0");
      // only auto-recover once per minute to avoid reload loops
      if (Date.now() - last > 60_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        console.warn("[ErrorBoundary] stale chunk detected — auto clearing caches and reloading");
        this.handleClearReload();
      }
    }
  }

  handleClearReload = async () => {
    try { localStorage.removeItem("buxtaxi_offline_queue"); } catch {}
    try { localStorage.removeItem("buxtaxi_offline_applied"); } catch {}
    const cacheKeys = Object.keys(localStorage).filter(k => k.startsWith("buxtaxi_cache_"));
    cacheKeys.forEach(k => { try { localStorage.removeItem(k); } catch {} });
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {}
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}
    window.location.reload();
  };

  handleSimpleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ background: "#09090b", color: "#fff", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "Inter, sans-serif" }}>
          <div style={{ textAlign: "center", maxWidth: 320 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠</div>
            <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>Ошибка приложения</h2>
            <p style={{ color: "#71717a", fontSize: 13, margin: "0 0 12px", wordBreak: "break-word" }}>{this.state.error}</p>
            <pre style={{ color: "#71717a", fontSize: 10, margin: "0 0 24px", wordBreak: "break-word", whiteSpace: "pre-wrap", textAlign: "left", maxHeight: 200, overflow: "auto", background: "#18181b", padding: 8, borderRadius: 8 }}>{this.state.stack}</pre>
            <button onClick={this.handleSimpleReload} style={{ background: "#F59E0B", border: "none", color: "#09090b", padding: "14px 40px", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: "pointer", width: "100%", marginBottom: 12 }}>
              Перезагрузить
            </button>
            <button onClick={this.handleClearReload} style={{ background: "transparent", border: "1px solid #3f3f46", color: "#a1a1aa", padding: "12px 24px", borderRadius: 12, fontSize: 14, fontWeight: 500, cursor: "pointer", width: "100%" }}>
              Очистить кэш и перезагрузить
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}


function DriverGuard({ children }: { children: any }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) {
    try { localStorage.removeItem("authToken"); } catch {}
    window.location.replace("/driver-login");
    return null;
  }
  if (user.role !== "driver") {
    try { localStorage.removeItem("authToken"); } catch {}
    window.location.replace("/driver-login");
    return null;
  }
  return children;
}

import NotFound from "@/pages/not-found";
import Home from "@/pages/passenger/Home";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import DispatcherLogin from "@/pages/auth/DispatcherLogin";

import DriverLogin from "@/pages/auth/DriverLogin";

const Orders = lazy(() => import("@/pages/driver/orders"));
const UrgentOrders = lazy(() => import("@/pages/driver/UrgentOrders"));
const Earnings = lazy(() => import("@/pages/driver/Earnings"));
const Wallet = lazy(() => import("@/pages/driver/Wallet"));
const DriverProfile = lazy(() => import("@/pages/driver/Profile"));
const Marketplace = lazy(() => import("@/pages/driver/Marketplace"));
const IncomingRide = lazy(() => import("@/pages/driver/IncomingRide"));
const DriverGroupChats = lazy(() => import("@/pages/driver/DriverGroupChats"));
const DriverNews = lazy(() => import("@/pages/driver/DriverNews"));

const Overview = lazy(() => import("@/pages/dispatcher/Overview"));
const DispatcherOrders = lazy(() => import("@/pages/dispatcher/Orders"));
const Drivers = lazy(() => import("@/pages/dispatcher/Drivers"));
const DispatcherMap = lazy(() => import("@/pages/dispatcher/Map"));
const References = lazy(() => import("@/pages/dispatcher/References"));
const Analytics = lazy(() => import("@/pages/dispatcher/Analytics"));
const Finances = lazy(() => import("@/pages/dispatcher/Finances"));
const Staff = lazy(() => import("@/pages/dispatcher/Staff"));
const SettingsPage = lazy(() => import("@/pages/dispatcher/Settings"));
const DispatchSettings = lazy(() => import("@/pages/dispatcher/settings/DispatchSettings"));
const RoutingSettings = lazy(() => import("@/pages/dispatcher/settings/RoutingSettings"));
const OptionsSettings = lazy(() => import("@/pages/dispatcher/settings/OptionsSettings"));
const PricingSettings = lazy(() => import("@/pages/dispatcher/settings/PricingSettings"));
const FinanceSettings = lazy(() => import("@/pages/dispatcher/settings/FinanceSettings"));
const DriversSettings = lazy(() => import("@/pages/dispatcher/settings/DriversSettings"));
const MarketSettings = lazy(() => import("@/pages/dispatcher/settings/MarketSettings"));
const ApkSettings = lazy(() => import("@/pages/dispatcher/settings/ApkSettings"));
const PaymentSettings = lazy(() => import("@/pages/dispatcher/settings/PaymentSettings"));
const SmsSettings = lazy(() => import("@/pages/dispatcher/settings/SmsSettings"));
const NotificationSettings = lazy(() => import("@/pages/dispatcher/settings/NotificationSettings"));
const BlockedAppsSettings = lazy(() => import("@/pages/dispatcher/settings/BlockedAppsSettings"));
const AudioSettings = lazy(() => import("@/pages/dispatcher/settings/AudioSettings"));
const Chat = lazy(() => import("@/pages/dispatcher/Chat"));
const Branches = lazy(() => import("@/pages/dispatcher/Branches"));
const Addresses = lazy(() => import("@/pages/dispatcher/Addresses"));
const ActivityLogs = lazy(() => import("@/pages/dispatcher/ActivityLogs"));
const PhotoControl = lazy(() => import("@/pages/dispatcher/PhotoControl"));
const Districts = lazy(() => import("@/pages/dispatcher/Districts"));
const StressMonitor = lazy(() => import("@/pages/dispatcher/StressMonitor"));
const Archive = lazy(() => import("@/pages/dispatcher/Archive"));
const Roles = lazy(() => import("@/pages/dispatcher/Roles"));
const SystemMonitor = lazy(() => import("@/pages/dispatcher/SystemMonitor"));
const DispatcherNews = lazy(() => import("@/pages/dispatcher/News"));
const PushNotifications = lazy(() => import("@/pages/dispatcher/PushNotifications"));
const Reports = lazy(() => import("@/pages/dispatcher/Reports"));
const GroupChats = lazy(() => import("@/pages/dispatcher/GroupChats"));
import { NewsModal } from "@/components/NewsModal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
      networkMode: "offlineFirst",
    },
  },
});

function DispatcherFallback() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#fff" }}>
      <div style={{ textAlign: "center", color: "#71717a", fontFamily: "Inter, sans-serif" }}>
        <div style={{ fontSize: 14 }}>Загрузка...</div>
      </div>
    </div>
  );
}

function GlobalListeners({ children }: { children: React.ReactNode }) {
  useWebSocket();
  return <>{children}</>;
}

function RouteThemeEnforcer() {
  const [location] = useLocation();
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    if (location.startsWith("/management")) {
      forceTheme("light");
    } else {
      const effective = theme === "auto"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      forceTheme(effective);
    }
  }, [location, theme]);

  return null;
}

function LazyRoute({ path, Comp }: { path: string; Comp: React.LazyExoticComponent<any> }) {
  return (
    <Route path={path}>
      {() => (
        <Suspense fallback={<DispatcherFallback />}>
          <Comp />
        </Suspense>
      )}
    </Route>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/">{() => { window.location.replace("/management-login"); return null; }}</Route>
      <Route path="/login">{() => { window.location.replace("/management-login"); return null; }}</Route>
      <Route path="/register">{() => { window.location.replace("/management-login"); return null; }}</Route>
      <Route path="/management-login" component={DispatcherLogin} />
      
      <Route path="/driver-login" component={DriverLogin} />
      <Route path="/driver">{() => (<DriverGuard><Suspense fallback={null}><Orders/></Suspense></DriverGuard>)}</Route>
      <LazyRoute path="/driver/urgent" Comp={UrgentOrders} />
      <LazyRoute path="/driver/earnings" Comp={Earnings} />
      <LazyRoute path="/driver/wallet" Comp={Wallet} />
      <LazyRoute path="/driver/profile" Comp={DriverProfile} />
      <LazyRoute path="/driver/marketplace" Comp={Marketplace} />
      <LazyRoute path="/driver/incoming" Comp={IncomingRide} />
      <LazyRoute path="/driver/news" Comp={DriverNews} />
      <LazyRoute path="/driver/group-chats" Comp={DriverGroupChats} />
      
      <LazyRoute path="/management" Comp={DispatcherOrders} />
      <LazyRoute path="/management/orders" Comp={DispatcherOrders} />
      <LazyRoute path="/management/create" Comp={Overview} />
      <LazyRoute path="/management/drivers" Comp={Drivers} />
      <LazyRoute path="/management/map" Comp={DispatcherMap} />
      <LazyRoute path="/management/analytics" Comp={Analytics} />
      <LazyRoute path="/management/finances" Comp={Finances} />
      <LazyRoute path="/management/references" Comp={References} />
      <LazyRoute path="/management/staff" Comp={Staff} />
      <LazyRoute path="/management/roles" Comp={Roles} />
      <LazyRoute path="/management/settings/dispatch" Comp={DispatchSettings} />
      <LazyRoute path="/management/settings/routing" Comp={RoutingSettings} />
      <LazyRoute path="/management/settings/options" Comp={OptionsSettings} />
      <LazyRoute path="/management/settings/pricing" Comp={PricingSettings} />
      <LazyRoute path="/management/settings/finance" Comp={FinanceSettings} />
      <LazyRoute path="/management/settings/drivers" Comp={DriversSettings} />
      <LazyRoute path="/management/settings/market" Comp={MarketSettings} />
      <LazyRoute path="/management/settings/payments" Comp={PaymentSettings} />
      <LazyRoute path="/management/settings/sms" Comp={SmsSettings} />
      <LazyRoute path="/management/settings/audio" Comp={AudioSettings} />
      <LazyRoute path="/management/settings/notifications" Comp={NotificationSettings} />
      <LazyRoute path="/management/settings/apk" Comp={ApkSettings} />
      <LazyRoute path="/management/settings/blocked-apps" Comp={BlockedAppsSettings} />
      <LazyRoute path="/management/settings" Comp={SettingsPage} />
      <LazyRoute path="/management/chat" Comp={Chat} />
      <LazyRoute path="/management/branches" Comp={Branches} />
      <LazyRoute path="/management/addresses" Comp={Addresses} />
      <LazyRoute path="/management/districts" Comp={Districts} />
      <LazyRoute path="/management/archive" Comp={Archive} />
      <LazyRoute path="/management/stress-monitor" Comp={StressMonitor} />
      <LazyRoute path="/management/activity-logs" Comp={ActivityLogs} />
      <LazyRoute path="/management/photo-control" Comp={PhotoControl} />
      <LazyRoute path="/management/news" Comp={DispatcherNews} />
      <LazyRoute path="/management/push" Comp={PushNotifications} />
      <LazyRoute path="/management/group-chats" Comp={GroupChats} />
      <LazyRoute path="/management/system" Comp={SystemMonitor} />
      <LazyRoute path="/management/reports" Comp={Reports} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function ReadyNotifier({ onReady }: { onReady?: () => void }) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);
  return null;
}

function App({ onReady }: { onReady?: () => void }) {
  return (
    <ErrorBoundary onError={onReady}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <GlobalListeners>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <ReadyNotifier onReady={onReady} />
                <RouteThemeEnforcer />
                <Router />
                <NewsModal />
              </WouterRouter>
              <Toaster />
              <SonnerToaster position="top-right" richColors />
              <UpdateBanner />
            </GlobalListeners>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
