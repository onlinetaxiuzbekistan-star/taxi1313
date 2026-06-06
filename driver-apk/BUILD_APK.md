# BuxTaxi Driver — Production Android APK

## Architecture

WebView app that loads the driver panel from the live server. Native plugins handle camera, GPS, notifications, and background services.

## Native Features

| Feature | Implementation |
|---------|---------------|
| Offline detection | ConnectivityManager + overlay UI |
| WebSocket reconnect | JS bridge with exponential backoff 2s→30s |
| Keep screen on | FLAG_KEEP_SCREEN_ON + WakeLock |
| Background location | LocationService (foreground service) |
| Push notifications | FCM + OrderNotificationService |
| Order alerts | Sound + vibration (3x pattern) + full-screen intent |
| Fullscreen mode | Immersive UI, no browser chrome |
| Camera in WebView | Full file access + content access enabled |
| Splash screen | Branded loading with server health check |
| Error handling | Offline overlay + server unavailable screen |
| Auto-login | Token stored in localStorage (persisted in WebView) |
| Boot restart | BootReceiver resumes location if driver was online |
| Hardware accel | Enabled at window + WebView layer level |

## 11 Capacitor Plugins

- `@capacitor/app` — App lifecycle
- `@capacitor/camera` — Photo capture
- `@capacitor/geolocation` — GPS coordinates
- `@capacitor/haptics` — Vibration feedback
- `@capacitor/keyboard` — Keyboard handling
- `@capacitor/local-notifications` — Local alerts
- `@capacitor/network` — Online/offline status
- `@capacitor/preferences` — Key-value storage
- `@capacitor/push-notifications` — Firebase push
- `@capacitor/splash-screen` — Launch screen
- `@capacitor/status-bar` — Status bar control

## 19 Android Permissions

Camera, fine/coarse/background location, internet, network state, vibrate, wake lock, boot completed, notifications, storage, foreground service (location), battery optimization bypass, exact alarm, full-screen intent.

## Build Steps

### Prerequisites

- Android Studio (latest)
- JDK 17+
- Android SDK API 34+

### 1. Download

Copy the entire `driver-apk` folder to your machine.

### 2. Open Project

In Android Studio: `File → Open → driver-apk/android`

Wait for Gradle sync to finish.

### 3. Build Debug APK

```
Build → Build Bundle(s) / APK(s) → Build APK(s)
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### 4. Build Release APK

Generate keystore:
```bash
keytool -genkey -v -keystore buxtaxi-driver.keystore \
  -alias buxtaxi -keyalg RSA -keysize 2048 -validity 10000
```

In Android Studio:
```
Build → Generate Signed Bundle / APK → APK → Select keystore → Release
```

### 5. Install

```bash
adb install -r app-release.apk
```

Or transfer to phone and install.

## Server URL

Configured in `capacitor.config.ts` → `server.url`.
After changing, run: `npx cap sync android`

## Production Checklist

- [ ] Replace server URL with production domain
- [ ] Set `webContentsDebuggingEnabled: false` (already done)
- [ ] Add `google-services.json` for FCM push notifications
- [ ] Create app icon (replace mipmap resources)
- [ ] Set proper `versionCode` / `versionName` for Google Play
- [ ] Sign with release keystore
- [ ] Test on minimum Android version (API 22)
