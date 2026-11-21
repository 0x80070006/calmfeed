/*
 * Page Reels (uniquement si les Reels ne sont pas bloqués) :
 *  - le reel occupe toute la hauteur ; par-dessus, en haut : ＋ à gauche (Story / Publication / Reel)
 *    et à droite un interrupteur « Pour toi » / « Abonnements » ;
 *  - « Abonnements » = le vrai flux d'Instagram réservé aux comptes suivis (/reels/?tab=following) :
 *    aucun tri ni saut automatique, donc aucune requête en plus ;
 *  - limite de N reels par session, puis écran de fin (défilement bloqué).
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started || NS.C.hideReels) return;
  const C = NS.C;
  const MAX = Math.max(3, C.reelsMax || 10);
  const MODE_KEY = 'cf_reels_mode';

  NS.css('reels', `
    [data-cf-reels]{top:0!important;bottom:0!important;height:auto!important;max-height:none!important}
    [data-cf-reels][data-cf-locked]{overflow:hidden!important}
    [data-cf-igreelshead]{display:none!important}
    #cf-reels-top{position:fixed;top:0;left:0;right:0;z-index:2147483000;height:56px;display:none;align-items:center;
      justify-content:space-between;padding:0 10px;background:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,0));
      color:#fff;pointer-events:none}
    html[data-cf-page="reels"] #cf-reels-top{display:flex}
    #cf-reels-top > *{pointer-events:auto}
    #cf-reels-top .plus{width:44px;height:44px;border:0;border-radius:50%;background:none;color:#fff;display:grid;place-items:center;
      filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));-webkit-tap-highlight-color:transparent}
    #cf-reels-top .seg{display:flex;padding:3px;border-radius:18px;background:rgba(0,0,0,.35);backdrop-filter:blur(8px)}
    #cf-reels-top .seg button{height:30px;padding:0 13px;border:0;border-radius:15px;background:none;color:rgba(255,255,255,.75);
      font:600 13px system-ui,sans-serif;-webkit-tap-highlight-color:transparent;transition:background .2s,color .2s}
    #cf-reels-top .seg button[aria-pressed="true"]{background:rgba(255,255,255,.95);color:#111}
    #cf-reels-end{position:fixed;inset:0;z-index:2147483100;display:none;flex-direction:column;align-items:center;
      justify-content:center;gap:10px;padding:32px;text-align:center;background:rgba(0,0,0,.78);color:#fff;
      font:15px/1.5 system-ui,sans-serif;backdrop-filter:blur(6px)}
    #cf-reels-end.on{display:flex}
    #cf-reels-end h3{margin:6px 0 0;font-size:20px}
    #cf-reels-end p{margin:0;opacity:.75;max-width:280px}
    #cf-reels-end button{margin-top:14px;height:44px;padding:0 22px;border:0;border-radius:12px;font:600 15px system-ui,sans-serif;
      background:#fff;color:#111}
  `);

  const savedMode = () => { try { return localStorage.getItem(MODE_KEY) || 'all'; } catch (_) { return 'all'; } };
  const urlMode = () => /(^|&|\?)tab=following/.test(location.search) ? 'following' : 'all';
  const seen = new Set();
  let locked = false, modeApplied = false;

  // Au premier affichage, on ouvre le flux choisi la dernière fois (une seule fois, pas de boucle).
  const applySavedMode = () => {
    if (modeApplied || NS.pageOf(location.pathname) !== 'reels') return;
    modeApplied = true;
    if (savedMode() === 'following' && urlMode() !== 'following') location.replace('/reels/?tab=following');
  };

  const scroller = () => document.querySelector('[data-cf-reels]');
  const findScroller = (main) => {
    if (scroller()) return scroller();
    for (const d of main.getElementsByTagName('div')) {
      const cs = getComputedStyle(d);
      if (cs.position === 'fixed' && (cs.overflowY === 'scroll' || cs.overflowY === 'auto') && d.querySelector('video')) {
        d.setAttribute('data-cf-reels', '');
        return d;
      }
    }
    return null;
  };

  // En-tête « For you ⌄ » d'Instagram : remplacé par notre interrupteur.
  const hideIgHead = (main) => {
    const lbl = [...main.querySelectorAll('span')].find(e => e.childElementCount === 0 &&
      /^(For you|Pour vous|Following|Abonnements|Suivi\(e\)s)$/.test(e.textContent.trim()) && e.getBoundingClientRect().top < 90);
    if (!lbl) return;
    for (let e = lbl; e && e !== main; e = e.parentElement) {
      if (getComputedStyle(e).position === 'fixed') { if (!e.hasAttribute('data-cf-igreelshead')) e.setAttribute('data-cf-igreelshead', ''); break; }
    }
  };

  const buildTop = () => {
    if (document.getElementById('cf-reels-top')) return;
    const top = document.createElement('div');
    top.id = 'cf-reels-top';
    top.innerHTML =
      '<button class="plus" aria-label="Créer"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 4.5v15M4.5 12h15"/></svg></button>' +
      '<div class="seg" role="group" aria-label="Reels affichés"><button data-m="all">Pour toi</button><button data-m="following">Abonnements</button></div>';
    top.querySelector('.plus').addEventListener('click', () => NS.app ? NS.app.openCreate() : NS.openCreate && NS.openCreate());
    top.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-m]');
      if (!b || b.dataset.m === urlMode()) return;
      try { localStorage.setItem(MODE_KEY, b.dataset.m); } catch (_) {}
      location.replace(b.dataset.m === 'following' ? '/reels/?tab=following' : '/reels/');
    });
    document.body.appendChild(top);

    const end = document.createElement('div');
    end.id = 'cf-reels-end';
    end.innerHTML = `<h3>Vous avez vu vos ${MAX} reels</h3><p>C'est tout pour cette session.</p><button type="button">Retour à l'accueil</button>`;
    end.querySelector('button').addEventListener('click', () => NS.app && NS.app.switchTab('home'));
    document.body.appendChild(end);
  };
  const syncSeg = () => {
    const m = urlMode();
    document.querySelectorAll('#cf-reels-top .seg button').forEach(b => {
      const on = String(b.dataset.m === m);
      if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
    });
  };

  const lock = () => {
    if (locked) return;
    locked = true;
    const sc = scroller();
    if (sc) sc.setAttribute('data-cf-locked', '');
    document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (_) {} });
    document.getElementById('cf-reels-end')?.classList.add('on');
  };

  // L'adresse suit le reel affiché (/reels/<code>/) : chaque nouveau code = un reel vu.
  const count = () => {
    const code = (location.pathname.match(/^\/reels\/([A-Za-z0-9_-]{6,})/) || [])[1];
    if (!code || seen.has(code) || locked) return;
    seen.add(code);
    NS.dbg.reelsSeen = seen.size;
    if (seen.size > MAX) lock();
  };

  NS.modules.push({
    name: 'reels',
    pages: ['reels'],
    every: 250,
    run({ main }) {
      if (!document.body) return;
      applySavedMode();
      buildTop();
      syncSeg();
      if (main) { findScroller(main); hideIgHead(main); }
      count();
    },
    onRoute() { count(); },
  });
})();
