# CalmFeed

WebView Android qui affiche instagram.com en version « communication d'abord » :
- Reels bloqués (onglet, flux `/reels/`, reels dans le feed) ; un reel reçu en DM reste visible seul (option).
- Feed limité à N publications par session (15 par défaut), puis écran « Vous êtes à jour ».
- Uniquement les comptes suivis, sans pubs ni suggestions.
- Grille Explorer masquée, mais la recherche de personnes reste dispo.
- Pas de lecture auto des vidéos.
- Ouverture directe sur les messages.
- Compteur « temps passé aujourd'hui ».

L'analyse de la page qui sert de base aux sélecteurs est dans [ANALYSE_INSTAGRAM_WEB.md](ANALYSE_INSTAGRAM_WEB.md).

## Principe anti-ban
L'app **n'envoie aucune requête de plus** que le site officiel. Elle masque du contenu côté client et *retient* les requêtes de pagination du feed une fois la limite atteinte. Pas d'API privée, pas d'auto-scroll, pas d'auto-like. Le User-Agent est celui de Chrome Android ; seul le marqueur `; wv` de la WebView est retiré.

## Structure
```
app/src/main/
  assets/filter.js                 ← tout le filtrage (injecté avant le JS d'Instagram)
  java/app/calmfeed/MainActivity.kt ← WebView, injection, fichiers, caméra/micro, liens externes
  java/app/calmfeed/SettingsActivity.kt
  java/app/calmfeed/Prefs.kt       ← réglages + temps d'utilisation
```

## Compiler
Il faut un JDK 17+ (celui d'Android Studio convient) et le SDK Android (compileSdk 36).

```bash
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"; .\gradlew.bat assembleDebug
```

APK : `app/build/outputs/apk/debug/app-debug.apk`

## Installer sur le téléphone
Active le débogage USB, branche le téléphone, puis :

```bash
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

## Déboguer les sélecteurs
1. Lance l'app sur le téléphone branché en USB.
2. Ouvre `chrome://inspect` dans Chrome sur le PC, puis **inspect** sous la WebView.
3. Dans la console, tape `window.__cfDebug` : config, posts vus, éléments masqués (pub/reel/limite/suggestions) et nombre de requêtes de pagination retenues.
4. Filtre la console sur `[CF]`.

Si Instagram change son interface, il suffit en général d'ajuster `filter.js`. Les sélecteurs s'appuient sur `href`, `aria-label` et `role`, jamais sur les classes générées.

## À vérifier au premier lancement
- L'onglet « Suivi(e) » est-il bien forcé ? En mobile, l'app tente `/?variant=following` une fois par session.
- Le libellé des pubs mobiles est-il bien détecté ? (`window.__cfDebug.hidden.ad`)
- Le scroll s'arrête-t-il après N posts, sans requêtes en boucle ? (`blockedRequests` doit rester faible)

## Avertissement
Modifier l'affichage d'Instagram côté client reste contraire à ses conditions d'utilisation, comme un bloqueur de pub. Le risque est faible tant que le trafic reste normal, mais il n'est pas nul. Projet à usage personnel, non distribué.
