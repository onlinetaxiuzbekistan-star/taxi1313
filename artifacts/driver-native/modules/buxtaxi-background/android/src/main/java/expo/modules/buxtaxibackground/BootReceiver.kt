package expo.modules.buxtaxibackground

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Reliability watchdog — restarts the foreground location service after device
 * reboot or an app update, but only if the driver was Online when it last ran.
 * Ported from BootReceiver.java. Handles BOOT_COMPLETED, OEM quick-boot
 * variants (Xiaomi/HTC), and MY_PACKAGE_REPLACED.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val isBoot = action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" ||
            action == "com.htc.intent.action.QUICKBOOT_POWERON"
        val isMyPackage = action == Intent.ACTION_MY_PACKAGE_REPLACED
        if (!isBoot && !isMyPackage) return

        val wasOnline = context
            .getSharedPreferences(LocationForegroundService.PREFS, Context.MODE_PRIVATE)
            .getBoolean(LocationForegroundService.KEY_WAS_ONLINE, false)
        if (!wasOnline) return

        val serviceIntent = Intent(context, LocationForegroundService::class.java)
            .setAction(LocationForegroundService.ACTION_MODE_BALANCED)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (ignored: Exception) {
        }
    }
}
