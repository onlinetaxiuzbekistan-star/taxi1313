import { useState, useEffect, useCallback, useRef } from "react";
import DispatcherLayout from "./DispatcherLayout";
import { useAuth } from "@/hooks/use-auth";
import {
  Send, X, Image, Bold, Smile, Loader2, Bell, Clock, Users,
  Trash2, CheckCircle, ChevronDown, Video
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface PushItem {
  id: number;
  title: string;
  content: string;
  photos: string[];
  videoUrl: string | null;
  audience: "driver" | "client" | "all";
  cityId: number | null;
  branchId: number | null;
  driverGroupId: number | null;
  authorId: number;
  sentCount: number;
  deliveredCount: number;
  createdAt: string;
}

interface City { id: number; name: string; }
interface Branch { id: number; name: string; }
interface DriverGroup { id: number; name: string; label: string; }

const EMOJIS = ["📢", "🔔", "🚗", "🚕", "⚡", "🔥", "💰", "📈", "⬆️", "🏆", "✅", "⚠️", "❗", "🎯", "💡", "🎉", "👋", "❤️", "🙏", "📌", "🆕", "⭐", "🛡️", "🎁"];

export default function PushNotifications() {
  const { token } = useAuth();
  const [history, setHistory] = useState<PushItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [cities, setCities] = useState<City[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [groups, setGroups] = useState<DriverGroup[]>([]);

  const hdrs = useCallback(() => ({
    Authorization: `Bearer ${token}`,
  }), [token]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/push-notifications?limit=100`, { headers: hdrs() });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.items || []);
      }
    } catch {} finally { setLoading(false); }
  }, [hdrs]);

  useEffect(() => {
    fetchHistory();
    fetch(`${BASE}/api/cities`, { headers: hdrs() }).then(r => r.json()).then(d => setCities(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${BASE}/api/branches`, { headers: hdrs() }).then(r => r.json()).then(d => setBranches(Array.isArray(d) ? d : d.branches || [])).catch(() => {});
    fetch(`${BASE}/api/driver-groups`, { headers: hdrs() }).then(r => r.json()).then(d => setGroups(Array.isArray(d) ? d : [])).catch(() => {});
  }, [fetchHistory, hdrs]);

  const deleteItem = async (id: number) => {
    if (!confirm("Удалить запись?")) return;
    await fetch(`${BASE}/api/push-notifications/${id}`, { method: "DELETE", headers: hdrs() });
    fetchHistory();
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
            <Bell className="w-7 h-7 text-blue-500" />
            <h1 className="text-2xl font-bold text-gray-900">Пуш-уведомления</h1>
          </div>
          <button
            onClick={() => setShowComposer(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium"
          >
            <Send className="w-4 h-4" /> Отправить пуш
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <Bell className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg">Нет отправленных уведомлений</p>
            <p className="text-sm mt-1">Отправьте первый пуш водителям или клиентам</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map(item => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                        {audienceLabel(item.audience)}
                      </span>
                      {item.cityId != null && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                          {cities.find(c => c.id === item.cityId)?.name || `Город #${item.cityId}`}
                        </span>
                      )}
                      {item.driverGroupId != null && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                          {groups.find(g => g.id === item.driverGroupId)?.label || `Группа #${item.driverGroupId}`}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {fmt(item.createdAt)}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 mb-0.5">{item.title}</h3>
                    <p className="text-sm text-gray-600 line-clamp-2">{item.content.replace(/\*\*/g, "").substring(0, 200)}</p>
                    {item.photos && item.photos.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {item.photos.slice(0, 3).map((p, i) => (
                          <img key={i} src={`${BASE}${p}`} alt="" className="w-14 h-14 rounded-lg object-cover border" />
                        ))}
                        {item.photos.length > 3 && (
                          <div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 text-xs font-medium border">
                            +{item.photos.length - 3}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Send className="w-3 h-3" /> Отправлено: {item.sentCount || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" /> Доставлено: {item.deliveredCount || 0}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => deleteItem(item.id)} className="p-2 hover:bg-red-50 rounded-lg ml-2 shrink-0" title="Удалить">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showComposer && (
        <PushComposer
          token={token}
          cities={cities}
          branches={branches}
          groups={groups}
          onClose={() => setShowComposer(false)}
          onSent={() => { setShowComposer(false); fetchHistory(); }}
        />
      )}
    </DispatcherLayout>
  );
}

function PushComposer({ token, cities, branches, groups, onClose, onSent }: {
  token: string | null;
  cities: City[];
  branches: Branch[];
  groups: DriverGroup[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState<string>("all");
  const [cityId, setCityId] = useState<string>("");
  const [branchId, setBranchId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState("");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; delivered: number } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      setContent(content.substring(0, start) + selected.slice(2, -2) + content.substring(end));
    } else {
      setContent(content.substring(0, start) + `**${selected}**` + content.substring(end));
    }
  };

  const removeFile = (idx: number) => {
    setNewFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async () => {
    if (!title.trim() || !content.trim()) return;
    setSending(true);

    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("content", content);
      formData.append("audience", audience);
      if (videoUrl) formData.append("videoUrl", videoUrl);
      if (cityId) formData.append("cityId", cityId);
      if (branchId) formData.append("branchId", branchId);
      if (groupId) formData.append("driverGroupId", groupId);

      for (const file of newFiles) {
        formData.append("photos", file);
      }

      const res = await fetch(`${BASE}/api/push-notifications/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setResult({ sent: data.sentCount || 0, delivered: data.deliveredCount || 0 });
        setTimeout(() => onSent(), 2000);
      } else {
        const err = await res.json();
        alert(err.error || "Ошибка отправки");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl w-full max-w-md p-8 text-center shadow-2xl">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Пуш отправлен!</h3>
          <div className="flex justify-center gap-6 text-sm text-gray-600">
            <div>
              <div className="text-2xl font-bold text-blue-600">{result.sent}</div>
              <div>Отправлено</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{result.delivered}</div>
              <div>Доставлено</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-bold text-gray-900">Отправить пуш-уведомление</h2>
          </div>
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
              placeholder="Например: ⚡ Час пик! Цены выросли"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Кому отправить</label>
            <div className="flex gap-2">
              {[
                { value: "all", label: "🌐 Все" },
                { value: "driver", label: "🚗 Водители" },
                { value: "client", label: "👤 Клиенты" },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setAudience(opt.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    audience === opt.value
                      ? "bg-blue-500 text-white border-blue-500"
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
                <label className="text-xs font-medium text-blue-700 block mb-1">Город</label>
                <select value={cityId} onChange={e => setCityId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-blue-200 rounded text-sm bg-white">
                  <option value="">Все города</option>
                  {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-blue-700 block mb-1">Филиал</label>
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
            <label className="text-sm font-medium text-gray-700 block mb-1">Текст уведомления</label>
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
              rows={5}
              placeholder="Например: Заходите на линию! Сейчас час пик, цены увеличены ⬆️&#10;**Не упустите возможность заработать!**"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-y"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Фотографии (до 10)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {newFiles.map((f, i) => (
                <div key={i} className="relative group">
                  <img src={URL.createObjectURL(f)} alt="" className="w-20 h-20 rounded-lg object-cover border" />
                  <button onClick={() => removeFile(i)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {newFiles.length < 10 && (
                <button onClick={() => fileRef.current?.click()}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center hover:border-blue-500 hover:bg-blue-50 transition-colors">
                  <Image className="w-6 h-6 text-gray-400" />
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => {
                if (e.target.files) {
                  const arr = Array.from(e.target.files).slice(0, 10 - newFiles.length);
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
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between rounded-b-2xl">
          <p className="text-xs text-gray-400">
            Пуш будет немедленно отправлен всем получателям
          </p>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
              Отмена
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !title.trim() || !content.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm font-medium"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Отправить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
