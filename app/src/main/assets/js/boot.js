/* Démarrage : routes, clics vers des pages bloquées, observation du DOM. */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;
  NS.started = true;

  addEventListener('popstate', NS.onRoute);
  NS.onRoute();

  // Bloque le clic avant que React ne rende la page interdite (pas de requête, pas de flash).
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch (_) { return; }
    if (u.origin !== location.origin) return;
    if (NS.redirectFor(u.pathname) !== null) {
      e.preventDefault();
      e.stopImmediatePropagation();
      NS.toast('Les Reels sont désactivés');
    }
  }, true);

  new MutationObserver(NS.onMutations).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', NS.schedule);
  NS.schedule();
  NS.log('prêt', NS.C);
})();
