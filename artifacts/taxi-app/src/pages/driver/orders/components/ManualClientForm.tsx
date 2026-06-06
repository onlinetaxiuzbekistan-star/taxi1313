import { useState } from "react";
import { User, X, Loader2 } from "lucide-react";

interface ManualClientFormProps {
  seatNumber: number;
  onClose: () => void;
  onSubmit: (seatNumber: number, gender: string, phone: string) => void;
  loading?: boolean;
}

export function ManualClientForm({ seatNumber, onClose, onSubmit, loading }: ManualClientFormProps) {
  const [phone, setPhone] = useState("");

  return (
    <div className="bg-card rounded-2xl border border-border shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
      <div className="bg-zinc-900 px-3 py-2.5 flex items-center justify-between">
        <p className="font-bold text-white text-sm">Добавить — место {seatNumber}</p>
        <button onClick={onClose} className="p-1 rounded-lg bg-foreground/15 active:scale-90">
          <X className="w-3.5 h-3.5 text-white" />
        </button>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={() => { onSubmit(seatNumber, "male", phone.trim()); onClose(); }}
            disabled={loading}
            className="flex-1 py-3 rounded-xl bg-muted text-foreground font-bold text-sm border border-border active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-5 h-5" />}
            Муж
          </button>
          <button
            onClick={() => { onSubmit(seatNumber, "female", phone.trim()); onClose(); }}
            disabled={loading}
            className="flex-1 py-3 rounded-xl bg-muted text-foreground font-bold text-sm border border-border active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-5 h-5" />}
            Жен
          </button>
        </div>
        <input type="tel" placeholder="Телефон (необязательно)" value={phone} onChange={(e) => setPhone(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
    </div>
  );
}
