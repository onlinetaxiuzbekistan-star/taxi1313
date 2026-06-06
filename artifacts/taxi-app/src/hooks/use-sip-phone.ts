import { useState, useEffect, useRef, useCallback } from "react";

export type SipStatus = "disconnected" | "connecting" | "registered" | "error";
export type CallDirection = "incoming" | "outgoing";
export type CallState = "idle" | "ringing" | "active" | "held" | "ended";

export interface SipConfig {
  server: string;
  domain: string;
  login: string;
  password: string;
}

export interface SipCallInfo {
  direction: CallDirection;
  state: CallState;
  remoteNumber: string;
  startedAt: number;
  isMuted: boolean;
  isHeld: boolean;
}

const SIP_CONFIG_KEY = "buxtaxi_sip_config";

export function loadSipConfig(): SipConfig | null {
  try {
    const raw = localStorage.getItem(SIP_CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (cfg.server && cfg.login && cfg.password) {
      return { server: cfg.server, domain: cfg.domain || cfg.server, login: cfg.login, password: cfg.password };
    }
    return null;
  } catch { return null; }
}

export function saveSipConfig(cfg: SipConfig) {
  localStorage.setItem(SIP_CONFIG_KEY, JSON.stringify(cfg));
}

export function clearSipConfig() {
  localStorage.removeItem(SIP_CONFIG_KEY);
}

function genBranch() { return "z9hG4bK" + Math.random().toString(36).substr(2, 12); }
function genTag() { return Math.random().toString(36).substr(2, 10); }
function genCallId() { return Math.random().toString(36).substr(2, 12) + "@buxtaxi"; }

function normalizeUzPhone(raw: string): string {
  if (!raw) return raw;
  let n = raw.replace(/[^\d]/g, "");
  while (n.startsWith("998998")) n = n.slice(3);
  if (n.length === 9) n = "998" + n;
  if (n.length < 9) return raw;
  return "+" + n;
}

function md5Sync(str: string): string {
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const bitLen = str.length * 8;
  bytes.push(bitLen & 0xff, (bitLen >> 8) & 0xff, (bitLen >> 16) & 0xff, (bitLen >> 24) & 0xff, 0, 0, 0, 0);
  
  function leftRotate(x: number, c: number) { return (x << c) | (x >>> (32 - c)); }
  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391
  ];
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  
  for (let off = 0; off < bytes.length; off += 64) {
    const M: number[] = [];
    for (let j = 0; j < 16; j++) {
      M[j] = bytes[off+j*4] | (bytes[off+j*4+1]<<8) | (bytes[off+j*4+2]<<16) | (bytes[off+j*4+3]<<24);
    }
    let a = h0, b = h1, c = h2, d = h3;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5*i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3*i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7*i) % 16; }
      const temp = d; d = c; c = b;
      b = (b + leftRotate((a + f + K[i] + M[g]) | 0, s[i])) | 0;
      a = temp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
  }
  
  function toHex(n: number) {
    return ((n & 0xff).toString(16).padStart(2,"0")) +
      (((n>>8) & 0xff).toString(16).padStart(2,"0")) +
      (((n>>16) & 0xff).toString(16).padStart(2,"0")) +
      (((n>>24) & 0xff).toString(16).padStart(2,"0"));
  }
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3);
}

function parseSipMessage(raw: string): { firstLine: string; headers: Record<string, string>; body: string } {
  const parts = raw.split("\r\n\r\n");
  const headerPart = parts[0];
  const body = parts.slice(1).join("\r\n\r\n");
  const lines = headerPart.split("\r\n");
  const firstLine = lines[0];
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(":");
    if (idx > 0) {
      const key = lines[i].substring(0, idx).trim().toLowerCase();
      const val = lines[i].substring(idx + 1).trim();
      headers[key] = val;
    }
  }
  return { firstLine, headers, body };
}

export function useSipPhone() {
  if (!window.isSecureContext) return { status: "unavailable" as const, callInfo: null, config: null, waitingCalls: [] as any[], connect: () => {}, disconnect: () => {}, makeCall: () => {}, answerCall: () => {}, rejectCall: () => {}, hangup: () => {}, toggleMute: () => {}, toggleHold: () => {}, sendDtmf: () => {}, transferCall: () => {}, setOnIncomingCall: () => {} };
  const [status, setStatus] = useState<SipStatus>("disconnected");
  const [callInfo, setCallInfo] = useState<SipCallInfo | null>(null);
  const [waitingCalls, setWaitingCalls] = useState<Array<{
    remoteNumber: string;
    from: string;
    to: string;
    via: string;
    callId: string;
    cseq: string;
    sdp: string;
    startedAt: number;
  }>>([]);
  const [config, setConfig] = useState<SipConfig | null>(loadSipConfig());

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callIdRef = useRef<string | null>(null);
  const onIncomingRef = useRef<((phone: string) => void) | null>(null);
  const configRef = useRef<SipConfig | null>(null);
  const statusRef = useRef<SipStatus>("disconnected");
  const callInfoRef = useRef<SipCallInfo | null>(null);
  const regCallIdRef = useRef<string>(genCallId());
  const regCseqRef = useRef<number>(1);
  const fromTagRef = useRef<string>(genTag());
  const contactRef = useRef<string>("");
  const reRegTimerRef = useRef<any>(null);
  const registerPendingRef = useRef(false);
  const incomingSdpRef = useRef<string | null>(null);
  const incomingFromRef = useRef<string>("");
  const incomingToRef = useRef<string>("");
  const incomingViaRef = useRef<string>("");
  const incomingCallIdRef = useRef<string>("");
  const incomingCseqRef = useRef<string>("");
  const reconnectDelayRef = useRef<number>(3000);
  const reconnectTimerRef = useRef<any>(null);
  const intentionalCloseRef = useRef(false);
  const isConnectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const callCseqRef = useRef<number>(1);
  const callFromTagRef = useRef<string>("");
  const callToTagRef = useRef<string>("");
  const callFromRef = useRef<string>("");
  const callToRef = useRef<string>("");
  const rtpAudioWsRef = useRef<WebSocket | null>(null);
  const callViaRef = useRef<string>("");
  const mountedRef = useRef(true);
  const playCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { callInfoRef.current = callInfo; }, [callInfo]);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const updateStatus = useCallback((s: SipStatus) => {
    if (!mountedRef.current) return;
    statusRef.current = s;
    setStatus(s);
  }, []);

  const sendSip = useCallback((msg: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    console.log("[SIP] >>>", msg.split("\r\n")[0]);
    ws.send(msg);
  }, []);

  const cleanupCall = useCallback(() => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (remoteAudioRef.current) {
      try { remoteAudioRef.current.srcObject = null; } catch {}
      try { remoteAudioRef.current.pause(); } catch {}
      try { remoteAudioRef.current.remove(); } catch {}
      remoteAudioRef.current = null;
    }
    if (rtpAudioWsRef.current) {
      console.log("[SIP] Closing RTP audio WS");
      rtpAudioWsRef.current.close();
      rtpAudioWsRef.current = null;
    }
    callIdRef.current = null;
    incomingSdpRef.current = null;
    callInfoRef.current = null;
    setCallInfo(null);
  }, []);

  const ensureAudioEl = useCallback(() => {
    if (!remoteAudioRef.current) {
      const el = document.createElement("audio");
      el.autoplay = true;
      el.volume = 1.0;
      document.body.appendChild(el);
      remoteAudioRef.current = el;
    }
    return remoteAudioRef.current;
  }, []);

  const createPC = useCallback(async () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const audioEl = ensureAudioEl();
    pc.ontrack = (ev) => {
      console.log("[SIP] ontrack", ev.track.kind);
      const s = ev.streams[0] || new MediaStream([ev.track]);
      audioEl.srcObject = s;
      audioEl.play().catch(() => {});
    };

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        console.log("[SIP] Mic acquired");
      } else {
        console.warn("[SIP] getUserMedia not available");
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        const dest = ctx.createMediaStreamDestination();
        gain.connect(dest);
        osc.start();
        localStreamRef.current = dest.stream;
        dest.stream.getTracks().forEach(t => pc.addTrack(t, dest.stream));
      }
    } catch (err) {
      console.error("[SIP] Mic error:", err);
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      const dest = ctx.createMediaStreamDestination();
      gain.connect(dest);
      osc.start();
      localStreamRef.current = dest.stream;
      dest.stream.getTracks().forEach(t => pc.addTrack(t, dest.stream));
    }

    pcRef.current = pc;
    return pc;
  }, [ensureAudioEl]);

  const sendRegister = useCallback((cfg: SipConfig, authHeader?: string) => {
    if (!authHeader && registerPendingRef.current) {
      console.log("[SIP] Skipping REGISTER — previous still pending");
      return;
    }
    registerPendingRef.current = true;
    const branch = genBranch();
    const domain = cfg.domain || cfg.server;
    contactRef.current = "sip:" + cfg.login + "@buxtaxi.local;transport=tcp";
    const lines = [
      "REGISTER sip:" + domain + " SIP/2.0",
      "Via: SIP/2.0/TCP buxtaxi.local;branch=" + branch,
      "From: <sip:" + cfg.login + "@" + domain + ">;tag=" + fromTagRef.current,
      "To: <sip:" + cfg.login + "@" + domain + ">",
      "Call-ID: " + regCallIdRef.current,
      "CSeq: " + (regCseqRef.current++) + " REGISTER",
      "Contact: <" + contactRef.current + ">",
      "Max-Forwards: 70",
      "User-Agent: BuxTaxi/1.0",
      "Expires: 120",
    ];
    if (authHeader) lines.push("Authorization: " + authHeader);
    lines.push("Content-Length: 0", "", "");
    sendSip(lines.join("\r\n"));
  }, [sendSip]);

  const connectInternal = useCallback(async (sipCfg: SipConfig) => {
    if (isConnectingRef.current) {
      console.log("[SIP] Connect already in progress, skipping");
      return;
    }

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN && configRef.current &&
          configRef.current.login === sipCfg.login && configRef.current.server === sipCfg.server) {
        console.log("[SIP] Already connected with same config, skipping");
        return;
      }
      if (wsRef.current.readyState === WebSocket.CONNECTING) {
        console.log("[SIP] Already connecting, skipping");
        return;
      }
      intentionalCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (reRegTimerRef.current) { clearInterval(reRegTimerRef.current); reRegTimerRef.current = null; }

    isConnectingRef.current = true;
    updateStatus("connecting");
    configRef.current = sipCfg;
    setConfig(sipCfg);
    saveSipConfig(sipCfg);

    regCallIdRef.current = genCallId();
    regCseqRef.current = 1;
    fromTagRef.current = genTag();

    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const sipBase = ((import.meta as any).env?.BASE_URL || "/").replace(/\/$/, "");
    const wsUrl = wsProto + "://" + window.location.host + sipBase + "/wss-sip-proxy";
    console.log("[SIP] Connecting:", wsUrl, "login:", sipCfg.login, "attempt:", reconnectAttemptsRef.current);

    try {
      const ws = new WebSocket(wsUrl, "sip");
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[SIP] WS open, sending REGISTER");
        isConnectingRef.current = false;
        sendRegister(sipCfg);
      };

      ws.onmessage = (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : "";

        if (raw.startsWith('__JSON__')) {
          try {
            const json = JSON.parse(raw.substring(8));
            if (json.type === 'waiting_calls') {
              console.log('[SIP] Waiting calls update:', json.calls?.length || 0);
              setWaitingCalls(json.calls.map((c: any) => ({
                remoteNumber: c.number,
                from: '', to: '', via: '', callId: c.callId, cseq: '', sdp: '',
                startedAt: c.since,
              })));
            }
          } catch (e) {
            console.error('[SIP] JSON parse error:', e);
          }
          return;
        }

        const msg = parseSipMessage(raw);
        console.log("[SIP] <<<", msg.firstLine);

        if (msg.firstLine.startsWith("SIP/2.0 401") || msg.firstLine.startsWith("SIP/2.0 407")) {
          registerPendingRef.current = false;
          const authLine = msg.headers["www-authenticate"] || msg.headers["proxy-authenticate"] || "";
          const realm = authLine.match(/realm="([^"]+)"/)?.[1] || "";
          const nonce = authLine.match(/nonce="([^"]+)"/)?.[1] || "";
          const cseqLine = msg.headers["cseq"] || "";
          const cseqMethod = cseqLine.trim().split(/\s+/).pop()?.toUpperCase() || "REGISTER";
          
          if (realm && nonce) {
            const domain = sipCfg.domain || sipCfg.server;
            
            if (cseqMethod === "INVITE") {
              if (!callIdRef.current || !callToRef.current) {
                console.log("[SIP] Ignoring 407/401 for INVITE - no active call");
                return;
              }
              const responseCallId = msg.headers["call-id"] || "";
              if (responseCallId && responseCallId !== callIdRef.current) {
                console.log("[SIP] Ignoring 407/401 for wrong call-id:", responseCallId, "expected:", callIdRef.current);
                return;
              }
              const targetNum = callToRef.current?.match(/sip:([^@>]+)/)?.[1] || "";
              const inviteUri = "sip:" + targetNum + "@" + domain;

              const origCseq = cseqLine.trim().split(/\s+/)[0] || String(callCseqRef.current);
              const ack407 = [
                "ACK " + inviteUri + " SIP/2.0",
                "Via: SIP/2.0/TCP buxtaxi.local;branch=" + genBranch(),
                "From: " + callFromRef.current,
                "To: " + msg.headers["to"],
                "Call-ID: " + callIdRef.current,
                "CSeq: " + origCseq + " ACK",
                "Max-Forwards: 70",
                "Content-Length: 0", "", ""
              ].join("\r\n");
              console.log("[SIP] ACKing 407/401 before re-INVITE");
              sendSip(ack407);

              const ha1 = md5Sync(sipCfg.login + ":" + realm + ":" + sipCfg.password);
              const ha2 = md5Sync("INVITE:" + inviteUri);
              const response = md5Sync(ha1 + ":" + nonce + ":" + ha2);
              const authHdr = msg.firstLine.startsWith("SIP/2.0 407") ? "Proxy-Authorization" : "Authorization";
              
              const sdp = [
                "v=0",
                "o=BuxTaxi 1 1 IN IP4 192.168.1.107",
                "s=BuxTaxi",
                "c=IN IP4 192.168.1.107",
                "t=0 0",
                "m=audio 20000 RTP/AVP 8 0 101",
                "a=rtpmap:8 PCMA/8000",
                "a=rtpmap:0 PCMU/8000",
                "a=rtpmap:101 telephone-event/8000",
                "a=fmtp:101 0-16",
                "a=sendrecv",
                "a=ptime:20",
                ""
              ].join("\r\n");
              callCseqRef.current++;
              const invite = [
                "INVITE " + inviteUri + " SIP/2.0",
                "Via: SIP/2.0/TCP buxtaxi.local;branch=" + genBranch(),
                "From: " + callFromRef.current,
                "To: " + callToRef.current,
                "Call-ID: " + callIdRef.current,
                "CSeq: " + callCseqRef.current + " INVITE",
                "Contact: <" + contactRef.current + ">",
                "Max-Forwards: 70",
                "User-Agent: BuxTaxi/1.0",
                authHdr + ': Digest username="' + sipCfg.login + '", realm="' + realm + '", nonce="' + nonce + '", uri="' + inviteUri + '", response="' + response + '", algorithm=MD5',
                "Content-Type: application/sdp",
                "Content-Length: " + new TextEncoder().encode(sdp).length,
                "",
                sdp
              ].join("\r\n");
              console.log("[SIP] Sending authenticated INVITE to", targetNum);
              sendSip(invite);
            } else {
              const ha1 = md5Sync(sipCfg.login + ":" + realm + ":" + sipCfg.password);
              const ha2 = md5Sync("REGISTER:sip:" + domain);
              const response = md5Sync(ha1 + ":" + nonce + ":" + ha2);
              const auth = 'Digest username="' + sipCfg.login + '", realm="' + realm + '", nonce="' + nonce + '", uri="sip:' + domain + '", response="' + response + '", algorithm=MD5';
              console.log("[SIP] Sending authenticated REGISTER");
              sendRegister(sipCfg, auth);
            }
          }
          return;
        }

        if (msg.firstLine.startsWith("SIP/2.0 200") && raw.includes("CSeq") && raw.match(/CSeq:\s*\d+\s+REGISTER/i)) {
          console.log("[SIP] Registered OK!");
          registerPendingRef.current = false;
          reconnectDelayRef.current = 3000;
          reconnectAttemptsRef.current = 0;
          updateStatus("registered");
          if (reRegTimerRef.current) clearInterval(reRegTimerRef.current);
          reRegTimerRef.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              sendRegister(sipCfg);
            }
          }, 105000);
          return;
        }

        if (msg.firstLine.match(/^SIP\/2\.0 (500|503)/) && raw.match(/CSeq:\s*\d+\s+REGISTER/i)) {
          console.log("[SIP] Got 500/503 on REGISTER, will retry on next cycle");
          registerPendingRef.current = false;
          return;
        }

        if (msg.firstLine.startsWith("INVITE ")) {
          const from = msg.headers["from"] || "";
          const callerMatch = from.match(/sip:([^@>]+)/);
          const caller = callerMatch ? normalizeUzPhone(callerMatch[1]) : "unknown";
          const sdp = msg.body || "";
          const inviteVia = raw.split("\r\n").filter(l => l.toLowerCase().startsWith("via:")).join("\r\n");
          const inviteFrom = msg.headers["from"] || "";
          const inviteTo = msg.headers["to"] || "";
          const inviteCallId = msg.headers["call-id"] || "";
          const inviteCseq = msg.headers["cseq"] || "";
          
          console.log("[SIP] Incoming INVITE from:", caller, "has SDP:", !!sdp);
          
          const trying = [
            "SIP/2.0 100 Trying",
            ...raw.split("\r\n").filter(l => l.toLowerCase().startsWith("via:")),
            "From: " + inviteFrom,
            "To: " + inviteTo,
            "Call-ID: " + inviteCallId,
            "CSeq: " + inviteCseq,
            "Content-Length: 0", "", ""
          ].join("\r\n");
          sendSip(trying);

          const toWithTag = inviteTo.includes("tag=") ? inviteTo : inviteTo + ";tag=" + genTag();

          const ringing = [
            "SIP/2.0 180 Ringing",
            ...raw.split("\r\n").filter(l => l.toLowerCase().startsWith("via:")),
            "From: " + inviteFrom,
            "To: " + toWithTag,
            "Call-ID: " + inviteCallId,
            "CSeq: " + inviteCseq,
            "Contact: <" + contactRef.current + ">",
            "Content-Length: 0", "", ""
          ].join("\r\n");
          sendSip(ringing);

          if (callInfoRef.current) {
            console.log("[SIP] Already in call, queuing caller:", caller);
            setWaitingCalls(prev => [...prev, {
              remoteNumber: caller,
              from: inviteFrom,
              to: toWithTag,
              via: inviteVia,
              callId: inviteCallId,
              cseq: inviteCseq,
              sdp: sdp,
              startedAt: Date.now(),
            }]);
          } else {
            incomingSdpRef.current = sdp || null;
            incomingFromRef.current = inviteFrom;
            incomingToRef.current = toWithTag;
            incomingViaRef.current = inviteVia;
            incomingCallIdRef.current = inviteCallId;
            incomingCseqRef.current = inviteCseq;
            callIdRef.current = inviteCallId;
            
            const ci = {
              direction: "incoming" as const, state: "ringing" as const, remoteNumber: caller,
              startedAt: Date.now(), isMuted: false, isHeld: false,
            };
            callInfoRef.current = ci;
            setCallInfo(ci);
            console.log("[SIP] Pre-connecting RTP audio during ringing...");
            connectRtpAudio();
          }
          onIncomingRef.current?.(caller);
          return;
        }

        if (msg.firstLine.startsWith("SIP/2.0 200") && raw.match(/CSeq:\s*\d+\s+INVITE/i)) {
          const okCallId = msg.headers["call-id"] || "";
          if (!callIdRef.current || okCallId !== callIdRef.current) {
            console.log("[SIP] Ignoring 200 OK for unknown INVITE call:", okCallId);
            return;
          }
          console.log("[SIP] 200 OK for INVITE");
          const sdp = msg.body;
          if (sdp && pcRef.current) {
            pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }))
              .then(() => console.log("[SIP] Remote SDP set"))
              .catch(e => console.error("[SIP] SDP error:", e));
          }
          if (!rtpAudioWsRef.current) {
            console.log("[SIP] Outgoing call 200 OK - connecting RTP audio");
            connectRtpAudio();
          }
          const toTag = (msg.headers["to"] || "").match(/tag=([^;>]+)/)?.[1] || "";
          callToTagRef.current = toTag;
          
          const contactUri = msg.headers["contact"]?.match(/<([^>]+)>/)?.[1] || "sip:" + (configRef.current?.domain || "");
          const ack = [
            "ACK " + contactUri + " SIP/2.0",
            "Via: SIP/2.0/TCP buxtaxi.local;branch=" + genBranch(),
            "From: " + callFromRef.current,
            "To: " + msg.headers["to"],
            "Call-ID: " + callIdRef.current,
            "CSeq: " + callCseqRef.current + " ACK",
            "Max-Forwards: 70",
            "Content-Length: 0", "", ""
          ].join("\r\n");
          sendSip(ack);
          
          setCallInfo(prev => prev ? { ...prev, state: "active" } : null);
          return;
        }

        const responseCode = parseInt(msg.firstLine.split(' ')[1] || '0');
        const responseCallId = msg.headers["call-id"] || "";
        if (responseCode >= 400 && raw.match(/CSeq:\s*\d+\s+INVITE/i)) {
          if (callIdRef.current && responseCallId === callIdRef.current) {
            console.log("[SIP] Error response for OUR INVITE:", msg.firstLine);
            const targetUri = callToRef.current?.match(/sip:[^>]+/)?.[0] || "sip:" + (configRef.current?.domain || "");
            const ack = [
              "ACK " + targetUri + " SIP/2.0",
              "Via: SIP/2.0/TCP buxtaxi.local;branch=" + genBranch(),
              "From: " + callFromRef.current,
              "To: " + msg.headers["to"],
              "Call-ID: " + responseCallId,
              "CSeq: " + callCseqRef.current + " ACK",
              "Max-Forwards: 70",
              "Content-Length: 0", "", ""
            ].join("\r\n");
            sendSip(ack);
            cleanupCall();
          } else {
            console.log("[SIP] Ignoring error for unknown call:", responseCode, responseCallId);
          }
          return;
        }

        if (msg.firstLine.startsWith("SIP/2.0 180") || msg.firstLine.startsWith("SIP/2.0 183")) {
          console.log("[SIP] Ringing/Progress, has SDP:", !!msg.body);
          if (msg.body && msg.body.includes("m=audio")) {
            console.log("[SIP] Early media SDP detected - RTP audio should receive ringback");
          }
          if (!rtpAudioWsRef.current) {
            console.log("[SIP] Connecting RTP audio for early media/ringback");
            connectRtpAudio();
          }
          setCallInfo(prev => prev ? { ...prev, state: "ringing" } : null);
          return;
        }

        if (msg.firstLine.startsWith("BYE ")) {
          console.log("[SIP] BYE received");
          const ok = [
            "SIP/2.0 200 OK",
            ...raw.split("\r\n").filter(l => l.toLowerCase().startsWith("via:")),
            "From: " + msg.headers["from"],
            "To: " + msg.headers["to"],
            "Call-ID: " + msg.headers["call-id"],
            "CSeq: " + msg.headers["cseq"],
            "Content-Length: 0", "", ""
          ].join("\r\n");
          sendSip(ok);
          cleanupCall();
          return;
        }

        if (msg.firstLine.startsWith("SIP/2.0 200") && raw.match(/CSeq:\s*\d+\s+BYE/i)) {
          console.log("[SIP] BYE confirmed");
          cleanupCall();
          return;
        }

        if (msg.firstLine.startsWith("CANCEL ")) {
          const cancelCallId = msg.headers["call-id"] || "";
          console.log("[SIP] CANCEL received for call-id:", cancelCallId);
          
          const ok = [
            "SIP/2.0 200 OK",
            ...raw.split("\r\n").filter(l => l.toLowerCase().startsWith("via:")),
            "From: " + msg.headers["from"],
            "To: " + msg.headers["to"],
            "Call-ID: " + cancelCallId,
            "CSeq: " + msg.headers["cseq"],
            "Content-Length: 0", "", ""
          ].join("\r\n");
          sendSip(ok);

          if (callIdRef.current === cancelCallId) {
            const reqTerm = [
              "SIP/2.0 487 Request Terminated",
              ...raw.split("\r\n").filter(l => l.toLowerCase().startsWith("via:")),
              "From: " + incomingFromRef.current,
              "To: " + incomingToRef.current,
              "Call-ID: " + cancelCallId,
              "CSeq: " + incomingCseqRef.current,
              "Content-Length: 0", "", ""
            ].join("\r\n");
            sendSip(reqTerm);
            cleanupCall();
          } else {
            setWaitingCalls(prev => {
              const wc = prev.find(w => w.callId === cancelCallId);
              if (wc) {
                const reqTerm = [
                  "SIP/2.0 487 Request Terminated",
                  ...raw.split("\r\n").filter(l => l.toLowerCase().startsWith("via:")),
                  "From: " + wc.from,
                  "To: " + wc.to,
                  "Call-ID: " + cancelCallId,
                  "CSeq: " + wc.cseq,
                  "Content-Length: 0", "", ""
                ].join("\r\n");
                sendSip(reqTerm);
              }
              return prev.filter(w => w.callId !== cancelCallId);
            });
          }
          return;
        }

        if (msg.firstLine.startsWith("ACK ")) {
          console.log("[SIP] ACK received");
          return;
        }
      };

      ws.onerror = (err) => {
        console.error("[SIP] WS error", err);
        isConnectingRef.current = false;
      };

      ws.onclose = (ev) => {
        console.log("[SIP] WS closed, code:", ev.code, "intentional:", intentionalCloseRef.current);
        isConnectingRef.current = false;
        registerPendingRef.current = false;
        if (reRegTimerRef.current) { clearInterval(reRegTimerRef.current); reRegTimerRef.current = null; }
        if (wsRef.current === ws) wsRef.current = null;

        if (intentionalCloseRef.current) {
          intentionalCloseRef.current = false;
          return;
        }

        if (!mountedRef.current) return;

        updateStatus("disconnected");

        if (configRef.current && reconnectAttemptsRef.current < 20) {
          const delay = reconnectDelayRef.current;
          reconnectDelayRef.current = Math.min(delay * 1.5, 30000);
          reconnectAttemptsRef.current++;
          console.log("[SIP] Will reconnect in", delay, "ms (attempt", reconnectAttemptsRef.current, ")");
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (configRef.current && statusRef.current === "disconnected" && mountedRef.current) {
              console.log("[SIP] Reconnecting...");
              connectInternal(configRef.current);
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= 20) {
          console.log("[SIP] Max reconnect attempts reached, giving up");
          updateStatus("error");
        }
      };
    } catch (err) {
      console.error("[SIP] Connect error:", err);
      isConnectingRef.current = false;
      updateStatus("error");
    }
  }, [sendRegister, sendSip, cleanupCall, createPC, updateStatus]);

  const connect = useCallback(async (cfg?: SipConfig) => {
    const sipCfg = cfg || configRef.current;
    if (!sipCfg) { console.log("[SIP] No config"); return; }
    reconnectAttemptsRef.current = 0;
    reconnectDelayRef.current = 3000;
    await connectInternal(sipCfg);
  }, [connectInternal]);

  const disconnect = useCallback(() => {
    if (reRegTimerRef.current) { clearInterval(reRegTimerRef.current); reRegTimerRef.current = null; }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    configRef.current = null;
    setConfig(null);
    clearSipConfig();
    isConnectingRef.current = false;
    if (wsRef.current) { intentionalCloseRef.current = true; wsRef.current.close(); wsRef.current = null; }
    cleanupCall();
    updateStatus("disconnected");
  }, [cleanupCall, updateStatus]);

  const makeCall = useCallback(async (number: string) => {
    if (statusRef.current !== "registered" || !configRef.current) return;
    if (callIdRef.current) {
      console.log("[SIP] Already in a call, ignoring makeCall");
      return;
    }
    try { await playCtxRef.current?.resume(); } catch {}
    console.log("[SIP] makeCall: playCtx state after resume:", playCtxRef.current?.state);
    const cfg = configRef.current;
    const domain = cfg.domain || cfg.server;

    const sdp = [
      "v=0",
      "o=BuxTaxi 1 1 IN IP4 192.168.1.107",
      "s=BuxTaxi",
      "c=IN IP4 192.168.1.107",
      "t=0 0",
      "m=audio 20000 RTP/AVP 8 0 101",
      "a=rtpmap:8 PCMA/8000",
      "a=rtpmap:0 PCMU/8000",
      "a=rtpmap:101 telephone-event/8000",
      "a=fmtp:101 0-16",
      "a=sendrecv",
      "a=ptime:20",
      ""
    ].join("\r\n");

    const newCallId = genCallId();
    callIdRef.current = newCallId;
    callCseqRef.current = 1;
    callFromTagRef.current = genTag();
    callFromRef.current = '<sip:' + cfg.login + '@' + domain + '>;tag=' + callFromTagRef.current;
    callToRef.current = '<sip:' + number + '@' + domain + '>';

    const invite = [
      "INVITE sip:" + number + "@" + domain + " SIP/2.0",
      "Via: SIP/2.0/TCP buxtaxi.local;branch=" + genBranch(),
      "From: " + callFromRef.current,
      "To: " + callToRef.current,
      "Call-ID: " + newCallId,
      "CSeq: " + (callCseqRef.current) + " INVITE",
      "Contact: <" + contactRef.current + ">",
      "Max-Forwards: 70",
      "User-Agent: BuxTaxi/1.0",
      "Content-Type: application/sdp",
      "Content-Length: " + new TextEncoder().encode(sdp).length,
      "",
      sdp
    ].join("\r\n");
    sendSip(invite);

    connectRtpAudio();

    setCallInfo({
      direction: "outgoing", state: "ringing", remoteNumber: number,
      startedAt: Date.now(), isMuted: false, isHeld: false,
    });
  }, [sendSip]);

  function patchSdpForWebRTC(sdp: string): string {
    let patched = sdp;
    if (!patched.includes('a=fingerprint:')) {
      patched = patched.replace(/(a=setup:\S+)/g, '');
      patched = patched.replace(/(m=audio[^\r\n]*)/g, '$1\r\na=setup:actpass\r\na=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00');
    }
    if (!patched.includes('a=ice-ufrag:')) {
      patched = patched.replace(/(m=audio[^\r\n]*)/g, '$1\r\na=ice-ufrag:dummy\r\na=ice-pwd:dummyicepwddummyicepwd');
    }
    if (!patched.includes('a=mid:')) {
      patched = patched.replace(/(m=audio[^\r\n]*)/g, '$1\r\na=mid:0');
    }
    patched = patched.replace(/RTP\/AVP/g, 'RTP/SAVPF');
    if (!patched.includes('a=rtcp-mux')) {
      patched = patched.replace(/(m=audio[^\r\n]*)/g, '$1\r\na=rtcp-mux');
    }
    return patched;
  }

  function floatToAlaw(sample: number): number {
    let pcm = Math.round(sample * 32767);
    pcm = Math.max(-32767, Math.min(32767, pcm));

    let mask: number;
    if (pcm >= 0) {
      mask = 0xD5;
    } else {
      mask = 0x55;
      pcm = -pcm - 1;
    }

    pcm = pcm >> 3;

    const segEnd = [0x1F, 0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF];
    let seg = 0;
    for (seg = 0; seg < 8; seg++) {
      if (pcm <= segEnd[seg]) break;
    }

    if (seg >= 8) return 0x7F ^ mask;

    let aval = seg << 4;
    if (seg < 2) {
      aval |= (pcm >> 1) & 0x0F;
    } else {
      aval |= (pcm >> seg) & 0x0F;
    }
    return aval ^ mask;
  }

  function connectRtpAudio() {
    if (rtpAudioWsRef.current && rtpAudioWsRef.current.readyState <= 1) {
      console.log("[SIP] RTP audio already connected");
      return;
    }
    try {
      const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
      const audioWsUrl = wsProto + "://" + window.location.host + "/wss-audio";
      console.log("[SIP] Connecting audio WS:", audioWsUrl);
      const audioWs = new WebSocket(audioWsUrl);
      audioWs.binaryType = "arraybuffer";
      rtpAudioWsRef.current = audioWs;
      
      const playCtx = new AudioContext();
      playCtxRef.current = playCtx;
      let nextPlayTime = 0;
      const playGain = playCtx.createGain();
      playGain.gain.value = 2.0;
      playGain.connect(playCtx.destination);

      console.log("[SIP] playCtx created state=", playCtx.state, "sr=", playCtx.sampleRate, "(native, will resample 8k->", playCtx.sampleRate, ")");

      audioWs.onmessage = async (ev) => {
        try {
          let buf: ArrayBuffer;
          if (ev.data instanceof ArrayBuffer) {
            buf = ev.data;
          } else if (ev.data instanceof Blob) {
            buf = await ev.data.arrayBuffer();
          } else {
            console.warn("[SIP] Audio WS unexpected data type:", typeof ev.data, ev.data);
            return;
          }
          const data = new Uint8Array(buf);
          const off = rtpPayloadOffset(data);
          if (off == null) {
            const w0 = window as any;
            if (w0.__sip_bad_rtp == null) w0.__sip_bad_rtp = 0;
            w0.__sip_bad_rtp++;
            if (w0.__sip_bad_rtp % 50 === 1) {
              console.warn("[SIP] bad RTP packet, len=", data.length, "first2bytes=", data[0]?.toString(16), data[1]?.toString(16));
            }
            return;
          }

          const payloadType = data[1] & 0x7F;
          const payload = data.slice(off);

          const w = window as any;
          if (w.__sip_rx_cnt == null) w.__sip_rx_cnt = 0;
          w.__sip_rx_cnt++;
          if (w.__sip_rx_cnt % 100 === 1) {
            const cc = data[0] & 0x0f;
            const x = (data[0] & 0x10) !== 0;
            console.log("[SIP] RTP packets received:", w.__sip_rx_cnt, "pt=", payloadType, "len=", data.length, "off=", off, "cc=", cc, "x=", x, "playCtx.state=", playCtx.state);
          }

          let pcmSamples: Float32Array;
          if (payloadType === 8) {
            pcmSamples = alawToFloat(payload);
          } else if (payloadType === 0) {
            pcmSamples = ulawToFloat(payload);
          } else {
            return;
          }

          const targetSR = playCtx.sampleRate;
          let upsampled: Float32Array;
          if (targetSR === 8000) {
            upsampled = pcmSamples;
          } else {
            const ratio = targetSR / 8000;
            const outLen = Math.floor(pcmSamples.length * ratio);
            upsampled = new Float32Array(outLen);
            for (let i = 0; i < outLen; i++) {
              const srcIdx = i / ratio;
              const i0 = Math.floor(srcIdx);
              const i1 = Math.min(i0 + 1, pcmSamples.length - 1);
              const frac = srcIdx - i0;
              upsampled[i] = pcmSamples[i0] * (1 - frac) + pcmSamples[i1] * frac;
            }
          }

          const buffer = playCtx.createBuffer(1, upsampled.length, targetSR);
          buffer.getChannelData(0).set(upsampled);
          const source = playCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(playGain);

          const now = playCtx.currentTime;
          if (nextPlayTime < now) nextPlayTime = now;
          const lag = nextPlayTime - now;
          if (lag > 0.5) {
            console.warn("[SIP] backlog drop, lag=", lag.toFixed(3), "s — resetting nextPlayTime");
            nextPlayTime = now;
          }

          if (w.__sip_rx_cnt % 100 === 1) {
            let maxAmp = 0;
            for (let i = 0; i < pcmSamples.length; i++) {
              const a = Math.abs(pcmSamples[i]);
              if (a > maxAmp) maxAmp = a;
            }
            console.log("[SIP] decoded maxAmp=", maxAmp.toFixed(4), "samples=", pcmSamples.length, "->", upsampled.length, "ctx.state=", playCtx.state, "lag=", lag.toFixed(3), "s");
          }

          source.start(nextPlayTime);
          nextPlayTime += buffer.duration;
        } catch (e) {
          console.error("[SIP] Audio WS onmessage error:", e);
        }
      };
      
      audioWs.onopen = async () => {
        console.log("[SIP] Audio WS connected, starting mic capture...");
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
          console.log("[SIP] Microphone captured OK, tracks:", micStream.getAudioTracks().length);
          
          const nativeSR = 48000;
          const targetSR = 8000;
          const micCtx = new AudioContext({ sampleRate: nativeSR });
          const micSource = micCtx.createMediaStreamSource(micStream);

          const lpFilter = micCtx.createBiquadFilter();
          lpFilter.type = "lowpass";
          lpFilter.frequency.value = 3400;
          lpFilter.Q.value = 0.7;

          const hpFilter = micCtx.createBiquadFilter();
          hpFilter.type = "highpass";
          hpFilter.frequency.value = 300;
          hpFilter.Q.value = 0.7;

          const gainNode = micCtx.createGain();
          gainNode.gain.value = 1.5;

          const bufferSize = 4096;
          const scriptNode = micCtx.createScriptProcessor(bufferSize, 1, 1);
          
          let seqNum = 0;
          let timestamp = 0;
          const ssrc = Math.floor(Math.random() * 0xFFFFFFFF);
          let micPacketCount = 0;
          
          const resampleRatio = nativeSR / targetSR;
          
          scriptNode.onaudioprocess = (e) => {
            if (audioWs.readyState !== WebSocket.OPEN) return;
            const input = e.inputBuffer.getChannelData(0);
            
            const ratio = Math.round(resampleRatio);
            const downsampledLen = Math.floor(input.length / ratio);
            const downsampled = new Float32Array(downsampledLen);
            for (let i = 0; i < downsampledLen; i++) {
              let sum = 0;
              const base = i * ratio;
              for (let j = 0; j < ratio; j++) {
                sum += input[base + j];
              }
              downsampled[i] = sum / ratio;
            }
            
            const frameSize = 160;
            for (let offset = 0; offset + frameSize <= downsampled.length; offset += frameSize) {
              const alawPayload = new Uint8Array(frameSize);
              for (let i = 0; i < frameSize; i++) {
                alawPayload[i] = floatToAlaw(downsampled[offset + i]);
              }
              
              const rtpPacket = new Uint8Array(12 + frameSize);
              rtpPacket[0] = 0x80;
              rtpPacket[1] = 8;
              rtpPacket[2] = (seqNum >> 8) & 0xFF;
              rtpPacket[3] = seqNum & 0xFF;
              rtpPacket[4] = (timestamp >> 24) & 0xFF;
              rtpPacket[5] = (timestamp >> 16) & 0xFF;
              rtpPacket[6] = (timestamp >> 8) & 0xFF;
              rtpPacket[7] = timestamp & 0xFF;
              rtpPacket[8] = (ssrc >> 24) & 0xFF;
              rtpPacket[9] = (ssrc >> 16) & 0xFF;
              rtpPacket[10] = (ssrc >> 8) & 0xFF;
              rtpPacket[11] = ssrc & 0xFF;
              rtpPacket.set(alawPayload, 12);
              
              audioWs.send(rtpPacket.buffer);
              seqNum = (seqNum + 1) & 0xFFFF;
              timestamp += frameSize;
            }
            
            micPacketCount++;
            if (micPacketCount % 50 === 1) {
              console.log("[SIP] Mic packets sent:", micPacketCount, "resampled:", downsampledLen, "from:", input.length);
            }
          };
          
          micSource.connect(hpFilter);
          hpFilter.connect(lpFilter);
          lpFilter.connect(gainNode);
          gainNode.connect(scriptNode);
          scriptNode.connect(micCtx.destination);
          
          audioWs.onclose = () => {
            console.log("[SIP] Audio WS closed, stopping mic, total packets:", micPacketCount);
            scriptNode.disconnect();
            micSource.disconnect();
            micStream.getTracks().forEach(t => t.stop());
            try { micCtx.close(); } catch {}
          };
        } catch (micErr) {
          console.error("[SIP] Microphone capture failed:", micErr);
        }
      };
      
      audioWs.onerror = (e) => console.error("[SIP] Audio WS error:", e);
    } catch (e) {
      console.error("[SIP] connectRtpAudio error:", e);
    }
  }
  
  function rtpPayloadOffset(pkt: Uint8Array): number | null {
    if (pkt.length < 12) return null;
    const v = pkt[0] >> 6;
    if (v !== 2) return null;
    const cc = pkt[0] & 0x0f;
    const x = (pkt[0] & 0x10) !== 0;
    let off = 12 + cc * 4;
    if (pkt.length < off) return null;
    if (x) {
      if (pkt.length < off + 4) return null;
      const extLenWords = (pkt[off + 2] << 8) | pkt[off + 3];
      off += 4 + extLenWords * 4;
      if (pkt.length < off) return null;
    }
    return off;
  }

  function alawToFloat(data: Uint8Array): Float32Array {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      let val = data[i] ^ 0x55;
      const sign = val & 0x80;
      const seg = (val >> 4) & 0x07;
      let quant = val & 0x0F;

      let linear: number;
      if (seg === 0) {
        linear = (quant << 1) | 1;
      } else {
        linear = ((quant << 1) | 1 | 0x20) << (seg - 1);
      }
      linear <<= 3;

      out[i] = (sign ? -linear : linear) / 32768.0;
    }
    return out;
  }
  
  function ulawToFloat(data: Uint8Array): Float32Array {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      let val = ~data[i] & 0xFF;
      const sign = val & 0x80;
      const exp = (val >> 4) & 0x07;
      let mant = val & 0x0F;
      let sample = ((mant << 3) + 0x84) << exp;
      sample -= 0x84;
      out[i] = (sign ? -sample : sample) / 32768.0;
    }
    return out;
  }

  const answerCall = useCallback(async () => {
    try { await playCtxRef.current?.resume(); } catch {}
    console.log("[SIP] answerCall: playCtx state after resume:", playCtxRef.current?.state);
    if (!incomingSdpRef.current || !callIdRef.current) return;
    
    const remoteSdp = incomingSdpRef.current;
    console.log("[SIP] Remote SDP from FS:", remoteSdp.substring(0, 500));
    
    const isWebRTC = remoteSdp.includes("a=fingerprint:") && remoteSdp.includes("RTP/SAVPF");
    
    if (isWebRTC) {
      const pc = await createPC();
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: remoteSdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await new Promise(resolve => {
        if (pc.iceGatheringState === "complete") resolve(undefined);
        else pc.onicegatheringcomplete = () => resolve(undefined);
        setTimeout(resolve, 2000);
      });
      const sdp = pc.localDescription?.sdp || answer.sdp || "";
      const ok = [
        "SIP/2.0 200 OK", incomingViaRef.current,
        "From: " + incomingFromRef.current, "To: " + incomingToRef.current,
        "Call-ID: " + incomingCallIdRef.current, "CSeq: " + incomingCseqRef.current,
        "Contact: <" + contactRef.current + ">",
        "Content-Type: application/sdp",
        "Content-Length: " + new TextEncoder().encode(sdp).length, "", sdp
      ].join("\r\n");
      sendSip(ok);
    } else {
      console.log("[SIP] Non-WebRTC SDP, creating RTP-compatible answer");
      const cLine = remoteSdp.match(/c=IN IP4 (\S+)/)?.[1] || "0.0.0.0";
      const mLine = remoteSdp.match(/m=audio (\d+) /)?.[0] || "m=audio 0 ";
      const port = remoteSdp.match(/m=audio (\d+)/)?.[1] || "0";
      
      const codecs: number[] = [];
      const rtpmap: string[] = [];
      const fmtp: string[] = [];
      
      const codecsMatch = remoteSdp.match(/m=audio \d+ \S+ (.+)/);
      if (codecsMatch) {
        codecsMatch[1].trim().split(/\s+/).forEach(c => codecs.push(parseInt(c)));
      }
      
      remoteSdp.split("\r\n").forEach(line => {
        if (line.startsWith("a=rtpmap:")) rtpmap.push(line);
        if (line.startsWith("a=fmtp:")) fmtp.push(line);
      });
      
      const answerSdp = [
        "v=0",
        "o=BuxTaxi 1 1 IN IP4 192.168.1.107",
        "s=BuxTaxi",
        "c=IN IP4 192.168.1.107",
        "t=0 0",
        "m=audio 20000 RTP/AVP " + codecs.join(" "),
        ...rtpmap,
        ...fmtp,
        "a=sendrecv",
        "a=ptime:20",
        ""
      ].join("\r\n");
      
      console.log("[SIP] Answer SDP:", answerSdp.substring(0, 500));
      
      const ok = [
        "SIP/2.0 200 OK", incomingViaRef.current,
        "From: " + incomingFromRef.current, "To: " + incomingToRef.current,
        "Call-ID: " + incomingCallIdRef.current, "CSeq: " + incomingCseqRef.current,
        "Contact: <" + contactRef.current + ">",
        "Content-Type: application/sdp",
        "Content-Length: " + new TextEncoder().encode(answerSdp).length, "", answerSdp
      ].join("\r\n");
      sendSip(ok);
      
      connectRtpAudio();
    }
    
    setCallInfo(prev => prev ? { ...prev, state: "active" } : null);
  }, [createPC, sendSip]);

  const rejectCall = useCallback(() => {
    if (!callIdRef.current) return;
    const reject = [
      "SIP/2.0 486 Busy Here",
      incomingViaRef.current,
      "From: " + incomingFromRef.current,
      "To: " + incomingToRef.current,
      "Call-ID: " + incomingCallIdRef.current,
      "CSeq: " + incomingCseqRef.current,
      "Content-Length: 0", "", ""
    ].join("\r\n");
    sendSip(reject);
    cleanupCall();
  }, [sendSip, cleanupCall]);

  const hangup = useCallback(() => {
    if (!callIdRef.current) return;
    const cfg = configRef.current;
    const domain = cfg?.domain || cfg?.server || "";

    const bye = [
      "BYE sip:" + domain + " SIP/2.0",
      "Via: SIP/2.0/TCP buxtaxi.local;branch=" + genBranch(),
      "From: " + (callFromRef.current || incomingToRef.current),
      "To: " + (callToRef.current || incomingFromRef.current),
      "Call-ID: " + callIdRef.current,
      "CSeq: " + (++callCseqRef.current) + " BYE",
      "Max-Forwards: 70",
      "Content-Length: 0", "", ""
    ].join("\r\n");
    sendSip(bye);
    cleanupCall();
  }, [sendSip, cleanupCall]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCallInfo(prev => prev ? { ...prev, isMuted: !track.enabled } : null);
    }
  }, []);

  const toggleHold = useCallback(() => {
    console.log("[SIP] Hold not implemented in SIP mode");
  }, []);

  const sendDtmf = useCallback((digit: string) => {
    if (!callIdRef.current) return;
    const cfg = configRef.current;
    const domain = cfg?.domain || cfg?.server || "";
    const body = "Signal=" + digit + "\r\nDuration=160";
    const info = [
      "INFO sip:" + domain + " SIP/2.0",
      "Via: SIP/2.0/TCP buxtaxi.local;branch=" + genBranch(),
      "From: " + (callFromRef.current || incomingToRef.current),
      "To: " + (callToRef.current || incomingFromRef.current),
      "Call-ID: " + callIdRef.current,
      "CSeq: " + (++callCseqRef.current) + " INFO",
      "Content-Type: application/dtmf-relay",
      "Content-Length: " + body.length,
      "",
      body
    ].join("\r\n");
    sendSip(info);
  }, [sendSip]);

  const transferCall = useCallback((target: string) => {
    if (!callIdRef.current) return;
    const cfg = configRef.current;
    const domain = cfg?.domain || cfg?.server || "";
    const refer = [
      "REFER sip:" + domain + " SIP/2.0",
      "Via: SIP/2.0/TCP buxtaxi.local;branch=" + genBranch(),
      "From: " + (callFromRef.current || incomingToRef.current),
      "To: " + (callToRef.current || incomingFromRef.current),
      "Call-ID: " + callIdRef.current,
      "CSeq: " + (++callCseqRef.current) + " REFER",
      "Refer-To: <sip:" + target + "@" + domain + ">",
      "Max-Forwards: 70",
      "Content-Length: 0", "", ""
    ].join("\r\n");
    sendSip(refer);
    cleanupCall();
  }, [sendSip, cleanupCall]);

  const setOnIncomingCall = useCallback((cb: ((phone: string) => void) | null) => {
    onIncomingRef.current = cb;
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      try { cleanupCall(); } catch {}
      if (reRegTimerRef.current) clearInterval(reRegTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
      if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); }
    };
  }, []);

  return {
    status, callInfo, config, waitingCalls,
    connect, disconnect, makeCall, answerCall, rejectCall, hangup,
    toggleMute, toggleHold, sendDtmf, transferCall, setOnIncomingCall,
  };
}
