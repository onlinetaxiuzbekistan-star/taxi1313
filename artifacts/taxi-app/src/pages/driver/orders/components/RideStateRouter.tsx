import { useRef, useState } from "react";
import { Loader2, PhoneCall, XCircle } from "lucide-react";
import VoiceCallModal from "@/components/VoiceCallModal";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadChat } from "@/hooks/use-unread-chat";
import DriverLayout from "../../DriverLayout";
import type { DriverScreen, Ride, SeatPassenger, TripStop, CityInfo, PickupRouteData } from "../types";
import { PickupScreen } from "./PickupScreen";
import { ActiveRideScreen } from "./ActiveRideScreen";
import { CompletionScreen } from "./CompletionScreen";
import { RouteSelectScreen } from "./RouteSelectScreen";
import { SeatViewScreen } from "./SeatViewScreen";
import { IdleScreen } from "./IdleScreen";

interface RideStateRouterProps {
  screen: DriverScreen;
  loading: boolean;
  activeRide: Ride | null;
  activePassengers: SeatPassenger[];
  completedRide: Ride | null;
  cities: CityInfo[];
  availableRoutes: { fromCity: string; toCity: string }[];
  tripStops: TripStop[];
  pickupRoute: PickupRouteData | null;
  marketListings: any[];
  buyingId: number | null;
  actionLoading: boolean;
  passengerActionLoading: number | null;
  clientActionLoading: boolean;
  commissionRate: number;
  isOnline: boolean;
  driverGPS: any;
  token: string | null;
  onCreateRide: (from: string, to: string, time: string) => void;
  onStartRide: () => void;
  onComplete: () => void;
  onCancelViaDispatcher: () => void;
  onPassengerPickup: (id: number) => void;
  onPassengerDropoff: (id: number) => void;
  onBatchPickup: (ids: number[]) => void;
  onBatchDropoff: (ids: number[]) => void;
  onBuyListing: (id: number) => void;
  onManualClient: (seat: number, gender: string, phone: string) => void;
  onRejectClient: (id: number) => void;
  onGoOnline: () => void;
  onCompletionClose: () => void;
  onRefresh: () => void;
}

export function RideStateRouter(props: RideStateRouterProps) {
  const { user } = useAuth();
  const { dispatcherId, dispatcherName } = useUnreadChat();
  const [showDispatcherDialog, setShowDispatcherDialog] = useState<"reject" | "cancel" | null>(null);
  const [showDriverCallModal, setShowDriverCallModal] = useState(false);
  const dummyWsRef = useRef<WebSocket | null>(null);

  const handleCancelViaDispatcher = () => setShowDispatcherDialog("cancel");
  const handleRejectClient = (id: number) => {
    const pax = (props.activePassengers || []).find((p: any) => p.id === id);
    const PERSONAL = new Set(["manual", "driver"]);
    const allPax = props.activePassengers || [];
    const hasExternal = allPax.some((p: any) => !PERSONAL.has(p.source as string));
    if (pax && PERSONAL.has(pax.source as string) && !hasExternal) {
      props.onRejectClient(id);
      return;
    }
    setShowDispatcherDialog("reject");
  };

  if (props.screen === ("loading" as any) || props.loading) {
    return (
      <DriverLayout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </DriverLayout>
    );
  }

  if (props.screen === "pickup" && props.activeRide) {
    return <DriverLayout><PickupScreen ride={{ ...props.activeRide, seatPassengers: props.activePassengers }} onArrived={props.onStartRide} onCancel={handleCancelViaDispatcher} onCancelDirect={props.onCancelViaDispatcher} loading={props.actionLoading} driverGPS={props.driverGPS} /></DriverLayout>;
  }

  if (props.screen === "active" && props.activeRide) {
    return <DriverLayout><ActiveRideScreen
      ride={{ ...props.activeRide, seatPassengers: props.activePassengers }}
      onComplete={props.onComplete} onCancel={handleCancelViaDispatcher} onCancelDirect={props.onCancelViaDispatcher}
      loading={props.actionLoading} driverGPS={props.driverGPS}
      tripStops={props.tripStops}
      onPassengerPickup={props.onPassengerPickup}
      onPassengerDropoff={props.onPassengerDropoff}
      passengerActionLoading={props.passengerActionLoading}
      onBatchPickup={props.onBatchPickup}
      onBatchDropoff={props.onBatchDropoff}
      cities={props.cities}
    /></DriverLayout>;
  }

  if (props.screen === "completed" && props.completedRide) {
    return <DriverLayout><CompletionScreen ride={props.completedRide} onClose={props.onCompletionClose} commissionRate={props.commissionRate} /></DriverLayout>;
  }

  return (
    <DriverLayout>
      {props.screen === "route_select" && !props.activeRide ? (
        <RouteSelectScreen cities={props.cities} routes={props.availableRoutes} onCreateRide={props.onCreateRide} creating={props.actionLoading} marketListings={props.marketListings} onBuyListing={props.onBuyListing} buyingId={props.buyingId} />
      ) : props.screen === "seat_view" && props.activeRide ? (
        <SeatViewScreen
          ride={props.activeRide}
          passengers={props.activePassengers}
          cities={props.cities}
          onEndRide={props.activeRide.status === "in_progress" ? props.onComplete : handleCancelViaDispatcher}
          onStartRide={props.onStartRide}
          loading={props.actionLoading}
          onRefresh={props.onRefresh}
          pickupRoute={props.pickupRoute}
          token={props.token}
          driverPos={props.driverGPS.posRef.current}
          onOpenChat={undefined}
          dispatcherId={0}
          dispatcherName=""
          onRejectClient={handleRejectClient}
          onManualClient={props.onManualClient}
          clientActionLoading={props.clientActionLoading}
          onCancelDirect={props.onCancelViaDispatcher}
        />
      ) : props.screen === "idle" && props.isOnline && !props.activeRide ? (
        <RouteSelectScreen cities={props.cities} routes={props.availableRoutes} onCreateRide={props.onCreateRide} creating={props.actionLoading} marketListings={props.marketListings} onBuyListing={props.onBuyListing} buyingId={props.buyingId} />
      ) : (
        <IdleScreen isOnline={props.isOnline} onGoOnline={props.onGoOnline} />
      )}

      {showDispatcherDialog && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 mx-auto mb-4 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-lg font-bold mb-2">
                {showDispatcherDialog === "reject" ? "Отклонить пассажира" : "Отменить рейс"}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-1">
                {showDispatcherDialog === "reject" ? "Самостоятельно отклонить пассажира невозможно." : "Самостоятельно отменить рейс невозможно."}
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">Свяжитесь с диспетчером через звонок.</p>
            </div>
            <div className="px-6 pb-6 space-y-2">
              <button onClick={() => { setShowDispatcherDialog(null); setShowDriverCallModal(true); }}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 text-white rounded-xl font-bold text-sm active:scale-[0.97] transition-transform">
                <PhoneCall className="w-5 h-5" /> Позвонить диспетчеру
              </button>
              <button onClick={() => setShowDispatcherDialog(null)}
                className="w-full py-3 bg-muted text-foreground rounded-xl font-medium text-sm active:scale-[0.97] transition-transform">
                Назад
              </button>
            </div>
          </div>
        </div>
      )}

      {showDriverCallModal && user && dispatcherId > 0 && (
        <VoiceCallModal open={showDriverCallModal} incoming={false} peerName={dispatcherName || "Диспетчер"} peerId={dispatcherId}
          myUserId={user.id} myName={user.name} chatId={0} chatType="dm" wsRef={dummyWsRef}
          onClose={() => { setShowDriverCallModal(false); props.onRefresh(); }} />
      )}
    </DriverLayout>
  );
}
