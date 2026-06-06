import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./use-auth";
import { useNotificationSound } from "./use-notification-sound";

export interface DriverNotification {
  id: string;
  type: "urgent_order" | "marketplace_sold" | "payment_received" | "chat_message" | "order_assigned" | "order_taken" | "new_order";
  title: string;
  body: string;
  data?: Record<string, any>;
  timestamp: number;
}

export function useDriverNotifications(_wsRef: React.MutableRefObject<WebSocket | null>, isDriver: boolean) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [currentPopup, setCurrentPopup] = useState<DriverNotification | null>(null);
  const [marketplaceUpdates, setMarketplaceUpdates] = useState(0);
  const { play } = useNotificationSound();
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedRef = useRef<Set<string>>(new Set());

  const dismissPopup = useCallback(() => {
    setCurrentPopup(null);
    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
      popupTimerRef.current = null;
    }
  }, []);

  const showPopup = useCallback((notif: DriverNotification, duration = 8000) => {
    setCurrentPopup(notif);
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    popupTimerRef.current = setTimeout(() => {
      setCurrentPopup(null);
      popupTimerRef.current = null;
    }, duration);
  }, []);

  const addNotification = useCallback((notif: DriverNotification) => {
    if (processedRef.current.has(notif.id)) return;
    processedRef.current.add(notif.id);
    if (processedRef.current.size > 100) {
      const entries = Array.from(processedRef.current);
      entries.slice(0, 50).forEach(e => processedRef.current.delete(e));
    }
    setNotifications(prev => [notif, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    if (!isDriver) return;

    const handler = (e: Event) => {
      try {
        const data = (e as CustomEvent).detail;

        if (data.type === "dispatch_offers_sent" || data.type === "urgent_order") {
          const notif: DriverNotification = {
            id: `urgent_${Date.now()}`,
            type: "urgent_order",
            title: "Срочный заказ!",
            body: data.message || "Доступен срочный заказ",
            timestamp: Date.now(),
          };
          addNotification(notif);
          play("urgent");
          showPopup(notif, 10000);
        }

        if (data.type === "order_assigned") {
          const notif: DriverNotification = {
            id: `assigned_${data.rideId}_${Date.now()}`,
            type: "order_assigned",
            title: "📋 Заказ назначен",
            body: data.body || `Вам назначен заказ #${data.rideId}`,
            data,
            timestamp: Date.now(),
          };
          addNotification(notif);
          play("urgent");
          showPopup(notif, 10000);
        }

        if (data.type === "order_taken") {
          const notif: DriverNotification = {
            id: `taken_${data.rideId}_${Date.now()}`,
            type: "order_taken",
            title: "Заказ занят",
            body: data.message || `Заказ #${data.rideId} принят другим водителем`,
            data,
            timestamp: Date.now(),
          };
          addNotification(notif);
          play("message");
          showPopup(notif, 6000);
        }

        if (data.type === "marketplace_order_sold" || data.type === "marketplace_listing_sold") {
          const notif: DriverNotification = {
            id: `mp_sold_${data.listingId}_${Date.now()}`,
            type: "marketplace_sold",
            title: "Маркетплейс",
            body: data.type === "marketplace_order_sold" ? "Ваш заказ продан!" : "Объявление продано",
            data,
            timestamp: Date.now(),
          };
          addNotification(notif);
          setMarketplaceUpdates(p => p + 1);
          play("success");
          showPopup(notif, 8000);
        }

        if (data.type === "marketplace_order_accepted") {
          const notif: DriverNotification = {
            id: `mp_accepted_${data.listingId}_${Date.now()}`,
            type: "marketplace_sold",
            title: "Заказ принят",
            body: data.buyerName ? `Водитель ${data.buyerName} принял ваш заказ` : "Водитель принял ваш заказ",
            data,
            timestamp: Date.now(),
          };
          addNotification(notif);
          setMarketplaceUpdates(p => p + 1);
          play("success");
          showPopup(notif, 8000);
        }

        if (data.type === "marketplace_listing_completed" || data.type === "marketplace_order_completed") {
          const earnings = data.earnings ? ` — ${Number(data.earnings).toLocaleString("ru-RU")} сум` : "";
          const notif: DriverNotification = {
            id: `mp_complete_${data.listingId}_${Date.now()}`,
            type: "payment_received",
            title: "Заказ завершён",
            body: `Маркетплейс: заказ завершён${earnings}`,
            data,
            timestamp: Date.now(),
          };
          addNotification(notif);
          setMarketplaceUpdates(p => p + 1);
          play("success");
          showPopup(notif, 8000);
        }

        if (data.type === "ride_completed" || (data.type === "ride_updated" && data.ride?.status === "completed")) {
          const ride = data.ride;
          if (ride && user?.id && ride.driverId === user.id) {
            const notif: DriverNotification = {
              id: `payment_${ride.id}_${Date.now()}`,
              type: "payment_received",
              title: "💰 Деньги получены",
              body: `Поездка #${ride.id} завершена — ${ride.price?.toLocaleString("ru-RU")} сум`,
              data: { ride },
              timestamp: Date.now(),
            };
            addNotification(notif);
            play("success");
            showPopup(notif, 8000);
          }
        }

        if (data.type === "new_chat_message" && data.message) {
          const notif: DriverNotification = {
            id: `chat_${data.message.id}_${Date.now()}`,
            type: "chat_message",
            title: data.message.senderName || "Новое сообщение",
            body: data.message.content || "Вложение",
            data: { message: data.message },
            timestamp: Date.now(),
          };
          addNotification(notif);
          play("message");
          showPopup(notif, 6000);
        }
      } catch {}
    };

    window.addEventListener("buxtaxi:ws", handler);
    return () => {
      window.removeEventListener("buxtaxi:ws", handler);
    };
  }, [isDriver, addNotification, play, showPopup]);

  useEffect(() => {
    return () => {
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    };
  }, []);

  const clearMarketplaceBadge = useCallback(() => {
    setMarketplaceUpdates(0);
  }, []);

  return {
    notifications,
    currentPopup,
    dismissPopup,
    marketplaceUpdates,
    clearMarketplaceBadge,
  };
}
