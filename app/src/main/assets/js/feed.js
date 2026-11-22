/*
 * Fil d'accueil — méthode d'Instagram, fonctions CalmFeed PAR-DESSUS.
 *
 * Le fil d'Instagram est une liste virtualisée : ses posts ne doivent jamais changer de hauteur ni
 * disparaître, sinon le défilement saute. On ne retire donc RIEN de la liste :
 *  - reels, pubs et publications suggérées sont recouverts d'un voile dans leur emplacement d'origine
 *    (même hauteur, contenu invisible, vidéo en pause) ;
 *  - après N publications, les suivantes sont voilées avec le message de fin et la pagination est
 *    retenue : le fil s'arrête de lui-même, sans aucune modification de mise en page.
 * Le chargement, le défilement et l'ordre des posts restent exactement ceux d'Instagram.
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;
  const C = NS.C;
  const HOME = 'html[data-cf-page="home"] main';

  // ------------------------------------------------------------------ voile (aucun changement de taille)
  const LABEL = { reel: 'Reel masqué', ad: 'Publicité masquée', suggPost: 'Suggestion masquée' };
  NS.css('veil', `
    ${HOME} article[data-cf-veil]{position:relative!important}
    ${HOME} article[data-cf-veil] > *{visibility:hidden!important;pointer-events:none!important}
    ${HOME} article[data-cf-veil]::after{content:attr(data-cf-label);position:absolute;inset:0;display:flex;
      align-items:center;justify-content:center;text-align:center;padding:24px;
      font:600 14px/1.5 system-ui,sans-serif;color:rgb(var(--ig-secondary-text,106,113,122));
      background:rgb(var(--ig-secondary-background,239,239,239));border-radius:14px;margin:8px 10px;opacity:.75}
    ${HOME} article[data-cf-veil="limit"]::after{display:none}
    ${HOME} [data-cf-quiet]{visibility:hidden!important}
  `);

  const veil = (art, kind) => {
    if (art.getAttribute('data-cf-veil') === kind) return;
    art.setAttribute('data-cf-veil', kind);
    art.setAttribute('data-cf-label', kind === 'limit' ? '' : LABEL[kind] || '');
    for (const v of art.getElementsByTagName('video')) { try { v.pause(); v.muted = true; } catch (_) {} }
    NS.dbg.hidden[kind] = (NS.dbg.hidden[kind] || 0) + 1;
  };
  NS.css('veilText', `${HOME} article[data-cf-veil]::after{white-space:pre-line}`);

  // ------------------------------------------------------------------ Reels : routes et liens
  if (C.hideReels) {
    NS.css('reels', 'a[href="/reels/"]{display:none!important}');
    NS.redirects.push((p) => {
      if (/^\/reels(\/|$)/.test(p)) return '/';                        // flux infini
      if (!C.allowSingleReel && /\/reel\//.test(p)) return '/';
      const m = p.match(/^\/([^/]+)\/reels\/?$/);                      // onglet Reels d'un profil
      if (m && m[1] !== 'direct' && m[1] !== 'explore') return '/' + m[1] + '/';
      return null;
    });
  }

  // ------------------------------------------------------------------ classification
  const POST_RE = /\/(?:p|reels?)\/(?!audio\/)([A-Za-z0-9_-]{6,})/;
  const AD_RE = /^(Sponsoris(é|ée)|Sponsored|Publicité|Partenariat rémunéré|Paid partnership|Ad)$/i;
  const SUGG_POST_RE = /^(Suggested for you|Suggestions pour vous|Suggéré pour vous|Suggested posts|Publications suggérées)$/i;

  const postKey = (art) => {
    for (const a of art.getElementsByTagName('a')) {
      const m = (a.getAttribute('href') || '').match(POST_RE);
      if (m) return m[1];
    }
    return null;
  };

  // Fil « Pour vous » : les publications suggérées SONT le contenu du fil, on ne les voile que
  // dans le fil des abonnements.
  const hideSugg = C.hideSuggestedPosts && C.followingOnly;

  const classify = (art) => {
    if (C.hideAds && art.querySelector('a[href*="facebook.com/ads/"], a[href*="/ads/ig_redirect"]')) return 'ad';
    if (C.hideFeedReels && art.querySelector('a[href*="/reel/"], a[href^="/reels/"]:not([href^="/reels/audio/"])')) return 'reel';
    if (C.hideAds || hideSugg) {
      for (const el of art.querySelectorAll('span, a')) {
        if (el.childElementCount) continue;
        const t = el.textContent.trim();
        if (t.length > 40) continue;
        if (C.hideAds && AD_RE.test(t)) return 'ad';
        if (hideSugg && SUGG_POST_RE.test(t)) return 'suggPost';
      }
    }
    return 'ok';
  };

  // ------------------------------------------------------------------ limite de publications
  const counted = new Set();
  let limitReached = false;

  const FEED_PAGINATION = /feed.*(pagination|timeline)|timeline.*(feed|pagination)/i;
  NS.blockers.push((name, path) =>
    limitReached && NS.pageOf(location.pathname) === 'home' &&
    (FEED_PAGINATION.test(name) || path.startsWith('/api/v1/feed/timeline')));

  /** Ne lit aucune géométrie et ne change aucune taille : sûr à chaque mutation. */
  const process = (main) => {
    for (const art of main.getElementsByTagName('article')) {
      const key = postKey(art);
      if (!key) {
        // Pas de lien de post : pub (« Ad » + lien publicitaire) ou squelette pas encore rempli.
        const k = classify(art);
        if (k !== 'ok') veil(art, k);
        else if (limitReached) veil(art, 'limit');
        continue;
      }
      if (counted.has(key)) {
        // Une pub se déclare parfois après coup : on la voile et on libère sa place dans le compte.
        const k = classify(art);
        if (k !== 'ok') { veil(art, k); counted.delete(key); limitReached = counted.size >= C.maxPosts; }
        continue;
      }
      if (art.hasAttribute('data-cf-veil') && art.getAttribute('data-cf-veil') !== 'limit') continue;
      const k = classify(art);
      if (k !== 'ok') { veil(art, k); continue; }
      if (counted.size < C.maxPosts) {
        counted.add(key);
        NS.dbg.seen.push(key);
        if (art.hasAttribute('data-cf-veil')) { art.removeAttribute('data-cf-veil'); art.removeAttribute('data-cf-label'); }
      } else veil(art, 'limit');
    }
    limitReached = counted.size >= C.maxPosts;
    gate.set(limitReached);
    // Fil terminé : l'indicateur de chargement en bas est rendu invisible (sans changer sa taille).
    if (limitReached) for (const p of main.querySelectorAll('[role="progressbar"]')) {
      if (!p.closest('article') && !p.hasAttribute('data-cf-quiet')) p.setAttribute('data-cf-quiet', '');
    }
  };

  // ------------------------------------------------------------------ fin de limite : bannière + défilement bloqué
  const lastCounted = (main) => {
    let last = null;
    for (const art of main.getElementsByTagName('article')) { const k = postKey(art); if (k && counted.has(k)) last = art; }
    return last;
  };
  const gate = NS.endGate('home', () => {
    const main = document.querySelector('main');
    const last = main && lastCounted(main);
    return last ? last.getBoundingClientRect().bottom + scrollY : null;
  }, `Vous avez vu vos ${C.maxPosts} publications`, 'Le fil s’arrête ici. Revenez plus tard pour les suivantes.');

  // ------------------------------------------------------------------ stories (hors liste : peut être masqué)
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

  // ------------------------------------------------------------------ onglet « Suivi(e) » (optionnel)
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
    const last = +sessionStorage.getItem('cf_variant_ts') || 0;
    if (Date.now() - last < 8000) { sessionStorage.setItem('cf_variant_off', '1'); return; }
    sessionStorage.setItem('cf_variant_ts', String(Date.now()));
    NS.navigate('/?variant=following', true);
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

  // ------------------------------------------------------------------ son activé par défaut
  // Instagram garde son propre interrupteur de son (« Audio is muted ») : rendre la vidéo audible ne
  // suffit pas, il faut basculer CET interrupteur. On le fait une fois par vidéo qui démarre.
  // Si vous coupez le son vous-même avec ce bouton, ce choix est respecté.
  if (C.soundOn) {
    const MUTED = '[aria-label="Audio is muted"], [aria-label="Le son est coupé"], [aria-label="Son coupé"]';
    let userMuted = false;
    const done = new WeakSet();
    addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const b = e.target && e.target.closest && e.target.closest('[role="button"], button');
      if (!b) return;
      const labels = [b, ...b.querySelectorAll('[aria-label]')].map(x => x.getAttribute('aria-label') || '').join(' ');
      if (!/audio|sound|son|mute|muet/i.test(labels)) return;
      userMuted = !/muted|coupé/i.test(labels);          // il était audible → l'utilisateur coupe
    }, true);
    const unmute = (scope) => {
      if (userMuted) return;
      const s = (scope && scope.querySelector(MUTED)) || document.querySelector(MUTED);
      const b = s && (s.closest('[role="button"], button') || s);
      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };
    addEventListener('play', (e) => {
      const v = e.target;
      if (!v || v.tagName !== 'VIDEO' || v.closest('[data-cf-veil]') || done.has(v)) return;
      done.add(v);
      if (v.muted) v.muted = false;
      setTimeout(() => unmute(v.closest('article') || v.closest('section') || document), 150);
    }, true);
  }

  NS.modules.push({
    name: 'feed',
    pages: ['home'],
    sync({ main }) { if (main) process(main); },
    run({ main }) {
      if (!main) return;
      if (C.followingOnly) ensureFollowing(main);
      if (C.hideStories) processStories(main);
      process(main);
    },
  });
})();
