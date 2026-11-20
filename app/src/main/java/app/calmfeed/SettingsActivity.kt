package app.calmfeed

import android.app.Activity
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import android.widget.NumberPicker
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

/** Écran de réglages construit en code (aucune dépendance UI). */
class SettingsActivity : Activity() {

    private lateinit var prefs: Prefs

    private fun dp(v: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics
    ).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(24))
        }

        col.addView(TextView(this).apply {
            text = "Réglages"
            textSize = 24f
            setPadding(0, 0, 0, dp(12))
        })

        section(col, "Feed")
        col.addView(TextView(this).apply {
            text = "Nombre maximum de publications par session"
            setPadding(0, dp(8), 0, 0)
        })
        col.addView(NumberPicker(this).apply {
            minValue = 3
            maxValue = 60
            value = prefs.maxPosts.coerceIn(3, 60)
            wrapSelectorWheel = false
            setOnValueChangedListener { _, _, v -> prefs.maxPosts = v }
        }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { gravity = Gravity.CENTER_HORIZONTAL })

        toggle(col, "followingOnly", "Uniquement les comptes suivis", "Force l'onglet « Suivi(e) » (chronologique)")
        toggle(col, "hideAds", "Masquer les publicités")
        toggle(col, "hideSuggestions", "Masquer les suggestions", "Comptes et posts suggérés")
        toggle(col, "noAutoplay", "Pas de lecture auto des vidéos")
        toggle(col, "hideStories", "Masquer les stories")

        section(col, "Reels & Explorer")
        toggle(col, "hideReels", "Bloquer les Reels", "Onglet, flux /reels/ et reels dans le feed")
        toggle(col, "allowSingleReel", "Autoriser un reel reçu en message", "Ouvre le reel seul, sans flux infini")
        toggle(col, "hideExploreGrid", "Masquer la grille Explorer", "La recherche de personnes reste disponible")

        section(col, "Démarrage")
        toggle(col, "startOnInbox", "Ouvrir sur les messages")

        col.addView(TextView(this).apply {
            val min = prefs.usageTodayMs() / 60_000
            text = "Temps passé aujourd'hui : $min min"
            alpha = 0.7f
            setPadding(0, dp(24), 0, 0)
        })

        setContentView(ScrollView(this).apply {
            addView(col, MATCH_PARENT, WRAP_CONTENT)
            setOnApplyWindowInsetsListener { v, insets ->
                @Suppress("DEPRECATION")
                v.setPadding(0, insets.systemWindowInsetTop, 0, insets.systemWindowInsetBottom)
                insets
            }
        })
    }

    private fun section(parent: LinearLayout, title: String) {
        parent.addView(TextView(this).apply {
            text = title.uppercase()
            textSize = 12f
            alpha = 0.6f
            setPadding(0, dp(20), 0, dp(4))
        })
    }

    private fun toggle(parent: LinearLayout, key: String, title: String, subtitle: String? = null) {
        parent.addView(Switch(this).apply {
            text = if (subtitle != null) "$title\n$subtitle" else title
            isChecked = prefs.flag(key)
            setPadding(0, dp(10), 0, dp(10))
            setOnCheckedChangeListener { _, v -> prefs.setFlag(key, v) }
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }
}
