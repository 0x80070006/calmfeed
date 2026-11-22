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
import androidx.core.content.LocusIdCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.util.concurrent.Executors

/**
 * Notifications au niveau des messageries :
 *  - messages privés : une notification par conversation (identifiant exact), style « conversation »
 *    d'Android (section Conversations, priorité, raccourci), photo et nom de l'expéditeur, 3 derniers
 *    messages, type du contenu (vocal, reel, photo…), actions Répondre et Couper 1 h ;
 *  - demandes d'abonnement : photo, nom, actions Confirmer / Supprimer ;
 *  - demandes de messages (inconnus) : simple compteur, désactivé par défaut.
 * Seuls les éléments NOUVEAUX notifient (pas ce qui était déjà non lu ou déjà notifié).
 */
object Notifier {
    const val CHANNEL = "dm"
    const val CHANNEL_FOLLOW = "follow"
    const val CHANNEL_REQ = "msg_requests"
    private const val GROUP = "app.calmfeed.DM"
    private const val SUMMARY_ID = 9000
    private const val REQ_ID = 9100
    const val KEY_REPLY = "reply_text"
    const val EXTRA_REF = "dm_ref"            // identifiant de conversation (ou nom affiché à défaut)
    const val EXTRA_NAME = "dm_name"
    const val EXTRA_TEXT = "dm_text"
    const val EXTRA_OPEN = "open_dm"
    const val EXTRA_AVATAR = "dm_avatar"

    data class Msg(val who: String, val text: String, val ts: Long)
    data class Dm(
        val key: String, val id: String?, val title: String, val group: Boolean, val sender: String,
        val text: String, val kind: String, val avatar: String, val history: List<Msg>, val igMuted: Boolean,
    ) { val ref get() = id ?: title }

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Messages privés", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Nouveaux messages reçus sur Instagram"; enableVibration(true)
            })
        if (nm.getNotificationChannel(CHANNEL_FOLLOW) == null) nm.createNotificationChannel(
            NotificationChannel(CHANNEL_FOLLOW, "Demandes d'abonnement", NotificationManager.IMPORTANCE_DEFAULT))
        if (nm.getNotificationChannel(CHANNEL_REQ) == null) nm.createNotificationChannel(
            NotificationChannel(CHANNEL_REQ, "Demandes de messages", NotificationManager.IMPORTANCE_LOW))
    }

    fun canPost(ctx: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 ||
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    fun parse(json: String): List<Dm> = try {
        val a = JSONArray(json)
        (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            val id = o.optString("id").ifBlank { null }
            val title = o.optString("title")
            val hist = o.optJSONArray("history")?.let { h ->
                (0 until h.length()).map { k -> h.getJSONObject(k).let { Msg(it.optString("who"), it.optString("text"), it.optLong("ts")) } }
            } ?: emptyList()
            Dm(key = id ?: title, id = id, title = title, group = o.optBoolean("group"),
                sender = o.optString("sender").ifBlank { title }, text = o.optString("text"),
                kind = o.optString("kind", "text"), avatar = o.optString("avatar"), history = hist,
                igMuted = o.optBoolean("muted"))
        }.filter { it.title.isNotBlank() }
    } catch (_: Exception) { emptyList() }

    private fun state(ctx: Context) = ctx.getSharedPreferences("notif_state", Context.MODE_PRIVATE)
    private fun idFor(key: String) = 1000 + (key.hashCode() and 0x0fffffff)

    // ------------------------------------------------------------------ « Couper 1 h »
    fun mute(ctx: Context, key: String, minutes: Int = 60) {
        state(ctx).edit().putLong("mute_$key", System.currentTimeMillis() + minutes * 60_000L).apply()
        NotificationManagerCompat.from(ctx).cancel(idFor(key))
    }
    private fun muted(ctx: Context, key: String) = state(ctx).getLong("mute_$key", 0) > System.currentTimeMillis()

    // ------------------------------------------------------------------ messages privés
    /**
     * Nouvelle photographie des conversations non lues.
     *  - premier passage : tout est mémorisé sans notifier (rien de « déjà non lu » ne sonne) ;
     *  - ensuite, une conversation notifie seulement si son dernier message a changé ;
     *  - une conversation lue est oubliée et sa notification retirée.
     * @param silent l'utilisateur regarde déjà la liste : on mémorise sans notifier.
     */
    fun onInbox(ctx: Context, list: List<Dm>, silent: Boolean) = io.execute {
        val prefs = Prefs(ctx)
        val st = state(ctx)
        val known = JSONObject(st.getString("known2", "{}")!!)
        val posted = JSONObject(st.getString("posted2", "{}")!!)
        val firstRun = !st.getBoolean("initialized2", false)
        val nm = NotificationManagerCompat.from(ctx)

        val keys = list.map { it.key }.toSet()
        for (k in known.keys().asSequence().toList()) if (k !in keys) known.remove(k)
        for (k in posted.keys().asSequence().toList()) if (k !in keys) { nm.cancel(idFor(k)); posted.remove(k) }

        val fresh = list.filter { known.optString(it.key, "\u0000") != it.text }
        for (d in list) known.put(d.key, d.text)

        val show = prefs.bool("notifEnabled") && canPost(ctx) && !silent && !firstRun && !prefs.quietNow()
        val toPost = if (show) fresh.filter { !it.igMuted && !muted(ctx, it.key) } else emptyList()
        for (d in toPost) posted.put(d.key, d.text)
        st.edit().putString("known2", known.toString()).putString("posted2", posted.toString())
            .putBoolean("initialized2", true).apply()
        if (toPost.isEmpty()) { if (posted.length() < 2) nm.cancel(SUMMARY_ID); return@execute }

        ensureChannel(ctx)
        val active = list.filter { posted.has(it.key) }
        for (d in active) post(ctx, d, alert = d in toPost)
        if (active.size >= 2) postSummary(ctx, active) else nm.cancel(SUMMARY_ID)
    }

    private fun label(kind: String, text: String) = when (kind) {
        "voice" -> "🎤 Message vocal"
        "reel" -> "🎬 Reel" + if (text.isNotBlank() && !text.contains("reel", true)) " · $text" else ""
        "photo" -> "📷 Photo"
        "video" -> "🎥 Vidéo"
        "share" -> "↗ " + text.ifBlank { "Publication partagée" }
        "sticker" -> "✨ Autocollant"
        "note" -> "💬 " + text.ifBlank { "A répondu à votre note" }
        "reaction" -> text.ifBlank { "A réagi à votre message" }
        else -> text.ifBlank { "Nouveau message" }
    }

    @Suppress("MissingPermission")
    private fun post(ctx: Context, d: Dm, alert: Boolean, sentText: String? = null, status: String? = null) {
        val prefs = Prefs(ctx)
        val bmp = if (prefs.bool("notifPhoto")) avatar(ctx, d.avatar) else null
        val icon = bmp?.let { IconCompat.createWithBitmap(it) }
        val sender = Person.Builder().setName(d.sender).setKey(d.key + "/" + d.sender).apply { if (icon != null) setIcon(icon) }.build()
        val me = Person.Builder().setName("Vous").build()
        val preview = prefs.bool("notifPreview")

        val style = NotificationCompat.MessagingStyle(me)
        if (d.group) { style.conversationTitle = d.title; style.isGroupConversation = true }
        val hist = if (preview && d.history.isNotEmpty()) d.history else listOf(Msg(d.sender, d.text, System.currentTimeMillis()))
        for (m in hist.takeLast(3)) {
            val p = if (m.who.isBlank() || m.who == d.sender) sender else Person.Builder().setName(m.who).build()
            val body = if (preview) label(if (m === hist.last()) d.kind else "text", m.text) else "Nouveau message"
            style.addMessage(body, if (m.ts > 0) m.ts else System.currentTimeMillis(), p)
        }
        if (sentText != null) style.addMessage(sentText, System.currentTimeMillis(), null as Person?)
        if (status != null) style.addMessage(status, System.currentTimeMillis(), Person.Builder().setName("CalmFeed").build())

        // Raccourci de conversation : section « Conversations » d'Android, priorité, photo.
        val shortcutId = "dm_" + d.key.hashCode()
        val openIntent = Intent(ctx, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
            .putExtra(EXTRA_OPEN, d.ref).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        try {
            ShortcutManagerCompat.pushDynamicShortcut(ctx, ShortcutInfoCompat.Builder(ctx, shortcutId)
                .setShortLabel(if (d.group) d.title else d.sender).setLongLived(true)
                .setPerson(sender).setIcon(icon ?: IconCompat.createWithResource(ctx, R.mipmap.ic_launcher))
                .setIntent(openIntent).setLocusId(LocusIdCompat(shortcutId)).build())
        } catch (_: Exception) { }

        val open = PendingIntent.getActivity(ctx, idFor(d.key), openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_tab_direct)
            .setColor(Color.rgb(193, 53, 132))
            .setStyle(style)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setGroup(GROUP)
            .setShortcutId(shortcutId)
            .setLocusId(LocusIdCompat(shortcutId))
            .setOnlyAlertOnce(!alert)
        if (bmp != null) b.setLargeIcon(bmp)

        if (sentText == null) {
            if (prefs.bool("notifReply")) {
                val input = RemoteInput.Builder(KEY_REPLY).setLabel("Répondre à ${d.sender}").build()
                val pi = PendingIntent.getBroadcast(ctx, idFor(d.key),
                    Intent(ctx, ReplyReceiver::class.java).putExtra(EXTRA_REF, d.ref).putExtra(EXTRA_NAME, d.key)
                        .putExtra(EXTRA_AVATAR, d.avatar),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                b.addAction(NotificationCompat.Action.Builder(R.drawable.ic_tab_direct, "Répondre", pi)
                    .addRemoteInput(input).setAllowGeneratedReplies(prefs.bool("notifSmartReply"))
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setShowsUserInterface(false).build())
            }
            val mutePi = PendingIntent.getBroadcast(ctx, idFor(d.key) + 1,
                Intent(ctx, ActionReceiver::class.java).setAction(ActionReceiver.MUTE).putExtra(EXTRA_NAME, d.key),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            b.addAction(NotificationCompat.Action.Builder(0, "Couper 1 h", mutePi)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MUTE).setShowsUserInterface(false).build())
        }
        NotificationManagerCompat.from(ctx).notify(idFor(d.key), b.build())
        lastShown[d.key] = d
    }

    private val lastShown = HashMap<String, Dm>()

    @Suppress("MissingPermission")
    private fun postSummary(ctx: Context, active: List<Dm>) {
        val inbox = NotificationCompat.InboxStyle()
        val preview = Prefs(ctx).bool("notifPreview")
        for (d in active.take(5)) inbox.addLine("${if (d.group) d.title else d.sender} : ${if (preview) label(d.kind, d.text) else "nouveau message"}")
        NotificationManagerCompat.from(ctx).notify(SUMMARY_ID, NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_tab_direct).setContentTitle("${active.size} conversations non lues")
            .setStyle(inbox).setGroup(GROUP).setGroupSummary(true).setOnlyAlertOnce(true).setAutoCancel(true).build())
    }

    /** Réponse : « Envoi… », puis « Envoyé ✓ » (confirmé dans la conversation) ou « Échec ». */
    fun onReplyPending(ctx: Context, key: String, text: String) = io.execute {
        lastShown[key]?.let { post(ctx, it, alert = false, sentText = text, status = "Envoi…") }
    }
    fun onReplied(ctx: Context, key: String, text: String, ok: Boolean) = io.execute {
        val d = lastShown[key] ?: return@execute
        post(ctx, d, alert = false, sentText = text, status = if (ok) "Envoyé ✓" else "Échec de l'envoi : touchez pour ouvrir")
        if (ok) main.postDelayed({ NotificationManagerCompat.from(ctx).cancel(idFor(key)) }, 2500)
    }

    fun showTest(ctx: Context) = io.execute {
        ensureChannel(ctx)
        if (!canPost(ctx)) return@execute
        post(ctx, Dm("calmfeed-test", null, "CalmFeed", false, "CalmFeed",
            "Voici à quoi ressemblera un message privé.", "text", "",
            listOf(Msg("CalmFeed", "Salut 👋", System.currentTimeMillis() - 60_000),
                Msg("CalmFeed", "Voici à quoi ressemblera un message privé.", System.currentTimeMillis())), false),
            alert = true)
    }

    // ------------------------------------------------------------------ demandes d'abonnement
    data class Follow(val username: String, val name: String, val avatar: String)

    fun onFollowRequests(ctx: Context, json: String) = io.execute {
        val prefs = Prefs(ctx)
        val list = try {
            val a = JSONArray(json)
            (0 until a.length()).map { a.getJSONObject(it).let { o -> Follow(o.optString("username"), o.optString("name"), o.optString("avatar")) } }
                .filter { it.username.isNotBlank() }
        } catch (_: Exception) { return@execute }
        val st = state(ctx)
        val seen = JSONObject(st.getString("follow_seen", "{}")!!)
        val firstRun = !st.getBoolean("follow_init", false)
        val nm = NotificationManagerCompat.from(ctx)
        val now = list.map { it.username }.toSet()
        for (k in seen.keys().asSequence().toList()) if (k !in now) { seen.remove(k); nm.cancel(idFor("fr_$k")) }
        val fresh = list.filter { !seen.has(it.username) }
        for (f in fresh) seen.put(f.username, System.currentTimeMillis())
        st.edit().putString("follow_seen", seen.toString()).putBoolean("follow_init", true).apply()
        if (firstRun || fresh.isEmpty() || !prefs.bool("notifEnabled") || !prefs.bool("notifFollow") || !canPost(ctx) || prefs.quietNow()) return@execute
        ensureChannel(ctx)
        for (f in fresh) postFollow(ctx, f, null)
    }

    @Suppress("MissingPermission")
    fun postFollow(ctx: Context, f: Follow, status: String?) {
        val bmp = avatar(ctx, f.avatar)
        val id = idFor("fr_${f.username}")
        val b = NotificationCompat.Builder(ctx, CHANNEL_FOLLOW)
            .setSmallIcon(R.drawable.ic_tab_profile)
            .setColor(Color.rgb(193, 53, 132))
            .setContentTitle(if (f.name.isNotBlank()) "${f.name} (@${f.username})" else "@${f.username}")
            .setContentText(status ?: "demande à vous suivre")
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setAutoCancel(true)
            .setOnlyAlertOnce(status != null)
        if (bmp != null) b.setLargeIcon(bmp)
        if (status == null) for ((act, label) in listOf(ActionReceiver.FOLLOW_OK to "Confirmer", ActionReceiver.FOLLOW_NO to "Supprimer")) {
            val pi = PendingIntent.getBroadcast(ctx, id + act.hashCode(),
                Intent(ctx, ActionReceiver::class.java).setAction(act).putExtra("username", f.username)
                    .putExtra("name", f.name).putExtra("avatar", f.avatar),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            b.addAction(NotificationCompat.Action.Builder(0, label, pi).setShowsUserInterface(false).build())
        }
        NotificationManagerCompat.from(ctx).notify(id, b.build())
    }

    fun onFollowDone(ctx: Context, f: Follow, accept: Boolean, ok: Boolean) = io.execute {
        postFollow(ctx, f, if (!ok) "Échec : ouvrez les demandes dans l'app" else if (accept) "Demande acceptée ✓" else "Demande supprimée")
        if (ok) main.postDelayed({ NotificationManagerCompat.from(ctx).cancel(idFor("fr_${f.username}")) }, 2500)
    }

    // ------------------------------------------------------------------ demandes de messages
    @Suppress("MissingPermission")
    fun onMsgRequests(ctx: Context, count: Int) = io.execute {
        val st = state(ctx)
        val before = st.getInt("msgreq", -1)
        st.edit().putInt("msgreq", count).apply()
        val prefs = Prefs(ctx)
        if (count <= 0) { NotificationManagerCompat.from(ctx).cancel(REQ_ID); return@execute }
        if (before < 0 || count <= before || !prefs.bool("notifMsgRequests") || !canPost(ctx) || prefs.quietNow()) return@execute
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(ctx, REQ_ID, Intent(ctx, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
            .setData(android.net.Uri.parse("${ScriptLib.IG}/direct/requests/")), PendingIntent.FLAG_IMMUTABLE)
        NotificationManagerCompat.from(ctx).notify(REQ_ID, NotificationCompat.Builder(ctx, CHANNEL_REQ)
            .setSmallIcon(R.drawable.ic_tab_direct).setContentTitle("Demandes de messages")
            .setContentText(if (count == 1) "1 demande en attente" else "$count demandes en attente")
            .setContentIntent(open).setAutoCancel(true).build())
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
