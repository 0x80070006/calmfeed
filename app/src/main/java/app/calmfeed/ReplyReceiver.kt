package app.calmfeed

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

/**
 * Réponse saisie dans une notification : envoyée en arrière-plan, sans ouvrir l'app
 * (onglet Messages de l'app s'il existe, sinon page invisible du service).
 */
class ReplyReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_REPLY)?.toString()?.trim()
        val ref = intent.getStringExtra(Notifier.EXTRA_REF) ?: return
        val key = intent.getStringExtra(Notifier.EXTRA_NAME) ?: ref
        if (text.isNullOrEmpty()) return
        Notifier.onReplyPending(ctx, key, text)
        val live = MainActivity.live?.get()
        if (live != null && live.sendDm(ref, key, text)) return
        DmService.send(ctx, Intent(DmService.ACTION_REPLY)
            .putExtra(Notifier.EXTRA_REF, ref).putExtra(Notifier.EXTRA_NAME, key).putExtra(Notifier.EXTRA_TEXT, text))
    }
}
