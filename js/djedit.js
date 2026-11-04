/* GoVibe Mix — DJ edit maker page: reads a track's beat grid and structure (js/analyze.js, js/trackmap.js), plans a longer or shorter edit on bar lines (js/editplan.js), previews it and saves it. */
(() => {
  const Q = window.GVQuick, A = window.GVAnalyze, TM = window.GVTrackMap, EP = window.GVEditPlan, $ = (id) => document.getElementById(id), say = (t) => { $('status').textContent = t; };
  let buf = null, map = null, name = 'track', cur = null, out = null, url = null;
  const opts = () => $('emode').value === 'extend' ? { mode: 'extend', intro: +$('xintro').value, drop: +$('xdrop').value, outro: +$('xoutro').value } : { mode: 'shorten', keepIntro: +$('kintro').value, keepOutro: +$('koutro').value, max: +$('smax').value };
  function refresh() {
    if (!buf) return; const ext = $('emode').value === 'extend'; $('xopts').classList.toggle('hidden', !ext); $('sopts').classList.toggle('hidden', ext);
    cur = EP.plan(map, opts()); const ul = $('enotes'); ul.innerHTML = '';
    if (cur.error) { const li = document.createElement('li'); li.textContent = cur.error; ul.appendChild(li); $('save').disabled = true; $('eplay').removeAttribute('src'); return; }
    $('save').disabled = false; const li0 = document.createElement('li'); li0.textContent = 'Length: ' + Q.fmt(buf.duration) + ' becomes ' + Q.fmt(cur.len) + '.'; ul.appendChild(li0);
    cur.notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
    const chs = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i)); out = EP.render(chs, buf.sampleRate, cur);
    const pk = new Float32Array(900), n = out[0].length, step = n / 900; for (let i = 0; i < 900; i++) { let m = 0; for (let k = Math.floor(i * step); k < Math.floor((i + 1) * step); k += 16) m = Math.max(m, Math.abs(out[0][k] || 0)); pk[i] = m; }
    Q.draw($('ewave'), pk, null, 1, null);
    if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(Q.wav(out, buf.sampleRate)); $('eplay').src = url;
  }
  async function open(file) {
    try {
      say('Reading and analysing the track…'); buf = await Q.decode(file); name = Q.clean(file.name);
      const b0 = A.detectBPM(buf), grid = b0 ? A.detectGrid(buf, b0) : null; map = TM.analyze(buf, grid);
      $('drop').classList.add('hidden'); $('main2').classList.remove('hidden');
      $('sinfo').textContent = name + ', ' + Q.fmt(buf.duration) + (grid ? ', ' + grid.bpm.toFixed(1) + ' BPM' + (map.drop != null ? ', drop at ' + Q.fmt(map.drop) : ', no clear drop') + (map.introBars ? ', ' + map.introBars + ' bar intro' : '') : ', no steady beat found');
      refresh(); say('');
    } catch (e) { say('Could not open that file: ' + e.message); }
  }
  Q.hook($('drop'), open);
  ['emode', 'xintro', 'xdrop', 'xoutro', 'kintro', 'koutro', 'smax'].forEach((i) => $(i).addEventListener('change', refresh));
  $('again').onclick = () => { $('main2').classList.add('hidden'); $('drop').classList.remove('hidden'); $('eplay').pause(); buf = null; say(''); };
  $('save').onclick = async () => {
    if (!out) return; const f = $('ofmt').value; $('save').disabled = true;
    try { const blob = await Q.encode(out, buf.sampleRate, f, 192, (p) => say('Encoding MP3… ' + Math.round(p * 100) + '%')); Q.save(blob, name + (opts().mode === 'extend' ? ' (extended edit).' : ' (radio edit).') + f); say('Saved.'); }
    catch (e) { say('Could not save: ' + e.message); }
    $('save').disabled = false;
  };
  if (/[?&]gvtest\b/.test(location.search)) window.__edit = { open, get plan() { return cur; }, get out() { return out; }, get rate() { return buf && buf.sampleRate; }, get map() { return map; } };
})();
