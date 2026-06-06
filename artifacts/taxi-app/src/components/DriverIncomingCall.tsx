import { useState, useEffect, useRef, useCallback } from "react";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Volume1 } from "lucide-react";
import { useNotificationSound } from "@/hooks/use-notification-sound";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

function dbg(...args: any[]) { console.log("[DRIVER-CALL]", ...args); }

interface CallState {
  peerId: number;
  peerName: string;
  direction: "incoming" | "outgoing";
  state: "ringing" | "connecting" | "active" | "ended";
  offer?: RTCSessionDescriptionInit;
  startedAt?: number;
}

function formatDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Props {
  myUserId: number;
  myName: string;
}

export default function DriverIncomingCall({ myUserId, myName }: Props) {
  const [call, setCall] = useState<CallState | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [duration, setDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const bodyAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const pendingIceFromCaller = useRef<RTCIceCandidateInit[]>([]);
  const callActiveRef = useRef(false);
  const activePeerIdRef = useRef<number | null>(null);
  const playRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { startLoop, stopLoop } = useNotificationSound();

  const stopRingtone = useCallback(() => {
    stopLoop();
    try { navigator.vibrate?.(0); } catch {}
    dbg("ringtone stopped");
  }, [stopLoop]);

  const playRingtone = useCallback(() => {
    dbg("ringtone starting via useNotificationSound.startLoop");
    startLoop("new_order", 2000);
  }, [startLoop]);

  const getOrCreateAudio = useCallback(() => {
    if (!bodyAudioRef.current) {
      const el = document.createElement("audio");
      el.autoplay = true;
      el.volume = 1.0;
      el.setAttribute("playsinline", "");
      el.id = "driver-call-remote-audio";
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
        dbg("playRetry: giving up after 20 attempts");
        if (playRetryRef.current) { clearInterval(playRetryRef.current); playRetryRef.current = null; }
      }
    }, 300);
  }, []);

  const cleanup = useCallback(() => {
    callActiveRef.current = false;
    activePeerIdRef.current = null;
    stopRingtone();
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
    pendingIceFromCaller.current = [];
    setMuted(false);
    setSpeakerOn(true);
    setDuration(0);
  }, [stopRingtone]);

  const createPC = useCallback(async (peerId: number) => {
    if (pcRef.current) { try { pcRef.current.close(); } catch {} }
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
        .then(() => dbg("ontrack: audio playing OK, volume=", audioEl.volume))
        .catch(err => dbg("ontrack: play FAILED:", err.message));
      startPlayRetry();
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        dbg("local ICE candidate:", e.candidate.type, e.candidate.protocol);
        window.dispatchEvent(new CustomEvent("buxtaxi:send-ws", {
          detail: { type: "ice_candidate", candidate: e.candidate.toJSON(), targetUserId: peerId, fromUserName: myName },
        }));
      } else {
        dbg("ICE gathering complete");
      }
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      dbg("ICE state:", st);
      if (st === "connected" || st === "completed") {
        stopRingtone();
        setCall(prev => prev ? { ...prev, state: "active", startedAt: Date.now() } : null);
        setDuration(0);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
        const el = bodyAudioRef.current;
        if (el && el.srcObject) {
          el.volume = 1.0;
          el.muted = false;
          el.play().catch(() => {});
        }
        startPlayRetry();
      }
      if (st === "disconnected" || st === "failed") {
        dbg("ICE failed/disconnected, ending call");
        window.dispatchEvent(new CustomEvent("buxtaxi:send-ws", {
          detail: { type: "call_end", targetUserId: peerId, fromUserName: myName },
        }));
        setCall(prev => prev ? { ...prev, state: "ended" } : null);
        setTimeout(() => { setCall(null); cleanup(); }, 1500);
      }
    };

    pc.onconnectionstatechange = () => {
      dbg("connection state:", pc.connectionState);
    };

    return pc;
  }, [myName, cleanup, stopRingtone, getOrCreateAudio, startPlayRetry]);

  const acceptCall = useCallback(async () => {
    if (!call?.offer || callActiveRef.current) return;
    callActiveRef.current = true;
    stopRingtone();
    dbg("acceptCall: accepting from peer", call.peerId);
    setCall(prev => prev ? { ...prev, state: "connecting" } : null);

    try {
      const pc = await createPC(call.peerId);
      dbg("acceptCall: setRemoteDescription (offer)");
      await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
      const allIce = [...pendingIceFromCaller.current];
      pendingIceFromCaller.current = [];
      dbg("acceptCall: draining", allIce.length, "pending ICE candidates");
      for (const c of allIce) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      dbg("acceptCall: answer created & sent");
      window.dispatchEvent(new CustomEvent("buxtaxi:send-ws", {
        detail: { type: "call_answer", sdp: answer, targetUserId: call.peerId, fromUserName: myName },
      }));
    } catch (err: any) {
      dbg("acceptCall ERROR:", err?.message);
      setCall(prev => prev ? { ...prev, state: "ended" } : null);
      setTimeout(() => { setCall(null); cleanup(); }, 1500);
    }
  }, [call, createPC, cleanup, stopRingtone, myName]);

  const rejectCall = useCallback(() => {
    if (call) {
      window.dispatchEvent(new CustomEvent("buxtaxi:send-ws", {
        detail: { type: "call_reject", targetUserId: call.peerId },
      }));
    }
    stopRingtone();
    activePeerIdRef.current = null;
    setCall(null);
    cleanup();
  }, [call, cleanup, stopRingtone]);

  const endCall = useCallback(() => {
    if (call) {
      window.dispatchEvent(new CustomEvent("buxtaxi:send-ws", {
        detail: { type: "call_end", targetUserId: call.peerId, fromUserName: myName },
      }));
    }
    activePeerIdRef.current = null;
    setCall(null);
    cleanup();
  }, [call, cleanup, myName]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) { track.enabled = !track.enabled; setMuted(!track.enabled); }
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    const el = bodyAudioRef.current;
    const next = !speakerOn;
    setSpeakerOn(next);
    if (el) {
      el.volume = next ? 1.0 : 0.7;
      dbg("speaker toggled:", next ? "ON (vol=1.0)" : "OFF (vol=0.7)");
    }
  }, [speakerOn]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (!msg || !msg.fromUserId) return;
      const fromId = Number(msg.fromUserId);

      if (msg.type === "ice_candidate" && msg.candidate) {
        const expectedPeer = activePeerIdRef.current;
        if (expectedPeer && fromId !== expectedPeer) return;
        if (!expectedPeer) {
          pendingIceFromCaller.current.push(msg.candidate);
          dbg("WS: buffered ICE (no peer yet), total:", pendingIceFromCaller.current.length);
          return;
        }
        if (pcRef.current?.remoteDescription) {
          pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(err => dbg("addIceCandidate err:", err.message));
          dbg("WS: added remote ICE candidate directly");
        } else {
          pendingIceFromCaller.current.push(msg.candidate);
          dbg("WS: buffered ICE (no remoteDesc), total:", pendingIceFromCaller.current.length);
        }
      }

      if (msg.type === "call_offer") {
        if (callActiveRef.current || activePeerIdRef.current) {
          dbg("WS: call_offer IGNORED (already active)");
          return;
        }
        dbg("WS: call_offer from", fromId, msg.fromUserName);
        const sdpData = msg.sdp;
        let offerDesc: RTCSessionDescriptionInit | undefined;
        if (sdpData) {
          if (typeof sdpData === "string") offerDesc = { type: "offer", sdp: sdpData };
          else if (sdpData.sdp) offerDesc = { type: "offer", sdp: sdpData.sdp };
        }
        activePeerIdRef.current = fromId;
        setCall({
          peerId: fromId,
          peerName: msg.fromUserName || "Администратор",
          direction: "incoming",
          state: "ringing",
          offer: offerDesc,
        });
        playRingtone();
      }

      if (msg.type === "call_answer" && pcRef.current && msg.sdp && fromId === activePeerIdRef.current) {
        dbg("WS: call_answer from", fromId, "setting remote desc");
        const sdp = typeof msg.sdp === "string"
          ? { type: "answer" as RTCSdpType, sdp: msg.sdp }
          : msg.sdp.sdp ? { type: "answer" as RTCSdpType, sdp: msg.sdp.sdp } : msg.sdp;
        pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp)).then(() => {
          const allPending = [...pendingIceFromCaller.current, ...iceCandidateQueue.current];
          pendingIceFromCaller.current = [];
          iceCandidateQueue.current = [];
          dbg("WS: remoteDesc set OK, draining", allPending.length, "pending ICE candidates");
          for (const c of allPending) {
            pcRef.current?.addIceCandidate(new RTCIceCandidate(c)).catch(err => dbg("drain ICE err:", err.message));
          }
        }).catch(err => dbg("setRemoteDescription FAILED:", err.message));
      }

      if ((msg.type === "call_end" || msg.type === "call_reject") && fromId === activePeerIdRef.current) {
        stopRingtone();
        activePeerIdRef.current = null;
        setCall(prev => prev ? { ...prev, state: "ended" } : null);
        setTimeout(() => { setCall(null); cleanup(); }, 1000);
      }
    };

    window.addEventListener("buxtaxi:ws", handler);
    return () => window.removeEventListener("buxtaxi:ws", handler);
  }, [cleanup, playRingtone, stopRingtone]);

  useEffect(() => {
    return () => {
      cleanup();
      if (bodyAudioRef.current) {
        try { document.body.removeChild(bodyAudioRef.current); } catch {}
        bodyAudioRef.current = null;
      }
    };
  }, []);

  if (!call) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {call.state === "ringing" && (
          <div className="p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Phone className="w-10 h-10 text-emerald-600" />
            </div>
            <p className="text-sm text-gray-500 mb-1">Входящий звонок</p>
            <p className="text-xl font-bold text-gray-900 mb-6">{call.peerName}</p>
            <div className="flex justify-center gap-6">
              <button
                onClick={rejectCall}
                className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 active:scale-90 transition-all shadow-lg"
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <button
                onClick={acceptCall}
                className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-600 active:scale-90 transition-all shadow-lg animate-bounce"
              >
                <Phone className="w-7 h-7 text-white" />
              </button>
            </div>
          </div>
        )}

        {(call.state === "connecting" || call.state === "active") && (
          <div className="p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-zinc-100 flex items-center justify-center mx-auto mb-4">
              <Phone className="w-10 h-10 text-zinc-700" />
            </div>
            <p className="text-sm text-gray-500 mb-1">
              {call.state === "connecting" ? "Подключение..." : "Разговор"}
            </p>
            <p className="text-xl font-bold text-gray-900 mb-1">{call.peerName}</p>
            {call.state === "active" && (
              <p className="text-lg font-mono text-zinc-600 mb-6">{formatDur(duration)}</p>
            )}
            {call.state === "connecting" && <div className="mb-6" />}
            <div className="flex justify-center gap-4">
              <button
                onClick={toggleMute}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                  muted ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-700"
                }`}
                title={muted ? "Включить микрофон" : "Выключить микрофон"}
              >
                {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
              <button
                onClick={toggleSpeaker}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                  speakerOn ? "bg-zinc-200 text-zinc-700" : "bg-gray-100 text-gray-700"
                }`}
                title={speakerOn ? "Выключить громкую связь" : "Включить громкую связь"}
              >
                {speakerOn ? <Volume2 className="w-6 h-6" /> : <Volume1 className="w-6 h-6" />}
              </button>
              <button
                onClick={endCall}
                className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 active:scale-90 transition-all shadow-lg"
                title="Завершить звонок"
              >
                <PhoneOff className="w-6 h-6 text-white" />
              </button>
            </div>
          </div>
        )}

        {call.state === "ended" && (
          <div className="p-6 text-center">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <PhoneOff className="w-10 h-10 text-gray-400" />
            </div>
            <p className="text-sm text-gray-500 mb-1">Звонок завершён</p>
            <p className="text-lg font-bold text-gray-900">{call.peerName}</p>
          </div>
        )}
      </div>
    </div>
  );
}
