import { DriverNotification } from "@/hooks/use-driver-notifications";
import { Bell, ShoppingBag, MessageCircle, DollarSign, Zap, X, ClipboardCheck, AlertTriangle } from "lucide-react";

const TYPE_CONFIG: Record<string, { icon: typeof Bell; bg: string; text: string; border: string }> = {
  new_order: { icon: Bell, bg: "bg-emerald-500", text: "text-white", border: "border-emerald-600" },
  urgent_order: { icon: Zap, bg: "bg-red-500", text: "text-white", border: "border-red-600" },
  order_assigned: { icon: ClipboardCheck, bg: "bg-zinc-900", text: "text-white", border: "border-zinc-800" },
  order_taken: { icon: AlertTriangle, bg: "bg-zinc-900", text: "text-white", border: "border-zinc-800" },
  marketplace_sold: { icon: ShoppingBag, bg: "bg-zinc-900", text: "text-white", border: "border-zinc-800" },
  payment_received: { icon: DollarSign, bg: "bg-zinc-900", text: "text-white", border: "border-zinc-800" },
  chat_message: { icon: MessageCircle, bg: "bg-zinc-900", text: "text-white", border: "border-zinc-800" },
};

export default function DriverNotificationPopup({
  notification,
  onDismiss,
}: {
  notification: DriverNotification;
  onDismiss: () => void;
}) {
  const config = TYPE_CONFIG[notification.type] || TYPE_CONFIG.new_order;
  const Icon = config.icon;

  return (
    <div className="fixed top-16 left-3 right-3 z-[100] animate-in slide-in-from-top-5 fade-in duration-300">
      <div className={`${config.bg} ${config.border} border-2 rounded-2xl shadow-2xl shadow-black/30 px-4 py-4 flex items-start gap-3`}>
        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <Icon className={`w-6 h-6 ${config.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-base font-bold ${config.text}`}>{notification.title}</p>
          <p className={`text-sm ${config.text} opacity-90 mt-1 line-clamp-3`}>{notification.body}</p>
        </div>
        <button
          onClick={onDismiss}
          className="w-8 h-8 rounded-full bg-white/25 flex items-center justify-center shrink-0 active:scale-90 transition-transform"
        >
          <X className={`w-4 h-4 ${config.text}`} />
        </button>
      </div>
    </div>
  );
}
