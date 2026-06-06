import { useEffect, useRef } from "react";

export function ConfettiOverlay() {
  const particles = useRef(
    Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 1.2,
      dur: 1.5 + Math.random() * 1.5,
      size: 6 + Math.random() * 10,
      color: ["#F59E0B", "#FBBF24", "#FCD34D", "#10B981", "#34D399", "#6EE7B7", "#F97316", "#FB923C", "#EF4444", "#A855F7", "#818CF8", "#FFFFFF"][i % 12],
      drift: (Math.random() - 0.5) * 120,
      rotate: Math.random() * 720 + 360,
      shape: i % 3,
    }))
  ).current;

  return (
    <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: `${p.x}%`,
            top: "-12px",
            width: p.shape === 2 ? p.size * 1.5 : p.size,
            height: p.shape === 1 ? p.size * 0.5 : p.size,
            background: p.color,
            borderRadius: p.shape === 0 ? "50%" : p.shape === 1 ? "2px" : "3px",
            animation: `confetti-fall ${p.dur}s ease-in ${p.delay}s forwards`,
            "--drift": `${p.drift}px`,
            "--rotate": `${p.rotate}deg`,
          } as React.CSSProperties}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% { opacity: 1; transform: translateY(0) translateX(0) rotate(0deg) scale(1); }
          50% { opacity: 1; transform: translateY(40vh) translateX(calc(var(--drift) * 0.6)) rotate(calc(var(--rotate) * 0.5)) scale(0.9); }
          100% { opacity: 0; transform: translateY(calc(100vh + 20px)) translateX(var(--drift)) rotate(var(--rotate)) scale(0.3); }
        }
      `}</style>
    </div>
  );
}

