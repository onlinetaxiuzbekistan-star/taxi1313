import "./lib/polyfills";
import "./lib/sentry";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const isNativeApp = navigator.userAgent.includes("BuxTaxiDriver") || !!(window as any).__BUXTAXI_NATIVE__;

function hideSplash() {
  const sp = document.getElementById("_splash");
  if (sp) {
    sp.classList.add("hide");
    setTimeout(() => sp.remove(), 400);
  }
}

function showFatalError(msg: string) {
  const sp = document.getElementById("_splash");
  const root = document.getElementById("root");
  const html = `<div style="background:#09090b;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;padding:24px">
    <div style="text-align:center;max-width:320px">
      <div style="font-size:48px;margin-bottom:16px">\u26a0</div>
      <h2 style="font-size:20px;margin:0 0 8px">\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f</h2>
      <p style="color:#71717a;font-size:13px;margin:0 0 8px;word-break:break-word">${msg}</p>
      <button onclick="location.reload()" style="background:#F59E0B;border:none;color:#09090b;padding:14px 40px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;margin-top:16px">
        \u041f\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c
      </button>
    </div>
  </div>`;
  if (sp) sp.remove();
  if (root) root.innerHTML = html;
}

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("Root element not found");
  const root = createRoot(rootEl);
  root.render(<App onReady={hideSplash} />);
} catch (e: any) {
  console.error("[FATAL] React mount failed:", e);
  showFatalError(e?.message || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435");
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  if (isNativeApp) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
      if (regs.length > 0) {
        console.log("[SW] Unregistered", regs.length, "service workers (native APK mode)");
      }
    }).catch(() => {});
  } else {
    const swPath = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/sw.js";
    navigator.serviceWorker.register(swPath).then((reg) => {
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (newSW) {
          newSW.addEventListener("statechange", () => {
            if (newSW.state === "activated" && navigator.serviceWorker.controller) {
              console.log("[SW] New version activated, reloading");
              window.location.reload();
            }
          });
        }
      });
      setInterval(() => reg.update().catch(() => {}), 60_000);
    }).catch((err) => {
      console.warn("[SW] Registration failed:", err);
    });
  }
}
