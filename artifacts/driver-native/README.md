# Taxi 1313 — Native Driver App (React Native + Expo)

Phase 0 foundation of the React Native migration of the driver app. This is a
**separate** project — the existing WebView APK (`driver-apk/`) and web app
(`artifacts/taxi-app/`) are untouched and stay live. The backend is unchanged.

## Stack
- **Expo SDK 56** / React Native 0.85 / React 19 (new architecture)
- **expo-router** (file-based routing, custom header + custom tab bar)
- **NativeWind v4** + Tailwind v3 — design tokens ported 1:1 from the web app
- **@tanstack/react-query** — same client config as web
- Fonts: **DM Sans / Outfit / Inter** bundled via `@expo-google-fonts`

## What Phase 0 delivers
- Exact **driver-theme** design tokens (cyan `#1FBAD6` primary, deep-navy bg) —
  see `global.css` / `tailwind.config.js`, ported from `taxi-app/src/index.css`
  (`.driver-theme[data-theme="dark"]`).
- The **tab shell** matching the live app:
  - Header: callsign pill · balance pill · online/offline toggle · exit button
  - Bottom nav: Заказы · Срочные · Чат · Профиль (active cyan chip + glow, red
    count badges)
- Ported **non-visual logic** (reused from `taxi-app`):
  - API client (`src/lib/api-client`, vendored from `lib/api-client-react`)
    wired with `setBaseUrl` + `setAuthTokenGetter` (`src/api`)
  - Auth provider with login-by-code + session persistence
    (SecureStore/AsyncStorage) — `src/hooks/use-auth.tsx`
  - Driver WebSocket — `src/hooks/use-ride-websocket.ts`
  - Settings store + i18n (ru/uz) — `src/stores/settings.ts`, `src/lib/i18n.ts`
- Functional **login-by-code** screen → `POST /api/auth/driver-code/verify-code-only`.

## Run it
```bash
npm install
npm run start        # Expo dev server (scan QR with Expo Go / dev build)
npm run android      # Android device/emulator
npm run web          # browser preview (react-native-web)
```

Backend defaults to `https://nil.taxi1313.ru/driver` (same as the live APK).
Override with `EXPO_PUBLIC_API_BASE`. `EXPO_PUBLIC_PREVIEW=0` disables the
demo-driver preview (forces real login).

## Design verification
This environment has no Android emulator, so the shell is verified via the
**Expo web build** (react-native-web) screenshotted at phone size, compared
against a faithful reproduction of the current web shell. See `compare/`:
```bash
npx expo export --platform web      # build dist/
node compare/serve.js 8088 &        # serve dist + comparison page
node compare/capture.js             # writes compare/shots/*.png
```
`compare/shots/compare-shell.png` is the side-by-side.

## Notes / next phases
- The API client is **vendored** (copied) into `src/lib/api-client` to keep the
  Metro build hermetic. Re-sync from the monorepo source with
  `./scripts-sync-api-client.sh` after the OpenAPI client is regenerated.
- Light theme, the real status PATCH, onboarding/tutorial, push, GPS, and the
  full Orders/Urgent/Chat/Profile screens come in Phase 1+.
