package expo.modules.buxtaxibackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat

/**
 * High-priority "new order" local notifications. Ported from the proven
 * OrderNotificationService.java in the existing Capacitor APK: full-screen
 * intent, ringtone, vibration, dedup, bypass-DnD channel. Raised by the
 * foreground service's offer poller so drivers are alerted even when the app
 * is minimized / screen-off.
 */
object OrderNotifications {
    private const val CHANNEL_ID = "buxtaxi_orders"
    private const val BASE_ID = 2001
    private const val MAX_RETRY = 3
    private var counter = 0
    private val recentOrderIds = HashSet<String>()
    private val VIBRATION = longArrayOf(0, 500, 200, 500, 200, 500)

    fun show(context: Context, orderId: String?, from: String, to: String, price: String) {
        if (!orderId.isNullOrEmpty()) {
            synchronized(recentOrderIds) {
                if (recentOrderIds.contains(orderId)) return
                recentOrderIds.add(orderId)
                if (recentOrderIds.size > 100) recentOrderIds.clear()
            }
        }

        createChannel(context)

        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            putExtra("order_id", orderId)
            putExtra("navigate", "incoming")
        }
        val pi = PendingIntent.getActivity(
            context, counter, launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val body = buildString {
            append("$from → $to")
            if (price.isNotEmpty()) append(" | $price")
        }
        val notifId = BASE_ID + (counter % 10)
        counter++

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Новый заказ!")
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .setDefaults(Notification.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setVibrate(VIBRATION)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))

        showWithRetry(context, notifId, builder.build(), 0)
        vibrate(context)
    }

    private fun showWithRetry(context: Context, notifId: Int, notification: Notification, attempt: Int) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        try {
            nm.notify(notifId, notification)
        } catch (e: Exception) {
            if (attempt < MAX_RETRY) {
                try { Thread.sleep(500) } catch (ignored: InterruptedException) {}
                showWithRetry(context, notifId, notification, attempt + 1)
            }
        }
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Новые заказы", NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Уведомления о новых заказах"
                enableVibration(true)
                vibrationPattern = VIBRATION
                enableLights(true)
                lightColor = 0xFF1FBAD6.toInt()
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setBypassDnd(true)
                val audioAttr = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audioAttr)
            }
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    private fun vibrate(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vm?.defaultVibrator?.vibrate(VibrationEffect.createWaveform(VIBRATION, -1))
        } else {
            @Suppress("DEPRECATION")
            val v = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v?.vibrate(VibrationEffect.createWaveform(VIBRATION, -1))
            } else {
                @Suppress("DEPRECATION")
                v?.vibrate(VIBRATION, -1)
            }
        }
    }
}
