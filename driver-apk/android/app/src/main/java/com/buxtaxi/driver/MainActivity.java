package com.buxtaxi.driver;

import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "BuxTaxi";
    private static final long MEMORY_CLEAR_INTERVAL = 30 * 60 * 1000L;
    private static final long HEARTBEAT_INTERVAL = 15_000L;
    private static final long FREEZE_DETECT_INTERVAL = 5_000L;
    private static final long FREEZE_THRESHOLD = 4_000L;

    private PowerManager.WakeLock wakeLock;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean isOnline = true;
    private View offlineOverlay;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private long lastInteractionTime = System.currentTimeMillis();
    private long lastJsResponseTime = System.currentTimeMillis();
    private int crashRecoveryCount = 0;
    private boolean isInForeground = true;

    private final Runnable memoryCleaner = new Runnable() {
        @Override
        public void run() {
            long idleMs = System.currentTimeMillis() - lastInteractionTime;
            if (idleMs > MEMORY_CLEAR_INTERVAL) {
                WebView wv = bridge.getWebView();
                if (wv != null) {
                    wv.clearCache(false);
                    logToJs("MEMORY", "Cache cleared after " + (idleMs / 60000) + "min idle");
                }
            }
            checkMemoryPressure();
            mainHandler.postDelayed(this, MEMORY_CLEAR_INTERVAL);
        }
    };

    private final Runnable freezeDetector = new Runnable() {
        @Override
        public void run() {
            if (!isInForeground) {
                mainHandler.postDelayed(this, FREEZE_DETECT_INTERVAL);
                return;
            }
            WebView wv = bridge.getWebView();
            if (wv != null) {
                wv.evaluateJavascript(
                    "(function(){window.__freezeCheck=" + System.currentTimeMillis() + ";return 'ok'})()",
                    value -> {
                        if (value != null && value.contains("ok")) {
                            lastJsResponseTime = System.currentTimeMillis();
                        }
                    }
                );
                long sinceLastResponse = System.currentTimeMillis() - lastJsResponseTime;
                if (sinceLastResponse > FREEZE_THRESHOLD && lastJsResponseTime > 0) {
                    logToJs("FREEZE", "UI frozen for " + sinceLastResponse + "ms, reloading");
                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this, "Обновление...", Toast.LENGTH_SHORT).show();
                        wv.reload();
                        lastJsResponseTime = System.currentTimeMillis();
                    });
                }
            }
            mainHandler.postDelayed(this, FREEZE_DETECT_INTERVAL);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        enableFullscreen();
        enableHardwareAcceleration();
        configureWebView();
        setupNetworkMonitor();
        acquireWakeLock();
        promptBatteryOptimization();

        mainHandler.postDelayed(memoryCleaner, MEMORY_CLEAR_INTERVAL);
        mainHandler.postDelayed(freezeDetector, FREEZE_DETECT_INTERVAL * 2);
    }

    private void enableFullscreen() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#1a1a2e"));
        getWindow().setNavigationBarColor(Color.parseColor("#1a1a2e"));

        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LOW_PROFILE
        );
    }

    private void enableHardwareAcceleration() {
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );
    }

    private void configureWebView() {
        WebView webView = this.bridge.getWebView();
        if (webView == null) return;

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setGeolocationEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);
        settings.setTextZoom(100);

        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Force-clear disk cache on every cold start so old JS chunks don't linger
        try {
            webView.clearCache(true);
            android.webkit.WebStorage.getInstance().deleteAllData();
        } catch (Exception ignored) {}

        // Native exit bridge — JS can call window.AndroidExit.exitApp() to truly close the app
        webView.addJavascriptInterface(new NativeExitInterface(this), "AndroidExit");
        webView.addJavascriptInterface(new NativeBackgroundInterface(this), "AndroidBg");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showErrorOverlay();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                hideErrorOverlay();
                injectBridgeScript(view);
                lastJsResponseTime = System.currentTimeMillis();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                crashRecoveryCount++;
                logToJs("CRASH", "Render process gone, crash #" + crashRecoveryCount +
                    " didCrash=" + detail.didCrash());

                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this,
                        "Перезапуск приложения...", Toast.LENGTH_SHORT).show();
                });

                if (crashRecoveryCount > 5) {
                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this,
                            "Критическая ошибка. Перезапустите приложение.",
                            Toast.LENGTH_LONG).show();
                    });
                    return false;
                }

                mainHandler.postDelayed(() -> {
                    try {
                        WebView wv = bridge.getWebView();
                        if (wv != null) {
                            wv.clearCache(true);
                            wv.clearHistory();
                            wv.reload();
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }, 1000);

                return true;
            }
        });
    }

    private void injectBridgeScript(WebView webView) {
        String js = "javascript:(function(){" +
            "if(window.__buxtaxiNativeBridge) return;" +
            "window.__buxtaxiNativeBridge = true;" +
            "window.__isNativeApp = true;" +
            "window.__appVersion = '1.0.0';" +
            "window.__platform = 'android';" +
            "window.__crashCount = " + crashRecoveryCount + ";" +
            "if(window.__nativeLog) window.__nativeLog('INIT','native inject, crashes='+window.__crashCount);" +
            "})()";
        webView.evaluateJavascript(js, null);
    }

    private void setupNetworkMonitor() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(@NonNull Network network) {
                runOnUiThread(() -> {
                    isOnline = true;
                    hideOfflineOverlay();
                    WebView webView = bridge.getWebView();
                    if (webView != null) {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('buxtaxi:network',{detail:{online:true}}))", null
                        );
                    }
                });
            }

            @Override
            public void onLost(@NonNull Network network) {
                runOnUiThread(() -> {
                    isOnline = false;
                    showOfflineOverlay();
                    WebView webView = bridge.getWebView();
                    if (webView != null) {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('buxtaxi:network',{detail:{online:false}}))", null
                        );
                    }
                });
            }
        };

        NetworkRequest request = new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build();
        cm.registerNetworkCallback(request, networkCallback);
    }

    private void showOfflineOverlay() {
        if (offlineOverlay != null) {
            offlineOverlay.setVisibility(View.VISIBLE);
            return;
        }

        offlineOverlay = new FrameLayout(this);
        offlineOverlay.setBackgroundColor(Color.parseColor("#E61a1a2e"));

        TextView tv = new TextView(this);
        tv.setText("Нет интернета\nОжидание подключения...");
        tv.setTextColor(Color.WHITE);
        tv.setTextSize(18);
        tv.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        lp.gravity = Gravity.CENTER;
        tv.setLayoutParams(lp);

        ((FrameLayout) offlineOverlay).addView(tv);
        addContentView(offlineOverlay, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
    }

    private void hideOfflineOverlay() {
        if (offlineOverlay != null) {
            offlineOverlay.setVisibility(View.GONE);
        }
    }

    private void showErrorOverlay() {
        runOnUiThread(() -> {
            WebView webView = bridge.getWebView();
            if (webView != null) {
                webView.loadData(
                    "<html><body style='background:#1a1a2e;color:white;display:flex;align-items:center;" +
                    "justify-content:center;height:100vh;margin:0;font-family:system-ui;text-align:center'>" +
                    "<div><h2>Сервер недоступен</h2><p style='color:#888'>Проверьте подключение к интернету</p>" +
                    "<button onclick='location.reload()' style='margin-top:20px;padding:14px 40px;" +
                    "background:#f59e0b;color:black;border:none;border-radius:12px;font-size:16px;" +
                    "font-weight:600;cursor:pointer'>Повторить</button></div></body></html>",
                    "text/html", "UTF-8"
                );
            }
        });
    }

    private void hideErrorOverlay() {}

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "BuxTaxi::DriverWakeLock"
            );
        }
    }

    private void promptBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                mainHandler.postDelayed(() -> {
                    try {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                    } catch (Exception e) {
                        try {
                            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                            startActivity(intent);
                        } catch (Exception ignored) {}
                    }
                }, 3000);
            }
        }
    }

    private void checkMemoryPressure() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return;

        ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(memInfo);

        if (memInfo.lowMemory) {
            WebView wv = bridge.getWebView();
            if (wv != null) {
                wv.clearCache(false);
                logToJs("MEMORY", "Low memory detected, cache cleared");
            }
        }
    }

    private void logToJs(String category, String message) {
        WebView wv = bridge.getWebView();
        if (wv != null) {
            String safe = message.replace("'", "\\'").replace("\n", " ");
            runOnUiThread(() -> {
                try {
                    wv.evaluateJavascript(
                        "if(window.__nativeLog) window.__nativeLog('" + category + "','" + safe + "')", null);
                } catch (Exception ignored) {}
            });
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= TRIM_MEMORY_RUNNING_LOW) {
            WebView wv = bridge.getWebView();
            if (wv != null) {
                wv.clearCache(false);
                logToJs("MEMORY", "onTrimMemory level=" + level + ", cache cleared");
            }
        }
        if (level >= TRIM_MEMORY_RUNNING_CRITICAL) {
            logToJs("MEMORY", "CRITICAL memory pressure, reloading WebView");
            WebView wv = bridge.getWebView();
            if (wv != null) {
                wv.clearCache(true);
                wv.reload();
            }
        }
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        WebView wv = bridge.getWebView();
        if (wv != null) {
            wv.clearCache(true);
            logToJs("MEMORY", "onLowMemory triggered, full cache clear");
        }
    }

    public void keepScreenOn(boolean enable) {
        runOnUiThread(() -> {
            if (enable) {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (wakeLock != null && !wakeLock.isHeld()) {
                    wakeLock.acquire(4 * 60 * 60 * 1000L);
                }
            } else {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (wakeLock != null && wakeLock.isHeld()) {
                    wakeLock.release();
                }
            }
        });
    }

    @Override
    public void onUserInteraction() {
        super.onUserInteraction();
        lastInteractionTime = System.currentTimeMillis();
    }

    @Override
    public void onResume() {
        super.onResume();
        isInForeground = true;
        lastJsResponseTime = System.currentTimeMillis();
        lastInteractionTime = System.currentTimeMillis();
        WebView webView = bridge.getWebView();
        if (webView != null) {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('buxtaxi:appState',{detail:{state:'foreground'}}))", null
            );
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        isInForeground = false;
        SharedPreferences prefs = getSharedPreferences("buxtaxi", Context.MODE_PRIVATE);
        prefs.edit().putBoolean("driver_was_online", true).apply();

        WebView webView = bridge.getWebView();
        if (webView != null) {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('buxtaxi:appState',{detail:{state:'background'}}))", null
            );
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(memoryCleaner);
        mainHandler.removeCallbacks(freezeDetector);
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                try { cm.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
            }
        }
        super.onDestroy();
    }
    /** Exposed to JS as window.AndroidExit. Truly closes the app from any back-stack context. */
    public static class NativeExitInterface {
        private final MainActivity activity;
        public NativeExitInterface(MainActivity a) { this.activity = a; }
        @JavascriptInterface
        public void exitApp() {
            activity.runOnUiThread(() -> {
                try { activity.finishAndRemoveTask(); } catch (Exception ignored) {}
                try { android.os.Process.killProcess(android.os.Process.myPid()); } catch (Exception ignored) {}
            });
        }
    }

    /** Exposed to JS as window.AndroidBg. Stores auth token + starts background offer poller. */
    public static class NativeBackgroundInterface {
        private final Context ctx;
        public NativeBackgroundInterface(Context c) { this.ctx = c.getApplicationContext(); }
        @JavascriptInterface
        public void setAuthToken(String token) {
            SharedPreferences prefs = ctx.getSharedPreferences("buxtaxi", Context.MODE_PRIVATE);
            if (token == null || token.isEmpty()) {
                prefs.edit().remove("auth_token").apply();
            } else {
                prefs.edit().putString("auth_token", token).apply();
            }
        }
        @JavascriptInterface
        public void clearAuthToken() {
            SharedPreferences prefs = ctx.getSharedPreferences("buxtaxi", Context.MODE_PRIVATE);
            prefs.edit().remove("auth_token").apply();
        }
        @JavascriptInterface
        public void startBackgroundService() {
            try {
                Intent i = new Intent(ctx, LocationService.class);
                i.setAction(LocationService.ACTION_MODE_BALANCED);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(i);
                } else {
                    ctx.startService(i);
                }
            } catch (Exception ignored) {}
        }
    }
}
