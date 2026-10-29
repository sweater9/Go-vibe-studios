/* GoVibe Mix home page: "Pick up where you left off". Reads only what this browser already holds: recent tools, Studio projects and the DJ library. */
(() => {
  const box = document.getElementById('workspace'); if (!box) return;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (_) { return []; } };
  async function build() {
    const recent = read('govibe.recent').filter((x) => x && /^[a-z0-9-]+\.html$/.test(x.h)), projects = read('govibe.sprojects').sort((a, b) => b.updated - a.updated).slice(0, 3);
    let lib = 0; try { if (window.GVStore) lib = (await GVStore.lib.all()).length; } catch (_) { /* no library */ }
    if (!recent.length && !projects.length && !lib) { box.hidden = true; return; }
    box.replaceChildren(); const head = el('div', 'gh'); head.append(el('h2', null, 'My workspace'), el('p', null, 'Saved only in this browser. Nothing is uploaded.')); box.append(head);
    const rows = el('div', 'wsgrid');
    if (recent.length) { const c = el('div', 'wscol'); c.append(el('h3', null, 'Recently used')); const u = el('div', 'chips'); recent.slice(0, 5).forEach((x) => { const a = el('a', null, x.t); a.href = x.h; u.append(a); }); c.append(u); rows.append(c); }
    if (projects.length) { const c = el('div', 'wscol'); c.append(el('h3', null, 'Studio projects')); const u = el('ul', 'wslist'); projects.forEach((x) => { const li = el('li'), a = el('a', null, x.name || 'Untitled'); a.href = 'studio.html?project=' + encodeURIComponent(x.id); li.append(a, el('span', null, ' · ' + (x.tracks || 0) + ' tracks · ' + new Date(x.updated).toLocaleDateString())); u.append(li); }); c.append(u); rows.append(c); }
    if (lib) { const c = el('div', 'wscol'); c.append(el('h3', null, 'DJ library')); const a = el('a', null, lib + ' track' + (lib === 1 ? '' : 's') + ' saved'); a.href = 'dj.html'; c.append(a); rows.append(c); }
    box.append(rows);
    const n = el('p', 'status', 'This data lives in this browser only. Clearing site data removes it, so make a backup: in the Studio use Export, and in the DJ library use Export backup. Backups can be imported on any device.'); box.append(n);
    box.hidden = false;
  }
  build();
  window.GVWorkspace = { build };
})();
