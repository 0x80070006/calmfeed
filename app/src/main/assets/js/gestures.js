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
  // Nombre de boutons distincts (le libellé est porté à la fois par le bouton et par son icône).
  const countBtns = (root, sel) => new Set([...root.querySelectorAll(sel)].map(x => x.closest('[role="button"], button') || x)).size;
  const ownerWith = (target, sel, maxDepth = 24) => {
    for (let e = target, d = 0; e && e !== document.body && d < maxDepth; e = e.parentElement, d++) {
      const n = countBtns(e, sel);
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
    // Instagram ne crée le bouton « Réagir » d'un message qu'après l'avoir touché : on l'attend.
    const row = ownerWith(target, REACT) || await waitFor(() => ownerWith(target, REACT), 700);
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
  // Dans une conversation, tout message compte (texte, reel partagé, vocal) : seule la saisie est exclue.
  const TYPING = 'input, textarea, select, [contenteditable="true"], [role="textbox"], header, nav, [role="dialog"]';
  const ACTIONS = '[aria-label^="React"], [aria-label^="Reply"], [aria-label^="See more"], [aria-label^="Réagir"], [aria-label^="Répondre"]';
  // Zone d'un message : contenu de la conversation, hors saisie, en-tête et boutons d'action.
  const inMessage = (el) => isThread() && el && el.closest && !el.closest(TYPING) && !el.closest(ACTIONS) &&
    !el.closest('[data-cf-ignav], .cf-sheet, #cf-toast');

  let down = null, pressTimer = null, lastTap = null, suppressClickUntil = 0;
  let heldClick = null;                 // clic simple différé (double-tap possible)

  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target, moved: false };
    clearTimeout(pressTimer);
    if (inMessage(e.target)) {
      pressTimer = setTimeout(async () => {
        if (!down || down.moved) return;
        const ok = await reactTo(down.target, null);           // appui long : panneau de réactions
        if (ok) { suppressClickUntil = Date.now() + 700; down = null; }
      }, 450);
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
    if (lastTap && tap.t - lastTap.t < 300 && Math.abs(tap.x - lastTap.x) < 40 && Math.abs(tap.y - lastTap.y) < 40) {
      lastTap = null;
      if (heldClick) { clearTimeout(heldClick.timer); heldClick = null; }   // annule l'ouverture du message
      suppressClickUntil = Date.now() + 400;
      if (isThread()) { if (inMessage(tap.target)) reactTo(tap.target, '❤️'); return; }
      if (tap.target.closest(INTERACTIVE) && !tap.target.closest('article video, article img')) return;
      const page = NS.pageOf(location.pathname);
      if (page === 'home' || page === 'reels' || page === 'other') likeAt(tap.target, tap.x, tap.y);
      return;
    }
    lastTap = tap;
  };
  addEventListener('pointerup', end, true);
  addEventListener('pointercancel', () => { clearTimeout(pressTimer); down = null; }, true);

  addEventListener('click', (e) => {
    if (e.__cfReplay) return;
    // Après un appui long ou un double-tap : le relâchement n'ouvre rien. Seuls VOS clics sont
    // bloqués : ceux de l'app (bouton « Réagir », emoji) doivent passer.
    if (e.isTrusted && Date.now() < suppressClickUntil && !e.target.closest('[role="dialog"]')) {
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    // Clic simple sur un message (reel partagé, vocal, lien) : différé de 280 ms pour laisser
    // la place au double-tap, puis rejoué tel quel.
    if (e.isTrusted && inMessage(e.target)) {
      e.preventDefault(); e.stopImmediatePropagation();
      const target = e.target;
      if (heldClick) clearTimeout(heldClick.timer);
      heldClick = { timer: setTimeout(() => {
        heldClick = null;
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
        ev.__cfReplay = true;
        target.dispatchEvent(ev);
      }, 280) };
    }
  }, true);
  addEventListener('contextmenu', (e) => { if (isThread()) e.preventDefault(); }, true);
  // Double-clic natif d'Instagram neutralisé dans les conversations : seul le double-tap CalmFeed agit
  // (sinon les deux s'annulent : ❤️ puis retrait).
  addEventListener('dblclick', (e) => { if (isThread()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
})();
