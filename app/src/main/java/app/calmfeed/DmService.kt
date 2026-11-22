package app.calmfeed

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Service d'arrière-plan :
 *  - garde la connexion temps réel aux messages quand l'app est fermée (mode Instantané) ;
 *  - exécute les actions venues des notifications sans ouvrir l'app : répondre, confirmer ou
 *    supprimer une demande d'abonnement ;
 *  - vérifie les demandes d'abonnement : quand la pastille ♥ apparaît (app ouverte), sinon au plus
 *    toutes les 30 min (app fermée), jamais la nuit.
 * Chaque tâche ponctuelle utilise une page invisible détruite dès la fin.
 */
class DmService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private var dmWeb: WebView? = null
    private var dmReady = false
    private var dmStartedAt = 0L
    private val dmQueue = ArrayList<String>()
    private val replies = HashMap<String, Pair<String, String>>()      // ref -> (clé, texte)
    private var lastFollowCheck = 0L
    private var tasks = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Connexion aux messages", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Garde la connexion aux messages privés pour les notifications instantanées"
                setShowBadge(false)
            })
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_tab_direct)
            .setContentTitle("Messages connectés")
            .setContentText("Notifications instantanées actives")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true).setSilent(true).setContentIntent(open).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ID, n)
        lastFollowCheck = getSharedPreferences("notif_state", MODE_PRIVATE).getLong("follow_check", 0)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_REPLY -> {
                val ref = intent.getStringExtra(Notifier.EXTRA_REF) ?: return START_NOT_STICKY
                val key = intent.getStringExtra(Notifier.EXTRA_NAME) ?: ref
                val text = intent.getStringExtra(Notifier.EXTRA_TEXT) ?: return START_NOT_STICKY
                replies[ref] = key to text
                runOnDm("window.__cf&&window.__cf.sendTo(${JSONObject.quote(ref)},${JSONObject.quote(text)})")
            }
            ACTION_FOLLOW_CHECK -> followCheck(force = intent.getBooleanExtra("force", false))
            ACTION_FOLLOW_ACT -> {
                val f = Notifier.Follow(intent.getStringExtra("username") ?: return START_NOT_STICKY,
                    intent.getStringExtra("name") ?: "", intent.getStringExtra("avatar") ?: "")
                val accept = intent.getBooleanExtra("accept", false)
                runTask("/notifications/",
                    "window.__cf&&window.__cf.followAct(${JSONObject.quote(f.username)},$accept)",
                    onFollowDone = { u, a, ok -> if (u == f.username) Notifier.onFollowDone(this, f, a, ok) })
            }
        }
        main.removeCallbacks(watchdog)
        main.post(watchdog)
        return START_STICKY
    }

    // ------------------------------------------------------------------ connexion temps réel
    private val watchdog = object : Runnable {
        override fun run() {
            val prefs = Prefs(this@DmService)
            val appHandles = MainActivity.live?.get()?.hasDirectTab() == true
            val instant = wanted(this@DmService)
            when {
                !instant && dmQueue.isEmpty() && tasks == 0 -> { dropDm(); stopSelf(); return }
                (prefs.quietNow() || appHandles || !instant) && dmQueue.isEmpty() -> dropDm()
                dmWeb == null && instant -> createDm(prefs)
                SystemClock.elapsedRealtime() - dmStartedAt > 6 * 3600_000 && dmQueue.isEmpty() -> { dropDm(); createDm(prefs) }
            }
            // App fermée : demandes d'abonnement au plus toutes les 30 min.
            if (instant && !appHandles && !prefs.quietNow()) followCheck(force = false)
            main.postDelayed(this, 60_000)
        }
    }

    private fun runOnDm(js: String) {
        val live = MainActivity.live?.get()
        if (live != null && live.hasDirectTab()) { live.evalOnDirect(js); return }
        if (dmWeb == null) createDm(Prefs(this))
        if (dmReady) dmWeb?.evaluateJavascript(js, null) else dmQueue.add(js)
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun newWeb(prefs: Prefs, path: String, tab: String, bridge: Any): WebView {
        val w = WebView(applicationContext)
        ScriptLib.configure(w, this)
        w.settings.mediaPlaybackRequiresUserGesture = true
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true)
        w.webViewClient = WebViewClient()
        w.addJavascriptInterface(bridge, "CalmApp")
        val dm = resources.displayMetrics      // taille réelle : la page doit être mise en page pour être lue
        w.measure(View.MeasureSpec.makeMeasureSpec(dm.widthPixels, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(dm.heightPixels, View.MeasureSpec.EXACTLY))
        w.layout(0, 0, dm.widthPixels, dm.heightPixels)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, ScriptLib.script(this, prefs.toJsConfig(), tab), setOf(ScriptLib.IG))
        }
        // Une page hors fenêtre démarre « en pause » : on la réveille explicitement.
        w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        w.onResume()
        w.resumeTimers()
        w.loadUrl(ScriptLib.IG + path)
        return w
    }

    private fun createDm(prefs: Prefs) {
        dmReady = false
        dmWeb = newWeb(prefs, "/direct/inbox/", "direct", Bridge(
            onReady = { main.post { dmReady = true; for (js in dmQueue) dmWeb?.evaluateJavascript(js, null); dmQueue.clear() } }))
        dmStartedAt = SystemClock.elapsedRealtime()
    }

    private fun dropDm() { dmWeb?.apply { stopLoading(); destroy() }; dmWeb = null; dmReady = false }

    // ------------------------------------------------------------------ tâches ponctuelles
    private fun runTask(path: String, js: String, onFollowDone: ((String, Boolean, Boolean) -> Unit)? = null) {
        tasks++
        var web: WebView? = null
        val finish = Runnable { web?.apply { stopLoading(); destroy() }; web = null; tasks-- }
        web = newWeb(Prefs(this), path, "other", Bridge(
            onReady = { main.post { web?.evaluateJavascript(js, null) } },
            onFollowList = { json -> Notifier.onFollowRequests(this, json); main.post(finish) },
            onFollowDone = { u, a, ok -> onFollowDone?.invoke(u, a, ok); main.post(finish) }))
        main.postDelayed(finish, 45_000)                           // garde-fou
    }

    private fun followCheck(force: Boolean) {
        val prefs = Prefs(this)
        if (!prefs.bool("notifEnabled") || !prefs.bool("notifFollow") || !Notifier.canPost(this)) return
        val now = System.currentTimeMillis()
        if (!force && now - lastFollowCheck < 30 * 60_000) return
        if (force && now - lastFollowCheck < 60_000) return     // pastille : au plus 1 fois / 5 min
        lastFollowCheck = now
        getSharedPreferences("notif_state", MODE_PRIVATE).edit().putLong("follow_check", now).apply()
        runTask("/notifications/", "window.__cf&&window.__cf.followRequests()")
    }

    override fun onDestroy() {
        main.removeCallbacks(watchdog)
        dropDm()
        super.onDestroy()
    }

    private inner class Bridge(
        val onReady: () -> Unit = {},
        val onFollowList: (String) -> Unit = {},
        val onFollowDone: (String, Boolean, Boolean) -> Unit = { _, _, _ -> },
    ) {
        @JavascriptInterface fun dmUnread(json: String) = Notifier.onInbox(applicationContext, Notifier.parse(json), silent = false)
        @JavascriptInterface fun dmSent(ref: String, ok: Boolean) {
            val (key, text) = replies.remove(ref) ?: return
            Notifier.onReplied(applicationContext, key, text, ok)
        }
        @JavascriptInterface fun msgRequests(n: Int) = Notifier.onMsgRequests(applicationContext, n)
        @JavascriptInterface fun followRequests(json: String) = onFollowList(json)
        @JavascriptInterface fun followDone(u: String, accept: Boolean, ok: Boolean) = onFollowDone(u, accept, ok)
        @JavascriptInterface fun ready() = onReady()
        @JavascriptInterface fun activityBadge(on: Boolean) {}
        @JavascriptInterface fun setUser(name: String, avatar: String) {}
        @JavascriptInterface fun badge(id: String, count: Int) {}
        @JavascriptInterface fun toast(msg: String) {}
        @JavascriptInterface fun haptic() {}
        @JavascriptInterface fun switchTab(id: String) {}
        @JavascriptInterface fun openSettings() {}
        @JavascriptInterface fun openCreate() {}
        @JavascriptInterface fun back() {}
    }

    companion object {
        private const val CHANNEL = "dm_link"
        private const val ID = 77
        const val ACTION_REPLY = "app.calmfeed.REPLY"
        const val ACTION_FOLLOW_CHECK = "app.calmfeed.FOLLOW_CHECK"
        const val ACTION_FOLLOW_ACT = "app.calmfeed.FOLLOW_ACT"

        /** Mode « instantané » choisi et notifications autorisées ? */
        fun wanted(ctx: Context): Boolean {
            val p = Prefs(ctx)
            return p.bool("notifEnabled") && p.int("notifInterval") == 1 && Notifier.canPost(ctx)
        }

        fun sync(ctx: Context) {
            val i = Intent(ctx, DmService::class.java)
            if (wanted(ctx)) {
                try { ctx.startForegroundService(i) } catch (_: Exception) { }
            } else ctx.stopService(i)
        }

        /** Démarre le service pour une action (réponse, demande d'abonnement…). */
        fun send(ctx: Context, intent: Intent) {
            try { ctx.startForegroundService(intent.setClass(ctx, DmService::class.java)) } catch (_: Exception) { }
        }
    }
}
