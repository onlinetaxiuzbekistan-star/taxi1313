import { useState, useEffect } from "react";
import { X, Headphones, Trash2 } from "lucide-react";
import type { SipStatus } from "@/hooks/use-sip-phone";
import { loadSipConfig, clearSipConfig, saveSipConfig, type SipConfig } from "@/hooks/use-sip-phone";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface SipSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: SipConfig | null;
  onSave: (cfg: SipConfig) => void;
  status: SipStatus;
}

async function loadSipFromServer(): Promise<SipConfig | null> {
  try {
    const token = localStorage.getItem("authToken") || sessionStorage.getItem("authToken");
    if (!token) return null;
    const res = await fetch(`${BASE_URL}/api/auth/sip-config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.config || null;
  } catch {
    return null;
  }
}

async function saveSipToServer(cfg: SipConfig): Promise<void> {
  try {
    const token = localStorage.getItem("authToken") || sessionStorage.getItem("authToken");
    if (!token) return;
    await fetch(`${BASE_URL}/api/auth/sip-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(cfg),
    });
  } catch {}
}

export { loadSipFromServer };

export function SipSettingsModal({ isOpen, onClose, config, onSave, status }: SipSettingsModalProps) {
  const [server, setServer] = useState("");
  const [domain, setDomain] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isOpen && !loaded) {
      (async () => {
        const serverCfg = await loadSipFromServer();
        const saved = serverCfg || config || loadSipConfig();
        if (saved) {
          let srv = saved.server || "";
          srv = srv.replace(/^wss?:\/\//, "").replace(/:\d+$/, "");
          let dom = saved.domain || srv;
          dom = dom.replace(/^wss?:\/\//, "").replace(/:\d+$/, "");
          setServer(srv);
          setDomain(dom);
          setLogin(saved.login || "");
          setPassword(saved.password || "");
        }
        setLoaded(true);
      })();
    }
    if (!isOpen) setLoaded(false);
  }, [isOpen, loaded, config]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!server || !login || !password) return;
    const cleanServer = server.trim().replace(/^wss?:\/\//, "").replace(/:\d+$/, "");
    const cleanDomain = (domain.trim() || cleanServer).replace(/^wss?:\/\//, "").replace(/:\d+$/, "");
    const cfg: SipConfig = { server: cleanServer, domain: cleanDomain, login: login.trim(), password };
    saveSipConfig(cfg);
    await saveSipToServer(cfg);
    onSave(cfg);
    onClose();
  };

  const handleClear = () => {
    clearSipConfig();
    setServer("");
    setDomain("");
    setLogin("");
    setPassword("");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-[380px] p-6 z-10">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Headphones className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-gray-800">Настройки SIP</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {status === "registered" && (
          <div className="mb-4 px-3 py-2 bg-emerald-50 rounded-lg flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm text-emerald-700 font-medium">Подключён</span>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">SIP-сервер</label>
            <input type="text" value={server} onChange={e => setServer(e.target.value)}
              placeholder="voip.onlinetaxi.me"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Домен или IP (без wss:// и без порта)</p>
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Домен</label>
            <input type="text" value={domain} onChange={e => setDomain(e.target.value)}
              placeholder="voip.onlinetaxi.me"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            <p className="text-[11px] text-gray-400 mt-0.5">Обычно совпадает с сервером</p>
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Логин</label>
            <input type="text" value={login} onChange={e => setLogin(e.target.value)} placeholder="207"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1 block">Пароль</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={handleClear}
              className="px-3 py-2.5 rounded-lg border border-red-200 text-red-500 text-sm hover:bg-red-50 transition-colors"
              title="Очистить настройки">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors">
              Отмена
            </button>
            <button onClick={handleSave} disabled={!server || !login || !password}
              className="flex-1 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40 transition-all">
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
