import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useRegisterUser } from "@workspace/api-client-react";
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/core";
import { useToast } from "@/hooks/use-toast";
import { Navbar } from "@/components/layout/Navbar";

export default function Register() {
  const [formData, setFormData] = useState({
    name: "", phone: "", password: "", role: "rider" as any, carModel: "", carNumber: "", carClass: "economy" as any, referralCode: ""
  });
  
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { mutate, isPending } = useRegisterUser({
    mutation: {
      onSuccess: (data) => {
        login(data.token, data.user);
        toast({ title: "Регистрация успешна!" });
        if (data.user.role === 'driver') setLocation("/driver");
        else setLocation("/");
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Ошибка", description: err.message || "Не удалось зарегистрироваться" });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutate({ data: formData });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center p-4 pt-20">
        <Card className="w-full max-w-md glass-panel">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Создать аккаунт</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-2 p-1 bg-secondary rounded-xl">
                <button type="button" 
                  onClick={() => setFormData(p => ({...p, role: "rider"}))}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${formData.role === 'rider' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-white'}`}>
                  Пассажир
                </button>
                <button type="button"
                  onClick={() => setFormData(p => ({...p, role: "driver"}))}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${formData.role === 'driver' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-white'}`}>
                  Водитель
                </button>
              </div>

              <div className="space-y-2">
                <Label>Имя</Label>
                <Input value={formData.name} onChange={e => setFormData(p => ({...p, name: e.target.value}))} required />
              </div>
              <div className="space-y-2">
                <Label>Телефон</Label>
                <Input value={formData.phone} onChange={e => setFormData(p => ({...p, phone: e.target.value}))} placeholder="+998" required />
              </div>
              <div className="space-y-2">
                <Label>Пароль</Label>
                <Input type="password" value={formData.password} onChange={e => setFormData(p => ({...p, password: e.target.value}))} required />
              </div>

              {formData.role === 'driver' && (
                <div className="space-y-4 pt-4 border-t border-border">
                  <div className="space-y-2">
                    <Label>Модель авто</Label>
                    <Input value={formData.carModel} onChange={e => setFormData(p => ({...p, carModel: e.target.value}))} placeholder="Chevrolet Cobalt" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Гос. номер</Label>
                    <Input value={formData.carNumber} onChange={e => setFormData(p => ({...p, carNumber: e.target.value}))} placeholder="01 A 123 AA" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Класс авто</Label>
                    <select 
                      className="flex h-12 w-full rounded-xl border-2 border-border bg-card/50 px-4 py-2 text-sm text-foreground focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none"
                      value={formData.carClass} 
                      onChange={e => setFormData(p => ({...p, carClass: e.target.value as any}))}
                    >
                      <option value="economy">Эконом</option>
                      <option value="comfort">Комфорт</option>
                      <option value="business">Бизнес</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Реферальный код <span className="text-muted-foreground font-normal">(необязательно)</span></Label>
                    <Input value={formData.referralCode} onChange={e => setFormData(p => ({...p, referralCode: e.target.value.toUpperCase()}))} placeholder="BUX-XXXXXX" />
                    <p className="text-xs text-muted-foreground">Получите 20 000 сум бонус при регистрации по реферальному коду</p>
                  </div>
                </div>
              )}

              <Button type="submit" className="w-full mt-4" disabled={isPending}>
                {isPending ? "Регистрация..." : "Зарегистрироваться"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
