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
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.net.URL

/**
 * Coque native : une WebView par onglet (Accueil, Recherche, Reels, Messages, Profil), gardée en
 * mémoire sous une barre d'onglets Kotlin. Changer d'onglet = afficher une vue déjà chargée :
 * instantané, position de défilement conservée, aucune requête. Chaque onglet n'est créé
 * (et donc chargé) qu'à sa première ouverture.
 */
class MainActivity : Activity() {

    private class BarItem(val root: FrameLayout, val pill: View, val icon: ImageView, val badge: TextView)

    private lateinit var prefs: Prefs
    private lateinit var root: FrameLayout
    private lateinit var stack: FrameLayout
    private lateinit var bar: LinearLayout
    private lateinit var progress: ProgressBar
    private lateinit var toastView: TextView

    private val webs = LinkedHashMap<String, WebView>()
    private val holders = HashMap<String, View>()
    private val overlays = HashMap<String, View>()
    private val refreshers = HashMap<String, SwipeRefreshLayout>()
    private val pendingOnReady = HashMap<String, MutableList<() -> Unit>>()
    private val readyTabs = HashSet<String>()
    private val handlers = HashMap<String, ScriptHandler>()
    private val barItems = LinkedHashMap<String, BarItem>()
    private var current = "home"

    private var username: String? = null
    private var avatarUrl: String? = null
    private var pendingProfile = false

    private var docStartSupported = false
    private var installedConfig: String? = null
    private var installedContent: String? = null
    private var scriptBody: String = ""

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var resumedAt = 0L
    private var lastExitAttempt = 0L
    private var lastRefresh = 0L
    private val main = Handler(Looper.getMainLooper())

    // ------------------------------------------------------------------ onglets

    private fun tabIds(): List<String> =
        listOfNotNull("home", "explore", if (prefs.bool("hideReels")) null else "reels", "direct", "profile")

    private fun urlFor(tab: String): String? = when (tab) {
        "home" -> if (prefs.bool("followingOnly")) "$IG/?variant=following" else "$IG/"
        "explore" -> "$IG/explore/"
        "reels" -> "$IG/reels/"
        "direct" -> "$IG/direct/inbox/"
        "profile" -> username?.let { "$IG/$it/" }
        else -> null
    }

    private fun iconFor(tab: String) = when (tab) {
        "home" -> R.drawable.ic_tab_home
        "explore" -> R.drawable.ic_tab_search
        "reels" -> R.drawable.ic_tab_reels
        "direct" -> R.drawable.ic_tab_direct
        else -> R.drawable.ic_tab_profile
    }

    private fun labelFor(tab: String) = when (tab) {
        "home" -> "Accueil"; "explore" -> "Recherche"; "reels" -> "Reels"; "direct" -> "Messages"; else -> "Profil"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        scriptBody = ScriptLib.body(this)
        live = java.lang.ref.WeakReference(this)
        Notifier.ensureChannel(this)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)   // chrome://inspect, builds debug uniquement
        }
        CookieManager.getInstance().setAcceptCookie(true)

        setContentView(buildLayout())
        rebuildBar()
        applyChrome()
        refreshConfig()

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { handleBack() }
        }

        val deepLink = intent?.data?.takeIf { isAllowedHost(it) }
        if (deepLink != null) openDeepLink(deepLink)
        else switchTo(if (prefs.bool("startOnInbox")) "direct" else "home")

        // L'Accueil est toujours chargé (en arrière-plan si besoin) : sa barre Instagram, masquée,
        // fournit le pseudo, la photo de profil et la pastille Messages à la barre native.
        if (webs["home"] == null) {
            createWeb("home").loadUrl(urlFor("home")!!)
            holders["home"]?.visibility = View.INVISIBLE
        }
        // Messages chargé lui aussi en arrière-plan quand les notifications sont actives :
        // il reçoit les messages en temps réel, sans aucune requête supplémentaire.
        if (prefs.bool("notifEnabled") && webs["direct"] == null) {
            createWeb("direct").loadUrl(urlFor("direct")!!)
            holders["direct"]?.visibility = View.INVISIBLE
        }
        handleNotificationIntent(intent)
        if (prefs.bool("notifEnabled") && Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
        }
        InboxWorker.schedule(this)
        DmService.sync(this)
    }

    // ------------------------------------------------------------------ interface native

    private fun dp(v: Number) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
    ).toInt()

    private fun buildLayout(): View {
        root = FrameLayout(this)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        stack = FrameLayout(this)
        column.addView(stack, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        column.addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, dp(58)))
        root.addView(column, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.INVISIBLE
        }
        root.addView(progress, FrameLayout.LayoutParams(MATCH_PARENT, dp(2), Gravity.TOP))

        // Message discret (« Glissez à nouveau pour quitter »…), juste au-dessus de la barre.
        toastView = TextView(this).apply {
            textSize = 13.5f
            setPadding(dp(16), dp(9), dp(16), dp(9))
            alpha = 0f
            visibility = View.GONE
        }
        root.addView(toastView, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
            .apply { bottomMargin = dp(72) })

        root.setOnApplyWindowInsetsListener { v, insets ->
            @Suppress("DEPRECATION")
            v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        return root
    }

    private fun rebuildBar() {
        bar.removeAllViews()
        barItems.clear()
        for (tab in tabIds()) {
            val cell = FrameLayout(this).apply {
                contentDescription = labelFor(tab)
                isClickable = true
                setOnClickListener { onTabTapped(tab) }
            }
            val pill = View(this)
            cell.addView(pill, FrameLayout.LayoutParams(dp(64), dp(38), Gravity.CENTER))
            val icon = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_INSIDE }
            if (tab == "profile") {
                cell.addView(icon, FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER))
            } else {
                icon.setImageResource(iconFor(tab))
                cell.addView(icon, FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER))
            }
            val badge = TextView(this).apply {
                textSize = 10f
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                setPadding(dp(4), 0, dp(4), 0)
                background = GradientDrawable().apply { cornerRadius = dp(9).toFloat(); setColor(Color.rgb(255, 48, 64)) }
                visibility = View.GONE
            }
            cell.addView(badge, FrameLayout.LayoutParams(-2, dp(17), Gravity.CENTER).apply {
                leftMargin = dp(16); bottomMargin = dp(14); width = -2
            })
            bar.addView(cell, LinearLayout.LayoutParams(0, MATCH_PARENT, 1f))
            barItems[tab] = BarItem(cell, pill, icon, badge)
        }
        showAvatar()
        styleBar()
    }

    private fun blend(a: Int, b: Int, t: Float): Int = Color.rgb(
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt(),
    )

    private fun styleBar() {
        val c = Themes.chrome(this, prefs.theme())
        bar.setBackgroundColor(c.bg)
        val pillColor = blend(c.bg, c.accent, if (c.dark) 0.24f else 0.15f)
        for ((tab, item) in barItems) {
            val active = tab == current
            item.pill.background = GradientDrawable().apply { cornerRadius = dp(19).toFloat(); setColor(pillColor) }
            item.pill.visibility = if (active) View.VISIBLE else View.INVISIBLE
            if (tab != "profile" || avatarUrl == null) item.icon.imageTintList = ColorStateList.valueOf(c.text)
            item.icon.alpha = if (active) 1f else 0.82f
        }
    }

    private fun applyChrome() {
        val c = Themes.chrome(this, prefs.theme())
        root.setBackgroundColor(c.bg)
        window.decorView.setBackgroundColor(c.bg)
        progress.progressTintList = ColorStateList.valueOf(c.accent)
        progress.progressBackgroundTintList = ColorStateList.valueOf(c.bg)
        toastView.background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(c.text) }
        toastView.setTextColor(c.bg)
        for (h in refreshers.values) {
            h.setColorSchemeColors(c.accent)
            h.setProgressBackgroundColorSchemeColor(blend(c.bg, c.text, 0.08f))
        }
        styleBar()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (c.dark) 0 else mask, mask)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (c.dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
    }

    private fun showToast(msg: String) {
        toastView.text = msg
        toastView.animate().cancel()
        toastView.visibility = View.VISIBLE
        toastView.animate().alpha(1f).setDuration(160).withEndAction {
            toastView.animate().alpha(0f).setStartDelay(1700).setDuration(260)
                .withEndAction { toastView.visibility = View.GONE }.start()
        }.start()
    }

    // ------------------------------------------------------------------ avatar du profil

    private fun showAvatar() {
        val item = barItems["profile"] ?: return
        val url = avatarUrl ?: run { item.icon.setImageResource(R.drawable.ic_tab_profile); return }
        Thread {
            val bmp = try {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }
            } catch (_: Exception) { null } ?: return@Thread
            val size = minOf(bmp.width, bmp.height)
            val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            Canvas(out).drawCircle(size / 2f, size / 2f, size / 2f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                shader = BitmapShader(bmp, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
            })
            main.post {
                barItems["profile"]?.icon?.apply { imageTintList = null; setImageBitmap(out) }
            }
        }.start()
    }

    // ------------------------------------------------------------------ WebViews

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWeb(tab: String): WebView {
        val web = WebView(this)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false   // son permis ; la lecture auto est gérée par le script
            setSupportMultipleWindows(false)
            loadWithOverviewMode = true
            useWideViewPort = true
            textZoom = prefs.textZoom
            offscreenPreRaster = true
            userAgentString = ScriptLib.userAgent(this@MainActivity)
        }
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
        web.webViewClient = Client(tab)
        web.webChromeClient = Chrome(tab)
        web.addJavascriptInterface(AppBridge(tab), "CalmApp")
        installScript(tab, web)
        webs[tab] = web

        val c = Themes.chrome(this, prefs.theme())
        web.setBackgroundColor(c.bg)                       // jamais de flash blanc au chargement
        val inner: View = if (tab == "home") {
            SwipeRefreshLayout(this).apply {
                addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
                setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
                setOnRefreshListener { onPullRefresh(this, web) }
                setColorSchemeColors(c.accent)
                refreshers[tab] = this
            }
        } else web
        val frame = FrameLayout(this)
        frame.addView(inner, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        frame.addView(buildOverlay(tab), FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        holders[tab] = frame
        stack.addView(frame, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        return web
    }

    /**
     * Écran de chargement natif (couleur du thème + petit indicateur) posé sur la WebView jusqu'à ce que
     * la page signale qu'elle est prête : on ne voit ni l'écran d'accueil d'Instagram ni la mise en page
     * qui se construit. Retiré au plus tard après 10 s.
     */
    private fun buildOverlay(tab: String): View {
        val c = Themes.chrome(this, prefs.theme())
        val o = FrameLayout(this).apply {
            setBackgroundColor(c.bg)
            isClickable = true
            addView(ProgressBar(this@MainActivity).apply {
                isIndeterminate = true
                indeterminateTintList = ColorStateList.valueOf(c.accent)
            }, FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER))
        }
        overlays[tab] = o
        readyTabs.remove(tab)
        main.postDelayed({ onTabReady(tab) }, 10_000)
        return o
    }

    private fun showOverlay(tab: String) {
        val o = overlays[tab] ?: return
        readyTabs.remove(tab)
        o.animate().cancel()
        o.alpha = 1f
        o.visibility = View.VISIBLE
        main.postDelayed({ onTabReady(tab) }, 10_000)
    }

    private fun onTabReady(tab: String) {
        if (!readyTabs.add(tab)) return
        overlays[tab]?.animate()?.alpha(0f)?.setDuration(180)?.withEndAction { overlays[tab]?.visibility = View.GONE }?.start()
        pendingOnReady.remove(tab)?.forEach { it() }
    }

    /** Exécute une action quand l'onglet est prêt (tout de suite s'il l'est déjà). */
    private fun whenReady(tab: String, action: () -> Unit) {
        if (tab in readyTabs) action() else pendingOnReady.getOrPut(tab) { mutableListOf() }.add(action)
    }

    /** Tirer vers le bas en haut du fil : recharge les dernières publications (au plus toutes les 20 s). */
    private fun onPullRefresh(layout: SwipeRefreshLayout, web: WebView) {
        val now = SystemClock.elapsedRealtime()
        val wait = 20_000 - (now - lastRefresh)
        if (wait > 0) {
            layout.isRefreshing = false
            showToast("Actualisation possible dans ${wait / 1000 + 1} s")
            return
        }
        lastRefresh = now
        layout.isRefreshing = false
        showOverlay("home")
        web.loadUrl(urlFor("home")!!)
    }

    private fun refreshConfig() {
        installedConfig = prefs.toJsConfig()
        installedContent = prefs.contentJson().toString()
        docStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    }

    private fun scriptFor(tab: String) = ScriptLib.script(this, installedConfig!!, tab)

    private fun installScript(tab: String, web: WebView) {
        if (!docStartSupported) return
        handlers.remove(tab)?.remove()
        handlers[tab] = WebViewCompat.addDocumentStartJavaScript(web, scriptFor(tab), setOf(IG))
    }

    /**
     * Barre du bas : toujours la page racine de l'onglet (maison → fil, loupe → Explorer,
     * avion → liste des messages…). Déjà à la racine de l'onglet actif : retour en haut.
     */
    private fun onTabTapped(tab: String) {
        val wasCurrent = tab == current
        switchTo(tab)
        val web = webs[tab] ?: return
        val root = urlFor(tab) ?: return
        if (isTabRoot(tab, web.url)) {
            if (wasCurrent) web.evaluateJavascript("window.scrollTo({top:0,behavior:'smooth'})", null)
            return
        }
        // Navigation interne d'Instagram (instantanée), sinon chargement normal.
        val path = Uri.parse(root).let { it.path + (it.query?.let { q -> "?$q" } ?: "") }
        web.evaluateJavascript("window.__cf&&window.__cf.navigate?(window.__cf.navigate(${JSONObject.quote(path)}),true):false") { ok ->
            if (ok != "true") web.loadUrl(root)
        }
    }

    private fun switchTo(tab: String) {
        if (tab !in tabIds()) return
        if (tab == "profile" && username == null) {
            pendingProfile = true
            showToast("Chargement du profil…")
            if (webs.isEmpty()) switchTo("home")
            return
        }
        val prev = current
        val web = webs[tab] ?: createWeb(tab).also { it.loadUrl(urlFor(tab)!!) }
        holders[tab]?.visibility = View.VISIBLE
        holders[tab]?.bringToFront()
        web.onResume()
        current = tab
        if (prev != tab) {
            // INVISIBLE et non GONE : la page garde sa taille réelle (sinon Instagram ne met rien en page).
            holders[prev]?.visibility = View.INVISIBLE
            if (prev != "direct") webs[prev]?.onPause()   // vidéos en pause ; Messages reste à l'écoute
        }
        progress.visibility = View.INVISIBLE
        styleBar()
    }

    private fun openDeepLink(uri: Uri) {
        val p = uri.path ?: "/"
        val tab = when {
            p.startsWith("/direct") -> "direct"
            p.startsWith("/explore") -> "explore"
            p.startsWith("/reels") && "reels" in tabIds() -> "reels"
            else -> "home"
        }
        switchTo(tab)
        webs[tab]?.loadUrl(uri.toString())
    }

    // ------------------------------------------------------------------ pont JS → app

    private inner class AppBridge(private val tab: String) {
        @JavascriptInterface
        fun openSettings() = runOnUiThread {
            startActivity(Intent(this@MainActivity, SettingsActivity::class.java))
            @Suppress("DEPRECATION")
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }

        @JavascriptInterface
        fun switchTab(id: String) = runOnUiThread { if (id in tabIds()) switchTo(id) }

        @JavascriptInterface
        fun setUser(name: String, avatar: String) = runOnUiThread {
            if (!Regex("^[A-Za-z0-9._]{1,30}$").matches(name)) return@runOnUiThread
            val changedAvatar = avatar.startsWith("https://") && avatar != avatarUrl
            username = name
            if (changedAvatar) { avatarUrl = avatar; showAvatar() }
            if (pendingProfile) { pendingProfile = false; switchTo("profile") }
        }

        @JavascriptInterface
        fun badge(id: String, count: Int) = runOnUiThread {
            val b = barItems[id]?.badge ?: return@runOnUiThread
            if (count <= 0) b.visibility = View.GONE
            else { b.text = if (count > 9) "9+" else count.toString(); b.visibility = View.VISIBLE }
        }

        @JavascriptInterface
        fun toast(msg: String) = runOnUiThread { showToast(msg.take(80)) }

        @JavascriptInterface
        fun ready() = runOnUiThread { onTabReady(tab) }

        /** Flèche « retour » d'Instagram : même comportement que le retour système. */
        @JavascriptInterface
        fun back() = runOnUiThread {
            if (tab == current) handleBack()
            else webs[tab]?.let { if (it.canGoBack()) it.goBack() }
        }

        /** Liste des conversations non lues (onglet Messages). */
        @JavascriptInterface
        fun dmUnread(json: String) = runOnUiThread {        // WebView.url : thread principal uniquement
            val watching = isResumed && current == "direct" &&
                (webs["direct"]?.url ?: "").contains("/direct/inbox")
            Notifier.onInbox(applicationContext, Notifier.parse(json), silent = watching)
        }

        @JavascriptInterface
        fun dmSent(ref: String, ok: Boolean) = runOnUiThread {
            val (key, text) = replies.remove(ref) ?: return@runOnUiThread
            Notifier.onReplied(applicationContext, key, text, ok)
        }

        /** Demandes de messages (inconnus) : compteur. */
        @JavascriptInterface
        fun msgRequests(n: Int) = Notifier.onMsgRequests(applicationContext, n)

        /** Pastille ♥ apparue : vérification des demandes d'abonnement (service, page invisible). */
        @JavascriptInterface
        fun activityBadge(on: Boolean) {
            if (on && prefs.bool("notifFollow")) DmService.send(applicationContext,
                Intent(DmService.ACTION_FOLLOW_CHECK).putExtra("force", true))
        }

        @JavascriptInterface fun followRequests(json: String) = Notifier.onFollowRequests(applicationContext, json)
        @JavascriptInterface fun followDone(u: String, accept: Boolean, ok: Boolean) {}

        @JavascriptInterface
        fun haptic() = runOnUiThread { root.performHapticFeedback(HapticFeedbackConstants.CONFIRM) }

        /** ＋ depuis un autre onglet (Reels) : ouvre le menu de création d'Instagram dans l'Accueil. */
        @JavascriptInterface
        fun openCreate() = runOnUiThread {
            switchTo("home")
            webs["home"]?.evaluateJavascript("window.__cf&&window.__cf.openCreate&&window.__cf.openCreate()", null)
        }
    }

    // ------------------------------------------------------------------ cycle de vie

    private var isResumed = false

    override fun onResume() {
        super.onResume()
        isResumed = true
        prefs.lastForeground = System.currentTimeMillis()
        webs[current]?.onResume()
        InboxWorker.schedule(this)
        resumedAt = SystemClock.elapsedRealtime()

        // Onglet Reels activé/désactivé dans les réglages : la barre change.
        if (barItems.keys.toList() != tabIds()) {
            for (gone in webs.keys.filter { it !in tabIds() }) {
                stack.removeView(holders.remove(gone)); webs.remove(gone)?.destroy(); handlers.remove(gone)
            }
            if (current !in tabIds()) current = "home"
            rebuildBar()
            switchTo(current)
        }
        applyChrome()

        if (installedConfig != prefs.toJsConfig()) {
            val contentChanged = installedContent != prefs.contentJson().toString()
            refreshConfig()
            for ((tab, web) in webs) {
                web.settings.textZoom = prefs.textZoom
                web.settings.mediaPlaybackRequiresUserGesture = false   // son permis ; la lecture auto est gérée par le script
                web.setBackgroundColor(Themes.chrome(this, prefs.theme()).bg)
                installScript(tab, web)
                if (contentChanged) { showOverlay(tab); web.reload() }
                else {
                    val cfg = JSONObject(installedConfig!!)
                    web.evaluateJavascript("window.__cf&&window.__cf.setTheme(${cfg.opt("palette")}," +
                        "${cfg.optBoolean("paletteDark")},${cfg.optBoolean("decoShapes")})", null)
                }
            }
        } else for (web in webs.values) web.settings.textZoom = prefs.textZoom
    }

    /**
     * Batterie : en arrière-plan, tout est en pause sauf l'onglet Messages (connexion temps réel).
     * Au bout de 10 min, seuls les onglets indispensables restent en mémoire (Messages si les
     * notifications instantanées sont actives) ; les autres se rechargeront au retour.
     */
    private val trim = Runnable {
        val keep = if (DmService.wanted(this)) setOf("direct") else emptySet()
        for (tab in webs.keys.toList()) if (tab !in keep) destroyTab(tab)
    }

    private fun destroyTab(tab: String) {
        handlers.remove(tab)
        overlays.remove(tab); refreshers.remove(tab); readyTabs.remove(tab); pendingOnReady.remove(tab)
        holders.remove(tab)?.let { stack.removeView(it) }
        webs.remove(tab)?.destroy()
    }

    override fun onStart() {
        super.onStart()
        main.removeCallbacks(trim)
        if (webs[current] == null) switchTo(current)          // onglet libéré pendant l'absence : rechargé
        if (webs["home"] == null && current != "home") {
            createWeb("home").loadUrl(urlFor("home")!!)
            holders["home"]?.visibility = View.INVISIBLE
        }
    }

    override fun onStop() {
        for ((tab, w) in webs) if (tab != "direct") w.onPause()
        main.postDelayed(trim, 10 * 60_000)
        DmService.sync(this)
        super.onStop()
    }

    override fun onPause() {
        isResumed = false
        prefs.lastForeground = System.currentTimeMillis()
        prefs.addUsage(SystemClock.elapsedRealtime() - resumedAt)
        CookieManager.getInstance().flush()
        webs[current]?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (live?.get() === this) live = null
        for (w in webs.values) w.destroy()
        super.onDestroy()
    }

    /**
     * Retour (bouton ou glissement depuis le bord) :
     *  1) un panneau CalmFeed est ouvert → on le ferme ;
     *  2) on n'est pas sur l'Accueil → on y revient ;
     *  3) sur l'Accueil : page précédente s'il y en a une, sinon « Glissez à nouveau pour quitter ».
     */
    private fun handleBack() {
        val web = webs[current] ?: return finish()
        web.evaluateJavascript("!!(window.__cf&&window.__cf.back())") { handled ->
            if (handled == "true") return@evaluateJavascript
            // 1) page précédente dans l'onglet, jusqu'à sa page racine (ex. conversation → liste)
            if (!isTabRoot(current, web.url) && web.canGoBack()) { web.goBack(); return@evaluateJavascript }
            // 2) racine d'un autre onglet → Accueil
            if (current != "home") { switchTo("home"); return@evaluateJavascript }
            // 3) racine de l'Accueil → « Glissez à nouveau pour quitter »
            val now = SystemClock.elapsedRealtime()
            if (now - lastExitAttempt < 2200) finish()
            else { lastExitAttempt = now; showToast("Glissez à nouveau pour quitter") }
        }
    }

    /** Page racine d'un onglet (là où le retour quitte l'onglet au lieu de remonter l'historique). */
    private fun isTabRoot(tab: String, url: String?): Boolean {
        val path = url?.let { Uri.parse(it).path } ?: return true
        return when (tab) {
            "home" -> path == "/" || path.isEmpty()
            "explore" -> path == "/explore/" || path == "/explore"
            "reels" -> path.startsWith("/reels")
            "direct" -> path == "/direct/inbox/" || path == "/direct/inbox" || path == "/direct/"
            "profile" -> username != null && (path == "/$username/" || path == "/$username")
            else -> true
        }
    }

    // ------------------------------------------------------------------ notifications

    /** Réponses envoyées depuis une notification, en attente de confirmation : réf → (clé, texte). */
    private val replies = HashMap<String, Pair<String, String>>()

    /** L'onglet Messages existe : il porte la connexion temps réel (le service n'en ouvre pas d'autre). */
    fun hasDirectTab(): Boolean = webs["direct"] != null

    /** Exécute un script dans l'onglet Messages dès qu'il est prêt (utilisé par le service). */
    fun evalOnDirect(js: String) = runOnUiThread { whenReady("direct") { webs["direct"]?.evaluateJavascript(js, null) } }

    /**
     * Envoie une réponse via l'onglet Messages, sans l'afficher. Faux si l'onglet n'existe pas.
     * @param ref identifiant de la conversation (ou nom affiché), @param key clé de la notification
     */
    fun sendDm(ref: String, key: String, text: String): Boolean {
        if (webs["direct"] == null) return false
        runOnUiThread {
            replies[ref] = key to text
            whenReady("direct") {
                webs["direct"]?.evaluateJavascript(
                    "window.__cf&&window.__cf.sendTo(${JSONObject.quote(ref)},${JSONObject.quote(text)})", null)
            }
        }
        return true
    }

    /** Notification touchée : ouvre la conversation (par identifiant exact si connu). */
    private fun handleNotificationIntent(intent: Intent?) {
        if (intent?.action == ACTION_OPEN_SETTINGS) {
            intent.action = Intent.ACTION_MAIN
            startActivity(Intent(this, SettingsActivity::class.java))
            return
        }
        val ref = intent?.getStringExtra(Notifier.EXTRA_OPEN) ?: return
        intent.removeExtra(Notifier.EXTRA_OPEN)
        if (webs["direct"] == null) createWeb("direct").loadUrl(urlFor("direct")!!)
        switchTo("direct")
        whenReady("direct") {
            webs["direct"]?.evaluateJavascript("window.__cf&&window.__cf.openThread(${JSONObject.quote(ref)})", null)
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK || Build.VERSION.SDK_INT >= 33) return super.onKeyDown(keyCode, event)
        handleBack()
        return true
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.takeIf { isAllowedHost(it) }?.let { openDeepLink(it) }
        handleNotificationIntent(intent)
    }

    // ------------------------------------------------------------------ navigation

    private fun isAllowedHost(uri: Uri): Boolean {
        val h = uri.host ?: return false
        return h == "instagram.com" || h.endsWith(".instagram.com") ||
            h == "facebook.com" || h.endsWith(".facebook.com") // connexion via Facebook / Accounts Center
    }

    private inner class Client(private val tab: String) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.scheme == "http" || uri.scheme == "https") {
                if (uri.path?.startsWith("/ads/") == true) return true   // liens publicitaires : jamais ouverts
                if (isAllowedHost(uri)) return false
            }
            try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: ActivityNotFoundException) { }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            if (!docStartSupported && url?.startsWith(IG) == true) view.evaluateJavascript(scriptFor(tab), null)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            CookieManager.getInstance().flush()
            refreshers[tab]?.isRefreshing = false
        }
    }

    private inner class Chrome(private val tab: String) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            if (tab != current) return
            progress.progress = newProgress
            progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.INVISIBLE
            if (newProgress == 100) refreshers[tab]?.isRefreshing = false
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(params.createIntent(), REQ_FILE)
                true
            } catch (_: ActivityNotFoundException) { fileCallback = null; false }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            if (request.origin.host?.endsWith("instagram.com") != true) { request.deny(); return }
            val needed = request.resources.mapNotNull {
                when (it) {
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                    else -> null
                }
            }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            if (needed.isEmpty()) request.grant(request.resources)
            else { pendingPermission = request; requestPermissions(needed.toTypedArray(), REQ_PERM) }
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
        const val IG = ScriptLib.IG
        /** Raccourci « Réglages » (appui long sur l'icône). */
        const val ACTION_OPEN_SETTINGS = "app.calmfeed.OPEN_SETTINGS"
        /** Instance vivante (pour répondre depuis une notification sans ouvrir l'app). */
        @Volatile var live: java.lang.ref.WeakReference<MainActivity>? = null
        private const val REQ_FILE = 41
        private const val REQ_PERM = 42
        private const val REQ_NOTIF = 43
    }
}
