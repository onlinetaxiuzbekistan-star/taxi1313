import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { WS_URL } from "@/config";
import { wsEvents, type WsMessage } from "@/lib/ws-events";

// React Native port of the web driver WebSocket (taxi-app/src/hooks/use-driver-ws.ts).
// Same protocol: auth handshake, ping/pong heartbeat, exponential-backoff
// reconnect, automatic offer_ack on new_order, and driver session binding.
//
// RN adaptations: WebSocket URL comes from config (no window.location); inbound
// messages are published on the wsEvents bus (no window CustomEvents);
// foreground reconnect uses AppState (no document.visibilitychange). The HTTP
// long-poll fallback and NetInfo-driven reconnect from the web version are left
// for a later phase (kept intentionally minimal for Phase 0).

const HEARTBEAT_INTERVAL = 20_000;
const PONG_TIMEOUT = 10_000;
const MAX_BACKOFF = 30_000;

// Module-level handle to the live socket so non-React callers (e.g. the native
// background GPS bridge) can push messages over the same authenticated socket.
let _activeSocket: WebSocket | null = null;
let _activeSessionId: string | null = null;

/**
 * Send a message over the active driver socket. Attaches the bound sessionId to
 * driver_location / offer_ack (the backend rejects location updates whose
 * sessionId doesn't match the current driver session). Returns false if no open
 * socket — caller may drop or retry.
 */
export function sendWsMessage(msg: WsMessage): boolean {
  const s = _activeSocket;
  if (!s || s.readyState !== WebSocket.OPEN) return false;
  let out = msg;
  if (
    (msg.type === "driver_location" || msg.type === "offer_ack") &&
    !(msg as any).sessionId &&
    _activeSessionId
  ) {
    out = { ...msg, sessionId: _activeSessionId };
  }
  try {
    s.send(JSON.stringify(out));
    return true;
  } catch {
    return false;
  }
}

export function useRideWebSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(token);
  const sessionIdRef = useRef<string | null>(null);
  const retryCount = useRef(0);
  const closedIntentionally = useRef(false);
  const pendingQueue = useRef<WsMessage[]>([]);
  tokenRef.current = token;

  useEffect(() => {
    if (!token) return;
    closedIntentionally.current = false;

    function stopHeartbeat() {
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
      if (pongTimer.current) {
        clearTimeout(pongTimer.current);
        pongTimer.current = null;
      }
    }

    function startHeartbeat(socket: WebSocket) {
      stopHeartbeat();
      heartbeatTimer.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
          pongTimer.current = setTimeout(() => {
            console.warn("[DRIVER WS] no pong, reconnecting");
            socket.close(4002, "Pong timeout");
          }, PONG_TIMEOUT);
        }
      }, HEARTBEAT_INTERVAL);
    }

    function withSessionId(msg: WsMessage): WsMessage {
      if (!msg || typeof msg !== "object") return msg;
      if (
        (msg.type === "driver_location" || msg.type === "offer_ack") &&
        !(msg as any).sessionId &&
        sessionIdRef.current
      ) {
        return { ...msg, sessionId: sessionIdRef.current };
      }
      return msg;
    }

    function flushQueue(socket: WebSocket) {
      while (pendingQueue.current.length > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(withSessionId(pendingQueue.current.shift()!)));
      }
    }

    function connect() {
      if (closedIntentionally.current) return;
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

      console.log("[DRIVER WS] connecting to", WS_URL, "retry=", retryCount.current);
      const socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        if (wsRef.current !== socket) return;
        retryCount.current = 0;
        _activeSocket = socket;
        socket.send(JSON.stringify({ type: "auth", token: tokenRef.current }));
        startHeartbeat(socket);
      };

      socket.onmessage = (event) => {
        if (wsRef.current !== socket) return;
        try {
          const data: WsMessage = JSON.parse(event.data as string);

          if (data.type === "pong") {
            if (pongTimer.current) {
              clearTimeout(pongTimer.current);
              pongTimer.current = null;
            }
            return;
          }

          if (data.type === "auth_ok") {
            if ((data as any).sessionId) sessionIdRef.current = (data as any).sessionId;
            _activeSessionId = sessionIdRef.current;
            console.log("[DRIVER WS] connected, session:", sessionIdRef.current);
            flushQueue(socket);
          }

          if (data.type === "force_logout") {
            closedIntentionally.current = true;
            socket.close(4003, "Force logout");
            wsEvents.emit(data);
            return;
          }

          // Auto-ack new offers so the backend knows the driver received them.
          if (data.type === "new_order" && (data as any).offerId && socket.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                type: "offer_ack",
                offerId: (data as any).offerId,
                sessionId: sessionIdRef.current,
              }),
            );
          }

          wsEvents.emit(data);
        } catch {}
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = (ev) => {
        if (_activeSocket === socket) {
          _activeSocket = null;
          _activeSessionId = null;
        }
        if (wsRef.current !== socket) return;
        wsRef.current = null;
        sessionIdRef.current = null;
        stopHeartbeat();
        if (!closedIntentionally.current && tokenRef.current) {
          retryCount.current++;
          const expDelay = Math.min(MAX_BACKOFF, 1000 * Math.pow(2, retryCount.current - 1));
          const jitter = Math.random() * 1000;
          const delay = Math.round(expDelay + jitter);
          console.log("[DRIVER WS] reconnect in", delay, "ms");
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };
    }

    connect();

    // Reconnect immediately when the app returns to the foreground.
    const onAppState = (state: AppStateStatus) => {
      if (state === "active" && tokenRef.current && !closedIntentionally.current) {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          retryCount.current = 0;
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
          }
          connect();
        }
      }
    };
    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      sub.remove();
      closedIntentionally.current = true;
      stopHeartbeat();
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      sessionIdRef.current = null;
    };
  }, [token]);

  return wsRef;
}
