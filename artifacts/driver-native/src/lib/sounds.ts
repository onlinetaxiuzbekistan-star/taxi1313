import { Vibration, Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

// Bundled, offline notification sounds (ship inside the APK), in assets/sounds/.
// Replace with custom audio anytime, keeping the same names.
const players: Record<string, AudioPlayer | null> = {};
let ready = false;

function ensure() {
  if (ready) return;
  ready = true;
  try {
    // Play even when the ringer is on silent (mostly relevant on iOS).
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false } as any).catch((e) =>
      console.log("[SOUND] setAudioMode error", String(e)),
    );
  } catch (e) {
    console.log("[SOUND] setAudioMode threw", String(e));
  }
  // createAudioPlayer is synchronous — players exist immediately after this.
  try {
    players.new_order = createAudioPlayer(require("../../assets/sounds/new_order.wav"));
    players.call = createAudioPlayer(require("../../assets/sounds/call.wav"));
    players.message = createAudioPlayer(require("../../assets/sounds/message.wav"));
    players.market = createAudioPlayer(require("../../assets/sounds/market_new.wav"));
    players.removed = createAudioPlayer(require("../../assets/sounds/order_removed.wav"));
    players.trip_start = createAudioPlayer(require("../../assets/sounds/trip_start.wav"));
    console.log("[SOUND] players created:", Object.keys(players).join(","));
  } catch (e) {
    console.log("[SOUND] createAudioPlayer error", String(e));
  }
}

// Preload at app start so the first event plays instantly.
export function preloadSounds() {
  ensure();
}

function fire(key: string) {
  ensure();
  const p = players[key];
  if (!p) {
    console.log("[SOUND] no player for", key);
    return;
  }
  try {
    p.seekTo(0);
    p.play();
    console.log("[SOUND] play", key);
  } catch (e) {
    console.log("[SOUND] play error", key, String(e));
  }
}

// New incoming order — sound + a strong vibration pattern.
export function playNewOrder() {
  fire("new_order");
  try {
    Vibration.vibrate(Platform.OS === "android" ? [0, 400, 150, 400] : 400);
  } catch {}
}

// New sellable order appeared on the Маркет (efir) matching this driver.
export function playMarket() {
  fire("market");
  try {
    Vibration.vibrate(200);
  } catch {}
}

// Incoming voice call — loop the ringtone until stopCall() is called.
export function playCall() {
  ensure();
  const p = players.call;
  if (!p) return;
  try {
    p.loop = true;
    p.seekTo(0);
    p.play();
    console.log("[SOUND] play call (loop)");
  } catch (e) {
    console.log("[SOUND] call play error", String(e));
  }
}

export function stopCall() {
  const p = players.call;
  if (!p) return;
  try {
    p.pause();
    p.seekTo(0);
  } catch {}
}

// New chat message — short blip.
export function playMessage() {
  fire("message");
}

// Operator pulled/removed the order from the driver.
export function playRemoved() {
  fire("removed");
  try {
    Vibration.vibrate(Platform.OS === "android" ? [0, 250, 120, 250] : 300);
  } catch {}
}

// Trip started (taxometer on).
export function playTripStart() {
  fire("trip_start");
}
