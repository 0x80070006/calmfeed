package app.calmfeed

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.time.LocalDate

/** Réglages de l'app + compteur de temps d'utilisation quotidien. */
class Prefs(private val context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("calmfeed", Context.MODE_PRIVATE)

    fun bool(key: String): Boolean = sp.getBoolean(key, BOOLS[key] ?: false)
    fun int(key: String): Int = sp.getInt(key, INTS[key]?.default ?: 0)
    val bgId: String get() = sp.getString("bg", "system") ?: "system"
    val accentId: String get() = sp.getString("accent", "instagram") ?: "instagram"
    fun theme() = Themes.compose(context, bgId, accentId)
    val maxPosts: Int get() = int("maxPosts")
    val textZoom: Int get() = int("textZoom")

    /** Écriture générique depuis l'écran de réglages ; les valeurs sont bornées. */
    fun set(key: String, raw: String): Boolean {
        val e = sp.edit()
        when {
            key in BOOLS -> e.putBoolean(key, raw == "true")
            key in INTS -> {
                val r = INTS.getValue(key)
                e.putInt(key, (raw.toIntOrNull() ?: r.default).coerceIn(r.min, r.max))
            }
            key == "bg" -> if (Themes.hasBackground(context, raw)) e.putString("bg", raw) else return false
            key == "accent" -> if (Themes.hasAccent(context, raw)) e.putString("accent", raw) else return false
            else -> return false
        }
        e.apply()
        return true
    }

    fun reset() {
        val usageDate = sp.getString("usageDate", null)
        val usageMs = sp.getLong("usageMs", 0)
        sp.edit().clear().putString("usageDate", usageDate).putLong("usageMs", usageMs).apply()
    }

    /** Tout ce qui change le contenu : un changement impose de recharger la page. */
    fun contentJson(): JSONObject = JSONObject().apply {
        put("maxPosts", maxPosts)
        put("exploreBatch", int("exploreBatch"))
        for (k in JS_BOOLS) put(k, bool(k))
    }

    /** Config complète passée au script injecté (window.__CF). */
    fun toJsConfig(): String {
        val theme = theme()
        return contentJson().apply {
            put("palette", theme.colors ?: JSONObject.NULL)
            put("paletteDark", theme.dark)
            put("decoShapes", bool("decoShapes"))
        }.toString()
    }

    /** État complet pour l'écran de réglages. */
    fun stateJson(): String = JSONObject().apply {
        val cfg = JSONObject()
        for (k in BOOLS.keys) cfg.put(k, bool(k))
        for (k in INTS.keys) cfg.put(k, int(k))
        cfg.put("bg", bgId)
        cfg.put("accent", accentId)
        put("cfg", cfg)
        put("themes", Themes.raw(context))
        put("usageMin", usageTodayMs() / 60_000)
    }.toString()

    // ---- temps d'utilisation ----
    fun addUsage(ms: Long) {
        if (ms <= 0) return
        val today = LocalDate.now().toString()
        val base = if (sp.getString("usageDate", null) == today) sp.getLong("usageMs", 0) else 0
        sp.edit().putString("usageDate", today).putLong("usageMs", base + ms).apply()
    }

    fun usageTodayMs(): Long =
        if (sp.getString("usageDate", null) == LocalDate.now().toString()) sp.getLong("usageMs", 0) else 0

    data class IntRange(val default: Int, val min: Int, val max: Int)

    companion object {
        val BOOLS = linkedMapOf(
            "followingOnly" to true,
            "hideAds" to true,
            "hideSuggestedPosts" to true,
            "noAutoplay" to true,
            "hideStories" to false,
            "hideSuggestedAccounts" to true,
            "nonFollowersButton" to true,
            "hideReels" to true,
            "allowSingleReel" to true,
            "hideExploreGrid" to false,
            "hideAppBanner" to true,
            "startOnInbox" to true,
            "decoShapes" to true,
        )
        /** Clés de contenu lues par le script injecté (startOnInbox est natif, decoShapes relève de l'apparence). */
        val JS_BOOLS = BOOLS.keys.filter { it != "startOnInbox" && it != "decoShapes" }
        val INTS = mapOf(
            "maxPosts" to IntRange(15, 3, 50),
            "exploreBatch" to IntRange(10, 3, 30),
            "textZoom" to IntRange(100, 85, 130),
        )
    }
}
