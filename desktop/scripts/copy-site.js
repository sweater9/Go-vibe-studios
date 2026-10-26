/* Copies the website files (one folder up) into desktop/site, leaving out tests, the desktop folder itself and server only files. */
const fs = require('fs'), path = require('path');
const src = path.resolve(__dirname, '..', '..'), dst = path.resolve(__dirname, '..', 'site');
const skip = new Set(['desktop', 'tests', 'node_modules', '.git', 'worker', '_headers', 'sitemap.xml', 'robots.txt', 'sw.js', 'README.md', '__pycache__']);
fs.rmSync(dst, { recursive: true, force: true });
(function copy(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (from === src && skip.has(name)) continue; if (name.startsWith('.')) continue;
    const a = path.join(from, name), b = path.join(to, name), st = fs.statSync(a);
    st.isDirectory() ? copy(a, b) : fs.copyFileSync(a, b);
  }
})(src, dst);
console.log('Site copied to', dst);
