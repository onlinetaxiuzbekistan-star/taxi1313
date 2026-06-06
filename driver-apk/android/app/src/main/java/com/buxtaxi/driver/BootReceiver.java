package com.buxtaxi.driver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        boolean isBoot = Intent.ACTION_BOOT_COMPLETED.equals(action)
            || "android.intent.action.QUICKBOOT_POWERON".equals(action)
            || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action);

        boolean isMyPackage = Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);

        if (isBoot || isMyPackage) {
            SharedPreferences prefs = context.getSharedPreferences("buxtaxi", Context.MODE_PRIVATE);
            boolean wasOnline = prefs.getBoolean("driver_was_online", false);

            if (wasOnline) {
                try {
                    Intent serviceIntent = new Intent(context, LocationService.class);
                    serviceIntent.setAction(LocationService.ACTION_MODE_BALANCED);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent);
                    } else {
                        context.startService(serviceIntent);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
