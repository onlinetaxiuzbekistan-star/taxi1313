import { useState, useEffect, useCallback, useRef } from "react";
import DispatcherLayout from "../DispatcherLayout";
import {
  ArrowLeft, Smartphone, Download, Loader2, CheckCircle2, XCircle,
  Rocket, Clock, FileText, QrCode, History, Package, ChevronDown, ChevronUp,
  Globe, Copy, Check, ExternalLink, Trash2, HardDrive
} from "lucide-react";
import { useLocation } from "wouter";
import { QRCodeSVG as QRCode } from "qrcode.react";
import { useAuth } from "../../../hooks/use-auth";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface BuildInfo {
  buildId: string;
  status: "building" | "ready" | "error";
  version: string;
  startTime: string;
  endTime: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  error: string | null;
}

interface ApkFile {
  name: string;
  size: number;
  date: string;
}

interface StatusResponse {
  current: BuildInfo | null;
  history: BuildInfo[];
  configured: boolean;
  missingTools: string[];
  apkFiles: ApkFile[];
}

function fmt(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDuration(start: string, end: string | null): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.floor((e - s) / 1000);
  if (diff < 60) return `${diff}с`;
  return `${Math.floor(diff / 60)}м ${diff % 60}с`;
}

function formatDate(date: string): string {
  const d = new Date(date);
  return `${fmt(d.getDate())}.${fmt(d.getMonth()+1)}.${String(d.getFullYear()).slice(2)} ${fmt(d.getHours())}:${fmt(d.getMinutes())}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " Б";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
  return (bytes / (1024 * 1024)).toFixed(1) + " МБ";
}

function DriverTestQR() {
  const [copied, setCopied] = useState(false);
  const driverUrl = `${window.location.origin}${BASE}/driver`;

  const copyUrl = () => {
    navigator.clipboard.writeText(driverUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
          <Globe className="w-4 h-4 text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Тестирование на телефоне</h3>
          <p className="text-[10px] text-muted-foreground">Сканируйте QR код камерой телефона</p>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="p-4 bg-white rounded-2xl shadow-inner">
          <QRCode value={driverUrl} size={200} level="H" includeMargin={false} />
        </div>
      </div>

      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">Водительское приложение (PWA)</p>
        <p className="text-xs text-muted-foreground">
          Откройте камеру телефона и наведите на QR код
        </p>
      </div>

      <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-mono text-muted-foreground truncate">{driverUrl}</p>
        </div>
        <button onClick={copyUrl}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium bg-card border border-border rounded-lg hover:bg-muted transition-colors flex-shrink-0">
          {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
          {copied ? "Скопировано" : "Копировать"}
        </button>
        <a href={driverUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium bg-card border border-border rounded-lg hover:bg-muted transition-colors flex-shrink-0">
          <ExternalLink className="w-3 h-3" />
          Открыть
        </a>
      </div>

      <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-3 space-y-1.5">
        <p className="text-[11px] font-medium text-blue-700">Как тестировать:</p>
        <ol className="text-[10px] text-blue-600 space-y-1 list-decimal pl-3.5">
          <li>Сканируйте QR код камерой телефона</li>
          <li>Откроется водительское приложение в браузере</li>
          <li>Войдите с учетными данными водителя</li>
          <li>Нажмите "Добавить на главный экран" для PWA</li>
        </ol>
      </div>
    </div>
  );
}

export default function ApkSettings() {
  const [, navigate] = useLocation();
  const { token } = useAuth();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [serverUrl, setServerUrl] = useState("");
  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hdrs = useCallback(() => ({
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  }), [token]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/apk/status`, { headers: hdrs() });
      if (res.ok && mountedRef.current) {
        const d = await res.json();
        setData(d);
        if (d.current?.status === "building") {
          pollRef.current = setTimeout(fetchStatus, 3000);
        }
      }
    } catch (err: any) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [hdrs]);

  useEffect(() => {
    mountedRef.current = true;
    fetchStatus();
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchStatus]);

  useEffect(() => {
    if (data?.current?.status === "building" && data.current.startTime) {
      const start = new Date(data.current.startTime).getTime();
      setElapsed(Math.floor((Date.now() - start) / 1000));
      timerRef.current = setInterval(() => {
        if (mountedRef.current) setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [data?.current?.status, data?.current?.startTime]);

  const startBuild = async () => {
    setBuilding(true);
    setError(null);
    try {
      const body: any = {};
      if (serverUrl.trim()) body.serverUrl = serverUrl.trim();
      const res = await fetch(`${BASE}/api/apk/build`, {
        method: "POST",
        headers: hdrs(),
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.missingTools) {
          setError(`Для сборки APK необходимо установить: ${d.missingTools.join(", ")}. Обратитесь к администратору сервера.`);
        } else {
          setError(d.error || d.message || "Ошибка сборки");
        }
        return;
      }
      await fetchStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBuilding(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${BASE}/api/apk/logs`, { headers: hdrs() });
      if (res.ok) {
        const d = await res.json();
        setLogs(d.log);
        setShowLogs(true);
      }
    } catch {}
  };

  const downloadApk = (filename: string) => {
    const a = document.createElement("a");
    a.href = `${BASE}/api/apk/download/${filename}`;
    a.download = filename;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${BASE}/api/apk/download/${filename}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.responseType = "blob";
    xhr.onload = () => {
      if (xhr.status === 200) {
        const url = URL.createObjectURL(xhr.response);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }
    };
    xhr.send();
  };

  const cur = data?.current;
  const isBuilding = cur?.status === "building";
  const isReady = cur?.status === "ready";
  const isError = cur?.status === "error";
  const isIdle = !cur;

  const progressPercent = isBuilding ? Math.min(95, (elapsed / 300) * 100) : isReady ? 100 : 0;

  if (loading) {
    return (
      <DispatcherLayout>
        <div className="p-6 flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
        </div>
      </DispatcherLayout>
    );
  }

  return (
    <DispatcherLayout>
      <div className="p-6 space-y-5 max-w-2xl mx-auto pb-20">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/management/settings")}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">Такси 1313 Водитель</h2>
            <p className="text-sm text-muted-foreground">Android APK</p>
          </div>
        </div>

        {!data?.configured && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <HardDrive className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Build инструменты не найдены</p>
                <p className="text-xs text-amber-700 mt-1">
                  Отсутствуют: {data?.missingTools?.join(", ") || "Android SDK"}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 pb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Текущая сборка</span>
              </div>
              {cur && (
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  v{cur.version}
                </span>
              )}
            </div>

            {isIdle && (
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-2xl bg-gray-500/10 flex items-center justify-center mx-auto mb-3">
                  <Smartphone className="w-7 h-7 text-gray-400" />
                </div>
                <p className="text-sm text-muted-foreground">Нет активных сборок</p>
                <p className="text-xs text-muted-foreground mt-1">Нажмите кнопку ниже для начала</p>
              </div>
            )}

            {isBuilding && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">Сборка APK...</p>
                    <p className="text-xs text-muted-foreground">
                      {elapsed < 60 ? `${elapsed}с` : `${Math.floor(elapsed/60)}м ${elapsed%60}с`}
                    </p>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-amber-500/10">
                    <span className="text-xs font-medium text-amber-600">Building</span>
                  </div>
                </div>
                <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-1000"
                    style={{ width: `${progressPercent}%` }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
                </div>
              </div>
            )}

            {isReady && cur && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">APK готов к установке</p>
                    <p className="text-xs text-muted-foreground">
                      Собрано за {formatDuration(cur.startTime, cur.endTime)}
                    </p>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-green-500/10">
                    <span className="text-xs font-medium text-green-600">Ready</span>
                  </div>
                </div>
                <div className="h-1 bg-green-500 rounded-full" />
              </div>
            )}

            {isError && cur && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">Ошибка сборки</p>
                    <p className="text-xs text-muted-foreground">{formatDate(cur.startTime)}</p>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-red-500/10">
                    <span className="text-xs font-medium text-red-600">Error</span>
                  </div>
                </div>
                <div className="h-1 bg-red-500 rounded-full" />
                <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3">
                  <p className="text-xs text-red-700 font-mono break-all">{cur.error}</p>
                </div>
              </div>
            )}
          </div>

          {(isReady || isError || isBuilding) && (
            <div className="border-t border-border px-5 py-3 flex gap-2">
              {isReady && cur?.fileName && (
                <button onClick={() => downloadApk(cur.fileName!)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-green-600 hover:bg-green-500/5 rounded-lg transition-colors">
                  <Download className="w-3.5 h-3.5" />
                  Скачать APK
                </button>
              )}
              <button onClick={fetchLogs}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground hover:bg-muted rounded-lg transition-colors">
                <FileText className="w-3.5 h-3.5" />
                {isError ? "Показать лог" : "Логи сборки"}
              </button>
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              URL сервера (необязательно)
            </label>
            <input
              value={serverUrl}
              onChange={e => setServerUrl(e.target.value)}
              placeholder={`https://${window.location.host}`}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              По умолчанию используется текущий домен сервера
            </p>
          </div>

          {error && (
            <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <button onClick={startBuild}
            disabled={building || isBuilding}
            className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-orange-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2 active:scale-[0.98]">
            {building || isBuilding ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Сборка...
              </>
            ) : (
              <>
                <Rocket className="w-5 h-5" />
                Собрать APK
              </>
            )}
          </button>
        </div>

        {data && data.apkFiles.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => setShowFiles(!showFiles)}
              className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Готовые APK файлы</span>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{data.apkFiles.length}</span>
              </div>
              {showFiles ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showFiles && (
              <div className="border-t border-border divide-y divide-border">
                {data.apkFiles.map((f) => (
                  <div key={f.name} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-foreground truncate">{f.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {formatSize(f.size)} · {formatDate(f.date)}
                      </p>
                    </div>
                    <button onClick={() => downloadApk(f.name)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-green-600 hover:bg-green-500/5 rounded-lg transition-colors">
                      <Download className="w-3 h-3" />
                      Скачать
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DriverTestQR />

        {data && data.history.length > 0 && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">История сборок</span>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{data.history.length}</span>
              </div>
              {showHistory ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showHistory && (
              <div className="border-t border-border divide-y divide-border">
                {data.history.map((b) => (
                  <div key={b.buildId} className="px-4 py-3 flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      b.status === "ready" ? "bg-green-500" : b.status === "error" ? "bg-red-500" : "bg-amber-500"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-foreground">v{b.version}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          b.status === "ready" ? "bg-green-500/10 text-green-600" :
                          b.status === "error" ? "bg-red-500/10 text-red-600" :
                          "bg-amber-500/10 text-amber-600"
                        }`}>
                          {b.status === "ready" ? "OK" : b.status === "error" ? "ERR" : "..."}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(b.startTime)}</p>
                    </div>
                    {b.status === "ready" && b.fileName && (
                      <button onClick={() => downloadApk(b.fileName!)}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-green-600 hover:bg-green-500/5 rounded-lg transition-colors">
                        <Download className="w-3 h-3" />
                        APK
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showLogs && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Логи сборки</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={fetchLogs}
                  className="text-xs text-primary hover:text-primary/80 transition-colors">
                  Обновить
                </button>
                <button onClick={() => setShowLogs(false)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Закрыть
                </button>
              </div>
            </div>
            <div className="bg-[#0d1117] p-4 max-h-96 overflow-y-auto font-mono">
              {logs.length === 0 ? (
                <p className="text-xs text-gray-500">Нет логов</p>
              ) : (
                logs.map((line, i) => (
                  <p key={i} className={`text-[11px] leading-5 break-all ${
                    line.includes("ERROR") || line.includes("error") ? "text-red-400" :
                    line.includes("SUCCESS") || line.includes("SUCCESS") ? "text-green-400" :
                    line.includes("WARNING") ? "text-yellow-400" :
                    "text-gray-300"
                  }`}>
                    {line}
                  </p>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </DispatcherLayout>
  );
}
