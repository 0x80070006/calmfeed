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

    /* ---- barre du bas ---- */
    a[data-cf-tab]{position:relative;isolation:isolate}
    a[data-cf-tab][data-cf-active]::before{content:"";position:absolute;z-index:-1;top:50%;left:50%;width:76px;height:44px;
      transform:translate(-50%,-50%);border-radius:22px;background:rgb(var(--ig-secondary-button-background,239,239,239))}
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
    const mine = row.querySelector(`[aria-label*="${me}"], [aria-label*="Your story"], [aria-label*="Votre story"]`);
    let bubble = document.getElementById('cf-mystory');
    if (mine && mine.id !== 'cf-mystory') { if (bubble) bubble.remove(); return; }   // story active : bulle d'Instagram
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

  // ------------------------------------------------------------------ barre du bas
  const tabFor = (href) => {
    if (!href) return null;
    if (href === '/') return 'home';
    if (href.startsWith('/explore')) return 'explore';
    if (href.startsWith('/direct')) return 'direct';
    if (/^\/[^/]+\/$/.test(href)) return 'profile';
    return null;
  };
  const currentTab = () => {
    const p = location.pathname;
    if (p === '/') return 'home';
    if (p.startsWith('/explore')) return 'explore';
    if (p.startsWith('/direct')) return 'direct';
    return null;
  };

  const processNav = () => {
    const dm = [...document.querySelectorAll('a[href="/direct/inbox/"]')].find(a => !a.closest('main') && !a.closest('header'));
    if (!dm) return;
    let row = dm;
    while (row.parentElement && row.parentElement.querySelectorAll('a[href]').length < 3) row = row.parentElement;
    row = row.parentElement;
    if (!row) return;
    const cur = currentTab();
    for (const a of row.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (href === '/reels/') {                       // retire la case entière : pas de trou entre les icônes
        if (NS.C.hideReels) NS.hide(childOf(row, a), 'navReels');
        continue;
      }
      const tab = tabFor(href);
      if (!tab) continue;
      mark(a, 'data-cf-tab', tab);
      const active = tab === cur || (tab === 'profile' && location.pathname.startsWith(href));
      if (active !== a.hasAttribute('data-cf-active')) active ? a.setAttribute('data-cf-active', '') : a.removeAttribute('data-cf-active');
    }
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
