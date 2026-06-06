import { useState, useEffect, useRef, useCallback } from "react";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Volume1 } from "lucide-react";

interface VoiceCallModalProps {
  open: boolean;
  incoming: boolean;
  peerName: string;
  peerId: number;
  myUserId: number;
  myName: string;
  chatId?: number;
  chatType?: string;
  wsRef: React.RefObject<WebSocket | null>;
  onClose: () => void;
  offer?: RTCSessionDescriptionInit | null;
  autoAccept?: boolean;
  pendingCandidates?: RTCIceCandidateInit[];
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

function dbg(...args: any[]) { console.log("[VOICECALL]", ...args); }

export default function VoiceCallModal({
  open, incoming, peerName, peerId, myUserId, myName, chatId, chatType, wsRef, onClose, offer, autoAccept, pendingCandidates,
}: VoiceCallModalProps) {
  const [status, setStatus] = useState<"ringing" | "connecting" | "active" | "ended">(
    incoming && !autoAccept ? "ringing" : "connecting"
  );
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [duration, setDuration] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const bodyAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const callInitiatedRef = useRef(false);
  const offerSentRef = useRef(false);
  const pendingLocalIce = useRef<RTCIceCandidate[]>([]);
  const playRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendWs = useCallback((data: any) => {
    window.dispatchEvent(new CustomEvent("buxtaxi:send-ws", {
      detail: {
        ...data,
        targetUserId: peerId,
        fromUserName: myName,
        chatId,
        chatType,
      },
    }));
    dbg("sendWs via event bus:", data.type);
  }, [peerId, myName, chatId, chatType]);

  const getOrCreateAudio = useCallback(() => {
    if (!bodyAudioRef.current) {
      const el = document.createElement("audio");
      el.autoplay = true;
      el.volume = 1.0;
      el.setAttribute("playsinline", "");
      el.id = "voicecall-remote-audio";
      document.body.appendChild(el);
      bodyAudioRef.current = el;
      dbg("created body audio element");
    }
    return bodyAudioRef.current;
  }, []);

  const startPlayRetry = useCallback(() => {
    if (playRetryRef.current) clearInterval(playRetryRef.current);
    let attempts = 0;
    playRetryRef.current = setInterval(() => {
      attempts++;
      const el = bodyAudioRef.current;
      if (!el || !el.srcObject) {
        if (attempts > 20) { clearInterval(playRetryRef.current!); playRetryRef.current = null; }
        return;
      }
      const ms = el.srcObject as MediaStream;
      const tracks = ms.getAudioTracks();
      if (tracks.length > 0 && tracks.some(t => t.readyState === "live")) {
        el.volume = 1.0;
        el.muted = false;
        el.play()
          .then(() => {
            dbg("playRetry: audio playing OK (attempt", attempts, ")");
            if (playRetryRef.current) { clearInterval(playRetryRef.current); playRetryRef.current = null; }
          })
          .catch(err => dbg("playRetry: play failed (attempt", attempts, "):", err.message));
      }
      if (attempts > 20) {
        if (playRetryRef.current) { clearInterval(playRetryRef.current); playRetryRef.current = null; }
      }
    }, 300);
  }, []);

  const cleanup = useCallback(() => {
    if (playRetryRef.current) { clearInterval(playRetryRef.current); playRetryRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
      pcRef.current = null;
    }
    if (bodyAudioRef.current) {
      bodyAudioRef.current.srcObject = null;
      bodyAudioRef.current.pause();
    }
    iceCandidateQueue.current = [];
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration(d => d + 1);
    }, 1000);
  }, []);

  const createPC = useCallback(async () => {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch {}
    }
    dbg("createPC for peer", peerId);

      if (!window.isSecureContext) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    dbg("getUserMedia OK, tracks:", stream.getAudioTracks().length);
    localStreamRef.current = stream;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    const audioEl = getOrCreateAudio();

    pc.ontrack = (e) => {
      dbg("ontrack fired, streams:", e.streams.length, "track:", e.track?.kind, "enabled:", e.track?.enabled, "muted:", e.track?.muted, "readyState:", e.track?.readyState);
      if (e.streams[0]) {
        audioEl.srcObject = e.streams[0];
        dbg("ontrack: set srcObject from stream, tracks:", e.streams[0].getAudioTracks().length);
      } else if (e.track) {
        let existingStream = audioEl.srcObject as MediaStream | null;
        if (!existingStream) {
          existingStream = new MediaStream();
          audioEl.srcObject = existingStream;
        }
        existingStream.addTrack(e.track);
        dbg("ontrack: added track manually");
      }
      audioEl.volume = 1.0;
      audioEl.muted = false;
      audioEl.play()
        .then(() => dbg("ontrack: audio playing OK"))
        .catch(err => dbg("ontrack: play FAILED:", err.message));
      startPlayRetry();
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        dbg("local ICE candidate:", e.candidate.type, e.candidate.protocol);
        if (!offerSentRef.current) {
          pendingLocalIce.current.push(e.candidate);
        } else {
          sendWs({ type: "ice_candidate", candidate: e.candidate.toJSON() });
        }
      } else {
        dbg("ICE gathering complete");
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (!mountedRef.current) return;
      const state = pc.iceConnectionState;
      dbg("ICE state:", state);
      if (state === "connected" || state === "completed") {
        setStatus("active");
        startTimer();
        const el = bodyAudioRef.current;
        if (el && el.srcObject) {
          el.volume = 1.0;
          el.muted = false;
          el.play().catch(() => {});
        }
        startPlayRetry();
      }
      if (state === "disconnected" || state === "failed") {
        dbg("ICE failed/disconnected");
        setStatus("ended");
        sendWs({ type: "call_end" });
        setTimeout(() => { if (mountedRef.current) onClose(); }, 1500);
      }
    };

    pc.onconnectionstatechange = () => {
      dbg("connection state:", pc.connectionState);
    };

    return pc;
  }, [sendWs, startTimer, onClose, peerId, getOrCreateAudio, startPlayRetry]);

  useEffect(() => {
    mountedRef.current = true;
    callInitiatedRef.current = false;
    return () => {
      mountedRef.current = false;
      cleanup();
      if (bodyAudioRef.current) {
        try { document.body.removeChild(bodyAudioRef.current); } catch {}
        bodyAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!open || callInitiatedRef.current) return;

    if (!incoming) {
      callInitiatedRef.current = true;
      offerSentRef.current = false;
      pendingLocalIce.current = [];
      (async () => {
        try {
          const pc = await createPC();
          const sdpOffer = await pc.createOffer();
          await pc.setLocalDescription(sdpOffer);
          sendWs({ type: "call_offer", sdp: sdpOffer });
          offerSentRef.current = true;
          for (const c of pendingLocalIce.current) {
            sendWs({ type: "ice_candidate", candidate: c.toJSON() });
          }
          pendingLocalIce.current = [];
          if (mountedRef.current) setStatus("connecting");
        } catch {
          if (mountedRef.current) {
            setStatus("ended");
            setTimeout(() => onClose(), 1500);
          }
        }
      })();
    } else if (autoAccept && offer) {
      callInitiatedRef.current = true;
      offerSentRef.current = true;
      (async () => {
        try {
          const pc = await createPC();
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const allCandidates = [...(pendingCandidates || []), ...iceCandidateQueue.current];
          for (const c of allCandidates) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
          }
          iceCandidateQueue.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendWs({ type: "call_answer", sdp: answer });
          if (mountedRef.current) setStatus("connecting");
        } catch {
          if (mountedRef.current) {
            setStatus("ended");
            setTimeout(() => onClose(), 1500);
          }
        }
      })();
    }
  }, [open]);

  const acceptCall = useCallback(async () => {
    if (!offer || callInitiatedRef.current) return;
    callInitiatedRef.current = true;
    offerSentRef.current = true;
    pendingLocalIce.current = [];
    try {
      const pc = await createPC();
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const c of iceCandidateQueue.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      iceCandidateQueue.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWs({ type: "call_answer", sdp: answer });
      for (const c of pendingLocalIce.current) {
        sendWs({ type: "ice_candidate", candidate: c.toJSON() });
      }
      pendingLocalIce.current = [];
      setStatus("connecting");
    } catch {
      setStatus("ended");
      setTimeout(() => onClose(), 1500);
    }
  }, [offer, createPC, sendWs, onClose]);

  const rejectCall = useCallback(() => {
    sendWs({ type: "call_reject" });
    cleanup();
    onClose();
  }, [sendWs, cleanup, onClose]);

  const endCall = useCallback(() => {
    sendWs({ type: "call_end" });
    setStatus("ended");
    cleanup();
    setTimeout(() => onClose(), 500);
  }, [sendWs, cleanup, onClose]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setMuted(!track.enabled);
      }
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    const audio = bodyAudioRef.current;
    const newState = !speakerOn;
    setSpeakerOn(newState);
    if (audio) {
      audio.volume = newState ? 1.0 : 0.7;
    }
  }, [speakerOn]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (!data || data.fromUserId !== peerId) return;

      if (data.type === "call_answer" && pcRef.current && data.sdp) {
        dbg("WS: call_answer from", data.fromUserId, "setting remote desc");
        const sdp = typeof data.sdp === "string"
          ? { type: "answer" as RTCSdpType, sdp: data.sdp }
          : data.sdp.sdp
            ? { type: "answer" as RTCSdpType, sdp: data.sdp.sdp }
            : data.sdp;
        pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp)).then(() => {
          dbg("WS: remoteDesc set OK, draining", iceCandidateQueue.current.length, "queued ICE");
          for (const c of iceCandidateQueue.current) {
            pcRef.current?.addIceCandidate(new RTCIceCandidate(c)).catch(err => dbg("drain ICE err:", err.message));
          }
          iceCandidateQueue.current = [];
        }).catch(err => dbg("setRemoteDescription FAILED:", err.message));
      } else if (data.type === "ice_candidate" && data.candidate) {
        if (pcRef.current?.remoteDescription) {
          pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(err => dbg("addIceCandidate err:", err.message));
          dbg("WS: added remote ICE candidate directly");
        } else {
          iceCandidateQueue.current.push(data.candidate);
          dbg("WS: buffered ICE (no remoteDesc), total:", iceCandidateQueue.current.length);
        }
      } else if (data.type === "call_end" || data.type === "call_reject") {
        dbg("WS: call ended/rejected by peer, reason:", data.reason);
        if (data.reason === "calls_disabled") {
          setRejectReason("Абонент не принимает звонки");
        } else if (data.reason === "user_offline") {
          setRejectReason("Абонент не в сети");
        }
        setStatus("ended");
        cleanup();
        setTimeout(() => { if (mountedRef.current) onClose(); }, 2000);
      }
    };

    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, [open, peerId, cleanup, onClose]);

  if (!open) return null;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden border border-zinc-700">
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-zinc-700 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl font-bold text-white">
              {peerName?.charAt(0)?.toUpperCase() || "?"}
            </span>
          </div>
          <h3 className="text-white font-bold text-lg mb-1">{peerName}</h3>
          {status === "ringing" && (
            <p className="text-amber-400 text-sm animate-pulse">
              {incoming ? "Входящий звонок..." : "Вызов..."}
            </p>
          )}
          {status === "connecting" && (
            <p className="text-zinc-400 text-sm">Подключение...</p>
          )}
          {status === "active" && (
            <p className="text-emerald-400 text-sm font-mono">{formatTime(duration)}</p>
          )}
          {status === "ended" && (
            <p className="text-red-400 text-sm">{rejectReason || "Звонок завершён"}</p>
          )}
        </div>

        <div className="flex justify-center items-center gap-4 px-6 pb-6">
          {status === "active" && (
            <>
              <button
                onClick={toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                  muted ? "bg-red-500/30 text-red-400" : "bg-zinc-700 text-white"
                }`}
              >
                {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button
                onClick={toggleSpeaker}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                  speakerOn ? "bg-zinc-600 text-white" : "bg-zinc-700 text-zinc-400"
                }`}
              >
                {speakerOn ? <Volume2 className="w-5 h-5" /> : <Volume1 className="w-5 h-5" />}
              </button>
            </>
          )}

          {(status === "ringing" && incoming) && (
            <>
              <button
                onClick={rejectCall}
                className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center active:scale-90 transition-all"
              >
                <PhoneOff className="w-6 h-6 text-white" />
              </button>
              <button
                onClick={acceptCall}
                className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center active:scale-90 transition-all animate-bounce"
              >
                <Phone className="w-6 h-6 text-white" />
              </button>
            </>
          )}

          {(status === "ringing" && !incoming) && (
            <button
              onClick={endCall}
              className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center active:scale-90 transition-all"
            >
              <PhoneOff className="w-6 h-6 text-white" />
            </button>
          )}

          {(status === "connecting" || status === "active") && (
            <button
              onClick={endCall}
              className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center active:scale-90 transition-all"
            >
              <PhoneOff className="w-6 h-6 text-white" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
