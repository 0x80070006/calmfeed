/*
 * Fil d'accueil : reels, pubs, posts suggérés, limite de publications, onglet « Suivi(e) », autoplay.
 *
 * Le fil d'Instagram est virtualisé : un conteneur flex dont padding-top / padding-bottom réservent la
 * place des posts non rendus. Pour éviter les sauts au défilement :
 *  - tout ce qui est détectable en CSS (reels, liens publicitaires) est masqué via :has() AVANT la mesure ;
 *  - un post n'est compté qu'une fois « stabilisé » (son libellé « Sponsorisé » arrive parfois après) ;
 *  - à la limite, la carte de fin est placée APRÈS le conteneur virtualisé et son padding-bottom est annulé :
 *    il n'y a plus rien à faire défiler, et la pagination est retenue (aucune requête).
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;
  const C = NS.C;
  const HOME = 'html[data-cf-page="home"] main';

  // Dans le fil, un post masqué est réduit à 1 px invisible plutôt que display:none :
  // la liste virtualisée traite une hauteur 0 comme « non mesurée », remplace par une estimation
  // et monte/démonte les posts en boucle au défilement. 1 px est une vraie mesure, stable.
  const COLLAPSE = 'display:block!important;height:1px!important;min-height:0!important;margin:0!important;' +
    'padding:0!important;border:0!important;overflow:hidden!important;visibility:hidden!important;contain:strict';
  NS.css('collapse', `${HOME} article[data-cf-hidden]{${COLLAPSE}}`);

  // ------------------------------------------------------------------ Reels : routes, liens, masquage précoce
  if (C.hideReels) {
    NS.css('reels', `
      a[href="/reels/"]{display:none!important}
      ${HOME} article:has(a[href*="/reel/"]),
      ${HOME} article:has(a[href^="/reels/"]:not([href^="/reels/audio/"])){${COLLAPSE}}
    `);
    NS.redirects.push((p) => {
      if (/^\/reels(\/|$)/.test(p)) return '/';                        // flux infini
      if (!C.allowSingleReel && /\/reel\//.test(p)) return '/';
      const m = p.match(/^\/([^/]+)\/reels\/?$/);                      // onglet Reels d'un profil
      if (m && m[1] !== 'direct' && m[1] !== 'explore') return '/' + m[1] + '/';
      return null;
    });
  }
  if (C.hideAds) {
    NS.css('ads', `${HOME} article:has(a[href*="facebook.com/ads/"], a[href*="/ads/ig_redirect"]){${COLLAPSE}}`);
  }

  // ------------------------------------------------------------------ classification
  // Desktop : /p/<code>/, /reels/<code>/ — Mobile : /<user>/p/<code>/, /<user>/reel/<code>/
  // /reels/audio/<id>/ = page d'un son (aussi sur des photos avec musique) : ignoré.
  const POST_RE = /\/(?:p|reels?)\/(?!audio\/)([A-Za-z0-9_-]{6,})/;
  const AD_RE = /^(Sponsoris(é|ée)|Sponsored|Publicité|Partenariat rémunéré|Paid partnership|Ad)$/i;
  const SUGG_POST_RE = /^(Suggested for you|Suggestions pour vous|Suggéré pour vous|Suggested posts|Publications suggérées)$/i;
  const SETTLE_MS = 1200;

  const postKey = (art) => {
    const links = art.getElementsByTagName('a');
    for (let i = 0; i < links.length; i++) {
      const m = (links[i].getAttribute('href') || '').match(POST_RE);
      if (m) return m[1];
    }
    return null;
  };

  const leafTexts = function* (art) {
    for (const tag of ['span', 'a', 'div']) {
      const els = art.getElementsByTagName(tag);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.childElementCount !== 0) continue;
        const t = el.textContent;
        if (t && t.length < 40) yield t.trim();
      }
    }
  };

  const classify = (art) => {
    if (C.hideAds && art.querySelector('a[href*="facebook.com/ads/"], a[href*="/ads/ig_redirect"]')) return 'ad';
    if (C.hideReels && art.querySelector('a[href*="/reel/"], a[href^="/reels/"]:not([href^="/reels/audio/"])')) return 'reel';
    if (C.hideAds || C.hideSuggestedPosts) {
      for (const t of leafTexts(art)) {
        if (C.hideAds && AD_RE.test(t)) return 'ad';
        if (C.hideSuggestedPosts && SUGG_POST_RE.test(t)) return 'suggPost';
      }
    }
    return 'ok';
  };

  // ------------------------------------------------------------------ limite de publications
  const info = new WeakMap();    // article -> { key, t0, kind }
  const seen = new Map();        // code du post -> rang
  let limitReached = false;
  let settleTimer = null;

  // ------------------------------------------------------------------ publications déjà vues
  // Le fil « Suivi(e) » est chronologique : sans nouveauté, Instagram renvoie les mêmes posts.
  // On retient (7 jours, sur le téléphone) les posts réellement affichés à l'écran, et au
  // chargement suivant on les saute : chaque actualisation ne montre que de l'inédit.
  const VIEW_KEY = 'cf_viewed_posts_v1';
  const VIEW_TTL = 7 * 24 * 3600e3;
  const viewed = (() => {
    try {
      const o = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
      const now = Date.now();
      for (const k of Object.keys(o)) if (now - o[k] > VIEW_TTL) delete o[k];
      return o;
    } catch (_) { return {}; }
  })();
  const viewedBefore = new Set(C.hideSeenPosts ? Object.keys(viewed) : []);   // figé au chargement de la page
  let saveTimer = null;
  const saveViewed = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keys = Object.keys(viewed);
      if (keys.length > 600) keys.sort((a, b) => viewed[a] - viewed[b]).slice(0, keys.length - 600).forEach(k => delete viewed[k]);
      try { localStorage.setItem(VIEW_KEY, JSON.stringify(viewed)); } catch (_) {}
    }, 800);
  };
  // « Vu » = au moins 60 % du post affiché à l'écran (pas seulement chargé en mémoire).
  const viewObs = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.intersectionRatio < 0.6) continue;
      const d = info.get(en.target);
      if (d && !viewed[d.key]) { viewed[d.key] = Date.now(); saveViewed(); }
      viewObs.unobserve(en.target);
    }
  }, { threshold: [0.6] }) : null;
  NS.dbg.skippedOld = 0;

  // Pagination du fil uniquement, reconnue par le NOM de la requête ou le chemin REST.
  const FEED_PAGINATION = /feed.*(pagination|timeline)|timeline.*(feed|pagination)/i;
  NS.blockers.push((name, path) =>
    limitReached && NS.pageOf(location.pathname) === 'home' &&
    (FEED_PAGINATION.test(name) || path.startsWith('/api/v1/feed/timeline')));

  // Les posts au-delà de la limite sont masqués DANS le callback de mutation : la liste virtualisée les mesure
  // à 0 dès leur montage (jamais 750 puis 0), donc aucune boucle de remontage. L'espace réservé sous la liste
  // (padding-bottom) est annulé : la page se termine sur la carte de fin.
  NS.css('feedEnd', `
    [data-cf-ended]{padding-bottom:0!important}
    #cf-end{padding:40px 24px 120px;text-align:center;font:15px/1.5 system-ui,sans-serif;
      color:rgb(var(--ig-primary-text,12,16,20))}
    #cf-end .cf-check{width:60px;height:60px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;
      background:rgb(var(--ig-secondary-button-background,239,239,239));color:rgb(var(--ig-secondary-button,38,38,38))}
    #cf-end h3{margin:0 0 6px;font-size:19px;font-weight:700}
    #cf-end p{margin:0 auto;max-width:280px;color:rgb(var(--ig-secondary-text,106,113,122))}
    #cf-end a{display:inline-block;margin-top:20px;padding:11px 22px;border-radius:12px;font-weight:600;
      background:rgb(var(--ig-primary-button,74,93,249));color:rgb(var(--ig-text-on-color,255,255,255))!important;
      text-decoration:none}
  `);

  const endCard = (nothingNew) => {
    let card = document.getElementById('cf-end');
    const kind = nothingNew ? 'empty' : 'limit';
    if (!card || card.dataset.kind !== kind) {
      card = card || document.createElement('div');
      card.id = 'cf-end';
      card.dataset.kind = kind;
      card.innerHTML =
        '<div class="cf-check"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
        (nothingNew
          ? '<h3>Rien de nouveau</h3><p>Vous avez déjà vu les dernières publications de vos abonnements. Revenez plus tard.</p>'
          : `<h3>Vous avez vu vos ${C.maxPosts} publications</h3><p>Le fil s'arrête ici. Revenez plus tard pour les suivantes.</p>`) +
        '<a href="/direct/inbox/">Ouvrir les messages</a>';
    }
    return card;
  };

  /**
   * Classement des posts : appelé dans le callback de mutation (avant le rendu) et à chaque passe.
   * Ne lit aucune géométrie : aucun recalcul de mise en page forcé.
   */
  const classifyAll = (main) => {
    const arts = main.getElementsByTagName('article');
    const now = performance.now();
    let waiting = false;
    for (let i = 0; i < arts.length; i++) {
      const art = arts[i];
      if (art.hasAttribute('data-cf-hidden')) continue;
      let d = info.get(art);
      if (!d) {
        const key = postKey(art);
        if (!key) { if (limitReached) NS.hide(art, 'limit'); continue; }   // squelette pas encore rempli
        d = { key, t0: now, kind: null };
        info.set(art, d);
      }
      if (d.kind === null) {
        const k = classify(art);
        if (k !== 'ok') { d.kind = k; NS.hide(art, k); continue; }
        if (viewedBefore.has(d.key) && !seen.has(d.key)) {          // déjà vu lors d'une visite précédente
          d.kind = 'old'; NS.hide(art, 'old'); NS.dbg.skippedOld++; continue;
        }
        if (!seen.has(d.key)) {
          if (limitReached) { NS.hide(art, 'limit'); continue; }
          // Pas encore compté : on laisse à une pub éventuelle le temps de se déclarer.
          if (now - d.t0 < SETTLE_MS) { waiting = true; continue; }
        }
        d.kind = 'ok';
      }
      if (d.kind !== 'ok') { NS.hide(art, d.kind); continue; }
      if (!seen.has(d.key)) {
        if (seen.size < C.maxPosts) { seen.set(d.key, seen.size); NS.dbg.seen.push(d.key); }
        else NS.hide(art, 'limit');
      }
      if (viewObs && !art.__cfObs && !art.hasAttribute('data-cf-hidden')) { art.__cfObs = true; viewObs.observe(art); }
      limitReached = seen.size >= C.maxPosts;
    }
    if (waiting && !settleTimer) settleTimer = setTimeout(() => { settleTimer = null; NS.schedule(); }, SETTLE_MS + 30);
    limitReached = seen.size >= C.maxPosts;
  };

  /**
   * Relance douce : si la première page ne contenait presque que des reels (masqués), il ne reste
   * rien à faire défiler et Instagram n'ira jamais chercher la suite. Un défilement de 2 px, comme
   * un léger mouvement du doigt, la déclenche. Au plus 6 fois par chargement, espacées de 1,5 s.
   */
  let nudges = 0, lastNudge = 0;
  const nudge = (main) => {
    if (limitReached || nudges >= 6 || Date.now() - lastNudge < 1500) return;
    if (!main.querySelector('[role="progressbar"]')) return;
    let visible = 0;
    for (const a of main.getElementsByTagName('article')) if (!a.hasAttribute('data-cf-hidden')) visible++;
    if (visible >= 3 || document.documentElement.scrollHeight > innerHeight * 1.6) return;
    nudges++;
    lastNudge = Date.now();
    scrollBy(0, 2);
    dispatchEvent(new Event('scroll'));
    setTimeout(() => { scrollBy(0, -2); dispatchEvent(new Event('scroll')); }, 120);
  };

  /** Carte de fin et fin de page (aucune lecture de géométrie). */
  const applyEnd = (main) => {
    nudge(main);
    const arts = main.getElementsByTagName('article');
    if (!arts.length) return;
    const container = arts[0].parentElement;

    // Rien d'inédit après les relances : on le dit plutôt que de laisser tourner le chargement.
    let nothingNew = false;
    if (!limitReached && seen.size === 0 && nudges >= 6 && Date.now() - lastNudge > 2500) {
      nothingNew = [...arts].every(a => a.hasAttribute('data-cf-hidden'));
    }
    if (!limitReached && !nothingNew) return;

    if (!container.hasAttribute('data-cf-ended')) container.setAttribute('data-cf-ended', '');
    for (const p of main.querySelectorAll('[role="progressbar"]')) if (!p.closest('article')) NS.hide(p, 'loader');
    const card = endCard(nothingNew);
    if (card.previousElementSibling !== container) container.after(card);
  };

  // ------------------------------------------------------------------ stories
  const processStories = (main) => {
    const btns = [...main.querySelectorAll('[aria-label^="Story"], [aria-label^="story"]')];
    if (!btns.length) return;
    let tray = btns[0].closest('ul');
    if (!tray) {
      tray = btns[0];
      const last = btns[btns.length - 1];
      while (tray && !tray.contains(last)) tray = tray.parentElement;
    }
    if (tray && tray !== main) NS.hide(tray, 'stories');
  };

  // ------------------------------------------------------------------ onglet « Suivi(e) »
  if (C.followingOnly) {
    NS.css('tabs', 'html[data-cf-page="home"] main [role="tablist"]{display:none!important}');
  }

  let tabClicked = false;
  const ensureFollowing = (main) => {
    const tabs = main.querySelectorAll('[role="tab"]');
    if (tabs.length >= 2) {
      if (!tabClicked && tabs[1].getAttribute('aria-selected') !== 'true') { tabClicked = true; tabs[1].click(); }
      return;
    }
    if (/variant=following/.test(location.search) || sessionStorage.getItem('cf_variant_off')) return;
    // Redirection vers la variante « Following ». Si on retombe sur « / » juste après,
    // le site ne la prend plus en charge : on arrête pour la session (aucune boucle possible).
    const last = +sessionStorage.getItem('cf_variant_ts') || 0;
    if (Date.now() - last < 8000) { sessionStorage.setItem('cf_variant_off', '1'); return; }
    sessionStorage.setItem('cf_variant_ts', String(Date.now()));
    NS.navigate('/?variant=following', true);   // sans rechargement
  };

  // ------------------------------------------------------------------ autoplay
  if (C.noAutoplay) {
    let lastTap = 0;
    addEventListener('pointerdown', () => { lastTap = Date.now(); }, true);
    addEventListener('play', (e) => {
      const v = e.target;
      if (v && v.tagName === 'VIDEO' && Date.now() - lastTap > 1500 && NS.pageOf(location.pathname) !== 'direct') v.pause();
    }, true);
  }

  NS.modules.push({
    name: 'feed',
    pages: ['home'],
    sync({ main }) { if (main) classifyAll(main); },
    run({ main }) {
      if (!main) return;
      if (C.followingOnly) ensureFollowing(main);
      if (C.hideStories) processStories(main);
      classifyAll(main);
      applyEnd(main);
    },
  });
})();
