/* GoVibe Mix — set history: logs tracks played for 20 s+, exports set lists and recording tracklists. Stored in this browser only. */
(() => {
  const A = window.GVAudio; if (!A) return;
  const { decks } = A, $ = (id) => document.getElementById(id), HK = 'govibe.history', RK = 'govibe.lastrec', CAP = 1000;
  const gv = /[?&]gvtest\b/.test(location.search), m = /[?&]gvlog=(\d+)/.exec(location.search);
  const LOG_SECS = gv && m ? +m[1] : 20, SESSION_GAP = 3 * 3600 * 1000;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { return false; } return true; };
  let log = load(HK, []), lastRec = load(RK, null);
  const base = (n) => String(n).replace(/\.[^.]+$/, '');
  const pad = (n) => String(n).padStart(2, '0');
  const tc = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };
  const clock = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const dayLabel = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const say = (t) => { $('hstatus').textContent = t; };

  function render() {
    const tb = $('hbody'); tb.innerHTML = ''; let prev = null, n = 0;
    log.forEach((e) => {
      if (e.brk || (prev && !e.brk && e.ts - prev > SESSION_GAP) || (!prev && !e.brk)) { const tr = tb.insertRow(), td = tr.insertCell(); td.colSpan = 5; td.className = 'hbreak'; td.textContent = (e.brk ? 'New set · ' : 'Set · ') + dayLabel(e.ts) + ' ' + clock(e.ts); n = 0; if (e.brk) { prev = e.ts; return; } }
      const tr = tb.insertRow(); n++;
      tr.insertCell().textContent = clock(e.ts); tr.insertCell().textContent = n + '. ' + base(e.name);
      tr.insertCell().textContent = e.bpm ? e.bpm.toFixed(1) : '—'; tr.insertCell().textContent = e.key || '—'; tr.insertCell().textContent = e.deck;
      prev = e.ts;
    });
    if (!log.length) { const tr = tb.insertRow(), td = tr.insertCell(); td.colSpan = 5; td.className = 'libempty'; td.textContent = 'Nothing played yet.'; }
    $('hrec').disabled = !(lastRec && lastRec.end);
  }
  function push(e) { log.push(e); if (log.length > CAP) log = log.slice(-CAP); if (!save(HK, log)) { log = log.slice(-200); save(HK, log); } render(); }

  /* ---------- logging: count real playing time per loaded track ---------- */
  const st = decks.map(() => ({ buf: null, secs: 0, logged: false, ts: 0 }));
  setInterval(() => {
    decks.forEach((d, i) => {
      const s = st[i]; if (!d.buf) return;
      if (s.buf !== d.buf) { s.buf = d.buf; s.secs = 0; s.logged = false; s.ts = 0; }
      if (d.playing && !d.scratching) {
        if (!s.ts) s.ts = Date.now() - 1000; s.secs += 1;
        if (!s.logged && s.secs >= LOG_SECS) { s.logged = true; push({ ts: s.ts, name: d.el.name.textContent, bpm: d.bpm || null, key: d.key || null, deck: d.name, libId: d.libId || null }); }
      }
    });
  }, 1000);

  /* ---------- recordings ---------- */
  window.addEventListener('gv-rec', (e) => {
    if (e.detail.state === 'start') { lastRec = { start: e.detail.t, end: null }; } else if (lastRec) { lastRec.end = e.detail.t; }
    save(RK, lastRec); render();
  });
  function recTracklist() {
    if (!lastRec || !lastRec.end) return '';
    const items = log.filter((e) => !e.brk && e.ts <= lastRec.end && e.ts >= lastRec.start - 10 * 60 * 1000);
    return items.map((e) => tc(e.ts - lastRec.start) + '  ' + base(e.name) + (e.bpm ? ' (' + Math.round(e.bpm) + ' BPM' + (e.key ? ', ' + e.key : '') + ')' : '')).join('\n');
  }
  $('hrec').onclick = () => {
    const t = recTracklist(); $('hrecbox').classList.remove('hidden'); $('hout').value = t || 'No tracks were logged during that recording. A track is logged after it has played for ' + LOG_SECS + ' seconds.';
    say(t ? 'Timecodes are when each track started playing. A track already playing when you pressed Record shows 00:00.' : '');
  };
  $('hcopy').onclick = async () => { try { await navigator.clipboard.writeText($('hout').value); $('hcopymsg').textContent = 'Copied.'; } catch (_) { $('hout').select(); $('hcopymsg').textContent = 'Press Ctrl+C to copy.'; } };

  /* ---------- export / manage ---------- */
  const dl = (text, name, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = () => ['Date,Time,Title,BPM,Key,Deck'].concat(log.filter((e) => !e.brk).map((e) => [new Date(e.ts).toISOString().slice(0, 10), clock(e.ts), base(e.name), e.bpm ? e.bpm.toFixed(1) : '', e.key || '', e.deck].map(csvCell).join(','))).join('\n') + '\n';
  const text = () => { let n = 0, prev = null; return log.map((e) => { if (e.brk || (prev && e.ts - prev > SESSION_GAP)) { n = 0; prev = e.ts; if (e.brk) return '\n— New set (' + dayLabel(e.ts) + ') —'; } prev = e.ts; return (++n) + '. ' + base(e.name) + (e.bpm ? ' — ' + Math.round(e.bpm) + ' BPM' : '') + (e.key ? ' — ' + e.key : '') + ' (' + clock(e.ts) + ')'; }).join('\n') + '\n'; };
  $('hcsv').onclick = () => (log.some((e) => !e.brk) ? dl(csv(), 'govibe-history.csv', 'text/csv') : say('Nothing to export yet.'));
  $('htxt').onclick = () => (log.some((e) => !e.brk) ? dl(text(), 'govibe-setlist.txt', 'text/plain') : say('Nothing to export yet.'));
  $('hnew').onclick = () => { st.forEach((x) => { x.secs = 0; x.logged = false; x.ts = 0; }); push({ ts: Date.now(), brk: true }); say('Started a new set.'); };
  $('hclear').onclick = () => { if (log.length && !confirm('Clear the whole history?')) return; log = []; save(HK, log); render(); say('History cleared.'); };
  render();
  if (gv) window.__hist = { get log() { return log; }, csv, text, recTracklist, LOG_SECS };   // test hook
})();
