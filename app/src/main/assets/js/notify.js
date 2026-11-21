/*
 * Messages privés → notifications Android.
 *
 * Instagram n'expose plus d'API de messagerie classique sur le web : il pousse les messages en temps
 * réel dans la page. On lit donc simplement la liste « Messages » telle qu'elle s'affiche (nom, photo,
 * début du message, non lu) et on la transmet à l'app, qui décide quoi notifier. Aucune requête.
 *
 * Réponse rapide : on passe par l'interface d'Instagram (ouvrir la conversation, écrire, Envoyer),
 * exactement comme à la main.
 */
(() => {
  const NS = window.__cf;
  if (!NS || NS.started) return;

  const isInbox = () => location.pathname === '/direct/inbox/' || location.pathname === '/direct/';

  /** Rangées de la liste : un bloc role=button contenant une photo et des libellés. */
  const inboxRows = () => {
    const main = document.querySelector('main') || document.body;
    const out = [];
    const minW = Math.max(200, (innerWidth || 400) * 0.6);
    for (const b of main.querySelectorAll('[role="button"][tabindex="0"]')) {
      const img = b.querySelector('img');
      if (!img) continue;
      // Seules les vraies conversations (rangées pleine largeur) : pas les bulles de notes en haut.
      if (b.getBoundingClientRect().width < minW) continue;
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

  let last = '';
  const report = () => {
    if (!NS.app || !NS.app.dmUnread || !isInbox()) return;
    const rows = inboxRows();
    if (!rows.length) return;                         // liste pas encore chargée : rien à conclure
    const unread = rows.map(parseRow).filter(r => r.unread && r.name).slice(0, 8)
      .map(({ name, text, time, avatar }) => ({ name, text, time, avatar }));
    const json = JSON.stringify(unread);
    if (json === last) return;
    last = json;
    NS.app.dmUnread(json);
  };

  // ------------------------------------------------------------------ ouvrir / répondre
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(120); }
    return null;
  };

  const backToInbox = async () => {
    for (let i = 0; i < 3 && !isInbox(); i++) {
      const back = document.querySelector('svg[aria-label="Back"], svg[aria-label="Retour"]');
      const btn = back && (back.closest('[role="button"], a, button'));
      if (btn) btn.click(); else history.back();
      await sleep(700);
    }
    return isInbox();
  };

  /** Ouvre la conversation dont le nom affiché correspond. */
  NS.openThread = async (name) => {
    if (!(await backToInbox())) return false;
    const row = await waitFor(() => inboxRows().find(r => r.spans[0] && r.spans[0].textContent.trim() === name));
    if (!row) return false;
    row.el.click();
    return true;
  };

  /** Envoie un message via l'interface d'Instagram, puis revient à la liste. */
  NS.sendTo = async (name, text) => {
    let ok = false;
    try {
      if (!(await NS.openThread(name))) throw new Error('conversation introuvable');
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
      await sleep(1200);
      ok = !(box.textContent || box.value || '').trim();
    } catch (e) { NS.err('sendTo', e); }
    await backToInbox();
    if (NS.app && NS.app.dmSent) NS.app.dmSent(name, ok);
    return ok;
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
})();
