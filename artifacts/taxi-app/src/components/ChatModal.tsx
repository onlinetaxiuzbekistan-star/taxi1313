import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Loader2, MessageCircle, Users, Check, CheckCheck, Mic, Play, Pause, Image as ImageIcon, Smile, Phone } from "lucide-react";
import { useChat, type ChatMessage } from "@/hooks/use-chat";
import VoiceCallModal from "@/components/VoiceCallModal";
import { format, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface ChatModalProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  myUserId: number | undefined;
  myRole: string;
  peerId: number;
  peerName: string;
  peerRole?: string;
  rideId?: number;
}

const ROLE_COLORS: Record<string, string> = {
  driver: "#3f3f46",
  dispatcher: "#52525b",
  admin: "#27272a",
  rider: "#71717a",
  client: "#71717a",
};

function roleLabel(role: string) {
  switch (role) {
    case "driver": return "Водитель";
    case "dispatcher": return "Диспетчер";
    case "admin": return "Админ";
    case "rider": case "client": return "Пассажир";
    default: return role;
  }
}

function formatDateSeparator(dateStr: string) {
  try {
    const d = new Date(dateStr);
    if (isToday(d)) return "Сегодня";
    if (isYesterday(d)) return "Вчера";
    return format(d, "d MMMM yyyy", { locale: ru });
  } catch {
    return "";
  }
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const EMOJI_LIST = [
  "😀","😂","🤣","😊","😍","🥰","😘","😎","🤔","😢",
  "😭","😤","🤯","🥳","😴","🤮","👍","👎","👏","🙏",
  "❤️","🔥","⭐","✅","❌","🚗","🚕","🏠","📍","💰",
  "⏰","📞","💬","🎉","👋","🤝","💪","🙌","😅","🤗",
];

export default function ChatModal({
  open, onClose, token, myUserId, myRole, peerId, peerName, peerRole, rideId = 0,
}: ChatModalProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGroupChat = rideId > 0;
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

  const [callState, setCallState] = useState<{ open: boolean; incoming: boolean }>({ open: false, incoming: false });
  const dummyWsRef = useRef<WebSocket | null>(null);

  const { messages, loading, sending, sendMessage, sendVoice, sendPhoto, participants, typingUsers, sendTyping, markAsRead, onlineUserIds } = useChat(
    open ? token : null,
    myUserId,
    open ? peerId : null,
    rideId,
  );

  const scrollToBottom = useCallback((smooth = true) => {
    setTimeout(() => {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "instant",
      });
    }, 50);
  }, []);

  useEffect(() => {
    if (open && messages.length > 0) {
      scrollToBottom(false);
    }
  }, [open, loading]);

  useEffect(() => {
    if (open && messages.length > 0) {
      scrollToBottom(true);
      const unread = messages
        .filter(m => m.senderId !== myUserId && m.status !== "read")
        .map(m => m.id);
      if (unread.length > 0) markAsRead(unread);
    }
  }, [messages.length]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  useEffect(() => {
    if (!open && isRecording) {
      stopRecording(true);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      stopRecording(true);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setShowEmoji(false);
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview.url);
        setPhotoPreview(null);
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview.url);
    };
  }, [photoPreview]);

  if (!open) return null;

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg) return;
    setText("");
    setShowEmoji(false);
    await sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    if (!typingThrottle.current) {
      sendTyping();
      typingThrottle.current = setTimeout(() => {
        typingThrottle.current = null;
      }, 2000);
    }
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotoPreview({ file, url });
    e.target.value = "";
  };

  const handleSendPhoto = async () => {
    if (!photoPreview) return;
    const caption = text.trim();
    setText("");
    setShowEmoji(false);
    await sendPhoto(photoPreview.file, caption || undefined);
    URL.revokeObjectURL(photoPreview.url);
    setPhotoPreview(null);
  };

  const handleCancelPhoto = () => {
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview.url);
      setPhotoPreview(null);
    }
  };

  const handleEmojiClick = (emoji: string) => {
    setText(prev => prev + emoji);
    inputRef.current?.focus();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const dur = recordingTimeRef.current;
        if (blob.size > 0 && dur > 0) {
          await sendVoice(blob, dur);
        }
        chunksRef.current = [];
      };

      recorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimeRef.current = 0;
      recordingTimerRef.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime(recordingTimeRef.current);
      }, 1000);
    } catch {
    }
  };

  const stopRecording = (cancel = false) => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      if (cancel) {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      } else {
        mediaRecorderRef.current.stop();
      }
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  const items: Array<{ type: "date"; label: string } | { type: "msg"; msg: ChatMessage }> = [];
  let lastDate = "";
  for (const msg of messages) {
    const msgDate = msg.createdAt ? new Date(msg.createdAt).toDateString() : "";
    if (msgDate && msgDate !== lastDate) {
      items.push({ type: "date", label: formatDateSeparator(msg.createdAt) });
      lastDate = msgDate;
    }
    items.push({ type: "msg", msg });
  }

  const participantCount = isGroupChat
    ? new Set([...participants.map(p => p.userId), ...(myUserId ? [myUserId] : [])]).size
    : 2;

  const peerIsOnline = peerId ? onlineUserIds.has(peerId) : false;
  const onlineCount = isGroupChat
    ? participants.filter(p => onlineUserIds.has(p.userId)).length + 1
    : 0;

  const headerSubtitle = isGroupChat
    ? `${participantCount} участник${participantCount === 1 ? "" : participantCount < 5 ? "а" : "ов"}, ${onlineCount} в сети`
    : peerIsOnline ? "в сети" : "не в сети";

  return (
    <div className="fixed top-0 left-0 right-0 bottom-[68px] z-[60] flex flex-col bg-background">
      <div className="shrink-0 bg-zinc-900 px-4 py-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-10 h-10 shrink-0">
              <div className="w-10 h-10 rounded-full bg-foreground/20 flex items-center justify-center backdrop-blur-sm">
                {isGroupChat ? (
                  <Users className="w-5 h-5 text-white" />
                ) : (
                  <MessageCircle className="w-5 h-5 text-white" />
                )}
              </div>
              {!isGroupChat && (
                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-zinc-900 ${peerIsOnline ? "bg-green-400" : "bg-muted-foreground"}`} />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm text-white truncate">
                {isGroupChat ? `Рейс #${rideId}` : peerName}
              </p>
              <p className="text-[11px] text-zinc-400 truncate">
                {typingUsers.length > 0
                  ? `${typingUsers.map(t => t.userName.split(" ")[0]).join(", ")} печата${typingUsers.length > 1 ? "ют" : "ет"}...`
                  : headerSubtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setCallState({ open: true, incoming: false })}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-foreground/10 active:bg-foreground/20 transition-colors"
              title="Позвонить"
            >
              <Phone className="w-5 h-5 text-white" />
            </button>
            <button onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center bg-foreground/10 active:bg-foreground/20 transition-colors">
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23e2e8f0' fill-opacity='0.15'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
      >
        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800/50 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-zinc-400" />
            </div>
            <p className="text-sm font-semibold text-foreground">Нет сообщений</p>
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
          const showSenderName = isGroupChat && !isMine;
          const prevItem = items[i - 1];
          const prevMsg = prevItem?.type === "msg" ? prevItem.msg : null;
          const isConsecutive = prevMsg && prevMsg.senderId === msg.senderId;

          return (
            <GroupMessageBubble
              key={msg.id}
              msg={msg}
              isMine={isMine}
              showSenderName={showSenderName && !isConsecutive}
              isGroupChat={isGroupChat}
              onImageClick={setFullscreenImage}
            />
          );
        })}

        {typingUsers.length > 0 && (
          <div className="flex justify-start mt-1">
            <div className="bg-background border border-border/50 rounded-2xl rounded-bl-md px-3.5 py-2 shadow-sm">
              <div className="flex items-center gap-1.5">
                <div className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-2">
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={photoPreview.url} alt="Preview" className="w-full h-full object-cover" />
              <button
                onClick={handleCancelPhoto}
                className="absolute top-0 right-0 w-5 h-5 bg-black/60 rounded-bl-lg flex items-center justify-center"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
            <input
              ref={inputRef}
              value={text}
              onChange={handleInputChange}
              placeholder="Подпись к фото..."
              className="flex-1 bg-muted rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-zinc-500/30 transition-shadow"
            />
            <button
              onClick={handleSendPhoto}
              disabled={sending}
              className="w-10 h-10 rounded-full bg-zinc-700 text-white flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-90 transition-all shadow-md shadow-zinc-700/20"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
            </button>
          </div>
        </div>
      )}

      {!photoPreview && !isRecording && !text.trim() && (
        <div className="shrink-0 border-t border-border/50 bg-card/80 px-3 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
          {["Я еду", "Буду через 10 минут", "Где вы?"].map(reply => (
            <button
              key={reply}
              onClick={() => sendMessage(reply)}
              disabled={sending}
              className="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700 border border-zinc-200 active:bg-zinc-200 transition-colors disabled:opacity-40"
            >
              {reply}
            </button>
          ))}
        </div>
      )}

      {showEmoji && !photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-2 py-2">
          <div className="grid grid-cols-8 gap-1 max-h-[140px] overflow-y-auto">
            {EMOJI_LIST.map(emoji => (
              <button
                key={emoji}
                onClick={() => handleEmojiClick(emoji)}
                className="w-9 h-9 flex items-center justify-center text-xl rounded-lg hover:bg-muted active:scale-90 transition-all"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {!photoPreview && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-2.5">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handlePhotoSelect}
            accept="image/*"
            className="hidden"
          />
          {isRecording ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-3 bg-red-500/10 rounded-full px-4 py-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <div className="flex-1 flex items-center gap-1">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-red-400 rounded-full animate-pulse"
                      style={{
                        height: `${8 + Math.random() * 16}px`,
                        animationDelay: `${i * 50}ms`,
                        animationDuration: `${600 + Math.random() * 400}ms`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm font-mono text-red-600 tabular-nums min-w-[36px]">
                  {formatDuration(recordingTime)}
                </span>
              </div>
              <button
                onClick={() => stopRecording(true)}
                className="w-10 h-10 rounded-full bg-muted/80 text-foreground flex items-center justify-center shrink-0 active:scale-90 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={() => stopRecording(false)}
                disabled={sending}
                className="w-10 h-10 rounded-full bg-zinc-700 text-white flex items-center justify-center shrink-0 active:scale-90 transition-all shadow-md shadow-zinc-700/20 disabled:opacity-40"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted active:scale-90 transition-all shrink-0 disabled:opacity-40"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowEmoji(!showEmoji)}
                className={`w-10 h-10 rounded-full flex items-center justify-center hover:bg-muted active:scale-90 transition-all shrink-0 ${showEmoji ? "text-zinc-400 bg-zinc-800/50" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Smile className="w-5 h-5" />
              </button>
              <input
                ref={inputRef}
                value={text}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Сообщение..."
                className="flex-1 bg-muted rounded-full px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-zinc-500/30 transition-shadow"
                disabled={sending}
                onFocus={() => setShowEmoji(false)}
              />
              {text.trim() ? (
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="w-10 h-10 rounded-full bg-zinc-700 text-white flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-90 transition-all shadow-md shadow-zinc-700/20"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  disabled={sending}
                  className="w-10 h-10 rounded-full bg-zinc-700 text-white flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-90 transition-all shadow-md shadow-zinc-700/20"
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {fullscreenImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center"
          onClick={() => setFullscreenImage(null)}
        >
          <button
            onClick={() => setFullscreenImage(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          <img
            src={fullscreenImage}
            alt="Full size"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {callState.open && myUserId && (
        <VoiceCallModal
          open={callState.open}
          incoming={callState.incoming}
          peerName={peerName}
          peerId={peerId}
          myUserId={myUserId}
          myName={myRole === "dispatcher" ? "Диспетчер" : "Водитель"}
          chatId={0}
          chatType="dm"
          wsRef={dummyWsRef}
          onClose={() => setCallState({ open: false, incoming: false })}
        />
      )}
    </div>
  );
}

function PhotoBubble({ photoUrl, caption, isMine, onImageClick }: { photoUrl: string; caption: string; isMine: boolean; onImageClick: (url: string) => void }) {
  const resolvedUrl = photoUrl.startsWith("/") ? `${BASE_URL}${photoUrl}` : photoUrl;

  return (
    <div className="space-y-1">
      <div
        className="rounded-lg overflow-hidden cursor-pointer max-w-[240px]"
        onClick={() => onImageClick(resolvedUrl)}
      >
        <img
          src={resolvedUrl}
          alt={caption || "Photo"}
          className="w-full max-h-[300px] object-cover"
          loading="lazy"
        />
      </div>
      {caption && (
        <p className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{caption}</p>
      )}
    </div>
  );
}

function VoicePlayer({ audioUrl, duration, isMine }: { audioUrl: string; duration: number; isMine: boolean }) {
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
    if (playing) {
      animRef.current = requestAnimationFrame(updateProgress);
    }
  }, [playing, duration]);

  useEffect(() => {
    if (playing) {
      animRef.current = requestAnimationFrame(updateProgress);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, updateProgress]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  const handleEnded = () => {
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  };

  const bars = 24;
  const barHeights = useRef(Array.from({ length: bars }, () => 0.2 + Math.random() * 0.8));

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <audio ref={audioRef} src={resolvedUrl} preload="metadata" onEnded={handleEnded} />
      <button
        onClick={toggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          isMine ? "bg-foreground/20 text-white" : "bg-zinc-700 text-white"
        }`}
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 flex items-end gap-[2px] h-[28px]">
        {barHeights.current.map((h, i) => {
          const barProgress = (i / bars) * 100;
          const isActive = barProgress <= progress;
          return (
            <div
              key={i}
              className={`w-[3px] rounded-full transition-colors duration-150 ${
                isMine
                  ? isActive ? "bg-card" : "bg-foreground/30"
                  : isActive ? "bg-zinc-700" : "bg-muted/90"
              }`}
              style={{ height: `${h * 28}px` }}
            />
          );
        })}
      </div>
      <span className={`text-[10px] tabular-nums min-w-[28px] ${isMine ? "text-white/60" : "text-muted-foreground/70"}`}>
        {playing ? formatDuration(currentTime) : formatDuration(duration)}
      </span>
    </div>
  );
}

function GroupMessageBubble({
  msg, isMine, showSenderName, isGroupChat, onImageClick,
}: {
  msg: ChatMessage;
  isMine: boolean;
  showSenderName: boolean;
  isGroupChat: boolean;
  onImageClick: (url: string) => void;
}) {
  const time = (() => {
    try { return format(new Date(msg.createdAt), "HH:mm", { locale: ru }); }
    catch { return ""; }
  })();

  const senderColor = ROLE_COLORS[msg.senderRole] || "#6b7280";
  const displayName = msg.senderName || roleLabel(msg.senderRole);

  const isVoice = msg.type === "voice";
  let voiceData: { audioUrl: string; duration: number } | null = null;
  if (isVoice) {
    try {
      voiceData = JSON.parse(msg.message);
    } catch {
      voiceData = null;
    }
  }

  const isPhoto = msg.type === "photo";
  let photoData: { photoUrl: string; caption: string } | null = null;
  if (isPhoto) {
    try {
      photoData = JSON.parse(msg.message);
    } catch {
      photoData = null;
    }
  }

  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"} ${showSenderName ? "mt-2.5" : "mt-0.5"}`}>
      <div className={`max-w-[82%] ${isMine ? "items-end" : "items-start"}`}>
        {showSenderName && (
          <p className="text-[11px] font-semibold mb-0.5 ml-2" style={{ color: senderColor }}>
            {displayName}
          </p>
        )}
        <div className={`rounded-2xl px-3 py-1.5 shadow-sm ${
          isMine
            ? "bg-zinc-700 text-white rounded-br-md"
            : "bg-card text-foreground rounded-bl-md border border-border/30"
        } ${isPhoto ? "px-1.5 py-1.5" : ""}`}>
          {isPhoto && photoData ? (
            <PhotoBubble photoUrl={photoData.photoUrl} caption={photoData.caption} isMine={isMine} onImageClick={onImageClick} />
          ) : isVoice && voiceData ? (
            <VoicePlayer audioUrl={voiceData.audioUrl} duration={voiceData.duration} isMine={isMine} />
          ) : (
            <p className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{msg.message}</p>
          )}
          <div className={`flex items-center justify-end gap-1 -mb-0.5 mt-0.5`}>
            <span className={`text-[10px] ${isMine ? "text-white/60" : "text-muted-foreground/70"}`}>
              {time}
            </span>
            {isMine && (
              msg.status === "read"
                ? <CheckCheck className="w-3.5 h-3.5 text-zinc-400" />
                : msg.status === "delivered"
                ? <CheckCheck className="w-3.5 h-3.5 text-white/50" />
                : <Check className="w-3 h-3 text-white/50" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
