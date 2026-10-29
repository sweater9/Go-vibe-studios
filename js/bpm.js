/* GoVibe Mix — BPM and key finder: analyse files in the browser (tempo, Camelot key), copy or export the results, and a tap tempo counter. */
(() => {
  const $ = (id) => document.getElementById(id);
  const A = window.GVAnalyze;
  let ctx = null, rows = [], busy = false;
  const say = (t) => { $('status').textContent = t; };
  const fmtLen = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
  const base = (n) => n.replace(/\.[^.]+$/, '');

  async function analyse(file) {
    const r = { name: file.name, len: 0, bpm: null, key: null, note: '' };
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    let buf; try { buf = await ctx.decodeAudioData(await file.arrayBuffer()); } catch (_) { r.note = 'Could not read this file'; return r; }
    r.len = buf.duration;
    const b0 = A.detectBPM(buf);
    if (b0) { const g = A.detectGrid(buf, b0); r.bpm = g ? g.bpm : b0; } else r.note = 'No clear beat found';
    r.key = A.detectKey(buf);
    if (!r.key && !r.note) r.note = 'Key not found';
    return r;
  }
  async function add(files) {
    if (busy) return; busy = true;
    for (const f of files) {
      if (f.size > 300 * 1024 * 1024) { rows.push({ name: f.name, len: 0, bpm: null, key: null, note: 'Over 300 MB, skipped' }); render(); continue; }
      say('Analysing ' + f.name + '…'); await new Promise((r) => setTimeout(r, 30));
      rows.push(await analyse(f)); render();
    }
    busy = false; say(rows.length + ' track(s) analysed. Detection is an estimate, so check by ear.');
  }
  function render() {
    const tb = $('rows'); tb.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = tb.insertRow(); tr.insertCell().textContent = r.name;
      tr.insertCell().textContent = r.len ? fmtLen(r.len) : '—';
      tr.insertCell().textContent = r.bpm ? r.bpm.toFixed(1) : '—';
      tr.insertCell().textContent = r.key || '—';
      tr.insertCell().textContent = r.key ? A.keyName(r.key) : (r.note || '—');
      const c = tr.insertCell(), rm = document.createElement('button'); rm.className = 'btn mini'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Remove ' + r.name); rm.onclick = () => { rows.splice(i, 1); render(); }; c.appendChild(rm);
    });
    $('list').classList.toggle('hidden', !rows.length);
  }
  const table = (sep) => ['Title', 'Length', 'BPM', 'Camelot', 'Key'].join(sep) + '\n' + rows.map((r) => [sep === ',' ? '"' + base(r.name).replace(/"/g, '""') + '"' : base(r.name), r.len ? fmtLen(r.len) : '', r.bpm ? r.bpm.toFixed(1) : '', r.key || '', r.key ? A.keyName(r.key) : ''].join(sep)).join('\n') + '\n';
  $('copy').onclick = async () => { try { await navigator.clipboard.writeText(table('\t')); say('Copied. Paste it into a spreadsheet.'); } catch (_) { say('Copy is blocked in this browser. Use Export CSV instead.'); } };
  $('csv').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([table(',')], { type: 'text/csv' })); a.download = 'govibe-bpm-key.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  $('clear').onclick = () => { rows = []; render(); say(''); };
  $('drop').onclick = () => $('file').click();
  $('drop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } };
  $('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
  $('drop').ondragleave = () => $('drop').classList.remove('over');
  $('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); add([...e.dataTransfer.files]); };
  $('file').onchange = () => { add([...$('file').files]); $('file').value = ''; };

  /* ---------- tap tempo ---------- */
  let taps = [];
  let tapped = 0;
  $('tapuse').onclick = () => { if (tapped && window.GVSession) { GVSession.set({ bpm: tapped }); $('tapuse').textContent = 'Saved to your session'; } };
  function tap(now) {
    now = now == null ? performance.now() : now;
    if (taps.length && now - taps[taps.length - 1] > 2500) taps = [];
    taps.push(now); if (taps.length > 9) taps.shift();
    if (taps.length < 2) { $('tapbpm').textContent = '—'; return; }
    const bpm = 60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1));
    $('tapbpm').textContent = bpm.toFixed(1) + ' BPM'; tapped = bpm; $('tapuse').hidden = false;
  }
  $('tap').onclick = () => tap();
  $('tapreset').onclick = () => { taps = []; tapped = 0; $('tapuse').hidden = true; $('tapuse').textContent = 'Use this tempo in my session'; $('tapbpm').textContent = '—'; };
  if (/[?&]gvtest\b/.test(location.search)) window.__bpm = { add, tap, get rows() { return rows; } };
})();
