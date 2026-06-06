import { Loader2, RefreshCw, AlertTriangle, Wifi, WifiOff } from "lucide-react";

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full">
      <div className="flex gap-4 px-4 py-3 border-b border-border bg-muted">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 bg-foreground/10 rounded animate-pulse" style={{ width: `${60 + Math.random() * 80}px` }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-4 border-b border-border">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-3.5 bg-foreground/5 rounded animate-pulse" style={{ width: `${40 + Math.random() * 100}px`, animationDelay: `${(i * cols + j) * 50}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-3" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-full bg-foreground/5 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-24 bg-foreground/5 rounded animate-pulse" />
              <div className="h-3 w-20 bg-foreground/5 rounded animate-pulse" />
              <div className="h-5 w-16 bg-foreground/5 rounded-full animate-pulse" />
            </div>
          </div>
          <div className="bg-muted rounded-lg p-2.5 flex items-center gap-2.5">
            <div className="w-7 h-7 bg-foreground/5 rounded animate-pulse" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3.5 w-20 bg-foreground/5 rounded animate-pulse" />
              <div className="h-3 w-28 bg-foreground/5 rounded animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-4 flex items-center gap-3" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="w-9 h-9 rounded-lg bg-foreground/5 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-32 bg-foreground/5 rounded animate-pulse" />
            <div className="h-3 w-20 bg-foreground/5 rounded animate-pulse" />
          </div>
          <div className="h-3 w-16 bg-foreground/5 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-5 space-y-3" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-foreground/5 animate-pulse" />
            <div className="h-3 w-16 bg-foreground/5 rounded animate-pulse" />
          </div>
          <div className="h-7 w-24 bg-foreground/5 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function DriverPageSkeleton() {
  return (
    <div className="p-4 space-y-4">
      <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-foreground/5 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-28 bg-foreground/5 rounded animate-pulse" />
            <div className="h-3 w-20 bg-foreground/5 rounded animate-pulse" />
          </div>
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-2xl p-4 space-y-3" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-foreground/5 animate-pulse" />
            <div className="h-3.5 w-24 bg-foreground/5 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
        <Icon className="w-8 h-8 text-muted-foreground/40" />
      </div>
      <p className="text-base font-semibold text-foreground mb-1">{title}</p>
      {description && <p className="text-sm text-muted-foreground max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
        <WifiOff className="w-8 h-8 text-red-500/60" />
      </div>
      <p className="text-base font-semibold text-foreground mb-1">Не удалось загрузить данные</p>
      <p className="text-sm text-muted-foreground max-w-xs mb-4">
        {message || "Проверьте подключение к сети и попробуйте снова"}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 active:scale-[0.97] transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Повторить
        </button>
      )}
    </div>
  );
}

export function InlineError({ message, onRetry }: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm">
      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
      <span className="text-red-700 flex-1">{message || "Ошибка загрузки"}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-semibold text-red-600 hover:text-red-700 active:scale-95 transition-all flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
          Повторить
        </button>
      )}
    </div>
  );
}
