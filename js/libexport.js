/* GoVibeMix — library export for other DJ software: a playlist file (.m3u8), a spreadsheet (.csv) and a Rekordbox style XML with tempo, key, rating, hot cues and playlists.
   Only the track data is exported, never the audio, so the files point at the original file names: put the export next to your music or relink the tracks in the other program.
   Pure functions on library records { id, name, dur, bpm, key, energy, grid, cues, rating, tag, notes } and playlists { name, ids }. */
window.GVLibExport = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const title = (n) => String(n || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const secs = (r) => Math.round(r.dur || 0);
  const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };   // a leading = + - @ is made harmless for spreadsheets
  const rows = (recs) => recs;
  /* extended M3U: one line per track with its length and title, the file name as the path */
  function m3u8(recs) { return '#EXTM3U\n' + rows(recs).map((r) => '#EXTINF:' + secs(r) + ',' + title(r.name).replace(/[\r\n]+/g, ' ') + '\n' + String(r.name).replace(/[\r\n]+/g, ' ')).join('\n') + '\n'; }
  function csv(recs) {
    const head = ['Title', 'File', 'Length (s)', 'BPM', 'Key (Camelot)', 'Energy (0 to 1)', 'Rating (0 to 5)', 'Tag', 'Notes', 'Beat 1 (s)', 'Cue 1', 'Cue 2', 'Cue 3', 'Cue 4', 'Cue 5', 'Cue 6', 'Cue 7', 'Cue 8'];
    const lines = [head.map(csvCell).join(',')];
    rows(recs).forEach((r) => lines.push([title(r.name), r.name, secs(r), r.bpm ? r.bpm.toFixed(2) : '', r.key || '', r.energy != null ? r.energy.toFixed(2) : '', r.rating || 0, r.tag || '', r.notes || '', r.grid ? (+r.grid.t0).toFixed(3) : '', ...Array.from({ length: 8 }, (_, i) => (r.cues && r.cues[i] != null ? (+r.cues[i]).toFixed(3) : ''))].map(csvCell).join(',')));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  /* Rekordbox style XML (the same shape the library's importer reads): COLLECTION with TEMPO and POSITION_MARK, then one playlist node per list */
  function rekordbox(recs, lists) {
    const id = new Map(); recs.forEach((r, i) => id.set(r.id, i + 1));
    const tr = recs.map((r, i) => '    <TRACK TrackID="' + (i + 1) + '" Name="' + esc(title(r.name)) + '" Artist="" TotalTime="' + secs(r) + '"' + (r.bpm ? ' AverageBpm="' + r.bpm.toFixed(2) + '"' : '') + (r.key ? ' Tonality="' + esc(r.key) + '"' : '') + ' Rating="' + Math.min(255, (r.rating || 0) * 51) + '" Comments="' + esc([r.tag, r.notes].filter(Boolean).join(' | ')) + '" Location="file://localhost/' + esc(encodeURI(r.name).replace(/#/g, '%23')) + '">\n'
      + (r.bpm ? '      <TEMPO Inizio="' + (r.grid ? Math.max(0, +r.grid.t0).toFixed(3) : '0.000') + '" Bpm="' + r.bpm.toFixed(2) + '" Metro="4/4" Battito="1"/>\n' : '')
      + (r.cues || []).map((c, n) => (c != null ? '      <POSITION_MARK Name="" Type="0" Start="' + (+c).toFixed(3) + '" Num="' + n + '"/>\n' : '')).join('') + '    </TRACK>').join('\n');
    const nodes = (lists || []).map((l) => { const ids = l.ids.filter((x) => id.has(x)); return '      <NODE Name="' + esc(l.name) + '" Type="1" KeyType="0" Entries="' + ids.length + '">\n' + ids.map((x) => '        <TRACK Key="' + id.get(x) + '"/>').join('\n') + (ids.length ? '\n' : '') + '      </NODE>'; });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">\n  <PRODUCT Name="GoVibeMix" Version="1.0" Company="GoVibeMix"/>\n  <COLLECTION Entries="' + recs.length + '">\n' + tr + '\n  </COLLECTION>\n  <PLAYLISTS>\n    <NODE Type="0" Name="ROOT" Count="' + nodes.length + '">\n' + nodes.join('\n') + '\n    </NODE>\n  </PLAYLISTS>\n</DJ_PLAYLISTS>\n';
  }
  return { m3u8, csv, rekordbox };
})();
