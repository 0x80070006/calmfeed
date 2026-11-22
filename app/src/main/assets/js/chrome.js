/*
 * Barres d'interface façon application, construites à partir des VRAIS éléments d'Instagram
 * (leurs liens, leurs pastilles de notification), simplement réorganisés en CSS :
 *  - fil : ＋ à gauche, ♥ (pastille rouge native) et ⚙ CalmFeed à droite, sans titre « Following » ;
 *  - profil : pseudo centré, ⚙ Options à droite (Threads juste à sa gauche) ;
 *  - barre du bas : icônes réparties sans le trou laissé par Reels, onglet actif sur une pastille.
 * Le marquage est refait dans le callback de mutation : si React redessine l'en-tête, il est
 * remis en forme avant l'affichage.
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;

  const GEAR = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';

  NS.css('chrome', `
    /* ---- en-tête du fil ---- */
    [data-cf-hrow="home"]{display:grid!important;grid-template-columns:auto 1fr auto auto;align-items:center;
      column-gap:2px;padding:0 6px 0 2px!important}
    [data-cf-hrow="home"] > h1{display:none!important}
    [data-cf-hgroup]{display:contents!important}
    [data-cf-hplus]{grid-column:1;grid-row:1}
    [data-cf-hnotif]{grid-column:3;grid-row:1}
    .cf-gear{grid-column:4;grid-row:1;width:44px;height:44px;border:0;padding:0;background:none;display:grid;place-items:center;
      color:rgb(var(--ig-primary-icon,12,16,20));border-radius:50%;-webkit-tap-highlight-color:transparent}
    .cf-gear:active{background:rgb(var(--ig-hover-overlay,0,0,0,.06))}

    /* ---- en-tête de son profil ---- */
    [data-cf-hrow="profile"]{display:grid!important;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 16px!important}
    [data-cf-hrow="profile"] > h1{grid-column:2;grid-row:1;justify-self:center;width:auto!important;min-width:0}
    [data-cf-hrow="profile"] > h1 *{justify-content:center!important}
    [data-cf-hleft]{grid-column:3;grid-row:1;justify-self:end;width:auto!important}
    [data-cf-hright]{grid-column:3;grid-row:1;justify-self:end;width:auto!important;margin-right:44px;
      color:rgb(var(--ig-primary-icon,12,16,20))!important}
    [data-cf-hright] svg, [data-cf-hright] svg path{color:rgb(var(--ig-primary-icon,12,16,20))!important;fill:currentColor!important}

  `);

  const topHeader = () => document.querySelector('body > div header');

  const childOf = (parent, node) => {
    for (let e = node; e && e.parentElement; e = e.parentElement) if (e.parentElement === parent) return e;
    return null;
  };
  const mark = (el, attr, val = '') => { if (el && el.getAttribute(attr) !== val) el.setAttribute(attr, val); };

  // ------------------------------------------------------------------ fil
  const shapeHome = () => {
    const h = topHeader();
    const row = h && h.firstElementChild;
    if (!row) return;
    const plus = row.querySelector('a[href="#"]');
    const notif = row.querySelector('a[href="/notifications/"]');
    if (!plus || !notif) return;
    const group = childOf(row, notif);
    if (!group) return;
    mark(row, 'data-cf-hrow', 'home');
    mark(group, 'data-cf-hgroup');
    mark(childOf(group, plus), 'data-cf-hplus');
    mark(childOf(group, notif), 'data-cf-hnotif');
    if (!row.querySelector(':scope > .cf-gear')) {
      const b = document.createElement('button');
      b.className = 'cf-gear';
      b.type = 'button';
      b.setAttribute('aria-label', 'Réglages CalmFeed');
      b.innerHTML = GEAR;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); window.CalmApp && window.CalmApp.openSettings(); });
      row.appendChild(b);
    }
  };

  // ------------------------------------------------------------------ « Votre story » en tête des stories
  // Le fil « Suivi(e) » n'affiche pas votre bulle si vous n'avez pas de story active. On ajoute une
  // copie visuelle de la première bulle (même taille, même typo) avec votre photo et un ＋.
  // Si Instagram affiche déjà la vôtre (story active, anneau coloré), on ne touche à rien.
  NS.css('mystory', `
    #cf-mystory{position:relative;cursor:pointer}
    #cf-mystory canvas{display:none!important}
    #cf-mystory .cf-plus{position:absolute;z-index:2;right:4px;bottom:2px;width:22px;height:22px;border-radius:50%;pointer-events:none;
      display:grid;place-items:center;background:rgb(var(--ig-primary-button,74,93,249));color:#fff;
      box-shadow:0 0 0 3px rgb(var(--ig-primary-background,255,255,255))}
    #cf-mystory img{border-radius:50%}
    [data-cf-plusbadge]{background:rgb(var(--ig-primary-button,74,93,249))!important;border-color:rgb(var(--ig-secondary-background,239,239,239))!important}
    [data-cf-plusbadge] svg, [data-cf-plusbadge] svg *{color:#fff!important;stroke:#fff!important}
  `);

  const myUser = () => {
    const a = document.querySelector('a[data-cf-tab="profile"]');
    return a ? a.getAttribute('href').replace(/\//g, '') : null;
  };
  const myAvatar = () => {
    const img = document.querySelector('a[data-cf-tab="profile"] img');
    return img ? img.currentSrc || img.src : null;
  };

  const openStoryCreator = () => {
    const plus = topHeader() && topHeader().querySelector('a[href="#"]');
    if (!plus) { NS.toast('Création de story indisponible ici'); return; }
    plus.click();
    // Le ＋ d'Instagram ouvre « Post / Story » : on choisit Story.
    let tries = 0;
    const pick = () => {
      const dlg = document.querySelector('[role="dialog"]');
      const opt = dlg && [...dlg.querySelectorAll('*')].find(e => e.childElementCount === 0 && /^Story$/i.test(e.textContent.trim()));
      if (opt) { (opt.closest('[role="button"],button,a') || opt).click(); return; }
      if (++tries < 20) setTimeout(pick, 60);
    };
    setTimeout(pick, 60);
  };

  const shapeStories = (main) => {
    const first = main.querySelector('[role="button"][aria-label^="Story by"], [role="button"][aria-label^="Story par"], [role="button"][aria-label^="Story de"]');
    if (!first) return;
    const row = first.parentElement;
    const me = myUser();
    if (!row || !me) return;
    // Bulle d'Instagram pour votre story : libellé, ou simple texte « Your story » / « Votre story ».
    const mine = row.querySelector(`[aria-label*="${me}"], [aria-label*="Your story"], [aria-label*="Votre story"]`) ||
      [...row.children].find(c => c.id !== 'cf-mystory' &&
        [...c.querySelectorAll('span')].some(s => !s.childElementCount && /^(Your story|Votre story)$/i.test(s.textContent.trim())));
    let bubble = document.getElementById('cf-mystory');
    if (mine && mine.id !== 'cf-mystory') {
      if (bubble) bubble.remove();
      // Pastille ＋ d'Instagram : dessinée dans la couleur du fond (transparente avec nos thèmes) → on la rend visible.
      for (const d of mine.querySelectorAll('div')) {
        const r = d.getBoundingClientRect();
        if (r.width > 12 && r.width < 30 && getComputedStyle(d).borderRadius === '50%' && getComputedStyle(d).position === 'absolute' && d.querySelector('svg')) {
          if (!d.hasAttribute('data-cf-plusbadge')) d.setAttribute('data-cf-plusbadge', '');
        }
      }
      return;
    }
    if (bubble && bubble.parentElement === row && row.firstElementChild === bubble) return;
    if (bubble) bubble.remove();

    const src = myAvatar();
    bubble = first.cloneNode(true);                   // copie inerte (aucun lien React), même mise en page
    bubble.id = 'cf-mystory';
    bubble.setAttribute('aria-label', 'Ajouter à votre story');
    const img = bubble.querySelector('img');
    if (img && src) { img.src = src; img.srcset = ''; img.alt = 'Votre photo de profil'; }
    const label = [...bubble.querySelectorAll('span,div')].reverse().find(e => e.childElementCount === 0 && e.textContent.trim());
    if (label) label.textContent = 'Votre story';
    const plus = document.createElement('span');
    plus.className = 'cf-plus';
    plus.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    bubble.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openStoryCreator(); }, true);
    row.prepend(bubble);

    // Le cadre rond de la photo coupe ce qui dépasse (overflow:hidden) : la pastille ＋ est posée
    // sur la bulle elle-même, alignée sur le coin bas-droit de la photo.
    bubble.style.position = 'relative';
    bubble.style.overflow = 'visible';
    bubble.appendChild(plus);
    if (img) {
      const b = bubble.getBoundingClientRect(), r = img.getBoundingClientRect();
      plus.style.left = Math.round(r.right - b.left - 24) + 'px';
      plus.style.top = Math.round(r.bottom - b.top - 24) + 'px';
      plus.style.right = 'auto';
      plus.style.bottom = 'auto';
    }
  };

  // ------------------------------------------------------------------ profil
  const shapeProfile = () => {
    const h = topHeader();
    const row = h && h.firstElementChild;
    if (!row) return;
    const opts = row.querySelector('a[href*="/accounts/settings/"]');
    const title = row.querySelector(':scope > h1');
    if (!opts || !title) return;                      // pas son propre profil
    mark(row, 'data-cf-hrow', 'profile');
    const left = childOf(row, opts);
    mark(left, 'data-cf-hleft');
    for (const c of row.children) if (c !== left && c !== title) mark(c, 'data-cf-hright');
  };

  // ------------------------------------------------------------------ barre du bas d'Instagram
  // Remplacée par la barre native de l'app : on la masque, mais on lit encore ses liens
  // (pseudo, photo de profil, pastille Messages) pour les transmettre à l'app.
  const tabFor = (href) => {
    if (!href) return null;
    if (href === '/' || href.startsWith('/?')) return 'home';
    if (href.startsWith('/explore')) return 'explore';
    if (href.startsWith('/reels')) return 'reels';
    if (href.startsWith('/direct')) return 'direct';
    if (/^\/[A-Za-z0-9._]+\/$/.test(href)) return 'profile';
    return null;
  };

  NS.css('ignav', '[data-cf-ignav]{display:none!important}');

  let lastUser = '', lastBadge = -1;
  const processNav = () => {
    const dm = [...document.querySelectorAll('a[href="/direct/inbox/"]')].find(a => !a.closest('main') && !a.closest('header'));
    if (!dm) return;
    let row = dm;
    while (row.parentElement && row.parentElement.querySelectorAll('a[href]').length < 3) row = row.parentElement;
    row = row.parentElement;
    if (!row) return;
    // Conteneur fixe de la barre → masqué.
    for (let e = row; e && e !== document.body; e = e.parentElement) {
      if (getComputedStyle(e).position === 'fixed') { mark(e, 'data-cf-ignav'); break; }
    }
    for (const a of row.querySelectorAll('a[href]')) {
      const tab = tabFor(a.getAttribute('href'));
      if (tab) mark(a, 'data-cf-tab', tab);
    }
    if (!NS.app) return;
    // Pseudo + photo de profil → onglet Profil natif.
    const me = row.querySelector('a[data-cf-tab="profile"]');
    if (me) {
      const name = me.getAttribute('href').replace(/\//g, '');
      const img = me.querySelector('img');
      const key = name + '|' + (img ? img.src : '');
      if (key !== lastUser) { lastUser = key; NS.app.setUser(name, img ? (img.currentSrc || img.src) : ''); }
    }
    // Pastille Messages : « Direct messaging - 3 new notifications… ».
    const cell = childOf(row, dm) || dm;
    const lbl = [dm, ...cell.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label') || '')
      .find(l => /\d/.test(l) && /notif|message/i.test(l)) || '';
    const m = lbl.match(/(\d+)/);
    const n = m ? +m[1] : 0;
    if (n !== lastBadge) { lastBadge = n; NS.app.badge('direct', n); }
  };

  // ------------------------------------------------------------------ flèches « retour » d'Instagram
  // Les flèches en haut à gauche sont souvent des liens vers « / » : sans ceci, elles ouvraient
  // l'onglet Accueil. Elles font maintenant exactement comme le retour système : page précédente
  // dans l'onglet, puis la racine de l'onglet, puis l'Accueil.
  const BACK_SEL = 'svg[aria-label="Back"], svg[aria-label="Retour"], svg[aria-label="Go back"]';
  document.addEventListener('click', (e) => {
    if (!NS.app || !NS.app.back || !e.isTrusted) return;     // nos propres clics (envoi de réponse) passent
    const t = e.target && e.target.closest && e.target.closest('a, [role="button"], button');
    if (!t || t.closest('.cf-sheet')) return;
    if (!t.querySelector(BACK_SEL) && !t.matches('[aria-label="Back"], [aria-label="Retour"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    NS.app.back();
  }, true);

  // ------------------------------------------------------------------ liens vers un autre onglet
  // Un lien vers la racine d'un autre onglet (Accueil, Recherche, Messages, son Profil) ouvre cet
  // onglet natif — déjà chargé — au lieu de recharger la page dans l'onglet courant.
  document.addEventListener('click', (e) => {
    if (!NS.app) return;
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.closest('#cf-mystory')) return;
    const href = a.getAttribute('href');
    let tab = null;
    if (href === '/' || href === '/?variant=following' || href === '/?variant=home') tab = 'home';
    else if (href === '/explore/') tab = 'explore';
    else if (href === '/reels/') tab = 'reels';
    else if (href === '/direct/inbox/') tab = 'direct';
    else if (lastUser && href === '/' + lastUser.split('|')[0] + '/') tab = 'profile';
    if (!tab || tab === NS.tab) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    NS.app.switchTab(tab);
  }, true);

  /** Menu de création d'Instagram (Publication / Story / Reel), via le ＋ de l'en-tête. */
  NS.openCreate = () => {
    const plus = topHeader() && topHeader().querySelector('a[href="#"]');
    if (plus) plus.click(); else NS.toast('Création indisponible ici');
  };

  const shape = (page) => {
    if (page === 'home') shapeHome();
    else if (page === 'other') shapeProfile();
  };

  NS.modules.push({
    name: 'chrome',
    sync({ page }) { shape(page); },
    run({ page, main }) {
      shape(page);
      processNav();
      if (page === 'home' && main && !NS.C.hideStories) shapeStories(main);
    },
  });
})();
