import { useCallback, useRef } from "react";

export type SoundPreset = "default" | "urgent" | "bell" | "chime" | "horn" | "digital";

type SoundType = "new_order" | "urgent" | "message" | "success" | "error";

interface ToneStep {
  freq: number;
  dur: number;
  type: OscillatorType;
  vol: number;
}

const ORDER_PRESETS: Record<SoundPreset, ToneStep[]> = {
  default: [
    { freq: 880, dur: 150, type: "sine", vol: 0.5 },
    { freq: 1100, dur: 100, type: "sine", vol: 0.5 },
    { freq: 880, dur: 150, type: "sine", vol: 0.5 },
    { freq: 1100, dur: 100, type: "sine", vol: 0.5 },
  ],
  urgent: [
    { freq: 1200, dur: 100, type: "square", vol: 0.45 },
    { freq: 1400, dur: 80, type: "square", vol: 0.5 },
    { freq: 1200, dur: 100, type: "square", vol: 0.45 },
    { freq: 1400, dur: 80, type: "square", vol: 0.5 },
    { freq: 1600, dur: 160, type: "square", vol: 0.55 },
  ],
  bell: [
    { freq: 1047, dur: 200, type: "sine", vol: 0.4 },
    { freq: 1319, dur: 200, type: "sine", vol: 0.35 },
    { freq: 1568, dur: 300, type: "sine", vol: 0.45 },
  ],
  chime: [
    { freq: 523, dur: 180, type: "triangle", vol: 0.4 },
    { freq: 659, dur: 140, type: "triangle", vol: 0.4 },
    { freq: 784, dur: 140, type: "triangle", vol: 0.45 },
    { freq: 1047, dur: 280, type: "triangle", vol: 0.5 },
  ],
  horn: [
    { freq: 440, dur: 300, type: "sawtooth", vol: 0.3 },
    { freq: 554, dur: 300, type: "sawtooth", vol: 0.35 },
    { freq: 659, dur: 400, type: "sawtooth", vol: 0.4 },
  ],
  digital: [
    { freq: 800, dur: 60, type: "square", vol: 0.35 },
    { freq: 1000, dur: 60, type: "square", vol: 0.35 },
    { freq: 800, dur: 60, type: "square", vol: 0.35 },
    { freq: 0, dur: 80, type: "square", vol: 0 },
    { freq: 1200, dur: 60, type: "square", vol: 0.4 },
    { freq: 1000, dur: 60, type: "square", vol: 0.35 },
    { freq: 1200, dur: 100, type: "square", vol: 0.4 },
  ],
};

const SYSTEM_SOUNDS: Record<Exclude<SoundType, "new_order">, ToneStep[]> = {
  urgent: ORDER_PRESETS.urgent,
  message: [
    { freq: 660, dur: 100, type: "sine", vol: 0.3 },
    { freq: 880, dur: 150, type: "sine", vol: 0.3 },
  ],
  success: [
    { freq: 523, dur: 100, type: "sine", vol: 0.4 },
    { freq: 659, dur: 100, type: "sine", vol: 0.4 },
    { freq: 784, dur: 100, type: "sine", vol: 0.4 },
    { freq: 1047, dur: 300, type: "sine", vol: 0.4 },
  ],
  error: [
    { freq: 400, dur: 200, type: "sawtooth", vol: 0.35 },
    { freq: 300, dur: 300, type: "sawtooth", vol: 0.35 },
  ],
};

function getSettings(): { soundEnabled: boolean; vibrationEnabled: boolean; soundPreset: SoundPreset } {
  try {
    const settingsRaw = localStorage.getItem("buxtaxi_settings");
    let soundPreset: SoundPreset = "default";
    if (settingsRaw) {
      try {
        const parsed = JSON.parse(settingsRaw);
        if (parsed.sound && parsed.sound in ORDER_PRESETS) soundPreset = parsed.sound;
      } catch {}
    }
    return {
      soundEnabled: localStorage.getItem("buxtaxi_sound") !== "false",
      vibrationEnabled: localStorage.getItem("buxtaxi_vibration") !== "false",
      soundPreset,
    };
  } catch {
    return { soundEnabled: true, vibrationEnabled: true, soundPreset: "default" };
  }
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSteps(steps: ToneStep[]): void {
  try {
    const ctx = getAudioContext();
    let startTime = ctx.currentTime;

    for (const step of steps) {
      if (step.freq === 0 || step.vol === 0) {
        startTime += step.dur / 1000;
        continue;
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = step.type;
      osc.frequency.value = step.freq;
      gain.gain.setValueAtTime(step.vol, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + step.dur / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + step.dur / 1000 + 0.05);
      startTime += step.dur / 1000;
    }
  } catch {}
}

function playTone(soundType: SoundType): void {
  const { soundEnabled, soundPreset } = getSettings();
  if (!soundEnabled) return;

  if (soundType === "new_order") {
    playSteps(ORDER_PRESETS[soundPreset] || ORDER_PRESETS.default);
  } else {
    playSteps(SYSTEM_SOUNDS[soundType]);
  }
}

let ringtoneAudio: HTMLAudioElement | null = null;
let ringtoneDataUrl: string | null = null;

function generateRingtoneWav(): string {
  if (ringtoneDataUrl) return ringtoneDataUrl;

  const sampleRate = 44100;
  const duration = 2.0;
  const totalSamples = Math.floor(sampleRate * duration);
  const buffer = new Float32Array(totalSamples);

  const ringDur = 0.8;
  const pauseDur = 0.4;
  const cycleSamples = Math.floor((ringDur + pauseDur) * sampleRate);

  for (let i = 0; i < totalSamples; i++) {
    const posInCycle = i % cycleSamples;
    const t = i / sampleRate;
    const tInCycle = posInCycle / sampleRate;

    if (tInCycle < ringDur) {
      const env = Math.min(1, tInCycle / 0.02) * Math.min(1, (ringDur - tInCycle) / 0.02);
      const pulse = Math.sin(2 * Math.PI * 25 * tInCycle) * 0.3 + 0.7;

      const f1 = Math.sin(2 * Math.PI * 440 * t);
      const f2 = Math.sin(2 * Math.PI * 480 * t);

      const h1 = Math.sin(2 * Math.PI * 880 * t) * 0.15;
      const h2 = Math.sin(2 * Math.PI * 960 * t) * 0.1;

      buffer[i] = (f1 * 0.4 + f2 * 0.4 + h1 + h2) * env * pulse * 0.7;
    } else {
      buffer[i] = 0;
    }
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = totalSamples * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < totalSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, buffer[i]));
    const val = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    view.setInt16(headerSize + i * 2, val, true);
  }

  const blob = new Blob([arrayBuffer], { type: "audio/wav" });
  ringtoneDataUrl = URL.createObjectURL(blob);
  return ringtoneDataUrl;
}

function createRingtoneAudio(): HTMLAudioElement {
  if (ringtoneAudio) return ringtoneAudio;
  const url = generateRingtoneWav();
  ringtoneAudio = new Audio(url);
  ringtoneAudio.loop = true;
  ringtoneAudio.volume = 1.0;
  return ringtoneAudio;
}

function startRingtone(): void {
  const { soundEnabled } = getSettings();
  if (!soundEnabled) return;

  try {
    const audio = createRingtoneAudio();
    audio.currentTime = 0;
    audio.play().catch(() => {
      playTone("new_order");
    });
  } catch {
    playTone("new_order");
  }
}

function stopRingtone(): void {
  if (ringtoneAudio) {
    ringtoneAudio.pause();
    ringtoneAudio.currentTime = 0;
  }
}

function triggerVibration(pattern: number[]): void {
  const { vibrationEnabled } = getSettings();
  if (!vibrationEnabled) return;
  try {
    if ("vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {}
}

export function previewSound(preset: SoundPreset): void {
  playSteps(ORDER_PRESETS[preset] || ORDER_PRESETS.default);
}

export const SOUND_PRESET_LABELS: Record<SoundPreset, string> = {
  default: "Стандарт",
  urgent: "Тревога",
  bell: "Колокол",
  chime: "Перезвон",
  horn: "Горн",
  digital: "Цифровой",
};

export function useNotificationSound() {
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const usingRingtoneRef = useRef(false);

  const play = useCallback((type: SoundType) => {
    playTone(type);
    if (type === "new_order" || type === "urgent") {
      triggerVibration([300, 100, 300, 100, 300]);
    } else if (type === "message") {
      triggerVibration([100, 50, 100]);
    } else if (type === "success") {
      triggerVibration([200]);
    }
  }, []);

  const startLoop = useCallback((type: SoundType, intervalMs = 2000) => {
    if (loopRef.current) clearInterval(loopRef.current);
    stopRingtone();

    if (type === "new_order") {
      startRingtone();
      usingRingtoneRef.current = true;

      triggerVibration([200, 100, 200]);
      loopRef.current = setInterval(() => {
        triggerVibration([150, 80, 150]);
      }, 15000);
    } else {
      usingRingtoneRef.current = false;
      playTone(type);
      triggerVibration([200, 100, 200]);
      loopRef.current = setInterval(() => {
        playTone(type);
        triggerVibration([150, 80, 150]);
      }, Math.max(intervalMs, 8000));
    }
  }, []);

  const stopLoop = useCallback(() => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
    if (usingRingtoneRef.current) {
      stopRingtone();
      usingRingtoneRef.current = false;
    }
    try { navigator.vibrate(0); } catch {}
  }, []);

  return { play, startLoop, stopLoop };
}

export function initAudioOnInteraction(): void {
  const handler = () => {
    try {
      getAudioContext();
      createRingtoneAudio();
    } catch {}
    document.removeEventListener("touchstart", handler);
    document.removeEventListener("click", handler);
  };
  document.addEventListener("touchstart", handler, { once: true });
  document.addEventListener("click", handler, { once: true });
}
