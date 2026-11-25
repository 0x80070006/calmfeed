package app.calmfeed

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.FrameLayout
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Écran de réglages : page locale (assets/settings.html) dans une WebView isolée.
 * La page elle-même ne charge rien du réseau ; elle parle à l'app via le pont CalmBridge.
 * Seul l'écran « Mises à jour » contacte GitHub (Updater), et uniquement quand il est ouvert.
 */
class SettingsActivity : Activity() {

    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var root: FrameLayout

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)

        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.blockNetworkLoads = true
            isVerticalScrollBarEnabled = false
            webViewClient = object : WebViewClient() {
                // La page ne navigue jamais ailleurs.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            }
            addJavascriptInterface(Bridge(), "CalmBridge")
        }
        // Conteneur qui reçoit les marges système (la WebView ne les applique pas elle-même).
        val frame = FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            setOnApplyWindowInsetsListener { v, insets ->
                @Suppress("DEPRECATION")
                v.setPadding(0, insets.systemWindowInsetTop, 0, insets.systemWindowInsetBottom)
                insets
            }
        }
        root = frame
        applyChrome()
        setContentView(frame)
        web.loadUrl("file:///android_asset/settings.html")
        Updater.listener = { st -> pushUpdate(st) }
        if (Build.VERSION.SDK_INT >= 33) onBackInvokedDispatcher.registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBack() }
    }

    // ------------------------------------------------------------------ mise à jour

    private fun pushUpdate(st: org.json.JSONObject) {
        if (::web.isInitialized) web.evaluateJavascript("window.onUpdate&&window.onUpdate($st)", null)
    }

    /** Après le téléchargement vérifié : autorisations, puis session d'installation. */
    private fun proceedInstall() {
        if (!Updater.hasApk()) return
        if (!Updater.canInstallPackages(this)) { Updater.needPermission(); return }
        if (Build.VERSION.SDK_INT >= 33 && !Updater.askedNotif(this) &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            // Pour la notification « CalmFeed est à jour » : demandée une fois, on continue même si refusée.
            Updater.markAskedNotif(this)
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQ_UPDATE_NOTIF)
            return
        }
        Updater.install(this)
    }

    private fun applyChrome() {
        val c = Themes.chrome(this, prefs.theme())
        web.setBackgroundColor(c.bg)
        root.setBackgroundColor(c.bg)
        window.decorView.setBackgroundColor(c.bg)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (c.dark) 0 else mask, mask)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (c.dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
    }

    private fun askNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 7)
        } else if (!Notifier.canPost(this)) {
            startActivity(android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName))
        }
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        if (code == REQ_UPDATE_NOTIF) { Updater.install(this); return }
        web.evaluateJavascript("window.onNotifPermission&&window.onNotifPermission()", null)
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.evaluateJavascript("window.onNotifPermission&&window.onNotifPermission()", null)
        // Retour des réglages « Installer des applis inconnues » : l'installation reprend seule.
        if (Updater.state.optString("s") == "permission" && Updater.canInstallPackages(this)) proceedInstall()
    }

    /** Retour : referme d'abord la sous-page « Mises à jour » si elle est ouverte. */
    private fun goBack() {
        web.evaluateJavascript("window.closeSub?window.closeSub():false") { r -> if (r != "true") finish() }
    }

    @Deprecated("Android 12 et moins ; Android 13+ passe par OnBackInvokedCallback.")
    override fun onBackPressed() = goBack()

    override fun onDestroy() {
        if (Updater.listener != null) Updater.listener = null
        web.destroy()
        super.onDestroy()
    }

    override fun finish() {
        super.finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }

    private inner class Bridge {
        @JavascriptInterface
        fun state(): String = prefs.stateJson()

        @JavascriptInterface
        fun set(key: String, value: String): Boolean {
            val ok = prefs.set(key, value)
            if (ok && (key == "bg" || key == "accent")) runOnUiThread { applyChrome() }
            if (ok && key.startsWith("notif")) {
                InboxWorker.schedule(applicationContext)
                DmService.sync(applicationContext)
                if (key == "notifEnabled" && value == "true") runOnUiThread { askNotifPermission() }
            }
            return ok
        }

        /** Notifications autorisées par Android ? (sinon l'écran affiche un avertissement) */
        @JavascriptInterface
        fun notifAllowed(): Boolean = Notifier.canPost(applicationContext)

        @JavascriptInterface
        fun askNotif() = runOnUiThread { askNotifPermission() }

        @JavascriptInterface
        fun testNotif() {
            if (!Notifier.canPost(applicationContext)) { runOnUiThread { askNotifPermission() }; return }
            Notifier.showTest(applicationContext)
        }

        /** Son, vibration, écran verrouillé : réglages Android du canal « Messages privés ». */
        @JavascriptInterface
        fun openNotifSystem() = runOnUiThread {
            Notifier.ensureChannel(this@SettingsActivity)
            startActivity(android.content.Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)
                .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID, Notifier.CHANNEL))
        }

        @JavascriptInterface
        fun reset(): String {
            prefs.reset()
            runOnUiThread { applyChrome() }
            return prefs.stateJson()
        }

        @JavascriptInterface
        fun close() = runOnUiThread { finish() }

        // ---- mises à jour ----

        /** Version installée, option bêta, dernier état connu. */
        @JavascriptInterface
        fun updInfo(): String = org.json.JSONObject()
            .put("installed", Updater.installedVersion(applicationContext))
            .put("beta", Updater.beta(applicationContext))
            .put("state", Updater.state)
            .toString()

        @JavascriptInterface
        fun updCheck() = Updater.check(applicationContext)

        @JavascriptInterface
        fun updSetBeta(on: Boolean) = Updater.setBeta(applicationContext, on)

        @JavascriptInterface
        fun updStart() = runOnUiThread {
            if (Updater.hasApk()) proceedInstall()
            else Updater.download(applicationContext) { proceedInstall() }
        }

        /** Ouvre « Installer des applis inconnues » pour CalmFeed ; l'installation reprend au retour. */
        @JavascriptInterface
        fun updGrant() = runOnUiThread {
            startActivity(android.content.Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                android.net.Uri.parse("package:$packageName")))
        }
    }

    companion object { private const val REQ_UPDATE_NOTIF = 8 }
}
