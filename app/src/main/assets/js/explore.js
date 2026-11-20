/*
 * Loupe / Explorer : la grille s'affiche par lots (10 par défaut), avec « Voir N de plus ».
 *
 * La grille est une liste virtualisée de rangées (conteneur flex en colonne avec padding).
 * Comme pour le fil : les rangées au-delà du lot sont réduites à 1 px DANS le callback de mutation
 * (jamais affichées, jamais mesurées à 0), la place réservée sous la liste est annulée, et les requêtes
 * de pagination sont MISES EN FILE (pas perdues) : « Voir plus » les envoie, Instagram reprend normalement.
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;
  const C = NS.C;
  const EX = 'html[data-cf-page="explore"] main';
  const TILE = 'a[href*="/p/"], a[href*="/reel/"]';
  const QUEUE = 'explore';

  if (C.hideExploreGrid) {
    NS.css('explore', `${EX} ${TILE.split(', ').join(`, ${EX} `)}{display:none!important}`);
    return;
  }

  const COLLAPSE = 'display:block!important;height:1px!important;min-height:0!important;margin:0!important;' +
    'padding:0!important;border:0!important;overflow:hidden!important;visibility:hidden!important;contain:strict';

  NS.css('exploreBatch', `
    ${EX} [data-cf-hidden="xrow"]{${COLLAPSE}}
    ${C.hideReels && !C.allowSingleReel ? `${EX} a[href*="/reel/"]{visibility:hidden!important;pointer-events:none!important}` : ''}
    #cf-more{display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 24px 120px;text-align:center;
      font:14px/1.45 system-ui,sans-serif;color:rgb(var(--ig-secondary-text,106,113,122))}
    #cf-more button{height:42px;padding:0 22px;border:0;border-radius:12px;font:600 15px system-ui,sans-serif;
      background:rgb(var(--ig-secondary-button-background,239,239,239));color:rgb(var(--ig-secondary-button,38,38,38));
      -webkit-tap-highlight-color:transparent;transition:transform .12s ease}
    #cf-more button:active{transform:scale(.97)}
  `);

  const batch = Math.max(3, C.exploreBatch || 10);
  let limit = batch;
  let limited = false;

  // Pagination de la grille mise en file tant que le lot est atteint (la recherche n'est jamais touchée).
  NS.blockers.push((name, path) => {
    if (!limited || NS.pageOf(location.pathname) !== 'explore') return false;
    const grid = (/explore|discover/i.test(name) && !/search|typeahead|route|root/i.test(name)) ||
      path.startsWith('/api/v1/discover/');
    return grid ? QUEUE : false;
  });

  const listOf = (tile, main) => {
    // Remonte jusqu'au conteneur virtualisé : style inline « flex-direction: column » posé par Instagram.
    for (let e = tile.parentElement; e && e !== main; e = e.parentElement) {
      const st = e.getAttribute('style') || '';
      if (st.includes('flex-direction: column') && st.includes('padding')) return e;
    }
    return null;
  };

  const moreCard = () => {
    let card = document.getElementById('cf-more');
    if (!card) {
      card = document.createElement('div');
      card.id = 'cf-more';
      card.innerHTML = `<span></span><button type="button">Voir ${batch} de plus</button>`;
      card.querySelector('button').addEventListener('click', () => {
        limit += batch;
        limited = false;
        document.querySelectorAll('[data-cf-hidden="xrow"], main [data-cf-hidden="loader"]').forEach(r => r.removeAttribute('data-cf-hidden'));
        const list = document.querySelector('[data-cf-ended]');
        if (list) list.removeAttribute('data-cf-ended');
        card.remove();
        NS.release(QUEUE);
        NS.schedule();
      });
    }
    // N'écrire que si le texte change : toute écriture déclenche une mutation (et donc ce module).
    const label = `${limit} publications affichées`;
    if (card.firstElementChild.textContent !== label) card.firstElementChild.textContent = label;
    return card;
  };

  const process = (main) => {
    const first = main.querySelector(TILE);
    if (!first) return;
    const list = listOf(first, main);
    if (!list) return;
    let count = 0, cut = false;
    for (const row of list.children) {
      if (row.id === 'cf-more') continue;
      const n = row.querySelectorAll(TILE).length;
      if (cut) {
        if (row.getAttribute('data-cf-hidden') !== 'xrow') row.setAttribute('data-cf-hidden', 'xrow');
        continue;
      }
      if (row.getAttribute('data-cf-hidden') === 'xrow') row.removeAttribute('data-cf-hidden');
      count += n;
      if (count >= limit) cut = true;            // la rangée en cours reste entière
    }
    limited = cut;
    if (limited) {
      if (!list.hasAttribute('data-cf-ended')) list.setAttribute('data-cf-ended', '');
      for (const p of main.querySelectorAll('[role="progressbar"]')) if (!list.contains(p) || p.closest('[data-cf-hidden]')) NS.hide(p, 'loader');
      const card = moreCard();
      if (card.previousElementSibling !== list) list.after(card);
    }
  };

  NS.modules.push({
    name: 'explore',
    pages: ['explore'],
    sync({ main }) { if (main) process(main); },
    run({ main }) { if (main) process(main); },
    onRoute(p) {
      if (NS.pageOf(p) === 'explore') { limit = batch; limited = false; }   // nouvelle visite : un lot
      else { limited = false; NS.release(QUEUE); }                         // on quitte : plus rien en file
    },
  });
})();
