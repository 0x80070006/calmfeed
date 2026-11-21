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

  // Signal « page prête » à l'app : elle retire alors son écran de chargement (pas d'écran Instagram
  // ni de mise en page qui saute pendant le chargement).
  let readySent = false;
  const readyCheck = () => {
    if (readySent) return;
    const main = document.querySelector('main');
    if (main && main.childElementCount && main.getBoundingClientRect().height > 100) {
      readySent = true;
      setTimeout(() => NS.app && NS.app.ready && NS.app.ready(), 120);   // une frame de marge pour nos styles
    } else setTimeout(readyCheck, 150);
  };
  readyCheck();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', NS.schedule);
  NS.schedule();
  NS.log('prêt', NS.C);
})();
