package app.calmfeed

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

/**
 * Réponse saisie dans la notification.
 * App ouverte (même en arrière-plan) : envoi discret via l'onglet Messages, sans l'afficher.
 * App fermée : l'app s'ouvre sur la conversation et envoie le message.
 */
class ReplyReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_REPLY)?.toString()?.trim()
        val name = intent.getStringExtra(Notifier.EXTRA_NAME) ?: return
        val avatar = intent.getStringExtra("dm_avatar") ?: ""
        if (text.isNullOrEmpty()) return
        val live = MainActivity.live?.get()
        if (live != null && live.sendDm(name, text, avatar)) return
        ctx.startActivity(Intent(ctx, MainActivity::class.java)
            .putExtra(Notifier.EXTRA_OPEN, name)
            .putExtra(Notifier.EXTRA_TEXT, text)
            .putExtra("dm_avatar", avatar)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }
}
