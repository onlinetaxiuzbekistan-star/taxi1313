import { Car } from "lucide-react";

export function IdleScreen({ isOnline, onGoOnline }: {
  isOnline: boolean;
  onGoOnline: () => void;
}) {
  if (!isOnline) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center mb-5">
          <Car className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-extrabold text-foreground mb-2">Вы офлайн</h3>
        <p className="text-sm text-muted-foreground mb-6">Выйдите на линию, чтобы создать рейс и принимать пассажиров</p>
        <button onClick={onGoOnline}
          className="px-8 py-3.5 bg-amber-500 text-zinc-900 rounded-2xl font-bold text-base shadow-lg active:scale-[0.97] transition-transform">
          Выйти на линию
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Car className="w-9 h-9 text-primary" />
      </div>
      <h3 className="text-lg font-extrabold text-foreground mb-1">Вы на линии!</h3>
      <p className="text-sm text-muted-foreground">Создайте рейс, чтобы начать принимать пассажиров</p>
    </div>
  );
}

