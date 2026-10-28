/* GoVibe Mix — chord engine: chord dictionary, chord identification, guitar and ukulele voicing search, key aware spelling and a chord chart transposer. Pure functions, no network. */
window.GVChords = (() => {
  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'], FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const noteName = (pc, flats) => (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];

  /* suffix, intervals, long name */
  const TYPES = [
    ['', [0, 4, 7], 'major'], ['m', [0, 3, 7], 'minor'], ['dim', [0, 3, 6], 'diminished'], ['aug', [0, 4, 8], 'augmented'],
    ['sus2', [0, 2, 7], 'suspended second'], ['sus4', [0, 5, 7], 'suspended fourth'], ['5', [0, 7], 'power chord'],
    ['6', [0, 4, 7, 9], 'major sixth'], ['m6', [0, 3, 7, 9], 'minor sixth'],
    ['7', [0, 4, 7, 10], 'dominant seventh'], ['maj7', [0, 4, 7, 11], 'major seventh'], ['m7', [0, 3, 7, 10], 'minor seventh'],
    ['m7♭5', [0, 3, 6, 10], 'half diminished'], ['dim7', [0, 3, 6, 9], 'diminished seventh'], ['mMaj7', [0, 3, 7, 11], 'minor major seventh'],
    ['7sus4', [0, 5, 7, 10], 'seventh suspended fourth'], ['7♯5', [0, 4, 8, 10], 'augmented seventh'],
    ['add9', [0, 2, 4, 7], 'major add ninth'], ['madd9', [0, 2, 3, 7], 'minor add ninth'],
    ['9', [0, 2, 4, 7, 10], 'dominant ninth'], ['maj9', [0, 2, 4, 7, 11], 'major ninth'], ['m9', [0, 2, 3, 7, 10], 'minor ninth'],
    ['7♭9', [0, 1, 4, 7, 10], 'seventh flat nine'], ['7♯9', [0, 3, 4, 7, 10], 'seventh sharp nine'],
  ];
  const TYPE = Object.fromEntries(TYPES.map((t) => [t[0], t]));
  const INTERVAL_NAMES = ['root', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th', 'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'];
  const key = (a) => a.slice().sort((x, y) => x - y).join(',');
  const BYSET = new Map(TYPES.map((t) => [key(t[1]), t]));

  /* ---------- chord finder ---------- */
  function identify(pcs, bass, flats) {
    const set = [...new Set(pcs.map((p) => ((p % 12) + 12) % 12))], res = { exact: [], partial: [] };
    if (set.length < 2) return res;
    for (const r of set) {
      const iv = set.map((p) => (p - r + 12) % 12), t = BYSET.get(key(iv));
      if (t) res.exact.push({ root: r, suffix: t[0], long: t[2], name: noteName(r, flats) + t[0] + (bass != null && bass !== r ? '/' + noteName(bass, flats) : ''), isBass: bass == null || bass === r });
    }
    res.exact.sort((a, b) => (b.isBass ? 1 : 0) - (a.isBass ? 1 : 0));
    if (bass != null) res.exact = res.exact.filter((c) => set.includes(bass));
    if (!res.exact.length) {
      for (let r = 0; r < 12; r++) for (const t of TYPES) {
        const have = new Set(t[1].map((i) => (r + i) % 12)); if (!set.every((p) => have.has(p))) continue;
        const missing = [...have].filter((p) => !set.includes(p)); if (missing.length > 2 || missing.length === 0) continue;
        res.partial.push({ root: r, suffix: t[0], long: t[2], name: noteName(r, flats) + t[0], missing: missing.map((p) => noteName(p, flats)), score: missing.length * 10 + (set.includes(r) ? 0 : 5) + t[1].length });
      }
      res.partial.sort((a, b) => a.score - b.score); res.partial = res.partial.slice(0, 8);
    }
    return res;
  }
  const chordNotes = (root, suffix, flats) => TYPE[suffix][1].map((i) => noteName(root + i, flats));

  /* ---------- fretted instrument voicings ---------- */
  const TUNINGS = {
    'Guitar, standard (E A D G B E)': [40, 45, 50, 55, 59, 64], 'Guitar, drop D (D A D G B E)': [38, 45, 50, 55, 59, 64], 'Guitar, DADGAD': [38, 45, 50, 55, 57, 62],
    'Guitar, open G (D G D G B D)': [38, 43, 50, 55, 59, 62], 'Guitar, half step down': [39, 44, 49, 54, 58, 63],
    'Bass, 4 string (E A D G)': [28, 33, 38, 43], 'Bass, 5 string (B E A D G)': [23, 28, 33, 38, 43],
    'Ukulele (G C E A)': [67, 60, 64, 69], 'Baritone ukulele (D G B E)': [50, 55, 59, 64], 'Mandolin or violin (G D A E)': [55, 62, 69, 76],
  };
  function voicings(tuning, root, suffix, max = 4) {
    const t = TYPE[suffix]; if (!t) return [];
    const need = new Set(t[1].map((i) => (root + i) % 12)), fifth = (root + 7) % 12, canSkip5 = t[1].length >= 4, n = tuning.length, minSounding = n >= 5 ? 4 : 3;
    const found = new Map();
    for (let p = 0; p <= 10; p++) {
      const opts = p <= 2 ? [-1, 0] : [-1]; for (let f = Math.max(1, p); f <= (p === 0 ? 3 : p + 3); f++) opts.push(f);
      const cur = new Array(n).fill(-1);
      const rec = (s) => {
        if (s === n) {
          let first = -1, last = -1, gap = false; for (let i = 0; i < n; i++) if (cur[i] >= 0) { if (first < 0) first = i; else if (last !== i - 1) gap = true; last = i; }
          if (gap || first < 0 || last - first + 1 < minSounding) return;
          const pcs = new Set(); for (let i = first; i <= last; i++) pcs.add((tuning[i] + cur[i]) % 12);
          for (const x of pcs) if (!need.has(x)) return;
          for (const x of need) if (!pcs.has(x) && !(canSkip5 && x === fifth)) return;
          let lowM = 999; for (let i = first; i <= last; i++) lowM = Math.min(lowM, tuning[i] + cur[i]); if (lowM % 12 !== root) return; // root is the lowest note
          const fretted = cur.filter((f) => f > 0); const lo = fretted.length ? Math.min(...fretted) : 0, hi = fretted.length ? Math.max(...fretted) : 0; if (hi - lo > 3) return; if (lo >= 4 && cur.some((f) => f === 0)) return;
          let score = 0; for (let i = 0; i < n; i++) { if (cur[i] < 0) score -= 3; else if (cur[i] === 0) score += 1; else score -= cur[i] * 0.25 + (cur[i] - lo) * 0.3; } score += (last - first + 1) * 1.5; if (fretted.length > 4 && n >= 5) score -= (fretted.length - 4) * 2;
          found.set(cur.join(','), { frets: cur.slice(), score, base: lo || 1, lo });
          return;
        }
        for (const f of opts) { cur[s] = f; rec(s + 1); }
        cur[s] = -1;
      };
      rec(0);
    }
    const all = [...found.values()].sort((a, b) => b.score - a.score), out = [];
    for (const v of all) { if (out.every((o) => o.lo !== v.lo)) out.push(v); if (out.length >= max) break; }
    for (const v of all) { if (out.length >= max) break; if (!out.includes(v)) out.push(v); }
    return out;
  }
  const voicingMidi = (tuning, v) => v.frets.map((f, i) => (f < 0 ? null : tuning[i] + f)).filter((x) => x != null);

  /* ---------- key aware spelling ---------- */
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], LPC = [0, 2, 4, 5, 7, 9, 11];
  function spellFrom(tonic, intervals) { // tonic such as 'D♭' ; returns note names with correct letters
    const li = LETTERS.indexOf(tonic[0]), acc = tonic.slice(1) === '♯' ? 1 : tonic.slice(1) === '♭' ? -1 : 0, tpc = (LPC[li] + acc + 12) % 12;
    return intervals.map((iv, k) => {
      const letter = (li + k) % 7, target = (tpc + iv) % 12; let d = ((target - LPC[letter] + 18) % 12) - 6;
      return LETTERS[letter] + (d === 0 ? '' : d === 1 ? '♯' : d === -1 ? '♭' : d === 2 ? '𝄪' : '𝄫');
    });
  }
  const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
  const CIRCLE_MAJ = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'], CIRCLE_MIN = ['A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'B♭', 'F', 'C', 'G', 'D'];
  const SIGS = [0, 1, 2, 3, 4, 5, 6, -5, -4, -3, -2, -1];
  const SHARP_ORDER = ['F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'E♯', 'B♯'], FLAT_ORDER = ['B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭', 'F♭'];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const pcOf = (name) => (LPC[LETTERS.indexOf(name[0])] + (name.slice(1) === '♯' ? 1 : name.slice(1) === '♭' ? -1 : 0) + 12) % 12;
  function diatonic(tonic, minor, sevenths) { // chords of a major or natural minor key, with roman numerals
    const ivs = minor ? MINOR : MAJOR, names = spellFrom(tonic, ivs), out = [];
    for (let d = 0; d < 7; d++) {
      const pick = (k) => { const idx = d + k, oct = Math.floor(idx / 7); return ivs[idx % 7] + 12 * oct; }, base = pick(0), offs = [0, pick(2) - base, pick(4) - base]; if (sevenths) offs.push(pick(6) - base);
      const sig = offs.join(','), Q = { '0,4,7': ['', 'maj'], '0,3,7': ['m', 'min'], '0,3,6': ['dim', 'dim'], '0,4,8': ['aug', 'aug'], '0,4,7,11': ['maj7', 'maj'], '0,3,7,10': ['m7', 'min'], '0,4,7,10': ['7', 'maj'], '0,3,6,10': ['m7♭5', 'dim'], '0,3,6,9': ['dim7', 'dim'] }[sig] || ['?', 'maj'];
      let rn = ROMAN[d]; if (Q[1] === 'min' || Q[1] === 'dim') rn = rn.toLowerCase(); rn += Q[1] === 'dim' ? '°' : ''; if (sevenths) rn += Q[0] === 'maj7' ? 'maj7' : Q[0] === 'm7♭5' ? 'ø7' : Q[0] === 'dim7' ? '7' : '7';
      out.push({ degree: d, roman: rn, name: names[d] + Q[0], root: names[d], notes: offs.map((o) => spellFrom(names[d], [o])[0]), pcs: offs.map((o) => (pcOf(names[d]) + o) % 12), quality: Q[1] });
    }
    return out;
  }
  function keyInfo(i, minor) {
    const tonic = (minor ? CIRCLE_MIN : CIRCLE_MAJ)[i], sig = SIGS[i];
    return { tonic, sig, accidentals: sig > 0 ? SHARP_ORDER.slice(0, sig) : sig < 0 ? FLAT_ORDER.slice(0, -sig) : [], scale: spellFrom(tonic, minor ? MINOR : MAJOR), relative: (minor ? CIRCLE_MAJ : CIRCLE_MIN)[i], sub: CIRCLE_MAJ[(i + 11) % 12], dom: CIRCLE_MAJ[(i + 1) % 12], subMin: CIRCLE_MIN[(i + 11) % 12], domMin: CIRCLE_MIN[(i + 1) % 12] };
  }

  /* ---------- chord chart transposer ---------- */
  const CHORD_RE = /^([A-G])([#♯b♭]?)((?:maj|min|dim|aug|sus|add|m|M|\+|°|ø|-|\d{1,2}|[#♯b♭+-]\d{1,2}|\([^)]*\))*)(?:\/([A-G])([#♯b♭]?))?$/;
  const FILLER_RE = /^([|\\/\-–—]+|x\d+|\d+x|N\.?C\.?|\|\|?:?|:?\|\|?|\(.*\)|%|\.+)$/i;
  const accOf = (a) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0);
  function shiftChord(tok, n, flats) {
    const m = CHORD_RE.exec(tok); if (!m) return null;
    const one = (L, a) => noteName(LPC[LETTERS.indexOf(L)] + accOf(a) + n, flats);
    return one(m[1], m[2]) + m[3] + (m[4] ? '/' + one(m[4], m[5]) : '');
  }
  function transpose(text, n, flats) {
    const fix = (tok) => shiftChord(tok, n, flats);
    return text.split('\n').map((line) => {
      // inline [C]chords as written in ChordPro
      if (/\[[^\]]+\]/.test(line)) return line.replace(/\[([^\]]+)\]/g, (all, c) => { const r = fix(c.trim()); return r ? '[' + r + ']' : all; });
      const parts = line.split(/(\s+)/), toks = parts.filter((p) => p.trim()); if (!toks.length) return line;
      const chords = toks.filter((t) => CHORD_RE.test(t)), others = toks.filter((t) => !CHORD_RE.test(t) && !FILLER_RE.test(t));
      if (!chords.length || others.length) return line;
      for (let i = 0; i < parts.length; i++) {
        if (!parts[i].trim() || !CHORD_RE.test(parts[i])) continue;
        const r = fix(parts[i]), diff = r.length - parts[i].length; parts[i] = r;
        if (i + 1 < parts.length && /^\s+$/.test(parts[i + 1])) { const sp = parts[i + 1]; parts[i + 1] = diff > 0 ? sp.slice(0, Math.max(1, sp.length - diff)) : sp + ' '.repeat(-diff); }
      }
      return parts.join('');
    }).join('\n');
  }
  const isChordToken = (t) => CHORD_RE.test(t);

  return { SHARP, FLAT, noteName, TYPES, TYPE, INTERVAL_NAMES, identify, chordNotes, TUNINGS, voicings, voicingMidi, spellFrom, diatonic, keyInfo, CIRCLE_MAJ, CIRCLE_MIN, SIGS, pcOf, transpose, shiftChord, isChordToken };
})();
