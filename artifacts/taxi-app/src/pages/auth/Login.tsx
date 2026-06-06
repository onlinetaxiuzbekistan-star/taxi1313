import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/core";
import { useToast } from "@/hooks/use-toast";

const BASE_URL = import.meta.env.BASE_URL || "";

function getDeviceId(): string {
  let id = localStorage.getItem("buxtaxi_device_id");
  if (!id) {
    id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
    localStorage.setItem("buxtaxi_device_id", id);
  }
  return id;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad/i.test(ua)) return "iOS";
  if (/macintosh/i.test(ua)) return "macOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  return "Browser";
}

export default function Login() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [rateLimited, setRateLimited] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const autoSubmitRef = useRef(false);
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const sessionExpired = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("session_expired") === "1";

  useEffect(() => {
    if (codeSent && codeInputRef.current) {
      setTimeout(() => codeInputRef.current?.focus(), 100);
    }
  }, [codeSent]);

  const doVerify = useCallback(async (codeValue: string) => {
    if (verifying || codeValue.length < 6) return;
    setVerifying(true);
    try {
      const res = await fetch(`${BASE_URL}api/auth/driver-code/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          code: codeValue,
          deviceId: getDeviceId(),
          deviceName: getDeviceName(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          const wait = data.retryAfter || 60;
          setRateLimited(wait);
          const iv = setInterval(() => {
            setRateLimited((p) => { if (p <= 1) { clearInterval(iv); return 0; } return p - 1; });
          }, 1000);
        }
        toast({
          variant: "destructive",
          title: "Ошибка",
          description: data.message || "Неверный код",
        });
        setCode("");
        return;
      }
      if (data.sessionToken) localStorage.setItem("sessionToken", data.sessionToken);
      login(data.token, data.user);
      toast({ title: "Успешный вход", description: `Добро пожаловать, ${data.user.name}!` });
      setLocation("/driver");
    } catch {
      toast({ variant: "destructive", title: "Ошибка сети", description: "Попробуйте позже" });
    } finally { setVerifying(false); }
  }, [phone, verifying, login, setLocation, toast]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newCode = e.target.value.replace(/\D/g, "").slice(0, 6);
    setCode(newCode);
    if (newCode.length === 6 && !autoSubmitRef.current) {
      autoSubmitRef.current = true;
      setTimeout(() => {
        doVerify(newCode);
        autoSubmitRef.current = false;
      }, 150);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    doVerify(code);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md glass-panel">
          <CardHeader className="text-center pb-6">
            <img src={`${BASE_URL}logo-1313.png`} alt="Такси 1313" className="w-20 h-20 rounded-2xl mx-auto mb-3 object-cover" />
            <CardTitle className="text-3xl">Такси 1313</CardTitle>
            <p className="text-muted-foreground mt-2">Межгород — вход для водителей</p>
          </CardHeader>
          <CardContent>
            {sessionExpired && (
              <div className="mb-4 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-sm text-orange-700 text-center">
                Сессия завершена. Был выполнен вход с другого устройства.
              </div>
            )}

            {rateLimited > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-700 text-center">
                Превышен лимит попыток. Повторите через {rateLimited} сек.
              </div>
            )}

            <form onSubmit={handleVerifyCode} className="space-y-5">
              <div className="space-y-2">
                <Label>Номер телефона</Label>
                <Input
                  placeholder="+998 90 123 45 67"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  disabled={codeSent}
                />
              </div>
              {!codeSent ? (
                <div className="space-y-3">
                  <p className="text-xs text-center text-muted-foreground">
                    Введите номер и код, полученный от диспетчера
                  </p>
                  <Button type="button" className="w-full" onClick={() => { if (!phone.trim()) { toast({ variant: "destructive", title: "Ошибка", description: "Введите номер телефона" }); return; } setCodeSent(true); }}>
                    У меня есть код
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Код входа</Label>
                    <Input
                      ref={codeInputRef}
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={code}
                      onChange={handleCodeChange}
                      required
                      className="text-center text-xl tracking-[0.3em] font-mono"
                      autoFocus
                      autoComplete="one-time-code"
                      disabled={verifying}
                    />
                    <p className="text-xs text-muted-foreground text-center">
                      {verifying ? "Проверка кода..." : "Введите 6-значный код — вход выполнится автоматически"}
                    </p>
                  </div>
                  {code.length < 6 && (
                    <Button type="submit" className="w-full" disabled={verifying || code.length < 6}>
                      {verifying ? "Проверка..." : "Войти по коду"}
                    </Button>
                  )}
                  <button type="button" onClick={() => { setCodeSent(false); setCode(""); }}
                    className="w-full text-xs text-primary hover:underline text-center">
                    Изменить номер
                  </button>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
