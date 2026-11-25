package app.calmfeed

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Mise à jour depuis les releases GitHub.
 *
 * - Ne contacte GitHub que lorsque l'utilisateur ouvre l'écran « Mises à jour » (jamais en arrière-plan).
 * - Télécharge l'APK dans cacheDir, vérifie son SHA-256 avec SHA256SUMS.txt de la même release.
 * - Installe par une session PackageInstaller ; InstallReceiver reçoit le résultat.
 *
 * L'état courant est un JSONObject poussé à l'écran (listener) à chaque changement.
 * États : idle, checking, uptodate, available, downloading, permission, installing, error.
 */
object Updater {

    const val REPO = "0x80070006/calmfeed"
    const val APK_NAME = "CalmFeed.apk"
    private const val SUMS_NAME = "SHA256SUMS.txt"
    private const val API = "https://api.github.com/repos/$REPO"

    class Release(
        val tag: String, val version: String, val prerelease: Boolean, val notes: String,
        val apkUrl: String?, val sumsUrl: String?,
    )

    private val main = Handler(Looper.getMainLooper())
    @Volatile var state: JSONObject = JSONObject().put("s", "idle"); private set
    @Volatile var release: Release? = null; private set
    @Volatile private var apk: File? = null
    @Volatile private var busy = false

    /** L'écran courant (SettingsActivity) ; appelé sur le thread principal. */
    var listener: ((JSONObject) -> Unit)? = null

    private fun emit(s: String, extra: JSONObject.() -> Unit = {}) {
        val o = JSONObject().put("s", s).apply(extra)
        release?.let { o.put("version", it.version).put("beta", it.prerelease).put("notes", it.notes) }
        state = o
        main.post { listener?.invoke(o) }
    }

    fun fail(msg: String) { busy = false; emit("error") { put("msg", msg) } }

    // ------------------------------------------------------------------ versions

    /** Version de release injectée au build (meta-data release.version), pas versionName. */
    fun installedVersion(ctx: Context): String = try {
        val info = if (Build.VERSION.SDK_INT >= 33)
            ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
        else @Suppress("DEPRECATION") ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
        info.metaData?.get("release.version")?.toString() ?: "0.0.0"
    } catch (_: Exception) { "0.0.0" }

    /**
     * Compare deux versions « 0.4.10 », « 0.4.0-beta.2 » : numérique par composant ;
     * à numéros égaux, une release passe avant une pré-version.
     */
    fun compare(a: String, b: String): Int {
        fun split(v: String): Pair<List<Int>, String?> {
            val clean = v.trim().removePrefix("v").removePrefix("V")
            val dash = clean.indexOf('-')
            val core = if (dash >= 0) clean.substring(0, dash) else clean
            val pre = if (dash >= 0) clean.substring(dash + 1) else null
            return core.split('.').map { p -> p.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 } to pre
        }
        val (na, pa) = split(a)
        val (nb, pb) = split(b)
        for (i in 0 until maxOf(na.size, nb.size)) {
            val c = na.getOrElse(i) { 0 }.compareTo(nb.getOrElse(i) { 0 })
            if (c != 0) return c
        }
        return when {
            pa == null && pb == null -> 0
            pa == null -> 1
            pb == null -> -1
            else -> comparePre(pa, pb)
        }
    }

    private fun comparePre(a: String, b: String): Int {
        val x = a.split('.'); val y = b.split('.')
        for (i in 0 until maxOf(x.size, y.size)) {
            val p = x.getOrNull(i) ?: return -1
            val q = y.getOrNull(i) ?: return 1
            val pi = p.toIntOrNull(); val qi = q.toIntOrNull()
            val c = if (pi != null && qi != null) pi.compareTo(qi) else p.compareTo(q)
            if (c != 0) return c
        }
        return 0
    }

    // ------------------------------------------------------------------ préférence bêta

    private fun sp(ctx: Context) = ctx.getSharedPreferences("updater", Context.MODE_PRIVATE)
    fun beta(ctx: Context) = sp(ctx).getBoolean("beta", false)
    fun setBeta(ctx: Context, on: Boolean) = sp(ctx).edit().putBoolean("beta", on).apply()
    fun askedNotif(ctx: Context) = sp(ctx).getBoolean("askedNotif", false)
    fun markAskedNotif(ctx: Context) = sp(ctx).edit().putBoolean("askedNotif", true).apply()

    // ------------------------------------------------------------------ recherche

    fun check(ctx: Context) {
        if (busy) return
        busy = true
        release = null
        emit("checking")
        val app = ctx.applicationContext
        val beta = beta(app)
        Thread {
            try {
                val rel = if (beta) {
                    val arr = JSONArray(get("$API/releases?per_page=15"))
                    var best: JSONObject? = null
                    for (i in 0 until arr.length()) {
                        val r = arr.getJSONObject(i)
                        if (r.optBoolean("draft")) continue
                        if (best == null || compare(r.optString("tag_name"), best.optString("tag_name")) > 0) best = r
                    }
                    best ?: throw UpdateError("Aucune version publiée pour l'instant.")
                } else JSONObject(get("$API/releases/latest"))
                val r = parse(rel)
                release = r
                busy = false
                val installed = installedVersion(app)
                if (compare(r.version, installed) > 0) emit("available")
                else emit("uptodate")
            } catch (e: UpdateError) { release = null; fail(e.message ?: "Erreur") }
            catch (e: IOException) { release = null; fail(netMsg(e)) }
            catch (e: Exception) { release = null; fail("Réponse de GitHub illisible (${e.javaClass.simpleName}).") }
        }.start()
    }

    private fun parse(o: JSONObject): Release {
        val tag = o.getString("tag_name")
        var apkUrl: String? = null; var sumsUrl: String? = null; var fallback: String? = null
        val assets = o.optJSONArray("assets") ?: JSONArray()
        for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            val name = a.optString("name"); val url = a.optString("browser_download_url")
            when {
                name == APK_NAME -> apkUrl = url
                name == SUMS_NAME -> sumsUrl = url
                // Anciennes releases : CalmFeed-x.y.z.apk.
                Regex("""CalmFeed-[\w.\-]+\.apk""").matches(name) -> fallback = url
            }
        }
        // Notes en texte brut : on retire le balisage Markdown le plus courant.
        val body = o.optString("body").replace("\r", "")
            .replace(Regex("""\*\*|__|`"""), "")
            .replace(Regex("""(?m)^#{1,6}\s*"""), "")
            .replace(Regex("""\[([^\]]+)]\([^)]+\)"""), "$1")
            .trim()
        return Release(tag, tag.removePrefix("v").removePrefix("V"), o.optBoolean("prerelease"),
            if (body.length > 600) body.take(600).trimEnd() + "…" else body, apkUrl ?: fallback, sumsUrl)
    }

    // ------------------------------------------------------------------ téléchargement

    fun download(ctx: Context, then: () -> Unit) {
        val r = release ?: return
        if (busy) return
        val url = r.apkUrl ?: return fail("Cette version ne contient aucune APK de CalmFeed ($APK_NAME).")
        val sumsUrl = r.sumsUrl ?: return fail("Cette version n'a pas de fichier d'empreintes ($SUMS_NAME) : rien n'a été installé.")
        busy = true
        emit("downloading") { put("pct", 0) }
        val app = ctx.applicationContext
        Thread {
            val file = File(app.cacheDir, "update.apk")
            try {
                val name = url.substringAfterLast('/')
                val expected = get(sumsUrl).lineSequence()
                    .map { it.trim().split(Regex("\\s+"), 2) }
                    .firstOrNull { it.size == 2 && it[1].removePrefix("*") == name }
                    ?.get(0)?.lowercase()
                    ?: throw UpdateError("$SUMS_NAME ne mentionne pas $name : rien n'a été installé.")

                val md = MessageDigest.getInstance("SHA-256")
                open(url).let { (c, len) ->
                    c.inputStream.use { input ->
                        file.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            var done = 0L; var last = -1
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n); md.update(buf, 0, n); done += n
                                if (len > 0) {
                                    val pct = (done * 100 / len).toInt()
                                    if (pct != last) { last = pct; emit("downloading") { put("pct", pct) } }
                                }
                            }
                        }
                    }
                    c.disconnect()
                }
                val actual = md.digest().joinToString("") { "%02x".format(it) }
                if (actual != expected) {
                    file.delete()
                    throw UpdateError("L'empreinte du fichier téléchargé ne correspond pas : il a été supprimé, rien n'a été installé.")
                }
                apk = file
                busy = false
                main.post(then)
            } catch (e: UpdateError) { file.delete(); fail(e.message ?: "Erreur") }
            catch (e: IOException) { file.delete(); fail(netMsg(e)) }
            catch (e: Exception) { file.delete(); fail("Téléchargement impossible (${e.javaClass.simpleName}).") }
        }.start()
    }

    fun hasApk() = apk?.exists() == true

    // ------------------------------------------------------------------ installation

    fun install(ctx: Context) {
        val file = apk?.takeIf { it.exists() } ?: return fail("Le fichier téléchargé a disparu. Réessayez.")
        if (busy) return
        busy = true
        emit("installing")
        val app = ctx.applicationContext
        Thread {
            try {
                val pi = app.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                    setAppPackageName(app.packageName)
                    setSize(file.length())
                    if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                    // Pas de setPackageSource : LOCAL_FILE / DOWNLOADED_FILE réactiveraient les « paramètres restreints ».
                }
                val id = pi.createSession(params)
                pi.openSession(id).use { s ->
                    s.openWrite("calmfeed.apk", 0, file.length()).use { out ->
                        file.inputStream().use { it.copyTo(out, 64 * 1024) }
                        s.fsync(out)
                    }
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                    val cb = PendingIntent.getBroadcast(app, id,
                        Intent(app, InstallReceiver::class.java).setAction(InstallReceiver.ACTION), flags)
                    s.commit(cb.intentSender)
                }
                // La suite arrive dans InstallReceiver.
            } catch (e: Exception) {
                fail("L'installation n'a pas pu démarrer (${e.message ?: e.javaClass.simpleName}).")
            }
        }.start()
    }

    /** Résultat de la session (InstallReceiver). */
    internal fun onInstallResult(ctx: Context, status: Int, message: String?) {
        busy = false
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> emit("installing") { put("confirm", true) }
            // Le succès arrive en général dans la nouvelle version déjà relancée : état neutre,
            // l'écran refait une recherche à l'ouverture et affiche « à jour ».
            PackageInstaller.STATUS_SUCCESS -> {
                apk?.delete(); File(ctx.cacheDir, "update.apk").delete()
                release = null; emit("idle")
            }
            PackageInstaller.STATUS_FAILURE_ABORTED -> emit("available")
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                fail("La nouvelle version n'est pas signée avec la même clé que celle installée. " +
                    "Désinstallez CalmFeed puis installez l'APK à la main depuis GitHub.")
            PackageInstaller.STATUS_FAILURE_STORAGE -> fail("Pas assez d'espace libre pour installer la mise à jour.")
            else -> fail("Échec de l'installation" + (message?.let { " : $it" } ?: "."))
        }
    }

    /** « Installer des applis inconnues » autorisé pour CalmFeed ? */
    fun canInstallPackages(ctx: Context) = ctx.packageManager.canRequestPackageInstalls()

    fun needPermission() = emit("permission")

    // ------------------------------------------------------------------ réseau

    private class UpdateError(msg: String) : Exception(msg)

    private fun netMsg(e: IOException) = when (e) {
        is java.net.UnknownHostException -> "Pas de connexion à Internet."
        is java.net.SocketTimeoutException -> "GitHub ne répond pas. Réessayez plus tard."
        is UpdateNetError -> e.message ?: "Erreur réseau."
        else -> "Erreur réseau (${e.message ?: e.javaClass.simpleName})."
    }

    private class UpdateNetError(msg: String) : IOException(msg)

    /** Ouvre une URL en suivant les redirections, uniquement vers du https. Renvoie (connexion, taille). */
    private fun open(start: String): Pair<HttpURLConnection, Long> {
        var url = start
        repeat(6) {
            if (!url.startsWith("https://")) throw UpdateNetError("Redirection refusée (adresse non sécurisée).")
            val c = (URL(url).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15_000
                readTimeout = 30_000
                setRequestProperty("User-Agent", "CalmFeed-updater")
                setRequestProperty("Accept", if (url.startsWith(API)) "application/vnd.github+json" else "*/*")
            }
            val code = c.responseCode
            when (code) {
                in 200..299 -> return c to c.contentLengthLong
                301, 302, 303, 307, 308 -> {
                    val loc = c.getHeaderField("Location") ?: throw UpdateNetError("Redirection sans adresse.")
                    c.disconnect()
                    url = URL(URL(url), loc).toString()
                }
                404 -> { c.disconnect(); throw UpdateNetError("Aucune version publiée trouvée sur GitHub.") }
                403, 429 -> { c.disconnect(); throw UpdateNetError("GitHub limite les requêtes pour le moment. Réessayez dans une heure.") }
                else -> { c.disconnect(); throw UpdateNetError("GitHub a répondu $code.") }
            }
        }
        throw UpdateNetError("Trop de redirections.")
    }

    private fun get(url: String): String = open(url).let { (c, _) ->
        try { c.inputStream.bufferedReader().use { it.readText() } } finally { c.disconnect() }
    }
}
