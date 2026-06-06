import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  MapPin,
  Calendar,
  Users,
  ArrowRight,
  Shield,
  Clock,
  Wallet,
  Star,
  ArrowLeftRight,
} from "lucide-react";
import { getCities, type City } from "@/lib/api";
import Footer from "@/components/Footer";

const CAR_CLASSES = [
  { value: "economy", label: "Эконом" },
  { value: "comfort", label: "Комфорт" },
  { value: "business", label: "Бизнес" },
];

const POPULAR_ROUTES = [
  { from: "Ташкент", to: "Самарканд", price: "от 120 000 сум" },
  { from: "Ташкент", to: "Бухара", price: "от 200 000 сум" },
  { from: "Ташкент", to: "Фергана", price: "от 150 000 сум" },
  { from: "Самарканд", to: "Бухара", price: "от 100 000 сум" },
  { from: "Ташкент", to: "Андижан", price: "от 170 000 сум" },
  { from: "Ташкент", to: "Наманган", price: "от 160 000 сум" },
];

export default function Home() {
  const [, navigate] = useLocation();
  const [cities, setCities] = useState<City[]>([]);
  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 2);
    return d.toISOString().slice(0, 16);
  });
  const [passengers, setPassengers] = useState(1);
  const [carClass, setCarClass] = useState("economy");

  const [citiesError, setCitiesError] = useState(false);

  useEffect(() => {
    getCities()
      .then(setCities)
      .catch(() => setCitiesError(true));
  }, []);

  const cityOptions = useMemo(
    () => cities.filter((c) => c.isActive !== false),
    [cities],
  );

  function swapCities() {
    setFromCity(toCity);
    setToCity(fromCity);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!fromCity || !toCity) return;
    const params = new URLSearchParams({
      from: fromCity,
      to: toCity,
      date,
      passengers: String(passengers),
      carClass,
    });
    navigate(`/search?${params}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <section className="relative hero-gradient pt-24 pb-32 md:pt-32 md:pb-40 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-72 h-72 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-20 w-96 h-96 bg-white rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4">
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 leading-tight">
              Межгородские поездки
              <br />
              по Узбекистану
            </h1>
            <p className="text-lg md:text-xl text-white/80 max-w-2xl mx-auto">
              Комфортные и безопасные поездки между городами. Бронируйте за
              минуту, путешествуйте с удовольствием.
            </p>
          </div>

          <form
            onSubmit={handleSearch}
            className="bg-white rounded-2xl shadow-2xl p-4 md:p-6 max-w-4xl mx-auto"
          >
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4">
              <div className="md:col-span-3 relative">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Откуда
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                  <select
                    value={fromCity}
                    onChange={(e) => setFromCity(e.target.value)}
                    required
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-muted/30 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">Выберите город</option>
                    {cityOptions.map((c) => (
                      <option key={c.id} value={c.nameRu}>
                        {c.nameRu}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="md:col-span-1 flex items-end justify-center pb-1">
                <button
                  type="button"
                  onClick={swapCities}
                  className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-primary"
                >
                  <ArrowLeftRight className="w-5 h-5" />
                </button>
              </div>

              <div className="md:col-span-3">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Куда
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                  <select
                    value={toCity}
                    onChange={(e) => setToCity(e.target.value)}
                    required
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-muted/30 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">Выберите город</option>
                    {cityOptions.map((c) => (
                      <option key={c.id} value={c.nameRu}>
                        {c.nameRu}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Когда
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="datetime-local"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              </div>

              <div className="md:col-span-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Пассажиры
                </label>
                <div className="relative">
                  <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <select
                    value={passengers}
                    onChange={(e) => setPassengers(Number(e.target.value))}
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-border bg-muted/30 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="md:col-span-2 flex items-end">
                <button
                  type="submit"
                  className="w-full py-3 px-6 rounded-xl hero-gradient text-white font-semibold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  Найти
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              {CAR_CLASSES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCarClass(c.value)}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                    carClass === c.value
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </form>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">
            Почему выбирают Такси 1313
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-xl mx-auto">
            Мы делаем межгородские поездки удобными и безопасными
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              {
                icon: Shield,
                title: "Безопасность",
                desc: "Проверенные водители и застрахованные поездки",
                color: "text-blue-500 bg-blue-50",
              },
              {
                icon: Clock,
                title: "Пунктуальность",
                desc: "Водитель приедет точно в назначенное время",
                color: "text-emerald-500 bg-emerald-50",
              },
              {
                icon: Wallet,
                title: "Фиксированная цена",
                desc: "Цена поездки известна заранее и не меняется",
                color: "text-amber-500 bg-amber-50",
              },
              {
                icon: Star,
                title: "Комфорт",
                desc: "Выбирайте класс автомобиля под ваши потребности",
                color: "text-purple-500 bg-purple-50",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="text-center p-6 rounded-2xl hover:shadow-lg transition-shadow border border-border/50"
              >
                <div
                  className={`w-14 h-14 rounded-xl ${item.color} flex items-center justify-center mx-auto mb-4`}
                >
                  <item.icon className="w-7 h-7" />
                </div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-muted/30">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">
            Популярные маршруты
          </h2>
          <p className="text-muted-foreground text-center mb-12">
            Самые востребованные направления
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {POPULAR_ROUTES.map((route) => (
              <button
                key={`${route.from}-${route.to}`}
                onClick={() => {
                  setFromCity(route.from);
                  setToCity(route.to);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="flex items-center justify-between p-4 bg-white rounded-xl border border-border/50 hover:shadow-md hover:border-primary/30 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    <span>{route.from}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{route.to}</span>
                  </div>
                </div>
                <span className="text-xs text-primary font-medium whitespace-nowrap ml-2">
                  {route.price}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">
            Как это работает
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "Выберите маршрут",
                desc: "Укажите откуда и куда хотите поехать, выберите дату и количество пассажиров",
              },
              {
                step: "2",
                title: "Забронируйте поездку",
                desc: "Подтвердите бронирование. Мы найдём для вас подходящего водителя",
              },
              {
                step: "3",
                title: "Путешествуйте",
                desc: "Водитель приедет в назначенное время. Наслаждайтесь поездкой!",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-16 h-16 rounded-full hero-gradient text-white text-2xl font-bold flex items-center justify-center mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
