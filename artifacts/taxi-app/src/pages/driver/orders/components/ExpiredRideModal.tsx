import { Clock, Navigation as NavigationIcon, XCircle, Loader2 } from "lucide-react";

interface ExpiredRideModalProps {
  extending: boolean;
  filledSeats: number;
  onExtend: () => void;
  onStartRide: () => void;
  onEndRide: () => void;
  onClose: () => void;
}

export function ExpiredRideModal({ extending, filledSeats, onExtend, onStartRide, onEndRide, onClose }: ExpiredRideModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div className="bg-card rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="bg-zinc-900 p-5 text-center text-white">
          <Clock className="w-10 h-10 mx-auto mb-2 opacity-90" />
          <h3 className="text-lg font-extrabold">Рейс просрочен</h3>
          <p className="text-sm opacity-80 mt-1">Время рейса истекло, а места не заполнены</p>
        </div>
        <div className="p-4 space-y-2.5">
          <button onClick={onExtend} disabled={extending}
            className="w-full py-3.5 rounded-xl bg-primary text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-50">
            {extending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
            Продлить на 30 мин
          </button>
          <button onClick={() => { onClose(); onStartRide(); }} disabled={filledSeats === 0}
            className="w-full py-3.5 rounded-xl bg-zinc-900 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:opacity-50">
            <NavigationIcon className="w-4 h-4" />
            Начать поездку
          </button>
          <button onClick={() => { onClose(); onEndRide(); }}
            className="w-full py-3.5 rounded-xl bg-red-500/10 text-red-600 font-bold text-sm border border-red-500/20 flex items-center justify-center gap-2 active:scale-[0.97] transition-transform">
            <XCircle className="w-4 h-4" />
            Отменить рейс
          </button>
        </div>
      </div>
    </div>
  );
}
