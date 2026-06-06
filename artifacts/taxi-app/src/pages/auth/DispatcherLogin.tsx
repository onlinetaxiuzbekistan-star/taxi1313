import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/core";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL || "";

export default function DispatcherLogin() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login: authLogin } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password.trim()) {
      toast({ variant: "destructive", title: "Ошибка", description: "Введите логин и пароль" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Ошибка", description: data.message || "Неверный логин или пароль" });
        return;
      }
      authLogin(data.token, data.user);
      toast({ title: "Успешный вход", description: `Добро пожаловать, ${data.user.name}!` });
      if (data.user.role === "dispatcher" || data.user.role === "admin") {
        setLocation("/management");
      } else {
        setLocation("/driver");
      }
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети", description: "Попробуйте позже" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md glass-panel">
          <CardHeader className="text-center pb-6">
            <img src={`${BASE_URL}logo-1313.png`} alt="Такси 1313" className="w-20 h-20 rounded-2xl mx-auto mb-3 object-cover" />
            <CardTitle className="text-3xl">Такси 1313</CardTitle>
            <p className="text-muted-foreground mt-2">Панель управления</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label>Логин</Label>
                <Input
                  placeholder="Введите логин"
                  value={login}
                  onChange={e => setLogin(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Пароль</Label>
                <Input
                  type="password"
                  placeholder="Введите пароль"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Вход..." : "Войти"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
