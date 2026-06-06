import { useEffect } from "react";
import { MessageCircle } from "lucide-react";
import { useUnreadChat } from "@/hooks/use-unread-chat";

export function FloatingChatButton({ rideId }: { rideId: number }) {
  const { openChatWithPeer, setRideId, dispatcherId, dispatcherName, unreadCount } = useUnreadChat();
  useEffect(() => { setRideId(rideId); }, [rideId, setRideId]);
  return (
    <button
      onClick={() => openChatWithPeer({ id: dispatcherId, name: dispatcherName, role: "dispatcher" }, rideId)}
      className="fixed bottom-6 right-4 z-[55] w-14 h-14 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xl active:scale-90 transition-transform"
    >
      <MessageCircle className="w-6 h-6" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] rounded-full bg-red-500 text-white text-[12px] font-bold flex items-center justify-center px-1 ring-2 ring-blue-600">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
}

