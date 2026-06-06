import { useState, useEffect, useCallback, useRef } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { useAuth } from "@/hooks/use-auth";
import {
  Plus, Trash2, Edit2, Eye, Send, X, Image, Video, Bold,
  Smile, Users, Globe, Building2, ChevronDown, Loader2, Check,
  Newspaper, Clock, BarChart2
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface NewsItem {
  id: number;
  title: string;
  content: string;
  photos: string[];
  videoUrl: string | null;
  audience: "driver" | "client" | "all";
  cityId: number | null;
  branchId: number | null;
  driverGroupId: number | null;
  isPublished: boolean;
  authorId: number;
  createdAt: string;
  isRead?: boolean;
}

interface City { id: number; name: string; }
interface Branch { id: number; name: string; }
interface DriverGroup { id: number; name: string; label: string; }

const EMOJIS = ["📰", "🚗", "🚕", "✅", "❌", "⚠️", "🎉", "💰", "📢", "🔔", "⭐", "🏆", "📋", "🛡️", "💡", "🎯", "🔥", "👋", "👍", "❤️", "🙏", "🎁", "📌", "🆕"];

export default function DispatcherNews() {
  const { token } = useAuth();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<NewsItem | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [groups, setGroups] = useState<DriverGroup[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewItem, setPreviewItem] = useState<NewsItem | null>(null);
  const [stats, setStats] = useState<Record<number, number>>({});

  const hdrs = useCallback(() => ({
    Authorization: `Bearer ${token}`,
  }), [token]);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/news?limit=100`, { headers: hdrs() });
      if (res.ok) {
        const data = await res.json();
        setNews(data.items || []);
      }
    } catch {} finally { setLoading(false); }
  }, [hdrs]);

  useEffect(() => {
    fetchNews();
    fetch(`${BASE}/api/cities`, { headers: hdrs() }).then(r => r.json()).then(d => setCities(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${BASE}/api/branches`, { headers: hdrs() }).then(r => r.json()).then(d => setBranches(Array.isArray(d) ? d : d.branches || [])).catch(() => {});
    fetch(`${BASE}/api/driver-groups`, { headers: hdrs() }).then(r => r.json()).then(d => setGroups(Array.isArray(d) ? d : [])).catch(() => {});
  }, [fetchNews, hdrs]);

  const deleteNews = async (id: number) => {
    if (!confirm("Удалить новость?")) return;
    await fetch(`${BASE}/api/news/${id}`, { method: "DELETE", headers: hdrs() });
    fetchNews();
  };

  const viewStats = async (id: number) => {
    const res = await fetch(`${BASE}/api/news/${id}/stats`, { headers: hdrs() });
    if (res.ok) {
      const data = await res.json();
      setStats(prev => ({ ...prev, [id]: data.readCount }));
    }
  };

  const openPreview = (item: NewsItem) => {
    setPreviewItem(item);
    setShowPreview(true);
  };

  const fmt = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " +
      dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };

  const audienceLabel = (a: string) => {
    if (a === "driver") return "🚗 Водители";
    if (a === "client") return "👤 Клиенты";
    return "🌐 Все";
  };

  return (
    <DispatcherLayout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Newspaper className="w-7 h-7 text-amber-500" />
            <h1 className="text-2xl font-bold text-gray-900">Новости и уведомления</h1>
          </div>
          <button
            onClick={() => { setEditingItem(null); setShowEditor(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium"
          >
            <Plus className="w-4 h-4" /> Создать новость
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          </div>
        ) : news.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <Newspaper className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg">Нет новостей</p>
            <p className="text-sm mt-1">Создайте первую новость для водителей или клиентов</p>
          </div>
        ) : (
          <div className="space-y-4">
            {news.map(item => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                        {audienceLabel(item.audience)}
                      </span>
                      {item.cityId && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          {cities.find(c => c.id === item.cityId)?.name || `Город #${item.cityId}`}
                        </span>
                      )}
                      {item.driverGroupId && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          {groups.find(g => g.id === item.driverGroupId)?.label || `Группа #${item.driverGroupId}`}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {fmt(item.createdAt)}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">{item.title}</h3>
                    <p className="text-sm text-gray-600 line-clamp-2">{item.content.replace(/<[^>]*>/g, "").substring(0, 200)}</p>
                    {item.photos && item.photos.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {item.photos.slice(0, 4).map((p, i) => (
                          <img key={i} src={`${BASE}${p}`} alt="" className="w-16 h-16 rounded-lg object-cover border" />
                        ))}
                        {item.photos.length > 4 && (
                          <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 text-sm font-medium border">
                            +{item.photos.length - 4}
                          </div>
                        )}
                      </div>
                    )}
                    {item.videoUrl && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-blue-600">
                        <Video className="w-3 h-3" /> Видео прикреплено
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-4 shrink-0">
                    <button onClick={() => openPreview(item)} className="p-2 hover:bg-gray-100 rounded-lg" title="Предпросмотр">
                      <Eye className="w-4 h-4 text-gray-500" />
                    </button>
                    <button onClick={() => { viewStats(item.id); }} className="p-2 hover:bg-gray-100 rounded-lg relative" title="Статистика">
                      <BarChart2 className="w-4 h-4 text-gray-500" />
                      {stats[item.id] !== undefined && (
                        <span className="absolute -top-1 -right-1 text-[10px] bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                          {stats[item.id]}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => { setEditingItem(item); setShowEditor(true); }}
                      className="p-2 hover:bg-gray-100 rounded-lg" title="Редактировать"
                    >
                      <Edit2 className="w-4 h-4 text-gray-500" />
                    </button>
                    <button onClick={() => deleteNews(item.id)} className="p-2 hover:bg-red-50 rounded-lg" title="Удалить">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showEditor && (
        <NewsEditor
          item={editingItem}
          token={token}
          cities={cities}
          branches={branches}
          groups={groups}
          onClose={() => { setShowEditor(false); setEditingItem(null); }}
          onSaved={() => { setShowEditor(false); setEditingItem(null); fetchNews(); }}
        />
      )}

      {showPreview && previewItem && (
        <NewsPreviewModal item={previewItem} onClose={() => { setShowPreview(false); setPreviewItem(null); }} />
      )}
    </DispatcherLayout>
  );
}

function NewsEditor({ item, token, cities, branches, groups, onClose, onSaved }: {
  item: NewsItem | null;
  token: string | null;
  cities: City[];
  branches: Branch[];
  groups: DriverGroup[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item?.title || "");
  const [content, setContent] = useState(item?.content || "");
  const [audience, setAudience] = useState<string>(item?.audience || "all");
  const [cityId, setCityId] = useState<string>(item?.cityId ? String(item.cityId) : "");
  const [branchId, setBranchId] = useState<string>(item?.branchId ? String(item.branchId) : "");
  const [groupId, setGroupId] = useState<string>(item?.driverGroupId ? String(item.driverGroupId) : "");
  const [videoUrl, setVideoUrl] = useState(item?.videoUrl || "");
  const [existingPhotos, setExistingPhotos] = useState<string[]>(item?.photos || []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hdrs = () => ({ Authorization: `Bearer ${token}` });

  const insertEmoji = (emoji: string) => {
    const ta = contentRef.current;
    if (!ta) { setContent(prev => prev + emoji); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newContent = content.substring(0, start) + emoji + content.substring(end);
    setContent(newContent);
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + emoji.length; }, 0);
    setShowEmoji(false);
  };

  const toggleBold = () => {
    const ta = contentRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;
    const selected = content.substring(start, end);
    if (selected.startsWith("**") && selected.endsWith("**")) {
      const newContent = content.substring(0, start) + selected.slice(2, -2) + content.substring(end);
      setContent(newContent);
    } else {
      const newContent = content.substring(0, start) + `**${selected}**` + content.substring(end);
      setContent(newContent);
    }
  };

  const removeExistingPhoto = (idx: number) => {
    setExistingPhotos(prev => prev.filter((_, i) => i !== idx));
  };

  const removeNewFile = (idx: number) => {
    setNewFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);

    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("content", content);
      formData.append("audience", audience);
      if (videoUrl) formData.append("videoUrl", videoUrl);
      if (cityId) formData.append("cityId", cityId);
      if (branchId) formData.append("branchId", branchId);
      if (groupId) formData.append("driverGroupId", groupId);
      formData.append("existingPhotos", JSON.stringify(existingPhotos));

      for (const file of newFiles) {
        formData.append("photos", file);
      }

      const url = item ? `${BASE}/api/news/${item.id}` : `${BASE}/api/news`;
      const method = item ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        onSaved();
      } else {
        const err = await res.json();
        alert(err.error || "Ошибка сохранения");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <h2 className="text-lg font-bold text-gray-900">
            {item ? "Редактировать новость" : "Создать новость"}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Заголовок</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Введите заголовок новости..."
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Аудитория</label>
            <div className="flex gap-2">
              {[
                { value: "all", label: "🌐 Все", color: "amber" },
                { value: "driver", label: "🚗 Водители", color: "blue" },
                { value: "client", label: "👤 Клиенты", color: "green" },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setAudience(opt.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    audience === opt.value
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {(audience === "driver" || audience === "all") && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-blue-50 rounded-lg">
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">Город (необязательно)</label>
                <select value={cityId} onChange={e => setCityId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-blue-200 rounded text-sm bg-white">
                  <option value="">Все города</option>
                  {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">Филиал (необязательно)</label>
                <select value={branchId} onChange={e => setBranchId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-blue-200 rounded text-sm bg-white">
                  <option value="">Все филиалы</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">Группа водителей</label>
                <select value={groupId} onChange={e => setGroupId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-blue-200 rounded text-sm bg-white">
                  <option value="">Все группы</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Текст новости</label>
            <div className="flex items-center gap-1 mb-1">
              <button onClick={toggleBold} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="Жирный текст">
                <Bold className="w-4 h-4" />
              </button>
              <div className="relative">
                <button onClick={() => setShowEmoji(!showEmoji)} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="Эмодзи">
                  <Smile className="w-4 h-4" />
                </button>
                {showEmoji && (
                  <div className="absolute top-full left-0 z-20 bg-white border rounded-lg shadow-lg p-2 grid grid-cols-8 gap-1 w-64">
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => insertEmoji(e)} className="text-xl hover:bg-gray-100 rounded p-1">
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <textarea
              ref={contentRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={6}
              placeholder="Напишите текст новости... Используйте **жирный** для выделения"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm resize-y"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Фотографии (до 10)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {existingPhotos.map((p, i) => (
                <div key={`ex-${i}`} className="relative group">
                  <img src={`${BASE}${p}`} alt="" className="w-20 h-20 rounded-lg object-cover border" />
                  <button onClick={() => removeExistingPhoto(i)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {newFiles.map((f, i) => (
                <div key={`new-${i}`} className="relative group">
                  <img src={URL.createObjectURL(f)} alt="" className="w-20 h-20 rounded-lg object-cover border" />
                  <button onClick={() => removeNewFile(i)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {(existingPhotos.length + newFiles.length) < 10 && (
                <button onClick={() => fileRef.current?.click()}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center hover:border-amber-500 hover:bg-amber-50 transition-colors">
                  <Image className="w-6 h-6 text-gray-400" />
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => {
                if (e.target.files) {
                  const arr = Array.from(e.target.files).slice(0, 10 - existingPhotos.length - newFiles.length);
                  setNewFiles(prev => [...prev, ...arr]);
                }
                e.target.value = "";
              }}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              <Video className="w-4 h-4 inline mr-1" /> Видео (YouTube ссылка)
            </label>
            <input
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {item ? "Сохранить" : "Опубликовать"}
          </button>
        </div>
      </div>
    </div>
  );
}

function renderContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
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

function NewsPreviewModal({ item, onClose }: { item: NewsItem; onClose: () => void }) {
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const embedUrl = item.videoUrl ? getYoutubeEmbedUrl(item.videoUrl) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Предпросмотр</span>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">{item.title}</h2>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mb-4">
            {renderContent(item.content)}
          </div>
          {item.photos && item.photos.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {item.photos.map((p, i) => (
                <img key={i} src={`${BASE}${p}`} alt="" className="rounded-lg object-cover w-full h-40 border" />
              ))}
            </div>
          )}
          {embedUrl && (
            <div className="aspect-video rounded-lg overflow-hidden mb-4 border">
              <iframe src={embedUrl} className="w-full h-full" allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
            </div>
          )}
          <div className="text-center mt-4">
            <button className="px-6 py-2.5 bg-amber-500 text-white rounded-lg text-sm font-medium">
              ✅ Прочитано
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
