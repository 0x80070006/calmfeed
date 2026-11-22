/*
 * CalmFeed : noyau injecté au tout début de chaque page instagram.com.
 * Ordre de chargement (concaténé par MainActivity) : core, theme, feed, social, nonfollowers, boot.
 * Principe : on masque et on retient côté client. Seul nonfollowers.js émet des requêtes,
 * uniquement à la demande de l'utilisateur, lentement, avec les mêmes paramètres que le site.
 * Debug : chrome://inspect, puis taper window.__cfDebug dans la console.
 */
(() => {
  if (window.top !== window || window.__cf) return;

  const C = Object.assign({
    maxPosts: 15,
    soundOn: true, hideReels: true, hideFeedReels: true, allowSingleReel: true, hideExploreGrid: true,
    hideAds: true, hideSuggestedPosts: true, hideSuggestedAccounts: true,
    hideStories: false, followingOnly: true, noAutoplay: true,
    hideAppBanner: true, nonFollowersButton: true,
    palette: null, paletteDark: false, decoShapes: true,
  }, window.__CF || {});

  const dbg = { config: C, hidden: {}, blockedRequests: 0, seen: [], errors: [], runs: 0, avgMs: 0 };
  const NS = window.__cf = { C, dbg, modules: [], redirects: [], blockers: [], started: false };
  window.__cfDebug = dbg;

  NS.log = (...a) => console.debug('[CF]', ...a);

  // Bouton retour Android : l'app demande d'abord à la page de fermer un panneau ouvert.
  NS.backHandlers = [];
  NS.back = () => NS.backHandlers.some(h => { try { return h(); } catch (_) { return false; } });
  NS.err = (where, e) => { dbg.errors.push(where + ': ' + (e && e.message || e)); NS.log(where, e); };

  // ------------------------------------------------------------------ pages
  NS.pageOf = (p) =>
    p === '/' ? 'home' :
    p.startsWith('/explore') ? 'explore' :
    p.startsWith('/direct') ? 'direct' :
    p.startsWith('/reels') ? 'reels' :
    p.startsWith('/accounts') ? 'accounts' : 'other';

  // Pont vers l'app native (une WebView par onglet ; C.tab = onglet de cette WebView).
  NS.app = window.CalmApp || null;
  NS.tab = C.tab || 'home';

  /**
   * Limiteur d'actions rapides (j'aime, réactions) : jamais plus vite qu'un humain.
   * Au moins 1,2 s entre deux actions, 25 au plus sur 10 minutes glissantes.
   */
  const actLog = [];
  let lastAct = 0;
  NS.act = (what) => {
    const now = Date.now();
    while (actLog.length && now - actLog[0] > 600e3) actLog.shift();
    if (now - lastAct < 1200) return false;
    if (actLog.length >= 25) { NS.toast('Doucement : trop d\'actions en peu de temps'); return false; }
    lastAct = now;
    actLog.push(now);
    return true;
  };

  NS.cookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  };

  // ------------------------------------------------------------------ styles
  const styleEl = document.createElement('style');
  styleEl.id = 'cf-style';
  const cssParts = new Map();
  NS.css = (id, text) => { cssParts.set(id, text); styleEl.textContent = [...cssParts.values()].join('\n'); };
  NS.ensureStyle = () => {
    if (!styleEl.isConnected) (document.head || document.documentElement).appendChild(styleEl);
  };

  // Masquage par attribut : une seule règle CSS, pas de style inline à recalculer.
  NS.css('base', `
    [data-cf-hidden]{display:none!important}
    #cf-toast{position:fixed;left:50%;bottom:84px;z-index:2147483646;
      transform:translate(-50%,8px);opacity:0;pointer-events:none;max-width:86vw;
      background:rgb(var(--ig-primary-text,12,16,20));color:rgb(var(--ig-primary-background,255,255,255));
      padding:10px 16px;border-radius:12px;font:500 14px/1.35 system-ui,sans-serif;
      box-shadow:0 6px 24px rgba(0,0,0,.18);transition:opacity .18s ease,transform .18s ease}
    #cf-toast.on{opacity:1;transform:translate(-50%,0)}
  `);

  NS.hide = (el, why) => {
    if (!el || el.hasAttribute('data-cf-hidden')) return;
    el.setAttribute('data-cf-hidden', why);
    dbg.hidden[why] = (dbg.hidden[why] || 0) + 1;
    const vids = el.getElementsByTagName('video');
    for (let i = 0; i < vids.length; i++) { try { vids[i].pause(); } catch (_) {} }
  };

  let toastTimer;
  NS.toast = (msg, ms = 2000) => {
    let t = document.getElementById('cf-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cf-toast';
      t.setAttribute('role', 'status');
      (document.body || document.documentElement).appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add('on'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  };

  // Correspondance exacte d'un texte « feuille » (libellés IG localisés).
  // Parcours direct des éléments texte courants : ~30x plus rapide qu'une requête XPath sur tout l'arbre.
  NS.findLabels = (root, labels, tags = 'span,h2,h3,a') => {
    const set = labels instanceof Set ? labels : new Set(labels);
    const out = [];
    for (const tag of tags.split(',')) {
      const els = root.getElementsByTagName(tag);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.childElementCount !== 0) continue;
        const t = el.textContent;
        if (t.length < 48 && set.has(t.trim())) out.push(el);
      }
    }
    return out;
  };

  // ------------------------------------------------------------------ ordonnanceur
  // Au plus une passe toutes les 120 ms, alignée sur une frame : fluide même sur un feed chargé.
  // Les modules coûteux déclarent « every » (ms) : ils tournent moins souvent, avec une passe de rattrapage.
  let queued = false, lastRun = 0, catchUp = null;
  const run = () => {
    queued = false;
    const t0 = performance.now();
    lastRun = t0;
    NS.ensureStyle();
    const ctx = { path: location.pathname, page: NS.pageOf(location.pathname), main: document.querySelector('main') };
    let deferred = 0;
    for (const m of NS.modules) {
      if (m.pages && !m.pages.includes(ctx.page)) continue;
      if (m.every && t0 - (m.last || 0) < m.every) { deferred = Math.max(deferred, m.every - (t0 - m.last)); continue; }
      m.last = t0;
      try { m.run(ctx); } catch (e) { NS.err(m.name, e); }
    }
    if (deferred && !catchUp) catchUp = setTimeout(() => { catchUp = null; NS.schedule(); }, deferred + 10);
    dbg.runs++;
    dbg.avgMs = +(dbg.avgMs * 0.9 + (performance.now() - t0) * 0.1).toFixed(2);
  };
  // Modules « sync » : exécutés dans le callback du MutationObserver, donc AVANT le rendu de la frame.
  // Un post masqué ainsi n'apparaît jamais à l'écran et n'est jamais mesuré par la liste virtualisée.
  // Disjoncteur : si une écriture provoquait une boucle de mutations, on suspend les passes « sync »
  // jusqu'à la frame suivante au lieu de geler la page.
  let burst = 0, burstStart = 0, tripped = false;
  NS.onMutations = () => {
    const now = performance.now();
    if (now - burstStart > 100) { burstStart = now; burst = 0; }
    if (++burst > 60) {
      if (!tripped) { tripped = true; NS.err('sync', 'boucle de mutations interrompue'); requestAnimationFrame(() => { tripped = false; }); }
      NS.schedule();
      return;
    }
    const page = NS.pageOf(location.pathname);
    let ctx = null;
    for (const m of NS.modules) {
      if (!m.sync || (m.pages && !m.pages.includes(page))) continue;
      ctx = ctx || { path: location.pathname, page, main: document.querySelector('main'), sync: true };
      try { m.sync(ctx); } catch (e) { NS.err(m.name + ':sync', e); }
    }
    NS.schedule();
  };

  NS.schedule = () => {
    if (queued) return;
    queued = true;
    const wait = Math.max(0, 120 - (performance.now() - lastRun));
    setTimeout(() => requestAnimationFrame(run), wait);
  };

  // ------------------------------------------------------------------ routes (SPA)
  NS.redirectFor = (path) => {
    for (const r of NS.redirects) { const to = r(path); if (to != null) return to; }
    return null;
  };

  let lastPath = null;
  NS.onRoute = () => {
    const p = location.pathname;
    const to = NS.redirectFor(p);
    if (to !== null) { location.replace(to); return; }
    if (p !== lastPath) {
      lastPath = p;
      document.documentElement.dataset.cfPage = NS.pageOf(p);
      for (const m of NS.modules) { if (m.onRoute) { try { m.onRoute(p); } catch (e) { NS.err(m.name, e); } } }
      NS.schedule();
    }
  };

  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) {
      const r = orig.apply(this, args);
      try { NS.onRoute(); } catch (e) { NS.err('route', e); }
      return r;
    };
  }

  // ------------------------------------------------------------------ réseau
  // Un « blocker » renvoie :
  //   true          → requête retenue pour toujours (le site attend, rien ne part vers le serveur) ;
  //   'nom-de-file' → requête mise en file, envoyée telle quelle plus tard par NS.release('nom-de-file').
  const bodyText = (b) => typeof b === 'string' ? b : (b instanceof URLSearchParams ? b.toString() : '');
  const queues = new Map();
  dbg.held = [];
  /**
   * Les modules ne voient QUE le nom de la requête (fb_api_req_friendly_name) et le chemin de l'URL.
   * Jamais le corps entier : Instagram y joint la page d'origine (« …ExploreRoute », « …FeedRoute »)
   * dans TOUTES les requêtes, ce qui faisait retenir les navigations vers d'autres pages.
   */
  const reqName = (body) => {
    const m = body.match(/(?:^|&)fb_api_req_friendly_name=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };
  const urlPath = (url) => { try { return new URL(url, location.href).pathname; } catch (_) { return ''; } };
  const decide = (url, body) => {
    const name = reqName(bodyText(body));
    const path = urlPath(url || '');
    for (const fn of NS.blockers) {
      const r = fn(name, path);
      if (r) {
        dbg.blockedRequests++;
        dbg.held.push((name || path).slice(0, 80));
        if (dbg.held.length > 20) dbg.held.shift();
        return r;
      }
    }
    return null;
  };
  const enqueue = (group, send) => {
    if (group === true) return;
    if (!queues.has(group)) queues.set(group, []);
    queues.get(group).push(send);
  };
  NS.release = (group) => {
    const q = queues.get(group) || [];
    queues.delete(group);
    for (const send of q) { try { send(); } catch (e) { NS.err('release', e); } }
    return q.length;
  };

  // En-têtes d'API envoyés par le site lui-même : on les réutilise tels quels.
  const igHeaders = {};
  const KEEP = /^(x-ig-app-id|x-asbd-id|x-ig-www-claim|x-web-session-id)$/i;

  const XO = XMLHttpRequest.prototype;
  const origOpen = XO.open, origSend = XO.send, origSet = XO.setRequestHeader;
  XO.open = function (method, url) { this.__cfUrl = String(url); return origOpen.apply(this, arguments); };
  XO.setRequestHeader = function (k, v) {
    if (KEEP.test(k) && this.__cfUrl && this.__cfUrl.includes('/api/')) igHeaders[k.toLowerCase()] = v;
    return origSet.apply(this, arguments);
  };
  // ---- lecture des réponses GraphQL d'Instagram au passage (aucune requête en plus) ----
  // NS.onGql(nom, fn) : fn(json) est appelée pour chaque réponse de la requête « nom ».
  const gqlHandlers = new Map();
  NS.onGql = (name, fn) => { if (!gqlHandlers.has(name)) gqlHandlers.set(name, []); gqlHandlers.get(name).push(fn); };
  const feedGql = (name, text) => {
    const fns = gqlHandlers.get(name);
    if (!fns || !text) return;
    for (const line of text.split(/\r?\n/)) {
      const t = line.replace(/^for \(;;\);/, '').trim();
      if (!t || t[0] !== '{') continue;
      let j; try { j = JSON.parse(t); } catch (_) { continue; }
      for (const fn of fns) { try { fn(j); } catch (e) { NS.err('gql:' + name, e); } }
    }
  };

  XO.send = function (body) {
    const g = decide(this.__cfUrl, body);
    if (g) { enqueue(g, () => origSend.call(this, body)); return; }
    const name = reqName(bodyText(body));
    if (name && gqlHandlers.has(name)) this.addEventListener('load', () => { try { feedGql(name, this.responseText); } catch (_) {} });
    return origSend.call(this, body);
  };

  const origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const g = decide(url, init && init.body);
      if (g) return new Promise((resolve) => enqueue(g, () => resolve(origFetch(input, init))));
      const name = reqName(bodyText(init && init.body));
      const p = origFetch(input, init);
      if (name && gqlHandlers.has(name)) p.then(r => r.clone().text()).then(t => feedGql(name, t)).catch(() => {});
      return p;
    };
  }
  NS.fetch = origFetch;

  /**
   * Navigation interne sans rechargement : on change l'URL puis on prévient le routeur d'Instagram
   * comme le ferait le bouton « précédent ». Mesuré : ~120 ms contre un rechargement complet.
   */
  NS.navigate = (url, replace) => {
    const main = document.querySelector('main');
    const before = main && main.firstElementChild;
    history[replace ? 'replaceState' : 'pushState'](history.state, '', url);
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    // Le routeur d'Instagram n'accepte pas ce raccourci depuis toutes les pages (ex. profil) :
    // si le contenu n'a pas changé après 1,5 s, on charge la page normalement.
    setTimeout(() => {
      const now = document.querySelector('main');
      const target = new URL(url, location.href);
      if (location.pathname + location.search !== target.pathname + target.search) return;  // déjà ailleurs
      if (now && now === main && now.firstElementChild === before) location.replace(url);
    }, 1500);
  };

  NS.apiHeaders = (extra) => Object.assign({
    'x-ig-app-id': igHeaders['x-ig-app-id'] || '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
    'x-csrftoken': NS.cookie('csrftoken') || '',
  },
  igHeaders['x-asbd-id'] ? { 'x-asbd-id': igHeaders['x-asbd-id'] } : {},
  igHeaders['x-ig-www-claim'] ? { 'x-ig-www-claim': igHeaders['x-ig-www-claim'] } : {},
  extra || {});

  /**
   * Fin de limite (fil, Explorer) : bannière fixe qui couvre tout ce qui suit la dernière publication
   * autorisée, et défilement bloqué juste sous la bannière. La liste d'Instagram n'est jamais modifiée.
   * @param page   page concernée ('home', 'explore')
   * @param endAbs () => position absolue (px) du bas de la dernière publication autorisée, ou null
   */
  NS.endGate = (page, endAbs, title, text) => {
    let cover = null, raf = 0, active = false, lastEnd = null;
    const MARGIN = 0.42;                                    // la bannière occupe le bas de l'écran
    const place = () => {
      raf = 0;
      const on = active && NS.pageOf(location.pathname) === page;
      if (!on) { if (cover) cover.classList.remove('on'); return; }
      const e = endAbs();
      if (e != null) lastEnd = e;
      if (lastEnd == null) return;
      if (!cover) {
        cover = document.createElement('div');
        cover.className = 'cf-endcover';
        cover.innerHTML = '<div class="ck"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
          `<h3>${title}</h3><p>${text}</p>`;
        document.body.appendChild(cover);
      }
      // Défilement bloqué : on ne peut pas descendre au-delà de « bannière visible sur ~60 % de l'écran ».
      const maxY = Math.max(0, lastEnd - innerHeight * (1 - MARGIN));
      if (scrollY > maxY + 1) scrollTo({ top: maxY, behavior: 'instant' });
      const top = Math.max(0, Math.round(lastEnd - scrollY));
      cover.style.top = top + 'px';
      cover.classList.toggle('on', top < innerHeight);
    };
    const tick = () => { if (!raf) raf = requestAnimationFrame(place); };
    addEventListener('scroll', () => { if (active) tick(); }, { passive: true });
    addEventListener('resize', () => { if (active) tick(); });
    return {
      set(on) { if (on !== active) { active = on; if (!on) lastEnd = null; } tick(); },
      reset() { active = false; lastEnd = null; tick(); },
    };
  };
  NS.css('endcover', `
    .cf-endcover{position:fixed;left:0;right:0;bottom:0;z-index:5;display:none;flex-direction:column;align-items:center;
      padding:36px 24px 0;text-align:center;font:15px/1.5 system-ui,sans-serif;
      background:rgb(var(--ig-primary-background,255,255,255));color:rgb(var(--ig-primary-text,12,16,20));
      border-top:1px solid rgb(var(--ig-separator,219,223,228))}
    .cf-endcover.on{display:flex}
    .cf-endcover .ck{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;margin-bottom:14px;
      background:rgb(var(--ig-secondary-button-background,239,239,239));color:rgb(var(--ig-secondary-button,38,38,38))}
    .cf-endcover h3{margin:0 0 6px;font-size:19px}
    .cf-endcover p{margin:0;max-width:280px;color:rgb(var(--ig-secondary-text,106,113,122))}
  `);

  NS.sleep = (ms, signal) => new Promise((ok, ko) => {
    const t = setTimeout(ok, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); ko(new DOMException('abort', 'AbortError')); }, { once: true });
  });
  NS.jitter = (a, b) => a + Math.random() * (b - a);
})();
