import { useState, useEffect, useRef, useCallback } from "react";
import { Clock, Users, Phone, ChevronDown, Zap, TrendingUp } from "lucide-react";
import type { QueueInfoData } from "../types";
import { BASE_URL } from "../constants";

export function QueueWidget({ queueInfo }: {
  queueInfo: QueueInfoData | null;
  filledSeats?: number;
  since?: string;
  totalSeats?: number;
}) {
  const [animatePos, setAnimatePos] = useState(false);
  const prevQPos = useRef<number | null>(null);

  useEffect(() => {
    if (!queueInfo) return;
    if (prevQPos.current !== null && queueInfo.position < prevQPos.current) {
      setAnimatePos(true);
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch {}
      setTimeout(() => setAnimatePos(false), 1500);
    }
    prevQPos.current = queueInfo.position;
  }, [queueInfo?.position]);

  const pos = queueInfo?.position ?? 0;
  const total = queueInfo?.total ?? 0;
  const avgMin = queueInfo?.avgWaitMinutes ?? 0;
  const progressPct = total > 1 ? Math.round(((total - pos) / (total - 1)) * 100) : (pos === 1 ? 100 : 0);
  const isFirst = pos === 1;
  const boost = queueInfo?.priorityBoost ?? 0;
  const hint = queueInfo?.hint ?? "";

  return (
    <div className="px-4 space-y-3">
      {queueInfo && total > 0 && (
        <div className={`rounded-2xl border p-4 space-y-3 transition-all duration-500 ${
          animatePos
            ? "bg-primary/10 border-primary/30 scale-[1.02]"
            : isFirst
              ? "bg-muted border-border"
              : "bg-card border-border"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isFirst ? (
                <Zap className="w-4 h-4 text-primary" />
              ) : (
                <Users className="w-4 h-4 text-primary" />
              )}
              <p className={`text-sm font-bold text-foreground transition-all duration-300 ${animatePos ? "scale-110 text-primary" : ""}`}>
                {isFirst ? "Вы первый в очереди!" : `Очередь: ${pos} из ${total}`}
              </p>
              {boost > 0 && (
                <span className="text-[12px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5 rounded-full">
                  +{boost} приоритет
                </span>
              )}
            </div>
            {!isFirst && avgMin > 0 && (
              <span className="text-[13px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                ~{avgMin} мин
              </span>
            )}
          </div>

          {!isFirst && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                <span>Прогресс очереди</span>
                <span className="font-bold text-foreground">{progressPct}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-900 rounded-full transition-all duration-700"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {isFirst && (
            <div className="flex items-center gap-2 text-xs text-primary">
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="font-medium">Следующий заказ — ваш. Диспетчер видит вас первым.</span>
            </div>
          )}

          {!isFirst && pos <= 3 && pos > 1 && (
            <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="font-medium">Почти ваша очередь! Осталось {pos - 1} {pos - 1 === 1 ? "водитель" : "водителя"} впереди.</span>
            </div>
          )}

          {hint === "long_queue" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
              <TrendingUp className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-medium">Долгая очередь — попробуйте повысить цену для приоритета</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

