# Capacitor WebView
-keep class com.getcapacitor.** { *; }
-keep class com.buxtaxi.driver.** { *; }
-dontwarn com.getcapacitor.**

# Keep JavaScript interface classes
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Google Play Services
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# AndroidX
-keep class androidx.** { *; }
-dontwarn androidx.**

# Keep source file names for debugging
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
