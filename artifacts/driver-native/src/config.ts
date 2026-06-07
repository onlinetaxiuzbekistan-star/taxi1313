// Backend endpoints. The native app talks to the SAME live backend as the
// existing WebView APK — https://nil.taxi1313.ru, with the driver app mounted
// under /driver (mirrors capacitor.config.ts `url: https://nil.taxi1313.ru/driver`).
// Backend is NOT modified by this migration.
//
// Override at build/run time with EXPO_PUBLIC_API_BASE (e.g. a LAN dev box).
// NOTE: never point this at the protected 192.168.1.107 host / SMS gateway.

const DEFAULT_API_BASE = "https://nil.taxi1313.ru/driver";

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE || DEFAULT_API_BASE
).replace(/\/+$/, "");

// ws(s)://…/api/ws — derived from the API base, http->ws / https->wss.
export const WS_URL =
  API_BASE_URL.replace(/^http/i, "ws") + "/api/ws";

// Phase 0 preview: when true, the tab shell renders with a demo driver so the
// design can be reviewed without a live login. Real auth still works.
export const PREVIEW_MODE = process.env.EXPO_PUBLIC_PREVIEW !== "0";
