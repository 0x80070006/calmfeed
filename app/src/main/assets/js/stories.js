/*
 * Stories et stories à la une : glisser du haut de l'écran vers le bas pour fermer.
 * La story suit le doigt en rétrécissant ; relâchée assez bas, elle se réduit jusqu'au cercle d'où
 * elle a été ouverte (position mémorisée au toucher), puis le bouton « Fermer » d'Instagram est utilisé.
 * Sinon, elle reprend sa place. Rien n'est envoyé : c'est une simple fermeture.
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;

  const isStory = () => location.pathname.startsWith('/stories/');
  let origin = null;          // rectangle du cercle touché pour ouvrir la story

  // Mémorise le cercle touché : bulles du fil (« Story by… », « Votre story ») et stories à la une.
  addEventListener('pointerdown', (e) => {
    if (isStory()) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const bubble = t.closest('[aria-label^="Story"], #cf-mystory') ||
      (t.tagName === 'IMG' && /highlight|story/i.test(t.alt || '') ? t : null) ||
      (t.closest('[role="button"], li, a') && t.closest('[role="button"], li, a').querySelector('img[alt*="highlight" i]'));
    if (!bubble) return;
    const img = bubble.tagName === 'IMG' ? bubble : bubble.querySelector('img') || bubble;
    const r = img.getBoundingClientRect();
    if (r.width > 20 && r.width < 160) origin = { x: r.left, y: r.top, w: r.width, h: r.height };
  }, true);

  /** Calque plein écran de la story : ancêtre fixe du bouton « Fermer ». */
  const viewer = () => {
    const close = document.querySelector('svg[aria-label="Close"], svg[aria-label="Fermer"]');
    for (let e = close; e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (getComputedStyle(e).position === 'fixed' && r.width >= innerWidth - 2 && r.height >= innerHeight * 0.85) return e;
    }
    return null;
  };
  const closeBtn = () => {
    const s = document.querySelector('svg[aria-label="Close"], svg[aria-label="Fermer"]');
    return s && (s.closest('[role="button"], button') || s.parentElement);
  };

  let drag = null, suppressUntil = 0;

  addEventListener('touchstart', (e) => {
    if (!isStory() || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientY > innerHeight * 0.45) return;            // depuis le haut de l'écran uniquement
    const v = viewer();
    if (!v) return;
    drag = { y0: t.clientY, x0: t.clientX, dy: 0, on: false, v, t0: Date.now() };
  }, { capture: true, passive: true });

  addEventListener('touchmove', (e) => {
    if (!drag) return;
    const t = e.touches[0];
    const dy = t.clientY - drag.y0, dx = t.clientX - drag.x0;
    if (!drag.on) {
      if (dy > 14 && dy > Math.abs(dx) * 1.3) {
        drag.on = true;
        drag.v.style.transition = 'none';
        drag.v.style.willChange = 'transform';
        drag.v.style.transformOrigin = '50% 50%';
        drag.v.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (_) {} });
      } else if (Math.abs(dx) > 14 || dy < -14) { drag = null; return; }
      else return;
    }
    e.preventDefault();
    e.stopPropagation();
    drag.dy = Math.max(0, dy);
    const k = Math.max(0.55, 1 - drag.dy / 1100);
    drag.v.style.transform = `translate3d(0, ${drag.dy * 0.85}px, 0) scale(${k})`;
    drag.v.style.borderRadius = Math.min(28, drag.dy / 6) + 'px';
    drag.v.style.overflow = 'hidden';
  }, { capture: true, passive: false });

  const finish = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.on) return;
    e.preventDefault();
    e.stopPropagation();
    suppressUntil = Date.now() + 500;                      // ce relâchement n'est pas un « tap » (story suivante)
    const fast = d.dy > 60 && d.dy / Math.max(1, Date.now() - d.t0) > 0.7;
    const v = d.v;
    if (d.dy > 140 || fast) {
      const r = v.getBoundingClientRect();
      const o = origin || { x: innerWidth / 2 - 30, y: innerHeight / 2 - 30, w: 60, h: 60 };
      // De l'état courant vers le cercle d'origine.
      const baseW = innerWidth, baseH = innerHeight;
      const s = o.w / baseW;
      const tx = (o.x + o.w / 2) - baseW / 2;
      const ty = (o.y + o.h / 2) - baseH / 2;
      v.style.transition = 'transform .28s cubic-bezier(.3,.7,.2,1), border-radius .28s ease, opacity .28s ease';
      v.style.borderRadius = Math.max(r.width, r.height) + 'px';
      v.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;
      v.style.opacity = '0.35';
      setTimeout(() => {
        const b = closeBtn();
        if (b) b.click(); else history.back();
        setTimeout(() => { v.style.cssText = v.style.cssText.replace(/transform[^;]*;|opacity[^;]*;|transition[^;]*;|border-radius[^;]*;/g, ''); }, 400);
      }, 270);
    } else {
      v.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), border-radius .22s ease';
      v.style.transform = '';
      v.style.borderRadius = '';
      setTimeout(() => { v.style.transition = ''; v.style.willChange = ''; v.style.overflow = ''; }, 240);
    }
  };
  addEventListener('touchend', finish, { capture: true, passive: false });
  addEventListener('touchcancel', finish, { capture: true, passive: false });
  for (const ev of ['click', 'pointerup', 'mouseup']) {
    addEventListener(ev, (e) => { if (Date.now() < suppressUntil && isStory()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  }
})();
