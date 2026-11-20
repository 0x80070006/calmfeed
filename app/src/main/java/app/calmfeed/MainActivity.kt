package app.calmfeed

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var progress: ProgressBar
    private lateinit var usageLabel: TextView
    private lateinit var prefs: Prefs

    private var scriptHandler: ScriptHandler? = null
    private var docStartSupported = false
    private var installedConfig: String? = null
    private var filterScript: String = ""

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var resumedAt = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        filterScript = assets.open("filter.js").bufferedReader().use { it.readText() }

        setContentView(buildLayout())

        // ---- WebView ----
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = prefs.flag("noAutoplay")
            setSupportMultipleWindows(false)
            loadWithOverviewMode = true
            useWideViewPort = true
            // UA Chrome Android standard : on retire seulement les marqueurs WebView.
            userAgentString = WebSettings.getDefaultUserAgent(this@MainActivity)
                .replace("; wv", "")
                .replace(Regex("Version/\\S+ "), "")
        }
        web.webViewClient = Client()
        web.webChromeClient = Chrome()

        installScript()

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl(intent?.data?.takeIf { isAllowedHost(it) }?.toString() ?: startUrl())
        }
    }

    private fun startUrl() =
        if (prefs.flag("startOnInbox")) "$IG/direct/inbox/" else "$IG/"

    // ------------------------------------------------------------------ layout

    private fun dp(v: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
    ).toInt()

    private fun buildLayout(): View {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        // Barre native fine : temps du jour + raccourcis
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(4), 0)
        }
        usageLabel = TextView(this).apply {
            textSize = 13f
            alpha = 0.7f
        }
        bar.addView(usageLabel, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        bar.addView(barButton("✉", "Messages") { web.loadUrl("$IG/direct/inbox/") })
        bar.addView(barButton("⌂", "Accueil") { web.loadUrl("$IG/") })
        bar.addView(barButton("⚙", "Réglages") {
            startActivity(Intent(this, SettingsActivity::class.java))
        })
        root.addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, dp(40)))

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
            visibility = View.GONE
        }
        root.addView(progress, LinearLayout.LayoutParams(MATCH_PARENT, dp(3)))

        web = WebView(this)
        root.addView(web, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))

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

    private fun barButton(label: String, desc: String, onClick: () -> Unit) =
        TextView(this).apply {
            text = label
            contentDescription = desc
            textSize = 20f
            gravity = Gravity.CENTER
            setPadding(dp(12), 0, dp(12), 0)
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
            setOnClickListener { onClick() }
        }.also { it.layoutParams = LinearLayout.LayoutParams(WRAP_CONTENT, MATCH_PARENT) }

    // ------------------------------------------------------------------ injection

    /** Enregistre filter.js pour qu'il s'exécute avant le JS d'Instagram. */
    private fun installScript() {
        val config = prefs.toJsConfig()
        installedConfig = config
        docStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (docStartSupported) {
            scriptHandler?.remove()
            scriptHandler = WebViewCompat.addDocumentStartJavaScript(
                web, fullScript(config), setOf(IG)
            )
        }
    }

    private fun fullScript(config: String) = "window.__CF=$config;\n$filterScript"

    // ------------------------------------------------------------------ cycle de vie

    override fun onResume() {
        super.onResume()
        web.onResume()
        resumedAt = SystemClock.elapsedRealtime()
        refreshUsage()
        // Réglages modifiés : réinstaller le script et recharger.
        if (installedConfig != prefs.toJsConfig()) {
            web.settings.mediaPlaybackRequiresUserGesture = prefs.flag("noAutoplay")
            installScript()
            web.reload()
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

    private fun refreshUsage() {
        val min = prefs.usageTodayMs() / 60_000
        usageLabel.text = "Aujourd'hui : $min min"
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
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
                // Liens publicitaires : jamais ouverts.
                if (uri.path?.startsWith("/ads/") == true) return true
                if (isAllowedHost(uri)) return false
            }
            // Lien externe : navigateur du téléphone.
            try {
                startActivity(Intent(Intent.ACTION_VIEW, uri))
            } catch (_: ActivityNotFoundException) { }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            // Fallback si DOCUMENT_START_SCRIPT n'est pas dispo (WebView très ancienne).
            if (!docStartSupported && url?.startsWith(IG) == true) {
                view.evaluateJavascript(fullScript(installedConfig ?: prefs.toJsConfig()), null)
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            CookieManager.getInstance().flush()
            refreshUsage()
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
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
        private const val REQ_FILE = 41
        private const val REQ_PERM = 42
    }
}
