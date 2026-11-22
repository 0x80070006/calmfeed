package app.calmfeed

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Boutons des notifications : « Couper 1 h », « Confirmer », « Supprimer ». */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            MUTE -> Notifier.mute(ctx, intent.getStringExtra(Notifier.EXTRA_NAME) ?: return)
            FOLLOW_OK, FOLLOW_NO -> {
                val u = intent.getStringExtra("username") ?: return
                val f = Notifier.Follow(u, intent.getStringExtra("name") ?: "", intent.getStringExtra("avatar") ?: "")
                Notifier.postFollow(ctx, f, "…")
                DmService.send(ctx, Intent(DmService.ACTION_FOLLOW_ACT).putExtra("username", u)
                    .putExtra("name", f.name).putExtra("avatar", f.avatar).putExtra("accept", intent.action == FOLLOW_OK))
            }
        }
    }

    companion object {
        const val MUTE = "app.calmfeed.MUTE"
        const val FOLLOW_OK = "app.calmfeed.FOLLOW_OK"
        const val FOLLOW_NO = "app.calmfeed.FOLLOW_NO"
    }
}
