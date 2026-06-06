import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGetCities, useEstimateRidePrice, useCreateRide } from "@workspace/api-client-react";
import { Button, Input, Label, Card, CardContent } from "@/components/ui/core";
import { Navbar } from "@/components/layout/Navbar";
import { formatCurrency } from "@/lib/utils";
import { MapPin, Users, Calendar, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const { user, token } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: citiesData } = useGetCities({ request: { headers: { Authorization: `Bearer ${token}` } }});
  const cities = citiesData?.cities || [];

  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");
  const [date, setDate] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [carClass, setCarClass] = useState<"economy" | "comfort" | "business">("economy");

  const { mutate: estimate, data: estimateResult } = useEstimateRidePrice();
  const { mutate: bookRide, isPending: isBooking } = useCreateRide();

  useEffect(() => {
    if (fromCity && toCity && fromCity !== toCity) {
      estimate({
        data: { fromCity, toCity, passengers, carClass },
      }, {
        request: { headers: { Authorization: `Bearer ${token}` } }
      });
    }
  }, [fromCity, toCity, passengers, carClass, estimate, token]);

  const handleBook = () => {
    if (!user) {
      toast({ title: "Требуется авторизация", description: "Пожалуйста, войдите в систему для бронирования." });
      setLocation("/login");
      return;
    }
    
    bookRide({
      data: {
        fromCity, toCity, scheduledAt: new Date(date).toISOString(), passengers, carClass, price: estimateResult?.price
      }
    }, {
      request: { headers: { Authorization: `Bearer ${token}` } },
      onSuccess: () => {
        toast({ title: "Поездка забронирована!" });
        // Normally redirect to ride status page
        setLocation("/my-rides"); // Mocked redirect
      },
      onError: () => toast({ variant: "destructive", title: "Ошибка", description: "Не удалось забронировать" })
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Hero Section */}
      <div className="relative pt-20 pb-32 lg:pt-48 lg:pb-64 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
            alt="Hero background" 
            className="w-full h-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/60 to-background" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            
            <div>
              <h1 className="text-5xl lg:text-7xl font-display font-bold leading-tight mb-6">
                Межгород с комфортом.<br/>
                <span className="text-gradient">Без переплат.</span>
              </h1>
              <p className="text-lg text-muted-foreground mb-8 max-w-lg">
                Бронируйте поездки по всему Узбекистану. Выбирайте класс авто, время и наслаждайтесь путешествием.
              </p>
            </div>

            <Card className="glass-panel border-border shadow-2xl shadow-primary/10">
              <CardContent className="p-8">
                <h3 className="text-2xl font-display font-bold mb-6">Заказать такси</h3>
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Откуда</Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                        <select 
                          className="flex h-12 w-full rounded-xl border-2 border-border bg-card/50 pl-10 pr-4 py-2 text-sm text-foreground focus:border-primary outline-none appearance-none"
                          value={fromCity} onChange={(e) => setFromCity(e.target.value)}
                        >
                          <option value="" disabled>Выберите город</option>
                          {cities.map(c => <option key={c.id} value={c.nameRu}>{c.nameRu}</option>)}
                          {!cities.length && <option value="Бухара">Бухара</option>}
                          {!cities.length && <option value="Ташкент">Ташкент</option>}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Куда</Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-3 w-5 h-5 text-primary" />
                        <select 
                          className="flex h-12 w-full rounded-xl border-2 border-border bg-card/50 pl-10 pr-4 py-2 text-sm text-foreground focus:border-primary outline-none appearance-none"
                          value={toCity} onChange={(e) => setToCity(e.target.value)}
                        >
                          <option value="" disabled>Выберите город</option>
                          {cities.map(c => <option key={c.id} value={c.nameRu}>{c.nameRu}</option>)}
                          {!cities.length && <option value="Ташкент">Ташкент</option>}
                          {!cities.length && <option value="Самарканд">Самарканд</option>}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Дата и время</Label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                        <Input type="datetime-local" className="pl-10" value={date} onChange={e => setDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Пассажиры</Label>
                      <div className="relative">
                        <Users className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                        <select 
                          className="flex h-12 w-full rounded-xl border-2 border-border bg-card/50 pl-10 pr-4 py-2 text-sm text-foreground focus:border-primary outline-none appearance-none"
                          value={passengers} onChange={(e) => setPassengers(Number(e.target.value))}
                        >
                          {[1,2,3,4].map(n => <option key={n} value={n}>{n} чел.</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <Label>Класс авто</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'economy', label: 'Эконом' },
                        { id: 'comfort', label: 'Комфорт' },
                        { id: 'business', label: 'Бизнес' }
                      ].map(cls => (
                        <button
                          key={cls.id}
                          onClick={() => setCarClass(cls.id as any)}
                          className={`py-3 px-2 rounded-xl text-sm font-medium border-2 transition-all ${carClass === cls.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-border text-muted-foreground'}`}
                        >
                          {cls.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {estimateResult && (
                    <div className="mt-6 p-4 rounded-xl bg-secondary/50 border border-border animate-in fade-in slide-in-from-bottom-2">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-muted-foreground">Примерная стоимость:</span>
                        <span className="text-2xl font-bold text-primary">{formatCurrency(estimateResult.price)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex justify-between">
                        <span>Расстояние: ~{estimateResult.distance} км</span>
                        <span>Время: ~{Math.floor(estimateResult.duration / 60)} ч.</span>
                      </div>
                    </div>
                  )}

                  <Button 
                    className="w-full h-14 text-lg mt-6" 
                    onClick={handleBook}
                    disabled={!fromCity || !toCity || !date || isBooking}
                  >
                    {isBooking ? "Оформление..." : "Забронировать поездку"}
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
