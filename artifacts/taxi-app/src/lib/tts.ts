let cachedRu: SpeechSynthesisVoice | null = null;
let unlocked = false;
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch { return null; }
}

function pickRussianVoice(): SpeechSynthesisVoice | null {
  if (cachedRu) return cachedRu;
  try {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    cachedRu = voices.find(v => /ru[-_]/i.test(v.lang)) || voices.find(v => v.lang?.toLowerCase().startsWith("ru")) || null;
    return cachedRu;
  } catch { return null; }
}

// Pool of pre-primed HTMLAudioElements unlocked during user gesture.
// HTMLAudioElement.play() requires either (a) a user gesture or (b) a previously-primed element.
// We prime several elements on first touch, then swap their `src` later to play arbitrary URLs without a fresh gesture.
const _primedAudios: HTMLAudioElement[] = [];
let _primedIdx = 0;
const PRIMED_POOL_SIZE = 4;
// 0.1s of silence as data URI - tiny WAV
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

function primeAudioPool() {
  if (_primedAudios.length >= PRIMED_POOL_SIZE) return;
  for (let i = _primedAudios.length; i < PRIMED_POOL_SIZE; i++) {
    try {
      const a = new Audio();
      a.preload = "auto";
      a.src = SILENT_WAV;
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.then(() => { try { a.pause(); a.currentTime = 0; } catch {} }).catch(() => {});
      }
      _primedAudios.push(a);
    } catch {}
  }
}

export function playUrlViaPrimedAudio(url: string, volume = 1): boolean {
  if (_primedAudios.length === 0) {
    // Not unlocked yet — try a fresh element (will fail without gesture, caller should fallback)
    try {
      const a = new Audio(url);
      a.volume = volume;
      const p = a.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      return true;
    } catch { return false; }
  }
  const a = _primedAudios[_primedIdx % _primedAudios.length];
  _primedIdx++;
  try {
    a.pause();
    a.src = url;
    a.currentTime = 0;
    a.volume = volume;
    const p = a.play();
    if (p && typeof p.catch === "function") {
      p.catch(err => console.warn("[primedAudio] play failed:", err));
    }
    return true;
  } catch (e) {
    console.warn("[primedAudio] error:", e);
    return false;
  }
}

function unlock() {
  if (unlocked) return;
  try {
    const synth = window.speechSynthesis;
    if (synth) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    }
    getCtx();
    primeAudioPool();
    unlocked = true;
    console.log("[tts] audio unlocked (AudioContext + primed audio pool)");
  } catch {}
}

export function initSpeechOnInteraction() {
  if (typeof window === "undefined") return;
  const handler = () => { unlock(); pickRussianVoice(); };
  window.addEventListener("click", handler, { passive: true });
  window.addEventListener("touchstart", handler, { passive: true });
  window.addEventListener("keydown", handler, { passive: true });
}

type ToneStep = { freq: number; dur: number; type?: OscillatorType; vol?: number };

function playSteps(steps: ToneStep[]) {
  const ctx = getCtx();
  if (!ctx) return;
  let t = ctx.currentTime + 0.02;
  for (const s of steps) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = s.type || "sine";
    osc.frequency.value = s.freq;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(s.vol ?? 0.45, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + s.dur / 1000);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + s.dur / 1000 + 0.05);
    t += s.dur / 1000;
  }
}

const CUES: Record<string, ToneStep[]> = {
  cancel:    [{ freq: 700, dur: 140 }, { freq: 500, dur: 140 }, { freq: 350, dur: 220 }],
  unassign:  [{ freq: 600, dur: 130 }, { freq: 400, dur: 200 }],
  seat:      [{ freq: 900, dur: 120 }, { freq: 1100, dur: 120 }, { freq: 1300, dur: 180 }],
  generic:   [{ freq: 880, dur: 120 }, { freq: 660, dur: 200 }],
};

export function playCue(kind: keyof typeof CUES) {
  try { playSteps(CUES[kind] || CUES.generic); } catch {}
  try { (navigator as any).vibrate?.([120, 60, 120]); } catch {}
}


// AudioContext-based mp3 playback. AudioContext is unlocked at first user gesture,
// then any subsequent .start() call works WITHOUT a fresh user interaction
// (HTMLAudioElement.play() does NOT survive a stale gesture in many WebViews).
const _bufCache: Map<string, AudioBuffer> = new Map();

export async function playMp3ViaContext(url: string): Promise<boolean> {
  try {
    const ctx = getCtx();
    if (!ctx) return false;
    let buf = _bufCache.get(url);
    if (!buf) {
      const r = await fetch(url, { credentials: "omit" });
      if (!r.ok) return false;
      const ab = await r.arrayBuffer();
      buf = await new Promise<AudioBuffer>((resolve, reject) => {
        ctx.decodeAudioData(ab.slice(0), resolve, reject);
      });
      _bufCache.set(url, buf);
    }
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain); gain.connect(ctx.destination);
    src.start(0);
    return true;
  } catch (e) {
    console.warn("[playMp3ViaContext] failed:", e);
    return false;
  }
}

export function speakRu(text: string, cue: keyof typeof CUES = "generic") {
  // ALWAYS play audio cue first (works on iOS after one tap; speechSynthesis is unreliable on iOS via WS events)
  playCue(cue);
  try {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try { synth.resume(); } catch {}
    try { synth.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU"; u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
    const v = pickRussianVoice(); if (v) u.voice = v;
    synth.speak(u);
    setTimeout(() => { try { synth.resume(); } catch {} }, 50);
  } catch (e) { console.warn("[TTS] speak failed", e); }
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
    window.speechSynthesis.onvoiceschanged = () => { cachedRu = null; pickRussianVoice(); };
  }
  pickRussianVoice();
  initSpeechOnInteraction();
}
