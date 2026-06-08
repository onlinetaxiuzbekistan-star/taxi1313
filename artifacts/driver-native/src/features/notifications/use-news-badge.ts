import { useState, useEffect, useCallback } from "react";

import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/config";
import { wsEvents } from "@/lib/ws-events";

// Unread driver-news count for the header bell badge (GET /api/news/unread).
export function useNewsBadge(): number {
  const { token } = useAuth();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/news/unread`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        const items = d.items || d.unread || [];
        setCount(Array.isArray(items) ? items.length : Number(d.count || 0));
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    const off = wsEvents.on((d: any) => {
      if (d.type === "news" || d.type === "news_published") load();
    });
    return () => {
      clearInterval(iv);
      off();
    };
  }, [load]);

  return count;
}
