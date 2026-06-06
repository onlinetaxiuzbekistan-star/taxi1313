import { useState, useEffect, useCallback, useRef } from "react";
import { MapPin, AlertTriangle, RefreshCw, LogOut, Settings, CheckCircle, ChevronDown, ChevronUp, ExternalLink, Smartphone } from "lucide-react";
import { useSettingsStore } from "@/stores/settings";

const STORAGE_KEY = "buxtaxi_location_granted";
const GRANT_TTL = 24 * 60 * 60 * 1000;
const AUTO_SKIP_AFTER = 2;

export default function LocationGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "granted" | "denied" | "unavailable" | "timeout">("checking");
  const [retrying, setRetrying] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const grantedRef = useRef(false);

  const lang = useSettingsStore((s) => s.language);
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const markGranted = useCallback(() => {
    grantedRef.current = true;
    setStatus("granted");
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {}
  }, []);

  const checkLocation = useCallback(() => {
    if (!navigator.geolocation) { setStatus("unavailable"); return; }
    setRetrying(true);
    setAttempts(prev => prev + 1);
    navigator.geolocation.getCurrentPosition(
      () => { markGranted(); setRetrying(false); },
      (err) => {
        console.log("[LocationGate] error code:", err.code, "message:", err.message);
        if (grantedRef.current) { setRetrying(false); return; }
        if (err.code === 1) setStatus("denied");
        else if (err.code === 3) setStatus("timeout");
        else setStatus("unavailable");
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        setRetrying(false);
      },
      { timeout: 10000, enableHighAccuracy: false, maximumAge: 120000 }
    );
  }, [markGranted]);

  useEffect(() => {
    if (!window.isSecureContext) { markGranted(); return; }
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isStandalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || (navigator as any).standalone === true;
    if (isIOS && isStandalone) {
      // iOS PWA silently denies geolocation when requested without user gesture.
      // Mark granted so app proceeds; real GPS calls happen on user click.
      markGranted();
      return;
    }
    try {
      const prev = localStorage.getItem(STORAGE_KEY);
      if (prev) {
        const elapsed = Date.now() - Number(prev);
        if (elapsed < GRANT_TTL) {
          grantedRef.current = true;
          setStatus("granted");
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {}

    if (grantedRef.current) {
      navigator.geolocation?.getCurrentPosition(
        () => { try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {} },
        (err) => {
          if (err.code === 1) {
            grantedRef.current = false;
            setStatus("denied");
            try { localStorage.removeItem(STORAGE_KEY); } catch {}
          }
        },
        { timeout: 8000, enableHighAccuracy: false, maximumAge: 120000 }
      );
      return;
    }

    let permRef: PermissionStatus | null = null;

    const handleChange = () => {
      if (!permRef) return;
      if (permRef.state === "granted") markGranted();
      else if (permRef.state === "denied" && !grantedRef.current) {
        setStatus("denied");
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
      } else { checkLocation(); }
    };

    if (navigator.permissions) {
      navigator.permissions.query({ name: "geolocation" }).then((perm) => {
        permRef = perm;
        if (perm.state === "granted") { markGranted(); }
        else { checkLocation(); }
        perm.addEventListener("change", handleChange);
      }).catch(() => { checkLocation(); });
    } else {
      checkLocation();
    }

    return () => { if (permRef) permRef.removeEventListener("change", handleChange); };
  }, [checkLocation, markGranted]);

  const handleSkip = () => markGranted();

  const handleExit = () => { window.location.href = "/"; };

  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const shouldHighlightSkip = attempts >= AUTO_SKIP_AFTER;

  if (status === "checking") {
    return (
      <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 animate-pulse">
          <MapPin className="w-8 h-8 text-primary" />
        </div>
        <p className="text-base font-bold text-foreground">
          {t("Проверка геолокации...", "Joylashuv tekshirilmoqda...")}
        </p>
      </div>
    );
  }

  if (status === "granted") return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center px-6 text-center overflow-y-auto py-8">
      <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6 shrink-0">
        <AlertTriangle className="w-10 h-10 text-red-500" />
      </div>

      <h1 className="text-2xl font-extrabold text-foreground mb-3">
        {t("Нужен доступ к геолокации", "Joylashuvga ruxsat kerak")}
      </h1>

      <p className="text-sm text-muted-foreground mb-4 max-w-xs">
        {status === "denied"
          ? t("Доступ к геолокации заблокирован. Выполните шаги ниже:", "Joylashuvga ruxsat berilmagan. Quyidagi qadamlarni bajaring:")
          : status === "timeout"
          ? t("Не удалось определить местоположение. Проверьте GPS и попробуйте снова.", "Joylashuvni aniqlab bo\u2019lmadi. GPS ni tekshiring va qayta urinib ko\u2019ring.")
          : t("Для работы приложения водителю необходимо разрешить доступ к геолокации.", "Haydovchi ilovasi ishlashi uchun joylashuvga ruxsat kerak.")}
      </p>

      {shouldHighlightSkip && (
        <div className="w-full max-w-xs bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-4">
          <p className="text-sm font-bold text-amber-600 mb-1">
            {t("GPS не доступен после " + attempts + " попыток", attempts + " urinishdan keyin GPS mavjud emas")}
          </p>
          <p className="text-xs text-amber-600/80">
            {t("Рекомендуем продолжить без GPS или разблокировать геолокацию в настройках Chrome (см. ниже).",
               "GPSsiz davom etishni yoki Chrome sozlamalarida joylashuvni yoqishni tavsiya qilamiz (pastga qarang).")}
          </p>
        </div>
      )}

      {status === "denied" && (
        <div className="w-full max-w-xs bg-muted/50 rounded-2xl p-4 mb-4 text-left space-y-3">
          <p className="text-xs font-bold text-primary uppercase tracking-wide mb-1">
            {t("Шаг 1: Настройки телефона", "1-qadam: Telefon sozlamalari")}
          </p>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Smartphone className="w-3.5 h-3.5 text-primary" />
            </div>
            <p className="text-sm text-foreground">
              {t("Настройки \u2192 Приложения \u2192 Chrome \u2192 Разрешения \u2192 Местоположение \u2192 \u00abРазрешить\u00bb",
                 "Sozlamalar \u2192 Ilovalar \u2192 Chrome \u2192 Ruxsatlar \u2192 Joylashuv \u2192 \u00abRuxsat berish\u00bb")}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <MapPin className="w-3.5 h-3.5 text-primary" />
            </div>
            <p className="text-sm text-foreground">
              {t("Включите GPS в шторке уведомлений",
                 "GPS ni bildirishnomalar panelida yoqing")}
            </p>
          </div>

          <div className="border-t border-border/50 pt-3 mt-3">
            <p className="text-xs font-bold text-primary uppercase tracking-wide mb-2">
              {t("Шаг 2: Настройки сайта в Chrome", "2-qadam: Chrome sayt sozlamalari")}
            </p>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <ExternalLink className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="text-sm text-foreground">
                <p>{t("В Chrome нажмите на замок (или \u24d8) слева от адресной строки",
                      "Chrome da manzil satrining chap tomonidagi qulf (yoki \u24d8) belgisini bosing")}</p>
                <p className="mt-1">{t("\u2192 Разрешения \u2192 Геолокация \u2192 \u00abРазрешить\u00bb",
                                       "\u2192 Ruxsatlar \u2192 Joylashuv \u2192 \u00abRuxsat berish\u00bb")}</p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 pt-1">
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <p className="text-sm text-foreground">
              {t("Нажмите \u00abПовторить\u00bb ниже", "Pastdagi \u00abQayta urinish\u00bb tugmasini bosing")}
            </p>
          </div>
        </div>
      )}

      {status === "denied" && (
        <div className="w-full max-w-xs mb-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            {showAdvanced
              ? <ChevronUp className="w-3.5 h-3.5" />
              : <ChevronDown className="w-3.5 h-3.5" />}
            {t("Расширенная инструкция", "Kengaytirilgan ko\u2019rsatma")}
          </button>

          {showAdvanced && (
            <div className="bg-muted/30 border border-border/50 rounded-xl p-4 text-left space-y-3 mt-1">
              <p className="text-xs font-semibold text-foreground">
                {t("Если ничего не помогает:", "Agar hech narsa yordam bermasa:")}
              </p>

              <div className="space-y-2 text-xs text-muted-foreground">
                <p>
                  <span className="font-bold text-foreground">Chrome:</span>{" "}
                  {t("Настройки \u2192 Настройки сайтов \u2192 Геолокация \u2192 найдите \u00ab" + hostname + "\u00bb \u2192 Разрешить",
                     "Sozlamalar \u2192 Sayt sozlamalari \u2192 Joylashuv \u2192 \u00ab" + hostname + "\u00bb ni toping \u2192 Ruxsat bering")}
                </p>

                <p>
                  <span className="font-bold text-foreground">Samsung Internet:</span>{" "}
                  {t("Настройки \u2192 Сайты и загрузки \u2192 Разрешения сайтов \u2192 Местоположение",
                     "Sozlamalar \u2192 Saytlar va yuklanmalar \u2192 Sayt ruxsatlari \u2192 Joylashuv")}
                </p>

                <p>
                  <span className="font-bold text-foreground">Xiaomi / Huawei:</span>{" "}
                  {t("Настройки телефона \u2192 Приложения \u2192 Chrome \u2192 Разрешения \u2192 Местоположение \u2192 \u00abРазрешить всегда\u00bb",
                     "Telefon sozlamalari \u2192 Ilovalar \u2192 Chrome \u2192 Ruxsatlar \u2192 Joylashuv \u2192 \u00abHar doim ruxsat\u00bb")}
                </p>
              </div>

              <div className="border-t border-border/30 pt-3">
                <p className="text-xs text-muted-foreground">
                  {t("Можно также очистить данные сайта: в Chrome нажмите \u24d8 рядом с адресом \u2192 \u00abНастройки сайта\u00bb \u2192 \u00abОчистить данные\u00bb \u2192 перезагрузите страницу.",
                     "Sayt ma\u2019lumotlarini tozalash ham mumkin: Chrome da manzil yonidagi \u24d8 ni bosing \u2192 \u00abSayt sozlamalari\u00bb \u2192 \u00abMa\u2019lumotlarni tozalash\u00bb \u2192 sahifani qayta yuklang.")}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="w-full max-w-xs space-y-3">
        <button onClick={checkLocation} disabled={retrying}
          className="w-full py-4 rounded-2xl bg-primary text-white font-extrabold text-base shadow-lg shadow-primary/30 active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2">
          {retrying ? <RefreshCw className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
          {t("Повторить", "Qayta urinish")}
        </button>

        <button onClick={handleSkip}
          className={[
            "w-full rounded-2xl font-bold active:scale-[0.97] transition-transform flex items-center justify-center gap-2 border",
            shouldHighlightSkip
              ? "py-4 text-base font-extrabold bg-amber-500 text-white border-amber-600 shadow-lg shadow-amber-500/30 animate-pulse"
              : "py-3.5 text-sm bg-amber-500/15 text-amber-600 border-amber-500/30"
          ].join(" ")}>
          <Settings className="w-4 h-4" />
          {t("Продолжить без GPS", "GPSsiz davom etish")}
        </button>

        <button onClick={handleExit}
          className="w-full py-3.5 rounded-2xl bg-muted text-muted-foreground font-bold text-sm active:scale-[0.97] transition-transform flex items-center justify-center gap-2">
          <LogOut className="w-4 h-4" />
          {t("Выйти", "Chiqish")}
        </button>
      </div>
    </div>
  );
}
