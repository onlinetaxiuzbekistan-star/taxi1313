# BuxTaxi Driver — R8 keep rules.
#
# The app is a thin native shell around a WebView. The web client reaches into
# native code through a `@JavascriptInterface`-annotated bridge, and R8 can't
# see those call sites (they originate from JavaScript at runtime), so the bridge
# class and every annotated method MUST be kept verbatim — otherwise the web
# side calls a renamed/removed method and crashes.

# 1) The JS bridge inner class itself — keep the class and ALL of its members
#    so reflection-style invocation from JS keeps working.
-keep public class uz.buxtaxi.driver.LauncherActivity$NativeBridge {
    public *;
}

# 2) Every @JavascriptInterface method anywhere in the app (defence-in-depth in
#    case the bridge is ever split out).
-keepclasseswithmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 3) WebView client/chrome callbacks invoked from native code by name.
-keepclassmembers class * extends android.webkit.WebViewClient {
    public void onPageStarted(android.webkit.WebView, java.lang.String, android.graphics.Bitmap);
    public void onPageFinished(android.webkit.WebView, java.lang.String);
    public boolean shouldOverrideUrlLoading(android.webkit.WebView, android.webkit.WebResourceRequest);
    public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebView, android.webkit.WebResourceRequest);
    public void onReceivedSslError(android.webkit.WebView, android.webkit.SslErrorHandler, android.net.http.SslError);
    public void onReceivedError(android.webkit.WebView, android.webkit.WebResourceRequest, android.webkit.WebResourceError);
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public *;
}

# 4) Standard Android entry points (manifest references) — Activity is already
#    kept by the default rules, but be explicit about the launcher.
-keep class uz.buxtaxi.driver.LauncherActivity { *; }

# 5) Drop verbose stack traces from minified code — keep line numbers but rename
#    source-file attribute to prevent leaking the original file names.
-renamesourcefileattribute SourceFile
-keepattributes SourceFile,LineNumberTable
