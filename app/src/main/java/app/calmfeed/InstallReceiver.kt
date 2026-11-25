package app.calmfeed

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

/** Résultat de la session PackageInstaller lancée par Updater.install (receiver non exporté). */
class InstallReceiver : BroadcastReceiver() {

    companion object { const val ACTION = "app.calmfeed.INSTALL_RESULT" }

    override fun onReceive(ctx: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // L'écran de mise à jour est au premier plan à ce moment-là : Android autorise l'ouverture.
            val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
            if (confirm != null) {
                try { ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                catch (e: Exception) { Updater.fail("Android n'a pas pu afficher la confirmation (${e.javaClass.simpleName})."); return }
            }
        }
        Updater.onInstallResult(ctx, status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
    }
}
