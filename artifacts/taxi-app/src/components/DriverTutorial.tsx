import { useState, useEffect, useCallback } from "react";
import {
  Power, Wallet, ShoppingBag, Bell, MessageCircle, Users,
  ChevronRight, ChevronLeft, X, CheckCircle, Zap, MapPin,
  CreditCard, ArrowRight
} from "lucide-react";
import { useSettingsStore } from "@/stores/settings";

interface TutorialSlide {
  icon: typeof Power;
  color: string;
  bg: string;
  glow: string;
  titleRu: string;
  titleUz: string;
  descRu: string;
  descUz: string;
  stepsRu: string[];
  stepsUz: string[];
  illustration: string;
}

const SLIDES: TutorialSlide[] = [
  {
    icon: Power,
    color: "text-emerald-500",
    bg: "bg-emerald-500",
    glow: "shadow-emerald-500/30",
    titleRu: "Выход на линию",
    titleUz: "Liniyaga chiqish",
    descRu: "Начните принимать заказы",
    descUz: "Buyurtmalarni qabul qilishni boshlang",
    stepsRu: [
      "Нажмите кнопку включения на главном экране",
      "Статус сменится на «На линии»",
      "Вы начнёте получать новые заказы",
    ],
    stepsUz: [
      "Bosh ekranda yoqish tugmasini bosing",
      "Holat «Onlayn» ga o'zgaradi",
      "Yangi buyurtmalar keladi",
    ],
    illustration: "power",
  },
  {
    icon: Wallet,
    color: "text-amber-500",
    bg: "bg-amber-500",
    glow: "shadow-amber-500/30",
    titleRu: "Пополнение баланса",
    titleUz: "Balansni to'ldirish",
    descRu: "Оплата за использование сервиса",
    descUz: "Xizmatdan foydalanish uchun to'lov",
    stepsRu: [
      "Откройте «Кошелёк» в профиле",
      "Нажмите «Пополнить»",
      "Выберите сумму и способ оплаты",
      "После оплаты баланс обновится",
    ],
    stepsUz: [
      "Profildan «Hamyon» ni oching",
      "«To'ldirish» tugmasini bosing",
      "Summani va to'lov usulini tanlang",
      "To'lovdan keyin balans yangilanadi",
    ],
    illustration: "wallet",
  },
  {
    icon: Bell,
    color: "text-zinc-700",
    bg: "bg-zinc-700",
    glow: "shadow-zinc-700/30",
    titleRu: "Приём заказа",
    titleUz: "Buyurtmani qabul qilish",
    descRu: "Когда появится новый заказ",
    descUz: "Yangi buyurtma kelganda",
    stepsRu: [
      "Появится уведомление с маршрутом и ценой",
      "Нажмите «Принять» чтобы взять заказ",
      "Или подождите — заказ уйдёт другому",
      "После принятия свяжитесь с клиентом",
    ],
    stepsUz: [
      "Yo'nalish va narx bilan bildirishnoma keladi",
      "Buyurtmani olish uchun «Qabul qilish» bosing",
      "Yoki kuting — boshqa haydovchiga ketadi",
      "Qabul qilgandan keyin mijoz bilan bog'laning",
    ],
    illustration: "order",
  },
  {
    icon: ShoppingBag,
    color: "text-zinc-700",
    bg: "bg-zinc-700",
    glow: "shadow-zinc-700/30",
    titleRu: "Продажа заказа",
    titleUz: "Buyurtmani sotish",
    descRu: "Передайте заказ другому водителю",
    descUz: "Buyurtmani boshqa haydovchiga bering",
    stepsRu: [
      "Откройте «Маркет» на нижней панели",
      "Нажмите «Выставить на продажу»",
      "Укажите цену и маршрут",
      "Другой водитель купит ваш заказ",
    ],
    stepsUz: [
      "Pastki panelda «Market» ni oching",
      "«Sotuvga qo'yish» tugmasini bosing",
      "Narx va yo'nalishni kiriting",
      "Boshqa haydovchi buyurtmangizni sotib oladi",
    ],
    illustration: "market",
  },
  {
    icon: MessageCircle,
    color: "text-zinc-700",
    bg: "bg-zinc-700",
    glow: "shadow-zinc-700/30",
    titleRu: "Чат и группы",
    titleUz: "Chat va guruhlar",
    descRu: "Общение с диспетчером и водителями",
    descUz: "Dispetcher va haydovchilar bilan aloqa",
    stepsRu: [
      "Нажмите на иконку чата в заказе",
      "Отправляйте фото, голосовые, эмодзи",
      "Группы — в профиле → «Группы»",
      "Получайте уведомления о новых сообщениях",
    ],
    stepsUz: [
      "Buyurtmadagi chat belgisini bosing",
      "Rasm, ovozli xabar, emoji yuboring",
      "Guruhlar — profildan → «Guruhlar»",
      "Yangi xabarlar haqida bildirishnoma oling",
    ],
    illustration: "chat",
  },
];

function SlideIllustration({ type, color }: { type: string; color: string }) {
  const iconMap: Record<string, typeof Power> = {
    power: Power,
    wallet: CreditCard,
    order: Bell,
    market: ShoppingBag,
    chat: MessageCircle,
  };
  const Icon = iconMap[type] || Zap;

  return (
    <div className="relative w-48 h-48 mx-auto mb-6">
      <div className={`absolute inset-0 rounded-full ${color} opacity-5 animate-pulse`} />
      <div className={`absolute inset-4 rounded-full ${color} opacity-10`} />
      <div className={`absolute inset-8 rounded-full ${color} opacity-15`} />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className={`w-24 h-24 rounded-3xl ${color} flex items-center justify-center shadow-2xl transform transition-transform duration-700`}
          style={{ animation: "tutorialBounce 2s ease-in-out infinite" }}>
          <Icon className="w-12 h-12 text-white" />
        </div>
      </div>

      <div className="absolute top-4 right-8 w-3 h-3 rounded-full bg-primary/30"
        style={{ animation: "tutorialFloat 3s ease-in-out infinite" }} />
      <div className="absolute bottom-8 left-4 w-2 h-2 rounded-full bg-primary/20"
        style={{ animation: "tutorialFloat 2.5s ease-in-out infinite 0.5s" }} />
      <div className="absolute top-12 left-6 w-2.5 h-2.5 rounded-full bg-primary/25"
        style={{ animation: "tutorialFloat 3.5s ease-in-out infinite 1s" }} />
    </div>
  );
}

export default function DriverTutorial({ onComplete }: { onComplete: () => void }) {
  const lang = useSettingsStore((s) => s.language);
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState<"right" | "left">("right");
  const [animKey, setAnimKey] = useState(0);

  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const slide = SLIDES[current];
  const isLast = current === SLIDES.length - 1;

  const goNext = () => {
    if (isLast) {
      localStorage.setItem("buxtaxi_tutorial_completed", "true");
      onComplete();
      return;
    }
    setDirection("right");
    setAnimKey(k => k + 1);
    setCurrent(c => c + 1);
  };

  const goPrev = () => {
    if (current === 0) return;
    setDirection("left");
    setAnimKey(k => k + 1);
    setCurrent(c => c - 1);
  };

  const skip = () => {
    localStorage.setItem("buxtaxi_tutorial_completed", "true");
    onComplete();
  };

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes tutorialBounce {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-8px) rotate(2deg); }
      }
      @keyframes tutorialFloat {
        0%, 100% { transform: translateY(0) scale(1); opacity: 0.5; }
        50% { transform: translateY(-12px) scale(1.2); opacity: 1; }
      }
      @keyframes slideInRight {
        from { transform: translateX(60px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideInLeft {
        from { transform: translateX(-60px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      .tutorial-slide-right { animation: slideInRight 0.4s ease-out; }
      .tutorial-slide-left { animation: slideInLeft 0.4s ease-out; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const steps = lang === "uz" ? slide.stepsUz : slide.stepsRu;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col" role="dialog" aria-modal="true" aria-label={t("Обучение", "O'rganish")}>
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <div className="flex gap-1.5">
          {SLIDES.map((_, i) => (
            <div key={i} className={`h-1 rounded-full transition-all duration-500 ${
              i === current ? "w-8 bg-primary" : i < current ? "w-4 bg-primary/40" : "w-4 bg-muted"
            }`} />
          ))}
        </div>
        <button
          onClick={skip}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg active:bg-muted/50 transition-colors"
        >
          {t("Пропустить", "O'tkazib yuborish")}
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto">
        <div
          key={animKey}
          className={`w-full max-w-sm ${direction === "right" ? "tutorial-slide-right" : "tutorial-slide-left"}`}
        >
          <SlideIllustration type={slide.illustration} color={slide.bg} />

          <h1 className="text-2xl font-extrabold text-foreground text-center mb-2">
            {lang === "uz" ? slide.titleUz : slide.titleRu}
          </h1>
          <p className="text-sm text-muted-foreground text-center mb-8">
            {lang === "uz" ? slide.descUz : slide.descRu}
          </p>

          <div className="space-y-3">
            {steps.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${i * 120 + 300}ms`, animationFillMode: "both" }}
              >
                <div className={`w-7 h-7 rounded-lg ${slide.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                  <span className="text-xs font-bold text-white">{i + 1}</span>
                </div>
                <p className="text-sm text-foreground font-medium leading-relaxed pt-0.5">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 pb-8 pt-4 flex gap-3">
        {current > 0 && (
          <button
            onClick={goPrev}
            aria-label={t("Назад", "Orqaga")}
            className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center active:scale-95 transition-transform"
          >
            <ChevronLeft className="w-6 h-6 text-foreground" />
          </button>
        )}
        <button
          onClick={goNext}
          className={`flex-1 py-4 rounded-2xl font-extrabold text-lg shadow-lg active:scale-[0.97] transition-transform flex items-center justify-center gap-2 ${
            isLast
              ? "bg-emerald-500 text-white shadow-emerald-500/30"
              : "bg-primary text-white shadow-primary/30"
          }`}
        >
          {isLast ? (
            <>
              <CheckCircle className="w-5 h-5" />
              {t("Начать работу!", "Ishlashni boshlash!")}
            </>
          ) : (
            <>
              {t("Далее", "Keyingi")}
              <ChevronRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
