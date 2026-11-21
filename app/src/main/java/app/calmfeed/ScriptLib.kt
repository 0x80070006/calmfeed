package app.calmfeed

import android.content.Context
import android.webkit.WebSettings
import android.webkit.WebView

/** Scripts injectés et réglages WebView communs (onglets de l'app et contrôle en arrière-plan). */
object ScriptLib {
    const val IG = "https://www.instagram.com"

    private val FILES = listOf(
        "core.js", "theme.js", "feed.js", "social.js", "explore.js", "reels.js",
        "gestures.js", "stories.js", "notify.js", "chrome.js", "nonfollowers.js", "boot.js",
    )
    private var body: String? = null

    fun body(ctx: Context): String = body ?: FILES.joinToString("\n;\n") { name ->
        ctx.assets.open("js/$name").bufferedReader().use { it.readText() }
    }.also { body = it }

    fun script(ctx: Context, config: String, tab: String) =
        "window.__CF=Object.assign($config,{tab:'$tab'});\n${body(ctx)}"

    /** User-Agent Chrome Android standard : on retire seulement les marqueurs WebView. */
    fun userAgent(ctx: Context): String = WebSettings.getDefaultUserAgent(ctx)
        .replace("; wv", "")
        .replace(Regex("Version/\\S+ "), "")

    fun configure(web: WebView, ctx: Context) {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportMultipleWindows(false)
            loadWithOverviewMode = true
            useWideViewPort = true
            userAgentString = userAgent(ctx)
        }
    }
}
