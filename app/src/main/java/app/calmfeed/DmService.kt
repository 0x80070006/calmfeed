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
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Notifications instantanées, sans requête périodique.
 *
 * Instagram pousse les messages en temps réel sur une connexion ouverte (pas d'API à interroger).
 * Ce service garde cette connexion vivante quand l'app est en arrière-plan :
 *  - l'onglet Messages de l'app s'en charge tant qu'elle existe ;
 *  - si l'app a été fermée, le service ouvre seul la page Messages, invisible ;
 *  - toutes les minutes, un contrôle LOCAL (aucune requête) vérifie que la page est vivante ;
 *  - heures calmes : la connexion est coupée la nuit (batterie), puis rétablie à 8 h.
 * Android exige une notification permanente pour ce type de service : elle est réduite au minimum.
 */
class DmService : Service() {

    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var webStartedAt = 0L
    private var lastReport = 0L

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
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ID, n)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        main.removeCallbacks(watchdog)
        main.post(watchdog)
        return START_STICKY
    }

    /** Contrôle local, toutes les minutes. */
    private val watchdog = object : Runnable {
        override fun run() {
            val prefs = Prefs(this@DmService)
            if (!wanted(this@DmService)) { stopSelf(); return }
            val appHandles = MainActivity.live?.get()?.hasDirectTab() == true
            when {
                prefs.quietNow() || appHandles -> dropWeb()                        // nuit, ou l'app s'en charge
                web == null -> createWeb(prefs)
                SystemClock.elapsedRealtime() - webStartedAt > 6 * 3600_000 -> { dropWeb(); createWeb(prefs) }  // rafraîchit 1×/6 h
            }
            main.postDelayed(this, 60_000)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWeb(prefs: Prefs) {
        val w = WebView(applicationContext)
        ScriptLib.configure(w, this)
        w.settings.mediaPlaybackRequiresUserGesture = true
        w.settings.blockNetworkImage = false                  // photos des expéditeurs pour la notification
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true)
        w.webViewClient = WebViewClient()
        w.addJavascriptInterface(Bridge(), "CalmApp")
        // Taille d'écran réelle : la page doit être mise en page pour qu'on lise la liste.
        val dm = resources.displayMetrics
        w.measure(
            android.view.View.MeasureSpec.makeMeasureSpec(dm.widthPixels, android.view.View.MeasureSpec.EXACTLY),
            android.view.View.MeasureSpec.makeMeasureSpec(dm.heightPixels, android.view.View.MeasureSpec.EXACTLY))
        w.layout(0, 0, dm.widthPixels, dm.heightPixels)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, ScriptLib.script(this, prefs.toJsConfig(), "direct"), setOf(ScriptLib.IG))
        }
        w.loadUrl("${ScriptLib.IG}/direct/inbox/")
        web = w
        webStartedAt = SystemClock.elapsedRealtime()
    }

    private fun dropWeb() {
        web?.apply { stopLoading(); destroy() }
        web = null
    }

    override fun onDestroy() {
        main.removeCallbacks(watchdog)
        dropWeb()
        super.onDestroy()
    }

    private inner class Bridge {
        @JavascriptInterface fun dmUnread(json: String) {
            lastReport = SystemClock.elapsedRealtime()
            Notifier.onInbox(applicationContext, Notifier.parse(json), silent = false)
        }
        @JavascriptInterface fun dmSent(name: String, ok: Boolean) {}
        @JavascriptInterface fun ready() {}
        @JavascriptInterface fun setUser(name: String, avatar: String) {}
        @JavascriptInterface fun badge(id: String, count: Int) {}
        @JavascriptInterface fun toast(msg: String) {}
        @JavascriptInterface fun haptic() {}
        @JavascriptInterface fun switchTab(id: String) {}
        @JavascriptInterface fun openSettings() {}
        @JavascriptInterface fun openCreate() {}
    }

    companion object {
        private const val CHANNEL = "dm_link"
        private const val ID = 77

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
    }
}
