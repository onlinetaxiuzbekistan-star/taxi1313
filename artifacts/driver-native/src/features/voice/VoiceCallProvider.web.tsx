import { createContext, useContext, type ReactNode } from "react";

// Web stub — react-native-webrtc is native-only. Keeps the design-preview web
// build working; the real WebRTC provider (VoiceCallProvider.tsx) runs on Android.
const VoiceCallContext = createContext<{ startCall: (peerId: number, peerName: string) => void }>({
  startCall: () => {},
});
export const useVoiceCall = () => useContext(VoiceCallContext);

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  return <VoiceCallContext.Provider value={{ startCall: () => {} }}>{children}</VoiceCallContext.Provider>;
}
