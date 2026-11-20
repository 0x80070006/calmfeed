# Analyse de instagram.com : base pour une WebView Android « communication-first »

> Analyse en lecture seule faite le 2026-11-16, connecté, interface FR, sur le bureau (viewport 1502×917).
> Requêtes générées : **2 chargements de page** (`/` puis `/direct/inbox/`), comme une navigation normale. Tout le reste est de la lecture locale du DOM, de `performance` et des feuilles CSS déjà chargées. Aucun appel d'API manuel.

---

## 1. Architecture technique de la page

| Élément | Constat | Conséquence pour la WebView |
|---|---|---|
| Framework | React + système de modules Meta (`__d`, `require`, `requireLazy`, `Bootloader`, `ScheduleJSWork`) | SPA : les changements d'URL passent par `history.pushState` et ne rechargent **pas** la page. Il faut intercepter la navigation côté JS, pas seulement dans `shouldOverrideUrlLoading`. |
| Racine | `div#mount_0_0_XX` (suffixe aléatoire à chaque chargement) | Cibler `[id^="mount_"]`. |
| CSS | Classes atomiques générées (StyleX) : `x1qjc9v5`, `x78zum5`, etc., et quelques classes legacy `_acb3`, `_aa4c`, `_ar45` | **Ne jamais s'appuyer sur ces classes** : elles changent à chaque déploiement. Utiliser `href`, `aria-label`, `role` et la structure sémantique. |
| Scripts | 161 `<script>` dont 65 `application/json` (données SSR/Relay) | Ne pas parser ce JSON : il est fragile et inutile ici. |
| Service Worker | Actif (`navigator.serviceWorker.controller`) | La WebView doit l'autoriser (comportement par défaut) ; il gère le cache et les notifications push web. |
| Langue | `<html lang="fr">`, libellés ARIA localisés | Les sélecteurs basés sur `aria-label` dépendent de la langue. Prévoir un dictionnaire FR/EN ou forcer `?hl=fr`. |
| Thème | `__fb-light-mode` / `__fb-dark-mode` sur `<html>`, `@media (prefers-color-scheme: dark)` | La WebView peut suivre le thème système via `WebSettingsCompat.setAlgorithmicDarkening` ou laisser IG gérer. |
| Viewport meta | `width=device-width, initial-scale=1, maximum-scale=2, viewport-fit=cover` | Déjà adapté au mobile. |

### Points d'arrêt responsive repérés dans les CSS
`max-width: 735px / 736px / 767px` (bascule **mobile** : barre d'onglets en bas, header en haut, pas de colonne de suggestions), `768–1263px` (sidebar compacte avec icônes), `≥1264px` (sidebar avec libellés et colonne de suggestions).
→ Sur un téléphone, la WebView affichera **la mise en page mobile** (≤735px). La disposition bureau observée ici diffère : voir §6, « À vérifier sur l'appareil ».

---

## 2. Navigation principale : sélecteurs stables

Liens de la sidebar (bureau) ou de la barre du bas (mobile). Ce sont des `<a role="link">` qui contiennent un `<svg aria-label="…">`.

| Fonction | Sélecteur fiable | aria-label (FR) |
|---|---|---|
| Accueil | `a[href="/"]` | Accueil |
| **Reels** | `a[href="/reels/"]` | Reels |
| Messages | `a[href="/direct/inbox/"]` | Messages |
| Recherche / Explorer | `a[href="/explore/"]` | Recherche |
| Notifications | `a[href="#"]` contenant `svg[aria-label="Notifications"]` | Notifications |
| Créer | `svg[aria-label="Nouvelle publication"]` | Nouvelle publication |
| Profil | `a[href="/<username>/"]` | (avatar) |
| Paramètres / Plus | `svg[aria-label="Paramètres"]` | Paramètres |
| Autres apps Meta | `svg[aria-label="Autres applications Meta"]` | Autres applications Meta |

**Masquer un item proprement :** remonter du `<a>` jusqu'au conteneur d'item. Sur le bureau, la chaîne observée est `a > div > span > div` (4 niveaux), puis le parent liste à 7 enfants. Plutôt que compter les niveaux, utiliser `:has()` (supporté par Chromium ≥105, donc par toute WebView à jour) :

```css
/* l'item de nav qui contient le lien Reels */
div:has(> span a[href="/reels/"]),
span:has(> div > a[href="/reels/"]) { display: none !important; }
```

---

## 3. Le feed d'accueil

### Structure
```
main[role=main]
 └ … div (conteneur feed)
    ├ onglets  [role=tablist] > [role=tab] « Pour vous » | « Suivi(e) »   (div, pas de href)
    ├ stories tray  (boutons aria-label="Story par <user>, non vue")
    ├ div > div > article   ← 1 article = 1 post
    ├ article …
    └ div[role=progressbar] > svg[aria-label="Chargement..."]   ← sentinelle du scroll infini
```

- Les `article` sont **frères directs** dans un même parent (4 au premier rendu, ~770–860 px de haut chacun).
- Les `article` n'ont **ni classe ni `<header>`** : l'auteur et la date sont dans des `div`.
- Date : `time[datetime]` dans un `a[href="/p/<shortcode>/"]`, ce qui donne un identifiant unique du post.
- Actions par post : `svg[aria-label]` = `J'aime`, `Commenter`, `Republier`, `Partager`, `Enregistrer`, `Plus d'options`.
- Carrousel : `button[aria-label="Suivant"]` et `"Go to slide N"`.
- Vidéo : `<video src="blob:…" muted playsinline>`, lue par MSE (fichiers `.mp4` fragmentés depuis `scontent-*.cdninstagram.com`). Un bouton `svg[aria-label="Le son est coupé"]` est présent.

### Détecter le type de post
| Type | Signal fiable |
|---|---|
| **Reel dans le feed** | `article` qui contient `a[href^="/reels/"]` ou `a[href^="/reel/"]`, et/ou `video` + texte « Audio d'origine » |
| Photo / carrousel | `article` avec `a[href^="/p/"]` sans `video` |
| **Publicité** | `article` contenant `a[href*="facebook.com/ads/"]` (lien `ig_redirect`) **ou** un nœud feuille dont le texte vaut `Sponsorisée` / `Sponsored` |
| Post suggéré (pas un abonnement) | Onglet « Pour vous » actif. Sur « Suivi(e) » il n'y en a pas. |

### Scroll infini : comment le limiter
Le chargement suivant se déclenche quand la sentinelle `div[role=progressbar]` entre dans le viewport (IntersectionObserver côté IG), ce qui appelle `POST /api/graphql` (ou `/graphql/query`).
**Méthode la plus sûre** : compter les `article` et, au-delà de N, **masquer la sentinelle et tout ce qui suit**, puis afficher un écran « Vous êtes à jour ». Si la sentinelle reste en `display:none`, l'IntersectionObserver ne se déclenche plus, donc **aucune requête supplémentaire** n'est envoyée. C'est aussi bon pour le risque de bannissement, puisque le client génère *moins* de trafic qu'un usage normal.

### Onglets « Pour vous » / « Suivi(e) »
Ce sont des `div[role=tab]` sans URL. Pour forcer « Suivi(e) » (chronologique, uniquement les comptes suivis), il suffit de cliquer une fois sur le 2ᵉ `[role=tab]` après le chargement, puis de masquer le `tablist`.
*(La variante d'URL `/?variant=following` existait auparavant ; à tester sur l'appareil avant de s'y fier.)*

---

## 4. Messages (`/direct/inbox/`)

- `[aria-label="Liste des discussions"]` : la liste des conversations.
- `[aria-label="Nouveau message"]`, `[aria-label="Rechercher"]`, `[aria-label="Épinglé"]`.
- Liens : `/direct/inbox/`, `/direct/requests/` (demandes de message), et les conversations en `/direct/t/<id>/`.
- Horodatages : `aria-label="il y a 12 minutes"`, etc.
- Temps réel : MQTT / WebSocket (`MqttGlobalStreamCounter` dans le localStorage) et appels WebRTC (`RTC_*` dans le localStorage), donc la WebView doit autoriser micro et caméra (`onPermissionRequest`) si tu veux les appels.
- Widget flottant « Messages » en bas à droite sur la page d'accueil (bureau) : `div` en `position:fixed` qui contient le texte « Messages ».

C'est **la partie à garder intacte** : elle est déjà orientée communication.

---

## 5. Réseau observé (passif, via `performance.getEntriesByType`)

130 ressources au premier chargement :

| Endpoint | Rôle |
|---|---|
| `www.instagram.com/api/graphql`, `/graphql/query` | Données (feed, stories…) |
| `/ajax/bulk-route-definitions/` | Préchargement des routes SPA |
| `/ajax/bootloader-endpoint/` | Chargement paresseux des modules JS |
| `/ajax/bz`, `graph.instagram.com/logging_client_events`, beacons | Télémétrie |
| `/sync/instagram/`, `/api/v1/web/fxcal/ig_sso_users/` | Synchronisation de session / SSO Meta |
| `/video/unified_cvc/` | Statistiques de lecture vidéo |
| `scontent-*.cdninstagram.com` | Médias (images, segments vidéo) |
| `static.cdninstagram.com` | JS/CSS statiques |

Cookies visibles : `ds_user_id`, `csrftoken`, `wd` (`sessionid` est HttpOnly, donc invisible en JS, ce qui est normal).

---

## 6. Recommandations pour l'APK

### 6.1 Principe anti-ban
1. **Ne jamais appeler l'API directement** (pas de requêtes GraphQL forgées, pas de scraping). La WebView ne fait **que** ce que fait le site officiel ; on se contente de **masquer** du contenu côté client.
2. **User-Agent** : garder le UA Chrome Android par défaut de la WebView et retirer seulement le suffixe `; wv` (`settings.userAgentString = default.replace("; wv", "")`). Ne pas usurper l'UA de l'app native Instagram.
3. **Ne pas bloquer la télémétrie** (`/ajax/bz`, `logging_client_events`) : un client qui ne logge rien est plus suspect qu'un client qui logge normalement.
4. Pas d'auto-clic en boucle, pas de défilement automatique.
5. Connexion manuelle dans la WebView ; cookies persistés via `CookieManager` (`setAcceptThirdPartyCookies(webView, true)`).

> Note honnête : modifier l'affichage côté client reste techniquement contraire aux conditions d'utilisation d'Instagram (comme un bloqueur de pub). Le risque pratique est faible tant qu'on ne génère pas de trafic anormal, mais il n'est pas nul.

### 6.2 Injection
- `WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("https://www.instagram.com"))` (androidx.webkit) injecte le script **avant** le rendu React. C'est mieux que `evaluateJavascript` dans `onPageFinished`, qui provoque un flash du contenu.
- Un `MutationObserver` sur `[id^="mount_"]` pour réappliquer les filtres à chaque re-rendu.
- Un hook `history.pushState`/`popstate` pour bloquer les routes interdites.
- Côté Kotlin, `shouldOverrideUrlLoading` ne voit **pas** les navigations SPA. Il ne sert que pour les liens externes (ouvrir dans le navigateur) et les rechargements complets.

### 6.3 Brouillon de script injecté

```js
(() => {
  const MAX_POSTS = 15;                      // taille fixe du feed
  const BLOCKED = [/^\/reels?\//, /^\/explore\/?$/];   // routes interdites

  // 1) CSS : masquage statique, sans flash
  const css = `
    a[href="/reels/"], a[href="/explore/"] { display:none !important; }
    div:has(> span a[href="/reels/"]), div:has(> span a[href="/explore/"]) { display:none !important; }
    [role="tablist"]:has([role="tab"]) { display:none !important; } /* onglets Pour vous/Suivi(e) */
  `;
  const style = document.createElement('style'); style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  // 2) Routes SPA
  const guard = () => { if (BLOCKED.some(r => r.test(location.pathname))) location.replace('/direct/inbox/'); };
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...a) { const r = orig.apply(this, a); guard(); return r; };
  }
  addEventListener('popstate', guard); guard();

  // 3) Filtrage du feed
  const isAd   = a => a.querySelector('a[href*="facebook.com/ads/"]') ||
                      [...a.querySelectorAll('span')].some(s => !s.children.length && /^(Sponsoris(é|ée)|Sponsored)$/.test(s.textContent.trim()));
  const isReel = a => a.querySelector('a[href^="/reel/"], a[href^="/reels/"]');

  let switchedToFollowing = false;
  const apply = () => {
    if (location.pathname !== '/') return;
    // forcer l'onglet "Suivi(e)" une seule fois
    const tabs = document.querySelectorAll('[role="tab"]');
    if (!switchedToFollowing && tabs[1] && tabs[1].getAttribute('aria-selected') !== 'true') { tabs[1].click(); switchedToFollowing = true; }

    let shown = 0;
    for (const art of document.querySelectorAll('main article')) {
      if (isAd(art) || isReel(art)) { art.style.display = 'none'; continue; }
      shown++;
      if (shown > MAX_POSTS) art.style.display = 'none';
    }
    if (shown >= MAX_POSTS) {
      document.querySelectorAll('main [role="progressbar"]').forEach(p => p.style.display = 'none'); // stoppe le scroll infini
      if (!document.getElementById('ic-end')) {
        const last = [...document.querySelectorAll('main article')].filter(a => a.style.display !== 'none').pop();
        last?.insertAdjacentHTML('afterend', '<div id="ic-end" style="padding:32px;text-align:center;opacity:.7">Vous êtes à jour ✔</div>');
      }
    }
    // couper l'autoplay des vidéos restantes
    document.querySelectorAll('main article video').forEach(v => { v.autoplay = false; if (!v.paused) v.pause(); });
  };

  const start = () => {
    const root = document.querySelector('[id^="mount_"]') || document.body;
    new MutationObserver(() => { cancelAnimationFrame(start.raf); start.raf = requestAnimationFrame(apply); })
      .observe(root, { childList: true, subtree: true });
    apply();
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
```

> ⚠️ Masquer une vidéo avec `display:none` n'arrête pas forcément son téléchargement. Mettre aussi `pause()` dessus, puis `removeAttribute('src')` si on veut économiser des données.

### 6.4 Idées « communication-first »
- Ouvrir l'app sur `/direct/inbox/` par défaut.
- Barre de navigation native (Kotlin) avec 3 onglets seulement : Messages / Feed (limité) / Profil, et les nav web masquées.
- Stories : les garder (communication entre amis) mais désactiver l'enchaînement automatique, ou les masquer par option.
- Bloquer aussi les « Suggestions pour vous » et les posts suggérés insérés en fin de feed.
- Compteur de temps local, avec option de verrou après X minutes.

### 6.5 À vérifier sur l'appareil (non observable sans vue mobile)
Je n'ai pas pu passer en largeur mobile : la fenêtre Chrome étant maximisée, le redimensionnement a été ignoré. À contrôler dans la WebView via `chrome://inspect` :
- la barre d'onglets du bas (≤735px) utilise probablement les mêmes `a[href]` (`/`, `/explore/`, `/reels/`, `/direct/inbox/`, profil), à confirmer ;
- la position des stories et du header mobile (icônes cœur et messages en haut) ;
- la présence de l'onglet « Suivi(e) » en mobile ;
- le libellé exact de la pub en mobile.

---

## 7. Récap des sélecteurs (aide-mémoire)

```
Racine app          [id^="mount_"]
Contenu             main[role="main"]
Post                main article
Post id             article time[datetime] → closest('a').href  (/p/<code>/)
Reel (feed)         article:has(a[href^="/reel/"], a[href^="/reels/"])
Pub                 article:has(a[href*="facebook.com/ads/"])  |  texte "Sponsorisée"
Sentinelle scroll   main [role="progressbar"]
Onglets feed        [role="tablist"] > [role="tab"]   (0 = Pour vous, 1 = Suivi(e))
Story               [aria-label^="Story par "]
Nav Reels           a[href="/reels/"]
Nav Explorer        a[href="/explore/"]
Nav DM              a[href="/direct/inbox/"]
Liste DM            [aria-label="Liste des discussions"]
Conversation        a[href^="/direct/t/"]
```
