import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, Check, Loader2, X, AlertTriangle, ZoomIn, XCircle, ShieldAlert, Bot, Ban, RotateCcw, ChevronRight, Lightbulb, User, Car, Armchair } from "lucide-react";
import { toast } from "sonner";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function resolvePhotoUrl(url: string | null): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${window.location.origin}${BASE_URL}${url}`;
}

type AIPhotoResult = {
  photoType: string;
  aiStatus: "ok" | "warning" | "fail";
  aiComment: string;
};

type PhotoRequest = {
  id: number; status: string;
  selfieUrl: string | null; carFrontUrl: string | null;
  carBackUrl: string | null; interiorUrl: string | null;
  rejectReason: string | null;
  retryCount: number;
  aiResults: { overallStatus: string; photos: AIPhotoResult[] } | null;
  aiStatus: string | null;
};

type PhotoSlot = "selfie" | "carFront" | "carBack" | "interior";

type SlotConfig = {
  key: PhotoSlot;
  label: string;
  icon: string;
  aiType: string;
  guideTitle: string;
  guideSub: string;
  tips: string[];
  guideShape: "circle" | "rectangle" | "wide-rectangle";
  guideIcon: React.ReactNode;
  capture: "user" | "environment";
};

const SLOT_ORDER: PhotoSlot[] = ["selfie", "carFront", "carBack", "interior"];

const SLOTS: SlotConfig[] = [
  {
    key: "selfie", label: "Селфи", icon: "🤳", aiType: "selfie",
    guideTitle: "Сделайте селфи",
    guideSub: "Поместите лицо в круг",
    tips: [
      "Держите телефон на расстоянии вытянутой руки",
      "Лицо должно быть в центре и хорошо освещено",
      "Снимите солнцезащитные очки и шапку",
      "На фото должны быть только вы",
    ],
    guideShape: "circle",
    guideIcon: <User className="w-20 h-20" />,
    capture: "user",
  },
  {
    key: "carFront", label: "Авто спереди", icon: "🚗", aiType: "car_front",
    guideTitle: "Авто спереди",
    guideSub: "Номерной знак должен быть виден",
    tips: [
      "Сфотографируйте автомобиль спереди целиком",
      "Номерной знак должен быть чётко виден",
      "Отойдите на 2-3 метра от машины",
      "Снимайте горизонтально при хорошем освещении",
    ],
    guideShape: "wide-rectangle",
    guideIcon: <Car className="w-20 h-20" />,
    capture: "environment",
  },
  {
    key: "carBack", label: "Авто сзади", icon: "🔙", aiType: "car_back",
    guideTitle: "Авто сзади",
    guideSub: "Задний номерной знак должен быть виден",
    tips: [
      "Сфотографируйте автомобиль сзади целиком",
      "Задний номерной знак должен быть чётко виден",
      "Отойдите на 2-3 метра от машины",
      "Снимайте горизонтально при хорошем освещении",
    ],
    guideShape: "wide-rectangle",
    guideIcon: <Car className="w-20 h-20 scale-x-[-1]" />,
    capture: "environment",
  },
  {
    key: "interior", label: "Салон", icon: "💺", aiType: "interior",
    guideTitle: "Салон автомобиля",
    guideSub: "Покажите чистый салон без людей",
    tips: [
      "Откройте переднюю дверь и сфотографируйте салон",
      "Должны быть видны сиденья и панель",
      "Салон должен быть чистым и без мусора",
      "НЕ делайте селфи — фото салона без людей",
    ],
    guideShape: "rectangle",
    guideIcon: <Armchair className="w-20 h-20" />,
    capture: "environment",
  },
];

function playShutterSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    setTimeout(() => ctx.close(), 200);
  } catch {}
}

function triggerHaptic() {
  try { navigator.vibrate?.(50); } catch {}
}

type FeedbackColor = "red" | "yellow" | "green";

function analyzeFrame(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  shape: "circle" | "rectangle" | "wide-rectangle"
): FeedbackColor {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "yellow";

  const w = 120;
  const h = 90;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const regionW = shape === "circle" ? 40 : shape === "wide-rectangle" ? 80 : 60;
  const regionH = shape === "circle" ? 40 : 50;
  const sx = Math.floor(cx - regionW / 2);
  const sy = Math.floor(cy - regionH / 2);

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(sx, sy, regionW, regionH);
  } catch {
    return "yellow";
  }
  const d = imgData.data;
  const pixelCount = d.length / 4;
  if (pixelCount === 0) return "yellow";

  let rSum = 0, gSum = 0, bSum = 0;
  let rSqSum = 0, gSqSum = 0, bSqSum = 0;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    rSum += r; gSum += g; bSum += b;
    rSqSum += r * r; gSqSum += g * g; bSqSum += b * b;
  }

  const rMean = rSum / pixelCount;
  const gMean = gSum / pixelCount;
  const bMean = bSum / pixelCount;
  const brightness = (rMean + gMean + bMean) / 3;

  const rVar = rSqSum / pixelCount - rMean * rMean;
  const gVar = gSqSum / pixelCount - gMean * gMean;
  const bVar = bSqSum / pixelCount - bMean * bMean;
  const contrast = Math.sqrt((rVar + gVar + bVar) / 3);

  const grey = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    grey[i] = Math.round((d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3);
  }
  let edgeSum = 0;
  for (let y = 1; y < regionH - 1; y++) {
    for (let x = 1; x < regionW - 1; x++) {
      const idx = y * regionW + x;
      const lap = Math.abs(
        grey[idx - 1] + grey[idx + 1] + grey[idx - regionW] + grey[idx + regionW] - 4 * grey[idx]
      );
      edgeSum += lap;
    }
  }
  const edgeDensity = edgeSum / ((regionW - 2) * (regionH - 2));

  const tooDark = brightness < 45;
  const tooBright = brightness > 235;
  const lowContrast = contrast < 15;
  const noEdges = edgeDensity < 2.0;

  if (tooDark || tooBright) return "red";
  if (lowContrast && noEdges) return "red";
  if (lowContrast || noEdges || brightness < 60 || brightness > 220) return "yellow";
  return "green";
}

function StepProgress({ photos }: { photos: Record<PhotoSlot, string | null> }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-2">
      {SLOT_ORDER.map((key) => {
        const done = !!photos[key];
        const slot = SLOTS.find(s => s.key === key)!;
        return (
          <div key={key} className="flex flex-col items-center gap-1">
            <div className={`w-3 h-3 rounded-full transition-all duration-500 ${
              done ? "bg-emerald-500 scale-110 shadow-sm shadow-emerald-500/50" : "bg-muted-foreground/20"
            }`} />
            <span className={`text-[9px] font-medium transition-colors ${
              done ? "text-emerald-500" : "text-muted-foreground/40"
            }`}>{slot.icon}</span>
          </div>
        );
      })}
    </div>
  );
}

function CameraOverlaySVG({ shape, feedback }: { shape: "circle" | "rectangle" | "wide-rectangle"; feedback: FeedbackColor }) {
  const color = feedback === "green" ? "rgba(34,197,94,0.7)"
    : feedback === "yellow" ? "rgba(234,179,8,0.7)"
    : "rgba(239,68,68,0.6)";
  const glowColor = feedback === "green" ? "rgba(34,197,94,0.3)"
    : feedback === "yellow" ? "rgba(234,179,8,0.25)"
    : "rgba(239,68,68,0.2)";

  if (shape === "circle") {
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <mask id="cmask">
            <rect width="400" height="600" fill="white" />
            <circle cx="200" cy="260" r="120" fill="black" />
          </mask>
        </defs>
        <rect width="400" height="600" fill="rgba(0,0,0,0.55)" mask="url(#cmask)" />
        <circle cx="200" cy="260" r="120" fill="none" stroke={color} strokeWidth="3" className="cam-overlay-pulse" />
        <circle cx="200" cy="260" r="126" fill="none" stroke={glowColor} strokeWidth="6" className="cam-overlay-glow" />
        <circle cx="200" cy="140" r="4" fill={color} className="cam-overlay-dot" />
        <circle cx="200" cy="380" r="4" fill={color} className="cam-overlay-dot" style={{ animationDelay: "0.5s" }} />
        <circle cx="80" cy="260" r="4" fill={color} className="cam-overlay-dot" style={{ animationDelay: "1s" }} />
        <circle cx="320" cy="260" r="4" fill={color} className="cam-overlay-dot" style={{ animationDelay: "1.5s" }} />
      </svg>
    );
  }

  if (shape === "wide-rectangle") {
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <mask id="rmask">
            <rect width="400" height="600" fill="white" />
            <rect x="30" y="160" width="340" height="230" rx="16" fill="black" />
          </mask>
        </defs>
        <rect width="400" height="600" fill="rgba(0,0,0,0.55)" mask="url(#rmask)" />
        <rect x="30" y="160" width="340" height="230" rx="16" fill="none" stroke={color} strokeWidth="2.5" className="cam-overlay-pulse" />
        <rect x="24" y="154" width="352" height="242" rx="20" fill="none" stroke={glowColor} strokeWidth="5" className="cam-overlay-glow" />
        <line x1="30" y1="160" x2="60" y2="160" stroke={color} strokeWidth="4" className="cam-overlay-corner" />
        <line x1="30" y1="160" x2="30" y2="190" stroke={color} strokeWidth="4" className="cam-overlay-corner" />
        <line x1="370" y1="160" x2="340" y2="160" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.3s" }} />
        <line x1="370" y1="160" x2="370" y2="190" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.3s" }} />
        <line x1="30" y1="390" x2="60" y2="390" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.6s" }} />
        <line x1="30" y1="390" x2="30" y2="360" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.6s" }} />
        <line x1="370" y1="390" x2="340" y2="390" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.9s" }} />
        <line x1="370" y1="390" x2="370" y2="360" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.9s" }} />
        <rect x="145" y="360" width="110" height="22" rx="4" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="4 2" className="cam-overlay-plate" />
        <text x="200" y="375" textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace" className="cam-overlay-plate">01 A 123 AA</text>
      </svg>
    );
  }

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice">
      <defs>
        <mask id="imask">
          <rect width="400" height="600" fill="white" />
          <rect x="40" y="170" width="320" height="210" rx="16" fill="black" />
        </mask>
      </defs>
      <rect width="400" height="600" fill="rgba(0,0,0,0.55)" mask="url(#imask)" />
      <rect x="40" y="170" width="320" height="210" rx="16" fill="none" stroke={color} strokeWidth="2.5" className="cam-overlay-pulse" />
      <rect x="34" y="164" width="332" height="222" rx="20" fill="none" stroke={glowColor} strokeWidth="5" className="cam-overlay-glow" />
      <line x1="40" y1="170" x2="70" y2="170" stroke={color} strokeWidth="4" className="cam-overlay-corner" />
      <line x1="40" y1="170" x2="40" y2="200" stroke={color} strokeWidth="4" className="cam-overlay-corner" />
      <line x1="360" y1="170" x2="330" y2="170" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.3s" }} />
      <line x1="360" y1="170" x2="360" y2="200" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.3s" }} />
      <line x1="40" y1="380" x2="70" y2="380" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.6s" }} />
      <line x1="40" y1="380" x2="40" y2="350" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.6s" }} />
      <line x1="360" y1="380" x2="330" y2="380" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.9s" }} />
      <line x1="360" y1="380" x2="360" y2="350" stroke={color} strokeWidth="4" className="cam-overlay-corner" style={{ animationDelay: "0.9s" }} />
    </svg>
  );
}

function LiveCamera({ slot, onCapture, onCancel, onFallback }: {
  slot: SlotConfig;
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackColor>("yellow");
  const [flash, setFlash] = useState(false);
  const feedbackLabel = feedback === "green" ? "Отлично!" : feedback === "yellow" ? "Почти..." : "Поправьте";

  useEffect(() => {
    let cancelled = false;
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: slot.capture === "user" ? "user" : { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().then(() => {
              if (!cancelled) setReady(true);
            }).catch(() => {
              if (!cancelled) onFallback();
            });
          };
        }
      } catch {
        if (!cancelled) onFallback();
      }
    };
    startCamera();
    return () => {
      cancelled = true;
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [slot.capture, onFallback]);

  useEffect(() => {
    if (!ready) return;
    const iv = setInterval(() => {
      if (!videoRef.current || !analysisCanvasRef.current) return;
      const fb = analyzeFrame(analysisCanvasRef.current, videoRef.current, slot.guideShape);
      setFeedback(fb);
    }, 350);
    return () => clearInterval(iv);
  }, [ready, slot.guideShape]);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || capturingRef.current) return;
    capturingRef.current = true;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { capturingRef.current = false; return; }

    if (slot.capture === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    setFlash(true);
    playShutterSound();
    triggerHaptic();

    flashTimerRef.current = setTimeout(() => setFlash(false), 200);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          streamRef.current?.getTracks().forEach(t => t.stop());
          streamRef.current = null;
          onCapture(blob);
        }
      },
      "image/jpeg",
      0.92
    );
  }, [slot.capture, onCapture]);

  const handleCancel = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    onCancel();
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[10001] bg-black flex flex-col animate-fadeIn">
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={analysisCanvasRef} className="hidden" />

      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <button onClick={handleCancel} className="p-2 rounded-full bg-white/10 backdrop-blur-sm active:scale-95 transition-transform">
          <X className="w-5 h-5 text-white" />
        </button>
        <span className="text-sm font-medium text-white/90">{slot.label}</span>
        <div className={`px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-sm transition-all duration-300 ${
          feedback === "green" ? "bg-emerald-500/20 text-emerald-400"
          : feedback === "yellow" ? "bg-zinc-500/20 text-zinc-400"
          : "bg-red-500/20 text-red-400"
        }`}>
          {feedbackLabel}
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${slot.capture === "user" ? "scale-x-[-1]" : ""}`}
        />

        {!ready && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              <span className="text-sm text-white/60">Запуск камеры...</span>
            </div>
          </div>
        )}

        {ready && <CameraOverlaySVG shape={slot.guideShape} feedback={feedback} />}

        {flash && (
          <div className="absolute inset-0 z-30 bg-white cam-flash" />
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20 pb-8 pt-4 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-center">
          <button
            onClick={capture}
            disabled={!ready}
            className="w-[72px] h-[72px] rounded-full border-4 border-white/80 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-30"
          >
            <div className={`w-[58px] h-[58px] rounded-full transition-colors duration-300 ${
              feedback === "green" ? "bg-emerald-500" : feedback === "yellow" ? "bg-amber-500" : "bg-white"
            }`} />
          </button>
        </div>
        <p className="text-center text-white/50 text-xs mt-3">
          {slot.guideSub}
        </p>
      </div>
    </div>
  );
}

function PreviewOverlay({ slot, localUrl, onConfirm, onRetake, confirming }: {
  slot: SlotConfig;
  localUrl: string;
  onConfirm: () => void;
  onRetake: () => void;
  confirming: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[10001] bg-black flex flex-col animate-fadeIn">
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <div className="w-8" />
        <span className="text-sm font-medium text-white/90">{slot.label}</span>
        <div className="w-8" />
      </div>

      <div className="flex-1 relative flex items-center justify-center p-4 pt-16">
        <img
          src={localUrl}
          alt={slot.label}
          className="max-w-full max-h-full rounded-2xl object-contain animate-scaleIn"
        />
      </div>

      <div className="p-4 pb-8 space-y-3">
        <p className="text-center text-white/60 text-sm">
          Проверьте качество фото
        </p>
        <div className="flex gap-3">
          <button
            onClick={onRetake}
            disabled={confirming}
            className="flex-1 py-3.5 rounded-xl font-semibold text-sm bg-white/10 text-white hover:bg-white/20 active:scale-[0.97] transition-all flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <RotateCcw className="w-4 h-4" />
            Переснять
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="flex-1 py-3.5 rounded-xl font-semibold text-sm bg-amber-500 text-white hover:bg-amber-600 active:scale-[0.97] transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/30 disabled:opacity-60"
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}

function SelfieAnimatedGuide({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const totalSteps = 4;
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const isLast = step >= totalSteps - 1;
    autoRef.current = setTimeout(() => {
      if (!isLast) {
        setStep(s => s + 1);
      } else {
        onDoneRef.current();
      }
    }, isLast ? 2500 : 3000);
    return () => { if (autoRef.current) clearTimeout(autoRef.current); };
  }, [step]);

  const steps = [
    {
      title: "Возьмите телефон",
      desc: "Держите на расстоянии вытянутой руки",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute w-20 h-36 rounded-2xl border-2 border-amber-400 bg-zinc-800/80 selfie-phone-lift">
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border border-amber-400/50" />
            <div className="absolute inset-2 top-7 rounded-lg bg-zinc-700/50 flex items-center justify-center">
              <User className="w-8 h-8 text-amber-400/40" />
            </div>
          </div>
          <div className="absolute bottom-2 selfie-hand-anim">
            <svg width="50" height="40" viewBox="0 0 50 40" fill="none">
              <path d="M10 35 C10 25 15 20 25 18 C30 17 35 20 38 25 C40 28 42 30 42 35" stroke="rgba(245,158,11,0.5)" strokeWidth="2" fill="rgba(245,158,11,0.1)" />
              <circle cx="25" cy="15" r="4" fill="rgba(245,158,11,0.3)" />
            </svg>
          </div>
        </div>
      ),
    },
    {
      title: "Лицо в центре",
      desc: "Расположите лицо точно в круге",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="w-32 h-32 rounded-full border-[3px] border-amber-400/50 cam-overlay-pulse flex items-center justify-center">
            <div className="w-28 h-28 rounded-full border-2 border-dashed border-amber-400/20 animate-guide-rotate flex items-center justify-center">
              <div className="selfie-face-center">
                <User className="w-14 h-14 text-amber-400/60" />
              </div>
            </div>
          </div>
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-emerald-400 cam-overlay-dot" />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-emerald-400 cam-overlay-dot" style={{ animationDelay: "0.5s" }} />
          <div className="absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 cam-overlay-dot" style={{ animationDelay: "1s" }} />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 cam-overlay-dot" style={{ animationDelay: "1.5s" }} />
        </div>
      ),
    },
    {
      title: "Хорошее освещение",
      desc: "Свет должен падать на лицо, не сзади",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="selfie-light-rays">
            {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
              <div key={deg} className="absolute w-1 h-12 bg-gradient-to-b from-amber-300/40 to-transparent origin-bottom"
                style={{ transform: `rotate(${deg}deg) translateY(-55px)`, left: "calc(50% - 2px)", top: "calc(50% - 55px)" }} />
            ))}
          </div>
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-amber-100/20 to-amber-400/10 border-2 border-amber-400/40 flex items-center justify-center selfie-glow-pulse">
            <User className="w-10 h-10 text-amber-400/70" />
          </div>
          <div className="absolute top-3 right-6">
            <div className="w-8 h-8 rounded-full bg-amber-400/20 flex items-center justify-center selfie-sun-pulse">
              <Lightbulb className="w-4 h-4 text-amber-400" />
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Без очков и шапки",
      desc: "Лицо должно быть полностью открыто",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center gap-8">
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-400/30 flex items-center justify-center relative">
              <User className="w-8 h-8 text-red-400/60" />
              <div className="absolute top-3 w-10 h-3 rounded-full border-2 border-red-400/50 bg-red-400/10" />
            </div>
            <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <X className="w-3.5 h-3.5 text-red-400" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border-2 border-emerald-400/30 flex items-center justify-center selfie-correct-pulse">
              <User className="w-8 h-8 text-emerald-400/70" />
            </div>
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative w-full h-56 flex items-center justify-center overflow-hidden">
        {steps.map((s, i) => (
          <div key={i} className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ${
            i === step ? "opacity-100 scale-100" : i < step ? "opacity-0 -translate-x-full scale-90" : "opacity-0 translate-x-full scale-90"
          }`}>
            {s.animation}
          </div>
        ))}
      </div>

      <div className="text-center space-y-1 min-h-[52px]">
        <h3 className="text-lg font-bold text-foreground transition-all">{steps[step].title}</h3>
        <p className="text-sm text-amber-500 font-medium">{steps[step].desc}</p>
      </div>

      <div className="flex items-center gap-2">
        {steps.map((_, i) => (
          <button key={i} onClick={() => setStep(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-amber-500" : "w-1.5 bg-muted-foreground/20"}`} />
        ))}
      </div>


    </div>
  );
}

function CarFrontAnimatedGuide({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const totalSteps = 4;
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const isLast = step >= totalSteps - 1;
    autoRef.current = setTimeout(() => {
      if (!isLast) {
        setStep(s => s + 1);
      } else {
        onDoneRef.current();
      }
    }, isLast ? 2500 : 3000);
    return () => { if (autoRef.current) clearTimeout(autoRef.current); };
  }, [step]);

  const steps = [
    {
      title: "Отойдите от машины",
      desc: "Встаньте на расстоянии 2-3 метра спереди",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-x-4 inset-y-10 rounded-xl border-2 border-amber-400/30 bg-zinc-800/60">
            <div className="absolute inset-2 rounded-lg bg-zinc-700/30 flex items-center justify-center">
              <Car className="w-16 h-10 text-amber-400/40" />
            </div>
          </div>
          <div className="absolute bottom-2 car-distance-arrow">
            <div className="flex flex-col items-center gap-0.5">
              <div className="w-0.5 h-6 bg-amber-400/40" />
              <span className="text-[9px] text-amber-400/60 font-medium">2-3 м</span>
              <div className="w-0.5 h-6 bg-amber-400/40" />
            </div>
          </div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 car-person-walk">
            <User className="w-6 h-6 text-amber-400/50" />
          </div>
        </div>
      ),
    },
    {
      title: "Весь автомобиль в кадре",
      desc: "Машина должна поместиться полностью",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-y-10 inset-x-2 rounded-2xl border-[3px] border-amber-400/40 cam-overlay-pulse" />
          <div className="absolute top-7 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-emerald-400/60 rounded-tl-lg car-corner-blink" />
          <div className="absolute top-7 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-emerald-400/60 rounded-tr-lg car-corner-blink" style={{ animationDelay: "0.3s" }} />
          <div className="absolute bottom-7 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-emerald-400/60 rounded-bl-lg car-corner-blink" style={{ animationDelay: "0.6s" }} />
          <div className="absolute bottom-7 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-emerald-400/60 rounded-br-lg car-corner-blink" style={{ animationDelay: "0.9s" }} />
          <div className="car-fit-scale">
            <Car className="w-24 h-14 text-amber-400/60" />
          </div>
        </div>
      ),
    },
    {
      title: "Номер должен быть виден",
      desc: "Передний номерной знак чётко в кадре",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <Car className="w-20 h-14 text-amber-400/30 mb-4" />
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2">
            <div className="car-plate-highlight h-7 w-28 rounded-lg border-[3px] border-emerald-400/70 bg-emerald-400/10 flex items-center justify-center">
              <span className="text-[10px] font-mono text-emerald-400 tracking-widest font-bold">01 A 123 AA</span>
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400/20 flex items-center justify-center car-plate-check">
              <Check className="w-2.5 h-2.5 text-emerald-400" />
            </div>
          </div>
          <div className="absolute top-6 right-6 car-zoom-icon">
            <ZoomIn className="w-7 h-7 text-amber-400/40" />
          </div>
        </div>
      ),
    },
    {
      title: "Горизонтально",
      desc: "Снимайте при хорошем дневном освещении",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="flex gap-8 items-end">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-20 rounded-lg border-2 border-red-400/40 bg-red-400/5 flex items-center justify-center car-phone-vertical">
                <Car className="w-6 h-4 text-red-400/50 rotate-90" />
              </div>
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <X className="w-3 h-3 text-red-400" />
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-20 h-12 rounded-lg border-2 border-emerald-400/40 bg-emerald-400/5 flex items-center justify-center car-phone-horizontal">
                <Car className="w-10 h-6 text-emerald-400/60" />
              </div>
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Check className="w-3 h-3 text-emerald-400" />
              </div>
            </div>
          </div>
          <div className="absolute top-4 right-4">
            <div className="w-8 h-8 rounded-full bg-amber-400/15 flex items-center justify-center selfie-sun-pulse">
              <Lightbulb className="w-4 h-4 text-amber-400" />
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative w-full h-56 flex items-center justify-center overflow-hidden">
        {steps.map((s, i) => (
          <div key={i} className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ${
            i === step ? "opacity-100 scale-100" : i < step ? "opacity-0 -translate-x-full scale-90" : "opacity-0 translate-x-full scale-90"
          }`}>
            {s.animation}
          </div>
        ))}
      </div>
      <div className="text-center space-y-1 min-h-[52px]">
        <h3 className="text-lg font-bold text-foreground transition-all">{steps[step].title}</h3>
        <p className="text-sm text-amber-500 font-medium">{steps[step].desc}</p>
      </div>
      <div className="flex items-center gap-2">
        {steps.map((_, i) => (
          <button key={i} onClick={() => setStep(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-amber-500" : "w-1.5 bg-muted-foreground/20"}`} />
        ))}
      </div>

    </div>
  );
}

function CarBackAnimatedGuide({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const totalSteps = 4;
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const isLast = step >= totalSteps - 1;
    autoRef.current = setTimeout(() => {
      if (!isLast) {
        setStep(s => s + 1);
      } else {
        onDoneRef.current();
      }
    }, isLast ? 2500 : 3000);
    return () => { if (autoRef.current) clearTimeout(autoRef.current); };
  }, [step]);

  const steps = [
    {
      title: "Обойдите машину",
      desc: "Встаньте на 2-3 метра сзади автомобиля",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-x-4 inset-y-10 rounded-xl border-2 border-amber-400/30 bg-zinc-800/60">
            <div className="absolute inset-2 rounded-lg bg-zinc-700/30 flex items-center justify-center">
              <Car className="w-16 h-10 text-amber-400/40 scale-x-[-1]" />
            </div>
          </div>
          <div className="absolute bottom-0 car-walk-around">
            <div className="flex items-center gap-1">
              <User className="w-5 h-5 text-amber-400/60" />
              <div className="flex gap-0.5">
                <div className="w-1 h-1 rounded-full bg-amber-400/30" />
                <div className="w-1 h-1 rounded-full bg-amber-400/20" />
                <div className="w-1 h-1 rounded-full bg-amber-400/10" />
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Задняя часть целиком",
      desc: "Вся задняя часть авто должна быть в кадре",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-y-10 inset-x-2 rounded-2xl border-[3px] border-amber-400/40 cam-overlay-pulse" />
          <div className="absolute top-7 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-emerald-400/60 rounded-tl-lg car-corner-blink" />
          <div className="absolute top-7 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-emerald-400/60 rounded-tr-lg car-corner-blink" style={{ animationDelay: "0.3s" }} />
          <div className="absolute bottom-7 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-emerald-400/60 rounded-bl-lg car-corner-blink" style={{ animationDelay: "0.6s" }} />
          <div className="absolute bottom-7 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-emerald-400/60 rounded-br-lg car-corner-blink" style={{ animationDelay: "0.9s" }} />
          <div className="car-fit-scale">
            <Car className="w-24 h-14 text-amber-400/60 scale-x-[-1]" />
          </div>
          <div className="absolute bottom-12 left-6 w-3 h-5 rounded-sm bg-red-400/30 car-taillight-blink" />
          <div className="absolute bottom-12 right-6 w-3 h-5 rounded-sm bg-red-400/30 car-taillight-blink" style={{ animationDelay: "0.5s" }} />
        </div>
      ),
    },
    {
      title: "Задний номер виден",
      desc: "Задний номерной знак чётко читается",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <Car className="w-20 h-14 text-amber-400/30 scale-x-[-1] mb-4" />
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2">
            <div className="car-plate-highlight h-7 w-28 rounded-lg border-[3px] border-emerald-400/70 bg-emerald-400/10 flex items-center justify-center">
              <span className="text-[10px] font-mono text-emerald-400 tracking-widest font-bold">01 A 123 AA</span>
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400/20 flex items-center justify-center car-plate-check">
              <Check className="w-2.5 h-2.5 text-emerald-400" />
            </div>
          </div>
          <div className="absolute top-6 left-6 car-zoom-icon">
            <ZoomIn className="w-7 h-7 text-amber-400/40" />
          </div>
        </div>
      ),
    },
    {
      title: "Без грязи и снега",
      desc: "Номер и кузов чистые, без загрязнений",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center gap-8">
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-xl bg-red-500/10 border-2 border-red-400/30 flex items-center justify-center relative">
              <Car className="w-10 h-7 text-red-400/40 scale-x-[-1]" />
              <div className="absolute inset-0 rounded-xl overflow-hidden">
                <div className="absolute bottom-0 inset-x-0 h-1/3 bg-gradient-to-t from-red-900/20 to-transparent" />
              </div>
            </div>
            <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
              <X className="w-3 h-3 text-red-400" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-xl bg-emerald-500/10 border-2 border-emerald-400/30 flex items-center justify-center selfie-correct-pulse">
              <Car className="w-10 h-7 text-emerald-400/60 scale-x-[-1]" />
            </div>
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-3 h-3 text-emerald-400" />
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative w-full h-56 flex items-center justify-center overflow-hidden">
        {steps.map((s, i) => (
          <div key={i} className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ${
            i === step ? "opacity-100 scale-100" : i < step ? "opacity-0 -translate-x-full scale-90" : "opacity-0 translate-x-full scale-90"
          }`}>
            {s.animation}
          </div>
        ))}
      </div>
      <div className="text-center space-y-1 min-h-[52px]">
        <h3 className="text-lg font-bold text-foreground transition-all">{steps[step].title}</h3>
        <p className="text-sm text-amber-500 font-medium">{steps[step].desc}</p>
      </div>
      <div className="flex items-center gap-2">
        {steps.map((_, i) => (
          <button key={i} onClick={() => setStep(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-amber-500" : "w-1.5 bg-muted-foreground/20"}`} />
        ))}
      </div>

    </div>
  );
}

function InteriorAnimatedGuide({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const totalSteps = 4;
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const isLast = step >= totalSteps - 1;
    autoRef.current = setTimeout(() => {
      if (!isLast) {
        setStep(s => s + 1);
      } else {
        onDoneRef.current();
      }
    }, isLast ? 2500 : 3000);
    return () => { if (autoRef.current) clearTimeout(autoRef.current); };
  }, [step]);

  const steps = [
    {
      title: "Откройте дверь",
      desc: "Откройте переднюю пассажирскую дверь",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-x-6 inset-y-8 rounded-xl border-2 border-amber-400/30 bg-zinc-800/60">
            <div className="absolute inset-2 rounded-lg bg-zinc-700/30" />
          </div>
          <div className="absolute left-2 inset-y-8 w-8 rounded-l-xl border-2 border-r-0 border-amber-400/40 bg-amber-400/5 interior-door-open" />
          <div className="relative z-10">
            <Armchair className="w-12 h-12 text-amber-400/40" />
          </div>
          <div className="absolute top-4 left-1/2 -translate-x-1/2">
            <div className="interior-arrow-down">
              <ChevronRight className="w-5 h-5 text-amber-400/50 rotate-90" />
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Покажите сиденья",
      desc: "Передние и задние сиденья в кадре",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-4 rounded-2xl border-[3px] border-amber-400/40 cam-overlay-pulse" />
          <div className="absolute top-2 left-2 w-5 h-5 border-t-[3px] border-l-[3px] border-emerald-400/60 rounded-tl-lg car-corner-blink" />
          <div className="absolute top-2 right-2 w-5 h-5 border-t-[3px] border-r-[3px] border-emerald-400/60 rounded-tr-lg car-corner-blink" style={{ animationDelay: "0.3s" }} />
          <div className="absolute bottom-2 left-2 w-5 h-5 border-b-[3px] border-l-[3px] border-emerald-400/60 rounded-bl-lg car-corner-blink" style={{ animationDelay: "0.6s" }} />
          <div className="absolute bottom-2 right-2 w-5 h-5 border-b-[3px] border-r-[3px] border-emerald-400/60 rounded-br-lg car-corner-blink" style={{ animationDelay: "0.9s" }} />
          <div className="flex gap-3 items-end interior-seats-show">
            <Armchair className="w-9 h-9 text-amber-400/50" />
            <Armchair className="w-9 h-9 text-amber-400/50" />
          </div>
          <div className="absolute top-14 flex gap-2">
            <Armchair className="w-7 h-7 text-amber-400/30 interior-seats-show" style={{ animationDelay: "0.5s" }} />
            <Armchair className="w-7 h-7 text-amber-400/30 interior-seats-show" style={{ animationDelay: "0.7s" }} />
            <Armchair className="w-7 h-7 text-amber-400/30 interior-seats-show" style={{ animationDelay: "0.9s" }} />
          </div>
        </div>
      ),
    },
    {
      title: "Чистый салон",
      desc: "Без мусора, вещей и посторонних предметов",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center gap-8">
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-xl bg-red-500/10 border-2 border-red-400/30 flex items-center justify-center relative overflow-hidden">
              <Armchair className="w-8 h-8 text-red-400/40" />
              <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-red-400/30" />
              <div className="absolute bottom-1 left-2 w-4 h-2 rounded bg-red-400/20" />
              <div className="absolute top-3 left-1 w-2 h-3 rounded bg-red-400/20 rotate-12" />
            </div>
            <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
              <X className="w-3 h-3 text-red-400" />
            </div>
            <span className="text-[10px] text-red-400/60">Грязно</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-xl bg-emerald-500/10 border-2 border-emerald-400/30 flex items-center justify-center selfie-correct-pulse">
              <Armchair className="w-8 h-8 text-emerald-400/60" />
            </div>
            <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-3 h-3 text-emerald-400" />
            </div>
            <span className="text-[10px] text-emerald-400/60">Чисто</span>
          </div>
        </div>
      ),
    },
    {
      title: "Без людей в кадре",
      desc: "Фото салона без пассажиров и водителя",
      animation: (
        <div className="relative w-48 h-48 flex items-center justify-center">
          <div className="absolute inset-6 rounded-2xl border-2 border-amber-400/20 bg-zinc-800/40">
            <div className="absolute inset-2 flex items-center justify-center gap-3">
              <Armchair className="w-10 h-10 text-emerald-400/50" />
              <Armchair className="w-10 h-10 text-emerald-400/50" />
            </div>
          </div>
          <div className="absolute top-3 right-3 interior-no-person">
            <div className="relative">
              <User className="w-8 h-8 text-red-400/40" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Ban className="w-10 h-10 text-red-400/60" />
              </div>
            </div>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-400/40 cam-overlay-dot" />
            <div className="w-2 h-2 rounded-full bg-emerald-400/40 cam-overlay-dot" style={{ animationDelay: "0.5s" }} />
            <div className="w-2 h-2 rounded-full bg-emerald-400/40 cam-overlay-dot" style={{ animationDelay: "1s" }} />
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative w-full h-56 flex items-center justify-center overflow-hidden">
        {steps.map((s, i) => (
          <div key={i} className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ${
            i === step ? "opacity-100 scale-100" : i < step ? "opacity-0 -translate-x-full scale-90" : "opacity-0 translate-x-full scale-90"
          }`}>
            {s.animation}
          </div>
        ))}
      </div>
      <div className="text-center space-y-1 min-h-[52px]">
        <h3 className="text-lg font-bold text-foreground transition-all">{steps[step].title}</h3>
        <p className="text-sm text-amber-500 font-medium">{steps[step].desc}</p>
      </div>
      <div className="flex items-center gap-2">
        {steps.map((_, i) => (
          <button key={i} onClick={() => setStep(i)}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-amber-500" : "w-1.5 bg-muted-foreground/20"}`} />
        ))}
      </div>

    </div>
  );
}

function InstructionScreen({ slot, onProceed, onCancel }: {
  slot: SlotConfig;
  onProceed: () => void;
  onCancel: () => void;
}) {
  const renderGuide = () => {
    switch (slot.key) {
      case "selfie":
        return <SelfieAnimatedGuide onDone={onProceed} />;
      case "carFront":
        return <CarFrontAnimatedGuide onDone={onProceed} />;
      case "carBack":
        return <CarBackAnimatedGuide onDone={onProceed} />;
      case "interior":
        return <InteriorAnimatedGuide onDone={onProceed} />;
    }
  };

  return (
    <div className="fixed inset-0 z-[10001] bg-background/95 backdrop-blur-md flex flex-col animate-slideUp">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted active:scale-95 transition-all">
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
        <span className="text-sm font-medium text-muted-foreground">{slot.label}</span>
        <div className="w-8" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 overflow-auto py-4">
        {renderGuide()}
      </div>
    </div>
  );
}

export default function PhotoControlModal({ token, rejectReason, onComplete }: { token: string; rejectReason?: string | null; onComplete: () => void }) {
  const [request, setRequest] = useState<PhotoRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<Record<PhotoSlot, string | null>>({
    selfie: null, carFront: null, carBack: null, interior: null,
  });
  const [uploading, setUploading] = useState<PhotoSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [displayRejectReason, setDisplayRejectReason] = useState<string | null>(rejectReason || null);
  const [aiWarnings, setAiWarnings] = useState<AIPhotoResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [activeSlot, setActiveSlot] = useState<PhotoSlot | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [instructionSlot, setInstructionSlot] = useState<SlotConfig | null>(null);
  const [cameraSlot, setCameraSlot] = useState<SlotConfig | null>(null);
  const [capturePreview, setCapturePreview] = useState<{ slot: SlotConfig; localUrl: string; file: File } | null>(null);
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (capturePreview?.localUrl) {
        URL.revokeObjectURL(capturePreview.localUrl);
      }
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, [capturePreview]);

  useEffect(() => {
    fetch(`${BASE_URL}/api/photo-control/my-pending`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (d.request && d.blocked) {
          setRequest(d.request);
          if (d.request.rejectReason) setDisplayRejectReason(d.request.rejectReason);
          if (d.request.aiResults?.photos) setAiWarnings(d.request.aiResults.photos.filter((p: AIPhotoResult) => p.aiStatus !== "ok"));
          if (d.request.status === "pending") {
            setPhotos({
              selfie: d.request.selfieUrl || null,
              carFront: d.request.carFrontUrl || null,
              carBack: d.request.carBackUrl || null,
              interior: d.request.interiorUrl || null,
            });
          }
        } else {
          onComplete();
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const openInstruction = (slotKey: PhotoSlot) => {
    const slot = SLOTS.find(s => s.key === slotKey)!;
    setInstructionSlot(slot);
  };

  const openCamera = useCallback(() => {
    if (!instructionSlot) return;
    const slot = instructionSlot;
    setInstructionSlot(null);
    setCameraSlot(slot);
  }, [instructionSlot]);

  const handleCameraFallback = useCallback(() => {
    if (!cameraSlot) return;
    const slot = cameraSlot;
    setCameraSlot(null);
    setActiveSlot(slot.key);
    if (fileRef.current) {
      fileRef.current.setAttribute("capture", slot.capture);
    }
    setTimeout(() => fileRef.current?.click(), 100);
  }, [cameraSlot]);

  const handleCameraCapture = useCallback((blob: Blob) => {
    if (!cameraSlot) return;
    const slot = cameraSlot;
    setCameraSlot(null);
    const localUrl = URL.createObjectURL(blob);
    const file = new File([blob], `photo-${slot.key}-${Date.now()}.jpg`, { type: "image/jpeg" });
    setCapturePreview({ slot, localUrl, file });
  }, [cameraSlot]);

  const handleCameraCancel = useCallback(() => {
    setCameraSlot(null);
  }, []);

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSlot) return;
    e.target.value = "";
    const slotConfig = SLOTS.find(s => s.key === activeSlot)!;
    const localUrl = URL.createObjectURL(file);
    setCapturePreview({ slot: slotConfig, localUrl, file });
  };

  const getNextEmptySlot = useCallback((currentKey: PhotoSlot): SlotConfig | null => {
    const currentIdx = SLOT_ORDER.indexOf(currentKey);
    for (let i = 1; i <= 4; i++) {
      const nextIdx = (currentIdx + i) % 4;
      const nextKey = SLOT_ORDER[nextIdx];
      if (!photos[nextKey]) {
        return SLOTS.find(s => s.key === nextKey) || null;
      }
    }
    return null;
  }, [photos]);

  const confirmPhoto = useCallback(async () => {
    if (!capturePreview || confirming) return;
    setConfirming(true);
    const { slot, file, localUrl } = capturePreview;
    URL.revokeObjectURL(localUrl);
    setCapturePreview(null);

    setUploading(slot.key);
    setActiveSlot(slot.key);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch(`${BASE_URL}/api/photo-control/upload-photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setPhotos(prev => {
        const updated = { ...prev, [slot.key]: data.url };
        if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = setTimeout(() => {
          autoAdvanceRef.current = null;
          const allFilled = updated.selfie && updated.carFront && updated.carBack && updated.interior;
          if (!allFilled) {
            const next = getNextEmptySlot(slot.key);
            if (next) setInstructionSlot(next);
          }
        }, 600);
        return updated;
      });
    } catch {
      toast.error("Ошибка загрузки фото");
    }
    setUploading(null);
    setActiveSlot(null);
    setConfirming(false);
  }, [capturePreview, confirming, token, getNextEmptySlot]);

  const retakePhoto = useCallback(() => {
    if (!capturePreview) return;
    const { slot, localUrl } = capturePreview;
    URL.revokeObjectURL(localUrl);
    setCapturePreview(null);
    setCameraSlot(slot);
  }, [capturePreview]);

  const submit = async () => {
    if (!request) return;
    const allDone = photos.selfie && photos.carFront && photos.carBack && photos.interior;
    if (!allDone) { toast.error("Загрузите все 4 фото"); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE_URL}/api/photo-control/my-pending/${request.id}/submit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          selfieUrl: photos.selfie,
          carFrontUrl: photos.carFront,
          carBackUrl: photos.carBack,
          interiorUrl: photos.interior,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.autoRejected) {
          toast.error("Фото не прошли автоматическую проверку");
          if (data.aiResult?.photos) {
            setAiWarnings(data.aiResult.photos.filter((p: AIPhotoResult) => p.aiStatus !== "ok"));
          }
          if (data.request) {
            if (data.request.status === "rejected_final") {
              setRequest(data.request);
              setDisplayRejectReason(data.request.rejectReason || "Доступ временно ограничен до одобрения фотоконтроля");
            } else {
              fetch(`${BASE_URL}/api/photo-control/my-pending`, { headers: { Authorization: `Bearer ${token}` } })
                .then(r => r.json())
                .then(d => {
                  if (d.request && d.blocked) {
                    setRequest(d.request);
                    if (d.request.rejectReason) setDisplayRejectReason(d.request.rejectReason);
                    if (d.request.aiResults?.photos) setAiWarnings(d.request.aiResults.photos.filter((p: AIPhotoResult) => p.aiStatus !== "ok"));
                    setPhotos({ selfie: null, carFront: null, carBack: null, interior: null });
                  } else {
                    onComplete();
                  }
                })
                .catch(() => {
                  setRequest(data.request);
                  setDisplayRejectReason(data.request.rejectReason || "Фото не прошли автоматическую проверку");
                });
            }
          }
        } else {
          toast.success("Фото отправлены на проверку. Вы можете выйти на линию.");
          if (data.aiResult?.photos) {
            const warnings = data.aiResult.photos.filter((p: AIPhotoResult) => p.aiStatus === "warning");
            if (warnings.length > 0) {
              toast.info(`AI предупреждения: ${warnings.map((w: AIPhotoResult) => w.aiComment).join("; ")}`, { duration: 6000 });
            }
          }
          onComplete();
        }
      } else {
        toast.error(data.message || "Ошибка отправки");
      }
    } catch {
      toast.error("Ошибка сети");
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          <span className="text-sm text-muted-foreground">Проверка...</span>
        </div>
      </div>
    );
  }

  if (!request) return null;

  const uploadedCount = Object.values(photos).filter(Boolean).length;
  const allDone = uploadedCount === 4;
  const isRejected = !!displayRejectReason;
  const isFinalBlock = request.status === "rejected_final";
  const retryCount = request.retryCount || 0;

  return (
    <div className="fixed inset-0 z-[9999] bg-background overflow-auto">
      <input type="file" ref={fileRef} accept="image/*" capture="environment" className="hidden" onChange={handleFileInput} />

      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isFinalBlock ? "bg-red-500/10" : isRejected ? "bg-red-500/10" : "bg-amber-500/10"}`}>
            {isFinalBlock ? <Ban className="w-6 h-6 text-red-500" /> : isRejected ? <XCircle className="w-6 h-6 text-red-500" /> : <Camera className="w-6 h-6 text-amber-500" />}
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">
              {isFinalBlock ? "Доступ ограничен" : isRejected ? "Фото отклонены" : "Фотоконтроль"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isFinalBlock
                ? "Обратитесь к диспетчеру для разблокировки"
                : isRejected
                  ? "Сделайте фото заново согласно требованиям"
                  : "Загрузите фото перед выходом на линию"}
            </p>
          </div>
        </div>

        {retryCount > 0 && !isFinalBlock && (
          <div className="bg-zinc-100 border border-zinc-200 rounded-xl px-4 py-2 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            <span className="text-xs text-zinc-600 font-medium">
              Попытка {retryCount + 1} из 2. {retryCount >= 1 ? "Последняя попытка — при повторном отклонении доступ будет ограничен." : ""}
            </span>
          </div>
        )}

        {isFinalBlock ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-4 space-y-2">
            <div className="flex items-start gap-2">
              <Ban className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-600">Доступ временно ограничен</p>
                <p className="text-sm text-red-600/80 mt-1">
                  Фотоконтроль не пройден после {retryCount} попыток. Обратитесь к диспетчеру или администратору для повторной проверки.
                </p>
                {displayRejectReason && (
                  <p className="text-xs text-red-600/70 mt-2 border-t border-red-500/10 pt-2">
                    Причина: {displayRejectReason}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : isRejected ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-600">Причина отклонения</p>
                <p className="text-sm text-red-600/80 mt-0.5">{displayRejectReason}</p>
              </div>
            </div>
            <p className="text-xs text-red-600/60 mt-2">
              Загрузите новые фото, соответствующие требованиям. После загрузки вы сможете выйти на линию.
            </p>
          </div>
        ) : (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-600">Требуется фотоконтроль</p>
              <p className="text-xs text-amber-600/70 mt-0.5">
                Загрузите все 4 фото. После отправки вы сможете выйти на линию, пока фото на проверке.
              </p>
            </div>
          </div>
        )}

        {aiWarnings.length > 0 && !isFinalBlock && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Bot className="w-3.5 h-3.5" />
              <span>AI проверка</span>
            </div>
            {aiWarnings.map((w, i) => (
              <div key={i} className={`rounded-lg px-3 py-2 text-[11px] flex items-start gap-2 ${
                w.aiStatus === "fail" ? "bg-red-500/10 border border-red-500/20" : "bg-zinc-100 border border-zinc-200"
              }`}>
                <span className="flex-shrink-0 mt-0.5">{w.aiStatus === "fail" ? "❌" : "⚠️"}</span>
                <span className={w.aiStatus === "fail" ? "text-red-600" : "text-zinc-700"}>{w.aiComment}</span>
              </div>
            ))}
          </div>
        )}

        {!isFinalBlock && (
          <>
            <StepProgress photos={photos} />

            <div className="grid grid-cols-2 gap-3">
              {SLOTS.map(slot => {
                const url = photos[slot.key];
                const isUploading = uploading === slot.key;
                const src = resolvePhotoUrl(url);
                const aiResult = aiWarnings.find(w => w.photoType === slot.aiType);
                const slotIdx = SLOT_ORDER.indexOf(slot.key);

                return (
                  <div key={slot.key} className="relative animate-slotIn" style={{ animationDelay: `${slotIdx * 80}ms` }}>
                    <div
                      onClick={() => !isUploading && openInstruction(slot.key)}
                      className={`aspect-square rounded-xl border-2 overflow-hidden cursor-pointer transition-all relative ${
                        url
                          ? aiResult?.aiStatus === "fail"
                            ? "border-red-500/40"
                            : aiResult?.aiStatus === "warning"
                              ? "border-zinc-400/40"
                              : "border-emerald-500/40"
                          : "border-dashed border-border hover:border-amber-500/40 hover:bg-amber-500/5"
                      } bg-card active:scale-[0.97] transition-transform`}
                    >
                      {url ? (
                        <>
                          <img
                            src={src}
                            alt={slot.label}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <div className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow-sm ${
                            aiResult?.aiStatus === "fail" ? "bg-red-500" : aiResult?.aiStatus === "warning" ? "bg-zinc-500" : "bg-emerald-500"
                          }`}>
                            {aiResult?.aiStatus === "fail" ? <X className="w-3.5 h-3.5 text-white" /> :
                             aiResult?.aiStatus === "warning" ? <AlertTriangle className="w-3 h-3 text-white" /> :
                             <Check className="w-3.5 h-3.5 text-white" />}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPreviewUrl(src); }}
                            className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center"
                          >
                            <ZoomIn className="w-3 h-3 text-white" />
                          </button>
                          <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-black/60 text-white px-2 py-0.5 rounded-full">{slot.label}</span>
                        </>
                      ) : isUploading ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                          <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                          <span className="text-xs text-muted-foreground">Загрузка...</span>
                          <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full loading-shimmer" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 group">
                          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-lg group-hover:bg-amber-500/20 transition-colors group-hover:scale-110 transition-transform">
                            {slot.icon}
                          </div>
                          <span className="text-xs text-muted-foreground font-medium">{slot.label}</span>
                          <span className="text-[10px] text-amber-500/70 font-medium flex items-center gap-0.5">
                            <Camera className="w-3 h-3" /> Снять фото
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-amber-500 to-amber-400 h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${(uploadedCount / 4) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground font-semibold">{uploadedCount}/4</span>
            </div>

            <button
              onClick={submit}
              disabled={!allDone || submitting}
              className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-lg active:scale-[0.97] ${
                allDone
                  ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20"
                  : "bg-amber-500 text-white shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Отправить на проверку
            </button>

            <p className="text-[11px] text-center text-muted-foreground">
              После отправки фото статус изменится на «На проверке» и вы сможете работать
            </p>
          </>
        )}
      </div>

      {previewUrl && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
          <button onClick={() => setPreviewUrl(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20">
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-[85vh] rounded-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {instructionSlot && (
        <InstructionScreen
          slot={instructionSlot}
          onProceed={openCamera}
          onCancel={() => setInstructionSlot(null)}
        />
      )}

      {cameraSlot && (
        <LiveCamera
          slot={cameraSlot}
          onCapture={handleCameraCapture}
          onCancel={handleCameraCancel}
          onFallback={handleCameraFallback}
        />
      )}

      {capturePreview && (
        <PreviewOverlay
          slot={capturePreview.slot}
          localUrl={capturePreview.localUrl}
          onConfirm={confirmPhoto}
          onRetake={retakePhoto}
          confirming={confirming}
        />
      )}
    </div>
  );
}
