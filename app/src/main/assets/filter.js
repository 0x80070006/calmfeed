/*
 * CalmFeed : script injecté au démarrage de chaque page instagram.com.
 * Il ne fait QUE masquer, bloquer ou retenir côté client. Il n'émet aucune requête.
 * Sélecteurs : voir ANALYSE_INSTAGRAM_WEB.md (href, aria-label, role ; jamais les classes x…).
 * Debug : chrome://inspect, puis taper window.__cfDebug dans la console.
 */
(() => {
  if (window.top !== window || window.__cfLoaded) return;
  window.__cfLoaded = true;

  const C = Object.assign({
    maxPosts: 15,
    hideReels: true, allowSingleReel: true, hideExploreGrid: true,
    hideAds: true, hideSuggestions: true, hideStories: false,
    followingOnly: true, noAutoplay: true,
  }, window.__CF || {});

  const dbg = window.__cfDebug = { config: C, hidden: { ad: 0, reel: 0, limit: 0, sugg: 0 }, blockedRequests: 0, seen: [] };
  const log = (...a) => console.debug('[CF]', ...a);

  // ------------------------------------------------------------------ CSS statique
  const css = [];
  if (C.hideReels) {
    css.push('a[href="/reels/"]{display:none!important}');
  }
  if (C.hideExploreGrid) {
    css.push('html[data-cf-page="explore"] main a[href^="/p/"],' +
             'html[data-cf-page="explore"] main a[href^="/reel/"]{display:none!important}');
  }
  if (C.followingOnly) {
    css.push('html[data-cf-page="home"] main [role="tablist"]{display:none!important}');
  }
  css.push(
    '#cf-end{padding:40px 24px;text-align:center;font:15px/1.5 system-ui,sans-serif;opacity:.85}',
    '#cf-end a{display:inline-block;margin-top:12px;padding:8px 18px;border-radius:8px;' +
      'background:#3D6B5E;color:#fff!important;text-decoration:none;font-weight:600}',
    '#cf-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483647;' +
      'background:rgba(0,0,0,.82);color:#fff;padding:8px 14px;border-radius:8px;' +
      'font:14px system-ui,sans-serif;pointer-events:none;transition:opacity .3s}'
  );
  const style = document.createElement('style');
  style.id = 'cf-style';
  style.textContent = css.join('\n');
  const ensureStyle = () => {
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  };
  ensureStyle();

  const hide = (el, why) => {
    if (!el || el.dataset.cfHidden) return;
    el.dataset.cfHidden = why;
    el.style.setProperty('display', 'none', 'important');
    el.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (_) {} });
    if (dbg.hidden[why] !== undefined) dbg.hidden[why]++;
  };

  let toastTimer;
  const toast = (msg) => {
    let t = document.getElementById('cf-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cf-toast';
      (document.body || document.documentElement).appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1800);
  };

  // ------------------------------------------------------------------ routes (SPA)
  const redirectFor = (p) => {
    if (!C.hideReels) return null;
    if (/^\/reels(\/|$)/.test(p)) return '/';                     // flux infini de reels
    if (!C.allowSingleReel && /^\/reel\//.test(p)) return '/';
    const m = p.match(/^\/([^/]+)\/reels\/?$/);                   // onglet Reels d'un profil
    if (m && m[1] !== 'direct' && m[1] !== 'explore') return '/' + m[1] + '/';
    return null;
  };

  const pageOf = (p) =>
    p === '/' ? 'home' :
    p.startsWith('/explore') ? 'explore' :
    p.startsWith('/direct') ? 'direct' : 'other';

  let lastPath = null;
  const onRoute = () => {
    const p = location.pathname;
    const to = redirectFor(p);
    if (to !== null) { location.replace(to); return; }
    if (p !== lastPath) {
      lastPath = p;
      document.documentElement.dataset.cfPage = pageOf(p);
      schedule();
    }
  };

  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) {
      const r = orig.apply(this, args);
      try { onRoute(); } catch (e) { log(e); }
      return r;
    };
  }
  addEventListener('popstate', onRoute);
  onRoute();

  // Bloque le clic avant que React ne rende la page interdite.
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch (_) { return; }
    if (u.origin !== location.origin) return;
    if (redirectFor(u.pathname) !== null) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toast('Reels désactivés');
    }
  }, true);

  // ------------------------------------------------------------------ garde-fou réseau
  // Une fois la limite atteinte sur l'accueil, on retient (sans jamais répondre)
  // les requêtes de pagination du feed : IG ne relance pas en boucle et rien ne part au serveur.
  let limitReached = false;
  const FEED_PAGINATION = /feed.*(pagination|timeline)|timeline.*feed|PolarisFeed|xdt_api__v1__feed__timeline/i;
  const isFeedPage = (body) => {
    if (!limitReached || pageOf(location.pathname) !== 'home' || !body) return false;
    const s = typeof body === 'string' ? body
      : (body instanceof URLSearchParams ? body.toString() : '');
    return FEED_PAGINATION.test(s);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (isFeedPage(body)) { dbg.blockedRequests++; log('XHR feed retenue'); return; }
    return origSend.call(this, body);
  };
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      if (init && isFeedPage(init.body)) {
        dbg.blockedRequests++; log('fetch feed retenue');
        return new Promise(() => {});
      }
      return origFetch.apply(this, arguments);
    };
  }

  // ------------------------------------------------------------------ feed
  const seen = new Map();            // code du post → rang d'affichage
  const POST_RE = /\/(?:p|reels?)\/([A-Za-z0-9_-]+)/;

  const postKey = (art) => {
    for (const a of art.querySelectorAll('a[href]')) {
      const m = a.getAttribute('href').match(POST_RE);
      if (m) return m[1];
    }
    return null;
  };

  const isAd = (art) =>
    !!art.querySelector('a[href*="facebook.com/ads/"], a[href*="/ads/ig_redirect"]') ||
    [...art.querySelectorAll('span, a, div')].some(el =>
      el.childElementCount === 0 &&
      /^(Sponsoris(é|ée)|Sponsored|Publicité|Partenariat rémunéré|Paid partnership)$/i.test(el.textContent.trim()));

  const isReel = (art) =>
    !!art.querySelector('a[href^="/reel/"], a[href^="/reels/"], a[href*="instagram.com/reel"]');

  const endCard = () => {
    let card = document.getElementById('cf-end');
    if (!card) {
      card = document.createElement('div');
      card.id = 'cf-end';
      card.innerHTML = '<div style="font-size:28px">✓</div>' +
        '<div><b>Vous êtes à jour</b></div>' +
        '<div style="opacity:.7">' + C.maxPosts + ' publications vues pour cette session.</div>' +
        '<a href="/direct/inbox/">Ouvrir les messages</a>';
    }
    return card;
  };

  const processFeed = (main) => {
    const arts = [...main.querySelectorAll('article')];
    let lastVisible = null;

    for (const art of arts) {
      if (art.dataset.cfHidden) continue;
      if (C.hideAds && isAd(art)) { hide(art, 'ad'); continue; }
      if (C.hideReels && isReel(art)) { hide(art, 'reel'); continue; }

      const key = postKey(art);
      if (!key) {                                    // squelette pas encore chargé
        if (limitReached) hide(art, 'limit');
        continue;
      }
      if (!seen.has(key) && seen.size < C.maxPosts) { seen.set(key, seen.size); dbg.seen.push(key); }
      if (!seen.has(key)) { hide(art, 'limit'); continue; }
      lastVisible = art;
    }

    limitReached = seen.size >= C.maxPosts;
    if (!limitReached) return;

    // Indicateur de chargement hors article = déclencheur du scroll infini.
    main.querySelectorAll('[role="progressbar"]').forEach(p => {
      if (!p.closest('article')) p.style.setProperty('display', 'none', 'important');
    });
    if (lastVisible) {
      const card = endCard();
      if (card.previousElementSibling !== lastVisible) lastVisible.after(card);
    }
  };

  // ------------------------------------------------------------------ suggestions, stories, onglets
  const SUGG_XPATH = ".//*[normalize-space(text())='Suggestions pour vous' or normalize-space(text())='Suggested for you'" +
    " or normalize-space(text())='Suggestions' or normalize-space(text())='Suggested posts' or normalize-space(text())='Publications suggérées']";

  const processSuggestions = (main) => {
    const snap = document.evaluate(SUGG_XPATH, main, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) {
      const label = snap.snapshotItem(i);
      const inArticle = label.closest('article');
      if (inArticle) { hide(inArticle, 'sugg'); continue; }
      // Remonter jusqu'au bloc frère des articles (carrousel de comptes, colonne de droite…)
      let el = label;
      for (let d = 0; d < 14 && el.parentElement && el.parentElement !== main; d++) {
        const parent = el.parentElement;
        if (parent.querySelector('article') && !el.querySelector('article')) { hide(el, 'sugg'); break; }
        el = parent;
      }
    }
  };

  const processStories = (main) => {
    const btns = [...main.querySelectorAll('[aria-label]')]
      .filter(b => /^Story (par|by|de) /i.test(b.getAttribute('aria-label')));
    if (!btns.length) return;
    let tray = btns[0].closest('ul');
    if (!tray) {
      tray = btns[0];
      const last = btns[btns.length - 1];
      while (tray && !tray.contains(last)) tray = tray.parentElement;
    }
    if (tray && tray !== main) hide(tray, 'stories');
  };

  let tabClicked = false;
  const ensureFollowing = (main) => {
    const tabs = main.querySelectorAll('[role="tab"]');
    if (tabs.length >= 2) {
      // Interface à onglets « Pour vous » / « Suivi(e) » : cliquer une seule fois.
      if (!tabClicked && tabs[1].getAttribute('aria-selected') !== 'true') {
        tabClicked = true;
        tabs[1].click();
        log('onglet Suivi(e) forcé');
      }
      return;
    }
    // Variante mobile sans onglets : paramètre d'URL, une fois par session pour éviter les boucles.
    if (!/variant=following/.test(location.search) && !sessionStorage.getItem('cf_variant') &&
        main.querySelector('article')) {
      sessionStorage.setItem('cf_variant', '1');
      location.replace('/?variant=following');
    }
  };

  // ------------------------------------------------------------------ autoplay
  if (C.noAutoplay) {
    let lastTap = 0;
    addEventListener('pointerdown', () => { lastTap = Date.now(); }, true);
    addEventListener('play', (e) => {
      const v = e.target;
      if (v && v.tagName === 'VIDEO' && Date.now() - lastTap > 1500 && pageOf(location.pathname) !== 'direct') {
        v.pause();
      }
    }, true);
  }

  // ------------------------------------------------------------------ boucle principale
  const apply = () => {
    ensureStyle();
    const main = document.querySelector('main');
    if (!main) return;
    const page = pageOf(location.pathname);
    if (page === 'home') {
      if (C.followingOnly) { try { ensureFollowing(main); } catch (e) { log(e); } }
      if (C.hideSuggestions) processSuggestions(main);
      if (C.hideStories) processStories(main);
      processFeed(main);
    } else if (page === 'other' && C.hideSuggestions) {
      processSuggestions(main);
    }
  };

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try { apply(); } catch (e) { log('apply', e); }
    });
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  schedule();
  log('chargé', C);
})();
