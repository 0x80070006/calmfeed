package app.calmfeed

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var prefs: Prefs

    private var scriptHandler: ScriptHandler? = null
    private var docStartSupported = false
    private var installedConfig: String? = null
    private var installedContent: String? = null
    private var scriptBody: String = ""

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var resumedAt = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        scriptBody = SCRIPTS.joinToString("\n;\n") { name ->
            assets.open("js/$name").bufferedReader().use { it.readText() }
        }

        setContentView(buildLayout())
        applyChrome()

        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)   // chrome://inspect, builds debug uniquement
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = prefs.bool("noAutoplay")
            setSupportMultipleWindows(false)
            loadWithOverviewMode = true
            useWideViewPort = true
            textZoom = prefs.textZoom
            // Fluidité : pré-rendu des zones hors écran (défilement sans tuiles blanches).
            offscreenPreRaster = true
            // UA Chrome Android standard : on retire seulement les marqueurs WebView.
            userAgentString = WebSettings.getDefaultUserAgent(this@MainActivity)
                .replace("; wv", "")
                .replace(Regex("Version/\\S+ "), "")
        }
        // Le moteur de rendu garde une priorité haute même brièvement en arrière-plan.
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        web.webViewClient = Client()
        web.webChromeClient = Chrome()
        web.addJavascriptInterface(AppBridge(), "CalmApp")

        installScript()

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { handleBack() }
        }

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl(intent?.data?.takeIf { isAllowedHost(it) }?.toString() ?: startUrl())
        }
    }

    private fun startUrl() = if (prefs.bool("startOnInbox")) "$IG/direct/inbox/" else "$IG/"

    // ------------------------------------------------------------------ interface native

    private fun dp(v: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
    ).toInt()

    /**
     * Plus de barre native : la page occupe tout l'écran sous la barre d'état, et l'en-tête
     * (＋, ♥, ⚙) est dessiné dans la page par chrome.js. Seule une fine ligne de chargement
     * se superpose en haut.
     */
    private fun buildLayout(): View {
        root = FrameLayout(this)

        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.INVISIBLE
        }
        root.addView(progress, FrameLayout.LayoutParams(MATCH_PARENT, dp(2), Gravity.TOP))

        // Edge-to-edge (targetSdk 35+) : on applique les marges système nous-mêmes.
        root.setOnApplyWindowInsetsListener { v, insets ->
            @Suppress("DEPRECATION")
            v.setPadding(
                insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom
            )
            insets
        }
        return root
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
        @Suppress("DEPRECATION")
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }

    /**
     * Pont appelé par le bouton ⚙ de l'en-tête dans la page. Une seule méthode, sans paramètre ni
     * valeur de retour : la page ne peut rien faire d'autre qu'ouvrir l'écran de réglages.
     */
    private inner class AppBridge {
        @JavascriptInterface
        fun openSettings() = runOnUiThread { this@MainActivity.openSettings() }
    }

    /** Couleurs des barres système et du fond selon le thème choisi. */
    private fun applyChrome() {
        val c = Themes.chrome(this, prefs.theme())
        root.setBackgroundColor(c.bg)
        window.decorView.setBackgroundColor(c.bg)
        progress.progressTintList = ColorStateList.valueOf(c.accent)
        progress.progressBackgroundTintList = ColorStateList.valueOf(c.bg)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (c.dark) 0 else mask, mask)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                if (c.dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
    }

    // ------------------------------------------------------------------ injection

    /** Enregistre les scripts pour qu'ils s'exécutent avant le JS d'Instagram. */
    private fun installScript() {
        installedConfig = prefs.toJsConfig()
        installedContent = prefs.contentJson().toString()
        docStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (docStartSupported) {
            scriptHandler?.remove()
            scriptHandler = WebViewCompat.addDocumentStartJavaScript(web, fullScript(), setOf(IG))
        }
    }

    private fun fullScript() = "window.__CF=$installedConfig;\n$scriptBody"

    // ------------------------------------------------------------------ cycle de vie

    override fun onResume() {
        super.onResume()
        web.onResume()
        resumedAt = SystemClock.elapsedRealtime()
        applyChrome()
        web.settings.textZoom = prefs.textZoom

        if (installedConfig != prefs.toJsConfig()) {
            val contentChanged = installedContent != prefs.contentJson().toString()
            web.settings.mediaPlaybackRequiresUserGesture = prefs.bool("noAutoplay")
            installScript()
            if (contentChanged) {
                web.reload()
            } else {
                // Seul le thème a changé : appliqué en direct, sans recharger (aucune requête).
                val cfg = JSONObject(installedConfig!!)
                web.evaluateJavascript(
                    "window.__cf&&window.__cf.setTheme(${cfg.opt("palette")},${cfg.optBoolean("paletteDark")},${cfg.optBoolean("decoShapes")})", null
                )
            }
        }
    }

    override fun onPause() {
        prefs.addUsage(SystemClock.elapsedRealtime() - resumedAt)
        CookieManager.getInstance().flush()
        web.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    /** Retour : 1) panneau CalmFeed ouvert 2) historique de la page 3) mise en arrière-plan. */
    private fun handleBack() {
        web.evaluateJavascript("!!(window.__cf&&window.__cf.back())") { handled ->
            if (handled == "true") return@evaluateJavascript
            if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
        }
    }

    // Android < 13 : touche retour classique. Android 13+ : OnBackInvokedCallback (enregistré dans onCreate).
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK || Build.VERSION.SDK_INT >= 33) return super.onKeyDown(keyCode, event)
        handleBack()
        return true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.takeIf { isAllowedHost(it) }?.let { web.loadUrl(it.toString()) }
    }

    // ------------------------------------------------------------------ navigation

    private fun isAllowedHost(uri: Uri): Boolean {
        val h = uri.host ?: return false
        return h == "instagram.com" || h.endsWith(".instagram.com") ||
            h == "facebook.com" || h.endsWith(".facebook.com") // connexion via Facebook / Accounts Center
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.scheme == "http" || uri.scheme == "https") {
                if (uri.path?.startsWith("/ads/") == true) return true   // liens publicitaires : jamais ouverts
                if (isAllowedHost(uri)) return false
            }
            try {
                startActivity(Intent(Intent.ACTION_VIEW, uri))         // lien externe : navigateur
            } catch (_: ActivityNotFoundException) { }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // Fallback si DOCUMENT_START_SCRIPT n'est pas disponible (WebView très ancienne).
            if (!docStartSupported && url?.startsWith(IG) == true) view.evaluateJavascript(fullScript(), null)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            CookieManager.getInstance().flush()
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.INVISIBLE
        }

        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(params.createIntent(), REQ_FILE)
                true
            } catch (_: ActivityNotFoundException) {
                fileCallback = null
                false
            }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            if (request.origin.host?.endsWith("instagram.com") != true) {
                request.deny(); return
            }
            val needed = request.resources.mapNotNull {
                when (it) {
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                    else -> null
                }
            }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

            if (needed.isEmpty()) {
                request.grant(request.resources)
            } else {
                pendingPermission = request
                requestPermissions(needed.toTypedArray(), REQ_PERM)
            }
        }
    }

    @Deprecated("Activity framework API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        if (code != REQ_PERM) return
        val req = pendingPermission ?: return
        pendingPermission = null
        val granted = req.resources.filter {
            when (it) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                    checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                else -> false
            }
        }
        if (granted.isEmpty()) req.deny() else req.grant(granted.toTypedArray())
    }

    companion object {
        const val IG = "https://www.instagram.com"
        private val SCRIPTS = listOf("core.js", "theme.js", "feed.js", "social.js", "explore.js", "chrome.js", "nonfollowers.js", "boot.js")
        private const val REQ_FILE = 41
        private const val REQ_PERM = 42
    }
}
