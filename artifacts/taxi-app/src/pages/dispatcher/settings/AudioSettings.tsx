import { useState, useEffect, useRef } from "react";
import { Upload, Trash2, Play, Pause, FileAudio, Loader2, XCircle, UserMinus, ArrowLeftRight } from "lucide-react";
import { SettingsPageLayout } from "./SettingsPageLayout";
import { toast } from "@/hooks/use-toast";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type AudioKind = "trip-started" | "cancel" | "unassign" | "seat-changed";

interface AudioSlot {
  kind: AudioKind;
  title: string;
  subtitle: string;
  icon: any;
  iconColor: string;
  bgColor: string;
}

const SLOTS: AudioSlot[] = [
  { kind: "trip-started", title: "Начало поездки",   subtitle: "Играет водителю после посадки последнего пассажира", icon: FileAudio, iconColor: "text-purple-600", bgColor: "bg-purple-500/10" },
  { kind: "cancel",       title: "Отмена заказа",    subtitle: "Играет водителю когда диспетчер отменяет заказ",     icon: XCircle,   iconColor: "text-red-600",    bgColor: "bg-red-500/10" },
  { kind: "unassign",     title: "Снятие заказа",    subtitle: "Играет водителю когда диспетчер снимает заказ",       icon: UserMinus, iconColor: "text-orange-600", bgColor: "bg-orange-500/10" },
  { kind: "seat-changed", title: "Смена места",      subtitle: "Играет водителю когда диспетчер меняет место пассажира", icon: ArrowLeftRight, iconColor: "text-blue-600",    bgColor: "bg-blue-500/10" },
];

function AudioCard({ slot }: { slot: AudioSlot }) {
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken") || ""}` });

  const load = async () => {
    try {
      const r = await fetch(`${BASE}/api/audio-files/${slot.kind}`, { headers: auth() });
      if (r.ok) { const d = await r.json(); setUrl(d.url || null); setName(d.name || null); }
    } catch {}
  };
  useEffect(() => { load(); }, [slot.kind]);

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("audio", file);
      const r = await fetch(`${BASE}/api/audio-files/${slot.kind}`, { method: "POST", headers: auth(), body: fd });
      const d = await r.json();
      if (r.ok) { toast({ title: "Аудио загружено" }); setUrl(d.url); setName(d.name); }
      else toast({ variant: "destructive", title: d.message || "Ошибка загрузки" });
    } catch (e: any) {
      toast({ variant: "destructive", title: e?.message || "Ошибка сети" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    if (!confirm("Удалить аудио файл?")) return;
    try {
      const r = await fetch(`${BASE}/api/audio-files/${slot.kind}`, { method: "DELETE", headers: auth() });
      if (r.ok) { setUrl(null); setName(null); toast({ title: "Удалено" }); }
    } catch {}
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  };

  const Icon = slot.icon;
  return (
    <div className="bg-card rounded-2xl border border-border p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl ${slot.bgColor} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${slot.iconColor}`} />
        </div>
        <div>
          <h3 className="font-semibold">{slot.title}</h3>
          <p className="text-xs text-muted-foreground">{slot.subtitle}</p>
        </div>
      </div>
      {url ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted">
            <button onClick={togglePlay} className="w-11 h-11 rounded-full bg-purple-600 text-white flex items-center justify-center active:scale-95">
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{name || slot.kind}</div>
              <div className="text-xs text-muted-foreground truncate">{url}</div>
            </div>
            <button onClick={handleDelete} className="w-9 h-9 rounded-lg bg-red-500/10 text-red-600 flex items-center justify-center active:scale-95">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <audio ref={audioRef} src={url} onEnded={() => setPlaying(false)} preload="metadata" />
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="w-full h-11 rounded-xl border border-dashed border-border text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : "Заменить файл"}
          </button>
        </div>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full h-24 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 hover:bg-muted disabled:opacity-50">
          {uploading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : (
            <>
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm font-medium">Загрузить mp3 / wav</span>
              <span className="text-xs text-muted-foreground">До 5 МБ</span>
            </>
          )}
        </button>
      )}
      <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
    </div>
  );
}

export default function AudioSettings() {
  return (
    <SettingsPageLayout title="Аудио файлы" subtitle="Звуковые подсказки для водителей">
      <div className="space-y-4">
        {SLOTS.map(s => <AudioCard key={s.kind} slot={s} />)}
      </div>
    </SettingsPageLayout>
  );
}
