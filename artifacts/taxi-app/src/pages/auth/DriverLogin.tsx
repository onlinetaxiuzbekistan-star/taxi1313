
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

const BASE_URL = import.meta.env.BASE_URL || "";

export default function DriverLogin() {
  const [mode, setMode] = useState<"choose" | "phone" | "code">("choose");
  const [phone, setPhone] = useState("+998");
  const [smsCode, setSmsCode] = useState("");
  const [directCode, setDirectCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const directCodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (mode === "phone" && !smsSent) phoneRef.current?.focus();
    if (mode === "phone" && smsSent) codeRef.current?.focus();
    if (mode === "code") directCodeRef.current?.focus();
  }, [mode, smsSent]);

  const phoneDisplay = phone.length > 4
    ? "+998 " + phone.slice(4).replace(/(\d{2})(\d{3})?(\d{2})?(\d{2})?/, (_, a, b, c, d) =>
        [a, b, c, d].filter(Boolean).join(" "))
    : phone;

  const handlePhoneInput = (val: string) => {
    const digits = val.replace(/[^\d]/g, "");
    if (digits.length <= 3) {
      setPhone("+998");
    } else {
      setPhone("+998" + digits.slice(3, 12));
    }
  };

  const phoneComplete = phone.replace(/\D/g, "").length >= 12;

  const handleSendSms = async () => {
    if (!phoneComplete) {
      toast.error("Введите полный номер телефона");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}api/auth/driver-code/send-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Не удалось отправить код");
        return;
      }
      toast.success("Код отправлен по SMS");
      setSmsSent(true);
      setCountdown(60);
    } catch {
      toast.error("Ошибка сети");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySms = async () => {
    if (!smsCode.trim()) {
      toast.error("Введите код из SMS");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}api/auth/driver-code/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone, code: smsCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Неверный код");
        return;
      }
      login(data.token, data.user);
      toast.success(`Добро пожаловать, ${data.user.name}!`);
      setLocation("/driver");
    } catch {
      toast.error("Ошибка сети");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyDirect = async () => {
    if (directCode.length < 6) {
      toast.error("Введите 6-значный код");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}api/auth/driver-code/verify-code-only`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: directCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Неверный код");
        return;
      }
      login(data.token, data.user);
      toast.success(`Добро пожаловать, ${data.user.name}!`);
      setLocation("/driver");
    } catch {
      toast.error("Ошибка сети");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <img src={`${BASE_URL}logo-1313.png`} alt="Такси 1313" className="w-24 h-24 rounded-3xl mb-4 object-cover shadow-2xl" />
        <h1 className="text-3xl font-black text-white mb-1">Такси 1313</h1>
        <p className="text-gray-400 text-sm mb-8">Водитель</p>

        {mode === "choose" && (
          <div className="w-full max-w-sm space-y-4">
            <button
              onClick={() => setMode("phone")}
              className="w-full py-4 rounded-2xl bg-[#f5c518] text-[#1a1a2e] font-extrabold text-base shadow-lg shadow-[#f5c518]/30 active:scale-[0.97] transition-transform flex items-center justify-center gap-3"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Вход через телефон
            </button>

            <button
              onClick={() => setMode("code")}
              className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-base border border-white/20 active:scale-[0.97] transition-transform flex items-center justify-center gap-3"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Вход через код
            </button>
          </div>
        )}

        {mode === "phone" && !smsSent && (
          <div className="w-full max-w-sm space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Номер телефона</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                  <span className="text-lg">🇺🇿</span>
                </div>
                <input
                  ref={phoneRef}
                  type="tel"
                  value={phoneDisplay}
                  onChange={e => handlePhoneInput(e.target.value)}
                  className="w-full pl-14 pr-4 py-4 rounded-2xl bg-white/10 text-white text-lg font-semibold border border-white/20 outline-none focus:border-[#f5c518] transition-colors placeholder-gray-500"
                  placeholder="+998 90 123 45 67"
                  maxLength={17}
                />
                {phoneComplete && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={handleSendSms}
              disabled={loading || !phoneComplete}
              className="w-full py-4 rounded-2xl bg-[#f5c518] text-[#1a1a2e] font-extrabold text-base shadow-lg shadow-[#f5c518]/30 active:scale-[0.97] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : null}
              {loading ? "Отправка..." : "Получить код по SMS"}
            </button>

            <button
              onClick={() => setMode("choose")}
              className="w-full py-3 text-gray-400 text-sm font-medium active:text-white transition-colors"
            >
              ← Назад
            </button>
          </div>
        )}

        {mode === "phone" && smsSent && (
          <div className="w-full max-w-sm space-y-5">
            <p className="text-center text-gray-300 text-sm">
              Код отправлен на <span className="text-white font-bold">{phoneDisplay}</span>
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Код из SMS</label>
              <input
                ref={codeRef}
                type="text"
                inputMode="numeric"
                value={smsCode}
                onChange={e => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full px-4 py-4 rounded-2xl bg-white/10 text-white text-center text-2xl font-bold tracking-[0.5em] border border-white/20 outline-none focus:border-[#f5c518] transition-colors placeholder-gray-500"
                placeholder="• • • • • •"
                maxLength={6}
              />
            </div>

            <button
              onClick={handleVerifySms}
              disabled={loading || smsCode.length < 6}
              className="w-full py-4 rounded-2xl bg-[#f5c518] text-[#1a1a2e] font-extrabold text-base shadow-lg shadow-[#f5c518]/30 active:scale-[0.97] transition-transform disabled:opacity-50"
            >
              {loading ? "Проверка..." : "Войти"}
            </button>

            <div className="flex items-center justify-between">
              <button
                onClick={() => { setSmsSent(false); setSmsCode(""); }}
                className="text-gray-400 text-sm font-medium active:text-white transition-colors"
              >
                ← Изменить номер
              </button>
              {countdown > 0 ? (
                <span className="text-gray-500 text-sm">{countdown} сек</span>
              ) : (
                <button
                  onClick={handleSendSms}
                  disabled={loading}
                  className="text-[#f5c518] text-sm font-bold active:opacity-70 transition-opacity"
                >
                  Отправить снова
                </button>
              )}
            </div>
          </div>
        )}

        {mode === "code" && (
          <div className="w-full max-w-sm space-y-5">
            <p className="text-center text-gray-300 text-sm">
              Введите 6-значный код от диспетчера
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Код входа</label>
              <input
                ref={directCodeRef}
                type="text"
                inputMode="numeric"
                value={directCode}
                onChange={e => setDirectCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full px-4 py-4 rounded-2xl bg-white/10 text-white text-center text-2xl font-bold tracking-[0.5em] border border-white/20 outline-none focus:border-[#f5c518] transition-colors placeholder-gray-500"
                placeholder="• • • • • •"
                maxLength={6}
              />
            </div>

            <button
              onClick={handleVerifyDirect}
              disabled={loading || directCode.length < 6}
              className="w-full py-4 rounded-2xl bg-[#f5c518] text-[#1a1a2e] font-extrabold text-base shadow-lg shadow-[#f5c518]/30 active:scale-[0.97] transition-transform disabled:opacity-50"
            >
              {loading ? "Проверка..." : "Войти"}
            </button>

            <button
              onClick={() => { setMode("choose"); setDirectCode(""); }}
              className="w-full py-3 text-gray-400 text-sm font-medium active:text-white transition-colors"
            >
              ← Назад
            </button>
          </div>
        )}
      </div>

      <div className="pb-6 text-center">
        <p className="text-gray-600 text-xs">BuxTaxi © 2025</p>
      </div>
    </div>
  );
}
