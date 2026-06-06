import { useLocation } from "wouter";
import DispatcherLayout from "./DispatcherLayout";
import { Settings2, Zap, Route, TrendingUp, Wallet, Car, ShoppingCart, ChevronRight, Building, Smartphone, CreditCard, MessageSquare, Bell, ShieldBan , Package, FileAudio} from "lucide-react";

const CATEGORIES = [
  {
    route: "/management/settings/dispatch",
    title: "Диспетчеризация",
    subtitle: "Автоназначение, очередь, баны",
    icon: Zap,
    color: "bg-purple-500/10 text-purple-600",
    count: 10,
  },
  {
    route: "/management/settings/routing",
    title: "Маршруты",
    subtitle: "Попутчики, маршрутизация",
    icon: Route,
    color: "bg-sky-500/10 text-sky-600",
    count: 6,
  },
  {
    route: "/management/settings/options",
    title: "Опции",
    subtitle: "Багажник, верхний багаж, посылки + комиссии",
    icon: Package,
    color: "bg-violet-500/10 text-violet-600",
    count: 4,
  },

  {
    route: "/management/settings/pricing",
    title: "Цены",
    subtitle: "Множители, пиковые часы, бонусы",
    icon: TrendingUp,
    color: "bg-amber-500/10 text-amber-600",
    count: 13,
  },
  {
    route: "/management/settings/finance",
    title: "Финансы",
    subtitle: "Комиссия, штрафы, выплаты",
    icon: Wallet,
    color: "bg-emerald-500/10 text-emerald-600",
    count: 6,
  },
  {
    route: "/management/settings/drivers",
    title: "Водители",
    subtitle: "Верификация, активность, авто",
    icon: Car,
    color: "bg-blue-500/10 text-blue-600",
    count: 6,
  },
  {
    route: "/management/settings/market",
    title: "Маркет",
    subtitle: "Маркетплейс, лимиты, передача",
    icon: ShoppingCart,
    color: "bg-indigo-500/10 text-indigo-600",
    count: 8,
  },
  {
    route: "/management/settings/payments",
    title: "Платёжные системы",
    subtitle: "Atmos, карты UzCard/Humo",
    icon: CreditCard,
    color: "bg-rose-500/10 text-rose-600",
    count: 5,
  },
  {
    route: "/management/settings/sms",
    title: "SMS сервис",
    subtitle: "Локальный SMS шлюз",
    icon: MessageSquare,
    color: "bg-teal-500/10 text-teal-600",
    count: 1,
  },
  {
    route: "/management/settings/notifications",
    title: "Уведомления клиента",
    subtitle: "Шаблоны СМС, авто-отмена",
    icon: Bell,
    color: "bg-yellow-500/10 text-yellow-600",
    count: 13,
  },
  {
    route: "/management/settings/blocked-apps",
    title: "Блокировка приложений",
    subtitle: "Запрет конкурентных приложений",
    icon: ShieldBan,
    color: "bg-red-500/10 text-red-600",
    count: 0,
  },
  {
    route: "/management/settings/apk",
    title: "Driver APK",
    subtitle: "Сборка мобильного приложения",
    icon: Smartphone,
    color: "bg-orange-500/10 text-orange-600",
    count: 3,
  },,
  {
    route: "/management/settings/audio",
    title: "Аудио файлы",
    subtitle: "Голосовые подсказки для водителей",
    icon: FileAudio,
    color: "bg-fuchsia-500/10 text-fuchsia-600",
    count: 1,
  }
];

export default function Settings() {
  const [, navigate] = useLocation();

  return (
    <DispatcherLayout>
      <div className="p-6 space-y-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Settings2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Настройки</h2>
            <p className="text-sm text-muted-foreground">Конфигурация платформы</p>
          </div>
        </div>

        <div className="grid gap-3">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.route}
                onClick={() => navigate(cat.route)}
                className="bg-card border border-border rounded-xl p-5 flex items-center gap-4 hover:border-primary/30 hover:shadow-md transition-all group text-left"
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${cat.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{cat.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{cat.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{cat.count}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </DispatcherLayout>
  );
}
