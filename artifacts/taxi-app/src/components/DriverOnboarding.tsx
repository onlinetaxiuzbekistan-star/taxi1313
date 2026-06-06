import { useState, useEffect, useRef } from "react";
import { Globe, Sun, Moon, Monitor, MapPin, Bell, ChevronRight, Check, Shield, Camera, Mic } from "lucide-react";
import { useSettingsStore } from "@/stores/settings";
import type { Theme, Language } from "@/stores/settings";

type Step = "language" | "theme" | "permissions";

const LANGUAGES = [
  { code: "uz", label: "O'zbekcha", flag: "🇺🇿" },
  { code: "ru", label: "Русский", flag: "🇷🇺" },
];

const THEMES = [
  { code: "light", label: "Светлая", labelUz: "Yorug'", icon: Sun, preview: "bg-white border-zinc-200" },
  { code: "dark", label: "Тёмная", labelUz: "Qorong'u", icon: Moon, preview: "bg-zinc-900 border-zinc-700" },
  { code: "auto", label: "Системная", labelUz: "Tizim", icon: Monitor, preview: "bg-gradient-to-r from-white to-zinc-900 border-zinc-400" },
];

type PermStatus = "pending" | "granted" | "denied" | "loading";

export default function DriverOnboarding({ onComplete }: { onComplete: () => void }) {
  const { setTheme: applyTheme, setLanguage: applyLang } = useSettingsStore();
  const [step, setStep] = useState<Step>("language");
  const [lang, setLang] = useState("ru");
  const [theme, setTheme] = useState("dark");
  const [locationStatus, setLocationStatus] = useState<PermStatus>("pending");
  const [notifStatus, setNotifStatus] = useState<PermStatus>("pending");
  const [cameraStatus, setCameraStatus] = useState<PermStatus>("pending");
  const [micStatus, setMicStatus] = useState<PermStatus>("pending");
  const [locationError, setLocationError] = useState("");
  const [animateIn, setAnimateIn] = useState(true);
  const [requestingAll, setRequestingAll] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const native = (window as any).__buxtaxiNative;
    if (native?.isNativeApp?.()) {
      if (native.hasLocationPermission?.()) setLocationStatus("granted");
      if (native.hasNotificationPermission?.()) setNotifStatus("granted");
      if (native.hasCameraPermission?.()) setCameraStatus("granted");
      if (native.hasMicrophonePermission?.()) setMicStatus("granted");
    }
  }, []);

  useEffect(() => {
    setAnimateIn(true);
    const timer = setTimeout(() => setAnimateIn(false), 400);
    return () => clearTimeout(timer);
  }, [step]);

  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const handleNext = () => {
    if (step === "language") {
      applyLang(lang as Language);
      setStep("theme");
    } else if (step === "theme") {
      applyTheme(theme as Theme);
      setStep("permissions");
    }
  };

  const requestLocation = async () => {
    setLocationStatus("loading");
    setLocationError("");
    if (!window.isSecureContext) { setLocationStatus("granted"); return; }
    try {
      await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });
      if (!mountedRef.current) return;
      setLocationStatus("granted");
      localStorage.setItem("buxtaxi_location_granted", "true");
    } catch (err: any) {
      if (!mountedRef.current) return;
      setLocationStatus("denied");
      if (err?.code === 1) {
        const ua = navigator.userAgent || "";
        const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
        const isStandalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || (navigator as any).standalone === true;
        if (isIOS && isStandalone) {
          setLocationError(t(
            "Доступ к геолокации запрещён.\nОткройте: Настройки iPhone → Конфиденциальность и безопасность → Службы геолокации → Safari Веб-сайты → «При использовании», затем перезапустите приложение.",
            "Joylashuvga ruxsat berilmagan.\niPhone Sozlamalar → Maxfiylik → Joylashuv xizmatlari → Safari → «Foydalanilganda» ni tanlang va ilovani qayta oching."
          ));
        } else if (isIOS) {
          setLocationError(t(
            "Доступ к геолокации запрещён в Safari.\nОткройте: Настройки iPhone → Safari → Геолокация → «Спросить» или «Разрешить», затем обновите страницу (потяните вниз).",
            "Safari da joylashuvga ruxsat berilmagan.\niPhone Sozlamalar → Safari → Joylashuv → «Soralsin» yoki «Ruxsat berish», keyin sahifani yangilang (pastga torting)."
          ));
        } else {
          setLocationError(t(
            "Вы отказали в доступе. Разрешите в настройках браузера и обновите страницу.",
            "Ruxsat berilmadi. Brauzer sozlamalarida ruxsat bering va sahifani yangilang."
          ));
        }
      } else {
        setLocationError(t("Не удалось получить геолокацию.", "Joylashuvni aniqlab bo'lmadi."));
      }
    }
  };

  const requestNotifications = async () => {
    setNotifStatus("loading");
    try {
      const native = (window as any).__buxtaxiNative;
      if (native?.isNativeApp?.()) {
        native.requestAllPermissions();
        await new Promise(r => setTimeout(r, 1500));
        if (!mountedRef.current) return;
        const granted = native.hasNotificationPermission?.() ?? true;
        setNotifStatus(granted ? "granted" : "denied");
        return;
      }
        if (!window.isSecureContext) { setNotifStatus("granted"); return; }
      if (typeof Notification !== "undefined") {
        const perm = await Notification.requestPermission();
        if (!mountedRef.current) return;
        setNotifStatus(perm === "granted" ? "granted" : "denied");
      } else {
        setNotifStatus("granted");
      }
    } catch {
      if (!mountedRef.current) return;
      setNotifStatus("denied");
    }
  };

  const requestCamera = async () => {
    setCameraStatus("loading");
    try {
      const native = (window as any).__buxtaxiNative;
      if (native?.isNativeApp?.()) {
        native.requestAllPermissions();
        await new Promise(r => setTimeout(r, 1500));
        if (!mountedRef.current) return;
        const granted = native.hasCameraPermission?.() ?? true;
        setCameraStatus(granted ? "granted" : "denied");
        return;
      }
        if (!window.isSecureContext) { setCameraStatus("granted"); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(tr => tr.stop());
      if (!mountedRef.current) return;
      setCameraStatus("granted");
    } catch {
      if (!mountedRef.current) return;
      setCameraStatus("denied");
    }
  };

  const requestMic = async () => {
    setMicStatus("loading");
    try {
      const native = (window as any).__buxtaxiNative;
      if (native?.isNativeApp?.()) {
        native.requestAllPermissions();
        await new Promise(r => setTimeout(r, 1500));
        if (!mountedRef.current) return;
        const granted = native.hasMicrophonePermission?.() ?? true;
        setMicStatus(granted ? "granted" : "denied");
        return;
      }
        if (!window.isSecureContext) { setMicStatus("granted"); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(tr => tr.stop());
      if (!mountedRef.current) return;
      setMicStatus("granted");
    } catch {
      if (!mountedRef.current) return;
      setMicStatus("denied");
    }
  };

  const requestAll = async () => {
    if (requestingAll) return;
    setRequestingAll(true);
    if (locationStatus !== "granted") await requestLocation();
    if (notifStatus !== "granted") await requestNotifications();
    if (cameraStatus !== "granted") await requestCamera();
    if (micStatus !== "granted") await requestMic();
    if (mountedRef.current) setRequestingAll(false);
  };

  const isIOSDevice = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent || "") && !(window as any).MSStream;
  const locationFinal = locationStatus === "granted" || (isIOSDevice && (locationStatus === "denied" || locationStatus === "loading" ? false : false) ) || locationStatus === "denied" && isIOSDevice;
  const allDone = locationStatus === "granted" || (isIOSDevice && locationStatus === "denied");
  const grantedCount = [locationStatus, notifStatus, cameraStatus, micStatus].filter(s => s === "granted").length;

  const finishOnboarding = () => {
    localStorage.setItem("buxtaxi_onboarding_completed", "true");
    onComplete();
  };

  const stepIndex = ["language", "theme", "permissions"].indexOf(step);

  const permissions = [
    {
      key: "location",
      icon: MapPin,
      label: t("Геолокация", "Joylashuv"),
      desc: t("Передача координат для работы", "Ishlash uchun koordinatalar"),
      status: locationStatus,
      required: true,
      onRequest: requestLocation,
      color: "emerald",
    },
    {
      key: "notif",
      icon: Bell,
      label: t("Уведомления", "Bildirishnomalar"),
      desc: t("Новые заказы и сообщения", "Yangi buyurtmalar va xabarlar"),
      status: notifStatus,
      required: false,
      onRequest: requestNotifications,
      color: "blue",
    },
    {
      key: "camera",
      icon: Camera,
      label: t("Камера", "Kamera"),
      desc: t("Фото в чате и документы", "Chat rasmlari va hujjatlar"),
      status: cameraStatus,
      required: false,
      onRequest: requestCamera,
      color: "violet",
    },
    {
      key: "mic",
      icon: Mic,
      label: t("Микрофон", "Mikrofon"),
      desc: t("Голосовые сообщения и звонки", "Ovozli xabarlar va qo'ng'iroqlar"),
      status: micStatus,
      required: false,
      onRequest: requestMic,
      color: "amber",
    },
  ];

  const colorMap: Record<string, { bg: string; text: string; icon: string }> = {
    emerald: { bg: "bg-zinc-100", text: "text-zinc-700", icon: "bg-zinc-700" },
    blue: { bg: "bg-zinc-100", text: "text-zinc-700", icon: "bg-zinc-700" },
    violet: { bg: "bg-zinc-100", text: "text-zinc-700", icon: "bg-zinc-700" },
    amber: { bg: "bg-zinc-100", text: "text-zinc-700", icon: "bg-zinc-700" },
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col" role="dialog" aria-modal="true" aria-label={t("Настройка приложения", "Ilovani sozlash")}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
        <div className="flex gap-2 mb-8">
          {(["language", "theme", "permissions"] as Step[]).map((s, i) => (
            <div key={s} className={`h-1.5 rounded-full transition-all duration-500 ${
              s === step ? "w-10 bg-primary" : i < stepIndex ? "w-6 bg-primary/40" : "w-6 bg-muted"
            }`} />
          ))}
        </div>

        {step === "language" && (
          <div className={`w-full max-w-sm ${animateIn ? "animate-in fade-in slide-in-from-right-8 duration-500" : ""}`}>
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/5">
              <Globe className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-2xl font-extrabold text-foreground text-center mb-2">Выберите язык</h1>
            <p className="text-sm text-muted-foreground text-center mb-8">Tilni tanlang</p>

            <div className="space-y-3">
              {LANGUAGES.map((l, i) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  style={{ animationDelay: `${i * 100 + 200}ms` }}
                  className={`w-full flex items-center gap-4 p-5 rounded-2xl border-2 transition-all active:scale-[0.98] animate-in fade-in slide-in-from-bottom-4 ${
                    lang === l.code
                      ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                      : "border-border bg-card hover:border-primary/30"
                  }`}
                >
                  <span className="text-4xl">{l.flag}</span>
                  <span className="text-lg font-bold text-foreground">{l.label}</span>
                  {lang === l.code && (
                    <div className="ml-auto w-7 h-7 rounded-full bg-primary flex items-center justify-center animate-in zoom-in duration-200">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "theme" && (
          <div className={`w-full max-w-sm ${animateIn ? "animate-in fade-in slide-in-from-right-8 duration-500" : ""}`}>
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/5">
              <Sun className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-2xl font-extrabold text-foreground text-center mb-2">
              {t("Выберите тему", "Mavzuni tanlang")}
            </h1>
            <p className="text-sm text-muted-foreground text-center mb-8">
              {t("Внешний вид приложения", "Ilova ko'rinishi")}
            </p>

            <div className="space-y-3">
              {THEMES.map((th, i) => {
                const Icon = th.icon;
                const label = lang === "uz" ? th.labelUz : th.label;
                return (
                  <button
                    key={th.code}
                    onClick={() => setTheme(th.code)}
                    style={{ animationDelay: `${i * 100 + 200}ms` }}
                    className={`w-full flex items-center gap-4 p-5 rounded-2xl border-2 transition-all active:scale-[0.98] animate-in fade-in slide-in-from-bottom-4 ${
                      theme === th.code
                        ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                        : "border-border bg-card hover:border-primary/30"
                    }`}
                  >
                    <div className={`w-14 h-14 rounded-xl ${th.preview} border-2 flex items-center justify-center`}>
                      <Icon className={`w-6 h-6 ${th.code === "dark" ? "text-white" : "text-zinc-800"}`} />
                    </div>
                    <span className="text-lg font-bold text-foreground">{label}</span>
                    {theme === th.code && (
                      <div className="ml-auto w-7 h-7 rounded-full bg-primary flex items-center justify-center animate-in zoom-in duration-200">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === "permissions" && (
          <div className={`w-full max-w-sm ${animateIn ? "animate-in fade-in slide-in-from-right-8 duration-500" : ""}`}>
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/5">
              <Shield className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-2xl font-extrabold text-foreground text-center mb-2">
              {t("Разрешения", "Ruxsatlar")}
            </h1>
            <p className="text-sm text-muted-foreground text-center mb-2">
              {t("Для полноценной работы приложения", "Ilova to'liq ishlashi uchun")}
            </p>
            <p className="text-xs text-primary font-semibold text-center mb-6">
              {grantedCount}/4 {t("разрешено", "ruxsat berilgan")}
            </p>

            <button
              onClick={requestAll}
              disabled={requestingAll}
              className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold text-sm mb-5 active:scale-[0.97] transition-transform shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Shield className="w-4 h-4" />
              {t("Разрешить всё", "Hammasiga ruxsat")}
            </button>

            <div className="space-y-3">
              {permissions.map((perm, i) => {
                const Icon = perm.icon;
                const c = colorMap[perm.color];
                const isGranted = perm.status === "granted";
                const isLoading = perm.status === "loading";
                return (
                  <div
                    key={perm.key}
                    style={{ animationDelay: `${i * 80 + 100}ms` }}
                    className={`p-4 rounded-2xl border-2 transition-all animate-in fade-in slide-in-from-bottom-3 ${
                      isGranted ? "border-emerald-300 bg-emerald-500/5" :
                      perm.status === "denied" ? "border-red-300/50 bg-red-500/5" :
                      "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                        isGranted ? "bg-emerald-500" : c.icon
                      }`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-foreground">{perm.label}</p>
                          {perm.required && !isGranted && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-bold uppercase">
                              {t("обяз.", "majb.")}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{perm.desc}</p>
                      </div>
                      {isGranted ? (
                        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center animate-in zoom-in duration-200">
                          <Check className="w-5 h-5 text-white" />
                        </div>
                      ) : (
                        <button
                          onClick={perm.onRequest}
                          disabled={isLoading}
                          className={`px-4 py-2 rounded-xl text-white text-xs font-bold active:scale-95 transition-transform disabled:opacity-50 ${c.icon}`}
                        >
                          {isLoading ? "..." : t("Дать", "Berish")}
                        </button>
                      )}
                    </div>
                    {perm.key === "location" && locationError && (() => {
                      const ua = navigator.userAgent || "";
                      const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
                      return (
                        <div className="mt-2 space-y-2">
                          <p className="text-xs text-red-600 bg-red-500/10 rounded-lg px-3 py-2 whitespace-pre-line leading-relaxed">{locationError}</p>
                          <button
                            onClick={() => {
                              if (isIOSDevice) {
                                window.location.reload();
                              } else {
                                requestLocation();
                              }
                            }}
                            className="w-full text-xs font-bold py-2.5 rounded-lg bg-amber-500 text-white active:scale-95 transition-transform"
                          >
                            {isIOSDevice
                              ? t("Я разрешил — перезагрузить страницу", "Ruxsat berdim — sahifani qayta yuklash")
                              : t("Я разрешил — проверить ещё раз", "Ruxsat berdim — qayta tekshirish")}
                          </button>
                          {isIOSDevice && (
                            <details className="text-[11px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                              <summary className="font-bold cursor-pointer">
                                {t("Если не помогло — очистить данные сайта", "Yordam bermasa — sayt ma'lumotlarini tozalash")}
                              </summary>
                              <p className="mt-2 leading-relaxed whitespace-pre-line">
                                {t(
                                  "1. Откройте: Настройки iPhone → Safari → Дополнения → Данные веб-сайтов\n2. Найдите «nil.taxi1313.ru» и смахните влево → Удалить\n3. Вернитесь в браузер и снова откройте сайт — Safari заново спросит разрешение",
                                  "1. iPhone Sozlamalar → Safari → Qoshimcha → Veb-sayt ma'lumotlari\n2. «nil.taxi1313.ru» ni toping va chapga suring → Ochirish\n3. Brauzerga qaytib, saytni qayta oching — Safari yana ruxsat soraydi"
                                )}
                              </p>
                              <button
                                onClick={async () => {
                                  try {
                                    if ("serviceWorker" in navigator) {
                                      const regs = await navigator.serviceWorker.getRegistrations();
                                      await Promise.all(regs.map(r => r.unregister()));
                                    }
                                    const keys = await caches.keys();
                                    await Promise.all(keys.map(k => caches.delete(k)));
                                  } catch {}
                                  window.location.reload();
                                }}
                                className="mt-2 w-full text-[11px] font-bold py-2 rounded-lg bg-zinc-700 text-white active:scale-95 transition-transform"
                              >
                                {t("Очистить кэш и перезагрузить", "Keshni tozalash va qayta yuklash")}
                              </button>
                            </details>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="px-6 pb-8 pt-4">
        {step === "permissions" ? (
          <button
            onClick={finishOnboarding}
            disabled={!allDone}
            className={`w-full py-4 rounded-2xl font-extrabold text-lg transition-all active:scale-[0.97] flex items-center justify-center gap-2 ${
              allDone
                ? "bg-primary text-white shadow-lg shadow-primary/30"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
          >
            {allDone
              ? (isIOSDevice && locationStatus !== "granted"
                  ? t("Продолжить без GPS", "GPS siz davom etish")
                  : t("Начать работу", "Ishlashni boshlash"))
              : t("Разрешите геолокацию", "Joylashuvga ruxsat bering")}
            {allDone && <ChevronRight className="w-5 h-5" />}
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="w-full py-4 rounded-2xl bg-primary text-white font-extrabold text-lg shadow-lg shadow-primary/30 active:scale-[0.97] transition-transform flex items-center justify-center gap-2"
          >
            {t("Далее", "Keyingi")}
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
