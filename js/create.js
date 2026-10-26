/* Go Vibe Studios — AI music generator (bring-your-own Replicate key) */
(() => {
  const $ = (id) => document.getElementById(id);
  const API = 'https://api.replicate.com';

  // Models whose input fields were checked against Replicate's published schemas.
  const MODELS = {
    'stability-ai/stable-audio-2.5': { label: 'Stable Audio 2.5 (music & sound, up to 3 min)', max: 190, input: (p, d) => ({ prompt: p, duration: d }) },
    'meta/musicgen': { label: 'MusicGen (music, up to 30 s)', max: 30, input: (p, d) => ({ prompt: p, duration: d, output_format: 'wav' }) }
  };

  /* ---------- key handling (browser only) ---------- */
  const K = 'govibe.rkey', P = 'govibe.proxy';
  const getKey = () => { try { return localStorage.getItem(K) || sessionStorage.getItem(K) || ''; } catch (_) { return ''; } };
  const getProxy = () => { try { return (localStorage.getItem(P) || '').replace(/\/+$/, ''); } catch (_) { return ''; } };
  const modal = $('keymodal'), say = (t) => { $('status').textContent = t; };

  function openKey() { $('key').value = getKey(); $('proxy').value = getProxy(); modal.classList.remove('hidden'); $('key').focus(); }
  function closeKey() { modal.classList.add('hidden'); $('key').value = ''; }
  $('keybtn').onclick = openKey; $('keyclose').onclick = closeKey;
  modal.addEventListener('click', (e) => { if (e.target === modal) closeKey(); });
  $('keysave').onclick = () => {
    const k = $('key').value.trim(), px = $('proxy').value.trim();
    if (!k) return alert('Paste your API token first.');
    if (px && !/^https:\/\//.test(px)) return alert('The proxy URL must start with https://');
    try {
      localStorage.removeItem(K); sessionStorage.removeItem(K);
      ($('remember').checked ? localStorage : sessionStorage).setItem(K, k);
      px ? localStorage.setItem(P, px) : localStorage.removeItem(P);
    } catch (_) { alert('Could not save in this browser. The key will be kept for this page only.'); }
    closeKey(); say('Key saved.');
  };
  $('keyremove').onclick = () => { try { localStorage.removeItem(K); sessionStorage.removeItem(K); } catch (_) {} closeKey(); say('Key removed.'); };

  /* ---------- UI ---------- */
  const sel = $('model'), typeSel = $('type');
  const SA = 'stability-ai/stable-audio-2.5';
  // dur: [min, max (null = model max), default]. "loop" only adds a prompt hint, so seamless looping is not guaranteed.
  const TYPES = {
    music: { models: Object.keys(MODELS), dur: [5, null, 30], suffix: '', hint: 'Describe the music you want, e.g. upbeat lo-fi hip hop, warm piano, 85 BPM.' },
    sfx: { models: [SA], dur: [1, 15, 4], suffix: '', hint: 'Describe the sound, e.g. heavy wooden door creaking open, echoing in a stone hall.' },
    loop: { models: [SA], dur: [10, 60, 30], suffix: ', instrumental, seamless loop, no fade in or out', hint: 'Describe background music for a game, e.g. calm forest exploration, soft flute and harp.' }
  };
  function applyType() {
    const t = TYPES[typeSel.value];
    sel.innerHTML = ''; t.models.forEach((id) => sel.add(new Option(MODELS[id].label, id)));
    $('prompt').placeholder = t.hint;
    syncDur(true);
  }
  function syncDur(reset) {
    const m = MODELS[sel.value], t = TYPES[typeSel.value], d = $('dur');
    d.min = t.dur[0]; d.max = Math.min(t.dur[1] || m.max, m.max);
    if (reset === true) d.value = Math.min(t.dur[2], d.max);
    if (+d.value > +d.max) d.value = d.max;
    $('durv').textContent = d.value + ' s';
  }
  typeSel.onchange = applyType; sel.onchange = () => syncDur(true); $('dur').oninput = () => syncDur(); applyType();

  /* ---------- API ---------- */
  async function call(path, opts) {
    const proxy = getProxy();
    const url = (proxy || API) + path;
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers: { Authorization: 'Bearer ' + getKey(), 'Content-Type': 'application/json', ...(opts && opts.headers) }
      });
    } catch (e) {
      throw new Error(proxy
        ? 'Could not reach your proxy. Check the proxy URL.'
        : 'The browser blocked the direct call to Replicate (CORS). Set a proxy URL in the API key window — see worker/README.md.');
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Replicate rejected the key. Check it and try again.');
    if (res.status === 402) throw new Error('Replicate says this account has no credit. Add billing on replicate.com.');
    if (res.status === 429) throw new Error('Rate limited by Replicate. Wait a bit and retry.');
    if (!res.ok) throw new Error(body.detail || body.title || ('Replicate error ' + res.status));
    return body;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const outUrl = (o) => (Array.isArray(o) ? o[0] : o);

  let current = null; // { blob }
  let busy = false;
  $('gen').onclick = async () => {
    if (busy) return;
    const prompt = $('prompt').value.trim();
    if (!prompt) return say('Write a prompt first.');
    if (!getKey()) { say('Add your API key first.'); return openKey(); }
    const model = sel.value, m = MODELS[model];
    busy = true; $('gen').disabled = true; $('result').classList.add('hidden'); say('Sending your prompt…');
    try {
      let pred = await call('/v1/models/' + model + '/predictions', {
        method: 'POST', headers: { Prefer: 'wait=30' },
        body: JSON.stringify({ input: m.input(prompt + TYPES[typeSel.value].suffix, +$('dur').value) })
      });
      const t0 = Date.now();
      while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
        if (Date.now() - t0 > 5 * 60 * 1000) throw new Error('This is taking too long. Check replicate.com for the result.');
        say('Generating… ' + Math.round((Date.now() - t0) / 1000) + 's');
        await sleep(2000);
        pred = await call('/v1/predictions/' + encodeURIComponent(pred.id), { method: 'GET' });
      }
      if (pred.status !== 'succeeded') throw new Error(pred.error || 'Generation failed.');
      const u = outUrl(pred.output);
      if (!u) throw new Error('The model returned no audio.');
      say('Downloading audio…');
      await showResult(u);
      say('Done. Replicate bills your account for this run.');
    } catch (e) { say(e.message); }
    finally { busy = false; $('gen').disabled = false; }
  };

  async function fetchAudio(u) {
    const proxy = getProxy();
    const tries = [u]; if (proxy) tries.unshift(proxy + '/file?url=' + encodeURIComponent(u));
    for (const t of tries) { try { const r = await fetch(t); if (r.ok) return await r.blob(); } catch (_) {} }
    return null;
  }
  async function showResult(u) {
    const blob = await fetchAudio(u);
    const src = blob ? URL.createObjectURL(blob) : u;
    current = blob ? { blob } : null;
    const ext = blob && /mpeg|mp3/.test(blob.type) ? 'mp3' : 'wav';
    $('player').src = src;
    const dl = $('dl'); dl.href = src; dl.download = 'govibe-track.' + ext;
    if (!blob) dl.target = '_blank';
    $('toedit').disabled = !blob;
    $('toedit').title = blob ? '' : 'The browser could not fetch the file (CORS). Set a proxy to enable this.';
    $('result').classList.remove('hidden');
  }
  $('toedit').onclick = async () => {
    if (!current) return;
    try { await GVStore.put('handoff', current.blob); location.href = 'editor.html?from=create'; }
    catch (_) { say('Could not hand the file to the editor. Download it and open it there.'); }
  };
})();
