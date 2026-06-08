// Backend endpoints. The native app talks to the SAME live backend as the
// existing WebView APK.
//
// IMPORTANT: the REST API + WebSocket live at the ROOT — https://nil.taxi1313.ru
// (nginx: `location /api/` and `location /api/ws` proxy to the backend). The
// "/driver" path is only a CLIENT-SIDE route of the web SPA (its base href is
// "/"), NOT an API prefix — there is no `/driver/api/` route, so calling it 404s.
// (The old Capacitor APK's native poller also used the root: /api/drivers/...)
// Backend is NOT modified by this migration.
//
// Override at build/run time with EXPO_PUBLIC_API_BASE (e.g. a LAN dev box).
// NOTE: never point this at the protected 192.168.1.107 host / SMS gateway.

const DEFAULT_API_BASE = "https://nil.taxi1313.ru";

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE || DEFAULT_API_BASE
).replace(/\/+$/, "");

// ws(s)://…/api/ws — derived from the API base, http->ws / https->wss.
export const WS_URL =
  API_BASE_URL.replace(/^http/i, "ws") + "/api/ws";

// Design preview: when true, the tab shell renders with a demo driver (BUX-001)
// so the UI can be reviewed WITHOUT a real login. This is OPT-IN — set
// EXPO_PUBLIC_PREVIEW=1 to enable it (e.g. for web design screenshots).
//
// It defaults to OFF so installable/device builds require a real login-by-code:
// the native background service (GPS, foreground notification, offer poll) is
// gated behind a real auth token + server "online" status, which demo mode never
// provides. (Shipping with preview ON is why the first APK never started the
// service.)
export const PREVIEW_MODE = process.env.EXPO_PUBLIC_PREVIEW === "1";

// Visible build marker — lets us instantly confirm a device is running the
// latest bundle (vs. a stale install that didn't replace the old APK). Bump
// this string with each meaningful build.
export const BUILD_TAG = "v1.0.6 · unassign/sell-order/sounds";
