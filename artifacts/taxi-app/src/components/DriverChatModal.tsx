import { useState, useEffect, useCallback, useRef } from "react";
import { X, Search, MessageSquare, Loader2, User, Users, ArrowLeft, Send, Mic, Pause, Play, Smile, Image as ImageIcon, Check, CheckCheck, Clock, UserPlus, Headset } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import ChatModal from "@/components/ChatModal";
import { useGroupChatList, useGroupChat, type GroupChatInfo, type GroupChatMessage } from "@/hooks/use-group-chat";
import { format, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface DriverChatModalProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  myUserId: number | undefined;
  initialPeerId?: number;
  initialPeerName?: string;
  initialPeerRole?: string;
  rideId?: number;
}

interface Conversation {
  peerId: number;
  peerName: string;
  peerPhone: string;
  peerRole: string;
  lastMessage: string;
  lastMessageType: string;
  lastMessageAt: string | null;
  totalMessages: number;
  unreadCount: number;
}

interface AvailableGroup {
  id: number;
  name: string;
  description: string;
  chatType: string;
  memberCount: number;
  hasPendingRequest: boolean;
}

interface UnifiedItem {
  kind: "dm" | "group";
  id: string;
  name: string;
  subtitle: string;
  lastMessage: string;
  lastMessageAt: string | null;
  unreadCount: number;
  dm?: Conversation;
  group?: GroupChatInfo;
}

type TabFilter = "all" | "dm" | "group" | "available";

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

export default function DriverChatModal({ open, onClose, token, myUserId, initialPeerId, initialPeerName, initialPeerRole, rideId }: DriverChatModalProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const { chats: groupChats, loading: groupsLoading, refresh: refreshGroups } = useGroupChatList(token);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabFilter>("all");

  const [chatPeer, setChatPeer] = useState<{ id: number; name: string; role: string } | null>(
    initialPeerId ? { id: initialPeerId, name: initialPeerName || "Диспетчер", role: initialPeerRole || "dispatcher" } : null
  );
  const [selectedGroup, setSelectedGroup] = useState<GroupChatInfo | null>(null);

  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [requestingJoin, setRequestingJoin] = useState<number | null>(null);
  const [loadingDispatcher, setLoadingDispatcher] = useState(false);

  const [dispatcherError, setDispatcherError] = useState(false);

  const startChatWithDispatcher = useCallback(async () => {
    if (!token) return;
    setLoadingDispatcher(true);
    setDispatcherError(false);
    try {
      const res = await fetch(`${API_BASE}/chat/dispatcher-info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.id && data.id > 0) {
          setChatPeer({ id: data.id, name: data.name || "Диспетчер", role: "dispatcher" });
        } else {
          setDispatcherError(true);
        }
      } else {
        setDispatcherError(true);
      }
    } catch {
      setDispatcherError(true);
    } finally {
      setLoadingDispatcher(false);
    }
  }, [token]);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/chat/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {} finally {
      setLoadingConvos(false);
    }
  }, [token]);

  const loadAvailableGroups = useCallback(async () => {
    if (!token) return;
    setLoadingAvailable(true);
    try {
      const res = await fetch(`${API_BASE}/group-chats/available`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableGroups(data.groups || []);
      }
    } catch {} finally {
      setLoadingAvailable(false);
    }
  }, [token]);

  useEffect(() => {
    if (open) {
      loadConversations();
      loadAvailableGroups();
    }
  }, [open, loadConversations, loadAvailableGroups]);

  const handleRequestJoin = async (groupId: number) => {
    if (!token) return;
    setRequestingJoin(groupId);
    try {
      const res = await fetch(`${API_BASE}/group-chats/${groupId}/request-join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (res.ok) {
        setAvailableGroups(prev => prev.map(g => g.id === groupId ? { ...g, hasPendingRequest: true } : g));
      }
    } catch {} finally {
      setRequestingJoin(null);
    }
  };

  const unified: UnifiedItem[] = [];
  for (const c of conversations) {
    unified.push({
      kind: "dm",
      id: `dm-${c.peerId}`,
      name: c.peerName,
      subtitle: c.peerPhone,
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt,
      unreadCount: c.unreadCount,
      dm: c,
    });
  }
  for (const g of groupChats) {
    unified.push({
      kind: "group",
      id: `group-${g.id}`,
      name: g.name,
      subtitle: `${g.memberCount} участник${g.memberCount < 5 ? "а" : "ов"}`,
      lastMessage: g.lastMessage ? `${g.lastSenderName?.split(" ")[0]}: ${g.lastMessage}` : "",
      lastMessageAt: g.lastMessageAt,
      unreadCount: 0,
      group: g,
    });
  }
  unified.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });

  const filtered = unified.filter(item => {
    if (tab === "dm" && item.kind !== "dm") return false;
    if (tab === "group" && item.kind !== "group") return false;
    if (tab === "available") return false;
    if (search) {
      const q = search.toLowerCase();
      return item.name.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q);
    }
    return true;
  });

  const handleSelectItem = (item: UnifiedItem) => {
    if (item.kind === "dm" && item.dm) {
      setChatPeer({ id: item.dm.peerId, name: item.dm.peerName, role: item.dm.peerRole });
      setSelectedGroup(null);
    } else if (item.kind === "group" && item.group) {
      setSelectedGroup(item.group);
      setChatPeer(null);
    }
  };

  const handleBack = () => {
    setSelectedGroup(null);
    setChatPeer(null);
    loadConversations();
    refreshGroups();
    loadAvailableGroups();
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isToday(d)) return format(d, "HH:mm");
      if (isYesterday(d)) return "Вчера";
      return format(d, "dd.MM");
    } catch { return ""; }
  };

  const loading = loadingConvos || groupsLoading;
  const totalUnread = unified.reduce((s, i) => s + i.unreadCount, 0);

  const tabs: { key: TabFilter; label: string; badge?: number }[] = [
    { key: "all", label: "Все" },
    { key: "dm", label: "Личные" },
    { key: "group", label: "Группы" },
    { key: "available", label: "Доступные", badge: availableGroups.filter(g => !g.hasPendingRequest).length },
  ];

  if (!open) return null;

  if (chatPeer) {
    return (
      <ChatModal
        open={true}
        onClose={handleBack}
        token={token}
        myUserId={myUserId}
        myRole="driver"
        peerId={chatPeer.id}
        peerName={chatPeer.name}
        peerRole={chatPeer.role}
        rideId={rideId}
      />
    );
  }

  if (selectedGroup) {
    return (
      <div className="fixed top-0 left-0 right-0 bottom-[68px] z-[60] bg-background flex flex-col">
        <GroupChatView
          chat={selectedGroup}
          token={token}
          myUserId={myUserId}
          onBack={handleBack}
        />
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 bottom-[68px] z-[60] bg-background flex flex-col">
      <div className="shrink-0 bg-zinc-900 px-4 pt-3 pb-2 shadow-lg safe-area-top">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <X className="w-5 h-5 text-white" />
          </button>
          <h2 className="text-base font-bold text-white flex-1">Сообщения</h2>
          {totalUnread > 0 && (
            <span className="min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/10 text-white placeholder:text-zinc-500 text-sm border-0 focus:outline-none focus:ring-1 focus:ring-white/20"
          />
        </div>

        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
                tab === t.key ? "bg-white text-zinc-900" : "bg-white/10 text-white/80 hover:bg-white/20"
              }`}
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className="min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && tab !== "available" && (
          <button
            onClick={startChatWithDispatcher}
            disabled={loadingDispatcher}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-500/5 active:bg-zinc-500/10 transition-colors border-b border-border/30"
          >
            <div className="w-11 h-11 rounded-full bg-zinc-200 flex items-center justify-center shrink-0">
              <Headset className="w-5 h-5 text-zinc-700" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-foreground">Написать диспетчеру</p>
              <p className="text-xs text-muted-foreground">Задать вопрос или сообщить о проблеме</p>
            </div>
            {loadingDispatcher && <Loader2 className="w-5 h-5 animate-spin text-zinc-500 shrink-0" />}
          </button>
        )}

        {dispatcherError && (
          <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-600 font-medium">Диспетчер сейчас недоступен. Попробуйте позже.</p>
          </div>
        )}

        {!loading && tab !== "available" && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-6">
            <div className="w-16 h-16 rounded-full bg-zinc-800/50 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-zinc-400" />
            </div>
            <p className="text-sm font-semibold">Нет сообщений</p>
            <p className="text-xs text-muted-foreground mt-1">Нажмите «Написать диспетчеру» выше</p>
          </div>
        )}

        {!loading && tab !== "available" && filtered.map(item => (
          <button
            key={item.id}
            onClick={() => handleSelectItem(item)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted transition-colors border-b border-border/30"
          >
            <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${
              item.kind === "group" ? "bg-zinc-800/50" : "bg-primary/10"
            }`}>
              {item.kind === "group" ? (
                <Users className="w-5 h-5 text-zinc-400" />
              ) : (
                <User className="w-5 h-5 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold truncate">{item.name}</p>
                {item.lastMessageAt && (
                  <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{formatTime(item.lastMessageAt)}</span>
                )}
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <p className="text-xs text-muted-foreground truncate flex-1">{item.lastMessage || item.subtitle}</p>
                {item.unreadCount > 0 && (
                  <span className="min-w-[18px] h-[18px] rounded-full bg-zinc-700 text-white text-[10px] font-bold flex items-center justify-center px-1 ml-2 shrink-0">
                    {item.unreadCount > 9 ? "9+" : item.unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}

        {tab === "available" && (
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground font-medium mb-3 uppercase tracking-wide">Группы вашего города</p>
            {loadingAvailable && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingAvailable && availableGroups.length === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">Нет доступных групп</p>
                <p className="text-xs text-muted-foreground mt-1">Все группы вашего города уже добавлены</p>
              </div>
            )}
            {!loadingAvailable && availableGroups.map(g => (
              <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 mb-2">
                <div className="w-11 h-11 rounded-full bg-zinc-800/50 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{g.name}</p>
                  <p className="text-xs text-muted-foreground">{g.memberCount} участник{g.memberCount < 5 ? "а" : "ов"}</p>
                  {g.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{g.description}</p>}
                </div>
                {g.hasPendingRequest ? (
                  <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-600 shrink-0">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-[11px] font-semibold">Заявка</span>
                  </div>
                ) : (
                  <button
                    onClick={() => handleRequestJoin(g.id)}
                    disabled={requestingJoin === g.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-zinc-700 text-white text-[11px] font-semibold hover:bg-zinc-600 active:bg-zinc-800 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {requestingJoin === g.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    Вступить
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupChatView({ chat, token, myUserId, onBack }: {
  chat: GroupChatInfo;
  token: string | null;
  myUserId: number | undefined;
  onBack: () => void;
}) {
  const { messages, loading, sending, sendMessage, sendPhoto, sendVoice } = useGroupChat(token, myUserId, chat.id);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ file: File; url: string } | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingTimeRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const ROLE_COLORS: Record<string, string> = { driver: "#059669", dispatcher: "#6366f1", admin: "#dc2626" };

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

  const items: Array<{ type: "date"; label: string } | { type: "msg"; msg: GroupChatMessage }> = [];
  let lastDate = "";
  for (const msg of messages) {
    const msgDate = msg.createdAt ? new Date(msg.createdAt).toDateString() : "";
    if (msgDate && msgDate !== lastDate) { items.push({ type: "date", label: formatDateSeparator(msg.createdAt) }); lastDate = msgDate; }
    items.push({ type: "msg", msg });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 bg-zinc-900 px-4 py-3 shadow-lg safe-area-top">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-white truncate">{chat.name}</p>
            <p className="text-[11px] text-zinc-400">{chat.memberCount} участник{chat.memberCount < 5 ? "а" : "ов"}</p>
          </div>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23e2e8f0' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}>
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800/50 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-zinc-400" />
            </div>
            <p className="text-sm font-semibold">Нет сообщений</p>
            <p className="text-xs text-muted-foreground mt-1">Напишите первое сообщение</p>
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
              <div className="max-w-[82%]">
                {!isMine && !isConsecutive && (
                  <p className="text-[11px] font-semibold mb-0.5 ml-2" style={{ color: senderColor }}>{msg.senderName}</p>
                )}
                <div className={`rounded-2xl px-3 py-1.5 shadow-sm ${isMine ? "bg-zinc-700 text-white rounded-br-md" : "bg-card text-foreground rounded-bl-md border border-border/30"} ${isPhoto ? "px-1.5 py-1.5" : ""}`}>
                  {isPhoto && photoData ? (
                    <div className="space-y-1">
                      <div className="rounded-lg overflow-hidden cursor-pointer max-w-[240px]" onClick={() => setFullscreenImage(photoData!.photoUrl.startsWith("/") ? `${BASE_URL}${photoData!.photoUrl}` : photoData!.photoUrl)}>
                        <img src={photoData.photoUrl.startsWith("/") ? `${BASE_URL}${photoData.photoUrl}` : photoData.photoUrl} alt="" className="w-full max-h-[300px] object-cover" loading="lazy" />
                      </div>
                      {photoData.caption && <p className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{photoData.caption}</p>}
                    </div>
                  ) : isVoice && voiceData ? (
                    <VoicePlayer audioUrl={voiceData.audioUrl.startsWith("/") ? `${BASE_URL}${voiceData.audioUrl}` : voiceData.audioUrl} duration={voiceData.duration} isMine={isMine} />
                  ) : (
                    <p className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{msg.message}</p>
                  )}
                  <p className={`text-[9px] mt-0.5 text-right ${isMine ? "text-white/60" : "text-muted-foreground"}`}>{time}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {fullscreenImage && (
        <div className="fixed inset-0 z-[99] bg-black/90 flex items-center justify-center" onClick={() => setFullscreenImage(null)}>
          <img src={fullscreenImage} alt="" className="max-w-full max-h-full object-contain" />
          <button onClick={() => setFullscreenImage(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
      )}

      {photoPreview && (
        <div className="shrink-0 border-t border-border bg-card p-3">
          <div className="relative inline-block">
            <img src={photoPreview.url} alt="" className="h-24 rounded-lg object-cover" />
            <button onClick={() => { URL.revokeObjectURL(photoPreview.url); setPhotoPreview(null); }} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Подпись..." className="flex-1 px-3 py-2 rounded-lg bg-muted text-sm" />
            <button onClick={handleSendPhoto} className="w-10 h-10 rounded-full bg-zinc-700 text-white flex items-center justify-center" disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-border bg-card px-3 py-2 safe-area-bottom">
        {showEmoji && (
          <div className="mb-2 flex flex-wrap gap-1 p-2 bg-muted rounded-lg max-h-[120px] overflow-y-auto">
            {EMOJI_LIST.map(e => (
              <button key={e} onClick={() => setText(prev => prev + e)} className="w-8 h-8 text-lg hover:bg-background rounded flex items-center justify-center">
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEmoji(!showEmoji)} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center shrink-0">
            <Smile className="w-5 h-5 text-muted-foreground" />
          </button>
          {chat.photosEnabled && (
            <>
              <button onClick={() => fileInputRef.current?.click()} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center shrink-0">
                <ImageIcon className="w-5 h-5 text-muted-foreground" />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoSelect} className="hidden" />
            </>
          )}
          {isRecording ? (
            <div className="flex-1 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-mono text-red-500">{Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>
              <div className="flex-1" />
              <button onClick={() => stopRecording(true)} className="w-9 h-9 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
              <button onClick={() => stopRecording(false)} className="w-9 h-9 rounded-full bg-zinc-700 text-white flex items-center justify-center">
                <Send className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Сообщение..."
                className="flex-1 px-3 py-2 rounded-full bg-muted text-sm border-0 focus:outline-none focus:ring-1 focus:ring-zinc-500/50"
              />
              {text.trim() ? (
                <button onClick={handleSend} disabled={sending} className="w-9 h-9 rounded-full bg-zinc-700 text-white flex items-center justify-center shrink-0 disabled:opacity-50">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              ) : chat.voiceEnabled ? (
                <button onClick={startRecording} className="w-9 h-9 rounded-full bg-zinc-700 text-white flex items-center justify-center shrink-0">
                  <Mic className="w-4 h-4" />
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VoicePlayer({ audioUrl, duration, isMine }: { audioUrl: string; duration: number; isMine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.addEventListener("timeupdate", () => { if (audio.duration) setProgress(audio.currentTime / audio.duration); });
    audio.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    return () => { audio.pause(); audio.src = ""; };
  }, [audioUrl]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); } else { audioRef.current.play(); }
    setPlaying(!playing);
  };

  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <button onClick={toggle} className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isMine ? "bg-white/20" : "bg-zinc-800/50"}`}>
        {playing ? <Pause className={`w-3.5 h-3.5 ${isMine ? "text-white" : "text-zinc-400"}`} /> : <Play className={`w-3.5 h-3.5 ${isMine ? "text-white" : "text-zinc-400"}`} />}
      </button>
      <div className="flex-1 h-1 rounded-full bg-white/20 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${isMine ? "bg-white/60" : "bg-zinc-700"}`} style={{ width: `${progress * 100}%` }} />
      </div>
      <span className={`text-[10px] shrink-0 ${isMine ? "text-white/60" : "text-muted-foreground"}`}>{Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}</span>
    </div>
  );
}
