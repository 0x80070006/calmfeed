package app.calmfeed

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * Contrôle des messages quand l'app est fermée : ouvre la liste « Messages » une fois, sans l'afficher,
 * comme un coup d'œil rapide à l'app, lit les non-lus puis referme tout.
 *  - jamais si l'app tourne déjà (le temps réel s'en charge) ni pendant les heures calmes ;
 *  - intervalle choisi (15/30/60 min) avec ±20 % d'aléa, pour ne pas taper à heure fixe.
 */
class InboxWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        val prefs = Prefs(ctx)
        try {
            if (!prefs.bool("notifEnabled") || prefs.int("notifInterval") == 0 || !Notifier.canPost(ctx)) return Result.success()
            if (prefs.quietNow()) return Result.success()
            if (MainActivity.live?.get() != null) return Result.success()                 // app vivante : temps réel
            if (System.currentTimeMillis() - prefs.lastForeground < 10 * 60_000) return Result.success()

            val latch = CountDownLatch(1)
            var report: String? = null
            val main = Handler(Looper.getMainLooper())
            var web: WebView? = null
            main.post { web = createHeadless(ctx, prefs) { json -> report = json; latch.countDown() } }
            latch.await(40, TimeUnit.SECONDS)
            main.post { web?.apply { stopLoading(); destroy() } }
            report?.let { Notifier.onInbox(ctx, Notifier.parse(it), silent = false) }
            return Result.success()
        } finally {
            schedule(ctx)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createHeadless(ctx: Context, prefs: Prefs, onReport: (String) -> Unit): WebView {
        val web = WebView(ctx)
        ScriptLib.configure(web, ctx)
        web.settings.mediaPlaybackRequiresUserGesture = true
        web.settings.blockNetworkImage = true                    // inutile pour lire la liste
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.webViewClient = WebViewClient()
        web.addJavascriptInterface(HeadlessBridge(onReport), "CalmApp")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, ScriptLib.script(ctx, prefs.toJsConfig(), "direct"), setOf(ScriptLib.IG))
        }
        val dm = ctx.resources.displayMetrics      // taille réelle : la liste doit être mise en page pour être lue
        web.measure(
            android.view.View.MeasureSpec.makeMeasureSpec(dm.widthPixels, android.view.View.MeasureSpec.EXACTLY),
            android.view.View.MeasureSpec.makeMeasureSpec(dm.heightPixels, android.view.View.MeasureSpec.EXACTLY))
        web.layout(0, 0, dm.widthPixels, dm.heightPixels)
        web.loadUrl("${ScriptLib.IG}/direct/inbox/")
        return web
    }

    /** Pont minimal : seul le rapport des non-lus nous intéresse ici. */
    private class HeadlessBridge(private val onReport: (String) -> Unit) {
        private var done = false
        @JavascriptInterface fun dmUnread(json: String) { if (!done) { done = true; onReport(json) } }
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
        private const val NAME = "calmfeed-inbox"

        /** Planifie (ou annule) le prochain contrôle selon les réglages. */
        fun schedule(ctx: Context) {
            val prefs = Prefs(ctx)
            val wm = WorkManager.getInstance(ctx)
            val minutes = prefs.int("notifInterval")
            // 0 = jamais ; 1 = instantané (DmService, pas de contrôles périodiques).
            if (!prefs.bool("notifEnabled") || minutes <= 1) { wm.cancelUniqueWork(NAME); return }
            val jitter = 1.0 + Random.nextDouble(-0.2, 0.2)
            val req = OneTimeWorkRequestBuilder<InboxWorker>()
                .setInitialDelay((minutes * 60 * jitter).toLong(), TimeUnit.SECONDS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            wm.enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
