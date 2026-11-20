package app.calmfeed

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject

/**
 * Apparence = un FOND (système, clair, sombre ou une couleur douce) + une COULEUR D'ACCENT.
 * Source unique : assets/themes.json (lue aussi par l'écran de réglages).
 * La lisibilité fine (contraste des boutons, liens, icônes) est recalculée dans theme.js.
 */
object Themes {
    data class Theme(val dark: Boolean, val colors: JSONObject?)
    data class Chrome(val bg: Int, val text: Int, val text2: Int, val dark: Boolean, val accent: Int)

    private var cache: JSONObject? = null

    fun raw(ctx: Context): JSONObject = cache ?: JSONObject(
        ctx.assets.open("themes.json").bufferedReader().use { it.readText() }
    ).also { cache = it }

    private fun find(arr: JSONArray, id: String): JSONObject? {
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).getString("id") == id) return arr.getJSONObject(i)
        return null
    }

    fun hasBackground(ctx: Context, id: String) = find(raw(ctx).getJSONArray("backgrounds"), id) != null
    fun hasAccent(ctx: Context, id: String) = find(raw(ctx).getJSONArray("accents"), id) != null

    private fun isNight(ctx: Context) =
        (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    /**
     * Palette complète pour le script injecté. « Système + Bleu » = Instagram d'origine (aucune
     * modification : colors = null) ; tout autre choix recolore le site.
     */
    fun compose(ctx: Context, bgId: String, accentId: String): Theme {
        val json = raw(ctx)
        val night = isNight(ctx)
        if (bgId == "system" && accentId == "instagram") return Theme(night, null)
        val bgKey = if (bgId == "system") (if (night) "dark" else "light") else bgId
        val bg = find(json.getJSONArray("backgrounds"), bgKey) ?: find(json.getJSONArray("backgrounds"), "light")!!
        val accent = (find(json.getJSONArray("accents"), accentId) ?: find(json.getJSONArray("accents"), "instagram")!!)
            .getString("color")
        val c = JSONObject(bg.getJSONObject("c").toString()).apply {
            put("accent", accent)
            put("accentText", "#ffffff")   // corrigé dans theme.js si le contraste est insuffisant
            put("link", accent)
        }
        return Theme(bg.optBoolean("dark"), c)
    }

    /** Couleurs du fond natif et des barres système. */
    fun chrome(ctx: Context, theme: Theme): Chrome {
        val c = theme.colors
        if (c != null) {
            return Chrome(
                Color.parseColor(c.getString("bg")), Color.parseColor(c.getString("text")),
                Color.parseColor(c.getString("text2")), theme.dark, Color.parseColor(c.getString("accent")),
            )
        }
        return if (theme.dark) Chrome(Color.BLACK, Color.parseColor("#F5F5F5"), Color.parseColor("#A8A8A8"), true, Color.parseColor("#4A5DF9"))
        else Chrome(Color.WHITE, Color.parseColor("#0C1014"), Color.parseColor("#737373"), false, Color.parseColor("#4A5DF9"))
    }
}
