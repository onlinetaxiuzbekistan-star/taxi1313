import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

export function ElapsedTimer({ since }: { since?: string }) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!since) return;
    const start = new Date(since).getTime();
    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(h > 0 ? `${h}ч ${m.toString().padStart(2, "0")}м` : `${m}м ${s.toString().padStart(2, "0")}с`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="w-3.5 h-3.5" />
      <span>В пути: <span className="font-bold text-foreground">{elapsed}</span></span>
    </div>
  );
}

