import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { toast } from "@/hooks/use-toast";

export function useWebSocket() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(token);
  const closedIntentionally = useRef(false);
  const retryCount = useRef(0);
  const driverLocInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    if (!token) return;
    if (user?.role === "driver") return;

    closedIntentionally.current = false;
    retryCount.current = 0;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    const wsUrl = `${protocol}//${window.location.host}${base}/api/ws`;

    function startHeartbeat(socket: WebSocket) {
      stopHeartbeat();
      heartbeatTimer.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
          pongTimer.current = setTimeout(() => {
            console.warn("[DISPATCHER WS] no pong in 10s, reconnecting");
            socket.close(4002, "Pong timeout");
          }, 10000);
        }
      }, 20000);
    }

    function stopHeartbeat() {
      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
      if (pongTimer.current) { clearTimeout(pongTimer.current); pongTimer.current = null; }
    }

    function connect() {
      if (closedIntentionally.current) return;
      if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

      console.log("[DISPATCHER WS] connecting to", wsUrl, "retry=", retryCount.current);
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (wsRef.current !== socket) return;
        retryCount.current = 0;
        console.log("[DISPATCHER WS] connected, sending auth");
        socket.send(JSON.stringify({ type: "auth", token: tokenRef.current }));
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
            console.log("[DISPATCHER WS] WS CONNECTED:", data.userId, "role=", data.role);
          }
          if (data.type === "ride_updated" || data.type === "new_ride") {
            queryClient.invalidateQueries({ queryKey: ["/api/rides"] });
            queryClient.invalidateQueries({ queryKey: ["/api/drivers/available-rides"] });
            queryClient.invalidateQueries({ queryKey: ["/api/drivers/my-rides"] });
            queryClient.invalidateQueries({ queryKey: ["/api/dispatcher/stats"] });
          }
          if (data.type === "new_chat_message" && data.message) {
            const m = data.message;
            queryClient.invalidateQueries({ queryKey: ["/api/rides", m.rideId, "messages"] });
            queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
            queryClient.invalidateQueries({ queryKey: ["/api/chat/unread-total"] });
            const isOwn = user?.id != null && m.senderId === user.id;
            if (!isOwn) {
              const text = (m.message || m.content || "Вложение").toString();
              const preview = text.length > 80 ? text.slice(0, 77) + "..." : text;
              const rideTag = m.rideId && m.rideId > 0 ? " #" + m.rideId : "";
              toast({
                title: (m.senderName || "Новое сообщение") + rideTag,
                description: preview,
              });
              try {
                const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
                if (AudioCtx) {
                  const ctx = new AudioCtx();
                  const o = ctx.createOscillator();
                  const g = ctx.createGain();
                  o.connect(g); g.connect(ctx.destination);
                  o.frequency.value = 880;
                  g.gain.setValueAtTime(0.001, ctx.currentTime);
                  g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
                  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
                  o.start();
                  o.stop(ctx.currentTime + 0.26);
                  setTimeout(() => ctx.close(), 400);
                }
              } catch {}
            }
          }
          if (data.type === "driver_location") {
            // driver_location can be very frequent; debounce to avoid spamming API.
            if (driverLocInvalidateTimer.current) {
              // skip; pending invalidation already scheduled
            } else {
              driverLocInvalidateTimer.current = setTimeout(() => {
                driverLocInvalidateTimer.current = null;
                queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
              }, 2000);
            }
          }
          window.dispatchEvent(new CustomEvent("buxtaxi:ws", { detail: data }));
        } catch (err) {
          console.error("[DISPATCHER WS] parse error", err);
        }
      };

      socket.onerror = () => {
        console.error("[DISPATCHER WS] error, closing socket");
        socket.close();
      };

      socket.onclose = (ev) => {
        console.log("[DISPATCHER WS] closed code=", ev.code, "reason=", ev.reason);
        if (wsRef.current !== socket) return;
        wsRef.current = null;
        stopHeartbeat();
        if (!closedIntentionally.current && tokenRef.current) {
          retryCount.current++;
          const expDelay = Math.min(30000, 1000 * Math.pow(2, retryCount.current - 1));
          const jitter = Math.random() * 1000;
          const delay = Math.round(expDelay + jitter);
          console.log("[DISPATCHER WS] reconnect in", delay, "ms (attempt", retryCount.current, ")");
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };
    }

    connect();

    const sendHandler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && data) {
        wsRef.current.send(JSON.stringify(data));
      }
    };
    window.addEventListener("buxtaxi:send-ws", sendHandler);

    return () => {
      window.removeEventListener("buxtaxi:send-ws", sendHandler);
      closedIntentionally.current = true;
      stopHeartbeat();
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (driverLocInvalidateTimer.current) {
        clearTimeout(driverLocInvalidateTimer.current);
        driverLocInvalidateTimer.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };
  }, [token, user?.role, queryClient]);

  return {};
}
