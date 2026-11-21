/*
 * Gestes façon application :
 *  - double-tap sur une publication (fil, page d'un post) ou un reel → « J'aime » ;
 *  - double-tap sur un message privé → réaction ❤️ ;
 *  - appui long sur un message privé (texte, post ou reel partagé) → sélecteur de réactions.
 * Toujours via les VRAIS boutons d'Instagram (« J'aime », « React to message »), jamais par une
 * requête fabriquée, et derrière le limiteur NS.act (pas plus vite qu'un humain).
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;

  const REACT = '[aria-label^="React to message"], [aria-label^="Réagir au message"], [aria-label^="Réagir"]';
  const LIKE = 'svg[aria-label="Like"], svg[aria-label="J’aime"], svg[aria-label="J\'aime"]';
  const UNLIKE = 'svg[aria-label="Unlike"], svg[aria-label="Je n’aime plus"], svg[aria-label="Je n\'aime plus"]';

  NS.css('gestures', `
    .cf-burst{position:fixed;z-index:2147483600;width:96px;height:96px;margin:-48px 0 0 -48px;pointer-events:none;
      color:#fff;filter:drop-shadow(0 4px 14px rgba(0,0,0,.35));animation:cf-burst .7s cubic-bezier(.2,.9,.3,1.2) forwards}
    @keyframes cf-burst{0%{transform:scale(.2);opacity:0}18%{transform:scale(1.12);opacity:1}
      38%{transform:scale(.95)}70%{transform:scale(1);opacity:1}100%{transform:scale(1.25) translateY(-18px);opacity:0}}
    /* Pas de sélection de texte ni de loupe au maintien sur un message : l'appui long ouvre les réactions. */
    html[data-cf-page="direct"] main [role="row"], html[data-cf-page="direct"] main [role="group"] ~ *{-webkit-user-select:none;user-select:none}
  `);

  const isThread = () => /^\/direct\/t\//.test(location.pathname);
  const btnOf = (svg) => svg && (svg.closest('[role="button"], button') || svg.parentElement);

  const burst = (x, y) => {
    const h = document.createElement('div');
    h.className = 'cf-burst';
    h.style.left = x + 'px';
    h.style.top = y + 'px';
    h.innerHTML = '<svg viewBox="0 0 24 24" width="96" height="96"><path fill="currentColor" d="M12 21.2s-8.6-5-9.8-10.6C1.4 6.9 3.8 3.8 7.2 3.8c2.1 0 3.8 1.1 4.8 2.8 1-1.7 2.7-2.8 4.8-2.8 3.4 0 5.8 3.1 5 6.8-1.2 5.6-9.8 10.6-9.8 10.6z"/></svg>';
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 750);
  };

  // ------------------------------------------------------------------ cibles
  /** Le plus petit ancêtre qui contient exactement UN bouton correspondant au sélecteur. */
  const ownerWith = (target, sel, maxDepth = 14) => {
    for (let e = target, d = 0; e && e !== document.body && d < maxDepth; e = e.parentElement, d++) {
      const n = e.querySelectorAll(sel).length;
      if (n === 1) return e;
      if (n > 1) return null;      // on est monté au-dessus de plusieurs publications
    }
    return null;
  };

  const waitFor = (fn, ms = 1200) => new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => { const r = fn(); if (r || Date.now() - t0 > ms) resolve(r); else setTimeout(tick, 50); };
    tick();
  });

  // ------------------------------------------------------------------ actions
  const likeAt = async (target, x, y) => {
    const box = ownerWith(target, `${LIKE}, ${UNLIKE}`);
    if (!box) return false;
    burst(x, y);
    if (box.querySelector(UNLIKE)) return true;                 // déjà aimé : on ne retire jamais un j'aime
    // Instagram gère parfois le double-tap lui-même : on lui laisse 350 ms avant d'agir.
    await new Promise(r => setTimeout(r, 350));
    if (box.querySelector(UNLIKE)) return true;
    if (!NS.act('like')) return true;
    const b = btnOf(box.querySelector(LIKE));
    if (b) { b.click(); NS.app && NS.app.haptic(); }
    return true;
  };

  const reactTo = async (target, emoji) => {
    const row = ownerWith(target, REACT);
    if (!row) return false;
    const b = btnOf(row.querySelector(REACT));
    if (!b) return false;
    if (emoji && !NS.act('react')) return true;
    b.click();                                                  // ouvre le sélecteur d'Instagram
    NS.app && NS.app.haptic();
    if (!emoji) return true;
    const opt = await waitFor(() => {
      const d = document.querySelector('[role="dialog"]');
      return d && [...d.querySelectorAll('[role="button"], button, [aria-label]')]
        .find(o => (o.getAttribute('aria-label') || o.textContent).trim() === emoji);
    });
    if (opt) opt.click();
    return true;
  };

  // ------------------------------------------------------------------ détection des gestes
  const INTERACTIVE = 'button, input, textarea, select, [contenteditable="true"], [role="textbox"], header, nav, #cf-top, .cf-sheet';
  let down = null, pressTimer = null, lastTap = null, suppressClickUntil = 0;

  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target, moved: false };
    clearTimeout(pressTimer);
    if (isThread() && !e.target.closest(INTERACTIVE)) {
      pressTimer = setTimeout(async () => {
        if (!down || down.moved) return;
        const ok = await reactTo(down.target, null);
        if (ok) { suppressClickUntil = Date.now() + 700; down = null; }
      }, 460);
    }
  }, true);

  addEventListener('pointermove', (e) => {
    if (!down) return;
    if (Math.abs(e.clientX - down.x) > 10 || Math.abs(e.clientY - down.y) > 10) { down.moved = true; clearTimeout(pressTimer); }
  }, true);

  const end = (e) => {
    clearTimeout(pressTimer);
    if (!down || down.moved || Date.now() - down.t > 350) { down = null; return; }
    const tap = { x: e.clientX, y: e.clientY, t: Date.now(), target: down.target };
    down = null;
    if (lastTap && tap.t - lastTap.t < 300 && Math.abs(tap.x - lastTap.x) < 32 && Math.abs(tap.y - lastTap.y) < 32) {
      lastTap = null;
      if (tap.target.closest(INTERACTIVE) && !tap.target.closest('article video, article img')) return;
      const page = NS.pageOf(location.pathname);
      if (isThread()) reactTo(tap.target, '❤️');
      else if (page === 'home' || page === 'reels' || page === 'other') likeAt(tap.target, tap.x, tap.y);
      return;
    }
    lastTap = tap;
  };
  addEventListener('pointerup', end, true);
  addEventListener('pointercancel', () => { clearTimeout(pressTimer); down = null; }, true);

  // Après un appui long, le relâchement ne doit pas ouvrir le post/reel partagé.
  addEventListener('click', (e) => {
    if (Date.now() < suppressClickUntil && !e.target.closest('[role="dialog"]')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener('contextmenu', (e) => { if (isThread()) e.preventDefault(); }, true);
})();
