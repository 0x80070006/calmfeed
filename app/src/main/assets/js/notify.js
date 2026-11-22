/*
 * Messages privés et demandes d'abonnement → notifications Android.
 *
 * Deux sources, sans aucune requête supplémentaire :
 *  - les réponses JSON qu'Instagram charge lui-même pour la messagerie (identifiant exact de chaque
 *    conversation, groupe ou non, participants, photo, derniers messages avec type et texte) ;
 *  - la liste « Messages » à l'écran, mise à jour en temps réel par Instagram (fraîcheur, non-lus).
 * La liste à l'écran dit QUOI est nouveau ; les données JSON disent QUI, OÙ et QUOI exactement.
 *
 * Actions (réponse, demandes d'abonnement) : toujours par l'interface d'Instagram, comme à la main.
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;

  const isInbox = () => location.pathname === '/direct/inbox/' || location.pathname === '/direct/';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(120); }
    return null;
  };

  // ------------------------------------------------------------------ données JSON d'Instagram
  const threads = new Map();          // thread_id -> fiche
  let viewerFbid = null;

  const KIND = (t, ct) => {
    // Type fourni par Instagram (content_type) en priorité.
    const c = (ct || '').toUpperCase();
    if (/VOICE|AUDIO/.test(c)) return 'voice';
    if (/REACTION/.test(c)) return 'reaction';
    if (/NOTE/.test(c)) return 'note';
    if (/STICKER|GIF/.test(c)) return 'sticker';
    if (/MONTAGE|CLIP|REEL/.test(c)) return 'reel';
    if (/VIDEO/.test(c)) return 'video';
    if (/IMAGE|PHOTO|RAVEN/.test(c)) return 'photo';
    if (/SHARE|XMA|STORY/.test(c)) return 'share';
    if (c === 'TEXT') return 'text';
    const s = (t || '') + ' ' + c;
    if (/voice|vocal|audio/i.test(s)) return 'voice';
    if (/reel|clip/i.test(s)) return 'reel';
    if (/photo|image/i.test(s)) return 'photo';
    if (/video|vidéo/i.test(s)) return 'video';
    if (/post|publication|shared|partag/i.test(s)) return 'share';
    if (/react|réagi|liked|aimé/i.test(s)) return 'reaction';
    return 'text';
  };

  const ingestThread = (t) => {
    if (!t || !t.thread_id) return;
    if (t.viewer && t.viewer.interop_messaging_user_fbid) viewerFbid = t.viewer.interop_messaging_user_fbid;
    const prev = threads.get(t.thread_id) || {};
    const users = (t.users || []).map(u => ({
      fbid: u.interop_messaging_user_fbid, id: u.id, username: u.username, name: u.full_name || u.username,
      pic: u.profile_pic_url,
    }));
    const nick = {};
    for (const n of t.nicknames || []) if (n.nickname && n.igid) nick[n.igid] = n.nickname;
    const msgs = ((t.slide_messages && t.slide_messages.edges) || []).map(e => e.node).filter(Boolean).map(m => ({
      sender: m.sender_fbid, ts: +m.timestamp_ms || 0,
      text: (m.text_body || (m.content && m.content.text_body) || m.igd_snippet || '').slice(0, 500),
      snippet: m.igd_snippet || '', type: m.content_type || '',
    })).sort((a, b) => b.ts - a.ts);
    threads.set(t.thread_id, Object.assign(prev, {
      id: t.thread_id, fbid: t.thread_fbid, key: t.thread_key, title: t.thread_title || '',
      group: !!t.is_group, users: users.length ? users : prev.users || [], nick,
      msgs: msgs.length ? msgs : prev.msgs || [], muted: !!t.is_muted, image: t.thread_image_url,
    }));
  };

  const ingestMailbox = (j) => {
    const box = j && j.data && j.data.get_slide_mailbox_for_iris_subscription;
    if (!box) return;
    for (const e of (box.threads_by_folder && box.threads_by_folder.edges) || []) ingestThread(e.node && e.node.as_ig_direct_thread);
    for (const p of box.pinned_threads_v2 || []) ingestThread(p.as_ig_direct_thread);
    schedule();
  };
  NS.onGql('PolarisDirectInboxMobileQuery', ingestMailbox);
  NS.onGql('IGDThreadDetailQuery', (j) => {
    // Forme variable : on cherche toute fiche de conversation dans la réponse.
    const walk = (o, d) => {
      if (!o || typeof o !== 'object' || d > 6) return;
      if (o.thread_id && (o.slide_messages || o.users)) { ingestThread(o); return; }
      for (const k in o) walk(o[k], d + 1);
    };
    walk(j && j.data, 0);
  });

  /** Fiche JSON correspondant à une rangée de la liste (titre affiché). */
  const findThread = (title) => {
    const t = (title || '').trim().toLowerCase();
    if (!t) return null;
    for (const th of threads.values()) {
      const names = [th.title, ...Object.values(th.nick), ...th.users.flatMap(u => [u.name, u.username])]
        .filter(Boolean).map(s => s.trim().toLowerCase());
      if (names.includes(t)) return th;
    }
    return null;
  };

  // ------------------------------------------------------------------ liste à l'écran
  const inboxRows = () => {
    const main = document.querySelector('main') || document.body;
    const out = [];
    if (!main) return out;
    const minW = Math.max(200, (innerWidth || 400) * 0.6);
    for (const b of main.querySelectorAll('[role="button"][tabindex="0"]')) {
      const img = b.querySelector('img');
      if (!img || b.getBoundingClientRect().width < minW) continue;   // pas les bulles de notes
      const spans = [...b.querySelectorAll('span')].filter(s => s.childElementCount === 0 && s.textContent.trim());
      if (spans.length < 2) continue;
      out.push({ el: b, img, spans });
    }
    return out;
  };

  const parseRow = (r) => {
    const texts = r.spans.map(s => s.textContent.trim());
    const name = texts[0];
    const rest = texts.slice(1).filter(t => t !== '·');
    const time = rest.length > 1 ? rest[rest.length - 1] : '';
    const text = (rest.length > 1 ? rest.slice(0, -1) : rest).join(' ').slice(0, 300);
    const bold = r.spans.some(s => +getComputedStyle(s).fontWeight >= 600);
    const dot = [...r.el.querySelectorAll('div,span')].some(d => {
      const b = d.getBoundingClientRect();
      return b.width >= 6 && b.width <= 12 && b.height >= 6 && b.height <= 12 &&
        getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(d).borderRadius !== '0px';
    });
    return { name, text, time, avatar: r.img.currentSrc || r.img.src || '', unread: bold || dot };
  };

  /** Rangée enrichie : identifiant, expéditeur exact, photo, type, derniers messages reçus. */
  const enrich = (row) => {
    const th = findThread(row.name);
    const out = { title: row.name, text: row.text, kind: KIND(row.text), avatar: row.avatar, time: row.time };
    if (!th) return out;
    out.id = th.id;
    out.group = th.group;
    out.muted = th.muted;
    // Derniers messages des autres participants, du plus ancien au plus récent (max 3).
    const fromOthers = th.msgs.filter(m => m.sender && m.sender !== viewerFbid).slice(0, 3).reverse();
    const last = fromOthers[fromOthers.length - 1];
    const sender = last && th.users.find(u => u.fbid === last.sender);
    if (sender) { out.sender = sender.name; out.username = sender.username; out.avatar = sender.pic || out.avatar; }
    else if (th.users.length === 1) { out.sender = th.users[0].name; out.username = th.users[0].username; out.avatar = th.users[0].pic || out.avatar; }
    if (last) out.kind = KIND(last.snippet || last.text, last.type);
    // Historique : seulement si les données JSON sont à jour (le dernier message correspond à l'écran).
    const fresh = last && row.text && (row.text.includes((last.text || '').slice(0, 20)) || (last.snippet && row.text.includes(last.snippet.slice(0, 20))));
    if (fresh) out.history = fromOthers.map(m => ({
      who: (th.users.find(u => u.fbid === m.sender) || {}).name || '', text: m.text || m.snippet, ts: m.ts,
    }));
    return out;
  };

  let last = '', lastReq = -1;
  const report = () => {
    if (!NS.app || !NS.app.dmUnread || !isInbox()) return;
    const rows = inboxRows();
    if (!rows.length) return;                         // liste pas encore chargée : rien à conclure
    const unread = rows.map(parseRow).filter(r => r.unread && r.name).slice(0, 8).map(enrich);
    const json = JSON.stringify(unread);
    if (json !== last) { last = json; NS.app.dmUnread(json); }
    // Demandes de messages (inconnus) : compteur du lien « Requests (N) ».
    if (NS.app.msgRequests) {
      const link = document.querySelector('a[href="/direct/requests/"]');
      const n = link ? +((link.textContent.match(/\d+/) || [0])[0]) : 0;
      if (n !== lastReq) { lastReq = n; NS.app.msgRequests(n); }
    }
  };
  let sched = 0;
  const schedule = () => { if (!sched) sched = setTimeout(() => { sched = 0; report(); }, 300); };

  // ------------------------------------------------------------------ ouvrir / répondre
  const backToInbox = async () => {
    for (let i = 0; i < 3 && !isInbox(); i++) {
      const back = document.querySelector('svg[aria-label="Back"], svg[aria-label="Retour"]');
      const btn = back && (back.closest('[role="button"], a, button'));
      if (btn) btn.click(); else history.back();
      await sleep(700);
    }
    return isInbox();
  };

  /** Ouvre une conversation : par identifiant exact si connu, sinon par le nom affiché. */
  NS.openThread = async (ref) => {
    const th = threads.get(ref) || null;
    const name = th ? null : ref;
    if (!(await backToInbox())) return false;
    let row = null;
    if (th) row = inboxRows().find(r => { const t = findThread(r.spans[0] && r.spans[0].textContent); return t && t.id === th.id; });
    if (!row && name) row = await waitFor(() => inboxRows().find(r => r.spans[0] && r.spans[0].textContent.trim() === name), 6000);
    if (row) { row.el.click(); return true; }
    if (th) { NS.navigate(`/direct/t/${th.id}/`); return true; }       // hors de l'écran : lien direct
    return false;
  };

  /** Envoie un message puis CONFIRME qu'il apparaît dans la conversation. */
  NS.sendTo = async (ref, text) => {
    let ok = false;
    try {
      if (!(await NS.openThread(ref))) throw new Error('conversation introuvable');
      const box = await waitFor(() => document.querySelector('[role="textbox"][contenteditable="true"], textarea[placeholder]'));
      if (!box) throw new Error('zone de saisie introuvable');
      box.focus();
      await sleep(250);
      if (box.tagName === 'TEXTAREA') {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(box, text);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, text);
      }
      await sleep(450);
      const send = await waitFor(() => [...document.querySelectorAll('[role="button"], button')]
        .find(b => /^(Send|Envoyer)$/i.test(b.textContent.trim())), 3000);
      if (send) send.click();
      else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      // Confirmation : champ vidé ET message visible dans la conversation.
      const want = text.trim().slice(0, 60);
      ok = !!(await waitFor(() => !(box.textContent || box.value || '').trim() &&
        [...document.querySelectorAll('div[dir="auto"], span')].some(e => !e.childElementCount && e.textContent.trim() === want), 6000));
    } catch (e) { NS.err('sendTo', e); }
    await backToInbox();
    if (NS.app && NS.app.dmSent) NS.app.dmSent(ref, ok);
    return ok;
  };

  // ------------------------------------------------------------------ demandes d'abonnement
  // Page /notifications/?followRequests=true : une rangée par demande, avec « Confirm » et « Delete ».
  const frRows = () => {
    const out = [];
    for (const b of document.querySelectorAll('[role="button"], button')) {
      if (!/^(Confirm|Confirmer)$/i.test(b.textContent.trim())) continue;
      let row = b;
      for (let i = 0; i < 8 && row.parentElement; i++) { row = row.parentElement; if (row.querySelector('a[href] img, img')) break; }
      const link = [...row.querySelectorAll('a[href]')].find(a => /^\/[A-Za-z0-9._]+\/$/.test(a.getAttribute('href')));
      if (!link) continue;
      const username = link.getAttribute('href').replace(/\//g, '');
      const img = row.querySelector('img');
      const name = [...row.querySelectorAll('span')].filter(s => !s.childElementCount)
        .map(s => s.textContent.trim()).find(t => t && t !== username && !/^(Confirm|Delete|Confirmer|Supprimer)$/i.test(t)) || '';
      out.push({ username, name, avatar: img ? (img.currentSrc || img.src) : '', row });
    }
    return out;
  };
  /** Depuis /notifications/ : ouvre la liste « Follow requests » si elle est repliée. */
  const openRequestsList = async () => {
    await waitFor(() => document.querySelector('main'), 10000);
    await sleep(1200);
    if (frRows().length) return;
    const entry = [...document.querySelectorAll('a[href*="followRequests"], [role="button"], a, div')]
      .find(e => /^(Follow requests|Demandes d’abonnement|Demandes d'abonnement)/i.test((e.textContent || '').trim()) && e.childElementCount < 6);
    if (entry) { (entry.closest('a, [role="button"]') || entry).click(); await waitFor(() => frRows().length, 6000); }
  };
  NS.followRequests = async () => {
    await openRequestsList();
    await sleep(500);
    const list = frRows().map(({ username, name, avatar }) => ({ username, name, avatar }));
    if (NS.app && NS.app.followRequests) NS.app.followRequests(JSON.stringify(list));
    return list;
  };
  NS.followAct = async (username, accept) => {
    let ok = false;
    try {
      await openRequestsList();
      const r = await waitFor(() => frRows().find(x => x.username === username), 8000);
      if (!r) throw new Error('demande introuvable');
      if (!NS.act('follow')) await sleep(1500);
      const re = accept ? /^(Confirm|Confirmer)$/i : /^(Delete|Supprimer)$/i;
      const b = [...r.row.querySelectorAll('[role="button"], button')].find(x => re.test(x.textContent.trim()));
      if (!b) throw new Error('bouton introuvable');
      b.click();
      ok = !!(await waitFor(() => !frRows().some(x => x.username === username), 5000));
    } catch (e) { NS.err('followAct', e); }
    if (NS.app && NS.app.followDone) NS.app.followDone(username, accept, ok);
    return ok;
  };

  // ------------------------------------------------------------------ pastille ♥ (activité)
  // Sur l'Accueil : quand la pastille rouge du ♥ apparaît, l'app vérifie les demandes d'abonnement.
  let lastBadge = null;
  const activityBadge = () => {
    if (!NS.app || !NS.app.activityBadge) return;
    const l = document.querySelector('header a[href="/notifications/"], a[href="/notifications/"]');
    if (!l) return;
    const on = [...(l.parentElement || l).querySelectorAll('div,span')].some(e => {
      const r = e.getBoundingClientRect();
      return r.width > 3 && r.width < 20 && /rgb\(255, 48, 64\)|rgb\(255, 59, 48\)/.test(getComputedStyle(e).backgroundColor);
    });
    if (on !== lastBadge) { lastBadge = on; NS.app.activityBadge(on); }
  };

  // Les messages arrivent par le temps réel, même onglet masqué : on lit la liste dans le callback de
  // mutation (non ralenti en arrière-plan), au plus une fois par seconde.
  let lastSync = 0;
  NS.modules.push({
    name: 'notify',
    pages: ['direct'],
    sync() { const now = Date.now(); if (now - lastSync > 1000) { lastSync = now; report(); } },
    run() { report(); },
  });
  NS.modules.push({ name: 'activity', pages: ['home'], every: 2000, run: activityBadge });
  NS.dbg.threads = threads;
})();
