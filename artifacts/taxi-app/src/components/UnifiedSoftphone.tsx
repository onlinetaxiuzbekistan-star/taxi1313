import { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing,
  Mic, MicOff, Pause, Play, Settings, Clock,
  ChevronDown, BookUser, ArrowRightLeft, X, Volume2, VolumeX
} from "lucide-react";
import type { SipStatus, SipCallInfo } from "@/hooks/use-sip-phone";

interface Props {
  sipStatus: SipStatus;
  sipCallInfo: SipCallInfo | null;
  waitingCalls?: Array<{ remoteNumber: string; startedAt: number; callId: string }>;
  onSipAnswer: () => void;
  onSipReject: () => void;
  onSipHangup: () => void;
  onSipToggleMute: () => void;
  onSipToggleHold: () => void;
  onSipConnect: () => void;
  onSipMakeCall: (target: string) => void;
  onSipSendDtmf?: (digit: string) => void;
  onSipTransfer?: (target: string) => void;
  onOpenSipSettings: () => void;
  onCallAnswered?: (remoteNumber: string) => void;
  isAdmin?: boolean;
}

interface CallHistoryItem {
  id: number;
  number: string;
  direction: "incoming" | "outgoing";
  time: number;
  duration: number;
}

interface SoftphoneSettings {
  ringtone: string;
  ringVolume: number;
  autoAnswer: boolean;
  autoAnswerSeconds: number;
  silentMode: boolean;
}

const HISTORY_KEY = "buxtaxi_call_history";
const SETTINGS_KEY = "buxtaxi_softphone_settings";

const RINGTONES: Record<string, string> = {
  classic: "Классический",
  digital: "Цифровой",
  soft: "Мягкий",
  urgent: "Срочный",
  none: "Без звука",
};

function loadHistory(): CallHistoryItem[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").slice(0, 20); }
  catch { return []; }
}
function saveHistory(h: CallHistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 20)));
}
function loadSettings(): SoftphoneSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      ringtone: s.ringtone || "classic",
      ringVolume: s.ringVolume ?? 80,
      autoAnswer: s.autoAnswer || false,
      autoAnswerSeconds: s.autoAnswerSeconds || 3,
      silentMode: s.silentMode || false,
    };
  } catch {
    return { ringtone: "classic", ringVolume: 80, autoAnswer: false, autoAnswerSeconds: 3, silentMode: false };
  }
}
function saveSettings(s: SoftphoneSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function formatDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s2 = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
}
function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

const ringFrequencies: Record<string, number[]> = {
  classic: [440, 480],
  digital: [800, 1000],
  soft: [350, 400],
  urgent: [600, 900],
};

function createRingtoneOsc(type: string): { ctx: AudioContext; start: () => void; stop: () => void } | null {
  if (type === "none") return null;
  try {
    if (!window.isSecureContext) return;
    const ctx = new AudioContext();
    const freqs = ringFrequencies[type] || ringFrequencies.classic;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0;
    const oscs = freqs.map(f => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.type = "sine";
      o.connect(gain);
      return o;
    });
    let interval: ReturnType<typeof setInterval> | null = null;
    return {
      ctx,
      start() {
        oscs.forEach(o => { try { o.start(); } catch {} });
        let on = true;
        gain.gain.value = 0.15;
        interval = setInterval(() => {
          on = !on;
          gain.gain.value = on ? 0.15 : 0;
        }, 500);
      },
      stop() {
        if (interval) clearInterval(interval);
        gain.gain.value = 0;
        oscs.forEach(o => { try { o.stop(); } catch {} });
        try { ctx.close(); } catch {}
      },
    };
  } catch { return null; }
}

export default function UnifiedSoftphone({
  sipStatus, sipCallInfo, waitingCalls = [], onSipAnswer, onSipReject, onSipHangup,
  onSipToggleMute, onSipToggleHold, onSipConnect, onSipMakeCall,
  onSipSendDtmf, onSipTransfer, onOpenSipSettings, onCallAnswered, isAdmin,
}: Props) {
  const [dialNumber, setDialNumber] = useState("");
  const [duration, setDuration] = useState(0);
  const [history, setHistory] = useState<CallHistoryItem[]>(loadHistory);
  const [showPhonebook, setShowPhonebook] = useState(false);
  const [showCallList, setShowCallList] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferNumber, setTransferNumber] = useState("");
  const [settings, setSettings] = useState<SoftphoneSettings>(loadSettings);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartRef = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const ringRef = useRef<ReturnType<typeof createRingtoneOsc> | null>(null);
  const autoAnswerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answeredRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sipCallInfo?.state === "active") {
      callStartRef.current = Date.now();
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - callStartRef.current) / 1000));
      }, 1000);
      if (!answeredRef.current && sipCallInfo.direction === "incoming") {
        answeredRef.current = true;
        if (onCallAnswered) onCallAnswered(sipCallInfo.remoteNumber);
      }
    } else if (sipCallInfo?.state !== "ringing") {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (!sipCallInfo) { setDuration(0); callStartRef.current = 0; answeredRef.current = false; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [sipCallInfo?.state, sipCallInfo, onCallAnswered]);

  useEffect(() => {
    if (sipCallInfo?.state === "ringing" && sipCallInfo.direction === "incoming") {
      if (!settings.silentMode && settings.ringtone !== "none") {
        const r = createRingtoneOsc(settings.ringtone);
        if (r) { r.start(); ringRef.current = r; }
      }
      if (settings.autoAnswer) {
        autoAnswerRef.current = setTimeout(() => {
          onSipAnswer();
        }, settings.autoAnswerSeconds * 1000);
      }
    } else {
      if (ringRef.current) { ringRef.current.stop(); ringRef.current = null; }
      if (autoAnswerRef.current) { clearTimeout(autoAnswerRef.current); autoAnswerRef.current = null; }
    }
    return () => {
      if (ringRef.current) { ringRef.current.stop(); ringRef.current = null; }
      if (autoAnswerRef.current) { clearTimeout(autoAnswerRef.current); autoAnswerRef.current = null; }
    };
  }, [sipCallInfo?.state, sipCallInfo?.direction, settings, onSipAnswer]);

  const updateSettings = useCallback((patch: Partial<SoftphoneSettings>) => {
    setSettings(prev => { const n = { ...prev, ...patch }; saveSettings(n); return n; });
  }, []);

  const addToHistory = useCallback((number: string, direction: "incoming" | "outgoing", dur: number) => {
    setHistory(prev => {
      const next = [{ id: Date.now(), number, direction, time: Date.now(), duration: dur }, ...prev].slice(0, 20);
      saveHistory(next);
      return next;
    });
  }, []);

  const prevCallRef = useRef<SipCallInfo | null>(null);
  useEffect(() => {
    const prev = prevCallRef.current;
    if (prev && !sipCallInfo) {
      addToHistory(prev.remoteNumber, prev.direction, Math.floor((Date.now() - prev.startedAt) / 1000));
    }
    prevCallRef.current = sipCallInfo;
  }, [sipCallInfo, addToHistory]);

  const handleDial = useCallback(() => {
    if (!dialNumber.trim() || sipStatus !== "registered") return;
    onSipMakeCall(dialNumber.trim());
    setShowPhonebook(false);
  }, [dialNumber, sipStatus, onSipMakeCall]);

  const handleTransfer = useCallback(() => {
    if (!transferNumber.trim() || !onSipTransfer) return;
    onSipTransfer(transferNumber.trim());
    setShowTransfer(false);
    setTransferNumber("");
  }, [transferNumber, onSipTransfer]);

  const handleHistoryCall = useCallback((num: string) => {
    if (sipStatus !== "registered" || sipCallInfo) return;
    onSipMakeCall(num);
    setShowHistory(false);
  }, [sipStatus, sipCallInfo, onSipMakeCall]);

  const handleAnswer = useCallback(() => {
    onSipAnswer();
  }, [onSipAnswer]);


  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPhonebook(false);
        setShowCallList(false);
        setShowHistory(false);
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const isRinging = sipCallInfo?.state === "ringing" && sipCallInfo.direction === "incoming";
  const isActive = sipCallInfo?.state === "active" || sipCallInfo?.state === "held";
  const isOutgoing = sipCallInfo?.direction === "outgoing" && sipCallInfo?.state === "ringing";
  const hasCall = isRinging || isActive || isOutgoing;
  const callCount = (hasCall ? 1 : 0) + waitingCalls.length;

  const sipLogin = (() => { try { const c = JSON.parse(localStorage.getItem("buxtaxi_sip_config") || "{}"); return c.login || ""; } catch { return ""; } })();

  if (sipStatus === "disconnected") {
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={onSipConnect}
          className="h-8 px-3 flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-medium transition-colors"
        >
          <Phone className="w-3.5 h-3.5" />
          SIP
        </button>
        {isAdmin && <button onClick={onOpenSipSettings} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
          <Settings className="w-4 h-4" />
        </button>}
      </div>
    );
  }

  const statusDot = sipStatus === "registered" ? "bg-emerald-500" : sipStatus === "connecting" ? "bg-yellow-400 animate-pulse" : "bg-red-500";

  return (
    <div ref={panelRef} className="flex items-center gap-1 relative">
      {/* 1. Phone book button (yellow) */}
      <button
        onClick={() => { setShowPhonebook(!showPhonebook); setShowCallList(false); setShowHistory(false); setShowSettings(false); }}
        className={`h-9 w-9 flex items-center justify-center rounded-lg transition-colors ${showPhonebook ? "bg-amber-500 text-white" : "bg-amber-400 hover:bg-amber-500 text-white"}`}
        title="Телефонная книга"
      >
        <BookUser className="w-4.5 h-4.5" />
      </button>

      {/* 2. Call counter badge (blue) — like HiveTaxi */}
      <div className="flex items-center">
        <button
          onClick={() => { setShowCallList(!showCallList); setShowPhonebook(false); setShowHistory(false); setShowSettings(false); }}
          className={`h-9 flex items-center gap-1 px-2.5 rounded-l-lg transition-colors ${
            isRinging ? "bg-blue-500 text-white animate-pulse" :
            hasCall ? "bg-blue-500 text-white" :
            "bg-blue-400 hover:bg-blue-500 text-white"
          }`}
          title={hasCall ? "Активные вызовы" : "Нет вызовов"}
        >
          <span className="text-sm font-bold tabular-nums min-w-[12px] text-center">{callCount}</span>
        </button>
        <button
          onClick={() => { setShowCallList(!showCallList); setShowPhonebook(false); setShowHistory(false); setShowSettings(false); }}
          className={`h-9 w-6 flex items-center justify-center rounded-r-lg border-l border-blue-300/40 transition-colors ${
            isRinging ? "bg-blue-500 text-white animate-pulse" :
            hasCall ? "bg-blue-500 text-white" :
            "bg-blue-400 hover:bg-blue-500 text-white"
          }`}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 3. History button */}
      <button
        onClick={() => { setShowHistory(!showHistory); setShowPhonebook(false); setShowCallList(false); setShowSettings(false); }}
        className={`h-9 w-9 flex items-center justify-center rounded-lg transition-colors ${showHistory ? "bg-blue-500 text-white" : "bg-blue-400 hover:bg-blue-500 text-white"}`}
        title="История звонков"
      >
        <Clock className="w-4.5 h-4.5" />
      </button>

      {/* Active call compact bar */}
      {isActive && (
        <div className="flex items-center gap-1 ml-1 bg-gray-100 rounded-lg px-2 py-1">
          <span className="text-xs font-mono font-bold text-gray-700 max-w-[100px] truncate">{sipCallInfo!.remoteNumber}</span>
          <span className="text-xs font-bold text-emerald-600 tabular-nums">{formatDur(duration)}</span>
          <button onClick={onSipToggleMute}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${sipCallInfo!.isMuted ? "bg-red-100 text-red-600" : "text-gray-500 hover:bg-gray-200"}`}
            title={sipCallInfo!.isMuted ? "Вкл. микрофон" : "Выкл. микрофон"}
          >
            {sipCallInfo!.isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onSipToggleHold}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${sipCallInfo!.state === "held" ? "bg-yellow-100 text-yellow-600" : "text-gray-500 hover:bg-gray-200"}`}
            title={sipCallInfo!.state === "held" ? "Снять с удержания" : "Удержание"}
          >
            {sipCallInfo!.state === "held" ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          {onSipTransfer && (
            <button onClick={() => setShowTransfer(!showTransfer)}
              className="w-7 h-7 flex items-center justify-center rounded text-gray-500 hover:bg-gray-200 transition-colors"
              title="Переадресация"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onSipHangup}
            className="w-7 h-7 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
            title="Завершить"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Outgoing call bar */}
      {isOutgoing && (
        <div className="flex items-center gap-1.5 ml-1 bg-gray-100 rounded-lg px-2 py-1">
          <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
          <span className="text-xs font-mono font-bold text-gray-700">{sipCallInfo!.remoteNumber}</span>
          <span className="text-xs text-gray-400">вызов...</span>
          <button onClick={onSipHangup}
            className="w-7 h-7 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Silent mode toggle */}
      <button
        onClick={() => updateSettings({ silentMode: !settings.silentMode })}
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
          settings.silentMode ? "bg-red-100 text-red-500" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
        }`}
        title={settings.silentMode ? "Включить звук" : "Без звука"}
      >
        {settings.silentMode ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>

      {/* Settings */}
      {isAdmin && <button
        onClick={() => { setShowSettings(!showSettings); setShowPhonebook(false); setShowCallList(false); setShowHistory(false); }}
        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors ml-0.5"
        title="Настройки"
      >
        <Settings className="w-4 h-4" />
      </button>}

      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full ${statusDot}`} title={sipStatus === "registered" ? `${sipLogin} подключен` : sipStatus} />

      {/* ==================== DROPDOWNS ==================== */}

      {/* Phonebook dropdown */}
      {showPhonebook && (
        <div className="absolute left-0 top-11 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="p-2.5 border-b border-gray-100">
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                placeholder="Введите номер..."
                value={dialNumber}
                onChange={e => setDialNumber(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleDial(); }}
                className="flex-1 h-8 px-2.5 text-sm border border-gray-200 rounded-md outline-none focus:border-blue-400 font-mono"
                autoFocus
              />
              <button onClick={handleDial} disabled={!dialNumber.trim() || sipStatus !== "registered"}
                className="w-8 h-8 flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 text-white rounded-md transition-colors"
              >
                <Phone className="w-4 h-4" />
              </button>
            </div>
          </div>
          {history.length > 0 && (
            <div className="max-h-48 overflow-y-auto">
              {history.slice(0, 5).map(h => (
                <button key={h.id} onClick={() => { setDialNumber(h.number); handleHistoryCall(h.number); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0"
                >
                  {h.direction === "incoming" ? <PhoneIncoming className="w-3.5 h-3.5 text-blue-500 shrink-0" /> : <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                  <span className="text-sm font-mono text-gray-700 flex-1">{h.number}</span>
                  <span className="text-xs text-gray-400">{formatTime(h.time)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Call list dropdown — shows current calls */}
      {showCallList && (
        <div className="absolute left-10 top-11 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500">Входящие вызовы ({callCount})</span>
          </div>
          {!hasCall && waitingCalls.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-gray-400">Нет активных вызовов</div>
          )}
          {isRinging && (
            <div className="px-3 py-2 flex items-center gap-2 bg-blue-50 border-b border-blue-100">
              <PhoneIncoming className="w-4 h-4 text-blue-600 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 font-mono truncate">{sipCallInfo!.remoteNumber}</div>
                <div className="text-xs text-blue-600">Входящий звонок...</div>
              </div>
              <button onClick={handleAnswer}
                className="w-8 h-8 flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 text-white rounded-md transition-colors shrink-0"
                title="Ответить (Пробел)"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button onClick={onSipReject}
                className="w-8 h-8 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors shrink-0"
                title="Отклонить"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          )}
          {isActive && (
            <div className="px-3 py-2 flex items-center gap-2">
              <Phone className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 font-mono truncate">{sipCallInfo!.remoteNumber}</div>
                <div className="text-xs text-emerald-600">Разговор {formatDur(duration)}</div>
              </div>
              <button onClick={onSipHangup}
                className="w-8 h-8 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors shrink-0"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          )}
          {isOutgoing && (
            <div className="px-3 py-2 flex items-center gap-2">
              <PhoneOutgoing className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 font-mono truncate">{sipCallInfo!.remoteNumber}</div>
                <div className="text-xs text-amber-600">Вызов...</div>
              </div>
              <button onClick={onSipHangup}
                className="w-8 h-8 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors shrink-0"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          )}
          {waitingCalls.map((wc, i) => (
            <div key={wc.callId || i} className="px-3 py-2 flex items-center gap-2 border-t border-gray-100 bg-amber-50">
              <PhoneIncoming className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 font-mono truncate">{wc.remoteNumber}</div>
                <div className="text-xs text-amber-600">Ожидает в очереди</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History dropdown */}
      {showHistory && (
        <div className="absolute left-20 top-11 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">История звонков</span>
            {history.length > 0 && (
              <button onClick={() => { setHistory([]); saveHistory([]); }}
                className="text-xs text-red-400 hover:text-red-600"
              >Очистить</button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {history.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-gray-400">Нет звонков</div>
            )}
            {history.map(h => (
              <button key={h.id} onClick={() => handleHistoryCall(h.number)}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left border-b border-gray-50 last:border-0"
              >
                {h.direction === "incoming"
                  ? <PhoneIncoming className="w-4 h-4 text-blue-500 shrink-0" />
                  : <PhoneOutgoing className="w-4 h-4 text-emerald-500 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono text-gray-800 truncate">{h.number}</div>
                  <div className="text-xs text-gray-400">{formatTime(h.time)} · {formatDur(h.duration)}</div>
                </div>
                <Phone className="w-3.5 h-3.5 text-gray-300 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Settings dropdown */}
      {showSettings && (
        <div className="absolute left-0 top-11 w-72 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-600">Настройки софтфона</span>
          </div>
          <div className="p-3 space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Рингтон</label>
              <select value={settings.ringtone} onChange={e => updateSettings({ ringtone: e.target.value })}
                className="w-full h-8 text-sm border border-gray-200 rounded-md px-2 outline-none focus:border-emerald-400"
              >
                {Object.entries(RINGTONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={settings.autoAnswer}
                  onChange={e => updateSettings({ autoAnswer: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-400"
                />
                <span className="text-sm text-gray-700">Автоподнятие</span>
              </label>
              {settings.autoAnswer && (
                <div className="mt-1.5 flex items-center gap-2 pl-6">
                  <span className="text-xs text-gray-500">Через</span>
                  <input type="number" min={1} max={30} value={settings.autoAnswerSeconds}
                    onChange={e => updateSettings({ autoAnswerSeconds: Math.max(1, Math.min(30, Number(e.target.value))) })}
                    className="w-14 h-7 text-sm text-center border border-gray-200 rounded-md outline-none focus:border-emerald-400"
                  />
                  <span className="text-xs text-gray-500">сек.</span>
                </div>
              )}
            </div>
            <button onClick={() => { setShowSettings(false); onOpenSipSettings(); }}
              className="w-full text-left text-sm text-emerald-600 hover:text-emerald-700 font-semibold py-1"
            >
              Настройки SIP подключения →
            </button>
          </div>
        </div>
      )}

      {/* Transfer popup */}
      {showTransfer && isActive && (
        <div className="absolute left-0 top-11 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 p-2.5">
          <div className="text-xs font-semibold text-gray-500 mb-1.5">Переадресация</div>
          <div className="flex gap-1.5">
            <input type="text" placeholder="Номер..." value={transferNumber}
              onChange={e => setTransferNumber(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleTransfer(); }}
              className="flex-1 h-8 px-2 text-sm border border-gray-200 rounded-md outline-none focus:border-blue-400 font-mono"
              autoFocus
            />
            <button onClick={handleTransfer} disabled={!transferNumber.trim()}
              className="h-8 px-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white text-xs font-semibold rounded-md transition-colors"
            >OK</button>
            <button onClick={() => setShowTransfer(false)}
              className="h-8 w-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
            ><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
