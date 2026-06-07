package expo.modules.buxtaxibackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Foreground location service — ported from the proven LocationService.java in
 * the existing Capacitor APK. Responsibilities:
 *   - FusedLocationProvider updates (balanced ⇄ high accuracy), broadcast to the
 *     JS layer (LOCATION_UPDATE) which forwards them over the existing WebSocket.
 *   - "BuxTaxi — На линии" persistent notification (foreground service type
 *     location). Starts on Online, stops on Offline (ACTION_STOP).
 *   - 7s poll of {apiBase}/api/drivers/pending-offers → high-priority local
 *     "new order" notifications, so drivers are alerted when minimized/screen-off.
 *   - Location watchdog (restart provider if stale) + onTaskRemoved restart.
 */
class LocationForegroundService : Service() {

    companion object {
        const val ACTION_MODE_HIGH = "expo.modules.buxtaxibackground.LOCATION_HIGH"
        const val ACTION_MODE_BALANCED = "expo.modules.buxtaxibackground.LOCATION_BALANCED"
        const val ACTION_STOP = "expo.modules.buxtaxibackground.LOCATION_STOP"
        const val PREFS = "buxtaxi"
        const val KEY_TOKEN = "auth_token"
        const val KEY_API_BASE = "api_base"
        const val KEY_WAS_ONLINE = "driver_was_online"
        const val DEFAULT_API_BASE = "https://nil.taxi1313.ru"

        private const val TAG = "BuxTaxiBg"
        private const val CHANNEL_ID = "buxtaxi_location"
        private const val NOTIFICATION_ID = 1001
        private const val OFFER_POLL_INTERVAL_MS = 7_000L

        fun locationBroadcastAction(packageName: String) = "$packageName.LOCATION_UPDATE"
    }

    private var fusedClient: FusedLocationProviderClient? = null
    private var locationCallback: LocationCallback? = null
    private val handler = Handler(Looper.getMainLooper())
    private var offerExec: ExecutorService? = null
    private val seenOfferIds = HashSet<String>()

    private var isHighAccuracy = false
    private var lastLocationTime = 0L
    private var locationFailures = 0

    private val locationWatchdog = object : Runnable {
        override fun run() {
            val sinceLastLoc = System.currentTimeMillis() - lastLocationTime
            if (lastLocationTime > 0 && sinceLastLoc > 120_000) {
                locationFailures++
                if (locationFailures >= 3) {
                    stopLocationUpdates()
                    startLocationUpdates(isHighAccuracy)
                    locationFailures = 0
                }
            }
            handler.postDelayed(this, 60_000)
        }
    }

    private val offerPoller = object : Runnable {
        override fun run() {
            pollOffers()
            handler.postDelayed(this, OFFER_POLL_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        offerExec = Executors.newSingleThreadExecutor()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            saveOnlineState(false)
            stopLocationUpdates()
            handler.removeCallbacks(offerPoller)
            handler.removeCallbacks(locationWatchdog)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val highAccuracy = intent?.action == ACTION_MODE_HIGH
        Log.i(TAG, "onStartCommand action=${intent?.action} highAccuracy=$highAccuracy")
        val notification = buildNotification(highAccuracy)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            Log.i(TAG, "foreground service started (notification shown)")
        } catch (e: Exception) {
            // e.g. ForegroundServiceStartNotAllowedException / SecurityException if
            // location permission wasn't granted before starting a type=location FGS.
            Log.e(TAG, "startForeground FAILED: ${e.javaClass.simpleName}: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }

        stopLocationUpdates()
        startLocationUpdates(highAccuracy)
        saveOnlineState(true)

        handler.removeCallbacks(locationWatchdog)
        handler.postDelayed(locationWatchdog, 60_000)
        handler.removeCallbacks(offerPoller)
        handler.post(offerPoller)

        return START_STICKY
    }

    private fun startLocationUpdates(highAccuracy: Boolean) {
        isHighAccuracy = highAccuracy

        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasBg = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        Log.i(TAG, "startLocationUpdates fine=$hasFine background=$hasBg highAccuracy=$highAccuracy")
        if (!hasFine) {
            Log.w(TAG, "ACCESS_FINE_LOCATION not granted — no location updates will be delivered")
        }
        if (!hasBg) {
            Log.w(TAG, "ACCESS_BACKGROUND_LOCATION not granted — updates may stop when screen off / app backgrounded")
        }

        val priority = if (highAccuracy) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        val interval = if (highAccuracy) 10_000L else 30_000L
        val fastest = if (highAccuracy) 5_000L else 15_000L
        val minDist = if (highAccuracy) 10f else 50f

        val request = LocationRequest.Builder(priority, interval)
            .setMinUpdateIntervalMillis(fastest)
            .setMinUpdateDistanceMeters(minDist)
            .build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc: Location = result.lastLocation ?: return
                lastLocationTime = System.currentTimeMillis()
                locationFailures = 0

                val broadcast = Intent(locationBroadcastAction(packageName)).apply {
                    setPackage(packageName)
                    putExtra("lat", loc.latitude)
                    putExtra("lng", loc.longitude)
                    putExtra("speed", loc.speed)
                    putExtra("accuracy", loc.accuracy)
                    putExtra("bearing", loc.bearing)
                    putExtra("time", loc.time)
                }
                sendBroadcast(broadcast)
            }
        }
        locationCallback = callback

        try {
            fusedClient?.requestLocationUpdates(request, callback, Looper.getMainLooper())
            Log.i(TAG, "requestLocationUpdates OK")
        } catch (e: SecurityException) {
            Log.e(TAG, "requestLocationUpdates SecurityException: ${e.message}")
        }
    }

    private fun stopLocationUpdates() {
        locationCallback?.let { fusedClient?.removeLocationUpdates(it) }
        locationCallback = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Отслеживание местоположения", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Работа в режиме водителя"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(highAccuracy: Boolean): Notification {
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, LocationForegroundService::class.java).setAction(ACTION_STOP)
        val stopPi = PendingIntent.getService(
            this, 1, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val subtitle = if (highAccuracy) "На заказе — точное отслеживание" else "Ожидание заказа"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("BuxTaxi — На линии")
            .setContentText(subtitle)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Выйти", stopPi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun saveOnlineState(online: Boolean) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_WAS_ONLINE, online).apply()
    }

    private fun pollOffers() {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val token = prefs.getString(KEY_TOKEN, null)
        if (token.isNullOrEmpty()) return
        val apiBase = (prefs.getString(KEY_API_BASE, DEFAULT_API_BASE) ?: DEFAULT_API_BASE).trimEnd('/')
        val exec = offerExec ?: return
        if (exec.isShutdown) return

        exec.execute {
            var conn: HttpURLConnection? = null
            try {
                val url = URL("$apiBase/api/drivers/pending-offers")
                conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    setRequestProperty("Authorization", "Bearer $token")
                    connectTimeout = 8_000
                    readTimeout = 8_000
                }
                if (conn.responseCode != 200) return@execute
                val sb = StringBuilder()
                BufferedReader(InputStreamReader(conn.inputStream)).use { r ->
                    var line = r.readLine()
                    while (line != null) { sb.append(line); line = r.readLine() }
                }
                val offers = JSONObject(sb.toString()).optJSONArray("offers") ?: return@execute
                for (i in 0 until offers.length()) {
                    val offer = offers.getJSONObject(i)
                    val oid = offer.optLong("offerId", 0L)
                    if (oid == 0L) continue
                    val offerId = oid.toString()
                    val isNew = synchronized(seenOfferIds) {
                        if (seenOfferIds.contains(offerId)) {
                            false
                        } else {
                            seenOfferIds.add(offerId)
                            if (seenOfferIds.size > 200) seenOfferIds.clear()
                            true
                        }
                    }
                    if (!isNew) continue
                    val ride = offer.optJSONObject("ride") ?: continue
                    val from = ride.optString("fromCity", "")
                    val to = ride.optString("toCity", "")
                    val price = if (ride.has("price") && !ride.isNull("price")) "${ride.opt("price")} сум" else ""
                    handler.post { OrderNotifications.show(this, offerId, from, to, price) }
                }
            } catch (ignored: Exception) {
            } finally {
                conn?.disconnect()
            }
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val wasOnline = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_WAS_ONLINE, false)
        if (wasOnline) {
            val restart = Intent(this, LocationForegroundService::class.java).setAction(ACTION_MODE_BALANCED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(restart)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        handler.removeCallbacks(locationWatchdog)
        handler.removeCallbacks(offerPoller)
        stopLocationUpdates()
        offerExec?.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
