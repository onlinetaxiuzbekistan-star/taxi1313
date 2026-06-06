package uz.buxtaxi.driver;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class LauncherActivity extends Activity {

    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int PERMISSION_REQUEST = 1002;
    private static final String CHANNEL_ID = "buxtaxi_driver";

    private WebView webView;
    private FrameLayout splashView;
    private ValueCallback<Uri[]> fileUploadCallback;
    private String serverBaseUrl;
    private String serverHost;
    private String launchUrl;
    private long lastBackPress = 0;
    private boolean splashDismissed = false;
    private ConnectivityManager.NetworkCallback networkCallback;
    private PowerManager.WakeLock wakeLock;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Allocate (don't acquire) here; acquire is done in onResume so the
        // lock follows the visible-activity lifecycle and is released in
        // onPause. Prevents a never-released wakelock if onDestroy is skipped.
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "Taxi1313:DriverWakeLock"
                );
            }
        } catch (Exception ignored) {}

        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#09090b"));
        window.setNavigationBarColor(Color.parseColor("#09090b"));
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        );

        launchUrl = getString(R.string.launch_url);
        int serverPort = 80;
        try {
            Uri uri = Uri.parse(launchUrl);
            serverBaseUrl = uri.getScheme() + "://" + uri.getHost();
            if (uri.getPort() > 0) {
                serverBaseUrl += ":" + uri.getPort();
                serverPort = uri.getPort();
            }
            serverHost = uri.getHost();
        } catch (Exception e) {
            serverBaseUrl = "https://localhost";
            serverHost = "localhost";
        }

        // fallback to LAN IP removed - drivers connect via mobile internet to public server only
        createNotificationChannel();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#09090b"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#09090b"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        splashView = createSplashView();
        root.addView(splashView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setGeolocationEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(settings.getUserAgentString() + " Taxi1313Driver/1.0 Android-Native");
        settings.setTextZoom(100);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new NativeBridge(), "__buxtaxiNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();

                if (host == null || !host.equals(serverHost)) {
                    return null;
                }

                String path = uri.getPath();
                if (path == null) path = "/";

                if (path.startsWith("/api/") || path.equals("/api")
                        || path.startsWith("/uploads/") || path.startsWith("/socket.io/")) {
                    return null;
                }

                if (isLocalAssetPath(path)) {
                    String assetPath = "www" + path;
                    try {
                        InputStream is = getAssets().open(assetPath);
                        String mimeType = getMimeType(path);
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        headers.put("Cache-Control", "public, max-age=31536000, immutable");
                        return new WebResourceResponse(mimeType, "UTF-8", 200, "OK", headers, is);
                    } catch (IOException e) {
                        return null;
                    }
                }

                if (isSpaRoute(path)) {
                    return serveAsset("www/index.html", "text/html");
                }

                return null;
            }

            private boolean isLocalAssetPath(String path) {
                return path.startsWith("/assets/")
                    || path.equals("/sw.js")
                    || path.equals("/manifest.json")
                    || path.equals("/favicon.svg")
                    || path.equals("/favicon.ico")
                    || path.startsWith("/images/")
                    || path.equals("/opengraph.jpg")
                    || path.equals("/plate-bg.png")
                    || path.endsWith(".js")
                    || path.endsWith(".css")
                    || path.endsWith(".woff2")
                    || path.endsWith(".woff")
                    || path.endsWith(".ttf")
                    || path.endsWith(".png")
                    || path.endsWith(".jpg")
                    || path.endsWith(".jpeg")
                    || path.endsWith(".svg")
                    || path.endsWith(".ico")
                    || path.endsWith(".webp")
                    || path.endsWith(".gif");
            }

            private boolean isSpaRoute(String path) {
                return path.equals("/")
                    || path.equals("/driver")
                    || path.startsWith("/driver/")
                    || path.equals("/dispatcher")
                    || path.startsWith("/dispatcher/")
                    || path.equals("/login")
                    || path.startsWith("/login/");
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("tel:")) {
                    startActivity(new Intent(Intent.ACTION_DIAL, request.getUrl()));
                    return true;
                }
                if (url.startsWith("mailto:") || url.startsWith("geo:") || url.startsWith("intent:")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                    } catch (Exception ignored) {}
                    return true;
                }
                if (url.startsWith("yandexnavi://") || url.startsWith("google.navigation:") || url.startsWith("dgis://")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                    } catch (Exception ignored) {}
                    return true;
                }
                String host = request.getUrl().getHost();
                if (host != null && host.equals(serverHost)) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                dismissSplash();
                view.evaluateJavascript(
                    "window.__BUXTAXI_NATIVE__ = true;" +
                    "window.__BUXTAXI_SERVER__ = '" + serverBaseUrl + "';" +
                    "window.__BUXTAXI_VERSION__ = '1.0';" +
                    "if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(sw){sw.unregister()})}).catch(function(){});}",
                    null
                );
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // SECURITY: never proceed past an invalid TLS certificate — doing so
                // would allow a man-in-the-middle to intercept all driver traffic.
                // Cancel the connection and show the offline/error page instead.
                handler.cancel();
                runOnUiThread(() -> showSslErrorPage(view));
                dismissSplash();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    WebResourceResponse fallback = serveAsset("www/index.html", "text/html");
                    if (fallback != null) {
                        view.loadDataWithBaseURL(
                            launchUrl,
                            readStreamAsString(fallback.getData()),
                            "text/html",
                            "UTF-8",
                            null
                        );
                    } else {
                        showErrorPage(view);
                    }
                    dismissSplash();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, true);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
                return true;
            }
        });

        requestPermissions();
        registerNetworkCallback();

        webView.evaluateJavascript(
            "if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(sw){sw.unregister()})}).catch(function(){});}",
            null
        );

        webView.loadUrl(launchUrl);
    }

    private FrameLayout createSplashView() {
        FrameLayout splash = new FrameLayout(this);
        splash.setBackgroundColor(Color.parseColor("#09090b"));
        splash.setClickable(true);

        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER);

        ImageView logoImage = new ImageView(this);
        int logoSize = dpToPx(120);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(logoSize, logoSize);
        logoParams.gravity = Gravity.CENTER;
        logoImage.setLayoutParams(logoParams);
        logoImage.setScaleType(ImageView.ScaleType.FIT_CENTER);
        try {
            InputStream logoStream = getAssets().open("www/logo-1313.png");
            Bitmap logoBitmap = android.graphics.BitmapFactory.decodeStream(logoStream);
            logoImage.setImageBitmap(logoBitmap);
            logoStream.close();
        } catch (IOException e) {
            logoImage.setImageResource(android.R.drawable.sym_def_app_icon);
        }

        TextView appName = new TextView(this);
        appName.setText("\u0422\u0430\u043a\u0441\u0438 1313");
        appName.setTextColor(Color.WHITE);
        appName.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        appName.setTypeface(null, Typeface.BOLD);
        appName.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        nameParams.topMargin = dpToPx(16);
        nameParams.gravity = Gravity.CENTER;
        appName.setLayoutParams(nameParams);

        TextView subtitle = new TextView(this);
        subtitle.setText("\u041c\u0435\u0436\u0433\u043e\u0440\u043e\u0434");
        subtitle.setTextColor(Color.parseColor("#71717a"));
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        subParams.topMargin = dpToPx(8);
        subtitle.setLayoutParams(subParams);

        ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        LinearLayout.LayoutParams spinParams = new LinearLayout.LayoutParams(dpToPx(32), dpToPx(32));
        spinParams.topMargin = dpToPx(40);
        spinParams.gravity = Gravity.CENTER;
        spinner.setLayoutParams(spinParams);

        center.addView(logoImage);
        center.addView(appName);
        center.addView(subtitle);
        center.addView(spinner);

        FrameLayout.LayoutParams centerParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        centerParams.gravity = Gravity.CENTER;
        splash.addView(center, centerParams);

        TextView version = new TextView(this);
        version.setText("v1.0");
        version.setTextColor(Color.parseColor("#52525b"));
        version.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        version.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams vParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        vParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        vParams.bottomMargin = dpToPx(32);
        splash.addView(version, vParams);

        return splash;
    }

    private void dismissSplash() {
        if (splashDismissed || splashView == null) return;
        splashDismissed = true;

        AlphaAnimation fadeOut = new AlphaAnimation(1.0f, 0.0f);
        fadeOut.setDuration(400);
        fadeOut.setFillAfter(true);
        fadeOut.setAnimationListener(new Animation.AnimationListener() {
            @Override public void onAnimationStart(Animation a) {}
            @Override public void onAnimationRepeat(Animation a) {}
            @Override
            public void onAnimationEnd(Animation a) {
                if (splashView != null && splashView.getParent() != null) {
                    ((FrameLayout) splashView.getParent()).removeView(splashView);
                    splashView = null;
                }
            }
        });
        splashView.startAnimation(fadeOut);
    }

    private void showErrorPage(WebView view) {
        view.loadData(
            "<html><body style='background:#09090b;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>" +
            "<div style='text-align:center;padding:24px'>" +
            "<div style='width:64px;height:64px;border-radius:16px;background:#27272a;margin:0 auto 20px;display:flex;align-items:center;justify-content:center'>" +
            "<svg width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='#71717a' stroke-width='2'><path d='M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a16 16 0 014.78-2.81M8.53 16.11a6 6 0 016.95 0M12 20h.01'/></svg></div>" +
            "<h2 style='font-size:20px;margin:0 0 8px'>\u041d\u0435\u0442 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f</h2>" +
            "<p style='color:#71717a;margin:0 0 24px'>\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442-\u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435</p>" +
            "<button onclick='location.reload()' style='background:#F59E0B;border:none;color:#09090b;padding:14px 40px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer'>\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c</button></div></body></html>",
            "text/html", "UTF-8"
        );
    }

    private void showSslErrorPage(WebView view) {
        // Distinct from the generic offline page: a TLS failure is a security
        // condition (bad/expired cert or active MITM), not just "no internet".
        view.loadDataWithBaseURL(
            null,
            "<html><body style='background:#09090b;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>" +
            "<div style='text-align:center;padding:24px;max-width:340px'>" +
            "<div style='width:64px;height:64px;border-radius:16px;background:#7f1d1d;margin:0 auto 20px;display:flex;align-items:center;justify-content:center'>" +
            "<svg width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='#fca5a5' stroke-width='2'><path d='M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'/></svg></div>" +
            "<h2 style='font-size:20px;margin:0 0 8px'>Небезопасное соединение</h2>" +
            "<p style='color:#a1a1aa;margin:0 0 24px;line-height:1.5'>Не удалось проверить безопасность сервера. Подключение заблокировано для вашей защиты. Проверьте сеть или обратитесь к диспетчеру.</p>" +
            "<button onclick='location.href=\"" + launchUrl + "\"' style='background:#F59E0B;border:none;color:#09090b;padding:14px 40px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer'>Повторить</button></div></body></html>",
            "text/html", "UTF-8", null
        );
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "\u0422\u0430\u043a\u0441\u0438 1313",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f \u043e \u043d\u043e\u0432\u044b\u0445 \u0437\u0430\u043a\u0430\u0437\u0430\u0445");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 300, 200, 300});
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private void registerNetworkCallback() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        {
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    runOnUiThread(() -> {
                        if (webView != null) {
                            webView.evaluateJavascript(
                                "if(window.dispatchEvent) window.dispatchEvent(new Event('online'));", null);
                        }
                    });
                }
                @Override
                public void onLost(Network network) {
                    runOnUiThread(() -> {
                        if (webView != null) {
                            webView.evaluateJavascript(
                                "if(window.dispatchEvent) window.dispatchEvent(new Event('offline'));", null);
                        }
                    });
                }
            };
            cm.registerNetworkCallback(
                new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                networkCallback
            );
        }
    }

    private WebResourceResponse serveAsset(String assetPath, String mimeType) {
        try {
            InputStream is = getAssets().open(assetPath);
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mimeType, "UTF-8", 200, "OK", headers, is);
        } catch (IOException e) {
            return null;
        }
    }

    private String readStreamAsString(InputStream is) {
        try {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            is.close();
            return bos.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    private String getMimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".gif")) return "image/gif";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".ttf")) return "font/ttf";
        if (path.endsWith(".ico")) return "image/x-icon";
        if (path.endsWith(".webmanifest") || path.endsWith(".manifest")) return "application/manifest+json";
        return "application/octet-stream";
    }

    private int dpToPx(int dp) {
        return (int) TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, dp, getResources().getDisplayMetrics());
    }

    private void requestPermissions() {
        String[] perms = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
        };
        boolean needRequest = false;
        for (String p : perms) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                needRequest = true;
                break;
            }
        }
        if (needRequest) {
            requestPermissions(perms, PERMISSION_REQUEST);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST + 1);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileUploadCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    String dataString = data.getDataString();
                    if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    }
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            long now = System.currentTimeMillis();
            if (now - lastBackPress < 2000) {
                super.onBackPressed();
            } else {
                lastBackPress = now;
                Toast.makeText(this, "\u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437 \u0434\u043b\u044f \u0432\u044b\u0445\u043e\u0434\u0430", Toast.LENGTH_SHORT).show();
            }
        }
    }

    // Wakelock cap: bounded so the OS will reclaim if onPause is somehow skipped
    // (we still release in onPause normally; this is a safety net, see lint W2).
    private static final long WAKELOCK_TIMEOUT_MS = 10L * 60 * 1000; // 10 minutes

    @Override
    protected void onResume() {
        super.onResume();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try {
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(WAKELOCK_TIMEOUT_MS);
            }
        } catch (Exception ignored) {}
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript(
                "if(window.dispatchEvent) window.dispatchEvent(new CustomEvent('nativeResume'));", null);
        }
    }

    @Override
    protected void onPause() {
        // Release the wakelock here, NOT in onDestroy: backgrounded activities
        // may have onDestroy skipped, and lint flags that pattern (Wakelock).
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {}
        if (webView != null) {
            webView.evaluateJavascript(
                "if(window.dispatchEvent) window.dispatchEvent(new CustomEvent('nativePause'));", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                try { cm.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
            }
        }
        // wakelock was released in onPause; nothing more to do here.
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    public class NativeBridge {
        @android.webkit.JavascriptInterface
        public String getServerUrl() {
            return serverBaseUrl;
        }

        @android.webkit.JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @android.webkit.JavascriptInterface
        public String getAppVersion() {
            return "1.0.0";
        }

        @android.webkit.JavascriptInterface
        public String getPlatform() {
            return "android";
        }

        @android.webkit.JavascriptInterface
        public int getAndroidApiLevel() {
            return Build.VERSION.SDK_INT;
        }

        @android.webkit.JavascriptInterface
        public void keepScreenOn(boolean on) {
            runOnUiThread(() -> {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @android.webkit.JavascriptInterface
        public void vibrate(int ms) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(ms);
            }
        }

        @android.webkit.JavascriptInterface
        public void vibratePattern(String patternJson) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null) return;
                String[] parts = patternJson.replace("[","").replace("]","").split(",");
                long[] pattern = new long[parts.length];
                for (int i = 0; i < parts.length; i++) {
                    pattern[i] = Long.parseLong(parts[i].trim());
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, -1));
                } else {
                    v.vibrate(pattern, -1);
                }
            } catch (Exception ignored) {}
        }

        @android.webkit.JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> Toast.makeText(LauncherActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @android.webkit.JavascriptInterface
        public void copyToClipboard(String text) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("Taxi1313", text));
            }
        }

        @android.webkit.JavascriptInterface
        public int getBatteryLevel() {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            if (bm != null) {
                return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            }
            return -1;
        }

        @android.webkit.JavascriptInterface
        public boolean isGpsEnabled() {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            return lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        }

        @android.webkit.JavascriptInterface
        public void openGpsSettings() {
            try {
                startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
            } catch (Exception ignored) {}
        }

        @android.webkit.JavascriptInterface
        public void openAppSettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (Exception ignored) {}
        }

        @android.webkit.JavascriptInterface
        public boolean isNetworkAvailable() {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            Network net = cm.getActiveNetwork();
            if (net == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(net);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        }

        @android.webkit.JavascriptInterface
        public void makeCall(String phone) {
            try {
                startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone)));
            } catch (Exception ignored) {}
        }

        @android.webkit.JavascriptInterface
        public void openNavigation(double lat, double lng) {
            try {
                Uri gmmUri = Uri.parse("google.navigation:q=" + lat + "," + lng + "&mode=d");
                Intent mapIntent = new Intent(Intent.ACTION_VIEW, gmmUri);
                mapIntent.setPackage("com.google.android.apps.maps");
                if (mapIntent.resolveActivity(getPackageManager()) != null) {
                    startActivity(mapIntent);
                } else {
                    Uri yandexUri = Uri.parse("yandexnavi://build_route_on_map?lat_to=" + lat + "&lon_to=" + lng);
                    Intent yIntent = new Intent(Intent.ACTION_VIEW, yandexUri);
                    if (yIntent.resolveActivity(getPackageManager()) != null) {
                        startActivity(yIntent);
                    } else {
                        startActivity(new Intent(Intent.ACTION_VIEW,
                            Uri.parse("geo:" + lat + "," + lng + "?q=" + lat + "," + lng)));
                    }
                }
            } catch (Exception ignored) {}
        }

        @android.webkit.JavascriptInterface
        public void shareText(String text) {
            try {
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType("text/plain");
                share.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(share, "\u041f\u043e\u0434\u0435\u043b\u0438\u0442\u044c\u0441\u044f"));
            } catch (Exception ignored) {}
        }


        @android.webkit.JavascriptInterface
        public boolean hasLocationPermission() {
            return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }

        @android.webkit.JavascriptInterface
        public boolean hasCameraPermission() {
            return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        }

        @android.webkit.JavascriptInterface
        public boolean hasMicrophonePermission() {
            return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        }

        @android.webkit.JavascriptInterface
        public boolean hasNotificationPermission() {
            if (Build.VERSION.SDK_INT >= 33) {
                return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            }
            return true;
        }

        @android.webkit.JavascriptInterface
        public void requestAllPermissions() {
            requestPermissions();
        }

        @android.webkit.JavascriptInterface
        public String getInstalledPackages() {
            try {
                List<android.content.pm.ApplicationInfo> apps =
                    getPackageManager().getInstalledApplications(PackageManager.GET_META_DATA);
                StringBuilder sb = new StringBuilder("[");
                for (int i = 0; i < apps.size(); i++) {
                    if (i > 0) sb.append(",");
                    sb.append("\"").append(apps.get(i).packageName).append("\"");
                }
                sb.append("]");
                return sb.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @android.webkit.JavascriptInterface
        public boolean isPackageInstalled(String packageName) {
            try {
                getPackageManager().getPackageInfo(packageName, 0);
                return true;
            } catch (PackageManager.NameNotFoundException e) {
                return false;
            }
        }

        @android.webkit.JavascriptInterface
        public void setStatusBarColor(String color) {
            runOnUiThread(() -> {
                try {
                    getWindow().setStatusBarColor(Color.parseColor(color));
                } catch (Exception ignored) {}
            });
        }

        @android.webkit.JavascriptInterface
        public void setNavigationBarColor(String color) {
            runOnUiThread(() -> {
                try {
                    getWindow().setNavigationBarColor(Color.parseColor(color));
                } catch (Exception ignored) {}
            });
        }
    }
}
