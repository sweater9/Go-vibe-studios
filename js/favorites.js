/* GoVibe Mix home page: favourite tools. A star on each tool card; the list lives only in this browser (localStorage). */
(() => {
  const cards = Array.from(document.querySelectorAll('section.grp a.card.tool')); if (!cards.length) return;
  const KEY = 'govibe.favs';
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v.filter((x) => /^[a-z0-9-]+\.html$/.test(x)) : []; } catch (_) { return []; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* storage blocked */ } };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const row = document.getElementById('favrow');
  const nameOf = (a) => { const h = a.querySelector('h3'); return h ? Array.from(h.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() : a.getAttribute('href'); };
  const names = {}; cards.forEach((a) => { names[a.getAttribute('href')] = nameOf(a); });
  const btns = [];
  cards.forEach((a) => {
    const href = a.getAttribute('href'), cell = el('div', 'tcell' + (a.classList.contains('wide') ? ' wide' : ''));
    a.parentNode.insertBefore(cell, a); cell.append(a);
    const b = el('button', 'fav'); b.type = 'button'; b.dataset.h = href; b.textContent = '☆';
    cell.append(b); btns.push(b);
  });
  function paint() {
    const f = read();
    btns.forEach((b) => { const on = f.includes(b.dataset.h), n = names[b.dataset.h]; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', (on ? 'Remove ' : 'Add ') + n + (on ? ' from favourites' : ' to favourites')); b.textContent = on ? '★' : '☆'; });
    if (!row) return;
    row.replaceChildren(); if (!f.length) { row.hidden = true; return; }
    row.append(el('span', 'chiph', 'Your favourites'));
    f.forEach((h) => { if (!names[h]) return; const a = el('a', null, names[h]); a.href = h; row.append(a); });
    row.hidden = false;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button.fav'); if (!b) return;
    const f = read(), h = b.dataset.h, i = f.indexOf(h); if (i >= 0) f.splice(i, 1); else f.push(h);
    write(f); paint();
  });
  paint();
})();
