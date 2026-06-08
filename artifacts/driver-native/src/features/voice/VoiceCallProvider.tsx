import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { View, Text, Pressable, PermissionsAndroid, Platform, Vibration } from "react-native";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  type MediaStream,
} from "react-native-webrtc";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react-native";

import { useAuth } from "@/hooks/use-auth";
import { wsEvents } from "@/lib/ws-events";
import { sendWsMessage } from "@/hooks/use-ride-websocket";
import { playCall, stopCall } from "@/lib/sounds";
import { colors } from "@/lib/theme";
import { useT } from "@/lib/i18n";

// App-WS-signaled WebRTC voice — ported from web DriverIncomingCall.tsx, using
// react-native-webrtc and the shared driver socket (wsEvents in / sendWsMessage
// out). Signaling: call_offer / call_answer / call_reject / call_end / ice_candidate.
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

type CallStateName = "ringing" | "connecting" | "active" | "ended";
interface CallState {
  peerId: number;
  peerName: string;
  direction: "incoming" | "outgoing";
  state: CallStateName;
  offer?: any;
}

function fmt(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

async function ensureMic(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return g === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

const VoiceCallContext = createContext<{ startCall: (peerId: number, peerName: string) => void }>({
  startCall: () => {},
});
export const useVoiceCall = () => useContext(VoiceCallContext);

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { user } = useAuth();
  const myName = user?.name || t("driver_role");
  const [call, setCall] = useState<CallState | null>(null);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePeerIdRef = useRef<number | null>(null);
  const pendingIce = useRef<any[]>([]);

  const cleanup = useCallback(() => {
    Vibration.cancel();
    stopCall();
    activePeerIdRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }
    pendingIce.current = [];
    setMuted(false);
    setDuration(0);
  }, []);

  const endLocal = useCallback(() => {
    setCall((p) => (p ? { ...p, state: "ended" } : null));
    setTimeout(() => {
      setCall(null);
      cleanup();
    }, 1200);
  }, [cleanup]);

  const createPC = useCallback(
    async (peerId: number) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream as unknown as MediaStream;
      stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));

      (pc as any).addEventListener("icecandidate", (e: any) => {
        if (e.candidate) {
          sendWsMessage({ type: "ice_candidate", candidate: e.candidate, targetUserId: peerId, fromUserName: myName });
        }
      });
      (pc as any).addEventListener("track", () => {
        // react-native-webrtc auto-routes the remote audio track to the device.
      });
      (pc as any).addEventListener("iceconnectionstatechange", () => {
        const st = (pc as any).iceConnectionState;
        if (st === "connected" || st === "completed") {
          Vibration.cancel();
          stopCall();
          setCall((p) => (p ? { ...p, state: "active" } : null));
          if (!timerRef.current) {
            setDuration(0);
            timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
          }
        }
        if (st === "failed" || st === "disconnected") {
          sendWsMessage({ type: "call_end", targetUserId: peerId, fromUserName: myName });
          endLocal();
        }
      });

      return pc;
    },
    [myName, endLocal],
  );

  const drainIce = useCallback(async (pc: RTCPeerConnection) => {
    const all = [...pendingIce.current];
    pendingIce.current = [];
    for (const c of all) {
      try {
        await (pc as any).addIceCandidate(new RTCIceCandidate(c));
      } catch {}
    }
  }, []);

  // ---- outgoing ----
  const startCall = useCallback(
    async (peerId: number, peerName: string) => {
      if (activePeerIdRef.current) return;
      if (!(await ensureMic())) return;
      activePeerIdRef.current = peerId;
      setCall({ peerId, peerName, direction: "outgoing", state: "connecting" });
      try {
        const pc = await createPC(peerId);
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        sendWsMessage({ type: "call_offer", sdp: offer, targetUserId: peerId, fromUserName: myName });
      } catch {
        endLocal();
      }
    },
    [createPC, endLocal, myName],
  );

  // ---- incoming controls ----
  const accept = useCallback(async () => {
    if (!call?.offer) return;
    if (!(await ensureMic())) return;
    Vibration.cancel();
    stopCall();
    setCall((p) => (p ? { ...p, state: "connecting" } : null));
    try {
      const pc = await createPC(call.peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
      await drainIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWsMessage({ type: "call_answer", sdp: answer, targetUserId: call.peerId, fromUserName: myName });
    } catch {
      endLocal();
    }
  }, [call, createPC, drainIce, endLocal, myName]);

  const reject = useCallback(() => {
    if (call) sendWsMessage({ type: "call_reject", targetUserId: call.peerId });
    setCall(null);
    cleanup();
  }, [call, cleanup]);

  const end = useCallback(() => {
    if (call) sendWsMessage({ type: "call_end", targetUserId: call.peerId, fromUserName: myName });
    setCall(null);
    cleanup();
  }, [call, cleanup, myName]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  }, []);

  // ---- signaling inbound ----
  useEffect(() => {
    return wsEvents.on((msg: any) => {
      if (!msg?.fromUserId) return;
      const fromId = Number(msg.fromUserId);

      if (msg.type === "ice_candidate" && msg.candidate) {
        const peer = activePeerIdRef.current;
        if (peer && fromId !== peer) return;
        if (pcRef.current?.remoteDescription) {
          (pcRef.current as any).addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        } else {
          pendingIce.current.push(msg.candidate);
        }
      } else if (msg.type === "call_offer") {
        if (activePeerIdRef.current) return; // busy
        const sdp = msg.sdp;
        const offerDesc = typeof sdp === "string" ? { type: "offer", sdp } : sdp?.sdp ? { type: "offer", sdp: sdp.sdp } : sdp;
        activePeerIdRef.current = fromId;
        setCall({ peerId: fromId, peerName: msg.fromUserName || t("dispatcher"), direction: "incoming", state: "ringing", offer: offerDesc });
        Vibration.vibrate([0, 800, 600, 800, 600], true);
        playCall(); // bundled call.mp3 ringtone (loops until answered/ended)
      } else if (msg.type === "call_answer" && pcRef.current && msg.sdp && fromId === activePeerIdRef.current) {
        const sdp = typeof msg.sdp === "string" ? { type: "answer", sdp: msg.sdp } : msg.sdp.sdp ? { type: "answer", sdp: msg.sdp.sdp } : msg.sdp;
        (pcRef.current as any)
          .setRemoteDescription(new RTCSessionDescription(sdp))
          .then(() => pcRef.current && drainIce(pcRef.current))
          .catch(() => {});
      } else if ((msg.type === "call_end" || msg.type === "call_reject") && fromId === activePeerIdRef.current) {
        endLocal();
      }
    });
  }, [drainIce, endLocal, t]);

  useEffect(() => () => cleanup(), [cleanup]);

  return (
    <VoiceCallContext.Provider value={{ startCall }}>
      {children}
      {call && (
        <View
          style={{ position: "absolute", inset: 0, zIndex: 300 }}
          className="bg-black/80 items-center justify-center px-6"
        >
          <View className="w-full max-w-sm bg-card rounded-3xl border border-border overflow-hidden">
            <View className="items-center px-6 py-8">
              <View
                className={`w-24 h-24 rounded-full items-center justify-center mb-4 ${
                  call.state === "active" ? "bg-emerald-500/15" : "bg-primary/15"
                }`}
              >
                <Phone size={44} color={call.state === "active" ? colors.emerald : colors.primary} />
              </View>
              <Text className="font-sans text-muted-foreground text-sm">
                {call.state === "ringing"
                  ? call.direction === "incoming"
                    ? t("call_incoming")
                    : t("call_dialing")
                  : call.state === "connecting"
                    ? t("call_connecting")
                    : call.state === "active"
                      ? fmt(duration)
                      : t("call_ended")}
              </Text>
              <Text className="font-display text-foreground text-xl mt-1 mb-7">{call.peerName}</Text>

              {call.state === "ringing" && call.direction === "incoming" ? (
                <View className="flex-row" style={{ gap: 40 }}>
                  <Pressable onPress={reject} className="w-16 h-16 rounded-full bg-red-500 items-center justify-center active:opacity-90">
                    <PhoneOff size={28} color="#fff" />
                  </Pressable>
                  <Pressable onPress={accept} className="w-16 h-16 rounded-full bg-emerald-500 items-center justify-center active:opacity-90">
                    <Phone size={28} color="#fff" />
                  </Pressable>
                </View>
              ) : call.state === "ended" ? null : (
                <View className="flex-row items-center" style={{ gap: 24 }}>
                  <Pressable
                    onPress={toggleMute}
                    className={`w-14 h-14 rounded-full items-center justify-center ${muted ? "bg-red-500/15" : "bg-secondary"}`}
                  >
                    {muted ? <MicOff size={24} color={colors.red} /> : <Mic size={24} color={colors.foreground} />}
                  </Pressable>
                  <Pressable onPress={end} className="w-16 h-16 rounded-full bg-red-500 items-center justify-center active:opacity-90">
                    <PhoneOff size={28} color="#fff" />
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </View>
      )}
    </VoiceCallContext.Provider>
  );
}
