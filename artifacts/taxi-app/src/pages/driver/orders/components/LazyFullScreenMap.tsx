import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const FullScreenMapInner = lazy(() => import("./FullScreenMap").then(m => ({ default: m.FullScreenMap })));

export function LazyFullScreenMap(props: any) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
      <FullScreenMapInner {...props} />
    </Suspense>
  );
}
