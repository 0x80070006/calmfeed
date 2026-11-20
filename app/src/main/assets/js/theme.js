/*
 * Thèmes : on redéfinit les variables CSS d'Instagram, donc tout le site suit (textes, icônes, boutons, DM).
 * Les couleurs dérivées (boutons teintés, liens, icônes) sont recalculées avec un contrôle de contraste
 * WCAG : texte ≥ 4,5:1, icônes ≥ 3:1. Formes décoratives : une couche fixe derrière le contenu,
 * composée une seule fois par le GPU (aucun coût au défilement).
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;

  // ------------------------------------------------------------------ couleurs
  const parse = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const hex = (a) => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = parse(a), y = parse(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const lum = (h) => {
    const c = parse(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** Rapproche fg de `toward` jusqu'à atteindre le contraste voulu sur bg. */
  const readable = (fg, bg, target, toward) => {
    for (let i = 0; i <= 12; i++) {
      const c = mix(fg, toward, i / 12);
      if (contrast(c, bg) >= target) return c;
    }
    return toward;
  };
  const best = (bg, candidates) => candidates.reduce((a, b) => contrast(b, bg) > contrast(a, bg) ? b : a);
  const rgb = (h) => parse(h).join(', ');

  /** Palette complète dérivée de la palette de base du thème. */
  const derive = (p, dark) => {
    const extreme = dark ? '#ffffff' : '#000000';
    const bg2 = mix(p.bg2, p.accent, 0.08);
    const tint = mix(p.bg, p.accent, dark ? 0.22 : 0.16);           // boutons secondaires teintés
    const tintHover = mix(p.bg, p.accent, dark ? 0.30 : 0.24);
    return {
      bg: p.bg, elev: p.elev, bg2, tint, tintHover,
      text: p.text,
      text2: readable(p.text2, p.bg, 4.5, p.text),
      text3: p.text3,
      sep: mix(p.sep, p.accent, 0.18),
      accent: p.accent,
      onAccent: contrast(p.accentText, p.accent) >= 4.5 ? p.accentText : best(p.accent, [p.accentText, '#ffffff', p.text, p.bg]),
      onTint: readable(mix(p.accent, extreme, 0.28), tint, 4.5, p.text),
      link: readable(p.link, p.bg, 4.5, p.text),
      icon: readable(mix(p.text, p.accent, 0.6), p.bg, 3, p.text),
      deco1: p.accent,
      deco2: p.link,
    };
  };

  const build = (p, dark, deco) => {
    if (!p) return '';
    const d = derive(p, dark);
    const v = {
      // variables « r, g, b » (utilisées comme rgb(var(--x)))
      '--ig-primary-background': rgb(d.bg),
      '--ig-secondary-background': rgb(d.bg2),
      '--ig-highlight-background': rgb(d.bg2),
      '--ig-elevated-background': rgb(d.elev),
      '--ig-secondary-elevated-background': rgb(d.bg2),
      '--ig-elevated-highlight-background': rgb(d.bg2),
      '--ig-banner-background': rgb(d.elev),
      '--ig-bubble-background': rgb(d.elev),
      '--ig-primary-text': rgb(d.text),
      '--ig-primary-icon': rgb(d.icon),
      '--ig-secondary-text': rgb(d.text2),
      '--ig-secondary-icon': rgb(d.text2),
      '--ig-tertiary-text': rgb(d.text3),
      '--ig-tertiary-icon': rgb(d.text3),
      '--ig-separator': rgb(d.sep),
      '--ig-elevated-separator': rgb(d.sep),
      '--ig-stroke': rgb(d.sep),
      '--ig-text-input-border-prism': rgb(d.sep),
      '--ig-focus-stroke': rgb(d.accent),
      '--ig-link': rgb(d.link),
      '--ig-primary-button': rgb(d.accent),
      '--ig-primary-button-hover': rgb(d.accent),
      '--ig-text-on-color': rgb(d.onAccent),
      '--ig-secondary-button': rgb(d.onTint),
      '--ig-secondary-button-background': rgb(d.tint),
      '--ig-secondary-button-hover': rgb(d.tintHover),
      '--ig-tertiary-button-background': rgb(d.elev),
      '--ig-tertiary-button-border': rgb(d.sep),
      '--ig-tertiary-button-text': rgb(d.onTint),
      '--ig-tertiary-button-hover': rgb(d.tint),
      '--ig-hover-overlay': rgb(d.accent) + ', .08',
      // famille --ig-colors-* (boutons « Suivre », « Modifier le profil », liens « Requests »…)
      '--ig-colors-link-text': rgb(d.link),
      '--ig-colors-button-borderless-text': rgb(d.link),
      '--ig-colors-button-borderless-text--hover': rgb(d.link),
      '--ig-colors-button-borderless-text--pressed': rgb(d.link),
      '--ig-colors-button-primary-background': rgb(d.accent),
      '--ig-colors-button-primary-background--hover': rgb(d.accent),
      '--ig-colors-button-primary-background--pressed': rgb(d.accent),
      '--ig-colors-button-primary-text': rgb(d.onAccent),
      '--ig-colors-button-primary-link-text': rgb(d.link),
      '--ig-colors-button-primary-link-text--hover': rgb(d.link),
      '--ig-colors-button-primary-link-text--pressed': rgb(d.link),
      '--ig-colors-button-secondary-background': rgb(d.tint),
      '--ig-colors-button-secondary-background--hover': rgb(d.tintHover),
      '--ig-colors-button-secondary-background--pressed': rgb(d.tintHover),
      '--ig-colors-button-secondary-elevated-background': rgb(d.tint),
      '--ig-colors-button-secondary-text': rgb(d.onTint),
      '--ig-colors-button-secondary-text--disabled': rgb(d.text3),
      '--ig-colors-button-secondary-link-text': rgb(d.onTint),
      '--ig-colors-button-secondary-link-text--hover': rgb(d.onTint),
      '--ig-colors-button-secondary-link-text--pressed': rgb(d.onTint),
      '--ig-colors-button-secondary-link-text--disabled': rgb(d.text3),
      '--ig-colors-button-borderless-background--disabled': rgb(d.bg2),
      '--ig-colors-button-secondary-background--disabled': rgb(d.bg2),
      // variables hexadécimales
      '--card-background': d.elev,
      '--card-background-flat': d.bg2,
      '--surface-background': d.bg,
      '--primary-text': d.text,
      '--primary-icon': d.icon,
      '--secondary-text': d.text2,
      '--secondary-icon': d.text2,
      '--placeholder-text': d.text2,
      '--placeholder-icon': d.text2,
      '--divider': d.sep,
      '--accent': d.accent,
      '--primary-button-background': d.accent,
      '--primary-button-text': d.onAccent,
      '--primary-button-icon': d.onAccent,
      '--secondary-button-text': d.link,
      '--primary-deemphasized-button-background': d.tint,
      '--primary-deemphasized-button-text': d.onTint,
      '--text-input-bar-background': d.bg2,
      '--text-input-outside-label': d.text,
      // pour nos propres composants
      '--cf-tint': rgb(d.tint),
      '--cf-on-tint': rgb(d.onTint),
    };
    const decl = Object.entries(v).map(([k, val]) => `${k}:${val}!important`).join(';');
    let css = `
      :root, :root.__fb-light-mode, :root.__fb-dark-mode, body, .__fb-light-mode { ${decl} }
      :root { color-scheme: ${dark ? 'dark' : 'light'}; background: ${d.bg} !important; }
      body { background: ${d.bg} !important; color: ${d.text}; }
      ::selection { background: ${d.accent}55; }
    `;
    if (deco) {
      const a = dark ? [0.24, 0.16, 0.18] : [0.26, 0.18, 0.20];
      const al = (h, x) => `rgba(${rgb(h)}, ${x})`;
      css += `
        :root::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;will-change:transform;
          background:
            radial-gradient(60vmax 46vmax at 108% -6%, ${al(d.deco1, a[0])}, transparent 62%),
            radial-gradient(48vmax 40vmax at -14% 46%, ${al(d.deco2, a[1])}, transparent 64%),
            radial-gradient(56vmax 44vmax at 96% 108%, ${al(d.deco1, a[2])}, transparent 62%);}
        :root[data-cf-deco] body{background:transparent!important}
        :root[data-cf-deco] main{--ig-primary-background:${rgb(d.bg)}, 0 !important}
        [data-cf-clear]{background-color:transparent!important}
        /* Seuls les éléments réellement fixes/collants restent opaques (le contenu défile dessous).
           Les blocs ordinaires restent transparents : pas de bandes sur les formes décoratives. */
        [data-cf-solid]{--ig-primary-background:${rgb(d.bg)} !important;background-color:${d.bg}!important}
      `;
    }
    return css;
  };

  // ------------------------------------------------------------------ couche décorative
  // Les conteneurs de page peignent la couleur de fond : on rend transparents ceux entre <main> et <body>,
  // et on garde opaques les éléments collants/fixes à l'intérieur de <main> (en-têtes, onglets).
  let solidScan = 0;
  const clearAncestors = (main) => {
    for (let e = main.parentElement; e && e !== document.body; e = e.parentElement) {
      if (!e.hasAttribute('data-cf-clear')) e.setAttribute('data-cf-clear', '');
    }
  };
  // Parcours en largeur limité (6 niveaux, 400 nœuds) : les éléments collants d'IG sont toujours haut placés,
  // et on évite de lire le style calculé de milliers de nœuds (micro-gel).
  const markSolids = (main) => {
    let level = [main], seenN = 0;
    for (let depth = 0; depth < 6 && level.length && seenN < 400; depth++) {
      const next = [];
      for (const el of level) {
        for (const c of el.children) {
          if (++seenN > 400) break;
          if (c.tagName === 'ARTICLE') continue;
          const pos = getComputedStyle(c).position;
          if (pos === 'sticky' || pos === 'fixed') c.setAttribute('data-cf-solid', '');
          next.push(c);
        }
      }
      level = next;
    }
  };

  NS.setTheme = (palette, dark, deco) => {
    NS.C.palette = palette || null;
    NS.C.paletteDark = !!dark;
    NS.C.decoShapes = !!deco;
    const on = !!(palette && deco);
    if (on) document.documentElement.setAttribute('data-cf-deco', '');
    else document.documentElement.removeAttribute('data-cf-deco');
    NS.css('theme', build(palette, dark, on));
    NS.ensureStyle();
    solidScan = 0;
    NS.schedule && NS.schedule();
  };
  NS.setTheme(NS.C.palette, NS.C.paletteDark, NS.C.decoShapes);

  NS.modules.push({
    name: 'deco',
    every: 600,
    run({ main }) {
      if (!main || !document.documentElement.hasAttribute('data-cf-deco')) return;
      clearAncestors(main);
      // Scan des éléments collants : quelques passes après chaque changement de page, puis plus rien.
      if (solidScan < 2) { solidScan++; markSolids(main); }
    },
    onRoute() { solidScan = 0; },
  });
})();
