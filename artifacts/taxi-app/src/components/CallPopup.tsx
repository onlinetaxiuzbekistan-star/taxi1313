/**
 * CallPopup — fires when WebSocket emits { type: "incoming_call", call, client }
 *
 * Appears as a slide-in overlay in the top-right corner.
 * Dispatcher can: dismiss, or click "Создать заказ" to prefill the order form.
 */
import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Phone, X, User, ChevronRight } from "lucide-react";

export interface CallEvent {
  callLogId: number;
  client: {
    id: number;
    name: string | null;
    phone: string;
    totalOrders: number;
  };
}

interface Props {
  event: CallEvent | null;
  onDismiss: () => void;
}

export function CallPopup({ event, onDismiss }: Props) {
  const [, setLocation] = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (event) {
      setVisible(true);
      // Auto-dismiss after 30 seconds
      const timer = setTimeout(() => { setVisible(false); setTimeout(onDismiss, 300); }, 30_000);
      return () => clearTimeout(timer);
    }
  }, [event]);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(onDismiss, 300);
  }, [onDismiss]);

  const createOrder = useCallback(() => {
    if (!event) return;
    sessionStorage.setItem("pendingCallClient", JSON.stringify(event.client));
    dismiss();
    window.dispatchEvent(new CustomEvent("buxtaxi:open-create-drawer", { detail: event.client }));
    setLocation("/management");
  }, [event, dismiss, setLocation]);

  if (!event) return null;

  return (
    <div
      className={`fixed top-4 right-4 z-50 w-80 transition-all duration-300 ${visible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}`}
    >
      {/* Animated ring */}
      <div className="absolute -inset-1 bg-emerald-500 rounded-2xl opacity-20 animate-ping pointer-events-none" />

      <div className="relative bg-card rounded-2xl shadow-2xl border border-emerald-500/20 overflow-hidden">
        {/* Green header */}
        <div className="bg-emerald-500 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-semibold">
            <div className="w-8 h-8 bg-foreground/20 rounded-full flex items-center justify-center animate-pulse">
              <Phone className="w-4 h-4" />
            </div>
            Входящий звонок
          </div>
          <button onClick={dismiss} className="text-white/80 hover:text-white active:scale-90 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          {/* Caller */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">
                {event.client.name || "Новый клиент"}
              </p>
              <p className="text-emerald-600 font-mono text-base font-bold">{event.client.phone}</p>
            </div>
          </div>

          {/* Client info */}
          <div className="bg-muted rounded-xl px-3 py-2.5 text-sm flex items-center justify-between">
            <span className="text-muted-foreground">Заказов раньше:</span>
            <span className="font-semibold text-foreground">{event.client.totalOrders}</span>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={dismiss}
              className="flex-1 py-2.5 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted active:bg-accent transition-colors"
            >
              Отклонить
            </button>
            <button
              onClick={createOrder}
              className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-1 active:scale-[0.97] transition-all"
            >
              Создать заказ
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
