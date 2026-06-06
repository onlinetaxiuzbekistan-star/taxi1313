import { useState, useEffect, useRef, useCallback } from "react";
import { User, Check, Car } from "lucide-react";

const SEAT_LABELS: Record<number, string> = {
  1: "Перед",
  2: "Зад лев.",
  3: "Зад центр.",
  4: "Зад прав.",
};

const SEAT_SHORT: Record<number, string> = {
  1: "П",
  2: "ЗЛ",
  3: "ЗЦ",
  4: "ЗП",
};

interface SeatSelectorProps {
  selectedSeats: number[];
  onToggleSeat: (seatNum: number) => void;
  wholeCar?: boolean;
  onToggleWholeCar?: () => void;
  showWholeCarToggle?: boolean;
  occupiedSeats?: number[];
  occupiedNames?: Record<number, string>;
  seatGenders?: Record<number, "male" | "female" | string>;
  maxSeats?: number;
  compact?: boolean;
}

const audioCtxRef = { current: null as AudioContext | null };

function getAudioCtx(): AudioContext {
  if (!audioCtxRef.current) {
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtxRef.current;
}

function playClick(freq: number = 800, duration: number = 0.06, vol: number = 0.15) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

function playSelect() { playClick(1200, 0.07, 0.12); }
function playDeselect() { playClick(600, 0.05, 0.08); }

function playFullCar() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, t + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.15);
    });
  } catch {}
}

export default function SeatSelector({
  selectedSeats,
  onToggleSeat,
  wholeCar = false,
  onToggleWholeCar,
  showWholeCarToggle = false,
  occupiedSeats = [],
  occupiedNames = {},
  seatGenders = {},
  maxSeats = 4,
  compact = false,
}: SeatSelectorProps) {
  const [animating, setAnimating] = useState<Record<number, "in" | "out">>({});
  const [ripple, setRipple] = useState<{ seat: number; x: number; y: number } | null>(null);
  const [wasFull, setWasFull] = useState(false);
  const debounceRef = useRef<number>(0);
  const seatRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const isFull = selectedSeats.length >= maxSeats;

  useEffect(() => {
    if (isFull && !wasFull) {
      playFullCar();
      setWasFull(true);
    } else if (!isFull) {
      setWasFull(false);
    }
  }, [isFull, wasFull]);

  const handleSeatClick = useCallback((seatNum: number, e: React.MouseEvent<HTMLButtonElement>) => {
    if (wholeCar) return;
    if (occupiedSeats.includes(seatNum)) return;

    const now = Date.now();
    if (now - debounceRef.current < 150) return;
    debounceRef.current = now;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setRipple({ seat: seatNum, x, y });
    setTimeout(() => setRipple(null), 500);

    const isSelected = selectedSeats.includes(seatNum);
    if (isSelected) {
      playDeselect();
      setAnimating(prev => ({ ...prev, [seatNum]: "out" }));
    } else {
      playSelect();
      setAnimating(prev => ({ ...prev, [seatNum]: "in" }));
    }

    setTimeout(() => {
      setAnimating(prev => {
        const next = { ...prev };
        delete next[seatNum];
        return next;
      });
    }, 300);

    onToggleSeat(seatNum);
  }, [wholeCar, occupiedSeats, selectedSeats, onToggleSeat]);

  const handleWholeCarClick = useCallback(() => {
    if (!onToggleWholeCar) return;
    if (!wholeCar) { playSelect(); } else { playDeselect(); }
    onToggleWholeCar();
  }, [wholeCar, onToggleWholeCar]);

  const getSeatState = (n: number): "free" | "selected" | "occupied" => {
    if (occupiedSeats.includes(n)) return "occupied";
    if (selectedSeats.includes(n)) return "selected";
    return "free";
  };

  const seatStyle = (n: number): string => {
    const state = getSeatState(n);
    const anim = animating[n];

    let base = "relative overflow-hidden transition-all duration-200 ease-out rounded-2xl font-bold cursor-pointer select-none ";

    if (compact) {
      base += "py-3 ";
    } else {
      base += "py-4 ";
    }

    if (state === "occupied") {
      return base + "bg-gradient-to-b from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/25 border-2 border-emerald-400 cursor-default";
    }
    if (state === "selected") {
      const g = seatGenders[n];
      let cls = base;
      if (g === "female") {
        cls += "bg-gradient-to-b from-pink-400 to-pink-600 text-white border-2 border-pink-500 shadow-lg shadow-pink-500/30 ";
      } else if (g === "male") {
        cls += "bg-gradient-to-b from-sky-400 to-blue-600 text-white border-2 border-blue-500 shadow-lg shadow-blue-500/30 ";
      } else {
        cls += "bg-gradient-to-b from-zinc-500 to-zinc-700 text-white border-2 border-zinc-500 shadow-lg shadow-zinc-500/30 ";
      }
      if (anim === "in") { cls += "animate-seat-pop "; }
      return cls;
    }
    let cls = base + "bg-gradient-to-b from-slate-100 to-slate-200 text-muted-foreground border-2 border-border ";
    cls += "shadow-md shadow-sm hover:brightness-105 hover:border-zinc-400 hover:shadow-zinc-200/30 ";
    if (anim === "out") { cls += "animate-seat-shrink "; }
    if (wholeCar) { cls += "opacity-50 cursor-default "; }
    return cls;
  };

  const renderSeatContent = (n: number) => {
    const state = getSeatState(n);
    const anim = animating[n];
    const name = occupiedNames[n];

    return (
      <>
        {ripple?.seat === n && (
          <span
            className="absolute rounded-full bg-foreground/30 animate-ripple pointer-events-none"
            style={{ left: ripple.x - 20, top: ripple.y - 20, width: 40, height: 40 }}
          />
        )}
        <div className={`flex flex-col items-center gap-0.5 transition-all duration-200 ${
          state === "selected" && anim === "in" ? "animate-person-in" :
          state === "free" && anim === "out" ? "animate-person-out" : ""
        }`}>
          {state === "occupied" ? (
            <>
              <div className="w-7 h-7 rounded-full bg-foreground/20 flex items-center justify-center mb-0.5">
                {name ? (
                  <span className="text-[10px] font-extrabold">{name.slice(0, 2).toUpperCase()}</span>
                ) : (
                  <User className="w-4 h-4" />
                )}
              </div>
              {!compact && <span className="text-[10px] leading-tight">{SEAT_LABELS[n]}</span>}
            </>
          ) : state === "selected" ? (
            <>
              <div className="w-7 h-7 rounded-full bg-foreground/20 flex items-center justify-center mb-0.5">
                <Check className="w-4 h-4" />
              </div>
              {!compact && <span className="text-[10px] leading-tight">{SEAT_LABELS[n]}</span>}
              {compact && <span className="text-xs">{SEAT_SHORT[n]}</span>}
            </>
          ) : (
            <>
              <div className="w-7 h-7 rounded-full bg-muted-foreground/40 flex items-center justify-center mb-0.5">
                <span className="text-xs font-bold">{n}</span>
              </div>
              {!compact && <span className="text-[10px] leading-tight">{SEAT_LABELS[n]}</span>}
              {compact && <span className="text-xs">{SEAT_SHORT[n]}</span>}
            </>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-2.5">
      <style>{`
        @keyframes seat-pop {
          0% { transform: scale(1); }
          40% { transform: scale(1.12); }
          70% { transform: scale(0.97); }
          100% { transform: scale(1); }
        }
        @keyframes seat-shrink {
          0% { transform: scale(1); }
          50% { transform: scale(0.93); }
          100% { transform: scale(1); }
        }
        @keyframes person-in {
          0% { opacity: 0; transform: scale(0.5); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes person-out {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.6; transform: scale(0.85); }
        }
        @keyframes ripple-expand {
          0% { transform: scale(0); opacity: 0.6; }
          100% { transform: scale(3); opacity: 0; }
        }
        @keyframes full-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
          50% { box-shadow: 0 0 20px 4px rgba(59,130,246,0.25); }
        }
        .animate-seat-pop { animation: seat-pop 0.28s ease-out; }
        .animate-seat-shrink { animation: seat-shrink 0.2s ease-out; }
        .animate-person-in { animation: person-in 0.22s ease-out; }
        .animate-person-out { animation: person-out 0.18s ease-out; }
        .animate-ripple { animation: ripple-expand 0.45s ease-out forwards; }
        .animate-full-glow { animation: full-glow 1.5s ease-in-out 2; }
      `}</style>

      <div className={`rounded-2xl p-3 transition-all duration-500 ${
        isFull ? "animate-full-glow bg-zinc-100 border border-zinc-200" : ""
      }`}>
        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center mb-1.5">ПЕРЕД</div>
        <div className="flex justify-center mb-2.5" style={{ perspective: "400px" }}>
          <div className="w-1/2">
            <button
              ref={el => { seatRefs.current[1] = el; }}
              onClick={(e) => handleSeatClick(1, e)}
              className={seatStyle(1) + " w-full"}
              style={{ transformStyle: "preserve-3d", transform: "rotateX(2deg)" }}
              disabled={occupiedSeats.includes(1)}
            >
              {renderSeatContent(1)}
            </button>
          </div>
        </div>
        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest text-center mb-1.5">ЗАД</div>
        <div className="grid grid-cols-3 gap-2" style={{ perspective: "400px" }}>
          {[2, 3, 4].map(n => (
            <button
              key={n}
              ref={el => { seatRefs.current[n] = el; }}
              onClick={(e) => handleSeatClick(n, e)}
              className={seatStyle(n)}
              style={{ transformStyle: "preserve-3d", transform: "rotateX(2deg)" }}
              disabled={occupiedSeats.includes(n)}
            >
              {renderSeatContent(n)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <p className={`text-xs font-bold ${isFull ? "text-zinc-700" : "text-muted-foreground"}`}>
          {isFull ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
              Машина заполнена
            </span>
          ) : (
            `${selectedSeats.length + occupiedSeats.filter(s => !selectedSeats.includes(s)).length} / ${maxSeats} занято`
          )}
        </p>
      </div>

      {showWholeCarToggle && onToggleWholeCar && (
        <button
          onClick={handleWholeCarClick}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
            wholeCar
              ? "bg-gradient-to-r from-amber-400 to-amber-500 text-white border-amber-400 shadow-lg shadow-amber-500/20"
              : "bg-card text-foreground border-border hover:border-amber-300"
          }`}
        >
          {wholeCar ? <Check className="w-4 h-4" /> : <Car className="w-4 h-4" />}
          Вся машина
        </button>
      )}
    </div>
  );
}
