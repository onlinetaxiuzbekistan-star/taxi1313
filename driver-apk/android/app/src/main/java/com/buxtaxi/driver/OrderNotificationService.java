package com.buxtaxi.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;

import java.util.HashSet;
import java.util.Set;

public class OrderNotificationService {

    private static final String CHANNEL_ID = "buxtaxi_orders";
    private static final int ORDER_NOTIFICATION_BASE_ID = 2001;
    private static int notificationCounter = 0;
    private static final Set<String> recentOrderIds = new HashSet<>();
    private static final int MAX_RETRY = 3;

    public static void showOrderNotification(Context context, String orderId, String from, String to, String price) {
        if (orderId != null && !orderId.isEmpty()) {
            synchronized (recentOrderIds) {
                if (recentOrderIds.contains(orderId)) {
                    return;
                }
                recentOrderIds.add(orderId);
                if (recentOrderIds.size() > 100) {
                    recentOrderIds.clear();
                }
            }
        }

        createOrderChannel(context);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("order_id", orderId);
        PendingIntent pi = PendingIntent.getActivity(context, notificationCounter, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = "Новый заказ!";
        String body = from + " → " + to;
        if (price != null && !price.isEmpty()) {
            body += " | " + price;
        }

        int notifId = ORDER_NOTIFICATION_BASE_ID + (notificationCounter % 10);
        notificationCounter++;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .setDefaults(Notification.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setVibrate(new long[]{0, 500, 200, 500, 200, 500});

        Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        builder.setSound(soundUri);

        showWithRetry(context, notifId, builder.build(), 0);
        vibrateDevice(context);
    }

    private static void showWithRetry(Context context, int notifId, Notification notification, int attempt) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        try {
            nm.notify(notifId, notification);
        } catch (Exception e) {
            if (attempt < MAX_RETRY) {
                try { Thread.sleep(500); } catch (InterruptedException ignored) {}
                showWithRetry(context, notifId, notification, attempt + 1);
            }
        }
    }

    private static void createOrderChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Новые заказы",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Уведомления о новых заказах");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 500});
            channel.enableLights(true);
            channel.setLightColor(0xFFF59E0B);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(true);

            AudioAttributes audioAttr = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audioAttr);

            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private static void vibrateDevice(Context context) {
        long[] pattern = new long[]{0, 500, 200, 500, 200, 500};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            if (vm != null) {
                Vibrator v = vm.getDefaultVibrator();
                v.vibrate(VibrationEffect.createWaveform(pattern, -1));
            }
        } else {
            Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, -1));
                } else {
                    v.vibrate(pattern, -1);
                }
            }
        }
    }

    public static void dismissOrderNotification(Context context) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            for (int i = 0; i < 10; i++) {
                nm.cancel(ORDER_NOTIFICATION_BASE_ID + i);
            }
        }
    }

    public static void clearOrderHistory() {
        synchronized (recentOrderIds) {
            recentOrderIds.clear();
        }
    }
}
