/*
 * Loupe / Explorer — grille d'Instagram telle quelle, limite CalmFeed par-dessus.
 * Après N publications : bannière fixe qui couvre la suite, défilement bloqué sous la bannière et
 * pagination retenue (rien n'est demandé au serveur). La grille n'est jamais modifiée.
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;
  const C = NS.C;
  const EX = 'html[data-cf-page="explore"] main';
  const TILE = 'a[href*="/p/"], a[href*="/reel/"]';

  if (C.hideExploreGrid) {
    NS.css('explore', `${EX} ${TILE.split(', ').join(`, ${EX} `)}{display:none!important}`);
    return;
  }

  const MAX = Math.max(3, C.exploreBatch || 10);
  let limited = false;

  // Pagination de la grille retenue une fois la limite atteinte (la recherche n'est jamais touchée).
  NS.blockers.push((name, path) => {
    if (!limited || NS.pageOf(location.pathname) !== 'explore') return false;
    return (/explore|discover/i.test(name) && !/search|typeahead|route|root/i.test(name)) ||
      path.startsWith('/api/v1/discover/');
  });

  const tiles = () => {
    const main = document.querySelector('main');
    return main ? [...main.querySelectorAll(TILE)].filter(a => a.getBoundingClientRect().width > 40) : [];
  };

  const gate = NS.endGate('explore', () => {
    const t = tiles();
    if (t.length < MAX) return null;
    return t[MAX - 1].getBoundingClientRect().bottom + scrollY;
  }, `Vous avez vu ${MAX} publications`, 'Utilisez la recherche pour trouver une personne ou un sujet.');

  NS.modules.push({
    name: 'explore',
    pages: ['explore'],
    every: 200,
    run() {
      if (location.pathname !== '/explore/') { gate.set(false); return; }   // recherche, tag… : pas de limite
      limited = tiles().length >= MAX;
      gate.set(limited);
    },
    onRoute(p) { if (NS.pageOf(p) !== 'explore') { limited = false; gate.reset(); } },
  });
})();
