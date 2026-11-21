package app.calmfeed

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Shader
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.util.concurrent.Executors

/**
 * Notifications de messages privés, au style « conversation » d'Android :
 * nom et photo de l'expéditeur, début du message, réponse directe quand il n'y a qu'une notification.
 *
 * Source : la liste « Messages » d'Instagram telle qu'affichée (voir notify.js). Une notification
 * disparaît d'elle-même quand la conversation n'est plus marquée non lue.
 */
object Notifier {
    const val CHANNEL = "dm"
    private const val GROUP = "app.calmfeed.DM"
    private const val SUMMARY_ID = 9000
    const val KEY_REPLY = "reply_text"
    const val EXTRA_NAME = "dm_name"
    const val EXTRA_TEXT = "dm_text"
    const val EXTRA_OPEN = "open_dm"

    data class Dm(val name: String, val text: String, val avatar: String, val time: String)

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Messages privés", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Nouveaux messages reçus sur Instagram"
            enableVibration(true)
        })
    }

    fun canPost(ctx: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 ||
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    fun parse(json: String): List<Dm> = try {
        val a = JSONArray(json)
        (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            Dm(o.optString("name"), o.optString("text"), o.optString("avatar"), o.optString("time"))
        }.filter { it.name.isNotBlank() }
    } catch (_: Exception) { emptyList() }

    private fun state(ctx: Context) = ctx.getSharedPreferences("notif_state", Context.MODE_PRIVATE)
    private fun idFor(name: String) = 1000 + (name.hashCode() and 0x0fffffff)

    /**
     * Nouvelle photographie de la liste des non-lus.
     * @param silent l'utilisateur regarde déjà la liste : on mémorise sans notifier.
     */
    fun onInbox(ctx: Context, list: List<Dm>, silent: Boolean) = io.execute {
        val prefs = Prefs(ctx)
        val st = state(ctx)
        val notified = JSONObject(st.getString("notified", "{}")!!)
        val nm = NotificationManagerCompat.from(ctx)

        // Conversations lues entre-temps : leur notification disparaît.
        val names = list.map { it.name }.toSet()
        for (k in notified.keys().asSequence().toList()) if (k !in names) { nm.cancel(idFor(k)); notified.remove(k) }

        val enabled = prefs.bool("notifEnabled") && canPost(ctx)
        val fresh = list.filter { notified.optString(it.name, "\u0000") != it.text }
        if (!enabled || silent || prefs.quietNow()) {
            if (silent) for (d in fresh) notified.put(d.name, d.text)   // déjà vus à l'écran
            st.edit().putString("notified", notified.toString()).apply()
            if (notified.length() < 2) nm.cancel(SUMMARY_ID)
            return@execute
        }
        for (d in fresh) notified.put(d.name, d.text)
        st.edit().putString("notified", notified.toString()).apply()

        ensureChannel(ctx)
        val active = list.filter { notified.has(it.name) }
        val allowReply = prefs.bool("notifReply") && active.size == 1
        for (d in active) post(ctx, d, alert = d in fresh, reply = allowReply)
        if (active.size >= 2) postSummary(ctx, active) else nm.cancel(SUMMARY_ID)
    }

    @Suppress("MissingPermission")
    private fun post(ctx: Context, d: Dm, alert: Boolean, reply: Boolean, extraSelf: String? = null) {
        val prefs = Prefs(ctx)
        val icon = if (prefs.bool("notifPhoto")) avatar(ctx, d.avatar)?.let { IconCompat.createWithBitmap(it) } else null
        val sender = Person.Builder().setName(d.name).setKey(d.name).apply { if (icon != null) setIcon(icon) }.build()
        val me = Person.Builder().setName("Vous").build()
        val body = if (prefs.bool("notifPreview")) d.text.ifBlank { "Nouveau message" } else "Nouveau message"
        val style = NotificationCompat.MessagingStyle(me)
            .addMessage(body, System.currentTimeMillis(), sender)
        if (extraSelf != null) style.addMessage(extraSelf, System.currentTimeMillis(), null as Person?)

        val open = PendingIntent.getActivity(ctx, idFor(d.name),
            Intent(ctx, MainActivity::class.java).putExtra(EXTRA_OPEN, d.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_tab_direct)
            .setColor(Color.rgb(193, 53, 132))
            .setStyle(style)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setGroup(GROUP)
            .setOnlyAlertOnce(!alert)
            .setShortcutId(null)
        if (icon != null) b.setLargeIcon(avatar(ctx, d.avatar))

        if (reply && extraSelf == null) {
            val input = RemoteInput.Builder(KEY_REPLY).setLabel("Répondre à ${d.name}").build()
            val pi = PendingIntent.getBroadcast(ctx, idFor(d.name),
                Intent(ctx, ReplyReceiver::class.java).putExtra(EXTRA_NAME, d.name).putExtra("dm_avatar", d.avatar),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            b.addAction(NotificationCompat.Action.Builder(R.drawable.ic_tab_direct, "Répondre", pi)
                .addRemoteInput(input).setAllowGeneratedReplies(false)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).build())
        }
        NotificationManagerCompat.from(ctx).notify(idFor(d.name), b.build())
    }

    @Suppress("MissingPermission")
    private fun postSummary(ctx: Context, active: List<Dm>) {
        val inbox = NotificationCompat.InboxStyle()
        for (d in active.take(5)) inbox.addLine("${d.name} : ${if (Prefs(ctx).bool("notifPreview")) d.text else "nouveau message"}")
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_tab_direct)
            .setContentTitle("${active.size} conversations non lues")
            .setStyle(inbox)
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(ctx).notify(SUMMARY_ID, n)
    }

    /** Après une réponse : la notification montre « Vous : … », puis s'efface. */
    fun onReplied(ctx: Context, name: String, avatar: String, text: String, ok: Boolean) = io.execute {
        post(ctx, Dm(name, if (ok) "Message envoyé" else "Échec de l'envoi : ouvrez la conversation", avatar, ""),
            alert = false, reply = false, extraSelf = text)
        if (ok) main.postDelayed({ NotificationManagerCompat.from(ctx).cancel(idFor(name)) }, 2500)
    }

    /** Notification d'essai depuis les réglages (expéditeur fictif). */
    fun showTest(ctx: Context) = io.execute {
        ensureChannel(ctx)
        if (!canPost(ctx)) return@execute
        post(ctx, Dm("CalmFeed", "Voici à quoi ressemblera un message privé.", "", ""), alert = true, reply = false)
    }

    // ------------------------------------------------------------------ photos (cache disque, rondes)
    private val mem = HashMap<String, Bitmap>()

    private fun avatar(ctx: Context, url: String): Bitmap? {
        if (!url.startsWith("https://")) return null
        mem[url]?.let { return it }
        val file = File(ctx.cacheDir, "avatars/${url.hashCode()}.png")
        val raw = try {
            if (file.exists()) BitmapFactory.decodeFile(file.path)
            else URL(url).openStream().use { BitmapFactory.decodeStream(it) }?.also { bmp ->
                file.parentFile?.mkdirs()
                file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        } catch (_: Exception) { null } ?: return null
        val size = minOf(raw.width, raw.height)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        Canvas(out).drawCircle(size / 2f, size / 2f, size / 2f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = BitmapShader(raw, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        })
        mem[url] = out
        return out
    }
}
