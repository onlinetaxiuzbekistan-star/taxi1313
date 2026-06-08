import { Vibration, Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

// Bundled, offline notification sounds (ship inside the APK).
// Files live in assets/sounds/ — replace them with custom audio anytime,
// keeping the same names: new_order.mp3, call.mp3, message.mp3.
let newOrderPlayer: AudioPlayer | null = null;
let callPlayer: AudioPlayer | null = null;
let messagePlayer: AudioPlayer | null = null;
let ready = false;

function ensure() {
  if (ready) return;
  ready = true;
  try {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false } as any).catch(() => {});
  } catch {}
  try {
    newOrderPlayer = createAudioPlayer(require("../../assets/sounds/new_order.mp3"));
    callPlayer = createAudioPlayer(require("../../assets/sounds/call.mp3"));
    messagePlayer = createAudioPlayer(require("../../assets/sounds/message.mp3"));
  } catch {}
}

function fire(p: AudioPlayer | null) {
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch {}
}

// New incoming order — the most important: sound + a strong vibration pattern.
export function playNewOrder() {
  ensure();
  fire(newOrderPlayer);
  try {
    Vibration.vibrate(Platform.OS === "android" ? [0, 400, 150, 400] : 400);
  } catch {}
}

// Incoming voice call — loop the ringtone until stopCall() is called.
export function playCall() {
  ensure();
  if (!callPlayer) return;
  try {
    callPlayer.loop = true;
    callPlayer.seekTo(0);
    callPlayer.play();
  } catch {}
}

export function stopCall() {
  if (!callPlayer) return;
  try {
    callPlayer.pause();
    callPlayer.seekTo(0);
  } catch {}
}

// New chat message — short blip.
export function playMessage() {
  ensure();
  fire(messagePlayer);
}
