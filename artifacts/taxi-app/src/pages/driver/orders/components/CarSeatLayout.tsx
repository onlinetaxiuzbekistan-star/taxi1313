import { CheckCircle } from "lucide-react";
import type { SeatPassenger } from "../types";
import { PassengerAvatar } from "./PassengerAvatar";

interface Props {
  passengers: SeatPassenger[];
  onSeatClick: (seatNum: number) => void;
  selectedSeat: number | null;
  newlyBookedSeats?: number[];
  totalSeats?: number;
}

export function CarSeatLayout({ passengers, onSeatClick, selectedSeat, newlyBookedSeats, totalSeats = 4 }: Props) {
  const getSeat = (n: number) => passengers.find(p => p.seatNumber === n);

  const palette = (p?: SeatPassenger) => {
    if (!p) return { main: "#f4f4f5", side: "#e4e4e7", deep: "#d4d4d8", num: "#a1a1aa", label: "Свободно", labelColor: "#a1a1aa" };
    if (p.status === "dropped_off") return { main: "#d4d4d8", side: "#a1a1aa", deep: "#71717a", num: "#52525b", label: "Высажен", labelColor: "#71717a" };
    const isFemale = p.gender === "female";
    if (p.status === "picked_up") return isFemale
      ? { main: "#ec4899", side: "#db2777", deep: "#9d174d", num: "#fff", label: "В машине", labelColor: "#10b981" }
      : { main: "#3b82f6", side: "#2563eb", deep: "#1e3a8a", num: "#fff", label: "В машине", labelColor: "#10b981" };
    return isFemale
      ? { main: "#fbcfe8", side: "#f9a8d4", deep: "#f472b6", num: "#9d174d", label: "Ожидает", labelColor: "#d97706" }
      : { main: "#bfdbfe", side: "#93c5fd", deep: "#60a5fa", num: "#1e40af", label: "Ожидает", labelColor: "#d97706" };
  };

  const truncName = (name: string) => {
    const first = (name || "").split(" ")[0];
    return first.length > 9 ? first.slice(0, 9) + "…" : first;
  };

  // Render a realistic seat (top-down view) inside an SVG of given viewBox size
  const renderSeat = (n: number, x: number, y: number, w: number, h: number) => {
    const p = getSeat(n);
    const c = palette(p);
    const isSelected = selectedSeat === n;
    const isNew = newlyBookedSeats?.includes(n);
    const cx = x + w / 2;
    const headrestH = h * 0.18;
    const backH = h * 0.36;
    const cushionY = y + headrestH + backH * 0.25;
    const cushionH = h - headrestH - backH * 0.25;
    const gradId = `seatGrad-${n}`;
    const sideGradId = `sideGrad-${n}`;

    return (
      <g key={n} onClick={() => onSeatClick(n)} style={{ cursor: "pointer" }} className={isNew ? "seat-booking-anim" : ""}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={c.main} />
            <stop offset="100%" stopColor={c.side} />
          </linearGradient>
          <linearGradient id={sideGradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={c.deep} />
            <stop offset="100%" stopColor={c.side} />
          </linearGradient>
        </defs>

        {/* Drop shadow */}
        <ellipse cx={cx} cy={y + h + 6} rx={w * 0.42} ry="6" fill="#000" opacity="0.10" />

        {/* Headrest */}
        <rect x={x + w * 0.22} y={y} width={w * 0.56} height={headrestH} rx={headrestH * 0.4}
              fill={c.deep} opacity="0.85" />
        <rect x={x + w * 0.22 + 2} y={y + 2} width={w * 0.56 - 4} height={headrestH - 4} rx={headrestH * 0.35}
              fill={c.side} />

        {/* Seat back (with side bolsters) */}
        <rect x={x} y={y + headrestH * 0.6} width={w} height={backH} rx="14"
              fill={`url(#${sideGradId})`} />
        <rect x={x + w * 0.10} y={y + headrestH * 0.6 + 4} width={w * 0.80} height={backH - 8} rx="10"
              fill={`url(#${gradId})`} />
        {/* Stitching on back */}
        <line x1={cx} y1={y + headrestH * 0.6 + 8} x2={cx} y2={y + headrestH * 0.6 + backH - 8}
              stroke={c.deep} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />

        {/* Seat cushion */}
        <rect x={x - 2} y={cushionY} width={w + 4} height={cushionH} rx="16"
              fill={`url(#${sideGradId})`} />
        <rect x={x + w * 0.08} y={cushionY + 6} width={w * 0.84} height={cushionH - 12} rx="12"
              fill={`url(#${gradId})`} />
        {/* Cushion stitching - horizontal divisions */}
        <line x1={x + w * 0.15} y1={cushionY + cushionH * 0.45} x2={x + w * 0.85} y2={cushionY + cushionH * 0.45}
              stroke={c.deep} strokeWidth="1.2" strokeDasharray="3 3" opacity="0.45" />

        {/* Selection ring */}
        {isSelected && (
          <rect x={x - 8} y={y - 8} width={w + 16} height={h + 16} rx="20"
                fill="none" stroke="#0ea5e9" strokeWidth="3" strokeDasharray="8 4" />
        )}

        {/* Avatar / number badge */}
        {!p ? (
          <>
            <circle cx={cx} cy={cushionY + cushionH * 0.5} r="22" fill="#ffffff" stroke={c.deep} strokeWidth="2" />
            <text x={cx} y={cushionY + cushionH * 0.5 + 8} textAnchor="middle" fontSize="24" fontWeight="900" fill={c.num}>{n}</text>
          </>
        ) : (
          <>
            <circle cx={cx} cy={cushionY + cushionH * 0.45} r="22" fill="#ffffff" stroke={c.side} strokeWidth="2.5" />
            <foreignObject x={cx - 18} y={cushionY + cushionH * 0.45 - 18} width="36" height="36">
              <div style={{ width: 36, height: 36, color: c.main, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <PassengerAvatar gender={p.gender} size={32} />
              </div>
            </foreignObject>
            {/* Status badge top-right */}
            {p.status === "picked_up" && (
              <>
                <circle cx={x + w - 8} cy={y + 10} r="11" fill="#10b981" stroke="#fff" strokeWidth="2" />
                <foreignObject x={x + w - 17} y={y + 1} width="18" height="18">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, color: "#fff" }}>
                    <CheckCircle size={14} />
                  </div>
                </foreignObject>
              </>
            )}
            {p.status === "dropped_off" && (
              <circle cx={x + w - 8} cy={y + 10} r="11" fill="#a1a1aa" stroke="#fff" strokeWidth="2" />
            )}
            {/* Seat number in corner */}
            <circle cx={x + 12} cy={y + h - 12} r="13" fill="#18181b" />
            <text x={x + 12} y={y + h - 7} textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff">{n}</text>
          </>
        )}

        {/* Name label */}
        <text x={cx} y={y + h + 22} textAnchor="middle" fontSize="10" fontWeight="800" fill="#27272a">
          {p ? truncName(p.name) : "—"}
        </text>
        <text x={cx} y={y + h + 36} textAnchor="middle" fontSize="8" fontWeight="700" fill={c.labelColor}>
          {c.label.toUpperCase()}
        </text>
      </g>
    );
  };

  return (
    <div className="relative">
      <div className="bg-card rounded-2xl border border-border overflow-hidden px-3 py-2">
        {/* Front row label + seat */}
        <div className="mb-1 flex items-center gap-2">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-extrabold tracking-widest uppercase text-muted-foreground">Передний ряд</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <svg viewBox="0 0 320 150" className="w-full h-auto block" style={{ maxHeight: 110 }}>
          {renderSeat(1, 125, 6, 70, 110)}
        </svg>

        {/* Back row label + 3 seats */}
        <div className="mt-3 mb-1 flex items-center gap-2">
          <span className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-extrabold tracking-widest uppercase text-muted-foreground">Задний ряд</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <svg viewBox="0 0 320 150" className="w-full h-auto block" style={{ maxHeight: 110 }}>
          {renderSeat(2, 30,  6, 64, 110)}
          {renderSeat(3, 128, 6, 64, 110)}
          {renderSeat(4, 226, 6, 64, 110)}
        </svg>

        <div className="mt-2 pt-1.5 border-t border-border flex items-center justify-center gap-4 text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-300" />Ожидает</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" />В машине</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-zinc-400" />Высажен</span>
        </div>
      </div>
    </div>
  );
}
