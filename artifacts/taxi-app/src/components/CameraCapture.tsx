import { useEffect, useRef, useState, useCallback } from "react";
import { X, Camera, RotateCcw, Check, Loader2 } from "lucide-react";

type Mode = "selfie" | "car";

interface Props {
  mode: Mode;
  lang: string;
  onCancel: () => void;
  onCapture: (file: File) => void | Promise<void>;
}

const TXT = {
  selfie: {
    ru: "Совместите лицо с овалом",
    uz: "Yuzingizni oval ichiga joylashtiring",
  },
  car: {
    ru: "Поместите автомобиль в рамку",
    uz: "Avtomobilni ramka ichiga joylashtiring",
  },
  retake: { ru: "Переснять", uz: "Qayta olish" },
  use: { ru: "Использовать", uz: "Ishlatish" },
  cancel: { ru: "Отмена", uz: "Bekor qilish" },
  noCamera: {
    ru: "Камера недоступна. Используйте загрузку файла.",
    uz: "Kamera mavjud emas. Faylni yuklang.",
  },
  loading: { ru: "Открываю камеру…", uz: "Kamera ochilmoqda…" },
};
const tr = (k: keyof typeof TXT, lang: string) =>
  (TXT[k] as any)[lang] || (TXT[k] as any).ru;

export default function CameraCapture({ mode, lang, onCancel, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(tr("noCamera", lang));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: mode === "selfie" ? "user" : { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e: any) {
        setError(e?.message || tr("noCamera", lang));
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [mode, lang, stop]);

  const snap = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d")!;
    if (mode === "selfie") {
      // зеркалим селфи как видим в превью
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b!), "image/jpeg", 0.88),
    );
    setSnapshot({ blob, url: URL.createObjectURL(blob) });
  };

  const accept = async () => {
    if (!snapshot) return;
    setBusy(true);
    const file = new File(
      [snapshot.blob],
      `${mode}_${Date.now()}.jpg`,
      { type: "image/jpeg" },
    );
    try {
      await onCapture(file);
    } finally {
      setBusy(false);
      URL.revokeObjectURL(snapshot.url);
      setSnapshot(null);
    }
  };

  const retake = () => {
    if (snapshot) URL.revokeObjectURL(snapshot.url);
    setSnapshot(null);
  };

  const cancel = () => {
    stop();
    if (snapshot) URL.revokeObjectURL(snapshot.url);
    onCancel();
  };

  // fallback на нативный input
  if (error) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-6 text-white">
        <p className="text-center mb-6 text-lg">{error}</p>
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture={mode === "selfie" ? "user" : "environment"}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setBusy(true);
              Promise.resolve(onCapture(f)).finally(() => setBusy(false));
            }
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fallbackInputRef.current?.click()}
          disabled={busy}
          className="px-6 py-3 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center gap-2"
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
          {tr(mode === "selfie" ? "selfie" : "car", lang)}
        </button>
        <button onClick={cancel} className="mt-4 text-white/70 underline text-sm">
          {tr("cancel", lang)}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Видео или превью */}
      <div className="relative flex-1 overflow-hidden">
        {snapshot ? (
          <img src={snapshot.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${mode === "selfie" ? "scale-x-[-1]" : ""}`}
          />
        )}

        {!ready && !snapshot && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
            <Loader2 className="w-10 h-10 animate-spin" />
            <span className="ml-3">{tr("loading", lang)}</span>
          </div>
        )}

        {/* Overlay-шаблон (только в режиме live, скрываем при превью) */}
        {!snapshot && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <defs>
              <mask id="mk">
                <rect width="100" height="100" fill="white" />
                {mode === "selfie" ? (
                  <ellipse cx="50" cy="46" rx="22" ry="32" fill="black" />
                ) : (
                  <rect x="8" y="32" width="84" height="36" rx="6" fill="black" />
                )}
              </mask>
            </defs>
            {/* затемнение вокруг рамки */}
            <rect width="100" height="100" fill="rgba(0,0,0,0.55)" mask="url(#mk)" />
            {/* контур рамки */}
            {mode === "selfie" ? (
              <ellipse
                cx="50" cy="46" rx="22" ry="32"
                fill="none"
                stroke="rgba(255,255,255,0.95)"
                strokeWidth="0.5"
                strokeDasharray="2 1"
              />
            ) : (
              <>
                <rect
                  x="8" y="32" width="84" height="36" rx="6"
                  fill="none"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth="0.5"
                  strokeDasharray="2 1"
                />
                {/* схематичный силуэт авто внутри */}
                <path
                  d="M 18 60 L 24 48 L 38 44 L 62 44 L 76 48 L 82 60 L 82 64 L 18 64 Z"
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth="0.4"
                />
                <circle cx="30" cy="64" r="3" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.4" />
                <circle cx="70" cy="64" r="3" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.4" />
              </>
            )}
          </svg>
        )}

        {/* Подсказка */}
        {!snapshot && ready && (
          <div className="absolute top-20 left-0 right-0 text-center text-white text-sm font-bold drop-shadow-lg px-4">
            {tr(mode === "selfie" ? "selfie" : "car", lang)}
          </div>
        )}

        {/* Закрыть */}
        <button
          onClick={cancel}
          className="absolute top-4 right-4 w-11 h-11 rounded-full bg-black/60 text-white flex items-center justify-center backdrop-blur-md active:scale-95"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Нижняя панель управления */}
      <div className="bg-black/95 px-6 py-6 flex items-center justify-around">
        {snapshot ? (
          <>
            <button
              onClick={retake}
              disabled={busy}
              className="flex flex-col items-center gap-1 text-white active:scale-95 disabled:opacity-50"
            >
              <div className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center">
                <RotateCcw className="w-6 h-6" />
              </div>
              <span className="text-xs font-semibold">{tr("retake", lang)}</span>
            </button>
            <button
              onClick={accept}
              disabled={busy}
              className="flex flex-col items-center gap-1 text-white active:scale-95"
            >
              <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-2xl shadow-emerald-500/40">
                {busy ? (
                  <Loader2 className="w-8 h-8 animate-spin" />
                ) : (
                  <Check className="w-9 h-9" />
                )}
              </div>
              <span className="text-xs font-bold">{tr("use", lang)}</span>
            </button>
            <div className="w-14" />
          </>
        ) : (
          <>
            <div className="w-14" />
            <button
              onClick={snap}
              disabled={!ready}
              className="w-20 h-20 rounded-full bg-white border-4 border-white/30 active:scale-90 transition-transform disabled:opacity-50 shadow-2xl"
              aria-label="Capture"
            >
              <div className="w-full h-full rounded-full border-2 border-zinc-800/30" />
            </button>
            <div className="w-14" />
          </>
        )}
      </div>
    </div>
  );
}
