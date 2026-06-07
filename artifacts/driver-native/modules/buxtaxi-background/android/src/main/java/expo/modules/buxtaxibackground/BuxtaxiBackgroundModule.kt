package expo.modules.buxtaxibackground

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing API for the background driver capabilities.
 *
 *   startService(token, apiBase, highAccuracy)  – start foreground GPS + offer poll
 *   stopService()                               – stop everything (Offline)
 *   setHighAccuracy(high)                        – switch GPS cadence (on-ride)
 *   setAuthToken(token)                          – update token used by the poller
 *   isIgnoringBatteryOptimizations()             – check battery-opt exemption
 *   requestBatteryOptimizationExemption()        – open the system prompt
 *
 * Emits `onLocation` events ({lat,lng,speed,accuracy,bearing,time}) by relaying
 * the service's LOCATION_UPDATE broadcasts to JS, which forwards them over the WS.
 */
class BuxtaxiBackgroundModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

  private var locationReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("BuxtaxiBackground")

    Events("onLocation")

    Function("isIgnoringBatteryOptimizations") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function true
      val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return@Function true
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("requestBatteryOptimizationExemption") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val alreadyExempt = pm?.isIgnoringBatteryOptimizations(context.packageName) == true
        if (!alreadyExempt) {
          val activity = appContext.currentActivity
          try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
              .setData(Uri.parse("package:${context.packageName}"))
            if (activity != null) {
              activity.startActivity(intent)
            } else {
              intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              context.startActivity(intent)
            }
          } catch (e: Exception) {
            try {
              val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              context.startActivity(fallback)
            } catch (ignored: Exception) {}
          }
        }
      }
    }

    Function("setAuthToken") { token: String? ->
      val prefs = context.getSharedPreferences(LocationForegroundService.PREFS, Context.MODE_PRIVATE)
      if (token.isNullOrEmpty()) prefs.edit().remove(LocationForegroundService.KEY_TOKEN).apply()
      else prefs.edit().putString(LocationForegroundService.KEY_TOKEN, token).apply()
    }

    Function("startService") { token: String, apiBase: String, highAccuracy: Boolean ->
      context.getSharedPreferences(LocationForegroundService.PREFS, Context.MODE_PRIVATE).edit()
        .putString(LocationForegroundService.KEY_TOKEN, token)
        .putString(LocationForegroundService.KEY_API_BASE, apiBase)
        .putBoolean(LocationForegroundService.KEY_WAS_ONLINE, true)
        .apply()
      val action = if (highAccuracy) LocationForegroundService.ACTION_MODE_HIGH
        else LocationForegroundService.ACTION_MODE_BALANCED
      val intent = Intent(context, LocationForegroundService::class.java).setAction(action)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }

    Function("setHighAccuracy") { high: Boolean ->
      val action = if (high) LocationForegroundService.ACTION_MODE_HIGH
        else LocationForegroundService.ACTION_MODE_BALANCED
      val intent = Intent(context, LocationForegroundService::class.java).setAction(action)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }

    Function("stopService") {
      // Clear the online flag first so the boot/onTaskRemoved watchdogs won't restart it.
      context.getSharedPreferences(LocationForegroundService.PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean(LocationForegroundService.KEY_WAS_ONLINE, false).apply()
      val stop = Intent(context, LocationForegroundService::class.java)
        .setAction(LocationForegroundService.ACTION_STOP)
      try {
        context.startService(stop)
      } catch (e: Exception) {
        try { context.stopService(Intent(context, LocationForegroundService::class.java)) } catch (ignored: Exception) {}
      }
    }

    OnStartObserving { registerLocationReceiver() }
    OnStopObserving { unregisterLocationReceiver() }
    OnDestroy { unregisterLocationReceiver() }
  }

  private fun registerLocationReceiver() {
    if (locationReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context?, intent: Intent?) {
        if (intent == null) return
        sendEvent(
          "onLocation",
          mapOf(
            "lat" to intent.getDoubleExtra("lat", 0.0),
            "lng" to intent.getDoubleExtra("lng", 0.0),
            "speed" to intent.getFloatExtra("speed", 0f).toDouble(),
            "accuracy" to intent.getFloatExtra("accuracy", 0f).toDouble(),
            "bearing" to intent.getFloatExtra("bearing", 0f).toDouble(),
            "time" to intent.getLongExtra("time", 0L).toDouble()
          )
        )
      }
    }
    locationReceiver = receiver
    val filter = IntentFilter(LocationForegroundService.locationBroadcastAction(context.packageName))
    ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
  }

  private fun unregisterLocationReceiver() {
    locationReceiver?.let {
      try { context.unregisterReceiver(it) } catch (ignored: Exception) {}
    }
    locationReceiver = null
  }
}
