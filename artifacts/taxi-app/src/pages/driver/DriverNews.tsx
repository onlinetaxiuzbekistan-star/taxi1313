import { useState, useEffect, useCallback } from "react";
import DriverLayout from "./DriverLayout";
import { useAuth } from "@/hooks/use-auth";
import { useSettingsStore } from "@/stores/settings";
import { ArrowLeft, Newspaper, Clock, Check, Video, Image } from "lucide-react";
import { useLocation } from "wouter";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface NewsItem {
  id: number;
  title: string;
  content: string;
  photos: string[];
  videoUrl: string | null;
  audience: string;
  createdAt: string;
  isRead?: boolean;
}

const T: Record<string, Record<string, string>> = {
  news: { ru: "Новости", uz: "Yangiliklar" },
  back: { ru: "Назад", uz: "Orqaga" },
  noNews: { ru: "Нет новостей", uz: "Yangiliklar yo'q" },
  markRead: { ru: "Прочитано", uz: "O'qildi" },
  alreadyRead: { ru: "Прочитано ✓", uz: "O'qildi ✓" },
};

function t(key: string, lang: string) {
  return T[key]?.[lang] || T[key]?.ru || key;
}

function renderContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function getYoutubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    let videoId = "";
    if (u.hostname.includes("youtube.com")) {
      videoId = u.searchParams.get("v") || "";
    } else if (u.hostname.includes("youtu.be")) {
      videoId = u.pathname.slice(1);
    }
    if (videoId) return `https://www.youtube.com/embed/${videoId}`;
  } catch {}
  return null;
}

export default function DriverNews() {
  const { token } = useAuth();
  const lang = useSettingsStore(s => s.language);
  const [, navigate] = useLocation();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<NewsItem | null>(null);

  const hdrs = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }), [token]);

  useEffect(() => {
    fetch(`${BASE_URL}/api/news?audience=driver&limit=50`, { headers: hdrs() })
      .then(r => r.json())
      .then(d => setNews(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hdrs]);

  const markRead = async (id: number) => {
    await fetch(`${BASE_URL}/api/news/${id}/read`, { method: "POST", headers: hdrs() });
    setNews(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setSelectedItem(null);
  };

  const fmt = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) + " " +
      dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };

  if (selectedItem) {
    const embedUrl = selectedItem.videoUrl ? getYoutubeEmbedUrl(selectedItem.videoUrl) : null;
    return (
      <DriverLayout>
        <div className="p-4 max-w-lg mx-auto pb-24">
          <button onClick={() => setSelectedItem(null)} className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
            <ArrowLeft className="w-4 h-4" /> {t("back", lang)}
          </button>

          <div className="bg-card border border-border rounded-2xl p-5">
            <p className="text-xs text-muted-foreground mb-2">{fmt(selectedItem.createdAt)}</p>
            <h2 className="text-lg font-bold text-foreground mb-3">{selectedItem.title}</h2>
            <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap mb-4">
              {renderContent(selectedItem.content)}
            </div>

            {selectedItem.photos && selectedItem.photos.length > 0 && (
              <div className="space-y-2 mb-4">
                {selectedItem.photos.map((p, i) => (
                  <img key={i} src={`${BASE_URL}${p}`} alt="" className="rounded-xl w-full object-cover border border-border" />
                ))}
              </div>
            )}

            {embedUrl && (
              <div className="aspect-video rounded-xl overflow-hidden mb-4 border border-border">
                <iframe src={embedUrl} className="w-full h-full" allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
              </div>
            )}

            {!selectedItem.isRead ? (
              <button
                onClick={() => markRead(selectedItem.id)}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> {t("markRead", lang)}
              </button>
            ) : (
              <div className="text-center text-sm text-zinc-600 font-medium py-2">
                {t("alreadyRead", lang)}
              </div>
            )}
          </div>
        </div>
      </DriverLayout>
    );
  }

  return (
    <DriverLayout>
      <div className="p-4 max-w-lg mx-auto pb-24">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => navigate("/driver/profile")} className="p-1">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <Newspaper className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">{t("news", lang)}</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : news.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">{t("noNews", lang)}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {news.map(item => (
              <button
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className={`w-full text-left bg-card border rounded-2xl p-4 hover:bg-muted/30 active:scale-[0.98] transition-all ${
                  item.isRead ? "border-border opacity-70" : "border-primary/30 shadow-sm"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {!item.isRead && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      )}
                      <h3 className="text-sm font-semibold text-foreground truncate">{item.title}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {item.content.replace(/<[^>]*>/g, "").replace(/\*\*/g, "").substring(0, 120)}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {fmt(item.createdAt)}
                      </span>
                      {item.photos && item.photos.length > 0 && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Image className="w-3 h-3" /> {item.photos.length}
                        </span>
                      )}
                      {item.videoUrl && (
                        <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                          <Video className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                  {item.photos && item.photos.length > 0 && (
                    <img src={`${BASE_URL}${item.photos[0]}`} alt="" className="w-14 h-14 rounded-lg object-cover border border-border shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </DriverLayout>
  );
}
