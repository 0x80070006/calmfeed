/*
 * « Pas en retour » : comptes que vous suivez et qui ne vous suivent pas.
 * Requêtes : uniquement sur action de l'utilisateur, mêmes endpoints et même taille de page (12)
 * que la liste « Suivi(e)s » du site, 1,8 à 3,4 s entre chaque page, résultat mis en cache 24 h.
 * Désabonnement : 1 clic = 1 requête, 4 s minimum entre deux, 30 par heure au plus.
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started || !NS.C.nonFollowersButton) return;

  const PAGE = 12;
  const CACHE_TTL = 24 * 3600e3;
  const UNFOLLOW_GAP = 4000;
  const UNFOLLOW_PER_HOUR = 30;

  const uid = () => NS.cookie('ds_user_id');
  const cacheKey = () => 'cf_nf_v1_' + uid();
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };

  // ------------------------------------------------------------------ styles (suivent le thème via les variables IG)
  NS.css('nf', `
    #cf-nf-stat{display:inline-flex;align-self:flex-start;align-items:center;gap:7px;height:30px;margin:10px 0 0;padding:0 6px 0 11px;border:0;
      border-radius:15px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;white-space:nowrap;
      background:rgb(var(--ig-secondary-button-background,239,239,239));color:rgb(var(--ig-secondary-button,38,38,38));
      -webkit-tap-highlight-color:transparent;transition:transform .12s ease}
    #cf-nf-stat:active{transform:scale(.96)}
    #cf-nf-stat .n{min-width:22px;height:20px;padding:0 7px;border-radius:10px;display:inline-grid;place-items:center;
      font-variant-numeric:tabular-nums;background:rgb(var(--ig-primary-background,255,255,255))}

    .cf-sheet{position:fixed;inset:0;z-index:2147483640;display:flex;flex-direction:column;
      background:rgb(var(--ig-primary-background,255,255,255));color:rgb(var(--ig-primary-text,12,16,20));
      font:15px/1.4 system-ui,-apple-system,sans-serif;transform:translate3d(0,100%,0);
      transition:transform .26s cubic-bezier(.2,.8,.2,1);will-change:transform;contain:layout paint}
    .cf-sheet.open{transform:none}
    .cf-sheet *{box-sizing:border-box}
    .cf-head{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;padding:6px 6px 2px}
    .cf-head h2{margin:0;text-align:center;font-size:16px;font-weight:700;line-height:1.2}
    .cf-head .sub{display:block;font-size:12px;font-weight:400;color:rgb(var(--ig-secondary-text,106,113,122));margin-top:2px}
    .cf-ib{width:44px;height:44px;border:0;background:none;color:inherit;border-radius:50%;display:grid;place-items:center;
      -webkit-tap-highlight-color:transparent}
    .cf-ib:active{background:rgb(var(--ig-secondary-background,239,239,239))}
    .cf-ib[disabled]{opacity:.35}
    .cf-search{margin:8px 16px 6px;position:relative}
    .cf-search input{width:100%;height:38px;border:0;border-radius:10px;padding:0 12px 0 36px;font:inherit;
      background:rgb(var(--ig-secondary-background,239,239,239));color:inherit;outline:none}
    .cf-search svg{position:absolute;left:11px;top:11px;color:rgb(var(--ig-secondary-text,106,113,122))}
    .cf-body{flex:1;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    .cf-row{display:flex;align-items:center;gap:12px;padding:8px 16px;content-visibility:auto;contain-intrinsic-size:auto 60px;
      transition:opacity .2s}
    .cf-row.gone{opacity:.45}
    .cf-row img,.cf-row .ph{width:44px;height:44px;border-radius:50%;flex:none;object-fit:cover;
      background:rgb(var(--ig-secondary-background,239,239,239))}
    .cf-row .who{flex:1;min-width:0;text-decoration:none;color:inherit}
    .cf-row .u{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;gap:4px;align-items:center}
    .cf-row .f{font-size:14px;color:rgb(var(--ig-secondary-text,106,113,122));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cf-btn{flex:none;height:32px;min-width:112px;padding:0 14px;border:0;border-radius:9px;font:600 14px system-ui,sans-serif;
      background:rgb(var(--ig-secondary-button-background,239,239,239));color:rgb(var(--ig-secondary-button,38,38,38));
      transition:background .15s,color .15s;-webkit-tap-highlight-color:transparent}
    .cf-btn:active{filter:brightness(.94)}
    .cf-btn.confirm{background:rgb(var(--ig-error-or-destructive,237,73,86));color:#fff}
    .cf-btn[disabled]{opacity:.55}
    .cf-btn.primary{background:rgb(var(--ig-primary-button,74,93,249));color:rgb(var(--ig-text-on-color,255,255,255));height:44px;min-width:200px;border-radius:12px;font-size:15px}
    .cf-state{padding:40px 28px;text-align:center}
    .cf-state h3{margin:12px 0 6px;font-size:18px}
    .cf-state p{margin:0 auto 20px;max-width:320px;color:rgb(var(--ig-secondary-text,106,113,122))}
    .cf-state .ico{width:64px;height:64px;margin:0 auto;border-radius:50%;display:grid;place-items:center;
      border:2px solid rgb(var(--ig-primary-text,12,16,20))}
    .cf-bar{height:6px;border-radius:3px;background:rgb(var(--ig-secondary-background,239,239,239));overflow:hidden;margin:18px auto 10px;max-width:280px}
    .cf-bar i{display:block;height:100%;width:0;background:rgb(var(--ig-primary-button,74,93,249));transition:width .4s ease}
    .cf-link{background:none;border:0;color:rgb(var(--ig-secondary-text,106,113,122));font:inherit;text-decoration:underline;padding:8px}
    .cf-note{padding:10px 16px 14px;font-size:12px;text-align:center;color:rgb(var(--ig-secondary-text,106,113,122))}
  `);

  const ICON = {
    close: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    refresh: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    people: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M17 11l4 4M21 11l-4 4"/></svg>',
    check: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    verified: '<svg width="12" height="12" viewBox="0 0 24 24"><path fill="rgb(0,149,246)" d="M12 1l2.6 2.2 3.4-.4.9 3.3 3 1.7-1.2 3.2 1.2 3.2-3 1.7-.9 3.3-3.4-.4L12 23l-2.6-2.2-3.4.4-.9-3.3-3-1.7L3.3 12 2.1 8.8l3-1.7.9-3.3 3.4.4z"/><path d="M7.5 12.2l3 3 6-6" stroke="#fff" stroke-width="2" fill="none"/></svg>',
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    const h = Math.round(m / 60);
    return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
  };
  const parseCount = (txt) => {
    const m = (txt || '').replace(/\s/g, '').match(/([\d.,]+)\s*([KkMm]?)/);
    if (!m) return 0;
    let n = parseFloat(m[1].replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
    if (/k/i.test(m[2])) n *= 1e3; else if (/m/i.test(m[2])) n *= 1e6;
    return Math.round(n);
  };

  // ------------------------------------------------------------------ requêtes (lentes, annulables)
  const fetchList = async (kind, onProgress, signal) => {
    const out = [];
    let maxId = null;
    do {
      const url = `/api/v1/friendships/${uid()}/${kind}/?count=${PAGE}` + (maxId ? `&max_id=${encodeURIComponent(maxId)}` : '');
      const r = await NS.fetch(url, { credentials: 'include', headers: NS.apiHeaders(), signal });
      if (r.status === 429 || r.status === 401 || r.status === 403) throw new Error('slow');
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j.users)) throw new Error(j.message === 'Please wait a few minutes before you try again.' ? 'slow' : 'format');
      for (const u of j.users) {
        out.push({ pk: String(u.pk || u.pk_id || u.id), u: u.username, n: u.full_name || '', p: u.profile_pic_url || '', v: !!u.is_verified });
      }
      onProgress(out.length);
      maxId = j.next_max_id || null;
      if (maxId) await NS.sleep(NS.jitter(1800, 3400), signal);
    } while (maxId);
    return out;
  };

  const unfollowLog = () => store.get('cf_nf_unf', []).filter(t => Date.now() - t < 3600e3);
  let lastUnfollow = 0;
  const unfollow = async (pk) => {
    const now = Date.now();
    const log = unfollowLog();
    if (log.length >= UNFOLLOW_PER_HOUR) throw new Error('hour');
    if (now - lastUnfollow < UNFOLLOW_GAP) throw new Error('gap');
    lastUnfollow = now;
    const r = await NS.fetch(`/api/v1/friendships/destroy/${pk}/`, {
      method: 'POST',
      credentials: 'include',
      headers: NS.apiHeaders({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: `container_module=profile&nav_chain=&user_id=${pk}`,
    });
    if (!r.ok) throw new Error(r.status === 429 ? 'slow' : 'http ' + r.status);
    const j = await r.json().catch(() => ({}));
    if (j.status && j.status !== 'ok') throw new Error('refused');
    log.push(now);
    store.set('cf_nf_unf', log);
  };

  // ------------------------------------------------------------------ panneau
  let sheet = null, body = null, subEl = null, refreshBtn = null, searchInput = null;
  let controller = null, data = null, query = '';
  const counts = { following: 0, followers: 0 };

  const isOpen = () => !!(sheet && sheet.classList.contains('open'));
  const close = () => {
    if (!sheet) return;
    sheet.classList.remove('open');
    if (history.state && history.state.cfSheet) history.back();
  };
  NS.backHandlers.push(() => { if (!isOpen()) return false; close(); return true; });

  const buildSheet = () => {
    sheet = document.createElement('div');
    sheet.className = 'cf-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Pas en retour');
    sheet.innerHTML = `
      <div class="cf-head">
        <button class="cf-ib" data-a="close" aria-label="Fermer">${ICON.close}</button>
        <h2>Pas en retour<span class="sub"></span></h2>
        <button class="cf-ib" data-a="refresh" aria-label="Actualiser">${ICON.refresh}</button>
      </div>
      <div class="cf-search">${ICON.search}<input type="search" placeholder="Rechercher" autocomplete="off" enterkeyhint="search"></div>
      <div class="cf-body"></div>`;
    body = sheet.querySelector('.cf-body');
    subEl = sheet.querySelector('.sub');
    refreshBtn = sheet.querySelector('[data-a="refresh"]');
    searchInput = sheet.querySelector('input');

    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'close') close();
      else if (a === 'refresh' || a === 'start') startScan();
      else if (a === 'cancel') controller && controller.abort();
      else if (a === 'unf') onUnfollow(b);
    });
    let t;
    searchInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { query = searchInput.value.trim().toLowerCase(); renderList(); }, 90);
    });
    // Retour Android : ferme le panneau au lieu de quitter la page.
    addEventListener('popstate', () => { if (sheet && sheet.classList.contains('open')) sheet.classList.remove('open'); });
    document.body.appendChild(sheet);
  };

  const open = () => {
    if (!sheet || !sheet.isConnected) buildSheet();
    data = store.get(cacheKey(), null);
    if (data && Date.now() - data.ts > CACHE_TTL) data = Object.assign({ stale: true }, data);
    data ? renderList() : renderIntro();
    history.pushState(Object.assign({}, history.state, { cfSheet: true }), '');
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  };

  const setSub = (txt) => { subEl.textContent = txt; };

  const estimate = () => {
    const req = Math.ceil(counts.following / PAGE) + Math.ceil(counts.followers / PAGE);
    const secs = Math.round(req * 2.8);
    return { req, time: secs < 90 ? `${Math.max(secs, 10)} s` : `${Math.round(secs / 60)} min` };
  };

  const renderIntro = () => {
    const e = estimate();
    setSub('');
    refreshBtn.disabled = true;
    searchInput.parentElement.hidden = true;
    body.innerHTML = `
      <div class="cf-state">
        <div class="ico">${ICON.people}</div>
        <h3>Qui ne vous suit pas en retour ?</h3>
        <p>On compare vos abonnements et vos abonnés, page par page et sans se presser,
           comme si vous faisiez défiler les listes vous-même.${e.req ? ` Environ ${e.time}.` : ''}</p>
        <button class="cf-btn primary" data-a="start">Lancer l'analyse</button>
      </div>`;
  };

  const renderProgress = (step, done, total) => {
    const pct = total ? Math.min(100, Math.round(done / total * 100)) : 8;
    body.innerHTML = `
      <div class="cf-state">
        <h3>Analyse en cours…</h3>
        <p>${step === 'following' ? 'Lecture de vos abonnements' : 'Lecture de vos abonnés'} · ${done}${total ? ' / ' + total : ''}</p>
        <div class="cf-bar"><i style="width:${pct}%"></i></div>
        <button class="cf-link" data-a="cancel">Annuler</button>
      </div>`;
  };

  const renderError = (msg) => {
    refreshBtn.disabled = false;
    body.innerHTML = `
      <div class="cf-state">
        <div class="ico">${ICON.close}</div>
        <h3>Analyse interrompue</h3>
        <p>${msg}</p>
        ${data ? '' : '<button class="cf-btn primary" data-a="start">Réessayer</button>'}
      </div>`;
  };

  const rowHtml = (u) => `
    <div class="cf-row${u.gone ? ' gone' : ''}" data-pk="${esc(u.pk)}">
      ${u.p ? `<img src="${esc(u.p)}" alt="" loading="lazy" decoding="async" referrerpolicy="origin-when-cross-origin">` : '<div class="ph"></div>'}
      <a class="who" href="/${esc(u.u)}/">
        <div class="u">${esc(u.u)}${u.v ? ICON.verified : ''}</div>
        ${u.n ? `<div class="f">${esc(u.n)}</div>` : ''}
      </a>
      <button class="cf-btn" data-a="unf" ${u.gone ? 'disabled' : ''}>${u.gone ? 'Désabonné' : 'Se désabonner'}</button>
    </div>`;

  const renderList = () => {
    if (!data) return renderIntro();
    refreshBtn.disabled = false;
    searchInput.parentElement.hidden = false;
    const left = data.list.filter(u => !u.gone).length;
    setSub(`${left} compte${left > 1 ? 's' : ''} · ${data.stale ? 'à actualiser · ' : ''}${ago(data.ts)}`);
    if (!data.list.length) {
      body.innerHTML = `<div class="cf-state"><div class="ico">${ICON.check}</div><h3>Tout le monde vous suit en retour</h3>
        <p>Aucun compte à afficher.</p></div>`;
      return;
    }
    const list = query ? data.list.filter(u => u.u.toLowerCase().includes(query) || u.n.toLowerCase().includes(query)) : data.list;
    body.innerHTML = (list.length ? list.map(rowHtml).join('') : '<div class="cf-state"><p>Aucun résultat.</p></div>') +
      '<div class="cf-note">Les comptes vérifiés et les marques suivent rarement en retour. Les désabonnements sont espacés automatiquement.</div>';
  };

  const startScan = async () => {
    if (controller) return;
    controller = new AbortController();
    const signal = controller.signal;
    refreshBtn.disabled = true;
    searchInput.parentElement.hidden = true;
    setSub('');
    try {
      renderProgress('following', 0, counts.following);
      const following = await fetchList('following', n => renderProgress('following', n, counts.following), signal);
      await NS.sleep(NS.jitter(2500, 4500), signal);
      renderProgress('followers', 0, counts.followers);
      const followers = await fetchList('followers', n => renderProgress('followers', n, counts.followers), signal);
      const back = new Set(followers.map(u => u.pk));
      data = { ts: Date.now(), list: following.filter(u => !back.has(u.pk)) };
      store.set(cacheKey(), data);
      renderList();
      updateStat();
    } catch (e) {
      if (e.name === 'AbortError') { data ? renderList() : renderIntro(); }
      else if (e.message === 'slow') renderError("Instagram demande de ralentir. On s'arrête là pour protéger votre compte : réessayez dans quelques heures.");
      else renderError('Une erreur est survenue (' + esc(e.message) + '). Rien n\'a été modifié.');
    } finally {
      controller = null;
    }
  };

  const onUnfollow = async (btn) => {
    const row = btn.closest('.cf-row');
    const pk = row.dataset.pk;
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = 'Confirmer';
      setTimeout(() => { if (btn.isConnected && btn.classList.contains('confirm') && !btn.disabled) { btn.classList.remove('confirm'); btn.textContent = 'Se désabonner'; } }, 3000);
      return;
    }
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await unfollow(pk);
      const u = data.list.find(x => x.pk === pk);
      if (u) u.gone = true;
      store.set(cacheKey(), data);
      btn.classList.remove('confirm');
      btn.textContent = 'Désabonné';
      row.classList.add('gone');
      const left = data.list.filter(x => !x.gone).length;
      setSub(`${left} compte${left > 1 ? 's' : ''} · ${ago(data.ts)}`);
      updateStat();
    } catch (e) {
      btn.disabled = false;
      btn.classList.remove('confirm');
      btn.textContent = 'Se désabonner';
      const msg = e.message === 'gap' ? 'Patientez quelques secondes entre deux désabonnements.'
        : e.message === 'hour' ? `Limite de ${UNFOLLOW_PER_HOUR} désabonnements par heure atteinte, pour rester discret.`
        : e.message === 'slow' ? 'Instagram demande de ralentir. Réessayez plus tard.'
        : 'Le désabonnement a échoué.';
      NS.toast(msg, 3200);
    }
  };

  // ------------------------------------------------------------------ bouton sur le profil
  const updateStat = () => {
    const el = document.getElementById('cf-nf-stat');
    if (!el) return;
    const d = store.get(cacheKey(), null);
    el.querySelector('.n').textContent = d ? d.list.filter(u => !u.gone).length : '—';
  };

  const injectStat = (main) => {
    const me = uid();
    if (!me || !main.querySelector('a[href*="/accounts/edit"]')) return;   // seulement sur son propre profil
    const followingLink = main.querySelector('a[href$="/following/"]');
    const followersLink = main.querySelector('a[href$="/followers/"]');
    if (!followingLink) return;
    counts.following = parseCount(followingLink.textContent);
    if (followersLink) counts.followers = parseCount(followersLink.textContent);

    let item = followingLink;
    while (item.parentElement && item.parentElement.childElementCount < 3) item = item.parentElement;
    const row = item.parentElement;
    if (!row) return;
    // Pastille juste sous les compteurs : la ligne d'IG est trop étroite sur mobile pour une 4e colonne.
    let stat = document.getElementById('cf-nf-stat');
    if (stat && stat.previousElementSibling === row) return;
    if (stat) stat.remove();

    stat = document.createElement('button');
    stat.id = 'cf-nf-stat';
    stat.type = 'button';
    stat.setAttribute('aria-label', 'Comptes qui ne vous suivent pas en retour');
    stat.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5' +
      's5.7 1.9 6.5 5.5"/><path d="M17 10l4 4M21 10l-4 4"/></svg><span class="l">Pas en retour</span><span class="n">—</span>';
    stat.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); });
    row.after(stat);
    updateStat();
  };

  NS.modules.push({
    name: 'nonfollowers',
    pages: ['other'],
    every: 250,
    run({ main }) { if (main) injectStat(main); },
    onRoute() { if (sheet && sheet.classList.contains('open') && !(history.state && history.state.cfSheet)) sheet.classList.remove('open'); },
  });
})();
