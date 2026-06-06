import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { X, Check, ChevronLeft, ChevronRight, Video, Image } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface NewsItem {
  id: number;
  title: string;
  content: string;
  photos: string[];
  videoUrl: string | null;
  audience: string;
  createdAt: string;
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
    if (u.hostname.includes("youtube.com")) videoId = u.searchParams.get("v") || "";
    else if (u.hostname.includes("youtu.be")) videoId = u.pathname.slice(1);
    if (videoId) return `https://www.youtube.com/embed/${videoId}`;
  } catch {}
  return null;
}

export function NewsModal() {
  const { token, user } = useAuth();
  const [unread, setUnread] = useState<NewsItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);

  const fetchUnread = useCallback(async () => {
    if (!token || !user) return;
    try {
      const res = await fetch(`${BASE_URL}/api/news/unread`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          setUnread(data.items);
          setCurrentIdx(0);
          setPhotoIdx(0);
          setVisible(true);
        }
      }
    } catch {}
  }, [token, user]);

  useEffect(() => {
    const timer = setTimeout(fetchUnread, 2000);
    return () => clearTimeout(timer);
  }, [fetchUnread]);

  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data?.type === "news_published") {
        setTimeout(fetchUnread, 1000);
      }
    };
    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, [fetchUnread]);

  const markRead = async () => {
    const item = unread[currentIdx];
    if (!item) return;

    try {
      await fetch(`${BASE_URL}/api/news/${item.id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
    } catch {}

    if (currentIdx < unread.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setPhotoIdx(0);
    } else {
      setVisible(false);
      setUnread([]);
    }
  };

  if (!visible || unread.length === 0) return null;

  const item = unread[currentIdx];
  const embedUrl = item.videoUrl ? getYoutubeEmbedUrl(item.videoUrl) : null;
  const photos = item.photos || [];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <span className="text-lg">📰</span>
            <span className="text-sm font-bold text-foreground">
              {unread.length > 1 ? `${currentIdx + 1} / ${unread.length}` : "Новость"}
            </span>
          </div>
        </div>

        <div className="p-5">
          <p className="text-xs text-muted-foreground mb-2">
            {new Date(item.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}
          </p>
          <h2 className="text-xl font-bold text-foreground mb-3">{item.title}</h2>
          <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap mb-4">
            {renderContent(item.content)}
          </div>

          {photos.length > 0 && (
            <div className="mb-4">
              <div className="relative">
                <img
                  src={`${BASE_URL}${photos[photoIdx]}`}
                  alt=""
                  className="rounded-xl w-full max-h-64 object-cover border border-border"
                />
                {photos.length > 1 && (
                  <>
                    {photoIdx > 0 && (
                      <button
                        onClick={() => setPhotoIdx(photoIdx - 1)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 text-white rounded-full flex items-center justify-center"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                    )}
                    {photoIdx < photos.length - 1 && (
                      <button
                        onClick={() => setPhotoIdx(photoIdx + 1)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 text-white rounded-full flex items-center justify-center"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                      {photos.map((_, i) => (
                        <span
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full ${i === photoIdx ? "bg-white" : "bg-white/40"}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {embedUrl && (
            <div className="aspect-video rounded-xl overflow-hidden mb-4 border border-border">
              <iframe
                src={embedUrl}
                className="w-full h-full"
                allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              />
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border p-4 rounded-b-2xl">
          <button
            onClick={markRead}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
          >
            <Check className="w-5 h-5" />
            {currentIdx < unread.length - 1 ? "Прочитано — следующая" : "Прочитано"}
          </button>
        </div>
      </div>
    </div>
  );
}
