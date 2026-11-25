package expo.modules.nanobridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps von mini working while the user switches away mid-build.
 *
 * Android freezes a backgrounded app's process within seconds (and cuts its network), which used
 * to kill a build or chat edit the user had left running. While one runs, JS starts this
 * foreground service: Android shows a quiet "Building your app…" notification and keeps the
 * process (and its connection to Gemini) alive. JS stops it as soon as the work ends.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Working on your app…"
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Work in progress", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
      )
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    // The notification icon expo-notifications generates, else the app icon.
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 } ?: applicationInfo.icon
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setContentTitle(title)
      .setContentText("Keeps going while you use other apps.")
      .setSmallIcon(icon)
      .setOngoing(true)
      .setSilent(true)
      .setProgress(0, 0, true)
      .setContentIntent(open)
      .build()
    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        notification,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
      )
    } catch (e: Exception) {
      // Not allowed right now (e.g. started from the background): the work still runs, unprotected.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  /** Android 15+ caps how long this kind of service may run; a build never needs that long. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    private const val CHANNEL = "vm-work"
    private const val NOTIFICATION_ID = 4107
  }
}
