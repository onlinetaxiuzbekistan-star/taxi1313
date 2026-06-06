package com.buxtaxi.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class LocationService extends Service {

    private static final String CHANNEL_ID = "buxtaxi_location";
    private static final int NOTIFICATION_ID = 1001;
    private static final long OFFER_POLL_INTERVAL_MS = 7_000L;
    private static final String OFFER_API_URL = "https://nil.taxi1313.ru/api/drivers/pending-offers";

    private ExecutorService offerExec;
    private final Set<String> seenOfferIds = new HashSet<>();
    private final Runnable offerPoller = new Runnable() {
        @Override public void run() {
            pollOffers();
            handler.postDelayed(this, OFFER_POLL_INTERVAL_MS);
        }
    };

    public static final String ACTION_MODE_HIGH = "com.buxtaxi.driver.LOCATION_HIGH";
    public static final String ACTION_MODE_BALANCED = "com.buxtaxi.driver.LOCATION_BALANCED";
    public static final String ACTION_STOP = "com.buxtaxi.driver.LOCATION_STOP";

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean isHighAccuracy = false;
    private Location lastLocation = null;
    private long lastLocationTime = 0;
    private int locationFailures = 0;

    private final Runnable locationWatchdog = new Runnable() {
        @Override
        public void run() {
            long now = System.currentTimeMillis();
            long sinceLastLoc = now - lastLocationTime;

            if (lastLocationTime > 0 && sinceLastLoc > 120_000) {
                locationFailures++;
                sendLog("GPS", "No location for " + (sinceLastLoc / 1000) + "s, failures=" + locationFailures);

                if (locationFailures >= 3) {
                    sendLog("GPS", "Restarting location provider");
                    stopLocationUpdates();
                    startLocationUpdates(isHighAccuracy);
                    locationFailures = 0;
                }
            }
            handler.postDelayed(this, 60_000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        offerExec = Executors.newSingleThreadExecutor();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            saveOnlineState(false);
            stopLocationUpdates();
            handler.removeCallbacks(offerPoller);
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        boolean highAccuracy = intent != null && ACTION_MODE_HIGH.equals(intent.getAction());

        Notification notification = buildNotification(highAccuracy);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        stopLocationUpdates();
        startLocationUpdates(highAccuracy);
        saveOnlineState(true);

        handler.removeCallbacks(locationWatchdog);
        handler.postDelayed(locationWatchdog, 60_000);

        handler.removeCallbacks(offerPoller);
        handler.post(offerPoller);

        return START_STICKY;
    }

    private void startLocationUpdates(boolean highAccuracy) {
        isHighAccuracy = highAccuracy;

        int priority = highAccuracy ? Priority.PRIORITY_HIGH_ACCURACY : Priority.PRIORITY_BALANCED_POWER_ACCURACY;
        long interval = highAccuracy ? 10_000 : 30_000;
        long fastest = highAccuracy ? 5_000 : 15_000;
        float minDist = highAccuracy ? 10f : 50f;

        LocationRequest request = new LocationRequest.Builder(priority, interval)
            .setMinUpdateIntervalMillis(fastest)
            .setMinUpdateDistanceMeters(minDist)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc == null) return;

                lastLocation = loc;
                lastLocationTime = System.currentTimeMillis();
                locationFailures = 0;

                Intent broadcast = new Intent("com.buxtaxi.driver.LOCATION_UPDATE");
                broadcast.setPackage(getPackageName());
                broadcast.putExtra("lat", loc.getLatitude());
                broadcast.putExtra("lng", loc.getLongitude());
                broadcast.putExtra("speed", loc.getSpeed());
                broadcast.putExtra("accuracy", loc.getAccuracy());
                broadcast.putExtra("bearing", loc.getBearing());
                broadcast.putExtra("time", loc.getTime());
                sendBroadcast(broadcast);
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
            sendLog("GPS", "Started " + (highAccuracy ? "HIGH_ACCURACY" : "BALANCED") +
                " interval=" + interval + "ms dist=" + minDist + "m");
        } catch (SecurityException e) {
            sendLog("GPS", "SecurityException: " + e.getMessage());
        }
    }

    private void stopLocationUpdates() {
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Отслеживание местоположения",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Работа в режиме водителя");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(boolean highAccuracy) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, LocationService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String subtitle = highAccuracy ? "На заказе — точное отслеживание" : "Ожидание заказа";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("BuxTaxi — На линии")
            .setContentText(subtitle)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Выйти", stopPi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    private void saveOnlineState(boolean online) {
        SharedPreferences prefs = getSharedPreferences("buxtaxi", MODE_PRIVATE);
        prefs.edit().putBoolean("driver_was_online", online).apply();
    }

    private void sendLog(String cat, String msg) {
        Intent logIntent = new Intent("com.buxtaxi.driver.LOG");
        logIntent.setPackage(getPackageName());
        logIntent.putExtra("category", cat);
        logIntent.putExtra("message", msg);
        sendBroadcast(logIntent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(locationWatchdog);
        stopLocationUpdates();
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        SharedPreferences prefs = getSharedPreferences("buxtaxi", MODE_PRIVATE);
        boolean wasOnline = prefs.getBoolean("driver_was_online", false);
        if (wasOnline) {
            Intent restartIntent = new Intent(this, LocationService.class);
            restartIntent.setAction(ACTION_MODE_BALANCED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartIntent);
            }
            sendLog("SERVICE", "Task removed, restarting service");
        }
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollOffers() {
        SharedPreferences prefs = getSharedPreferences("buxtaxi", MODE_PRIVATE);
        final String token = prefs.getString("auth_token", null);
        if (token == null || token.isEmpty()) return;
        if (offerExec == null || offerExec.isShutdown()) return;
        offerExec.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(OFFER_API_URL);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setConnectTimeout(8_000);
                conn.setReadTimeout(8_000);
                int code = conn.getResponseCode();
                if (code != 200) return;
                BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
                r.close();
                JSONObject body = new JSONObject(sb.toString());
                JSONArray offers = body.optJSONArray("offers");
                if (offers == null) return;
                for (int i = 0; i < offers.length(); i++) {
                    JSONObject offer = offers.getJSONObject(i);
                    long oid = offer.optLong("offerId", 0L);
                    if (oid == 0L) continue;
                    String offerId = String.valueOf(oid);
                    synchronized (seenOfferIds) {
                        if (seenOfferIds.contains(offerId)) continue;
                        seenOfferIds.add(offerId);
                        if (seenOfferIds.size() > 200) seenOfferIds.clear();
                    }
                    JSONObject ride = offer.optJSONObject("ride");
                    if (ride == null) continue;
                    final String from = ride.optString("fromCity", "");
                    final String to = ride.optString("toCity", "");
                    final String price = ride.has("price") && !ride.isNull("price")
                        ? String.valueOf(ride.opt("price")) + " сум" : "";
                    final String fOfferId = offerId;
                    handler.post(() -> OrderNotificationService.showOrderNotification(
                        LocationService.this, fOfferId, from, to, price));
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) try { conn.disconnect(); } catch (Exception ignored) {}
            }
        });
    }

}
