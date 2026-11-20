/* Suggestions d'amis (carrousels, listes « Découvrir ») et bandeau « Utiliser l'application ». */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;
  const C = NS.C;

  const SUGG_ACCOUNT_LABELS = new Set([
    'Suggestions for you', 'Suggested for you', 'Suggestions pour vous', 'Suggéré pour vous',
    'Discover people', 'Découvrir des personnes', 'Similar accounts', 'Comptes similaires',
    'Suggested accounts', 'Comptes suggérés', 'People you may know', 'Personnes que vous connaissez peut-être',
  ]);
  const FOLLOW_RE = /^(Follow|Suivre|S’abonner|S'abonner)$/;

  const countFollowButtons = (el) => {
    let n = 0;
    const btns = el.querySelectorAll('button, [role="button"]');
    for (const b of btns) { if (FOLLOW_RE.test(b.textContent.trim())) { if (++n >= 2) break; } }
    return n;
  };

  // Remonte depuis le libellé jusqu'au plus petit bloc qui contient au moins 2 boutons « Suivre ».
  // On ne masque jamais un bloc qui contient une publication ou les compteurs d'un profil.
  const hideAccountBlock = (label, root) => {
    if (label.closest('article') || label.closest('[data-cf-hidden]')) return;
    let el = label;
    for (let d = 0; d < 16 && el && el !== root && el !== document.body; d++) {
      if (el.querySelector('article, a[href$="/followers/"], a[href$="/following/"]')) return;
      if (countFollowButtons(el) >= 2) { NS.hide(el, 'suggAccounts'); return; }
      el = el.parentElement;
    }
  };

  // Bandeau d'incitation à installer l'app native.
  const BANNER_LABELS = new Set(['Use the app', "Utiliser l'application", 'Ouvrir l’application', "Ouvrir l'application", 'Open app', 'Get the app']);
  let bannerChecks = 0;
  const hideBanner = () => {
    // Le bandeau apparaît au chargement : inutile de le chercher indéfiniment.
    if (++bannerChecks > 40) return;
    for (const lbl of NS.findLabels(document.body, BANNER_LABELS, 'span,a,div,button')) {
      let el = lbl;
      for (let d = 0; d < 8 && el && el !== document.body; d++) {
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') { NS.hide(el, 'banner'); break; }
        el = el.parentElement;
      }
    }
  };

  NS.modules.push({
    name: 'social',
    pages: ['home', 'explore', 'other'],
    every: 350,
    run({ main }) {
      if (C.hideSuggestedAccounts) {
        const root = main || document.body;
        for (const lbl of NS.findLabels(root, SUGG_ACCOUNT_LABELS)) hideAccountBlock(lbl, root);
      }
      if (C.hideAppBanner && document.body) hideBanner();
    },
  });
})();
