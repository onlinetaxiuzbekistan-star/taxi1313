import { useState, useEffect, useRef, useCallback } from "react";
import { Phone, PhoneOff, Mic, MicOff, X, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

function dbg(...args: any[]) { console.log("[CLIENT-CALL]", ...args); }

interface Props {
  open: boolean;
  onClose: () => void;
  token: string;
  userId: number;
  userName: string;
}

export default function CallDispatcherModal({ open, onClose, token, userId, userName }: Props) {
  const [status, setStatus] = useState<"loading" | "ringing" | "connecting" | "active" | "ended" | "error">("loading");
  const [dispatcherName, setDispatcherName] = useState("");
  const [dispatcherPhone, setDispatcherPhone] = useState("");
  const [dispatcherId, setDispatcherId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const cleanup = useCallback((sendEnd = false) => {
    dbg("cleanup, sendEnd=", sendEnd);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.srcObject = null; audioRef.current.remove(); audioRef.current = null; }
    if (wsRef.current) {
      const ws = wsRef.current;
      if (sendEnd && ws.readyState === WebSocket.OPEN && dispatcherId) {
        try { ws.send(JSON.stringify({ type: "call_end", targetUserId: dispatcherId })); } catch {}
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "call_ended");
      }
      wsRef.current = null;
    }
  }, [dispatcherId]);

  useEffect(() => {
    if (!open) return;
    setStatus("loading");
    setDuration(0);
    setErrorMsg("");
    setMuted(false);

    let cancelled = false;

    async function startCall() {
      try {
        const infoRes = await fetch(`${BASE}/api/chat/dispatcher-info`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!infoRes.ok) throw new Error("Не удалось найти диспетчера");
        const info = await infoRes.json();
        if (cancelled) return;

        if (!info.id) {
          setErrorMsg("Диспетчер не найден");
          setStatus("error");
          return;
        }

        setDispatcherName(info.name || "Диспетчер");
        setDispatcherPhone(info.phone || "");
        setDispatcherId(info.id);

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${window.location.host}${BASE}/api/ws`;
        dbg("connecting WS:", wsUrl);

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          dbg("WS open, sending auth");
          ws.send(JSON.stringify({ type: "auth", token }));
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            handleWsMessage(msg, info.id);
          } catch {}
        };

        ws.onerror = () => {
          if (!cancelled && mountedRef.current) {
            setErrorMsg("Ошибка соединения");
            setStatus("error");
          }
        };

        ws.onclose = () => {
          dbg("WS closed");
          if (!cancelled && mountedRef.current) {
            setStatus(prev => {
              if (prev === "ringing" || prev === "connecting" || prev === "loading") {
                setErrorMsg("Соединение потеряно");
                return "error";
              }
              return prev;
            });
          }
        };
      } catch (err: any) {
        if (!cancelled && mountedRef.current) {
          setErrorMsg(err.message || "Ошибка");
          setStatus("error");
        }
      }
    }

    function handleWsMessage(msg: any, targetId: number) {
      if (!mountedRef.current) return;
      dbg("WS msg:", msg.type);

      if (msg.type === "auth_ok") {
        dbg("Auth OK, initiating call to dispatcher:", targetId);
        setStatus("ringing");
        initiateCall(targetId);
      } else if (msg.type === "auth_error") {
        setErrorMsg("Ошибка авторизации");
        setStatus("error");
      } else if (msg.type === "call_answer" && pcRef.current) {
        dbg("Got answer");
        setStatus("connecting");
        pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp)).then(() => {
          dbg("Remote description set");
        }).catch(e => dbg("setRemoteDesc error:", e));
      } else if (msg.type === "ice_candidate" && pcRef.current) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
      } else if (msg.type === "call_reject" || msg.type === "call_end") {
        let reason = "";
        if (msg.reason === "user_offline") reason = "Диспетчер не в сети";
        else if (msg.reason === "calls_disabled") reason = "Диспетчер не принимает звонки";
        else if (msg.reason === "busy") reason = "Диспетчер занят";
        else reason = "Звонок завершён";
        setErrorMsg(reason);
        setStatus("ended");
        cleanup();
      }
    }

    async function initiateCall(targetId: number) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled || !mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        const el = document.createElement("audio");
        el.autoplay = true;
        el.volume = 1.0;
        el.setAttribute("playsinline", "");
        document.body.appendChild(el);
        audioRef.current = el;

        stream.getTracks().forEach(t => pc.addTrack(t, stream));

        pc.ontrack = (ev) => {
          dbg("got remote track");
          if (audioRef.current && ev.streams[0]) {
            audioRef.current.srcObject = ev.streams[0];
            audioRef.current.play().catch(() => {});
          }
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: "ice_candidate",
              targetUserId: targetId,
              candidate: ev.candidate,
            }));
          }
        };

        pc.onconnectionstatechange = () => {
          dbg("connection state:", pc.connectionState);
          if (pc.connectionState === "connected") {
            setStatus("active");
            timerRef.current = setInterval(() => {
              setDuration(d => d + 1);
            }, 1000);
          } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            setErrorMsg("Соединение потеряно");
            setStatus("ended");
            cleanup();
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: "call_offer",
            targetUserId: targetId,
            fromUserName: userName,
            sdp: offer,
          }));
          dbg("call_offer sent");
        }
      } catch (err: any) {
        dbg("initiateCall error:", err);
        if (err.name === "NotAllowedError") {
          setErrorMsg("Разрешите доступ к микрофону");
        } else {
          setErrorMsg("Не удалось начать звонок");
        }
        setStatus("error");
        cleanup();
      }
    }

    startCall();

    return () => {
      cancelled = true;
      cleanup(true);
    };
  }, [open, token, userId, userName, cleanup]);

  function handleHangup() {
    if (wsRef.current?.readyState === WebSocket.OPEN && dispatcherId) {
      wsRef.current.send(JSON.stringify({
        type: "call_end",
        targetUserId: dispatcherId,
      }));
    }
    cleanup();
    setStatus("ended");
    setTimeout(() => onClose(), 500);
  }

  function toggleMute() {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMuted(!audioTrack.enabled);
      }
    }
  }

  function formatDur(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-b from-primary/10 to-white px-6 pt-8 pb-6 text-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 mx-auto mb-4 flex items-center justify-center">
            {status === "loading" ? (
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            ) : status === "active" ? (
              <Phone className="w-8 h-8 text-emerald-600" />
            ) : status === "ended" || status === "error" ? (
              <PhoneOff className="w-8 h-8 text-red-500" />
            ) : (
              <Phone className="w-8 h-8 text-primary animate-pulse" />
            )}
          </div>

          <h3 className="text-lg font-bold text-gray-900 mb-1">
            {dispatcherName || "Диспетчер"}
          </h3>

          {dispatcherPhone && (
            <p className="text-sm text-gray-500 mb-2">{dispatcherPhone}</p>
          )}

          <p className={`text-sm font-medium ${
            status === "active" ? "text-emerald-600" :
            status === "error" || status === "ended" ? "text-red-500" :
            "text-gray-500"
          }`}>
            {status === "loading" && "Подключение..."}
            {status === "ringing" && "Вызов..."}
            {status === "connecting" && "Соединение..."}
            {status === "active" && formatDur(duration)}
            {status === "ended" && (errorMsg || "Звонок завершён")}
            {status === "error" && (errorMsg || "Ошибка")}
          </p>
        </div>

        <div className="px-6 pb-6 flex items-center justify-center gap-4">
          {(status === "ringing" || status === "connecting" || status === "active") && (
            <>
              <button
                onClick={toggleMute}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                  muted ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>

              <button
                onClick={handleHangup}
                className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg"
              >
                <PhoneOff className="w-7 h-7" />
              </button>
            </>
          )}

          {(status === "ended" || status === "error") && (
            <button
              onClick={onClose}
              className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
            >
              Закрыть
            </button>
          )}

          {status === "loading" && (
            <button
              onClick={() => { cleanup(); onClose(); }}
              className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
            >
              Отмена
            </button>
          )}
        </div>

        {dispatcherPhone && (status === "error" || status === "ended") && (
          <div className="px-6 pb-6 border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 text-center mb-2">Или позвоните по телефону:</p>
            <a
              href={`tel:${dispatcherPhone}`}
              className="flex items-center justify-center gap-2 w-full py-3 bg-emerald-50 text-emerald-700 rounded-xl font-medium hover:bg-emerald-100 transition-colors"
            >
              <Phone className="w-4 h-4" />
              {dispatcherPhone}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
