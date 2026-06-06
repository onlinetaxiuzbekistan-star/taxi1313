import { useState, type ReactNode } from "react";
import { User, Car, Camera, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CameraCapture from "@/components/CameraCapture";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type Lang = string;
const tx = {
  changePhoto: { ru: "Изменить фото", uz: "Suratni o'zgartirish" },
  driverPhoto: { ru: "Фото водителя", uz: "Haydovchi surati" },
  carPhoto: { ru: "Фото автомобиля", uz: "Avtomobil surati" },
  selfieHint: { ru: "Передняя камера (селфи)", uz: "Old kamera (selfi)" },
  rearHint: { ru: "Задняя камера", uz: "Orqa kamera" },
  cancel: { ru: "Отмена", uz: "Bekor qilish" },
  uploaded: { ru: "Фото обновлено", uz: "Surat yangilandi" },
  err: { ru: "Ошибка загрузки фото", uz: "Surat yuklashda xatolik" },
  net: { ru: "Сетевая ошибка", uz: "Tarmoq xatosi" },
};
const tr = (k: keyof typeof tx, l: Lang) => (tx[k] as any)[l] || (tx[k] as any).ru;

interface Props {
  token: string;
  lang: Lang;
  onSuccess: () => void;
  children: (open: () => void, uploading: boolean) => ReactNode;
}

export default function PhotoEditTrigger({ token, lang, onSuccess, children }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<null | "driver" | "car">(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const open = () => setSheetOpen(true);

  const choose = (kind: "driver" | "car") => {
    setSheetOpen(false);
    setCameraMode(kind);
  };

  const upload = async (kind: "driver" | "car", file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      fd.append("type", kind);
      const res = await fetch(`${BASE_URL}/api/drivers/upload-my-photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.ok) {
        await res.json();
        onSuccess();
        toast({ title: tr("uploaded", lang) });
        setCameraMode(null);
      } else {
        toast({ variant: "destructive", title: tr("err", lang) });
      }
    } catch {
      toast({ variant: "destructive", title: tr("net", lang) });
    }
    setUploading(false);
  };

  return (
    <>
      {children(open, uploading)}

      {cameraMode && (
        <CameraCapture
          mode={cameraMode === "driver" ? "selfie" : "car"}
          lang={lang}
          onCancel={() => setCameraMode(null)}
          onCapture={(file) => upload(cameraMode, file)}
        />
      )}

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-in fade-in"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="bg-card rounded-t-3xl w-full max-w-md p-4 space-y-3 animate-in slide-in-from-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1.5 rounded-full bg-muted mx-auto mb-2" />
            <h3 className="text-lg font-extrabold text-center mb-3">{tr("changePhoto", lang)}</h3>

            <button
              onClick={() => choose("driver")}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-muted/60 hover:bg-muted active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                <User className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-base">{tr("driverPhoto", lang)}</p>
                <p className="text-xs text-muted-foreground">{tr("selfieHint", lang)}</p>
              </div>
              <Camera className="w-5 h-5 text-muted-foreground" />
            </button>

            <button
              onClick={() => choose("car")}
              className="w-full flex items-center gap-3 p-4 rounded-2xl bg-muted/60 hover:bg-muted active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                <Car className="w-6 h-6 text-emerald-600" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-base">{tr("carPhoto", lang)}</p>
                <p className="text-xs text-muted-foreground">{tr("rearHint", lang)}</p>
              </div>
              <Camera className="w-5 h-5 text-muted-foreground" />
            </button>

            <button
              onClick={() => setSheetOpen(false)}
              className="w-full py-3 rounded-2xl bg-muted text-foreground font-bold text-sm active:scale-[0.97] transition-transform"
            >
              {tr("cancel", lang)}
            </button>

            {uploading && (
              <div className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
