
import { createContext, useContext, useRef, useEffect, MutableRefObject } from "react";

interface DriverWsContextType {
  wsRef: MutableRefObject<WebSocket | null>;
}

export const DriverWsContext = createContext<DriverWsContextType>({
  wsRef: { current: null },
});

export function useDriverWs() {
  return useContext(DriverWsContext);
}

function getHeartbeatInterval(): number {
  try {
    const conn = (navigator as any).connection;
    if (conn) {
      if (conn.saveData) return 40000;
      if (conn.effectiveType === "2g" || conn.effectiveType === "slow-2g") return 15000;
      if (conn.effectiveType === "3g") return 15000;
    }
  } catch {}
  return 20000;
}

export function useDriverWsConnection(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef(token);
  const sessionIdRef = useRef<string | null>(null);
  const retryCount = useRef(0);
  const closedIntentionally = useRef(false);
  const pendingQueue = useRef<any[]>([]);
  const lastFallbackTs = useRef(0);
  const seenFallbackEvents = useRef(new Set<string>());
  const connectFnRef = useRef<(() => void) | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    if (!token) return;

    closedIntentionally.current = false;
    const base = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") || "";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}${base}/api/ws`;

    function startHeartbeat(socket: WebSocket) {
      stopHeartbeat();
      const interval = getHeartbeatInterval();
      heartbeatTimer.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
          pongTimer.current = setTimeout(() => {
            console.warn("[DRIVER WS] no pong in 10s, reconnecting");
            socket.close(4002, "Pong timeout");
          }, 10000);
        }
      }, interval);
    }

    function stopHeartbeat() {
      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
      if (pongTimer.current) { clearTimeout(pongTimer.current); pongTimer.current = null; }
    }

    function startFallback() {
      stopFallback();
      console.log("[DRIVER WS] starting HTTP fallback polling");
      fallbackTimer.current = setInterval(async () => {
        try {
          const res = await fetch(`${base}/api/drivers/ws-fallback?since=${lastFallbackTs.current}`, {
            headers: { Authorization: `Bearer ${tokenRef.current}` },
          });
          if (res.ok) {
            const data = await res.json();
            lastFallbackTs.current = Date.now();
            if (data.events && Array.isArray(data.events)) {
              for (const evt of data.events) {
                const evtKey = `${evt.type}:${evt.offerId || evt.rideId || ""}`;
                if (seenFallbackEvents.current.has(evtKey)) continue;
                seenFallbackEvents.current.add(evtKey);
                if (seenFallbackEvents.current.size > 100) {
                  const arr = Array.from(seenFallbackEvents.current);
                  seenFallbackEvents.current = new Set(arr.slice(-50));
                }
                window.dispatchEvent(new CustomEvent("buxtaxi:ws", { detail: evt }));
              }
            }
          }
        } catch {}
      }, 5000);
    }

    function stopFallback() {
      if (fallbackTimer.current) { clearInterval(fallbackTimer.current); fallbackTimer.current = null; }
    }

    function withSessionId(msg: any) {
      if (!msg || typeof msg !== "object") return msg;
      // Backend (Phase A) enforces driver session binding for location/acks.
      if (msg.type === "driver_location" && !msg.sessionId && sessionIdRef.current) {
        return { ...msg, sessionId: sessionIdRef.current };
      }
      if (msg.type === "offer_ack" && !msg.sessionId && sessionIdRef.current) {
        return { ...msg, sessionId: sessionIdRef.current };
      }
      return msg;
    }

    function flushQueue(socket: WebSocket) {
      while (pendingQueue.current.length > 0 && socket.readyState === WebSocket.OPEN) {
        const msg = withSessionId(pendingQueue.current.shift());
        socket.send(JSON.stringify(msg));
        console.log("[DRIVER WS] flushed queued message:", msg.type);
      }
    }

    function safeSend(msg: any) {
      const ws = wsRef.current;
      const withSid = withSessionId(msg);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(withSid));
      } else {
        pendingQueue.current.push(withSid);
        console.log("[DRIVER WS] queued offline message:", withSid?.type);
      }
    }

    function connect() {
      if (closedIntentionally.current) return;
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

      console.log("[DRIVER WS] connecting to", wsUrl, "retry=", retryCount.current);
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (wsRef.current !== socket) return;
        retryCount.current = 0;
        console.log("[DRIVER WS] connected, sending auth");
        socket.send(JSON.stringify({ type: "auth", token: tokenRef.current }));
        stopFallback();
        seenFallbackEvents.current.clear();
        startHeartbeat(socket);
      };

      socket.onmessage = (event) => {
        if (wsRef.current !== socket) return;
        try {
          const data = JSON.parse(event.data);

          if (data.type === "pong") {
            if (pongTimer.current) { clearTimeout(pongTimer.current); pongTimer.current = null; }
            return;
          }

          if (data.type === "auth_ok") {
            if (data.sessionId) sessionIdRef.current = data.sessionId;
            console.log("[DRIVER WS] WS CONNECTED:", data.userId, "session:", data.sessionId);
            flushQueue(socket);
          }

          if (data.type === "force_logout") {
            console.log("[DRIVER WS] Force logout received:", data.reason);
            closedIntentionally.current = true;
            socket.close(4003, "Force logout");
            window.dispatchEvent(new CustomEvent("buxtaxi:ws", { detail: data }));
            return;
          }

          if (data.type === "new_order" && data.offerId && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "offer_ack", offerId: data.offerId, sessionId: sessionIdRef.current }));
            console.log("[WS ACK] sent offer_ack for offerId=", data.offerId);
          }

          window.dispatchEvent(new CustomEvent("buxtaxi:ws", { detail: data }));
        } catch {}
      };

      socket.onerror = (err) => {
        console.error("[DRIVER WS] error, closing socket");
        socket.close();
      };

      socket.onclose = (ev) => {
        console.log("[DRIVER WS] closed code=", ev.code, "reason=", ev.reason);
        if (wsRef.current !== socket) return;
        wsRef.current = null;
        sessionIdRef.current = null;
        stopHeartbeat();

        if (!closedIntentionally.current && tokenRef.current) {
          retryCount.current++;
          const expDelay = Math.min(30000, 1000 * Math.pow(2, retryCount.current - 1));
          const jitter = Math.random() * 1000;
          const delay = Math.round(expDelay + jitter);
          console.log("[DRIVER WS] reconnect in", delay, "ms (attempt", retryCount.current, ")");
          reconnectTimer.current = setTimeout(connect, delay);

          if (retryCount.current >= 3) {
            startFallback();
          }
        }
      };
    }

    connectFnRef.current = connect;
    connect();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && tokenRef.current && !closedIntentionally.current) {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          console.log("[DRIVER WS] app foregrounded, reconnecting immediately");
          retryCount.current = 0;
          if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
          connect();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handleOnline = () => {
      if (!tokenRef.current || closedIntentionally.current) return;
      console.log("[DRIVER WS] network online, force reconnecting");
      retryCount.current = 0;
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "network change");
      } else {
        connect();
      }
    };

    const handleOffline = () => {
      console.log("[DRIVER WS] network offline");
      startFallback();
    };

    const handleNetworkTypeChange = () => {
      if (!tokenRef.current || closedIntentionally.current) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("[DRIVER WS] network type changed, reconnecting");
        ws.close(1000, "network type change");
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const navConn = (navigator as any).connection;
    if (navConn) {
      navConn.addEventListener("change", handleNetworkTypeChange);
    }

    const sendHandler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data) safeSend(data);
    };
    window.addEventListener("buxtaxi:send-ws", sendHandler);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("buxtaxi:send-ws", sendHandler);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (navConn) {
        navConn.removeEventListener("change", handleNetworkTypeChange);
      }
      closedIntentionally.current = true;
      stopHeartbeat();
      stopFallback();
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
      sessionIdRef.current = null;
      connectFnRef.current = null;
    };
  }, [token]);

  return wsRef;
}
