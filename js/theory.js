/* GoVibe Mix — music theory helpers: scales, chords in a key, Camelot codes, compatible keys, scale finder. */
window.GVTheory = (() => {
  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const SCALES = {
    'Major': [0, 2, 4, 5, 7, 9, 11], 'Natural minor': [0, 2, 3, 5, 7, 8, 10], 'Harmonic minor': [0, 2, 3, 5, 7, 8, 11], 'Melodic minor': [0, 2, 3, 5, 7, 9, 11],
    'Dorian': [0, 2, 3, 5, 7, 9, 10], 'Phrygian': [0, 1, 3, 5, 7, 8, 10], 'Lydian': [0, 2, 4, 6, 7, 9, 11], 'Mixolydian': [0, 2, 4, 5, 7, 9, 10], 'Locrian': [0, 1, 3, 5, 6, 8, 10],
    'Major pentatonic': [0, 2, 4, 7, 9], 'Minor pentatonic': [0, 3, 5, 7, 10], 'Blues': [0, 3, 5, 6, 7, 10]
  };
  const QUAL = { '0,4,7': ['', 'maj'], '0,3,7': ['m', 'min'], '0,3,6': ['dim', 'dim'], '0,4,8': ['aug', 'aug'], '0,4,7,11': ['maj7', 'maj'], '0,3,7,10': ['m7', 'min'], '0,4,7,10': ['7', 'maj'], '0,3,6,10': ['m7♭5', 'dim'], '0,3,6,9': ['dim7', 'dim'], '0,3,7,11': ['m(maj7)', 'min'], '0,4,8,11': ['maj7♯5', 'aug'] };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const nm = (pc) => NAMES[((pc % 12) + 12) % 12];
  const camelot = (root, minor) => { const r = minor ? (root + 3) % 12 : root; return (((r * 7) % 12 + 7) % 12 + 1) + (minor ? 'A' : 'B'); };
  /* chord on a degree of a 7 note scale by stacking thirds */
  function chord(root, ivs, degree, seventh) {
    const n = ivs.length, pick = (k) => { const idx = degree + k, oct = Math.floor(idx / n); return ivs[idx % n] + 12 * oct; };
    const base = pick(0), offs = [0, pick(2) - base, pick(4) - base]; if (seventh) offs.push(pick(6) - base);
    const q = QUAL[offs.join(',')] || ['?', 'maj'], rootPc = (root + base) % 12;
    let rn = ROMAN[degree % 7]; if (q[1] === 'min' || q[1] === 'dim') rn = rn.toLowerCase(); if (q[1] === 'dim') rn += '°';
    return { degree, rootPc, offsets: offs, name: nm(rootPc) + q[0], roman: rn + (seventh ? (q[0] === 'maj7' ? 'maj7' : q[0] === '7' ? '7' : '7') : ''), quality: q[1], midi: (oct) => offs.map((o) => 12 * oct + 12 + rootPc + o) };
  }
  const chordsInKey = (root, scale, seventh) => { const ivs = SCALES[scale]; return ivs.length === 7 ? ivs.map((_, d) => chord(root, ivs, d, seventh)) : []; };
  const PROGS = {
    major: { 'I V vi IV (pop)': [0, 4, 5, 3], 'I vi IV V (50s)': [0, 5, 3, 4], 'ii V I I (jazz)': [1, 4, 0, 0], 'I IV V IV (rock)': [0, 3, 4, 3], 'vi IV I V (emotional)': [5, 3, 0, 4], 'I iii IV V': [0, 2, 3, 4] },
    minor: { 'i VI III VII (epic)': [0, 5, 2, 6], 'i iv v i (classic)': [0, 3, 4, 0], 'i VII VI VII (rock)': [0, 6, 5, 6], 'i iv VII III': [0, 3, 6, 2], 'i VI iv V (dark)': [0, 5, 3, 4], 'ii° v i i (jazz)': [1, 4, 0, 0] }
  };
  /* Camelot neighbours that mix well */
  function compatible(root, minor) {
    const code = camelot(root, minor), n = parseInt(code, 10), L = code.slice(-1), wrap = (x) => ((x - 1 + 12) % 12) + 1, other = L === 'A' ? 'B' : 'A';
    const mk = (num, l, why) => { const rel = []; for (let r = 0; r < 12; r++) for (const mn of [false, true]) if (camelot(r, mn) === num + l) rel.push({ root: r, minor: mn }); const k = rel[0]; return { code: num + l, name: nm(k.root) + (k.minor ? ' minor' : ' major'), why, root: k.root, minor: k.minor }; };
    return [mk(n, L, 'Same key'), mk(n, other, 'Relative ' + (minor ? 'major' : 'minor') + ' (same notes)'), mk(wrap(n + 1), L, 'One step up (energy lift)'), mk(wrap(n - 1), L, 'One step down (calmer)'), mk(wrap(n + 2), L, 'Two steps up (stronger lift)')];
  }
  /* which scales contain every picked pitch class, best fit first */
  function findScales(pcs) {
    const set = new Set(pcs.map((p) => ((p % 12) + 12) % 12)); if (!set.size) return []; const out = [];
    for (let r = 0; r < 12; r++) for (const [name, ivs] of Object.entries(SCALES)) { const have = new Set(ivs.map((i) => (r + i) % 12)); let ok = true; set.forEach((p) => { if (!have.has(p)) ok = false; }); if (ok) out.push({ root: r, scale: name, extra: have.size - set.size, notes: ivs.map((i) => (r + i) % 12) }); }
    const rank = (s) => (s.scale === 'Major' || s.scale === 'Natural minor' ? 0 : /pent|Blues/.test(s.scale) ? 2 : 1);
    return out.sort((a, b) => a.extra - b.extra || rank(a) - rank(b) || a.root - b.root);
  }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  return { NAMES, SCALES, PROGS, ROMAN, nm, camelot, chord, chordsInKey, compatible, findScales, hz };
})();
