// Inbound WebSocket event bus. The web app dispatches `window` CustomEvents
// ("buxtaxi:ws"); React Native has no window/DOM events, so this tiny pub/sub
// fills the same role. Hooks/components subscribe; the WS hook emits.
export type WsMessage = { type: string; [k: string]: unknown };
type Listener = (data: WsMessage) => void;

const listeners = new Set<Listener>();

export const wsEvents = {
  emit(data: WsMessage): void {
    listeners.forEach((l) => {
      try {
        l(data);
      } catch {}
    });
  },
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
