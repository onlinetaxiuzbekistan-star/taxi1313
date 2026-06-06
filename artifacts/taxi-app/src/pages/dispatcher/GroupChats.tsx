import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGroupChatList, useGroupChat, type GroupChatInfo, type GroupChatMessage } from "@/hooks/use-group-chat";
import VoiceCallModal from "@/components/VoiceCallModal";
import { Plus, Users, MessageCircle, Send, Loader2, X, ArrowLeft, Mic, Pause, Play, Smile, Image as ImageIcon, Check, CheckCheck, Trash2, Settings, Phone, Camera, MicOff } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const EMOJI_LIST = [
  "😀","😂","🤣","😊","😍","🥰","😘","😎","🤔","😢",
  "😭","😤","🤯","🥳","😴","🤮","👍","👎","👏","🙏",
  "❤️","🔥","⭐","✅","❌","🚗","🚕","🏠","📍","💰",
  "⏰","📞","💬","🎉","👋","🤝","💪","🙌","😅","🤗",
];

function formatDateSeparator(dateStr: string) {
  try {
    const d = new Date(dateStr);
    if (isToday(d)) return "Сегодня";
    if (isYesterday(d)) return "Вчера";
    return format(d, "d MMMM yyyy", { locale: ru });
  } catch { return ""; }
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function GroupChats() {
  const { token, user } = useAuth();
  const { chats, loading, refresh } = useGroupChatList(token);
  const [selectedChat, setSelectedChat] = useState<GroupChatInfo | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="h-full flex flex-col bg-background">
      {selectedChat ? (
        <GroupChatView
          chat={selectedChat}
          token={token}
          myUserId={user?.id}
          myRole={user?.role || ""}
          onBack={() => { setSelectedChat(null); refresh(); }}
        />
      ) : (
        <>
          <div className="shrink-0 bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-white">Группы</h1>
              <button
                onClick={() => setShowCreate(true)}
                className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center active:scale-90 transition-all"
              >
                <Plus className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!loading && chats.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
                  <Users className="w-8 h-8 text-emerald-500" />
                </div>
                <p className="text-sm font-semibold">Нет групповых чатов</p>
                <p className="text-xs text-muted-foreground mt-1">Создайте первый групповой чат</p>
              </div>
            )}

            {chats.map(chat => (
              <button
                key={chat.id}
                onClick={() => setSelectedChat(chat)}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/50 active:bg-muted transition-colors text-left"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Users className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm truncate">{chat.name}</p>
                    {chat.lastMessageAt && (
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                        {formatTime(chat.lastMessageAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">
                      {chat.lastMessage
                        ? `${chat.lastSenderName?.split(" ")[0] || ""}: ${chat.lastMessage}`
                        : `${chat.memberCount} участник${chat.memberCount < 5 ? "а" : "ов"}`}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {showCreate && (
            <CreateGroupChatDialog
              token={token}
              onClose={() => setShowCreate(false)}
              onCreated={() => { setShowCreate(false); refresh(); }}
            />
          )}
        </>
      )}
    </div>
  );
}

function formatTime(dateStr: string) {
  try {
    const d = new Date(dateStr);
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Вчера";
    return format(d, "dd.MM");
  } catch { return ""; }
}

function CreateGroupChatDialog({ token, onClose, onCreated }: { token: string | null; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [chatType, setChatType] = useState("custom");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [cities, setCities] = useState<any[]>([]);
  const [driverGroups, setDriverGroups] = useState<any[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);
  const [driverGroupId, setDriverGroupId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/cities`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setCities(d.cities || d || [])).catch(() => {});
    fetch(`${API_BASE}/driver-groups`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setDriverGroups(d.groups || d || [])).catch(() => {});
  }, [token]);

  const handleCreate = async () => {
    if (!token || !name.trim()) return;
    setCreating(true);
    try {
      const body: any = { name: name.trim(), chatType, description };
      if (chatType === "city" && cityId) body.cityId = cityId;
      if (chatType === "driver_group" && driverGroupId) body.driverGroupId = driverGroupId;

      const res = await fetch(`${API_BASE}/group-chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) onCreated();
    } catch {} finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-bold text-base">Новая группа</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Название</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Например: Водители Ташкент"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Тип группы</label>
            <select
              value={chatType}
              onChange={e => setChatType(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none"
            >
              <option value="custom">Пользовательская</option>
              <option value="city">По городу</option>
              <option value="driver_group">По группе водителей</option>
            </select>
          </div>
          {chatType === "city" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Город</label>
              <select
                value={cityId || ""}
                onChange={e => setCityId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none"
              >
                <option value="">Выберите город</option>
                {cities.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name || c.nameRu}</option>
                ))}
              </select>
            </div>
          )}
          {chatType === "driver_group" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Группа</label>
              <select
                value={driverGroupId || ""}
                onChange={e => setDriverGroupId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none"
              >
                <option value="">Выберите группу</option>
                {driverGroups.map((g: any) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Описание (необязательно)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Описание группы"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>
        </div>
        <div className="px-4 py-3 border-t border-border flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupChatView({ chat, token, myUserId, onBack, myRole }: {
  chat: GroupChatInfo;
  token: string | null;
  myUserId: number | undefined;
  myRole: string;
  onBack: () => void;
}) {
  const { messages, loading, sending, sendMessage, sendPhoto, sendVoice, updateSettings } = useGroupChat(token, myUserId, chat.id);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ file: File; url: string } | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ photosEnabled: chat.photosEnabled ?? true, voiceEnabled: chat.voiceEnabled ?? true, callsEnabled: chat.callsEnabled ?? true });
  const isDispatcher = myRole === "dispatcher" || myRole === "admin";

  const [callState, setCallState] = useState<{ open: boolean; incoming: boolean; peerId: number; peerName: string; offer?: RTCSessionDescriptionInit | null }>({ open: false, incoming: false, peerId: 0, peerName: "" });
  const callWsRef = useRef<WebSocket | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingTimeRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    setTimeout(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: smooth ? "smooth" : "instant" });
    }, 50);
  }, []);

  useEffect(() => { scrollToBottom(false); }, [loading]);
  useEffect(() => { scrollToBottom(true); }, [messages.length]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, []);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg) return;
    setText("");
    setShowEmoji(false);
    await sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview({ file, url: URL.createObjectURL(file) });
    e.target.value = "";
  };

  const handleSendPhoto = async () => {
    if (!photoPreview) return;
    const caption = text.trim();
    setText("");
    await sendPhoto(photoPreview.file, caption || undefined);
    URL.revokeObjectURL(photoPreview.url);
    setPhotoPreview(null);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const dur = recordingTimeRef.current;
        if (blob.size > 0 && dur > 0) await sendVoice(blob, dur);
        chunksRef.current = [];
      };
      recorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimeRef.current = 0;
      recordingTimerRef.current = setInterval(() => { recordingTimeRef.current += 1; setRecordingTime(recordingTimeRef.current); }, 1000);
    } catch {}
  };

  const stopRecording = (cancel = false) => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      if (cancel) { mediaRecorderRef.current.ondataavailable = null; mediaRecorderRef.current.onstop = null; }
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  const ROLE_COLORS: Record<string, string> = { driver: "#059669", dispatcher: "#6366f1", admin: "#dc2626" };

  const items: Array<{ type: "date"; label: string } | { type: "msg"; msg: GroupChatMessage }> = [];
  let lastDate = "";
  for (const msg of messages) {
    const msgDate = msg.createdAt ? new Date(msg.createdAt).toDateString() : "";
    if (msgDate && msgDate !== lastDate) { items.push({ type: "date", label: formatDateSeparator(msg.createdAt) }); lastDate = msgDate; }
    items.push({ type: "msg", msg });
  }

  const handleToggleSetting = async (key: "photosEnabled" | "voiceEnabled" | "callsEnabled") => {
    const newVal = !settings[key];
    setSettings(prev => ({ ...prev, [key]: newVal }));
    await updateSettings({ [key]: newVal });
  };

  useEffect(() => {
    if (!token) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const base = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") || "";
    const wsUrl = `${protocol}//${window.location.host}${base}/api/ws`;
    const ws = new WebSocket(wsUrl);
    callWsRef.current = ws;
    ws.onopen = () => { ws.send(JSON.stringify({ type: "auth", token })); };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "call_offer" && !callState.open) {
          setCallState({ open: true, incoming: true, peerId: data.fromUserId, peerName: data.fromUserName || "Звонок", offer: data.sdp });
        }
        window.dispatchEvent(new CustomEvent("buxtaxi:ws", { detail: data }));
      } catch {}
    };
    return () => { ws.close(); callWsRef.current = null; };
  }, [token]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-white truncate">{chat.name}</p>
            <p className="text-[11px] text-emerald-100">{chat.memberCount} участник{chat.memberCount < 5 ? "а" : "ов"}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {settings.callsEnabled && chat.memberCount > 1 && (
              <button onClick={() => {
                const callPeer = chat.createdBy !== myUserId ? chat.createdBy : 0;
                if (callPeer > 0) setCallState({ open: true, incoming: false, peerId: callPeer, peerName: chat.name });
              }} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" aria-label="Позвонить">
                <Phone className="w-4 h-4 text-white" />
              </button>
            )}
            {isDispatcher && (
              <button onClick={() => setShowSettings(!showSettings)} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center" aria-label="Настройки чата">
                <Settings className="w-4 h-4 text-white" />
              </button>
            )}
          </div>
        </div>
      </div>

      {showSettings && isDispatcher && (
        <div className="shrink-0 bg-card border-b border-border px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Настройки чата</p>
          {([
            { key: "photosEnabled" as const, label: "Фото", icon: Camera },
            { key: "voiceEnabled" as const, label: "Голосовые", icon: Mic },
            { key: "callsEnabled" as const, label: "Звонки", icon: Phone },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => handleToggleSetting(key)}
              className="w-full flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{label}</span>
              </div>
              <div className={`w-10 h-6 rounded-full transition-colors relative ${settings[key] ? "bg-emerald-500" : "bg-muted-foreground/30"}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${settings[key] ? "translate-x-4.5 left-[18px]" : "left-0.5"}`} />
              </div>
            </button>
          ))}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23e2e8f0' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}>
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="text-sm font-semibold">Нет сообщений</p>
            <p className="text-xs text-muted-foreground mt-1">Напишите первое сообщение в группу</p>
          </div>
        )}

        {items.map((item, i) => {
          if (item.type === "date") {
            return (
              <div key={`date-${i}`} className="flex justify-center my-3">
                <span className="bg-foreground/80 backdrop-blur-sm text-[11px] text-muted-foreground font-medium px-3 py-1 rounded-full shadow-sm border border-border/50">
                  {item.label}
                </span>
              </div>
            );
          }
          const msg = item.msg;
          const isMine = msg.senderId === myUserId;
          const prevItem = items[i - 1];
          const prevMsg = prevItem?.type === "msg" ? prevItem.msg : null;
          const isConsecutive = prevMsg && prevMsg.senderId === msg.senderId;
          const senderColor = ROLE_COLORS[msg.senderRole] || "#6b7280";

          const time = (() => { try { return format(new Date(msg.createdAt), "HH:mm"); } catch { return ""; } })();

          const isVoice = msg.type === "voice";
          let voiceData: { audioUrl: string; duration: number } | null = null;
          if (isVoice) { try { voiceData = JSON.parse(msg.message); } catch {} }

          const isPhoto = msg.type === "photo";
          let photoData: { photoUrl: string; caption: string } | null = null;
          if (isPhoto) { try { photoData = JSON.parse(msg.message); } catch {} }

          return (
            <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"} ${!isMine && !isConsecutive ? "mt-2.5" : "mt-0.5"}`}>
              <div className={`max-w-[82%]`}>
                {!isMine && !isConsecutive && (
                  <p className="text-[11px] font-semibold mb-0.5 ml-2" style={{ color: senderColor }}>{msg.senderName}</p>
                )}
                <div className={`rounded-2xl px-3 py-1.5 shadow-sm ${isMine ? "bg-emerald-500 text-white rounded-br-md" : "bg-card text-foreground rounded-bl-md border border-border/30"} ${isPhoto ? "px-1.5 py-1.5" : ""}`}>
                  {isPhoto && photoData ? (
                    <div className="space-y-1">
                      <div className="rounded-lg overflow-hidden cursor-pointer max-w-[240px]" onClick={() => setFullscreenImage(photoData!.photoUrl.startsWith("/") ? `${BASE_URL}${photoData!.photoUrl}` : photoData!.photoUrl)}>
                        <img src={photoData.photoUrl.startsWith("/") ? `${BASE_URL}${photoData.photoUrl}` : photoData.photoUrl} alt="" className="w-full max-h-[300px] object-cover" loading="lazy" />
                      </div>
                      {photoData.caption && <p className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{photoData.caption}</p>}
                    </div>
                  ) : isVoice && voiceData ? (
                    <GCVoicePlayer audioUrl={voiceData.audioUrl} duration={voiceData.duration} isMine={isMine} />
                  ) : (
                    <p className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{msg.message}</p>
                  )}
                  <div className="flex items-center justify-end gap-1 -mb-0.5 mt-0.5">
                    <span className={`text-[10px] ${isMine ? "text-white/60" : "text-muted-foreground/70"}`}>{time}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-2">
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={photoPreview.url} alt="Preview" className="w-full h-full object-cover" />
              <button onClick={() => { URL.revokeObjectURL(photoPreview.url); setPhotoPreview(null); }} className="absolute top-0 right-0 w-5 h-5 bg-black/60 rounded-bl-lg flex items-center justify-center">
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Подпись к фото..." className="flex-1 bg-muted rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30" />
            <button onClick={handleSendPhoto} disabled={sending} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
            </button>
          </div>
        </div>
      )}

      {showEmoji && !photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-2 py-2">
          <div className="grid grid-cols-8 gap-1 max-h-[140px] overflow-y-auto">
            {EMOJI_LIST.map(emoji => (
              <button key={emoji} onClick={() => { setText(prev => prev + emoji); inputRef.current?.focus(); }} className="w-9 h-9 flex items-center justify-center text-xl rounded-lg hover:bg-muted active:scale-90">
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {!photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-2.5">
          <input type="file" ref={fileInputRef} onChange={handlePhotoSelect} accept="image/*" className="hidden" />
          {isRecording ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-3 bg-red-500/10 rounded-full px-4 py-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-mono text-red-600 tabular-nums">{formatDuration(recordingTime)}</span>
              </div>
              <button onClick={() => stopRecording(true)} className="w-10 h-10 rounded-full bg-muted/80 flex items-center justify-center"><X className="w-4 h-4" /></button>
              <button onClick={() => stopRecording(false)} disabled={sending} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center disabled:opacity-40">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {settings.photosEnabled && (
                <button onClick={() => fileInputRef.current?.click()} disabled={sending} className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 disabled:opacity-40">
                  <ImageIcon className="w-5 h-5" />
                </button>
              )}
              <button onClick={() => setShowEmoji(!showEmoji)} className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${showEmoji ? "text-emerald-500 bg-emerald-500/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                <Smile className="w-5 h-5" />
              </button>
              <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={handleKeyDown} placeholder="Сообщение..." className="flex-1 bg-muted rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30" disabled={sending} onFocus={() => setShowEmoji(false)} />
              {text.trim() ? (
                <button onClick={handleSend} disabled={sending} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 shadow-md shadow-emerald-500/20">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                </button>
              ) : settings.voiceEnabled ? (
                <button onClick={startRecording} disabled={sending} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 shadow-md shadow-emerald-500/20">
                  <Mic className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleSend} disabled={sending || !text.trim()} className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 shadow-md shadow-emerald-500/20">
                  <Send className="w-4 h-4 ml-0.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {fullscreenImage && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center" onClick={() => setFullscreenImage(null)}>
          <button onClick={() => setFullscreenImage(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </button>
          <img src={fullscreenImage} alt="Full size" className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {callState.open && myUserId && (
        <VoiceCallModal
          open={callState.open}
          incoming={callState.incoming}
          peerName={callState.peerName}
          peerId={callState.peerId}
          myUserId={myUserId}
          myName="Вы"
          chatId={chat.id}
          chatType="group"
          wsRef={callWsRef}
          offer={callState.offer || null}
          onClose={() => setCallState({ open: false, incoming: false, peerId: 0, peerName: "" })}
        />
      )}
    </div>
  );
}

function GCVoicePlayer({ audioUrl, duration, isMine }: { audioUrl: string; duration: number; isMine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const animRef = useRef<number>(0);

  const resolvedUrl = audioUrl.startsWith("/") ? `${BASE_URL}${audioUrl}` : audioUrl;

  const updateProgress = useCallback(() => {
    if (audioRef.current) {
      const dur = audioRef.current.duration || duration;
      setCurrentTime(audioRef.current.currentTime);
      setProgress(dur > 0 ? (audioRef.current.currentTime / dur) * 100 : 0);
    }
    if (playing) animRef.current = requestAnimationFrame(updateProgress);
  }, [playing, duration]);

  useEffect(() => {
    if (playing) animRef.current = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, updateProgress]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play().catch(() => {}); setPlaying(true); }
  };

  const bars = 24;
  const barHeights = useRef(Array.from({ length: bars }, () => 0.2 + Math.random() * 0.8));

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <audio ref={audioRef} src={resolvedUrl} preload="metadata" onEnded={() => { setPlaying(false); setProgress(0); setCurrentTime(0); }} />
      <button onClick={toggle} className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isMine ? "bg-foreground/20 text-white" : "bg-emerald-500 text-white"}`}>
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 flex items-end gap-[2px] h-[28px]">
        {barHeights.current.map((h, i) => {
          const bp = (i / bars) * 100;
          const isActive = bp <= progress;
          return <div key={i} className={`w-[3px] rounded-full transition-colors duration-150 ${isMine ? isActive ? "bg-card" : "bg-foreground/30" : isActive ? "bg-emerald-500" : "bg-muted/90"}`} style={{ height: `${h * 28}px` }} />;
        })}
      </div>
      <span className={`text-[10px] tabular-nums min-w-[28px] ${isMine ? "text-white/60" : "text-muted-foreground/70"}`}>
        {playing ? formatDuration(currentTime) : formatDuration(duration)}
      </span>
    </div>
  );
}
