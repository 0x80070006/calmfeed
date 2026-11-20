package app.calmfeed

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.time.LocalDate

/** Réglages de l'app + compteur de temps d'utilisation quotidien. */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("calmfeed", Context.MODE_PRIVATE)

    var maxPosts: Int
        get() = sp.getInt("maxPosts", 15)
        set(v) = sp.edit().putInt("maxPosts", v).apply()

    fun flag(key: String): Boolean = sp.getBoolean(key, DEFAULTS[key] ?: false)
    fun setFlag(key: String, v: Boolean) = sp.edit().putBoolean(key, v).apply()

    /** JSON passé au script injecté (window.__CF). */
    fun toJsConfig(): String = JSONObject().apply {
        put("maxPosts", maxPosts)
        for (k in JS_FLAGS) put(k, flag(k))
    }.toString()

    // ---- temps d'utilisation ----
    fun addUsage(ms: Long) {
        val today = LocalDate.now().toString()
        val base = if (sp.getString("usageDate", null) == today) sp.getLong("usageMs", 0) else 0
        sp.edit().putString("usageDate", today).putLong("usageMs", base + ms).apply()
    }

    fun usageTodayMs(): Long =
        if (sp.getString("usageDate", null) == LocalDate.now().toString()) sp.getLong("usageMs", 0) else 0

    companion object {
        /** Flags lus par filter.js */
        val JS_FLAGS = listOf(
            "hideReels", "allowSingleReel", "hideExploreGrid", "hideAds",
            "hideSuggestions", "hideStories", "followingOnly", "noAutoplay"
        )
        val DEFAULTS = mapOf(
            "hideReels" to true,
            "allowSingleReel" to true,   // un reel envoyé en DM reste visible, mais pas le flux /reels/
            "hideExploreGrid" to true,   // la recherche de personnes reste dispo
            "hideAds" to true,
            "hideSuggestions" to true,
            "hideStories" to false,
            "followingOnly" to true,
            "noAutoplay" to true,
            "startOnInbox" to true,
        )
    }
}
