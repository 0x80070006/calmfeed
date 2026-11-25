package app.calmfeed

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Après une mise à jour (ACTION_MY_PACKAGE_REPLACED). Depuis Android 10, une app ne peut pas se rouvrir
 * seule depuis l'arrière-plan : on tente quand même, et on poste une notification pop-up qui la rouvre.
 */
class UpdatedReceiver : BroadcastReceiver() {

    companion object {
        private const val CHANNEL = "updates"
        private const val ID = 7_001
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) ?: return
        try { ctx.startActivity(launch) } catch (_: Exception) { /* bloqué par Android : la notification prend le relais */ }

        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Mises à jour", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Signale que CalmFeed vient d'être mis à jour."
            })
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
        val pi = PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val version = Updater.installedVersion(ctx)
        try {
            NotificationManagerCompat.from(ctx).notify(ID, NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher_mono)
                .setContentTitle("CalmFeed est à jour")
                .setContentText("Version $version. Touchez pour ouvrir.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build())
        } catch (_: SecurityException) { }
    }
}
