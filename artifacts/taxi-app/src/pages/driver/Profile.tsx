import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import DriverLayout from "./DriverLayout";
import { useAuth } from "@/hooks/use-auth";
import {
  User, Star, Activity, CheckCircle, TrendingUp,
  Car, Phone, LogOut, ChevronRight, Calendar, Camera,
  Globe, Moon, Sun, Monitor, Volume2, VolumeX, Type,
  Luggage, Baby, Package, Shield, Settings, ArrowLeft,
  Wallet, Bell, MapPin, Copy, Check, Plus, Minus, Upload, Image,
  Pencil, Newspaper, GraduationCap,
  ThumbsUp, ThumbsDown, Clock, XCircle, AlertTriangle, Ban, Loader2, ArrowRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSettingsStore } from "@/stores/settings";
import { previewSound, SOUND_PRESET_LABELS, type SoundPreset } from "@/hooks/use-notification-sound";
import DriverTutorial from "@/components/DriverTutorial";
import CameraCapture from "@/components/CameraCapture";
import PhotoEditTrigger from "@/components/PhotoEditTrigger";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const CITY_PREFIX: Record<string, string> = {
  "Ташкент": "TAS", "Самарканд": "SAM", "Бухара": "BUX", "Фергана": "FER",
  "Андижан": "AND", "Наманган": "NAM", "Нукус": "NUK", "Карши": "KAR",
  "Навои": "NAV", "Термез": "TER", "Гулистан": "GUL", "Джиззак": "JIZ", "Ургенч": "URG",
};

const T: Record<string, Record<string, string>> = {
  trips: { ru: "Поездок", uz: "Safar" },
  rating: { ru: "Рейтинг", uz: "Reyting" },
  activity: { ru: "Активность", uz: "Faollik" },
  acceptance: { ru: "Принятие", uz: "Qabul" },
  online: { ru: "На линии", uz: "Onlayn" },
  busy: { ru: "В рейсе", uz: "Reysda" },
  offline: { ru: "Офлайн", uz: "Oflayn" },
  myTrips: { ru: "Мои рейсы", uz: "Reyslarim" },
  wallet: { ru: "Кошелёк", uz: "Hamyon" },
  sum: { ru: "сум", uz: "so'm" },
  driverData: { ru: "Данные водителя", uz: "Haydovchi ma'lumotlari" },
  car: { ru: "Автомобиль", uz: "Avtomobil" },
  settings: { ru: "Настройки", uz: "Sozlamalar" },
  extras: { ru: "Дополнительно", uz: "Qo'shimcha" },
  refCode: { ru: "Реферальный код", uz: "Referal kod" },
  regDate: { ru: "Регистрация", uz: "Ro'yxatdan o'tish" },
  news: { ru: "Новости", uz: "Yangiliklar" },
  logout: { ru: "Выйти из аккаунта", uz: "Chiqish" },
  back: { ru: "Назад", uz: "Orqaga" },
  name: { ru: "Имя", uz: "Ism" },
  phone_label: { ru: "Телефон", uz: "Telefon" },
  phoneBound: { ru: "Номер привязан к аккаунту", uz: "Raqam akkauntga bog'langan" },
  save: { ru: "Сохранить", uz: "Saqlash" },
  saving: { ru: "Сохраняю...", uz: "Saqlanmoqda..." },
  profileSaved: { ru: "Профиль сохранён", uz: "Profil saqlandi" },
  carSaved: { ru: "Данные автомобиля сохранены", uz: "Avtomobil ma'lumotlari saqlandi" },
  saveError: { ru: "Ошибка сохранения", uz: "Saqlashda xatolik" },
  netError: { ru: "Ошибка сети", uz: "Tarmoq xatosi" },
  brand: { ru: "Марка", uz: "Marka" },
  model: { ru: "Модель", uz: "Model" },
  color: { ru: "Цвет", uz: "Rang" },
  plate: { ru: "Госномер", uz: "Davlat raqami" },
  language: { ru: "Язык", uz: "Til" },
  theme: { ru: "Тема", uz: "Mavzu" },
  lightTheme: { ru: "Светлая", uz: "Ochiq" },
  darkTheme: { ru: "Тёмная", uz: "Qorong'i" },
  autoTheme: { ru: "Авто", uz: "Avto" },
  sounds: { ru: "Звуки", uz: "Ovozlar" },
  vibration: { ru: "Вибрация", uz: "Tebranish" },
  fontSizeLabel: { ru: "Размер шрифта", uz: "Shrift o'lchami" },
  small: { ru: "Мелкий", uz: "Kichik" },
  normal: { ru: "Обычный", uz: "Oddiy" },
  large: { ru: "Крупный", uz: "Katta" },
  roofBaggage: { ru: "Багаж на крыше", uz: "Tomda yuk" },
  roofBaggageDesc: { ru: "Принимать крупный багаж", uz: "Katta yuk qabul qilish" },
  childSeat: { ru: "Детское кресло", uz: "Bolalar o'rindig'i" },
  childSeatDesc: { ru: "Есть детское кресло", uz: "Bolalar o'rindig'i bor" },
  parcels: { ru: "Приём посылок", uz: "Posilka qabul qilish" },
  parcelsDesc: { ru: "Принимать посылки без пассажира", uz: "Yo'lovchisiz posilka qabul qilish" },
  driverPhoto: { ru: "Фото водителя", uz: "Haydovchi surati" },
  carPhoto: { ru: "Фото автомобиля", uz: "Avtomobil surati" },
  changePhoto: { ru: "Изменить фото", uz: "Suratni o'zgartirish" },
  uploading: { ru: "Загрузка...", uz: "Yuklanmoqda..." },
  photoUploaded: { ru: "Фото обновлено", uz: "Surat yangilandi" },
  photoError: { ru: "Ошибка загрузки фото", uz: "Surat yuklashda xatolik" },
  tutorial: { ru: "Обучение", uz: "O'rganish" },
  tutorialDesc: { ru: "Как пользоваться приложением", uz: "Ilovadan qanday foydalanish" },
};

function t(key: string, lang: string): string {
  return T[key]?.[lang] || T[key]?.ru || key;
}

function getCallsign(user: any): string {
  const pfx = user?.city ? (CITY_PREFIX[user.city] || "BT") : "BT";
  return `${pfx}-${String(user?.id || 0).padStart(3, "0")}`;
}

function getPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${BASE_URL}/${path.startsWith("/") ? path.slice(1) : path}`;
}

function fmt(n: number) {
  return Math.round(n).toLocaleString("ru-RU");
}

function LicensePlate({ plate }: { plate: string }) {
  if (!plate) return null;
  const match = plate.match(/^(\d{2})\s*([A-Z])\s*(\d{3})\s*([A-Z]{2,3})$/i);
  const region = match ? match[1] : plate.slice(0, 2);
  const letter1 = match ? match[2].toUpperCase() : "";
  const digits = match ? match[3] : "";
  const letters2 = match ? match[4].toUpperCase() : "";

  if (!match) {
    return (
      <div className="inline-flex items-center bg-white border-2 border-zinc-800 rounded-lg px-4 py-2">
        <span className="text-lg font-bold text-zinc-900 tracking-widest font-mono">{plate}</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center bg-white border-[3px] border-zinc-800 rounded-lg overflow-hidden h-11 shadow-md">
      <div className="bg-zinc-800 text-white px-2 h-full flex items-center justify-center min-w-[36px]">
        <span className="text-sm font-bold font-mono">{region}</span>
      </div>
      <div className="flex items-center px-3 gap-1">
        <span className="text-2xl font-extrabold text-zinc-900 font-mono tracking-wide">{letter1}</span>
        <span className="text-2xl font-extrabold text-zinc-900 font-mono tracking-wider">{digits}</span>
        <span className="text-2xl font-extrabold text-zinc-900 font-mono tracking-wide">{letters2}</span>
      </div>
      <div className="bg-zinc-700 text-white px-2 h-full flex flex-col items-center justify-center min-w-[36px]">
        <span className="text-[8px] font-bold leading-none">UZ</span>
        <div className="w-3 h-2 mt-0.5 rounded-[1px] overflow-hidden flex flex-col">
          <div className="flex-1 bg-blue-400" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-green-500" />
        </div>
      </div>
    </div>
  );
}

type ProfileSection = "main" | "driver-info" | "car-info" | "settings" | "options" | "rating-detail" | "activity-detail";

const PRESET_KEYS: SoundPreset[] = ["default", "urgent", "bell", "chime", "horn", "digital"];

function SoundPresetPicker() {
  const { sound, setSound } = useSettingsStore();
  const current = (sound in SOUND_PRESET_LABELS ? sound : "default") as SoundPreset;

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {PRESET_KEYS.map((key) => (
        <button
          key={key}
          onClick={() => {
            setSound(key);
            previewSound(key);
          }}
          className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
            current === key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          }`}
        >
          {SOUND_PRESET_LABELS[key]}
        </button>
      ))}
    </div>
  );
}

function BackButton({ onClick, lang }: { onClick: () => void; lang: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-muted/60 hover:bg-muted active:scale-[0.97] transition-all mb-3 border border-border/50"
    >
      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
        <ArrowLeft className="w-5 h-5 text-primary" />
      </div>
      <span className="text-sm font-bold text-foreground">{t("back", lang)}</span>
    </button>
  );
}

function PhotoUploadButton({
  type,
  currentUrl,
  token,
  lang,
  onSuccess,
}: {
  type: "driver" | "car";
  currentUrl: string | null;
  token: string;
  lang: string;
  onSuccess: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      fd.append("type", type);
      const res = await fetch(`${BASE_URL}/api/drivers/upload-my-photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.ok) {
        const data = await res.json();
        onSuccess(data.url);
        toast({ title: t("photoUploaded", lang) });
      } else {
        toast({ variant: "destructive", title: t("photoError", lang) });
      }
    } catch {
      toast({ variant: "destructive", title: t("netError", lang) });
    }
    setUploading(false);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative cursor-pointer group"
        onClick={() => inputRef.current?.click()}
      >
        {currentUrl ? (
          <img
            src={`${currentUrl}${currentUrl.includes("?") ? "&" : "?"}v=${Date.now()}`}
            alt=""
            className={`${type === "driver" ? "w-28 h-28 rounded-full" : "w-full h-40 rounded-2xl"} object-cover border-2 border-primary/20 shadow-lg`}
          />
        ) : (
          <div className={`${type === "driver" ? "w-28 h-28 rounded-full" : "w-full h-40 rounded-2xl"} bg-muted/60 border-2 border-dashed border-border flex items-center justify-center`}>
            {type === "driver" ? (
              <User className="w-12 h-12 text-muted-foreground" />
            ) : (
              <Car className="w-12 h-12 text-muted-foreground" />
            )}
          </div>
        )}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex items-center justify-center rounded-full">
          <Camera className="w-7 h-7 text-white" />
        </div>
        {uploading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-full">
            <div className="w-7 h-7 border-3 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <div className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shadow-lg border-2 border-card">
          <Camera className="w-4.5 h-4.5" />
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture={type === "driver" ? "user" : "environment"}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="text-xs font-semibold text-primary hover:text-primary/80 active:scale-95 transition-all"
      >
        {uploading ? t("uploading", lang) : t("changePhoto", lang)}
      </button>
    </div>
  );
}

function UnifiedPhotoEditor({
  driverPhoto,
  carPhoto,
  token,
  lang,
  onSuccess,
}: {
  driverPhoto: string | null;
  carPhoto: string | null;
  token: string;
  lang: string;
  onSuccess: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<null | "driver" | "car">(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const uploadFile = async (kind: "driver" | "car", file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      fd.append("type", kind);
      const res = await fetch(`${BASE_URL}/api/drivers/upload-my-photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.ok) {
        await res.json();
        onSuccess();
        toast({ title: t("photoUploaded", lang) });
        setCameraMode(null);
      } else {
        toast({ variant: "destructive", title: t("photoError", lang) });
      }
    } catch {
      toast({ variant: "destructive", title: t("netError", lang) });
    }
    setUploading(false);
  };

  const choose = (kind: "driver" | "car") => {
    setSheetOpen(false);
    setCameraMode(kind);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1 flex flex-col items-center gap-2">
          <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary/20 bg-muted/60 flex items-center justify-center">
            {driverPhoto ? (
              <img src={`${driverPhoto}${driverPhoto.includes("?") ? "&" : "?"}v=${Date.now()}`} alt="" className="w-full h-full object-cover" />
            ) : (
              <User className="w-10 h-10 text-muted-foreground" />
            )}
          </div>
          <p className="text-xs font-semibold text-muted-foreground">{t("driverPhoto", lang)}</p>
        </div>
        <div className="flex-1 flex flex-col items-center gap-2">
          <div className="w-full h-24 rounded-2xl overflow-hidden border-2 border-primary/20 bg-muted/60 flex items-center justify-center">
            {carPhoto ? (
              <img src={`${carPhoto}${carPhoto.includes("?") ? "&" : "?"}v=${Date.now()}`} alt="" className="w-full h-full object-cover" />
            ) : (
              <Car className="w-10 h-10 text-muted-foreground" />
            )}
          </div>
          <p className="text-xs font-semibold text-muted-foreground">{t("carPhoto", lang)}</p>
        </div>
      </div>

      <button
        onClick={() => setSheetOpen(true)}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm shadow-lg active:scale-[0.97] transition-transform disabled:opacity-60"
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("uploading", lang)}
          </>
        ) : (
          <>
            <Pencil className="w-4 h-4" />
            {t("changePhoto", lang)}
          </>
        )}
      </button>

      {cameraMode && (
        <CameraCapture
          mode={cameraMode === "driver" ? "selfie" : "car"}
          lang={lang}
          onCancel={() => setCameraMode(null)}
          onCapture={(file) => uploadFile(cameraMode, file)}
        />
      )}

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in" onClick={() => setSheetOpen(false)}>
          <div className="bg-card rounded-t-3xl w-full max-w-md p-4 space-y-3 animate-in slide-in-from-bottom" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1.5 rounded-full bg-muted mx-auto mb-2" />
            <h3 className="text-lg font-extrabold text-center mb-3">{t("changePhoto", lang)}</h3>
            <button
              onClick={() => choose("driver")}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-muted/60 hover:bg-muted active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                <User className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-base">{t("driverPhoto", lang)}</p>
                <p className="text-xs text-muted-foreground">{lang === "uz" ? "Old kamera (selfi)" : "Передняя камера (селфи)"}</p>
              </div>
              <Camera className="w-5 h-5 text-muted-foreground" />
            </button>
            <button
              onClick={() => choose("car")}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-muted/60 hover:bg-muted active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                <Car className="w-6 h-6 text-emerald-600" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-base">{t("carPhoto", lang)}</p>
                <p className="text-xs text-muted-foreground">{lang === "uz" ? "Orqa kamera" : "Задняя камера"}</p>
              </div>
              <Camera className="w-5 h-5 text-muted-foreground" />
            </button>
            <button
              onClick={() => setSheetOpen(false)}
              className="w-full py-3 rounded-2xl bg-muted text-foreground font-bold text-sm active:scale-[0.97] transition-transform"
            >
              {lang === "uz" ? "Bekor qilish" : "Отмена"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RatingDetailSection({ lang, token, onBack }: { lang: string; token: string | null; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/api/drivers/my-rating-history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { if (!r.ok) throw new Error("fail"); return r.json(); })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <DriverLayout>
        <div className="p-4">
          <BackButton onClick={onBack} lang={lang} />
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </div>
      </DriverLayout>
    );
  }

  if (!data) {
    return (
      <DriverLayout>
        <div className="p-4">
          <BackButton onClick={onBack} lang={lang} />
          <p className="text-center text-muted-foreground py-10">{lang === "uz" ? "Xatolik" : "Ошибка загрузки"}</p>
        </div>
      </DriverLayout>
    );
  }

  const { currentRating, totalRated, ratingBreakdown, totalBonuses, totalPenalties, recentRides, recentTransactions } = data;
  const maxBar = Math.max(...Object.values(ratingBreakdown as Record<number, number>), 1);

  return (
    <DriverLayout>
      <div className="p-4 space-y-4">
        <BackButton onClick={onBack} lang={lang} />

        <div className="bg-zinc-900 rounded-3xl p-5 text-white text-center shadow-xl">
          <Star className="w-10 h-10 mx-auto mb-2 fill-white/30" />
          <p className="text-5xl font-black">{parseFloat(String(currentRating)).toFixed(1)}</p>
          <p className="text-sm text-white/80 mt-1">
            {lang === "uz" ? `${totalRated} ta baho` : `${totalRated} оценок`}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-bold text-foreground mb-3">
            {lang === "uz" ? "Baholar taqsimoti" : "Распределение оценок"}
          </p>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map(star => {
              const count = (ratingBreakdown as Record<number, number>)[star] || 0;
              const pct = maxBar > 0 ? (count / maxBar) * 100 : 0;
              const colors: Record<number, string> = { 5: "bg-zinc-900", 4: "bg-zinc-700", 3: "bg-zinc-500", 2: "bg-zinc-400", 1: "bg-zinc-300" };
              return (
                <div key={star} className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 w-10 justify-end">
                    <span className="text-xs font-bold text-foreground">{star}</span>
                    <Star className="w-3 h-3 text-zinc-500 fill-zinc-500" />
                  </div>
                  <div className="flex-1 h-5 bg-muted/50 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${colors[star]} rounded-full transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-zinc-100 border border-zinc-200 rounded-2xl p-4 text-center">
            <ThumbsUp className="w-6 h-6 text-zinc-700 mx-auto mb-1" />
            <p className="text-lg font-bold text-zinc-900">+{fmt(totalBonuses)}</p>
            <p className="text-[10px] text-zinc-500">{lang === "uz" ? "Bonuslar" : "Бонусы"}</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-center">
            <ThumbsDown className="w-6 h-6 text-red-600 mx-auto mb-1" />
            <p className="text-lg font-bold text-red-700">-{fmt(totalPenalties)}</p>
            <p className="text-[10px] text-red-600/70">{lang === "uz" ? "Jarimalar" : "Штрафы"}</p>
          </div>
        </div>

        {recentTransactions && recentTransactions.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <p className="text-sm font-bold text-foreground">
                {lang === "uz" ? "Bonus va jarimalar" : "Бонусы и штрафы"}
              </p>
            </div>
            <div className="divide-y divide-border max-h-72 overflow-y-auto">
              {recentTransactions.map((txn: any) => {
                const isBonus = txn.type === "bonus";
                return (
                  <div key={txn.id} className="p-3 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isBonus ? "bg-zinc-100" : "bg-red-500/10"}`}>
                      {isBonus ? <ThumbsUp className="w-4 h-4 text-zinc-700" /> : <ThumbsDown className="w-4 h-4 text-red-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{txn.description || (isBonus ? "Бонус" : "Штраф")}</p>
                      <p className="text-[10px] text-muted-foreground">{new Date(txn.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                    <span className={`text-sm font-bold ${isBonus ? "text-zinc-700" : "text-red-600"}`}>
                      {isBonus ? "+" : "-"}{fmt(Math.abs(Number(txn.amount)))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {recentRides && recentRides.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <p className="text-sm font-bold text-foreground">
                {lang === "uz" ? "So'nggi reyslar" : "Последние поездки"}
              </p>
            </div>
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {recentRides.map((ride: any) => (
                <div key={ride.id} className="p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
                    {ride.driverRating ? (
                      <span className="text-xs font-bold text-zinc-700">{ride.driverRating}</span>
                    ) : (
                      <Star className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {ride.fromCity} → {ride.toCity}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(ride.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {ride.riderName ? ` • ${ride.riderName}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-foreground">{fmt(ride.price)} сум</p>
                    {ride.driverRating && (
                      <div className="flex items-center gap-0.5 justify-end mt-0.5">
                        {[1, 2, 3, 4, 5].map(i => (
                          <Star key={i} className={`w-2.5 h-2.5 ${i <= Math.round(ride.driverRating) ? "text-zinc-700 fill-zinc-700" : "text-muted"}`} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DriverLayout>
  );
}

function ActivityDetailSection({ lang, token, onBack }: { lang: string; token: string | null; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${BASE_URL}/api/drivers/my-activity-history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { if (!r.ok) throw new Error("fail"); return r.json(); })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <DriverLayout>
        <div className="p-4">
          <BackButton onClick={onBack} lang={lang} />
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        </div>
      </DriverLayout>
    );
  }

  if (!data) {
    return (
      <DriverLayout>
        <div className="p-4">
          <BackButton onClick={onBack} lang={lang} />
          <p className="text-center text-muted-foreground py-10">{lang === "uz" ? "Xatolik" : "Ошибка загрузки"}</p>
        </div>
      </DriverLayout>
    );
  }

  const { activityScore, offerStats, recentOffers, penalties, bannedUntil, consecutiveIgnores, totalRides } = data;
  const isBanned = bannedUntil && new Date(bannedUntil) > new Date();

  const offerStatusConfig: Record<string, { label: string; icon: typeof CheckCircle; color: string; bg: string }> = {
    accepted: { label: lang === "uz" ? "Qabul qilindi" : "Принят", icon: CheckCircle, color: "text-zinc-700", bg: "bg-zinc-100" },
    rejected: { label: lang === "uz" ? "Rad etildi" : "Отклонён", icon: XCircle, color: "text-red-600", bg: "bg-red-500/10" },
    expired: { label: lang === "uz" ? "Muddati o'tdi" : "Пропущен", icon: Clock, color: "text-zinc-600", bg: "bg-zinc-100" },
    pending: { label: lang === "uz" ? "Kutilmoqda" : "Ожидает", icon: Clock, color: "text-zinc-600", bg: "bg-zinc-100" },
  };

  return (
    <DriverLayout>
      <div className="p-4 space-y-4">
        <BackButton onClick={onBack} lang={lang} />

        <div className="bg-zinc-900 rounded-3xl p-5 text-white text-center shadow-xl">
          <Activity className="w-10 h-10 mx-auto mb-2" />
          <p className="text-5xl font-black">{activityScore}</p>
          <p className="text-sm text-white/80 mt-1">
            {lang === "uz" ? "Faollik bali" : "Балл активности"}
          </p>
        </div>

        {isBanned && (
          <div className="bg-red-500/10 border-2 border-red-500/30 rounded-2xl p-4 flex items-center gap-3">
            <Ban className="w-6 h-6 text-red-600 shrink-0" />
            <div>
              <p className="text-sm font-bold text-red-700">
                {lang === "uz" ? "Vaqtincha bloklangan" : "Временная блокировка"}
              </p>
              <p className="text-xs text-red-600/80">
                {lang === "uz" ? "Gacha:" : "До:"} {new Date(bannedUntil).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card border border-border rounded-2xl p-3.5 text-center shadow-sm">
            <p className="text-2xl font-black text-foreground">{totalRides}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{lang === "uz" ? "Jami reyslar" : "Всего поездок"}</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-3.5 text-center shadow-sm">
            <p className="text-2xl font-black text-foreground">{offerStats.acceptRate}%</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{lang === "uz" ? "Qabul qilish" : "Принятие"}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-100 border border-zinc-200 rounded-xl p-3 text-center">
            <CheckCircle className="w-5 h-5 text-zinc-700 mx-auto mb-1" />
            <p className="text-lg font-bold text-zinc-900">{offerStats.accepted}</p>
            <p className="text-[9px] text-zinc-500">{lang === "uz" ? "Qabul" : "Принято"}</p>
          </div>
          <div className="bg-zinc-100 border border-zinc-200 rounded-xl p-3 text-center">
            <Clock className="w-5 h-5 text-zinc-600 mx-auto mb-1" />
            <p className="text-lg font-bold text-zinc-700">{offerStats.expired}</p>
            <p className="text-[9px] text-zinc-600/70">{lang === "uz" ? "O'tkazib yuborilgan" : "Пропущено"}</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
            <XCircle className="w-5 h-5 text-red-600 mx-auto mb-1" />
            <p className="text-lg font-bold text-red-700">{offerStats.rejected}</p>
            <p className="text-[9px] text-red-600/70">{lang === "uz" ? "Rad etilgan" : "Отклонено"}</p>
          </div>
        </div>

        {consecutiveIgnores > 0 && (
          <div className="bg-zinc-100 border border-zinc-200 rounded-2xl p-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-zinc-600 shrink-0" />
            <p className="text-xs font-semibold text-zinc-700">
              {lang === "uz"
                ? `Ketma-ket ${consecutiveIgnores} ta buyurtma o'tkazib yuborildi`
                : `Подряд пропущено заказов: ${consecutiveIgnores}`}
            </p>
          </div>
        )}

        {penalties && penalties.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <p className="text-sm font-bold text-foreground">
                {lang === "uz" ? "Jarimalar" : "Штрафы"}
              </p>
            </div>
            <div className="divide-y divide-border max-h-60 overflow-y-auto">
              {penalties.map((p: any) => (
                <div key={p.id} className="p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                    <ThumbsDown className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{p.description || (lang === "uz" ? "Jarima" : "Штраф")}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <span className="text-sm font-bold text-red-600">-{fmt(Math.abs(Number(p.amount)))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentOffers && recentOffers.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <p className="text-sm font-bold text-foreground">
                {lang === "uz" ? "Buyurtma takliflari" : "Предложения заказов"}
              </p>
            </div>
            <div className="divide-y divide-border max-h-96 overflow-y-auto">
              {recentOffers.map((offer: any) => {
                const cfg = offerStatusConfig[offer.status] || offerStatusConfig.pending;
                const Icon = cfg.icon;
                return (
                  <div key={offer.id} className="p-3 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-4 h-4 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {offer.ride ? (
                        <>
                          <p className="text-xs font-semibold text-foreground truncate">
                            {offer.ride.fromCity} → {offer.ride.toCity}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(offer.offeredAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            {offer.ride.price ? ` • ${fmt(offer.ride.price)} сум` : ""}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {lang === "uz" ? "Buyurtma" : "Заказ"} #{offer.rideId}
                        </p>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DriverLayout>
  );
}

export default function Profile() {
  const { user, token, logout, refreshUser } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [section, setSection] = useState<ProfileSection>("main");
  const { language, setLanguage, theme, setTheme, fontSize, setFontSize, fontScale, increaseFontScale, decreaseFontScale } = useSettingsStore();
  const lang = language;
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("buxtaxi_sound") !== "false");
  const [vibrationEnabled, setVibrationEnabled] = useState(() => localStorage.getItem("buxtaxi_vibration") !== "false");

  const roofBaggage = useSettingsStore(s => s.roofBaggage);
  const setRoofBaggage = useSettingsStore(s => s.setRoofBaggage);
  const childSeat = useSettingsStore(s => s.childSeat);
  const setChildSeat = useSettingsStore(s => s.setChildSeat);
  const acceptParcels = useSettingsStore(s => s.acceptParcels);
  const setAcceptParcels = useSettingsStore(s => s.setAcceptParcels);
  const [showTutorial, setShowTutorial] = useState(false);

  if (!user) return null;

  const stats = [
    { icon: CheckCircle, label: t("trips", lang), value: user.totalRides || 0, color: "text-zinc-700", bg: "bg-zinc-100" },
    { icon: Star, label: t("rating", lang), value: parseFloat(String(user.rating || "5.0")).toFixed(1), color: "text-zinc-700", bg: "bg-zinc-100" },
    { icon: Activity, label: t("activity", lang), value: user.activityScore || 0, color: "text-zinc-700", bg: "bg-zinc-100" },
    { icon: TrendingUp, label: t("acceptance", lang), value: `${user.acceptedOrders && user.totalRides ? Math.round((user.acceptedOrders / (user.acceptedOrders + (user.cancelledOrders || 0))) * 100) : 0}%`, color: "text-zinc-700", bg: "bg-zinc-100" },
  ];

  const statusMap: Record<string, { label: string; color: string }> = {
    online: { label: t("online", lang), color: "bg-emerald-500" },
    busy: { label: t("busy", lang), color: "bg-zinc-500" },
    offline: { label: t("offline", lang), color: "bg-muted-foreground" },
  };
  const st = statusMap[user.status || "offline"] || statusMap.offline;

  const handlePhotoSuccess = () => {
    refreshUser();
  };

  if (section === "driver-info") {
    return (
      <DriverLayout>
        <div className="p-4 space-y-5">
          <BackButton onClick={() => setSection("main")} lang={lang} />
          <h2 className="text-2xl font-extrabold text-foreground">{t("driverData", lang)}</h2>
          <div className="flex flex-col items-center py-4">
            <UnifiedPhotoEditor
              driverPhoto={getPhotoUrl((user as any)?.driverPhoto)}
              carPhoto={getPhotoUrl((user as any)?.carPhoto)}
              token={token || ""}
              lang={lang}
              onSuccess={handlePhotoSuccess}
            />
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-extrabold text-muted-foreground uppercase tracking-wider mb-2 block">{t("name", lang)}</label>
              <div className="w-full px-4 py-3.5 rounded-xl border border-border bg-muted/50 text-lg font-bold text-foreground">
                {user.name || "—"}
              </div>
            </div>
            <div>
              <label className="text-sm font-extrabold text-muted-foreground uppercase tracking-wider mb-2 block">{t("phone_label", lang)}</label>
              <div className="w-full px-4 py-3.5 rounded-xl border border-border bg-muted/50 text-lg font-bold text-foreground">
                {user.phone || "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">{t("phoneBound", lang)}</p>
            </div>
          </div>
        </div>
      </DriverLayout>
    );
  }

  if (section === "car-info") {
    return (
      <DriverLayout>
        <div className="p-4 space-y-5">
          <BackButton onClick={() => setSection("main")} lang={lang} />
          <h2 className="text-2xl font-extrabold text-foreground">{t("car", lang)}</h2>
          <div className="flex flex-col items-center py-3">
            <UnifiedPhotoEditor
              driverPhoto={getPhotoUrl((user as any)?.driverPhoto)}
              carPhoto={getPhotoUrl((user as any)?.carPhoto)}
              token={token || ""}
              lang={lang}
              onSuccess={handlePhotoSuccess}
            />
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-extrabold text-muted-foreground uppercase tracking-wider mb-2 block">{t("brand", lang)}</label>
              <div className="w-full px-4 py-3.5 rounded-xl border border-border bg-muted/50 text-lg font-bold text-foreground">
                {user.carModel?.split(" ")[0] || "—"}
              </div>
            </div>
            <div>
              <label className="text-sm font-extrabold text-muted-foreground uppercase tracking-wider mb-2 block">{t("model", lang)}</label>
              <div className="w-full px-4 py-3.5 rounded-xl border border-border bg-muted/50 text-lg font-bold text-foreground">
                {user.carModel || "—"}
              </div>
            </div>
            <div>
              <label className="text-sm font-extrabold text-muted-foreground uppercase tracking-wider mb-2 block">{t("color", lang)}</label>
              <div className="w-full px-4 py-3.5 rounded-xl border border-border bg-muted/50 text-lg font-bold text-foreground">
                {user.carColor || "—"}
              </div>
            </div>
            <div>
              <label className="text-sm font-extrabold text-muted-foreground uppercase tracking-wider mb-2 block">{t("plate", lang)}</label>
              <div className="w-full px-4 py-3.5 rounded-xl border border-border bg-muted/50 text-lg font-bold text-foreground uppercase">
                {user.carNumber || "—"}
              </div>
            </div>
          </div>
        </div>
      </DriverLayout>
    );
  }

  if (section === "settings") {
    return (
      <DriverLayout>
        <div className="p-4 space-y-4">
          <BackButton onClick={() => setSection("main")} lang={lang} />
          <h2 className="text-lg font-extrabold text-foreground">{t("settings", lang)}</h2>

          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-3 mb-3">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">{t("language", lang)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "ru" as const, label: "Русский" },
                  { id: "uz" as const, label: "O'zbekcha" },
                ].map(l => (
                  <button
                    key={l.id}
                    onClick={() => setLanguage(l.id)}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
                      language === l.id
                        ? "bg-primary text-white shadow-sm"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-3 mb-3">
                <Sun className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">{t("theme", lang)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "light" as const, label: t("lightTheme", lang), icon: Sun },
                  { id: "dark" as const, label: t("darkTheme", lang), icon: Moon },
                  { id: "auto" as const, label: t("autoTheme", lang), icon: Monitor },
                ].map(ti => {
                  const Icon = ti.icon;
                  return (
                    <button
                      key={ti.id}
                      onClick={() => setTheme(ti.id)}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                        theme === ti.id
                          ? "bg-primary text-white shadow-sm"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {ti.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {soundEnabled ? <Volume2 className="w-4 h-4 text-muted-foreground" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
                  <span className="text-sm font-semibold text-foreground">{t("sounds", lang)}</span>
                </div>
                <button
                  onClick={() => {
                    const next = !soundEnabled;
                    setSoundEnabled(next);
                    localStorage.setItem("buxtaxi_sound", String(next));
                  }}
                  className={`w-12 h-7 rounded-full transition-colors relative ${
                    soundEnabled ? "bg-primary" : "bg-muted/90"
                  }`}
                >
                  <div className={`w-5 h-5 bg-card rounded-full shadow-md absolute top-1 transition-all ${
                    soundEnabled ? "right-1" : "left-1"
                  }`} />
                </button>
              </div>
              {soundEnabled && <SoundPresetPicker />}
            </div>

            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">{t("vibration", lang)}</span>
                </div>
                <button
                  onClick={() => {
                    const next = !vibrationEnabled;
                    setVibrationEnabled(next);
                    localStorage.setItem("buxtaxi_vibration", String(next));
                    if (next && "vibrate" in navigator) navigator.vibrate(100);
                  }}
                  className={`w-12 h-7 rounded-full transition-colors relative ${
                    vibrationEnabled ? "bg-primary" : "bg-muted/90"
                  }`}
                >
                  <div className={`w-5 h-5 bg-card rounded-full shadow-md absolute top-1 transition-all ${
                    vibrationEnabled ? "right-1" : "left-1"
                  }`} />
                </button>
              </div>
            </div>

            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <Type className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">{t("fontSizeLabel", lang)}</span>
              </div>
              <div className="flex items-center justify-between bg-muted/50 rounded-2xl p-2 gap-2">
                <button
                  onClick={decreaseFontScale}
                  disabled={(fontScale || 1.0) <= 0.5}
                  className="w-12 h-12 rounded-xl bg-card border border-border flex items-center justify-center shadow-sm active:scale-90 transition-all disabled:opacity-30"
                >
                  <Minus className="w-6 h-6 text-foreground" />
                </button>
                <div className="flex-1 text-center">
                  <span className="text-2xl font-extrabold text-foreground">{Math.round((fontScale || 1.0) * 100)}%</span>
                </div>
                <button
                  onClick={increaseFontScale}
                  disabled={(fontScale || 1.0) >= 2.0}
                  className="w-12 h-12 rounded-xl bg-card border border-border flex items-center justify-center shadow-sm active:scale-90 transition-all disabled:opacity-30"
                >
                  <Plus className="w-6 h-6 text-foreground" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                {lang === "uz" ? "Har bir bosish 10% o'zgartiradi" : "Каждое нажатие ±10%"}
              </p>
            </div>
          </div>
        </div>
      </DriverLayout>
    );
  }

  if (section === "rating-detail") {
    return <RatingDetailSection lang={lang} token={token} onBack={() => setSection("main")} />;
  }

  if (section === "activity-detail") {
    return <ActivityDetailSection lang={lang} token={token} onBack={() => setSection("main")} />;
  }

  if (section === "options") {
    return (
      <DriverLayout>
        <div className="p-4 space-y-4">
          <BackButton onClick={() => setSection("main")} lang={lang} />
          <h2 className="text-lg font-extrabold text-foreground">{t("extras", lang)}</h2>

          <div className="bg-card border border-border rounded-2xl shadow-sm divide-y divide-border">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                  <Luggage className="w-4.5 h-4.5 text-zinc-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("roofBaggage", lang)}</p>
                  <p className="text-[11px] text-muted-foreground">{t("roofBaggageDesc", lang)}</p>
                </div>
              </div>
              <button
                onClick={() => setRoofBaggage(!roofBaggage)}
                className={`w-12 h-7 rounded-full transition-colors relative ${
                  roofBaggage ? "bg-primary" : "bg-muted/90"
                }`}
              >
                <div className={`w-5 h-5 bg-card rounded-full shadow-md absolute top-1 transition-all ${
                  roofBaggage ? "right-1" : "left-1"
                }`} />
              </button>
            </div>

            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                  <Baby className="w-4.5 h-4.5 text-zinc-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("childSeat", lang)}</p>
                  <p className="text-[11px] text-muted-foreground">{t("childSeatDesc", lang)}</p>
                </div>
              </div>
              <button
                onClick={() => setChildSeat(!childSeat)}
                className={`w-12 h-7 rounded-full transition-colors relative ${
                  childSeat ? "bg-primary" : "bg-muted/90"
                }`}
              >
                <div className={`w-5 h-5 bg-card rounded-full shadow-md absolute top-1 transition-all ${
                  childSeat ? "right-1" : "left-1"
                }`} />
              </button>
            </div>

            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                  <Package className="w-4.5 h-4.5 text-zinc-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("parcels", lang)}</p>
                  <p className="text-[11px] text-muted-foreground">{t("parcelsDesc", lang)}</p>
                </div>
              </div>
              <button
                onClick={() => setAcceptParcels(!acceptParcels)}
                className={`w-12 h-7 rounded-full transition-colors relative ${
                  acceptParcels ? "bg-primary" : "bg-muted/90"
                }`}
              >
                <div className={`w-5 h-5 bg-card rounded-full shadow-md absolute top-1 transition-all ${
                  acceptParcels ? "right-1" : "left-1"
                }`} />
              </button>
            </div>
          </div>
        </div>
      </DriverLayout>
    );
  }

  const driverPhotoUrl = getPhotoUrl((user as any)?.driverPhoto);
  const carPhotoUrl = getPhotoUrl((user as any)?.carPhoto);

  return (
    <DriverLayout>
      <div className="p-4 space-y-4">
        <div className="bg-zinc-900 rounded-3xl p-5 shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_60%)]" />
          <PhotoEditTrigger token={token || ""} lang={lang} onSuccess={refreshUser}>
            {(open, uploading) => (
              <button
                onClick={open}
                disabled={uploading}
                className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center hover:bg-white/30 active:scale-95 transition-all z-10 disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                ) : (
                  <Pencil className="w-4 h-4 text-white" />
                )}
              </button>
            )}
          </PhotoEditTrigger>
          <div className="relative flex items-center gap-4">
            <div className="relative shrink-0">
              {driverPhotoUrl ? (
                <img
                  src={`${driverPhotoUrl}${driverPhotoUrl.includes("?") ? "&" : "?"}v=${user.updatedAt || ""}`}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover border-[3px] border-white/30 shadow-lg"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty("display"); }}
                />
              ) : null}
              <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center" style={driverPhotoUrl ? { display: "none" } : {}}>
                <User className="w-10 h-10 text-white/80" />
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border-[3px] border-zinc-900 ${st.color} shadow-md`} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-extrabold text-white truncate">{user.name}</h2>
              <div className="flex items-center gap-1.5 mt-1">
                <Phone className="w-3.5 h-3.5 text-white/70" />
                <span className="text-sm text-white/80 font-medium">{user.phone}</span>
              </div>
            </div>
          </div>
        </div>

        {(user.carModel || user.carNumber) && (
          <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Car className="w-7 h-7 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-extrabold text-foreground truncate">{user.carModel || "—"}</p>
                {user.carColor && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.carColor}</p>
                )}
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border/50 flex justify-center">
              {user.carNumber ? (
                <LicensePlate plate={user.carNumber} />
              ) : (
                <p className="text-xs text-muted-foreground italic">{lang === "uz" ? "Raqam ko\'rsatilmagan" : "Номер не указан"}</p>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          {stats.map(s => {
            const Icon = s.icon;
            const clickable = s.label === t("rating", lang) || s.label === t("activity", lang);
            const handleClick = () => {
              if (s.label === t("rating", lang)) setSection("rating-detail");
              else if (s.label === t("activity", lang)) setSection("activity-detail");
            };
            return (
              <button
                key={s.label}
                onClick={clickable ? handleClick : undefined}
                className={`bg-card border border-border rounded-2xl p-3 text-center shadow-sm transition-all ${clickable ? "active:scale-[0.95] hover:border-primary/30" : ""}`}
              >
                <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center mx-auto mb-1.5`}>
                  <Icon className={`w-4 h-4 ${s.color}`} />
                </div>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                {clickable && <ChevronRight className="w-3 h-3 text-muted-foreground mx-auto mt-1" />}
              </button>
            );
          })}
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm divide-y divide-border">
          <button onClick={() => navigate("/driver/earnings")} className="w-full p-4 flex items-center justify-between hover:bg-muted/30 active:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                <MapPin className="w-4 h-4 text-zinc-600" />
              </div>
              <span className="text-sm font-semibold text-foreground">{t("myTrips", lang)}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>

          <button onClick={() => navigate("/driver/wallet")} className="w-full p-4 flex items-center justify-between hover:bg-muted/30 active:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-zinc-700" />
              </div>
              <div className="text-left">
                <span className="text-sm font-semibold text-foreground block">{t("wallet", lang)}</span>
                <span className="text-[11px] text-muted-foreground">{fmt(parseFloat(String(user.balance || "0")))} {t("sum", lang)}</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>

          <button onClick={() => navigate("/driver/news")} className="w-full p-4 flex items-center justify-between hover:bg-muted/30 active:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                <Newspaper className="w-4 h-4 text-zinc-600" />
              </div>
              <span className="text-sm font-semibold text-foreground">{t("news", lang)}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>

        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm divide-y divide-border">
          <button onClick={() => setSection("settings")} className="w-full p-4 flex items-center justify-between hover:bg-muted/30 active:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                <Settings className="w-4 h-4 text-zinc-600" />
              </div>
              <span className="text-sm font-semibold text-foreground">{t("settings", lang)}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>

          <button onClick={() => setShowTutorial(true)} className="w-full p-4 flex items-center justify-between hover:bg-muted/30 active:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center">
                <GraduationCap className="w-4 h-4 text-zinc-600" />
              </div>
              <div className="text-left">
                <span className="text-sm font-semibold text-foreground block">{t("tutorial", lang)}</span>
                <span className="text-[11px] text-muted-foreground">{t("tutorialDesc", lang)}</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>

          <button onClick={() => setSection("options")} className="w-full p-4 flex items-center justify-between hover:bg-muted/30 active:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                <Package className="w-4 h-4 text-foreground" />
              </div>
              <span className="text-sm font-semibold text-foreground">{t("extras", lang)}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {showTutorial && (
          <DriverTutorial onComplete={() => setShowTutorial(false)} />
        )}

        <div className="bg-card border border-border rounded-2xl shadow-sm divide-y divide-border">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Star className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-foreground">{t("refCode", lang)}</span>
            </div>
            <span className="text-sm font-semibold text-primary">{user.referralCode || "—"}</span>
          </div>
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-foreground">{t("regDate", lang)}</span>
            </div>
            <span className="text-sm text-muted-foreground">{user.createdAt ? new Date(user.createdAt).toLocaleDateString("ru-RU") : "—"}</span>
          </div>
        </div>

        <button
          onClick={logout}
          className="w-full py-3 rounded-xl text-sm font-semibold text-red-500 bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
        >
          <LogOut className="w-4 h-4" />
          {t("logout", lang)}
        </button>
      </div>
    </DriverLayout>
  );
}
