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
 * Aucune requête réseau ; la page parle à l'app via le pont CalmBridge.
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

    override fun onDestroy() {
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
            return ok
        }

        @JavascriptInterface
        fun reset(): String {
            prefs.reset()
            runOnUiThread { applyChrome() }
            return prefs.stateJson()
        }

        @JavascriptInterface
        fun close() = runOnUiThread { finish() }
    }
}
